import type { ShopifyCheckoutInspection, TrialResult } from '@repo/shared';
import { inspectShopifyCheckout } from './shopify-checkout-reader';

// Code trials on Shopify's one-page checkout, from structure observed on MVMT and
// Allbirds on October 8, 2026 (docs/SHOPIFY-CHECKOUT-EVIDENCE.md). It touches only
// the discount field, its Apply button and the Remove button of a code it applied
// itself. Contact, address, payment, consent and Pay now are never touched.
const FIELD = 'input[name="reductions"][type="text"]';
const APPLY = 'button[type="submit"][aria-label="Apply Discount Code"]';
const POLL_MS = 250;
const SETTLE_TIMEOUT_MS = 12_000;
// Shopify answers asynchronously and a previous rejection stays flagged on the
// field, so a result counts only after this delay and three identical readings.
const MIN_RESPONSE_MS = 1_200;
// When the field is still flagged from an earlier rejection, a new rejection needs longer.
const STALE_REJECTION_MS = 4_000;
const STABLE_READINGS = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();
function visible(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.isConnected && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden';
}
function control<T extends HTMLElement>(selector: string, kind: { new (...args: any[]): T }, root: ParentNode = document): T {
  const matches = [...root.querySelectorAll(selector)].filter(visible);
  if (matches.length !== 1 || !(matches[0] instanceof kind) || (matches[0] as unknown as HTMLButtonElement).disabled) {
    throw new Error('The discount controls changed. Testing stopped; review your order before paying.');
  }
  return matches[0] as T;
}
// Apply is disabled while the field is empty, and Shopify can re-render the form
// (resetting the field) just after a code is removed. Re-type until the field holds
// the code and exactly one visible Apply is enabled, then return both.
async function typeCode(code: string, timeoutMs = 4_000): Promise<{ field: HTMLInputElement; apply: HTMLButtonElement }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const fields = [...document.querySelectorAll<HTMLInputElement>(FIELD)].filter(visible);
    if (fields.length === 1 && !fields[0]!.disabled) {
      if (!same(fields[0]!.value, code)) setField(code);
      await wait(150);
      const field = [...document.querySelectorAll<HTMLInputElement>(FIELD)].filter(visible);
      const applies = field.length === 1 ? [...(field[0]!.form ?? document).querySelectorAll<HTMLButtonElement>(APPLY)].filter(visible) : [];
      if (field.length === 1 && same(field[0]!.value, code) && applies.length === 1 && !applies[0]!.disabled
        && applies[0]!.getAttribute('aria-disabled') !== 'true') return { field: field[0]!, apply: applies[0]! };
    } else await wait(150);
    if (Date.now() > deadline) throw new Error('The discount controls changed. Testing stopped; review your order before paying.');
  }
}
function removeButton(code: string): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>('ul[role="list"] [role="group"] button[type="button"][aria-label^="Remove "]')]
    .find((button) => visible(button) && same(button.getAttribute('aria-label')!.slice('Remove '.length).trim(), code)) ?? null;
}
function setField(value: string) {
  const field = control(FIELD, HTMLInputElement);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Could not update the discount field.');
  setter.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return field;
}
const key = (state: ShopifyCheckoutInspection, field: string) =>
  JSON.stringify([state.status, state.subtotalCents, state.totalCents, state.codeRejected, state.appliedCodes, field]);

