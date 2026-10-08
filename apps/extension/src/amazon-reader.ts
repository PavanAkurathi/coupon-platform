import {
  amazonFocusRequestSchema, amazonInspectionSchema, amazonProductAsin,
  type AmazonFocusRequest, type AmazonInspection, type AmazonOffer,
} from '@repo/shared';

// Observed in Chrome on October 7, 2026, B097S1MF28. Scope excludes ads,
// recommendations, the mini-cart and unrelated purchase controls.
const COUPON_SCOPE = '#promoPriceBlockMessage_feature_div';
const COUPON_TILE = '.ct-coupon-tile';
// Second layout, observed October 8, 2026 on the same product: a "Coupon:"
// badge, an unlabelled checkbox and "Apply 10% coupon" text, tied together only
// by one promotion id suffix. Hidden accordion rows and a hidden duplicate scope
// repeat the same markup for other purchase modes.
const PERCENT_BADGE = 'i.newCouponBadge';
const PERCENT_ROW = '.promoPriceBlockMessage';
const AMOUNT = /\b\d{1,2}%|\$\d{1,4}(?:\.\d{2})?\b/;
const APPLIED_AMOUNT = new RegExp(`(${AMOUNT.source}) off coupon\\b`, 'i');
type Entry = { offer: AmazonOffer; control: HTMLInputElement; label: HTMLElement };

