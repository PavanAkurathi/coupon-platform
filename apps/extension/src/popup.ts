import { BUILD_TARGET, DEMO_ORIGIN, PRODUCT_NAME, couponCandidatesSchema, formatMoney, pagePricesSchema, popupStatusSchema, surfaceRequestSchema, trialResponseSchema, type CouponCandidates, type PopupStatus, type Reply, type TrialResult } from './protocol';
import { eligibleCandidates, sameBinding, trialDisplay, type PageBinding } from './coupon-view';
import { renderPrice, renderPriceAlerts } from './price-popup';
import type { z } from 'zod';

type SurfaceAction = z.infer<typeof surfaceRequestSchema>['request'];
type Context = { generation: number; binding: PageBinding };
function el<T extends HTMLElement>(id: string): T { const node = document.getElementById(id); if (!node) throw new Error(`Missing ${id}`); return node as T; }
const primary = el<HTMLButtonElement>('try-codes');
const testCode = el<HTMLButtonElement>('test-code');
const statusLine = el('status');
const demoLink = el<HTMLAnchorElement>('demo-link');
const COMMUNITY = BUILD_TARGET === 'dev';
const SIDE_PANEL = document.documentElement.dataset.surface === 'sidepanel' || document.body.dataset.surface === 'sidepanel';
let state: PopupStatus | undefined;
let candidates: CouponCandidates | undefined;
let binding: PageBinding | undefined;
let watchedTabId: number | undefined;
let generation = 0;
let busy = false;
let fetching = false;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
class StaleSurface extends Error {}

