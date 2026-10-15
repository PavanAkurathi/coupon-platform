import type { PriceComparison, PriceCoverage } from "@repo/shared";
import { formatMoney, type PopupStatus } from "./protocol";
import { matchTip } from "./price-match";

// Price comparison card in the popup. Shown on any product page the reader
// recognizes, alongside (not instead of) the coupon panels.
type Price = NonNullable<PopupStatus["price"]>;
function el<T extends HTMLElement>(id: string): T { const node = document.getElementById(id); if (!node) throw new Error(`Missing ${id}`); return node as T; }

const SOURCE_NAMES: Record<PriceCoverage["source"], string> = {
  seen_by_you: "stores you viewed", live_check: "live store check", ebay_api: "eBay", bestbuy_api: "Best Buy", reviewed_feed: "reviewed offers",
};
const sourceName = (entry: PriceCoverage) => entry.source === "live_check" && entry.merchant ? `${entry.merchant} (live)` : SOURCE_NAMES[entry.source];
function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}
function sources(comparison: PriceComparison): string {
  const checked = comparison.coverage.filter((entry) => entry.status === "checked").map(sourceName);
  const down = comparison.coverage.filter((entry) => entry.status === "unavailable" && entry.source !== "seen_by_you").map(sourceName);
  return [checked.length ? `Compared with ${checked.join(", ")}.` : "", down.length ? `${down.join(", ")} unavailable right now.` : "", "Before tax."]
    .filter(Boolean).join(" ");
}

export function renderPrice(price: Price | undefined): boolean {
  const panel = el("price-panel");
  const link = el<HTMLAnchorElement>("price-link");
  link.hidden = true; link.removeAttribute("href");
  el("price-match").hidden = true;
  if (!price) {
    panel.hidden = true;
    for (const id of ['price-headline', 'price-meta', 'price-sources', 'price-match-text']) el(id).textContent = '';
    el<HTMLAnchorElement>('price-match-link').removeAttribute('href');
    return false;
  }
  panel.hidden = false;
  const { product, comparison } = price;
  const better = comparison?.status === "better_offer" && comparison.bestOffer;
  panel.classList.toggle("neutral", !better);
  el("price-eyebrow").textContent = "Compare prices";
  if (!product || !comparison) {
    el("price-headline").textContent = "Can't compare this product.";
    el("price-meta").textContent = price.reason;
    el("price-sources").textContent = "";
    return true;
  }
  if (better) {
    const offer = comparison.bestOffer!;
    el("price-headline").textContent = `${formatMoney(comparison.savingsCents)} less at ${offer.merchant}`;
    const shipping = offer.shippingCents === 0 ? "free shipping" : `${formatMoney(offer.shippingCents ?? 0)} shipping`;
    const seen = offer.source === "seen_by_you" ? `you saw it ${ago(offer.observedAt)}` : offer.source === "live_check" ? `checked live ${ago(offer.observedAt)}` : `checked ${ago(offer.observedAt)}`;
    el("price-meta").textContent = `${formatMoney(offer.priceCents)} + ${shipping} vs ${formatMoney(comparison.baselineCents!)} here. New${offer.seller ? ` · seller ${offer.seller}` : ""} · ${seen}.`;
    link.href = offer.url; link.hidden = false;
    el("price-link-text").textContent = `View on ${offer.merchant}`;
    const tip = matchTip(product, offer);
    if (tip) {
      el("price-match-text").textContent = `${tip.text} `;
      const policy = el<HTMLAnchorElement>("price-match-link");
      policy.href = tip.url; policy.textContent = tip.checked;
      el("price-match").hidden = false;
    }
  } else {
    el("price-headline").textContent = comparison.status === "no_better_offer" ? `${formatMoney(product.priceCents)} is the best price we found.` : `${formatMoney(product.priceCents)} at ${product.merchant}`;
    el("price-meta").textContent = comparison.reason;
  }
  el("price-sources").textContent = sources(comparison);
  return true;
}

export function renderPriceAlerts(enabled: boolean | undefined, onChange: () => Promise<void>,
  change: (enabled: boolean) => Promise<unknown>, isCurrent: () => boolean) {
  const row = el("price-alerts");
  if (enabled === undefined) { row.hidden = true; return; }
  row.hidden = false;
  el("price-alerts-text").textContent = enabled
    ? "Price checks are on for supported product pages you visit. Coverage varies by store."
    : "Allow price checks on product pages you visit. A match and a readable price are required.";
  const toggle = el<HTMLButtonElement>("price-alerts-toggle");
  toggle.textContent = enabled ? "Turn off" : "Turn on";
  toggle.disabled = false;
  toggle.onclick = async () => {
    if (!isCurrent()) return;
    toggle.disabled = true;
    try {
      // The permission prompt must come from this click, not the worker.
      const granted = enabled ? false : await chrome.permissions.request({ origins: ["https://*/*"] });
      if (!isCurrent()) return;
      await change(granted);
      if (isCurrent()) await onChange();
    } catch {
      if (isCurrent()) el('price-alerts-text').textContent = 'The price-check setting could not be changed. Please try again.';
    } finally { if (isCurrent()) toggle.disabled = false; }
  };
}