export function parseDisplayedUsd(text: string): number | null {
  const match = text.trim().match(/^\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
  if (!match) return null;
  const cents = Number(match[1]!.replaceAll(',', '')) * 100 + Number(match[2]);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}
function hash(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16);
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
function ownText(element: HTMLElement): string {
  return [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '').join(' ').replace(/[\s|]+/g, ' ').trim();
}
function percentCoupon(scope: HTMLElement, badge: HTMLElement) {
  const suffix = badge.id.match(/^badgepctch([A-Za-z0-9]{1,40})$/)?.[1];
  const row = badge.closest<HTMLElement>(PERCENT_ROW);
  if (!suffix || !row || !scope.contains(row) || !/^coupon:?$/i.test(text(badge))) return null;
  // Pair by the exact promotion id inside this row only. Duplicate ids elsewhere
  // in the document must never supply the focused control.
  const only = <T extends HTMLElement>(selector: string) => {
    const found = row.querySelectorAll<T>(selector);
    return found.length === 1 ? found[0]! : null;
  };
  const control = only<HTMLInputElement>(`input[type="checkbox"][id="checkboxpctch${suffix}"]`);
  const label = only<HTMLElement>(`label[for="checkboxpctch${suffix}"]`);
  const offerText = only<HTMLElement>(`[id="couponTextpctch${suffix}"]`);
  const done = row.querySelectorAll<HTMLElement>(`[id="donepctch${suffix}"]`);
  if (!control || !label || !offerText || done.length > 1) return null;
  let item: HTMLElement = badge;
  while (item !== row && !(item.contains(offerText) && item.contains(label))) item = item.parentElement!;
  if (item.querySelectorAll(PERCENT_BADGE).length !== 1) return null;
  // Amazon's own "applied" text is a selection on the page, not confirmed savings.
  const applied = done.length === 1 && visible(done[0]!);
  const offered = visible(offerText) && visible(label);
  if (applied === offered) return null;
  const amount = applied ? text(done[0]!).match(APPLIED_AMOUNT)?.[1] : null;
  const labelText = applied ? (amount ? `${amount} off coupon` : '') : ownText(offerText).slice(0, 400);
  if (!AMOUNT.test(labelText)) return null;
  return {control, label, labelText, context:text(item).slice(0, 2000), selected:applied};
}
function pageAsin(): string | null {
  const identifiers = [...document.querySelectorAll<HTMLInputElement>('input#ASIN, input#asin')]
    .map((element) => element.value);
  if (!identifiers.length || identifiers.some((value) => !/^[A-Z0-9]{10}$/.test(value))) return null;
  return new Set(identifiers).size === 1 ? identifiers[0]! : null;
}
function scan(now: number): { inspection: AmazonInspection; entries: Entry[] } {
  const asin = amazonProductAsin(location.href);
  const empty = (reason: string, status: 'unavailable' | 'no_offer' = 'unavailable', title = '') => ({
    entries: [], inspection: amazonInspectionSchema.parse({
      site:'amazon-us', status, asin, productTitle:title, observedAt:new Date(now).toISOString(),
      fingerprint:hash(`${asin}:${status}:${title}:${reason}`), offers:[], reason,
    }),
  });
  if (window !== window.top || !asin) return empty('Open an Amazon.com product page to check its visible coupon offers.');
  const titles = [...document.querySelectorAll<HTMLElement>('#title #productTitle')].filter(visible);
  if (document.readyState === 'loading' || titles.length !== 1 || pageAsin() !== asin) {
    return empty('The product is still changing or this page layout is not recognized. Wait for it to finish loading, then check again.');
  }
  const productTitle = text(titles[0]!).slice(0, 500);
  if (!productTitle) return empty('The product could not be identified.');
  const scopes = [...document.querySelectorAll<HTMLElement>(COUPON_SCOPE)].filter(visible);
  const entries: Entry[] = [];
  let unrecognized = false;
  const add = (control: HTMLInputElement, label: HTMLElement, labelText: string,
    advertisedPriceCents: number | null, context: string, selected = false) => {
    const limit = context.match(/\bLimit\s+[^.]{1,100}\./i)?.[0];
    const terms = [
      ...(limit ? [limit] : []),
      'See the coupon terms on Amazon. Eligibility and the final checkout total are not verified.',
    ];
    // Do not infer eligibility from membership banners or other buy-box offers.
    const purchaseRequirement = /subscribe|subscription/i.test(context) ? 'subscription' as const
      : /\bprime\b/i.test(context) ? 'prime' as const : 'unknown' as const;
    const state = selected ? 'already_selected' as const
      : control.disabled || control.getAttribute('aria-disabled') === 'true' ? 'unavailable' as const
      : control.checked ? 'already_selected' as const : 'available' as const;
    const offer: AmazonOffer = {
      id:`coupon-${entries.length}-${hash(`${asin}:${labelText}:${state}:${terms.join('|')}`)}`,
      kind:'native_coupon', label:labelText, advertisedPriceCents, state, purchaseRequirement, terms,
    };
    entries.push({offer, control, label});
  };
  for (const scope of scopes) {
    const before = entries.length;
    const scopeText = text(scope).slice(0, 2000);
    for (const tile of scope.querySelectorAll<HTMLElement>(COUPON_TILE)) {
      if (!visible(tile)) continue;
      const controls = [...tile.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
      const label = tile.querySelector<HTMLElement>('label.ct-coupon-checkbox-label');
      if (controls.length !== 1 || !label || !visible(label) || !/\bcoupon\b/i.test(text(label))) {
        unrecognized = true; continue;
      }
      const control = controls[0]!;
      // The native input may be visually styled/hidden. Its visible label must
      // belong to that exact input; never focus an unrelated control.
      if (!control.id || label.getAttribute('for') !== control.id) { unrecognized = true; continue; }
      const prices = [...tile.querySelectorAll<HTMLElement>('.a-price')].filter(visible)
        .map((price) => parseDisplayedUsd(price.querySelector('.a-offscreen')?.textContent ?? ''));
      const uniquePrices = [...new Set(prices.filter((price): price is number => price !== null))];
      const advertisedPriceCents = prices.every((price) => price !== null) && uniquePrices.length === 1 && /\bcoupon price\b/i.test(text(label)) ? uniquePrices[0]! : null;
      const labelText = advertisedPriceCents !== null
        ? `Coupon price $${(advertisedPriceCents / 100).toFixed(2)}` : text(label).slice(0, 400);
      add(control, label, labelText, advertisedPriceCents, scopeText);
    }
    for (const badge of scope.querySelectorAll<HTMLElement>(PERCENT_BADGE)) {
      if (!visible(badge)) continue;
      const coupon = percentCoupon(scope, badge);
      if (!coupon) { unrecognized = true; continue; }
      // A percent or amount off is not a coupon price; never derive one.
      add(coupon.control, coupon.label, coupon.labelText, null, coupon.context, coupon.selected);
    }
    // A coupon Amazon visibly shows must never be reported as absent.
    if (entries.length === before && /coupon/i.test(scopeText)) unrecognized = true;
  }
  if (entries.length > 10 || unrecognized) return empty('Amazon shows a coupon, but its layout is not recognized. Review it on Amazon.', 'unavailable', productTitle);
  if (!entries.length) return empty('No supported visible coupon was detected for this product. Sale, Prime and subscription prices are not coupon results.', 'no_offer', productTitle);
  const offers = entries.map(({offer}) => offer);
  const inspection = amazonInspectionSchema.parse({
    site:'amazon-us', status:'offers_found', asin, productTitle, observedAt:new Date(now).toISOString(),
    fingerprint:hash(JSON.stringify({asin, productTitle, offers})), offers,
    reason:'Offer shown by Amazon. Confirm eligibility and your final total at checkout.',
  });
  return {inspection, entries};
}

export function inspectAmazonPage(now = Date.now()): AmazonInspection { return scan(now).inspection; }

export function focusAmazonOffer(raw: AmazonFocusRequest, now = Date.now()): {focused:true} {
  const request = amazonFocusRequestSchema.parse(raw);
  const age = now - Date.parse(request.observedAt);
  if (age < 0 || age > 120_000) throw new Error('This offer view is out of date. Check the page again.');
  const {inspection, entries} = scan(now);
  if (inspection.asin !== request.asin || inspection.fingerprint !== request.fingerprint || inspection.status !== 'offers_found') {
    throw new Error('The product or offer changed. Check the page again.');
  }
  const entry = entries.find(({offer}) => offer.id === request.offerId);
  if (!entry || entry.offer.state !== 'available') throw new Error('This coupon is no longer available to select. Check the page again.');
  if (!visible(entry.label)) throw new Error('The coupon control is no longer visible.');
  entry.label.scrollIntoView({block:'center', behavior:'instant'});
  entry.control.focus({preventScroll:true});
  // Never click, submit, clip, change a value, navigate or modify purchase mode.
  return {focused:true};
}
