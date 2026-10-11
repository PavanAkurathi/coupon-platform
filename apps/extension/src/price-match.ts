import type { PageProduct, PriceOffer } from '@repo/shared';

// Price-match tips (docs/PRICE-MATCH.md). When the cheaper offer Hold found is one the
// current store's own policy says it matches, Hold says so, so the shopper can keep the
// saving and still buy here. It never contacts the store and never promises a match.
// Policies were read on each store's official page on October 10, 2026; re-check them
// within 90 days. A store stays off (live: false) until a tip has been seen on its live site.

type Competitor = { host: string; name: string; seller: string };
const AMAZON: Competitor = { host: 'www.amazon.com', name: 'Amazon', seller: 'Amazon.com' };
const WALMART: Competitor = { host: 'www.walmart.com', name: 'Walmart', seller: 'Walmart.com' };

export type MatchPolicy = {
  store: string; matches: Competitor[]; ask: string; excluded: string; url: string; live: boolean;
  // How this store names itself as the seller on its own pages; another seller there is not covered.
  ownSeller: RegExp;
};
export const POLICY_CHECKED = 'Oct 10, 2026';
export const MATCH_POLICIES: Record<string, MatchPolicy> = {
  // Seen live October 10, 2026: MG9575/49 at $99.99 sold by Best Buy, Amazon $96.99 sold by Amazon.com.
  'www.bestbuy.com': {
    store: 'Best Buy', matches: [AMAZON, WALMART], live: true, ownSeller: /^best ?buy/i,
    ask: 'Ask Best Buy in chat, by phone or in store before you buy, and share the {name} link.',
    excluded: 'Daily deals and member prices don\'t count.',
    url: 'https://www.bestbuy.com/site/help-topics/price-match-guarantee/pcmcat290300050002.c?id=pcmcat290300050002',
  },
  'www.homedepot.com': {
    store: 'Home Depot', matches: [AMAZON, WALMART], live: false, ownSeller: /home ?depot/i,
    ask: 'Ask in Home Depot chat or at checkout in store, and share the {name} link.',
    excluded: 'It must ship to you, and member prices don\'t count.',
    url: 'https://www.homedepot.com/c/price-match-and-price-check',
  },
  'www.lowes.com': {
    store: 'Lowe\'s', matches: [AMAZON], live: false, ownSeller: /lowe'?s/i,
    ask: 'Ask in Lowe\'s chat or in store, and share the {name} link.',
    excluded: 'One-time promotions don\'t count.',
    url: 'https://www.lowes.com/l/about/lowest-price-guarantee',
  },
  'www.staples.com': {
    store: 'Staples', matches: [AMAZON, WALMART], live: false, ownSeller: /staples/i,
    ask: 'Call Staples.com or ask at the store\'s service desk, and share the {name} link.',
    excluded: 'Holiday sales and clearance don\'t count.',
    url: 'https://www.staples.com/sbd/cre/marketing/pmg/index.html',
  },
};

// Best Buy pauses matching from the Thursday before Thanksgiving to the Monday after, and the
// others exclude the holiday sales of that week, so no store gets a tip then.
export function inHolidayBlackout(now: Date): boolean {
  const year = now.getFullYear();
  const first = new Date(year, 10, 1).getDay();
  const thanksgiving = new Date(year, 10, 1 + ((4 - first + 7) % 7) + 21);
  const start = new Date(year, 10, thanksgiving.getDate() - 7);
  const end = new Date(year, 10, thanksgiving.getDate() + 5);
  return now >= start && now < end;
}

export type MatchTip = { text: string; url: string; checked: string };
// The cheaper offer must be sold by the competitor itself, new, in stock, with free
// shipping (so its delivered price is the price the store will look at), and this page
// must not be another seller's listing on the current store.
export function matchTip(product: PageProduct, offer: PriceOffer, now = new Date(), policies = MATCH_POLICIES): MatchTip | null {
  const policy = policies[product.merchantDomain];
  if (!policy?.live) return null;
  const competitor = policy.matches.find((entry) => entry.host === offer.merchantDomain);
  if (!competitor || offer.seller !== competitor.seller) return null;
  if (product.seller && !policy.ownSeller.test(product.seller)) return null;
  if (offer.product.condition !== 'new' || offer.availability !== 'in_stock' || offer.shippingCents !== 0 || offer.requiresMembership || offer.requiresCoupon) return null;
  if (inHolidayBlackout(now)) return null;
  const { store } = policy; const { name } = competitor;
  return {
    text: `${store} says it matches ${name} for items sold by ${competitor.seller}. ${policy.ask.replace('{name}', name)} ${policy.excluded} ${store} decides.`,
    url: policy.url, checked: `${store} policy checked ${POLICY_CHECKED}`,
  };
}