document.title = PRODUCT_NAME;
document.querySelectorAll<HTMLElement>('[data-product-name]').forEach((node) => { node.textContent = PRODUCT_NAME; });
if (DEMO_ORIGIN) demoLink.href = `${DEMO_ORIGIN}/checkout`;
function status(message: string, error = false) { statusLine.textContent = message; statusLine.classList.toggle('error', error); }
function currentContext(): Context | undefined { return binding ? { generation, binding: { ...binding } } : undefined; }
function isCurrent(context: Context): boolean { return generation === context.generation; }
function running(show: boolean, message = 'Checking this page…') {
  el('running').hidden = !show;
  el('running-text').textContent = message;
  el('surface').setAttribute('aria-busy', String(show));
}
function controls() {
  const unavailable = fetching || busy || !binding || !state?.supported || !state.checkout || state.completed || state.busy || Boolean(state.shopify);
  const count = eligibleCandidates(candidates?.candidates ?? []).length;
  primary.disabled = Boolean(unavailable || !candidates?.canTest || count === 0);
  testCode.disabled = Boolean(unavailable || !state?.hasToken || !COMMUNITY);
  primary.querySelector('span')!.textContent = busy || state?.busy ? 'Checking codes…' : count ? `Try ${count} ${count === 1 ? 'code' : 'codes'}` : 'No reviewed codes yet';
  el<HTMLButtonElement>('hold-save-item').disabled = fetching || busy || !binding;
  el<HTMLButtonElement>('amazon-refresh').disabled = fetching || busy;
  el<HTMLButtonElement>('checkout-refresh').disabled = fetching || busy;
  el<HTMLButtonElement>('page-refresh').disabled = fetching || busy;
  const tokenButton = el<HTMLFormElement>('token-form').querySelector<HTMLButtonElement>('button')!;
  tokenButton.disabled = fetching || busy || !binding;
  el<HTMLInputElement>('code').disabled = Boolean(unavailable || !COMMUNITY);
}
function clearResult() {
  el('result').hidden = true; el('receipt').hidden = true; el('attempt-panel').hidden = true;
  el('saved-amount').textContent = ''; el('applied-code').textContent = ''; el('receipt').textContent = '';
  el('attempt-list').replaceChildren();
}
function invalidate(message = 'Checking this checkout…'): number {
  generation++;
  clearTimeout(expiryTimer);
  binding = undefined; state = undefined; candidates = undefined; busy = false; fetching = true;
  for (const id of ['amazon-panel','amazon-checkout-panel','coupon-panel','trust-row','try-codes','code-section','token-section','env-pill','page-refresh','hold-save-item','price-alerts']) el(id).hidden = true;
  clearResult(); clearCheckoutAmounts(); renderPrice(undefined);
  el<HTMLDetailsElement>('price-panel').open = false;
  el<HTMLDetailsElement>('attempt-panel').open = false;
  el('amazon-offers').replaceChildren(); el('amazon-product').textContent = '';
  el('coupon-list').replaceChildren(); el('coupon-note').textContent = ''; el('coupon-count').hidden = true;
  const show = el<HTMLButtonElement>('amazon-show');
  show.hidden = true; show.disabled = true;
  for (const key of Object.keys(show.dataset)) delete show.dataset[key];
  el('hold-save-status').textContent = ''; demoLink.hidden = true;
  el('headline').textContent = 'Checking this page.';
  el('description').hidden = false; el('description').textContent = 'Reading the current page before showing any offers.';
  el('store').textContent = 'Coupons, with a little care';
  status(message); running(true); controls();
  return generation;
}
async function activeBinding(): Promise<PageBinding> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url) throw new Error('Open a store page, then check again.');
  if (tab.status === 'loading') throw new Error('This page is still loading. Check again once it is ready.');
  return { tabId: tab.id, url: tab.url };
}
async function stillOnPage(context: Context): Promise<boolean> {
  if (!isCurrent(context)) return false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isCurrent(context)) return false;
  if (!sameBinding(context.binding, tab)) {
    // Clear immediately even if a tab event was not delivered to this surface.
    invalidate('The page changed. Checking the current page…');
    void refresh();
    return false;
  }
  return true;
}
async function request<T>(context: Context, action: SurfaceAction): Promise<T> {
  if (!isCurrent(context)) throw new StaleSurface();
  const message = surfaceRequestSchema.parse({ type: 'surface-request', ...context.binding, request: action });
  const reply: Reply<T> = await chrome.runtime.sendMessage(message);
  if (!await stillOnPage(context)) throw new StaleSurface();
  if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : 'The extension did not respond.');
  return reply.data;
}
function showResult(result: TrialResult, completed = false) {
  const display = trialDisplay(result);
  el('result').hidden = false; el('description').hidden = true;
  el('headline').textContent = display.headline;
  el('saved-amount').textContent = formatMoney(display.additionalSavingsCents);
  el('applied-code').textContent = result.appliedCode
    ? `${result.appliedCode} applied · ${formatMoney(display.discountCents)} coupon discount · ${formatMoney(display.totalCents)} total`
    : `No code applied · ${formatMoney(display.totalCents)} total`;
  el('receipt').hidden = false;
  el('receipt').textContent = `${formatMoney(display.additionalSavingsCents)} more saved than your starting total. No fee to you. No commission claimed.${completed ? ' Demo order completed.' : ''}`;
  const attempts = el('attempt-list'); attempts.replaceChildren();
  for (const attempt of result.attempts) {
    const row = document.createElement('li'); row.className = 'attempt-row';
    const name = document.createElement('span'); name.className = 'coupon-code'; name.textContent = attempt.code;
    const outcome = document.createElement('span'); outcome.className = `attempt-result${attempt.outcome === 'success' ? ' success' : ''}`;
    outcome.textContent = attempt.outcome === 'success' ? `${formatMoney(attempt.savingsCents)} cart discount` : 'No discount confirmed';
    row.append(name, outcome); attempts.append(row);
  }
  el('attempt-panel').hidden = result.attempts.length === 0;
}
type AmazonInspection = NonNullable<PopupStatus["amazon"]>;
type AmazonCheckoutInspection = NonNullable<PopupStatus["amazonCheckout"]>;

function clearCheckoutAmounts() {
  el("checkout-summary").hidden = true;
  el("checkout-savings-row").hidden = true;
  el("checkout-total-row").hidden = true;
  el("checkout-savings").textContent = "";
  el("checkout-total").textContent = "";
}
function hideCheckoutMode() {
  el("amazon-checkout-panel").hidden = true;
  clearCheckoutAmounts();
}
// Any state without a fresh, readable summary shows no amounts at all.
function checkoutWithoutAmounts(headline: string, message: string, error = false) {
  clearCheckoutAmounts();
  el("headline").textContent = headline;
  el("description").textContent = "No amounts are shown until Amazon's order summary can be read.";
  el("description").hidden = false;
  status(message, error);
}

