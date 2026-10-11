import { readProduct } from './product-reader';
import { searchResults, type SearchStore } from './search-parsers';
import { parseAmazonOffers } from './amazon-sellers';

// Fetched store HTML is parsed inert (scripts never run in a DOMParser document) and
// only extracted data leaves this module. Chrome's worker has no DOMParser, so it runs
// this in the offscreen document; Firefox's background page has one and calls it directly.
// offersHtml: Amazon's offer list for the same ASIN, for pages with several purchase modes.
export type ParseRequest = { type: 'parse-product' | 'parse-search'; html: string; url: string; store?: SearchStore; offersHtml?: string };
export type ParseReply = { ok: true; data: unknown } | { ok: false; error: string };

export function parseStoreHtml(request: ParseRequest): ParseReply {
  try {
    const doc = new DOMParser().parseFromString(request.html, 'text/html');
    if (request.type === 'parse-product') {
      const offers = typeof request.offersHtml === 'string' ? parseAmazonOffers(new DOMParser().parseFromString(request.offersHtml, 'text/html')) : undefined;
      return { ok: true, data: readProduct({ doc, url: new URL(request.url), live: false, offers }) };
    }
    if (request.type === 'parse-search' && (request.store === 'amazon' || request.store === 'walmart')) return { ok: true, data: searchResults(request.store, doc) };
    return { ok: false, error: 'Unknown request.' };
  } catch { return { ok: false, error: 'Could not parse the page.' }; }
}
