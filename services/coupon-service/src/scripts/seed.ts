import { and, eq, sql } from 'drizzle-orm';
import { connectDatabase } from '../db/client';
import { couponReports, coupons, merchants, users } from '../db/schema';
import { hashToken } from '../domain';

// Explicitly invoked fixture only. The server never fabricates merchant/coupon data.
if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
const merchantId = '00000000-0000-4000-8000-000000000001';
const { db, client } = connectDatabase();
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('local-demo-seed', 0))`);
    await tx.insert(merchants).values({ id: merchantId, domain: 'localhost', name: 'Demo Store', currency: 'USD' }).onConflictDoNothing();
    const [merchant] = await tx.select().from(merchants).where(eq(merchants.id, merchantId));
    if (merchant?.domain !== 'localhost') throw new Error('Demo merchant id is already used by a different merchant.');
    const demoUsers: string[] = [];
    for (let number = 1; number <= 3; number++) {
      const identityHash = hashToken(`fixture-only:demo-shopper-${number}`);
      // Random unissued tokens cannot be used to report as synthetic demo shoppers.
      const tokenHash = hashToken(crypto.randomUUID());
      await tx.insert(users).values({ identityHash, tokenHash }).onConflictDoNothing({ target: users.identityHash });
      const [user] = await tx.select().from(users).where(eq(users.identityHash, identityHash));
      if (!user) throw new Error('Demo user was not created');
      demoUsers.push(user.id);
    }
    for (const [code, savingsCents, verifiedFixture] of [['WELCOME10', 1000, true], ['SAVE15', 1500, true], ['NEW20', 2000, false], ['LEGACY5', 500, false]] as const) {
      await tx.insert(coupons).values({
        merchantId, code, expiresAt: new Date(Date.now() + 30 * 86400_000),
      }).onConflictDoNothing({ target: [coupons.merchantId, coupons.code] });
      const [coupon] = await tx.select().from(coupons).where(and(eq(coupons.merchantId, merchantId), eq(coupons.code, code))).for('update');
      if (!coupon) throw new Error('Demo coupon was not created');
      for (const userId of verifiedFixture ? demoUsers : []) {
        // Re-running the seed refreshes fixture votes so they stay inside the evidence window.
        await tx.insert(couponReports).values({ couponId: coupon.id, userId, outcome: 'success', savingsCents })
          .onConflictDoUpdate({ target: [couponReports.couponId, couponReports.userId], set: { outcome: 'success', savingsCents, updatedAt: new Date() } });
      }
      // Recompute rather than overwrite aggregate values when a seed is re-run.
      const [aggregate] = await tx.select({
        reportCount: sql<number>`count(*)::integer`,
        confirmations: sql<number>`count(*) FILTER (WHERE ${couponReports.outcome} = 'success')::integer`,
        expectedSavingsCents: sql<number>`COALESCE(round(avg(${couponReports.savingsCents}) FILTER (WHERE ${couponReports.outcome} = 'success')), 0)::integer`,
      }).from(couponReports).where(eq(couponReports.couponId, coupon.id));
      if (!aggregate) throw new Error('Demo reports missing');
      await tx.update(coupons).set({
        ...aggregate, status: aggregate.confirmations >= 3 ? 'verified' : 'quarantined', updatedAt: new Date(),
        approvalStatus: 'approved', audience: 'public', attributionBehavior: 'neutral', reviewedAt: new Date(),
        reviewedBy: 'local-fixture-seed', evidenceRef: 'fixture:apps/extension/demo/checkout.ts; synthetic localhost codes only',
      }).where(eq(coupons.id, coupon.id));
    }
  });
  console.info('Local demo seeded. WELCOME10/SAVE15 have synthetic confirmations; NEW20/LEGACY5 require shopper verification. Safety approval is a localhost fixture only.');
} finally {
  await client.end({ timeout: 3 });
}
