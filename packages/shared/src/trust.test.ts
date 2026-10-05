import { describe, expect, test } from 'bun:test';
import { allocateOrderCommission, attributionPolicy, confirmedEarningsLine, hasAffiliateMarker, type SettlementEvidence } from './trust';
import { couponReportSchema } from './contracts';

const eligible: SettlementEvidence = {orderStatus:'confirmed', currency:'USD', savingsCents:1250, additionalSavingsCents:1250, merchantCommissionCents:400, attribution:'earned', creatorLinkDetected:false, merchantVerified:true};
describe('attribution and one-dollar rule', () => {
  test('a full dollar comes only from merchant commission; shopper keeps all savings', () => {
    expect(allocateOrderCommission(eligible)).toEqual({feeCents:100,userSavingsCents:1250,remainingMerchantCommissionCents:300});
  });
  for (const patch of [
    {orderStatus:'pending'}, {orderStatus:'refunded'}, {savingsCents:0, additionalSavingsCents:0},
    {additionalSavingsCents:0},
    {merchantCommissionCents:99}, {attribution:'creator'}, {attribution:'other'},
    {attribution:'unknown'}, {creatorLinkDetected:true}, {merchantVerified:false},
  ] as Partial<SettlementEvidence>[]) {
    test(`no fee with ${JSON.stringify(patch)}`, () => {
      const evidence = {...eligible,...patch};
      const result = allocateOrderCommission(evidence);
      expect(result.feeCents).toBe(0);
      expect(result.userSavingsCents).toBe(evidence.savingsCents);
      expect(result.remainingMerchantCommissionCents).toBe(evidence.merchantCommissionCents);
    });
  }
  test('no policy branch permits writing affiliate cookies', () => {
    for (const owner of ['earned','creator','other','unknown'] as const) {
      expect(attributionPolicy(owner).mayWriteAffiliateCookie).toBe(false);
      expect(attributionPolicy(owner, true).mayClaimCommission).toBe(false);
      expect(attributionPolicy(owner, true).couponsAllowed).toBe(true);
    }
  });
  test('money is validated as nonnegative integer cents and USD', () => {
    expect(() => allocateOrderCommission({...eligible, savingsCents:-1})).toThrow();
    expect(() => allocateOrderCommission({...eligible, additionalSavingsCents:1251})).toThrow();
    expect(() => allocateOrderCommission({...eligible, merchantCommissionCents:100.5})).toThrow();
    expect(() => allocateOrderCommission({...eligible, currency:'EUR'} as never)).toThrow();
  });
  test('quiet receipt is conditional on confirmed data supplied by caller', () => {
    expect(confirmedEarningsLine({savingsCents:1250, feeCents:100})).toBe('You saved $12.50. We made $1.');
    expect(confirmedEarningsLine({savingsCents:1250, feeCents:0})).toBe('You saved $12.50. We made $0.');
    expect(() => confirmedEarningsLine({savingsCents:0,feeCents:100})).toThrow();
  });
  test('creator hints never grant attribution', () => {
    expect(hasAffiliateMarker('https://example.com/?tag=creator')).toBe(true);
    expect(hasAffiliateMarker('https://example.com/')).toBe(false);
    expect(hasAffiliateMarker('broken')).toBe(true);
  });
});
test('reports require evidence of positive savings and reject client identity fields', () => {
  const report = {merchantId:'00000000-0000-4000-8000-000000000001',code:'save10',outcome:'success',savingsCents:100,currency:'USD'};
  expect(couponReportSchema.parse(report).code).toBe('SAVE10');
  expect(couponReportSchema.safeParse({...report,userId:crypto.randomUUID()}).success).toBe(false);
  expect(couponReportSchema.safeParse({...report,savingsCents:0}).success).toBe(false);
  expect(couponReportSchema.safeParse({...report,outcome:'failure'}).success).toBe(false);
});
