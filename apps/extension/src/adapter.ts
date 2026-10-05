import { codeSchema, isDemoCheckout, unavailableCheckout, type TrialResult } from "./protocol";

type Snapshot = { cart: string; base: number; total: number; applied: string; version: string; busy: boolean; completed: boolean };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function element<T extends Element>(selector: string, kind: { new (...args: any[]): T }): T {
  const el = document.querySelector(selector);
  if (!(el instanceof kind)) throw new Error("Checkout changed. Please review your order before trying again.");
  return el;
}
function read(): Snapshot {
  if (!isDemoCheckout(location.href)) throw new Error("This checkout is not supported yet.");
  const root = element("[data-coupon-demo='v1']", HTMLElement);
  const base = Number(root.dataset.baseCents); const total = Number(root.dataset.totalCents);
  if (root.dataset.currency !== "USD" || !Number.isSafeInteger(base) || !Number.isSafeInteger(total) || base < 0 || total < 0 || total > base || !root.dataset.cartRevision || !root.dataset.promoRevision) {
    throw new Error("Could not read a reliable checkout total. Please review your order.");
  }
  const applied = root.dataset.appliedCode ?? "";
  if (applied && !codeSchema.safeParse(applied).success) throw new Error("Could not read the existing coupon.");
  return { cart: root.dataset.cartRevision, base, total, applied, version: root.dataset.promoRevision, busy: root.dataset.busy === "true", completed: root.dataset.completed === "true" };
}
function assertSameCart(current: Snapshot, original: Snapshot) {
  if (current.cart !== original.cart || current.base !== original.base || current.completed) throw new Error("Your cart changed. Testing stopped; review your coupon and total before checkout.");
}
function button(selector: string): HTMLButtonElement {
  const el = element(selector, HTMLButtonElement);
  if (el.type !== "button" || el.disabled) throw new Error("The coupon controls are not ready.");
  return el;
}
async function settled(previous: Snapshot, original: Snapshot): Promise<Snapshot> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await wait(40);
    const current = read(); assertSameCart(current, original);
    if (!current.busy && current.version !== previous.version) return current;
  }
  throw new Error("The checkout did not confirm the change. Testing stopped; review your coupon and total.");
}
async function clear(original: Snapshot): Promise<Snapshot> {
  const before = read(); assertSameCart(before, original);
  if (before.busy) throw new Error("A coupon update is still running.");
  if (!before.applied) {
    if (before.total !== before.base) throw new Error("The checkout total changed unexpectedly.");
    return before;
  }
  button("[data-remove-coupon]").click();
  const after = await settled(before, original);
  if (after.applied || after.total !== after.base) throw new Error("Could not remove the previous coupon safely.");
  return after;
}
async function apply(code: string, original: Snapshot): Promise<Snapshot> {
  const before = read(); assertSameCart(before, original);
  if (before.busy || before.applied || before.total !== before.base) throw new Error("Could not establish a clean coupon baseline.");
  const input = element("input[data-coupon-input]", HTMLInputElement);
  if (input.type !== "text" || input.disabled) throw new Error("The promo field is not ready.");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Could not update the promo field.");
  setter.call(input, code);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  button("[data-apply-coupon]").click();
  const after = await settled(before, original);
  if ((after.applied && after.applied !== code) || (!after.applied && after.total !== after.base)) throw new Error("The checkout returned an unexpected coupon state.");
  return after;
}
export function inspectCheckout() {
  try { const snapshot = read(); return { checkout: true, busy: snapshot.busy, completed: snapshot.completed, cartKey: `${snapshot.cart}:${snapshot.base}`, totalCents: snapshot.total, appliedCode: snapshot.applied }; }
  catch { return unavailableCheckout; }
}
export async function runTrials(codes: string[]): Promise<TrialResult> {
  const original = read();
  if (original.busy || original.completed) throw new Error("The checkout is not ready for coupon testing.");
  const originalInput = element("input[data-coupon-input]", HTMLInputElement).value;
  let bestCode = original.applied; let bestTotal = original.total;
  const attempts: TrialResult["attempts"] = [];
  try {
    await clear(original);
    for (const code of [...new Set(codes)]) {
      const result = await apply(code, original);
      const savingsCents = result.base - result.total;
      attempts.push({ code, outcome: result.applied === code && savingsCents > 0 ? "success" : "failure", savingsCents: result.applied === code ? savingsCents : 0 });
      if (result.total < bestTotal) { bestCode = code; bestTotal = result.total; }
      await clear(original);
    }
    const final = bestCode ? await apply(bestCode, original) : read();
    if (final.total !== bestTotal || final.applied !== bestCode) throw new Error("Could not confirm the best coupon. Please review your order.");
    if (!bestCode) element("input[data-coupon-input]", HTMLInputElement).value = originalInput;
    return { cartKey: `${original.cart}:${original.base}`, savingsCents: original.base - final.total, additionalSavingsCents: Math.max(0, original.total - final.total), appliedCode: final.applied, totalCents: final.total, attempts };
  } catch (error) {
    // Restore only after a known settled state, and never mutate a changed cart.
    try {
      const current = read(); assertSameCart(current, original);
      if (!current.busy && (!current.applied || current.applied === original.applied || codes.includes(current.applied))) {
        await clear(original);
        if (original.applied) {
          const restored = await apply(original.applied, original);
          if (restored.total !== original.total) throw new Error("Original total changed");
        } else element("input[data-coupon-input]", HTMLInputElement).value = originalInput;
      }
    } catch { /* The error explicitly asks the shopper to review; do not guess. */ }
    throw error;
  }
}
