import { amazonContentRequestSchema, amazonProductAsin, isAmazonCheckout } from '@repo/shared';
import { focusAmazonOffer, inspectAmazonPage } from './amazon-reader';
import { inspectAmazonCheckout } from './amazon-checkout-reader';

// Executed only in this extension's isolated world after its action is opened.
// Reopening the popup must not register duplicate listeners.
const scope = globalThis as typeof globalThis & {__couponAmazonReaderV1?: boolean};
const supportedRoute = () => Boolean(amazonProductAsin(location.href)) || isAmazonCheckout(location.href);
if (window === window.top && supportedRoute() && !scope.__couponAmazonReaderV1) {
  scope.__couponAmazonReaderV1 = true;
  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    const request = amazonContentRequestSchema.safeParse(raw);
    if (!request.success) return false;
    // Each request re-checks its own route: same-document navigation must not
    // let a product action run on checkout, or a checkout read on a product page.
    const checkout = request.data.type === 'amazon-checkout-inspect';
    if (checkout ? !isAmazonCheckout(location.href) : !amazonProductAsin(location.href)) return false;
    try {
      const data = request.data.type === 'amazon-checkout-inspect' ? inspectAmazonCheckout()
        : request.data.type === 'amazon-inspect' ? inspectAmazonPage() : focusAmazonOffer(request.data);
      sendResponse({ok:true, data});
    } catch {
      sendResponse({ok:false, error:'The product or coupon changed. Check the page again before using the offer.'});
    }
    return false;
  });
}
