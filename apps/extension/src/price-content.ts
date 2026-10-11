import { priceComparisonSchema, type PageProduct, type PriceComparison } from '@repo/shared';
import { amazonBuyBox, readProductPage, type ProductRead } from './product-reader';
import { findCheaperSeller, type CheaperSeller } from './amazon-sellers';
import { matchTip, type MatchTip } from './price-match';

// Runs in this extension's isolated world on https pages: injected when the popup
// opens, or registered for every https site once the shopper turns on price alerts.
// It reads the product on the device, asks the extension worker for a comparison,
// and, only for a verified cheaper exact match, shows a banner and pauses the
// shopper's first buy click. It never clicks, submits, navigates or edits the page.

// Purchase controls observed live on October 8, 2026. Other stores get the banner only.
const BUY_CONTROLS: Record<string, string> = {
  'www.amazon.com': '#add-to-cart-button, #buy-now-button, input[name="submit.add-to-cart"], input[name="submit.buy-now"]',
  'www.bestbuy.com': 'button[data-testid^="pdp-add-to-cart-"]',
  'www.ebay.com': '#binBtn_btn_1, #atcBtn_btn_1',
};
const HOST_ID = 'checkout-savings-price-alert';
// What the banner and pause show: a cheaper store, or a cheaper seller on this Amazon page.
type Alert = { savingsCents: number; headline: string; compare: string; meta: string; fine: string; url: string; viewLabel: string; goLabel: string; match?: MatchTip | null };
type State = { url: string; product?: PageProduct; alert?: Alert; paused: boolean; dismissed: boolean };
const scope = globalThis as typeof globalThis & { __checkoutSavingsPriceV1?: boolean };

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function age(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}
const shippingText = (cents: number | null) => cents === 0 ? 'Free shipping' : `+ ${money(cents ?? 0)} shipping`;
function storeAlert(comparison: PriceComparison, product: PageProduct): Alert {
  const offer = comparison.bestOffer!;
  const seen = offer.source === 'seen_by_you' ? `You saw it ${age(offer.observedAt)}` : offer.source === 'live_check' ? `Checked live ${age(offer.observedAt)}` : `Checked ${age(offer.observedAt)}`;
  return {
    savingsCents: comparison.savingsCents, headline: `${money(comparison.savingsCents)} less at ${offer.merchant}`,
    compare: `${money(offer.priceCents + (offer.shippingCents ?? 0))} there vs ${money(comparison.baselineCents!)} here`,
    meta: ['New', shippingText(offer.shippingCents), offer.seller ? `Seller: ${offer.seller}` : null, seen].filter(Boolean).join(' · '),
    fine: 'Same model, new condition. Prices before tax; confirm the total at checkout.',
    url: offer.url, viewLabel: `View on ${offer.merchant} ↗`, goLabel: `Go to ${offer.merchant} ↗`,
    // Prefer buying here? This store may match that price (docs/PRICE-MATCH.md).
    match: matchTip(product, offer),
  };
}
function sellerAlert(found: CheaperSeller, asin: string): Alert {
  const { best, buyBox } = found;
  const rating = best.byAmazon ? null : `${best.stars}★, ${best.ratings!.toLocaleString('en-US')} ratings`;
  return {
    savingsCents: found.savingsCents, headline: `${money(found.savingsCents)} less from another seller on Amazon`,
    compare: `${money(best.priceCents! + best.shippingCents!)} vs ${money(buyBox.priceCents! + (buyBox.shippingCents ?? 0))} for the main offer`,
    meta: ['New', shippingText(best.shippingCents), `Seller: ${best.seller}${rating ? ` (${rating})` : ''}`, 'Checked live just now'].join(' · '),
    fine: 'Same Amazon product. Choose this seller under "Other sellers" before adding to cart. Prices before tax.',
    url: `https://www.amazon.com/dp/${asin}?aod=1`, viewLabel: 'See all sellers ↗', goLabel: 'Show me this seller ↗',
  };
}

