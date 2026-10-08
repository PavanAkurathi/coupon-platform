import { and, asc, desc, eq, getTableColumns, gt, isNull, isNotNull, or, sql } from 'drizzle-orm';
import type { Database } from './client';
import { couponReports, coupons, merchants, users } from './schema';
import { DomainError, evidenceSince, type CouponStore, type CouponReport, type ReportResult } from '../domain';

const successful = sql`${couponReports.outcome} = 'success'`;
// Window aggregates shared by ranking and report responses.
const recentAggregate = {
  reportCount: sql<number>`count(*)::integer`,
  confirmations: sql<number>`(count(*) FILTER (WHERE ${successful}))::integer`,
  expectedSavingsCents: sql<number>`COALESCE(round(avg(${couponReports.savingsCents}) FILTER (WHERE ${successful})), 0)::integer`,
  lastConfirmedAt: sql<Date | null>`max(${couponReports.updatedAt}) FILTER (WHERE ${successful})`.mapWith(couponReports.updatedAt),
};

export function createCouponStore(db: Database, { evidenceWindowDays }: { evidenceWindowDays: number }): CouponStore {
  return {
    async listMerchants() {
      const rows = await db.select({ id: merchants.id, domain: merchants.domain, name: merchants.name, currency: merchants.currency })
        .from(merchants).where(eq(merchants.enabled, true)).orderBy(asc(merchants.domain));
      return rows.map((row) => ({ ...row, currency: 'USD' as const }));
    },
    async hasMerchant(id) {
      const [merchant] = await db.select({ id: merchants.id }).from(merchants).where(and(eq(merchants.id, id), eq(merchants.enabled, true))).limit(1);
      return Boolean(merchant);
    },
    async findCandidates(merchantId, limit, now) {
      // Recalculate the quorum from recent votes on every read so evidence ages out
      // without a background job. Stored aggregates are only a pre-filter.
      const recent = db.select({
        couponId: couponReports.couponId,
        reportCount: recentAggregate.reportCount.as('recent_report_count'),
        confirmations: recentAggregate.confirmations.as('recent_confirmations'),
        expectedSavingsCents: recentAggregate.expectedSavingsCents.as('recent_expected_savings_cents'),
        lastConfirmedAt: recentAggregate.lastConfirmedAt.as('recent_last_confirmed_at'),
      }).from(couponReports)
        .innerJoin(coupons, eq(coupons.id, couponReports.couponId))
        .where(and(eq(coupons.merchantId, merchantId), gt(couponReports.updatedAt, evidenceSince(now, evidenceWindowDays))))
        .groupBy(couponReports.couponId).as('recent');
      const score = sql`(${recent.confirmations}::double precision / NULLIF(${recent.reportCount}, 0)) * ${recent.expectedSavingsCents}`;
      return db.select({
        ...getTableColumns(coupons),
        confirmations: recent.confirmations, reportCount: recent.reportCount,
        expectedSavingsCents: recent.expectedSavingsCents, lastConfirmedAt: recent.lastConfirmedAt,
      }).from(coupons).innerJoin(recent, eq(recent.couponId, coupons.id)).where(and(
        eq(coupons.merchantId, merchantId),
        eq(coupons.status, 'verified'),
        eq(coupons.approvalStatus, 'approved'), eq(coupons.audience, 'public'),
        eq(coupons.attributionBehavior, 'neutral'), isNotNull(coupons.reviewedAt),
        isNotNull(coupons.evidenceRef), sql`length(trim(${coupons.evidenceRef})) > 0`,
        sql`${recent.confirmations} >= 3`,
        or(isNull(coupons.expiresAt), gt(coupons.expiresAt, now)),
      )).orderBy(desc(score), asc(coupons.id)).limit(limit);
    },
    async findCoupon(merchantId, code) {
      const [coupon] = await db.select().from(coupons).where(and(eq(coupons.merchantId, merchantId), eq(coupons.code, code))).limit(1);
      return coupon ? { ...coupon, lastConfirmedAt: null } : null;
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
        if (!merchant?.enabled) throw new DomainError('MERCHANT_NOT_FOUND', 'This merchant is not supported.', 404);
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
          updatedAt: now,
        }).onConflictDoUpdate({
          target: [couponReports.couponId, couponReports.userId],
          set: { outcome: report.outcome, savingsCents: report.savingsCents, updatedAt: now },
        });
        const [aggregate] = await tx.select({
          reportCount: recentAggregate.reportCount,
          confirmations: recentAggregate.confirmations,
          expectedSavingsCents: recentAggregate.expectedSavingsCents,
        }).from(couponReports).where(and(
          eq(couponReports.couponId, coupon.id),
          gt(couponReports.updatedAt, evidenceSince(now, evidenceWindowDays)),
        ));
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
