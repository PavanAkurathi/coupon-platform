import { isShopifyCheckout, shopifyCheckoutInspectionSchema, type ShopifyCheckoutInspection } from '@repo/shared';

// Observed on MVMT and Allbirds, October 8, 2026 (docs/SHOPIFY-CHECKOUT-EVIDENCE.md).
// Reads the merchant's own money lines and discount-field state only: no contact,
// address, payment or item details. It never types, clicks or submits.
const MONEY_LINES = 'div[role="table"][aria-labelledby^="MoneyLine-Heading"]';
const DISCOUNT_FIELD = 'input[name="reductions"][type="text"]';
const APPLY = 'button[type="submit"][aria-label="Apply Discount Code"]';
// Applied codes render as chips in a list, each with "Remove <CODE>" (observed on Allbirds).
const CODE_CHIP_REMOVE = 'ul[role="list"] [role="group"] button[type="button"][aria-label^="Remove "]';
const UNRECOGNIZED = 'The order summary is still updating or its layout is not recognized. Review the totals in checkout, then check again.';

// Signed cents for an observed amount such as "$19.00", "USD $28.17" or "-$5.00".
export function parseShopifyMoney(raw: string): number | null {
  const match = raw.replace(/\s+/g, ' ').trim().match(/^(?:USD )?([-−])? ?\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
  if (!match) return null;
  const cents = Number(match[2]!.replaceAll(',', '')) * 100 + Number(match[3]);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000) return null;
  return match[1] ? -cents : cents;
}
function visible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected || !element.getClientRects().length) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none'
      || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  return true;
}
const firstLine = (element: HTMLElement) => element.innerText.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
function unavailable(now: number, reason: string): ShopifyCheckoutInspection {
  return shopifyCheckoutInspectionSchema.parse({
    platform:'shopify', status:'unavailable', observedAt:new Date(now).toISOString(), subtotalCents:null, discountCents:null,
    totalCents:null, totalIsEstimate:true, discountField:'missing', codeRejected:false, appliedCodes:[], reason,
  });
}
export function appliedCodes(): string[] {
  return [...document.querySelectorAll<HTMLButtonElement>(CODE_CHIP_REMOVE)].filter(visible)
    .map((button) => button.getAttribute('aria-label')!.slice('Remove '.length).trim()).filter(Boolean).slice(0, 10);
}

export function inspectShopifyCheckout(enabledHosts: readonly string[], now = Date.now()): ShopifyCheckoutInspection {
  if (window !== window.top || !isShopifyCheckout(location.href, enabledHosts)) {
    return unavailable(now, 'Open checkout on a supported store to read its order summary.');
  }
  if (document.readyState === 'loading') return unavailable(now, UNRECOGNIZED);
  const tables = [...document.querySelectorAll(MONEY_LINES)].filter(visible);
  if (tables.length !== 1) return unavailable(now, UNRECOGNIZED);
  const lines: { label: string; amount: string }[] = [];
  for (const row of tables[0]!.querySelectorAll('[role="row"]')) {
    if (!visible(row)) continue;
    const headers = [...row.querySelectorAll('[role="rowheader"]')].filter(visible);
    const cells = [...row.querySelectorAll('[role="cell"]')].filter(visible);
    // Observed non-amount rows: the opening column-header row (neither part) and
    // the "Order discount" heading (a rowheader only). Required rows that lose
    // their amount still fail below, because Subtotal and Total must be present.
    if (!cells.length && headers.length <= 1) continue;
    if (headers.length !== 1 || cells.length !== 1) return unavailable(now, UNRECOGNIZED);
    lines.push({ label: firstLine(headers[0]!), amount: cells[0]!.innerText.replace(/\s+/g, ' ').trim() });
  }
  const subtotals = lines.filter(({ label }) => /^Subtotal\b/.test(label));
  const totals = lines.filter(({ label }) => label === 'Total');
  if (subtotals.length !== 1 || totals.length !== 1) return unavailable(now, UNRECOGNIZED);
  const subtotalCents = parseShopifyMoney(subtotals[0]!.amount);
  const totalCents = parseShopifyMoney(totals[0]!.amount);
  if (subtotalCents === null || totalCents === null || subtotalCents < 0 || totalCents < 0) {
    return unavailable(now, 'An order summary amount could not be read in US dollars. Review the totals in checkout.');
  }
  // Any other negative money line reduces the order. Its label is the merchant's.
  let discountCents = 0;
  for (const line of lines) {
    if (line === subtotals[0] || line === totals[0]) continue;
    const cents = parseShopifyMoney(line.amount);
    if (cents !== null && cents < 0) discountCents -= cents;
  }
  const shipping = lines.find(({ label }) => /^Shipping\b/.test(label));
  const shippingKnown = Boolean(shipping) && (parseShopifyMoney(shipping!.amount) !== null || /^Free$/i.test(shipping!.amount));
  const totalIsEstimate = !shippingKnown || lines.some(({ label }) => /^Estimated\b/i.test(label));
  const fields = [...document.querySelectorAll<HTMLInputElement>(DISCOUNT_FIELD)].filter(visible);
  const field = fields.length === 1 ? fields[0]! : null;
  const apply = field?.form ? [...field.form.querySelectorAll(APPLY)].filter(visible) : [];
  const describedBy = field?.getAttribute('aria-describedby');
  const error = describedBy ? document.getElementById(describedBy) : null;
  const codeRejected = Boolean(field && field.getAttribute('aria-invalid') === 'true' && error && visible(error) && error.innerText.trim());
  return shopifyCheckoutInspectionSchema.parse({
    platform:'shopify', status:'ready', observedAt:new Date(now).toISOString(),
    subtotalCents, discountCents, totalCents, totalIsEstimate,
    discountField: field && apply.length === 1 ? 'available' : 'missing', codeRejected, appliedCodes: appliedCodes(),
    reason: totalIsEstimate ? 'Totals shown by the store. Shipping or taxes are estimated until an address is entered.' : 'Totals shown by the store.',
  });
}
