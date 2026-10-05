import type { CouponReport, CouponReportResponse, Merchant } from '@repo/shared';
export type { CouponReport, Merchant } from '@repo/shared';
export type CouponRow = {
  id: string;
  merchantId: string;
  code: string;
  status: 'quarantined' | 'verified';
  confirmations: number;
  reportCount: number;
  expectedSavingsCents: number;
  expiresAt: Date | null;
};
export type ReportResult = CouponReportResponse;

export class DomainError extends Error {
  constructor(public code: string, message: string, public status: 400 | 404 | 410) {
    super(message);
  }
}

export function toCandidate(coupon: CouponRow) {
  const successRate = coupon.reportCount ? coupon.confirmations / coupon.reportCount : 0;
  return {
    id: coupon.id,
    code: coupon.code,
    successRate,
    expectedSavingsCents: coupon.expectedSavingsCents,
    score: successRate * coupon.expectedSavingsCents,
    confirmations: coupon.confirmations,
    expiresAt: coupon.expiresAt?.toISOString() ?? null,
  };
}

// Also used after the SQL filter: a response never contains an expired or quarantined code.
export function eligibleCandidates(rows: CouponRow[], now: Date, limit: number) {
  return rows.filter((coupon) => coupon.status === 'verified' && coupon.confirmations >= 3
    && (!coupon.expiresAt || coupon.expiresAt.getTime() > now.getTime()))
    .map(toCandidate)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function summarizeReports(reports: { outcome: 'success' | 'failure'; savingsCents: number }[]) {
  const successes = reports.filter((report) => report.outcome === 'success');
  const confirmations = successes.length;
  return {
    confirmations,
    reportCount: reports.length,
    expectedSavingsCents: confirmations ? Math.round(successes.reduce((sum, report) => sum + report.savingsCents, 0) / confirmations) : 0,
    status: confirmations >= 3 ? 'verified' as const : 'quarantined' as const,
  };
}

export interface CouponStore {
  listMerchants(): Promise<Merchant[]>;
  hasMerchant(id: string): Promise<boolean>;
  findCandidates(merchantId: string, limit: number, now: Date): Promise<CouponRow[]>;
  authenticate(tokenHash: string): Promise<string | null>;
  report(userId: string, report: CouponReport, now: Date): Promise<ReportResult>;
  ping(): Promise<void>;
}

export interface RateLimiter {
  allow(key: string, limit: number, seconds: number): Promise<boolean>;
  ping(): Promise<void>;
}

export const hashToken = (token: string) => new Bun.CryptoHasher('sha256').update(token).digest('hex');