if (window === window.top && location.protocol === 'https:' && !scope.__checkoutSavingsPriceV1) {
  scope.__checkoutSavingsPriceV1 = true;
  const state: State = { url: location.href, paused: false, dismissed: false };
  let root: ShadowRoot | null = null;

  const removeUi = () => { document.getElementById(HOST_ID)?.remove(); root = null; };
  function ui(): ShadowRoot {
    if (root?.host.isConnected) return root;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:16px;right:16px;';
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .card{width:340px;background:#fffdf8;color:#243d35;border:1px solid #d6ddcf;border-left:5px solid #c2410c;border-radius:10px;box-shadow:0 10px 30px #0003;padding:14px 16px}
      .eyebrow{font-size:11px;font-weight:700;letter-spacing:.6px;color:#c2410c;text-transform:uppercase;margin:0 0 6px}
      .big{font-size:20px;font-weight:700;margin:0 0 4px}.meta{font-size:12px;color:#5b6b60;margin:0 0 4px;line-height:1.45}
      .fine{font-size:11px;color:#7a8475;margin:6px 0 10px}.row{display:flex;gap:8px;flex-wrap:wrap}
      a,button{font-size:13px;font-weight:600;border-radius:7px;padding:9px 12px;cursor:pointer;text-decoration:none;border:1px solid #245849}
      a{background:#245849;color:#fff}button{background:transparent;color:#245849}
      .modal{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(20,28,24,.55);display:grid;place-items:center}
      .modal .card{width:380px;border-left-width:5px}
      .match{font-size:12px;line-height:1.45;color:#243d35;background:#f3efe6;border-radius:7px;padding:8px 10px;margin:0 0 10px}
      .match a{display:inline;background:none;border:0;padding:0;border-radius:0;color:#245849;font-size:12px;font-weight:600;text-decoration:underline}`;
    root.append(style);
    document.documentElement.append(host);
    return root;
  }
  function offerLink(alert: Alert, label: string): HTMLAnchorElement {
    const link = document.createElement('a');
    link.href = alert.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = label;
    return link;
  }
  function card(eyebrow: string, alert: Alert): HTMLDivElement {
    const box = document.createElement('div'); box.className = 'card'; box.setAttribute('role', 'alert');
    const lines: [string, string][] = [
      ['eyebrow', eyebrow], ['big', alert.headline], ['meta', alert.compare], ['meta', alert.meta], ['fine', alert.fine],
    ];
    for (const [className, text] of lines) { const p = document.createElement('p'); p.className = className; p.textContent = text; box.append(p); }
    if (alert.match) {
      const tip = document.createElement('p'); tip.className = 'match';
      const policy = document.createElement('a');
      policy.href = alert.match.url; policy.target = '_blank'; policy.rel = 'noopener noreferrer'; policy.textContent = alert.match.checked;
      tip.append(`${alert.match.text} `, policy);
      box.append(tip);
    }
    return box;
  }
  function showBanner(alert: Alert) {
    if (state.dismissed) return;
    const shadow = ui();
    shadow.querySelector('.banner')?.remove();
    const box = card(alert.viewLabel.startsWith('See all sellers') ? 'Cheaper seller on Amazon' : 'Cheaper elsewhere', alert);
    box.classList.add('banner');
    const row = document.createElement('div'); row.className = 'row';
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => { state.dismissed = true; box.remove(); });
    row.append(offerLink(alert, alert.viewLabel), dismiss);
    box.append(row);
    shadow.append(box);
  }
  function showPause(alert: Alert) {
    const shadow = ui();
    const modal = document.createElement('div'); modal.className = 'modal';
    const box = card('Hold on before you buy', alert);
    const row = document.createElement('div'); row.className = 'row';
    const stay = document.createElement('button'); stay.type = 'button'; stay.textContent = 'Buy here anyway';
    stay.addEventListener('click', () => { modal.remove(); });
    const note = document.createElement('p'); note.className = 'fine';
    note.textContent = 'Buying here? Close this and click your button again.';
    row.append(offerLink(alert, alert.goLabel), stay);
    box.append(row, note);
    modal.append(box);
    modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
    shadow.append(modal);
    stay.focus();
  }
  // The first purchase click on a page with a verified cheaper offer is held once.
  // We do not re-send it: the shopper clicks again to continue here.
  window.addEventListener('click', (event) => {
    const selector = BUY_CONTROLS[location.hostname];
    const alert = state.alert;
    if (!selector || state.paused || state.url !== location.href || !alert) return;
    const target = event.target instanceof Element ? event.target.closest(selector) : null;
    if (!target) return;
    event.preventDefault(); event.stopImmediatePropagation();
    state.paused = true;
    showPause(alert);
  }, true);

  async function storeCheck(product: PageProduct): Promise<Alert | null> {
    try {
      const reply: { ok: boolean; data?: unknown } | undefined = await chrome.runtime.sendMessage({ type: 'price-seen', product });
      const parsed = priceComparisonSchema.safeParse(reply?.ok ? reply.data : null);
      return parsed.success && parsed.data.status === 'better_offer' ? storeAlert(parsed.data, product) : null;
    } catch { return null; }
  }
  async function check(read: ProductRead) {
    const url = location.href;
    // On Amazon, other sellers of the same item are checked alongside other stores;
    // that needs only the buy box, not a model code.
    const buyBox = location.hostname === 'www.amazon.com' ? amazonBuyBox() : null;
    if (read.status !== 'product' && !buyBox) return;
    if (read.status === 'product') state.product = read.product;
    const [store, seller] = await Promise.all([
      read.status === 'product' ? storeCheck(read.product) : Promise.resolve(null),
      buyBox ? findCheaperSeller(buyBox.asin, buyBox.priceCents).then((found) => found ? sellerAlert(found, buyBox.asin) : null) : Promise.resolve(null),
    ]);
    if (state.url !== url) return;
    const best = [store, seller].filter((alert): alert is Alert => alert !== null).sort((a, b) => b.savingsCents - a.savingsCents)[0];
    state.alert = best;
    if (best) showBanner(best); else removeUi();
  }
  async function scan() {
    let read = readProductPage();
    // Product details often finish rendering after document_idle.
    if (read.status === 'unrecognized') { await new Promise((resolve) => setTimeout(resolve, 2500)); read = readProductPage(); }
    if (state.url === location.href) await check(read);
  }

  chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    const type = (raw as { type?: unknown } | null)?.type;
    if (type === 'price-read') { sendResponse({ ok: true, data: readProductPage() }); return false; }
    return false;
  });
  // Single-page stores change products without a page load.
  setInterval(() => {
    if (state.url === location.href) return;
    Object.assign(state, { url: location.href, product: undefined, alert: undefined, paused: false, dismissed: false });
    removeUi();
    setTimeout(() => { void scan(); }, 1500);
  }, 1000);
  void scan();
}
