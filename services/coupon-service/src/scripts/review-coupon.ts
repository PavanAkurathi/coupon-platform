import { and, eq, sql } from 'drizzle-orm';
import { couponCodeSchema, couponSafetySchema, candidatesQuerySchema } from '@repo/shared';
import { connectDatabase } from '../db/client';
import { coupons, merchants } from '../db/schema';

const args = process.argv.slice(2);
function option(name: string) {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  return value?.startsWith('--') ? undefined : value;
}
const merchantId = candidatesQuerySchema.parse({merchantId:option('--merchant')}).merchantId;
const code = couponCodeSchema.parse(option('--code'));
const operator = option('--operator')?.trim();
if (!operator || operator.length > 200) throw new Error('Provide --operator with a stable operator identifier.');
const safety = couponSafetySchema.parse({
  approvalStatus:option('--approval'), audience:option('--audience'), attributionBehavior:option('--attribution'),
  reviewedAt:new Date().toISOString(), evidenceRef:option('--evidence'),
});
if (!safety.evidenceRef) throw new Error('An evidence reference is required for every review decision.');
const expiry = option('--expires-at');
const expiresAt = expiry ? new Date(expiry) : undefined;
if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) throw new Error('--expires-at must be a valid future timestamp.');
const {db,client} = connectDatabase();
try {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${merchantId}:${code}`}, 0))`);
    const [merchant] = await tx.select({id:merchants.id}).from(merchants).where(eq(merchants.id,merchantId));
    if (!merchant) throw new Error('Unknown merchant.');
    if (args.includes('--create')) {
      await tx.insert(coupons).values({merchantId,code,expiresAt:expiresAt ?? new Date(Date.now()+30*86400_000)})
        .onConflictDoNothing({target:[coupons.merchantId,coupons.code]});
    }
    const updated = await tx.update(coupons).set({
      ...safety, reviewedAt:new Date(safety.reviewedAt!), reviewedBy:operator, updatedAt:new Date(),
      ...(expiresAt ? {expiresAt} : {}),
    }).where(and(eq(coupons.merchantId,merchantId),eq(coupons.code,code))).returning({id:coupons.id});
    if (!updated.length) throw new Error('Coupon not found. Use --create only for a reviewed merchant/public source.');
    console.info(`Reviewed ${code}: ${safety.approvalStatus}/${safety.audience}/${safety.attributionBehavior}. Shopper quorum remains independent.`);
  });
} finally { await client.end({timeout:3}); }
