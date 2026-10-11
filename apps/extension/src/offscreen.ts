import { parseStoreHtml, type ParseRequest } from './parse-html';

// Offscreen document (Chrome only): the worker has no DOMParser, so fetched store
// pages are parsed here and only extracted data goes back to the worker.
chrome.runtime.onMessage.addListener((raw: ParseRequest & { target?: string }, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || raw?.target !== 'offscreen' || typeof raw.html !== 'string') return false;
  sendResponse(parseStoreHtml(raw));
  return false;
});
