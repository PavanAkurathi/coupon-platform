const root = document.querySelector<HTMLElement>("[data-coupon-demo]")!;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = byId<HTMLInputElement>("promo");
const applyButton = byId<HTMLButtonElement>("apply");
const removeButton = byId<HTMLButtonElement>("remove");
const completeButton = byId<HTMLButtonElement>("complete");
const codes: Record<string, number> = { WELCOME10: 1000, SAVE15: 1500, NEW20: 2000, LEGACY5: 500 };
let base = 10000; let applied = ""; let cartRevision = 1; let promoRevision = 1; let generation = 0; let completed = false; let busy = false;
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
function render() {
  const saved = codes[applied] ?? 0;
  Object.assign(root.dataset, { baseCents: String(base), totalCents: String(base - saved), cartRevision: String(cartRevision), promoRevision: String(promoRevision), appliedCode: applied, busy: String(busy), completed: String(completed) });
  byId("subtotal").textContent = money(base); byId("total").textContent = money(base - saved); byId("discount").textContent = `−${money(saved)}`;
  removeButton.hidden = !applied;
  applyButton.disabled = removeButton.disabled = completeButton.disabled = input.disabled = busy || completed;
  byId("completion").hidden = !completed;
  byId("quantity-label").textContent = base === 10000 ? "One thoughtfully simple kit" : "Two thoughtfully simple kits";
}
async function changeCoupon(code: string) {
  if (busy || completed) return;
  const operation = ++generation; busy = true; render();
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (operation !== generation) return;
  applied = Object.hasOwn(codes, code) ? code : "";
  byId("message").textContent = code ? (applied ? `${code} applied.` : "That code did not work.") : "Coupon removed.";
  busy = false; promoRevision++; render();
}
applyButton.addEventListener("click", () => void changeCoupon(input.value.trim().toUpperCase()));
removeButton.addEventListener("click", () => void changeCoupon(""));
completeButton.addEventListener("click", () => { if (busy) return; completed = true; render(); });
byId("change-cart").addEventListener("click", () => { generation++; busy = false; base = base === 10000 ? 20000 : 10000; cartRevision++; promoRevision++; render(); });
byId("reset").addEventListener("click", () => { generation++; busy = false; completed = false; base = 10000; applied = ""; input.value = ""; cartRevision++; promoRevision++; byId("message").textContent = ""; render(); });
render();
