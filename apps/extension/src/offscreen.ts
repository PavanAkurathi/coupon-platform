import { readProduct } from './product-reader';
import { searchResults, type SearchStore } from './search-parsers';

// Offscreen document: the worker has no DOMParser. Fetched store HTML is parsed
// inert here (scripts never run in a DOMParser document) and only extracted data
// goes back to the worker.
type Request = { target: 'offscreen'; type: 'parse-product' | 'parse-search'; html: string; url: string; store?: SearchStore };
chrome.runtime.onMessage.addListener((raw: Request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || raw?.target !== 'offscreen' || typeof raw.html !== 'string') return false;
  try {
    const doc = new DOMParser().parseFromString(raw.html, 'text/html');
    if (raw.type === 'parse-product') sendResponse({ ok: true, data: readProduct({ doc, url: new URL(raw.url), live: false }) });
    else if (raw.type === 'parse-search' && (raw.store === 'amazon' || raw.store === 'walmart')) sendResponse({ ok: true, data: searchResults(raw.store, doc) });
    else sendResponse({ ok: false, error: 'Unknown request.' });
  } catch { sendResponse({ ok: false, error: 'Could not parse the page.' }); }
  return false;
});