export function createShopifyAdapter(host: string) {
  const read = () => inspectShopifyCheckout([host]);
  const fieldValue = () => ([...document.querySelectorAll<HTMLInputElement>(FIELD)].find(visible)?.value ?? '');
  // Waits until the checkout stops changing and `done` accepts the settled state.
  async function settle(done: (state: ShopifyCheckoutInspection) => boolean, startedAt = Date.now(), minimumMs = MIN_RESPONSE_MS): Promise<ShopifyCheckoutInspection> {
    let last = ''; let streak = 0;
    while (Date.now() - startedAt < SETTLE_TIMEOUT_MS) {
      await wait(POLL_MS);
      const state = read();
      const current = key(state, fieldValue());
      streak = current === last ? streak + 1 : 1; last = current;
      if (Date.now() - startedAt >= minimumMs && streak >= STABLE_READINGS && state.status === 'ready' && done(state)) return state;
    }
    throw new Error('The checkout did not confirm the change. Testing stopped; review your discount and total before paying.');
  }
  function assertSameCart(state: ShopifyCheckoutInspection, original: ShopifyCheckoutInspection) {
    if (state.status !== 'ready' || state.subtotalCents !== original.subtotalCents) {
      throw new Error('Your cart changed. Testing stopped; review your discount and total before paying.');
    }
  }
  async function apply(code: string, original: ShopifyCheckoutInspection): Promise<{ accepted: boolean; state: ShopifyCheckoutInspection }> {
    if (removeButton(code)) throw new Error('That code is already applied.');
    const { field, apply: applyButton } = await typeCode(code);
    const flaggedBefore = field.getAttribute('aria-invalid') === 'true';
    const startedAt = Date.now();
    applyButton.click();
    // An applied code shows its Remove chip at once; a rejection must outlast a stale flag.
    const state = await settle((s) => Boolean(removeButton(code))
      || (s.codeRejected && same(fieldValue(), code) && Date.now() - startedAt >= (flaggedBefore ? STALE_REJECTION_MS : MIN_RESPONSE_MS)), startedAt);
    assertSameCart(state, original);
    return { accepted: Boolean(removeButton(code)), state };
  }
  async function remove(code: string, original: ShopifyCheckoutInspection): Promise<ShopifyCheckoutInspection> {
    const button = removeButton(code);
    if (!button) return read();
    button.click();
    const state = await settle((s) => !removeButton(code) && s.totalCents === original.totalCents
      && JSON.stringify(s.appliedCodes) === JSON.stringify(original.appliedCodes));
    assertSameCart(state, original);
    return state;
  }

  return {
    inspect: read,
    async runTrials(codes: string[]): Promise<TrialResult> {
      const original = read();
      if (original.status !== 'ready' || original.discountField !== 'available' || original.totalCents === null || original.subtotalCents === null) {
        throw new Error('Open the checkout and wait for the order summary to finish loading, then try again.');
      }
      // An existing code may be the shopper's or a creator's. It stays exactly as it is.
      if (original.appliedCodes.length) {
        throw new Error(`${original.appliedCodes.join(', ')} is already applied. We leave existing codes in place; remove it yourself if you want us to compare codes.`);
      }
      const originalField = fieldValue();
      const attempts: TrialResult['attempts'] = [];
      let best: { code: string; total: number } | null = null;
      let added: string | null = null;
      let pending: string | null = null;
      try {
        for (const code of [...new Set(codes.map((c) => c.toUpperCase()))]) {
          pending = code;
          const { accepted, state } = await apply(code, original);
          if (accepted) added = code;
          const savingsCents = accepted ? original.totalCents - state.totalCents! : 0;
          attempts.push({ code, outcome: accepted && savingsCents > 0 ? 'success' : 'failure', savingsCents: accepted && savingsCents > 0 ? savingsCents : 0 });
          if (accepted && savingsCents > 0 && (!best || state.totalCents! < best.total)) best = { code, total: state.totalCents! };
          if (accepted) { await remove(code, original); added = null; }
          else setField('');
        }
        if (!best) { setField(originalField); return result(original, original, '', attempts); }
        pending = best.code;
        const { accepted, state } = await apply(best.code, original);
        if (!accepted) throw new Error('The best code stopped working on a second try. Review your discount before paying.');
        added = best.code;
        if (state.totalCents! >= original.totalCents) { await remove(best.code, original); added = null; return result(original, original, '', attempts); }
        return result(original, state, best.code, attempts);
      } catch (error) {
        // A changed cart is never mutated further: say which code may still be applied.
        const changedCart = read().subtotalCents !== original.subtotalCents;
        const left = [added, pending].find((code): code is string => Boolean(code && removeButton(code)));
        if (changedCart) {
          throw new Error(`Your cart changed while we were testing, so we stopped.${left ? ` ${left} may still be applied.` : ''} Review your discount and total before paying.`);
        }
        // Otherwise restore only what this run added, after a settled state; never touch existing codes.
        try { if (left) await remove(left, original); else if (fieldValue() && !same(fieldValue(), originalField)) setField(originalField); }
        catch { /* The error already asks the shopper to review the order. */ }
        throw error;
      }
    },
  };
}

function result(original: ShopifyCheckoutInspection, final: ShopifyCheckoutInspection, appliedCode: string, attempts: TrialResult['attempts']): TrialResult {
  const savingsCents = Math.max(0, original.totalCents! - final.totalCents!);
  return { cartKey: shopifyCartKey(original), savingsCents, additionalSavingsCents: savingsCents, appliedCode, totalCents: final.totalCents!, attempts };
}
// Cart identity for stale-result checks: the store's subtotal before any discount.
export function shopifyCartKey(state: ShopifyCheckoutInspection): string {
  return `shopify:${state.subtotalCents}`;
}
