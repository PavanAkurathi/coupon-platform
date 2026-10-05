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
  el("headline").textContent = result.savingsCents > 0 ? "A better total." : "You’re all checked.";
  el("description").hidden = true;
  el("saved-amount").textContent = formatMoney(result.savingsCents);
  el("applied-code").textContent = result.appliedCode ? `${result.appliedCode} applied · ${formatMoney(result.totalCents)} total` : "No working discount found this time.";
  el("receipt").hidden = false;
  // No earnings claim is fabricated: cashback settlement is not active in this demo.
  el("receipt").textContent = completed ? `${confirmedEarningsLine({ savingsCents: result.savingsCents, feeCents: 0 })} (Demo)` : `${formatMoney(result.additionalSavingsCents)} more saved. No fee to you.`;
}
async function refresh() {
  state = popupStatusSchema.parse(await request({ type: "status" }));
  el("store").textContent = state.merchantName ? `${state.merchantName} · checkout` : "A little help at checkout";
  el("demo-link").hidden = state.supported;
  el("token-note").textContent = state.hasToken ? "Shopper token saved. Your reports count once per code. Leave blank and save to remove it." : "Add an issued shopper token to help verify codes. Leave blank and save to remove it.";
  if (!state.result) clearResult();
  if (state.result) { showResult(state.result, state.completed); status(state.reportNote ?? "Your best code is ready."); }
  else if (!state.supported) status("The local demo is the first supported store.");
  else if (!state.checkout) status("Refresh the checkout page to connect the extension.");
  else if (state.completed) status("This demo order is complete. Start a new cart to test codes.");
  else if (state.busy) status("Testing is running. You can reopen this popup when it finishes.");
  else status("We’ll try verified codes and keep the best total.");
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
void refresh().catch((error: unknown) => { status(error instanceof Error ? error.message : "Could not connect to the coupon service.", true); el("demo-link").hidden = false; });
