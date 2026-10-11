import { BUILD_TARGET, DEMO_ORIGIN, formatMoney, popupStatusSchema, trialResponseSchema, type PopupStatus, type Reply, type TrialResult } from "./protocol";
import { confirmedEarningsLine } from "@repo/shared";
import { renderPrice, renderPriceAlerts } from "./price-popup";

function el<T extends HTMLElement>(id: string): T { const node = document.getElementById(id); if (!node) throw new Error(`Missing ${id}`); return node as T; }
const primary = el<HTMLButtonElement>("try-codes");
const testCode = el<HTMLButtonElement>("test-code");
const statusLine = el("status");
// Shopper tokens and shared codes need a token issued by the operator. Store builds leave them out:
// nobody outside the beta can get one, so the fields could never work there.
const COMMUNITY = BUILD_TARGET === "dev";
let state: PopupStatus | undefined;
let busy = false;
async function request<T>(message: unknown): Promise<T> {
  const reply: Reply<T> = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : "The extension did not respond.");
  return reply.data;
}
function status(message: string, error = false) { statusLine.textContent = message; statusLine.classList.toggle("error", error); }
// Demo affordances exist only in dev builds (DEMO_ORIGIN is null in beta), and only on a localhost page.
const demoLink = el<HTMLAnchorElement>("demo-link");
if (DEMO_ORIGIN) demoLink.href = `${DEMO_ORIGIN}/checkout`;
async function onLocalDemoHost(): Promise<boolean> {
  if (!DEMO_ORIGIN) return false;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url ? new URL(tab.url).hostname === new URL(DEMO_ORIGIN).hostname : false;
  } catch { return false; }
}
function controls() {
  const unavailable = busy || !state?.supported || !state.checkout || state.completed || state.busy || Boolean(state?.shopify?.appliedCodes.length);
  primary.disabled = Boolean(unavailable); testCode.disabled = Boolean(unavailable || !state?.hasToken);
  primary.querySelector("span")!.textContent = busy || state?.busy ? "Checking codes…" : "Try codes for me";
}
function clearResult() {
  el("result").hidden = true;
  el("receipt").hidden = true;
  el("headline").replaceChildren(document.createTextNode("Good codes."), document.createElement("br"), document.createTextNode("Better totals."));
  el("description").hidden = false;
}
function showResult(result: TrialResult, completed = false) {
  el("result").hidden = false;
  el("headline").textContent = result.savingsCents > 0 ? "A better total." : "You're all checked.";
  el("description").hidden = true;
  el("saved-amount").textContent = formatMoney(result.savingsCents);
  el("applied-code").textContent = result.appliedCode ? `${result.appliedCode} applied · ${formatMoney(result.totalCents)} total` : "No working discount found this time.";
  el("receipt").hidden = false;
  // No earnings claim is fabricated: cashback settlement is not active in this demo.
  el("receipt").textContent = completed ? `${confirmedEarningsLine({ savingsCents: result.savingsCents, feeCents: 0 })} (Demo)` : `${formatMoney(result.additionalSavingsCents)} more saved. No fee to you.`;
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

function hideAmazonMode(supported: boolean) {
  hideCheckoutMode();
  el("amazon-panel").hidden = true;
  // Trial controls and their verification claims only appear on a supported checkout.
  el("try-codes").hidden = !supported;
  el("trust-row").hidden = !supported;
  el("code-section").hidden = !supported || !COMMUNITY;
  el("token-section").hidden = !COMMUNITY;
  el("env-pill").textContent = "LOCAL DEMO";
  el("env-pill").hidden = !supported || !DEMO_ORIGIN;
  el("headline").replaceChildren(document.createTextNode("Good codes."), document.createElement("br"), document.createTextNode("Better totals."));
  el("description").textContent = "A few careful checks. Every dollar saved stays yours.";
  el("description").hidden = false;
}

async function refresh() {
  state = popupStatusSchema.parse(await request({ type: "status" }));
  const hasPrice = renderPrice(state.price);
  el('hold-save-item').hidden = !state.price?.product;
  renderPriceAlerts(state.priceAlerts, refresh);

  if (state.amazonCheckout !== undefined) {
    renderCheckoutMode(state.amazonCheckout);
    return;
  }
  if (state.amazon !== undefined) {
    renderAmazonMode(state.amazon);
    // A cheaper exact match elsewhere outranks "no coupon here".
    if (state.price?.comparison?.status === "better_offer" && state.amazon.status !== "offers_found") {
      el("headline").textContent = "Wait. It's cheaper elsewhere.";
    }
    return;
  }

  hideAmazonMode(state.supported);
  if (state.shopify) el("env-pill").hidden = true;
  const localDemo = !state.supported && await onLocalDemoHost();
  el("store").textContent = state.merchantName ? `${state.merchantName} · checkout` : "A little help at checkout";
  demoLink.hidden = !localDemo;
  el("token-note").textContent = state.hasToken ? "Shopper token saved. Your reports count once per code. Leave blank and save to remove it." : "Add an issued shopper token to help verify codes. Leave blank and save to remove it.";
  if (!state.result) clearResult();
  if (state.result) { showResult(state.result, state.completed); status(state.reportNote ?? "Your best code is ready."); }
  else if (!state.supported && hasPrice) {
    const better = state.price?.comparison?.status === "better_offer";
    el("headline").textContent = better ? "Wait. It's cheaper elsewhere." : "Price checked.";
    el("description").hidden = true;
    status("");
  }
  else if (!state.supported) {
    el("headline").textContent = "Not supported here yet.";
    el("description").textContent = "Hold didn't find a product on this page.";
    status(localDemo ? "Try the local demo checkout or open an Amazon product page." : "Open a product page to compare its price, or an Amazon.com product page to check coupons.");
  }
  else if (state.shopify?.appliedCodes.length) status(`${state.shopify.appliedCodes.join(", ")} is already applied. We leave existing codes in place.`);
  else if (state.shopify && !state.checkout) status(state.shopify.reason || "Open the checkout and wait for the order summary to load.");
  else if (state.shopify) status(state.shopify.totalIsEstimate ? "We'll try verified codes and keep the best total. Shipping and tax are estimates until you add an address." : "We'll try verified codes and keep the best total.");
  else if (!state.checkout) status("Refresh the checkout page to connect the extension.");
  else if (state.completed) status("This demo order is complete. Start a new cart to test codes.");
  else if (state.busy) status("Testing is running. You can reopen this popup when it finishes.");
  else status("We'll try verified codes and keep the best total.");
  controls();
}
async function run(code?: string) {
  busy = true; clearResult(); controls(); status("Trying codes in your checkout. Please leave your cart as it is.");
  try {
    const response = trialResponseSchema.parse(await request(code ? { type: "try-code", code } : { type: "run" }));
    showResult(response.result); status(response.reportNote);
  } catch (error) { status(error instanceof Error ? error.message : "Could not check codes.", true); }
  finally { busy = false; controls(); }
}
primary.addEventListener("click", () => void run());
el<HTMLFormElement>("code-form").addEventListener("submit", (event) => { event.preventDefault(); void run(el<HTMLInputElement>("code").value.trim()); });
el<HTMLFormElement>("token-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await request({ type: "save-token", token: el<HTMLInputElement>("token").value.trim() });
    el<HTMLInputElement>("token").value = "";
    await refresh(); status(state?.hasToken ? "Shopper token saved." : "Shopper token removed.");
  } catch (error) { status(error instanceof Error ? error.message : "Could not save token.", true); }
});
el<HTMLButtonElement>("amazon-show").addEventListener("click", async () => {
  const btn = el<HTMLButtonElement>("amazon-show");
  const { offerId, fingerprint, observedAt, asin } = btn.dataset;
  if (!offerId || !fingerprint || !observedAt || !asin) return;
  btn.disabled = true;
  status("Opening the coupon control on Amazon…");
  try {
    await request({ type: "amazon-focus", asin, offerId, fingerprint, observedAt });
    window.close();
  } catch (error) {
    status(error instanceof Error ? error.message : "Could not show the coupon control.", true);
    // Keep the stale action disabled until a fresh inspection succeeds.
  }
});
el<HTMLButtonElement>("amazon-refresh").addEventListener("click", async () => {
  const button = el<HTMLButtonElement>("amazon-refresh");
  button.disabled = true;
  el<HTMLButtonElement>("amazon-show").disabled = true;
  status("Checking the visible product coupon…");
  try { await refresh(); }
  catch (error) { status(error instanceof Error ? error.message : "Could not reload.", true); }
  finally { button.disabled = false; }
});
el<HTMLButtonElement>("checkout-refresh").addEventListener("click", async () => {
  const button = el<HTMLButtonElement>("checkout-refresh");
  if (button.disabled) return;
  // Previous amounts are withdrawn until a fresh reading replaces them.
  button.disabled = true;
  checkoutWithoutAmounts("Checking totals.", "Reading Amazon's order summary…");
  try { await refresh(); }
  catch (error) { checkoutWithoutAmounts("Check your order summary.", error instanceof Error ? error.message : "Could not read the order summary.", true); }
  finally { button.disabled = false; }
});
el<HTMLButtonElement>('hold-open-list').addEventListener('click', async () => {
  try { await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') }); }
  catch { el('hold-save-status').textContent = 'Could not open your list. Try again.'; }
});
el<HTMLButtonElement>('hold-save-item').addEventListener('click', async () => {
  const button = el<HTMLButtonElement>('hold-save-item'); button.disabled = true;
  el('hold-save-status').textContent = 'Saving this product…';
  try { await request({ type: 'hold-save-page' }); el('hold-save-status').textContent = 'Saved. Open My Hold list to set a target price.'; }
  catch (error) { el('hold-save-status').textContent = error instanceof Error ? error.message : 'Could not save this item.'; }
  finally { button.disabled = false; }
});
void refresh().catch(async (error: unknown) => {
  status(error instanceof Error ? error.message : "Could not connect to the coupon service.", true);
  demoLink.hidden = !await onLocalDemoHost();
});
