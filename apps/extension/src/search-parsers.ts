import { cleanProductUrl } from '@repo/shared';
import { dollarsToCents, walmartData } from './product-reader';

// Search result pages fetched in the background, parsed in the offscreen document.
// Structures observed October 8, 2026 (query MG5965/49 and UPC 075020114105).
// Results are only candidates: each is confirmed on its own product page.
export type SearchCandidate = { url: string; title: string; priceCents: number | null; sponsored: boolean };
export type SearchStore = 'amazon' | 'walmart';
const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

function amazonResults(doc: Document): SearchCandidate[] {
  return [...doc.querySelectorAll('[data-component-type="s-search-result"][data-asin]')].flatMap((item) => {
    const asin = item.getAttribute('data-asin') ?? '';
    if (!/^[A-Z0-9]{10}$/.test(asin)) return [];
    const heading = item.querySelector('h2');
    const title = clean(heading?.getAttribute('aria-label') ?? heading?.textContent);
    const sponsored = /^Sponsored\b/i.test(title) || Boolean(item.querySelector('.puis-sponsored-label-text, [aria-label="View Sponsored information or leave ad feedback"]'));
    const price = item.querySelector('.a-price:not(.a-text-price) .a-offscreen');
    return title ? [{ url: `https://www.amazon.com/dp/${asin}`, title: title.replace(/^Sponsored Ad - /i, ''), priceCents: dollarsToCents(clean(price?.textContent)), sponsored }] : [];
  });
}

type WalmartItem = { __typename?: string; usItemId?: string; name?: string; price?: number; canonicalUrl?: string; isSponsoredFlag?: boolean };
function walmartResults(doc: Document): SearchCandidate[] {
  const stacks: { items?: WalmartItem[] }[] = walmartData(doc)?.props?.pageProps?.initialData?.searchResult?.itemStacks ?? [];
  const seen = new Set<string>();
  return stacks.flatMap((stack) => stack.items ?? []).flatMap((item) => {
    if (item.__typename !== 'Product' || !item.usItemId || !item.name || !item.canonicalUrl || seen.has(item.usItemId)) return [];
    const url = cleanProductUrl(new URL(item.canonicalUrl, 'https://www.walmart.com').href);
    if (!url || new URL(url).hostname !== 'www.walmart.com') return [];
    seen.add(item.usItemId);
    return [{ url, title: clean(item.name), priceCents: dollarsToCents(item.price), sponsored: Boolean(item.isSponsoredFlag) }];
  });
}

export function searchResults(store: SearchStore, doc: Document): SearchCandidate[] {
  return (store === 'amazon' ? amazonResults(doc) : walmartResults(doc)).slice(0, 30);
}