// Amazon's own order summary, read-only. Not a placed order, earned commission
// or proof that this extension found the coupon.
function renderCheckoutMode(inspection: AmazonCheckoutInspection) {
  el("amazon-panel").hidden = true;
  el<HTMLButtonElement>("amazon-show").disabled = true;
  el("amazon-checkout-panel").hidden = false;
  el("try-codes").hidden = true;
  el("trust-row").hidden = true;
  el("demo-link").hidden = true;
  el("result").hidden = true;
  el("receipt").hidden = true;
  el("code-section").hidden = true;
  el("token-section").hidden = true;
  primary.disabled = true; testCode.disabled = true;
  el("env-pill").textContent = "AMAZON";
  el("env-pill").hidden = false;
  el("store").textContent = "Amazon · checkout review";

  const { couponSavingsCents: savings, orderTotalCents: total } = inspection;
  if (inspection.status !== "review_ready" || savings === null || total === null) {
    checkoutWithoutAmounts("Check your order summary.", inspection.reason || "Could not read the Amazon order summary.");
    return;
  }
  clearCheckoutAmounts();
  el("checkout-summary").hidden = false;
  el("checkout-total").textContent = formatMoney(total);
  el("checkout-total-row").hidden = false;
  if (savings > 0) {
    el("checkout-savings").textContent = formatMoney(savings);
    el("checkout-savings-row").hidden = false;
  }
  el("headline").textContent = savings > 0 ? "Coupon applied at checkout." : "No coupon discount shown.";
  el("description").textContent = savings > 0
    ? "Read from Amazon's order summary. Review it there before you place your order."
    : "Amazon's order summary doesn't list a coupon discount for this order.";
  el("description").hidden = false;
  const checkedAt = new Date(inspection.observedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  status(`Checked at ${checkedAt}. Totals can change before you order.`);
}

function renderAmazonMode(inspection: AmazonInspection) {
  hideCheckoutMode();
  el("amazon-panel").hidden = false;
  el("try-codes").hidden = true;
  el("trust-row").hidden = true;
  el("demo-link").hidden = true;
  el("result").hidden = true;
  el("receipt").hidden = true;
  el("code-section").hidden = true;
  el("token-section").hidden = true;
  el("env-pill").textContent = "AMAZON";
  el("env-pill").hidden = false;

  el("store").textContent = inspection.asin ? "Amazon · product page" : "Amazon";

  const titleEl = el("amazon-product");
  titleEl.textContent = inspection.productTitle || "";

  const offersEl = el("amazon-offers");
  offersEl.replaceChildren();
  for (const offer of inspection.offers) {
    const card = document.createElement("div");
    card.className = "amazon-offer" + (offer.state === "already_selected" ? " amazon-offer--selected" : "");

    const labelEl = document.createElement("p");
    labelEl.className = "amazon-offer-label";
    labelEl.textContent = offer.advertisedPriceCents !== null ? "Coupon price" : offer.label;
    card.appendChild(labelEl);

    if (offer.advertisedPriceCents !== null) {
      const priceEl = document.createElement("p");
      priceEl.className = "amazon-offer-price";
      priceEl.textContent = formatMoney(offer.advertisedPriceCents);
      card.appendChild(priceEl);
    }

    const metaParts: string[] = [];
    if (offer.state === "already_selected") metaParts.push("Selected on Amazon");
    else if (offer.state === "unavailable") metaParts.push("Unavailable");
    if (offer.purchaseRequirement === "subscription") metaParts.push("Subscribe & Save");
    else if (offer.purchaseRequirement === "prime") metaParts.push("Prime required");
    if (metaParts.length) {
      const metaEl = document.createElement("p");
      metaEl.className = "amazon-offer-meta";
      metaEl.textContent = metaParts.join(" · ");
      card.appendChild(metaEl);
    }

    for (const term of offer.terms) {
      const termEl = document.createElement("p");
      termEl.className = "amazon-offer-term";
      termEl.textContent = term;
      card.appendChild(termEl);
    }

    offersEl.appendChild(card);
  }

  const available = inspection.offers.filter((o) => o.state === "available");
  const alreadySelected = inspection.offers.filter((o) => o.state === "already_selected");

  const showBtn = el<HTMLButtonElement>("amazon-show");
  if (available.length > 0) {
    showBtn.hidden = false;
    showBtn.disabled = false;
    showBtn.dataset.offerId = available[0]!.id;
    showBtn.dataset.fingerprint = inspection.fingerprint;
    showBtn.dataset.observedAt = inspection.observedAt;
    showBtn.dataset.asin = inspection.asin ?? "";
  } else {
    showBtn.hidden = true;
  }

  el<HTMLButtonElement>("amazon-refresh").classList.toggle("primary", available.length === 0);
  el<HTMLButtonElement>("amazon-refresh").classList.toggle("subtle", available.length > 0);
  el("headline").textContent = inspection.status === "offers_found" ? "Coupon spotted." : inspection.status === "unavailable" ? "Check this product." : "No visible coupon.";
  el("description").textContent = inspection.status === "offers_found"
    ? "Amazon shows a coupon on this product. Confirm eligibility and the final total at checkout."
    : inspection.reason || "No coupon is available on this product right now.";
  el("description").hidden = false;

  if (inspection.status === "unavailable") {
    status(inspection.reason);
  } else if (alreadySelected.length > 0 && available.length === 0) {
    status("A coupon is selected on Amazon. Confirm the discount at checkout.");
  } else if (available.length > 0) {
    status("Native coupon available. Eligibility not confirmed.");
  } else {
    status(inspection.status === "offers_found" ? "This coupon cannot currently be selected." : "No supported visible coupon detected.");
  }
}

function renderCandidates(data: CouponCandidates) {
  candidates = { ...data, candidates: eligibleCandidates(data.candidates) };
  const list = el('coupon-list'); list.replaceChildren();
  const count = candidates.candidates.length;
  el('coupon-count').textContent = String(count); el('coupon-count').hidden = count === 0;
  el('coupon-heading').textContent = count ? `${count} reviewed ${count === 1 ? 'code' : 'codes'}` : 'No reviewed codes yet';
  el('coupon-note').textContent = data.reason || (count ? 'Previous success does not guarantee a discount on this cart.' : 'We have no currently approved codes to suggest for this store.');
  for (const candidate of candidates.candidates) {
    const row = document.createElement('li'); row.className = 'coupon-row';
    const code = document.createElement('span'); code.className = 'coupon-code'; code.textContent = candidate.code;
    const evidence = document.createElement('span'); evidence.className = 'coupon-evidence';
    const confirmed = document.createElement('span'); confirmed.textContent = `${candidate.confirmations} shopper confirmations`;
    const recent = document.createElement('span'); recent.textContent = `Last success ${new Date(candidate.lastConfirmedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    const expires = document.createElement('span'); expires.textContent = candidate.expiresAt
      ? `Expires ${new Date(candidate.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'No published expiry';
    evidence.append(confirmed, recent, expires); row.append(code, evidence); list.append(row);
  }
  el('trust-row').hidden = count === 0;
  primary.hidden = false;
  if (!state?.result && !state?.busy && !state?.shopify) {
    el('headline').textContent = count ? data.canTest ? 'A code worth checking.' : 'Code testing is not available.' : 'No reviewed codes yet.';
    el('description').textContent = count
      ? data.canTest ? 'We test only approved codes, then compare with the total you started with.' : data.reason || 'These codes cannot be tested in this checkout right now.'
      : 'No guesses. We’ll show codes here when their review and recent evidence are in place.';
  }
  controls();
}
function renderStandard(context: Context) {
  if (!state) return;
  const localDemo = Boolean(DEMO_ORIGIN && new URL(context.binding.url).origin === DEMO_ORIGIN);
  el('store').textContent = state.merchantName ? `${state.merchantName} · checkout` : 'Coupons, with a little care';
  el('env-pill').textContent = 'Local demo'; el('env-pill').hidden = !localDemo;
  demoLink.hidden = !localDemo || state.supported;
  el('code-section').hidden = !COMMUNITY || !state.supported || Boolean(state.shopify);
  el('token-section').hidden = !COMMUNITY || !state.supported || Boolean(state.shopify);
  el('token-note').textContent = state.hasToken ? 'Shopper token saved. Your reports count once per code. Leave blank and save to remove it.' : 'Add an issued shopper token to help verify codes. Leave blank and save to remove it.';
  el('page-refresh').hidden = false;
  if (state.supported) {
    el('coupon-panel').hidden = false;
    el('coupon-heading').textContent = 'Checking reviewed codes…';
    el('coupon-note').textContent = 'Looking for public codes with current approval and shopper evidence.';
    if (state.result) { showResult(state.result, state.completed); status(state.reportNote ?? 'Test complete. Review the total at checkout.'); }
    else if (state.busy) { el('headline').textContent = 'Checking codes…'; status('Testing is running. Leave your cart unchanged. Check this page again after it finishes.'); }
    else if (state.shopify) {
      el('headline').textContent = 'Coupon testing is not available yet.';
      el('description').textContent = 'This checkout can be inspected, but automatic code trials are not enabled.';
      status(state.shopify.appliedCodes.length ? `${state.shopify.appliedCodes.join(', ')} is already applied. We leave existing codes in place.` : 'You can review the store’s own offers and confirm the final total there.');
    } else if (!state.checkout) status('Refresh the checkout page to connect the extension.');
    else if (state.completed) status('This demo order is complete. Start a new cart to test codes.');
    else status('Your starting total includes any existing discount. Eligibility is checked before a code is tried.');
  } else {
    el('headline').textContent = 'Not supported here yet.';
    el('description').textContent = state.price?.product ? 'Coupon testing is not available for this store. A separate price check may be available below.' : `${PRODUCT_NAME} didn’t find a supported coupon flow on this page.`;
    status(localDemo ? 'Try the local demo checkout or open an Amazon product page.' : 'Open an Amazon.com product page to check visible coupons, or its order review page to inspect coupon savings.');
  }
}
function scheduleExpiry(context: Context) {
  const observed = state?.amazonCheckout?.observedAt ?? state?.amazon?.observedAt;
  const lifetime = state?.amazonCheckout ? 60_000 : 120_000;
  if (!observed) return;
  expiryTimer = setTimeout(() => {
    if (!isCurrent(context)) return;
    invalidate('This reading is out of date. Check the page again.');
    fetching = false; running(false); controls();
    el('headline').textContent = 'Time for a fresh check.';
    el('description').textContent = 'Old amounts and coupon actions stay hidden until the current page is checked again.';
    el('page-refresh').hidden = false;
  }, Math.max(0, Date.parse(observed) + lifetime - Date.now()));
}
async function refreshPrices(context: Context) {
  try {
    const prices = pagePricesSchema.parse(await request(context, { type: 'page-prices' }));
    if (!isCurrent(context) || !state) return;
    state = { ...state, ...prices };
    renderPrice(prices.price);
    el('hold-save-item').hidden = !prices.price?.product;
    renderPriceAlerts(prices.priceAlerts, async () => { if (isCurrent(context)) await refresh(); },
      (enabled) => request(context, { type: 'price-alerts', enabled }), () => isCurrent(context));
    controls();
  } catch (error) {
    if (error instanceof StaleSurface || !isCurrent(context)) return;
    renderPrice({ product: null, comparison: null, reason: 'Price comparison is unavailable right now. Coupon checks are separate.' });
  }
}
async function refresh() {
  const currentGeneration = invalidate();
  try {
    const page = await activeBinding();
    if (generation !== currentGeneration) return;
    watchedTabId = page.tabId;
    const context: Context = { generation: currentGeneration, binding: page };
    const next = popupStatusSchema.parse(await request(context, { type: 'status' }));
    if (!isCurrent(context)) return;
    state = next; binding = page; fetching = false;
    if (state.amazonCheckout !== undefined) renderCheckoutMode(state.amazonCheckout);
    else if (state.amazon !== undefined) renderAmazonMode(state.amazon);
    else renderStandard(context);
    controls(); running(Boolean(state.busy), 'Checking codes in your checkout…');
    scheduleExpiry(context);
    // Price sources can be slow. They never delay or replace the coupon result.
    if (!state.amazonCheckout) void refreshPrices(context);
    if (state.supported) {
      try {
        const found = couponCandidatesSchema.parse(await request(context, { type: 'coupon-candidates' }));
        if (!isCurrent(context)) return;
        renderCandidates(found);
      } catch (error) {
        if (error instanceof StaleSurface || !isCurrent(context)) return;
        candidates = undefined;
        el('coupon-heading').textContent = 'Codes could not be checked.';
        el('coupon-note').textContent = error instanceof Error ? error.message : 'The coupon service is unavailable. Please try again.';
        primary.hidden = false; controls();
      }
    }
  } catch (error) {
    if (error instanceof StaleSurface || currentGeneration !== generation) return;
    fetching = false; running(false); controls();
    el('headline').textContent = 'Check this page again.';
    el('description').textContent = 'No coupon or savings claim is shown without a current reading.';
    el('page-refresh').hidden = false;
    status(error instanceof Error ? error.message : 'Could not connect to the coupon service.', true);
  }
}
async function run(code?: string) {
  const context = currentContext();
  if (!context || (code ? testCode.disabled : primary.disabled)) return;
  busy = true; clearResult(); controls(); running(true, 'Checking codes in your checkout…');
  el('headline').textContent = 'Checking codes…'; el('description').hidden = false;
  el('description').textContent = 'Leave this cart unchanged while the check runs.';
  status('Trying codes in your checkout. Please leave your cart as it is.');
  try {
    const response = trialResponseSchema.parse(await request(context, code ? { type: 'try-code', code } : { type: 'run' }));
    if (!isCurrent(context)) return;
    state = state ? { ...state, result: response.result, totalCents: response.result.totalCents, appliedCode: response.result.appliedCode, busy: false } : state;
    showResult(response.result); status(response.reportNote);
  } catch (error) {
    if (error instanceof StaleSurface || !isCurrent(context)) return;
    clearResult(); el('headline').textContent = 'Review your checkout.';
    el('description').hidden = false; el('description').textContent = 'We could not confirm the result. Check the code and total on the store before continuing.';
    status(error instanceof Error ? error.message : 'Could not check codes.', true);
  } finally { if (isCurrent(context)) { busy = false; running(false); controls(); } }
}
primary.addEventListener('click', () => void run());
el<HTMLFormElement>('code-form').addEventListener('submit', (event) => { event.preventDefault(); void run(el<HTMLInputElement>('code').value.trim()); });
el<HTMLFormElement>('token-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const context = currentContext(); if (!context || busy || fetching) return;
  const token = el<HTMLInputElement>('token').value.trim();
  busy = true; controls();
  try {
    await request(context, { type: 'save-token', token });
    if (!isCurrent(context)) return;
    el<HTMLInputElement>('token').value = '';
    await refresh();
  } catch (error) { if (!(error instanceof StaleSurface) && isCurrent(context)) status(error instanceof Error ? error.message : 'Could not save token.', true); }
  finally { if (isCurrent(context)) { busy = false; controls(); } }
});
el<HTMLButtonElement>('amazon-show').addEventListener('click', async () => {
  const context = currentContext(); const button = el<HTMLButtonElement>('amazon-show');
  const { offerId, fingerprint, observedAt, asin } = button.dataset;
  if (!context || button.disabled || !offerId || !fingerprint || !observedAt || !asin) return;
  button.disabled = true; status('Opening the coupon control on Amazon…');
  try {
    await request(context, { type: 'amazon-focus', asin, offerId, fingerprint, observedAt });
    if (!isCurrent(context)) return;
    if (!SIDE_PANEL) window.close();
    else status('Coupon control highlighted on Amazon. Select it there if you want it, then confirm your total at checkout.');
  } catch (error) { if (!(error instanceof StaleSurface) && isCurrent(context)) status(error instanceof Error ? error.message : 'Could not show the coupon control.', true); }
});
for (const id of ['amazon-refresh','checkout-refresh','page-refresh']) el<HTMLButtonElement>(id).addEventListener('click', () => void refresh());
el<HTMLButtonElement>('hold-open-list').addEventListener('click', async () => {
  try { await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') }); }
  catch { el('hold-save-status').textContent = 'Could not open your list. Try again.'; }
});
el<HTMLButtonElement>('hold-save-item').addEventListener('click', async () => {
  const context = currentContext(); const button = el<HTMLButtonElement>('hold-save-item');
  if (!context || button.disabled) return;
  button.disabled = true; el('hold-save-status').textContent = 'Saving this product…';
  try {
    await request(context, { type: 'hold-save-page' });
    if (isCurrent(context)) el('hold-save-status').textContent = 'Saved. Open My saved list to set a target price.';
  } catch (error) { if (!(error instanceof StaleSurface) && isCurrent(context)) el('hold-save-status').textContent = error instanceof Error ? error.message : 'Could not save this item.'; }
  finally { if (isCurrent(context)) button.disabled = false; }
});
// Persistent panels must withdraw the previous page's actions before any async read.
chrome.tabs.onActivated.addListener(({ tabId }) => { watchedTabId = tabId; void refresh(); });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tabId !== watchedTabId) return;
  if (change.status === 'loading' || change.url) invalidate('The page changed. Waiting for the current page…');
  if (change.status === 'complete' || (change.url && tab.status !== 'loading')) void refresh();
});
chrome.tabs.onRemoved.addListener((tabId) => { if (tabId === watchedTabId) { invalidate('The tab closed. Open a store page to check coupons.'); void refresh(); } });
window.addEventListener('focus', () => { const context = currentContext(); if (context) void stillOnPage(context).catch(() => undefined); });
void refresh();
