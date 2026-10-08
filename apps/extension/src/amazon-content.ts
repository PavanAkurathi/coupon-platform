import { amazonContentRequestSchema, amazonProductAsin } from '@repo/shared';
import { focusAmazonOffer, inspectAmazonPage } from './amazon-reader';

// Executed only in this extension's isolated world after its action is opened.
// Reopening the popup must not register duplicate listeners.
const scope = globalThis as typeof globalThis & {__couponAmazonReaderV1?: boolean};
if (window === window.top && amazonProductAsin(location.href) && !scope.__couponAmazonReaderV1) {
  scope.__couponAmazonReaderV1 = true;
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !amazonProductAsin(location.href)) return false;
    const request = amazonContentRequestSchema.safeParse(raw);
    if (!request.success) return false;
    try {
      const data = request.data.type === 'amazon-inspect' ? inspectAmazonPage() : focusAmazonOffer(request.data);
      sendResponse({ok:true, data});
    } catch {
      sendResponse({ok:false, error:'The product or coupon changed. Check the page again before using the offer.'});
    }
    return false;
  });
}
