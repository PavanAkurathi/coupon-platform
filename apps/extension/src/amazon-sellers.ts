import { dollarsToCents } from './product-reader';

// Other sellers on the same Amazon product page. The page's "Other sellers" panel
// (All Offers Display) is fetched the same way Amazon's page loads it, as the
// signed-in shopper, so delivery terms reflect their Prime status and address.
// Structure observed October 8, 2026: #aod-pinned-offer is the buy box, each
// #aod-offer another offer, with condition, price, delivery and seller rating.

export type SellerOffer = {
  pinned: boolean; condition: string; priceCents: number | null; shippingCents: number | null;
  seller: string; stars: number | null; ratings: number | null; byAmazon: boolean;
};
export type CheaperSeller = { buyBox: SellerOffer; best: SellerOffer; savingsCents: number };

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const MIN_SAVINGS_CENTS = 100;
const MIN_STARS = 4.5;
const MIN_RATINGS = 100;

function offerPrice(offer: Element): number | null {
  const price = offer.querySelector('[id^="aod-price-"] .a-price:not(.a-text-price)');
  const whole = clean(price?.querySelector('.a-price-whole')?.textContent).replace(/[.,]/g, '');
  const fraction = clean(price?.querySelector('.a-price-fraction')?.textContent);
  return /^\d+$/.test(whole) && /^\d{2}$/.test(fraction) ? dollarsToCents(`${whole}.${fraction}`) : null;
}
// The primary delivery line: FREE, FREE above a threshold, or a stated price.
function offerShipping(offer: Element, priceCents: number | null): number | null {
  const delivery = offer.querySelector('[data-csa-c-delivery-price]');
  const amount = clean(delivery?.getAttribute('data-csa-c-delivery-price'));
  const condition = clean(delivery?.getAttribute('data-csa-c-delivery-condition'));
  if (/^FREE$/i.test(amount)) {
    const minimum = condition.match(/over \$(\d+(?:\.\d{2})?)/i);
    if (!condition) return 0;
    return minimum && priceCents !== null && priceCents >= (dollarsToCents(minimum[1]) ?? Infinity) ? 0 : null;
  }
  return dollarsToCents(amount.replace(/^\$/, ''));
}

export function parseAmazonOffers(doc: Document): SellerOffer[] {
  return [...doc.querySelectorAll('#aod-pinned-offer, #aod-offer')].map((offer) => {
    const sold = clean(offer.querySelector('#aod-offer-soldBy')?.textContent);
    const seller = clean(sold.replace(/^Sold by\s*/i, '').split(/Seller rating is/i)[0]).slice(0, 100);
    const rating = sold.match(/Seller rating is ([\d.]+) out of 5 stars \(([\d,]+) ratings?\)/i);
    const priceCents = offerPrice(offer);
    return {
      pinned: offer.id === 'aod-pinned-offer', condition: clean(offer.querySelector('#aod-offer-heading')?.textContent),
      priceCents, shippingCents: offerShipping(offer, priceCents), seller,
      stars: rating ? Number(rating[1]) : null, ratings: rating ? Number(rating[2]!.replaceAll(',', '')) : null,
      byAmazon: seller === 'Amazon.com',
    };
  });
}

// A new offer from a well-rated seller, with known delivery, at least $1 under
// the buy box. The buy box must be the price the page shows.
export function cheaperSeller(offers: SellerOffer[], shownPriceCents: number): CheaperSeller | null {
  const buyBox = offers.filter((offer) => offer.pinned);
  if (buyBox.length !== 1 || buyBox[0]!.priceCents !== shownPriceCents || buyBox[0]!.condition !== 'New') return null;
  const base = buyBox[0]!.priceCents + (buyBox[0]!.shippingCents ?? 0);
  const candidates = offers.filter((offer) => !offer.pinned && offer.condition === 'New' && offer.priceCents !== null && offer.shippingCents !== null
    && (offer.byAmazon || ((offer.stars ?? 0) >= MIN_STARS && (offer.ratings ?? 0) >= MIN_RATINGS)));
  if (!candidates.length) return null;
  const total = (offer: SellerOffer) => offer.priceCents! + offer.shippingCents!;
  const best = candidates.reduce((winner, offer) => total(offer) < total(winner) ? offer : winner);
  const savingsCents = base - total(best);
  return savingsCents >= MIN_SAVINGS_CENTS ? { buyBox: buyBox[0]!, best, savingsCents } : null;
}

export async function findCheaperSeller(asin: string, shownPriceCents: number): Promise<CheaperSeller | null> {
  try {
    const response = await fetch(`https://www.amazon.com/gp/product/ajax/aodAjaxMain/ref=dp_aod_ALL_mbc?asin=${asin}&pc=dp&experienceId=aodAjaxMain`,
      { credentials: 'same-origin', signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    const html = await response.text();
    if (html.length > 5_000_000) return null;
    return cheaperSeller(parseAmazonOffers(new DOMParser().parseFromString(html, 'text/html')), shownPriceCents);
  } catch { return null; }
}
