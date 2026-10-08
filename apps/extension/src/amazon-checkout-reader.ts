import { amazonCheckoutInspectionSchema, isAmazonCheckout, type AmazonCheckoutInspection } from '@repo/shared';

// Observed in Chrome on October 8, 2026 at final order review
// (docs/AMAZON-CHECKOUT-EVIDENCE.md). Reads only order-summary amounts: no
// product names, addresses, payment details or checkout session identifiers.
const SUMMARY = '#subtotals-marketplace-table';
const ROW = '.order-summary-grid';
const TERM = '.order-summary-line-term';
const DEFINITION = '.order-summary-line-definition';
// A read-only signal that this is the final review step. Never clicked.
const PLACE_ORDER = 'input#placeOrder[name="placeYourOrder1"][type="submit"]';
const COUPON_LABEL = 'your coupon savings:';
const TOTAL_LABEL = 'order total:';
const UNRECOGNIZED = 'The order summary is still updating or its layout is not recognized. Review the totals on Amazon, then check again.';

export function parseSummaryUsd(raw: string, sign: 'negative' | 'positive'): number | null {
  const amount = raw.replace(/\s+/g, '');
  const match = amount.match(sign === 'negative'
    ? /^[-−]\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/
    : /^\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
  if (!match) return null;
  const cents = Number(match[1]!.replaceAll(',', '')) * 100 + Number(match[2]);
  return Number.isSafeInteger(cents) && cents <= 100_000_000 ? cents : null;
}
function visible(element: HTMLElement): boolean {
  if (!element.isConnected || !element.getClientRects().length || element.getBoundingClientRect().width <= 0) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none'
      || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  return true;
}
function text(element: HTMLElement): string { return element.innerText.replace(/\s+/g, ' ').trim(); }
function follows(first: Node, second: Node): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}
function unavailable(now: number, reason: string): AmazonCheckoutInspection {
  return amazonCheckoutInspectionSchema.parse({
    site:'amazon-us', status:'unavailable', observedAt:new Date(now).toISOString(),
    couponSavingsCents:null, orderTotalCents:null, reason,
  });
}
// Pairs each visible label with its amount in document order. Returns null when
// the pairing is not exact, so a shifted or partial row can never be misread.
function summaryRows(summary: HTMLElement): [string, string][] | null {
  const rows: [string, string][] = [];
  for (const row of summary.querySelectorAll<HTMLElement>(ROW)) {
    if (row.querySelector(ROW) || !visible(row)) continue;
    const terms = [...row.querySelectorAll<HTMLElement>(TERM)].filter(visible);
    const definitions = [...row.querySelectorAll<HTMLElement>(DEFINITION)].filter(visible);
    if (terms.length !== definitions.length) return null;
    for (let i = 0; i < terms.length; i++) {
      const next = terms[i + 1];
      if (!follows(terms[i]!, definitions[i]!) || (next && !follows(definitions[i]!, next))) return null;
      rows.push([text(terms[i]!).toLowerCase(), text(definitions[i]!)]);
    }
  }
  return rows.length ? rows : null;
}

export function inspectAmazonCheckout(now = Date.now()): AmazonCheckoutInspection {
  if (window !== window.top || !isAmazonCheckout(location.href)) {
    return unavailable(now, 'Open your Amazon.com order review page to check its coupon savings.');
  }
  if (document.readyState === 'loading') return unavailable(now, UNRECOGNIZED);
  const summaries = [...document.querySelectorAll<HTMLElement>(SUMMARY)].filter(visible);
  if (summaries.length !== 1) return unavailable(now, UNRECOGNIZED);
  const rows = summaryRows(summaries[0]!);
  if (!rows) return unavailable(now, UNRECOGNIZED);
  const coupons = rows.filter(([term]) => term === COUPON_LABEL);
  const totals = rows.filter(([term]) => term === TOTAL_LABEL);
  if (totals.length !== 1 || coupons.length > 1) return unavailable(now, UNRECOGNIZED);
  const orderTotalCents = parseSummaryUsd(totals[0]![1], 'positive');
  const couponSavingsCents = coupons.length ? parseSummaryUsd(coupons[0]![1], 'negative') : 0;
  if (orderTotalCents === null || couponSavingsCents === null) {
    return unavailable(now, 'An order summary amount could not be read in US dollars. Review the totals on Amazon.');
  }
  if (![...document.querySelectorAll<HTMLInputElement>(PLACE_ORDER)].some(visible)) {
    return unavailable(now, 'Finish choosing delivery and payment on Amazon, then check the totals again.');
  }
  return amazonCheckoutInspectionSchema.parse({
    site:'amazon-us', status:'review_ready', observedAt:new Date(now).toISOString(),
    couponSavingsCents, orderTotalCents,
    reason: couponSavingsCents > 0 ? 'Coupon savings shown by Amazon at order review.' : 'Amazon shows no coupon savings in this order summary.',
  });
}
