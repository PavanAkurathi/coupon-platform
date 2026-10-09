import { readProduct } from './product-reader';
import { searchResults, type SearchStore } from './search-parsers';
import { parseAmazonOffers } from './amazon-sellers';

// Offscreen document: the worker has no DOMParser. Fetched store HTML is parsed
// inert here (scripts never run in a DOMParser document) and only extracted data
// goes back to the worker.
// offersHtml: Amazon's offer list for the same ASIN; its pinned new offer names the buy box.
type Request = { target: 'offscreen'; type: 'parse-product' | 'parse-search'; html: string; url: string; store?: SearchStore; offersHtml?: string };
function pinnedNewPrice(offersHtml: string | undefined): number | null {
  if (typeof offersHtml !== 'string') return null;
  const pinned = parseAmazonOffers(new DOMParser().parseFromString(offersHtml, 'text/html')).filter((offer) => offer.pinned);
  return pinned.length === 1 && pinned[0]!.condition === 'New' ? pinned[0]!.priceCents : null;
}
chrome.runtime.onMessage.addListener((raw: Request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || raw?.target !== 'offscreen' || typeof raw.html !== 'string') return false;
  try {
    const doc = new DOMParser().parseFromString(raw.html, 'text/html');
    if (raw.type === 'parse-product') sendResponse({ ok: true, data: readProduct({ doc, url: new URL(raw.url), live: false, buyBoxCents: pinnedNewPrice(raw.offersHtml) }) });
    else if (raw.type === 'parse-search' && (raw.store === 'amazon' || raw.store === 'walmart')) sendResponse({ ok: true, data: searchResults(raw.store, doc) });
    else sendResponse({ ok: false, error: 'Unknown request.' });
  } catch { sendResponse({ ok: false, error: 'Could not parse the page.' }); }
  return false;
});
