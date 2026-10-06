import { and, asc, desc, eq, gt, isNull, isNotNull, or, sql } from 'drizzle-orm';
import type { Database } from './client';
import { couponReports, coupons, merchants, users } from './schema';
import { DomainError, type CouponStore, type CouponReport, type ReportResult } from '../domain';

export function createCouponStore(db: Database): CouponStore {
  return {
    async listMerchants() {
      const rows = await db.select({ id: merchants.id, domain: merchants.domain, name: merchants.name, currency: merchants.currency }).from(merchants).orderBy(asc(merchants.domain));
      return rows.map((row) => ({ ...row, currency: 'USD' as const }));
    },
    async hasMerchant(id) {
      const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, id)).limit(1);
      return Boolean(merchant);
    },
    async findCandidates(merchantId, limit, now) {
      const score = sql`(${coupons.confirmations}::double precision / NULLIF(${coupons.reportCount}, 0)) * ${coupons.expectedSavingsCents}`;
      return db.select().from(coupons).where(and(
        eq(coupons.merchantId, merchantId),
        eq(coupons.status, 'verified'),
        eq(coupons.approvalStatus, 'approved'), eq(coupons.audience, 'public'),
        eq(coupons.attributionBehavior, 'neutral'), isNotNull(coupons.reviewedAt),
        isNotNull(coupons.evidenceRef), sql`length(trim(${coupons.evidenceRef})) > 0`,
        sql`${coupons.confirmations} >= 3`,
        or(isNull(coupons.expiresAt), gt(coupons.expiresAt, now)),
      )).orderBy(desc(score), asc(coupons.id)).limit(limit);
    },
    async findCoupon(merchantId, code) {
      const [coupon] = await db.select().from(coupons).where(and(eq(coupons.merchantId, merchantId), eq(coupons.code, code))).limit(1);
      return coupon ?? null;
    },
    async authenticate(tokenHash) {
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.tokenHash, tokenHash)).limit(1);
      return user?.id ?? null;
    },
    async report(userId: string, report: CouponReport, now: Date): Promise<ReportResult> {
      return db.transaction(async (tx) => {
        // Serialize creation and aggregation of this code even before it has a row.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${report.merchantId}:${report.code}`}, 0))`);
        const [merchant] = await tx.select().from(merchants).where(eq(merchants.id, report.merchantId)).limit(1);
        if (!merchant) throw new DomainError('MERCHANT_NOT_FOUND', 'This merchant is not supported.', 404);
        if (merchant.currency !== report.currency) throw new DomainError('CURRENCY_MISMATCH', 'This merchant uses a different currency.', 400);
        let [coupon] = await tx.select().from(coupons).where(and(eq(coupons.merchantId, report.merchantId), eq(coupons.code, report.code))).for('update');
        if (coupon?.expiresAt && coupon.expiresAt.getTime() <= now.getTime()) {
          throw new DomainError('COUPON_EXPIRED', 'This code has expired.', 410);
        }
        if (!coupon) {
          [coupon] = await tx.insert(coupons).values({
            merchantId: report.merchantId,
            code: report.code,
            // Uncurated codes must be refreshed by an operator after 30 days.
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          }).returning();
        }
        if (!coupon) throw new Error('Coupon insert returned no row');
        await tx.insert(couponReports).values({
          couponId: coupon.id,
          userId,
          outcome: report.outcome,
          savingsCents: report.savingsCents,
        }).onConflictDoUpdate({
          target: [couponReports.couponId, couponReports.userId],
          set: { outcome: report.outcome, savingsCents: report.savingsCents, updatedAt: now },
        });
        const [aggregate] = await tx.select({
          reportCount: sql<number>`count(*)::integer`,
          confirmations: sql<number>`count(*) FILTER (WHERE ${couponReports.outcome} = 'success')::integer`,
          expectedSavingsCents: sql<number>`COALESCE(round(avg(${couponReports.savingsCents}) FILTER (WHERE ${couponReports.outcome} = 'success')), 0)::integer`,
        }).from(couponReports).where(eq(couponReports.couponId, coupon.id));
        if (!aggregate) throw new Error('Report aggregate returned no row');
        const status = aggregate.confirmations >= 3 ? 'verified' : 'quarantined';
        await tx.update(coupons).set({ ...aggregate, status, updatedAt: now }).where(eq(coupons.id, coupon.id));
        return {
          couponId: coupon.id,
          status,
          confirmations: aggregate.confirmations,
          successRate: aggregate.confirmations / aggregate.reportCount,
        };
      });
    },
    async ping() { await db.execute(sql`SELECT 1`); },
  };
}
