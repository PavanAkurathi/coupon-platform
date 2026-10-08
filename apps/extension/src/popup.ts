import { formatMoney, popupStatusSchema, trialResponseSchema, type PopupStatus, type Reply, type TrialResult } from "./protocol";
import { confirmedEarningsLine } from "@repo/shared";

function el<T extends HTMLElement>(id: string): T { const node = document.getElementById(id); if (!node) throw new Error(`Missing ${id}`); return node as T; }
const primary = el<HTMLButtonElement>("try-codes");
const testCode = el<HTMLButtonElement>("test-code");
const statusLine = el("status");
let state: PopupStatus | undefined;
let busy = false;
async function request<T>(message: unknown): Promise<T> {
  const reply: Reply<T> = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply && !reply.ok ? reply.error : "The extension did not respond.");
  return reply.data;
}
function status(message: string, error = false) { statusLine.textContent = message; statusLine.classList.toggle("error", error); }
function controls() {
  const unavailable = busy || !state?.supported || !state.checkout || state.completed || state.busy;
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

function renderAmazonMode(inspection: AmazonInspection) {
  el("amazon-panel").hidden = false;
  el("try-codes").hidden = true;
  el("trust-row").hidden = true;
  el("demo-link").hidden = true;
  el("result").hidden = true;
  el("receipt").hidden = true;
  el("code-section").hidden = true;
  el("token-section").hidden = true;
  el("env-pill").textContent = "AMAZON";

  el("store").textContent = "Amazon · product page";

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

function hideAmazonMode() {
  el("amazon-panel").hidden = true;
  el("try-codes").hidden = false;
  el("trust-row").hidden = false;
  el("code-section").hidden = false;
  el("token-section").hidden = false;
  el("env-pill").textContent = "LOCAL DEMO";
  el("headline").replaceChildren(document.createTextNode("Good codes."), document.createElement("br"), document.createTextNode("Better totals."));
  el("description").textContent = "A few careful checks. Every dollar saved stays yours.";
  el("description").hidden = false;
}

async function refresh() {
  state = popupStatusSchema.parse(await request({ type: "status" }));

  if (state.amazon !== undefined) {
    renderAmazonMode(state.amazon);
    return;
  }

  hideAmazonMode();
  el("store").textContent = state.merchantName ? `${state.merchantName} · checkout` : "A little help at checkout";
  el("demo-link").hidden = state.supported;
  el("token-note").textContent = state.hasToken ? "Shopper token saved. Your reports count once per code. Leave blank and save to remove it." : "Add an issued shopper token to help verify codes. Leave blank and save to remove it.";
  if (!state.result) clearResult();
  if (state.result) { showResult(state.result, state.completed); status(state.reportNote ?? "Your best code is ready."); }
  else if (!state.supported) status("Try the local demo checkout or open an Amazon product page.");
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
void refresh().catch((error: unknown) => { status(error instanceof Error ? error.message : "Could not connect to the coupon service.", true); el("demo-link").hidden = false; });
