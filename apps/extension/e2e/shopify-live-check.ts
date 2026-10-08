import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { shopifyCheckoutInspectionSchema, type ShopifyCheckoutInspection } from '@repo/shared';

// Operator onboarding check for candidate Shopify stores. LIVE TRAFFIC: run only
// with the founder's approval for the named stores. Per store, in a fresh isolated
// profile with no account: add the cheapest item to a guest cart, open checkout,
// read the order summary with the shipping reader, apply one deliberately invalid
// code, and read again. It never touches contact, address or payment fields, never
// changes marketing consent, never clicks Pay now and never places an order.
// With --trial-codes A,B it then runs the trial adapter: apply each code, measure, remove
// what it added, re-apply the best and verify the final total. Codes are used for
// observation only and are never stored.
//   bun e2e/shopify-live-check.ts --live-approved [--out report.json] [--trial-codes A,B] www.allbirds.com mvmt.com
const { values: args, positionals: hosts } = parseArgs({
  args: Bun.argv.slice(2), allowPositionals: true, strict: true,
  options: { 'live-approved': { type: 'boolean', default: false }, out: { type: 'string' }, 'trial-codes': { type: 'string' } },
});
if (!args['live-approved'] || !hosts.length) {
  console.error('Usage: bun e2e/shopify-live-check.ts --live-approved [--out report.json] <store-host>...\nRequires founder approval for live guest-checkout tests on each named store.');
  process.exit(2);
}
const INVALID_CODE = 'NOTAREALCODE-TEST';
const build = await Bun.build({ entrypoints: [`${import.meta.dir}/shopify-reader-global.ts`], target: 'browser', format: 'iife' });
if (!build.success) throw new AggregateError(build.logs, 'Shopify reader bundle failed');
const reader = await build.outputs[0]!.text();

type Result = { host: string; checkoutHost?: string; passed: string[]; failed: string[]; before?: ShopifyCheckoutInspection; after?: ShopifyCheckoutInspection; trial?: unknown; final?: ShopifyCheckoutInspection; stopped?: string };
const trialCodes = (args['trial-codes'] ?? '').split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
const results: Result[] = [];
for (const host of hosts) {
  const result: Result = { host, passed: [], failed: [] };
  const expect = (label: string, ok: boolean) => (ok ? result.passed : result.failed).push(label);
  const profile = await mkdtemp(join(tmpdir(), 'shopify-live-profile-'));
  const context = await chromium.launchPersistentContext(profile, {
    headless: false, viewport: { width: 1280, height: 900 }, locale: 'en-US',
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const variant = await page.evaluate(async () => {
      const response = await fetch('/products.json?limit=60', { credentials: 'same-origin' });
      if (!response.ok) return null;
      const body = await response.json();
      return body.products.flatMap((p: any) => p.variants.filter((v: any) => v.available && Number(v.price) >= 5
        && !/gift card|warranty|protection|insurance/i.test(`${p.title} ${p.product_type}`)).map((v: any) => ({ id: v.id, price: Number(v.price) })))
        .sort((a: any, b: any) => a.price - b.price)[0]?.id ?? null;
    });
    expect('public Shopify catalog is readable', variant !== null);
    if (variant === null) throw new Error('stop');
    const added = await page.evaluate(async (id) => (await fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: [{ id, quantity: 1 }] }) })).status, variant);
    expect('one item added to a guest cart', added === 200);
    await page.goto(`https://${host}/checkout`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    if (/verify you are human|captcha|are you a robot|access denied/i.test(await page.evaluate(() => document.body.innerText))) {
      result.stopped = 'Bot challenge shown; not bypassed.'; throw new Error('stop');
    }
    result.checkoutHost = new URL(page.url()).hostname;
    await page.evaluate(() => {
      const globals = window as any; globals.__payClicks = 0;
      document.addEventListener('click', (event) => { if ((event.target as Element)?.closest?.('#checkout-pay-button')) globals.__payClicks++; }, true);
    });
    await page.evaluate(reader);
    const read = async () => shopifyCheckoutInspectionSchema.parse(await page.evaluate((h) => (window as any).__shopifyReader.inspectShopifyCheckout([h]), result.checkoutHost));
    result.before = await read();
    expect('checkout route is recognized on the store host', result.before.status === 'ready');
    expect('subtotal and total are read in USD', result.before.subtotalCents !== null && result.before.totalCents !== null);
    expect('discount field and Apply control are recognized', result.before.discountField === 'available');
    const field = page.locator('input[name="reductions"][type="text"]').filter({ visible: true });
    await field.fill(INVALID_CODE);
    await page.locator('button[type="submit"][aria-label="Apply Discount Code"]').filter({ visible: true }).click();
    const deadline = Date.now() + 10000;
    do { await page.waitForTimeout(400); result.after = await read(); } while (!result.after.codeRejected && Date.now() < deadline);
    expect('invalid code is reported as rejected', result.after.codeRejected);
    expect('a rejected code leaves the total unchanged', result.after.totalCents === result.before.totalCents);
    if (trialCodes.length) {
      const trial = await page.evaluate(async ([h, codes]) => {
        try { return { ok: true, value: await (window as any).__shopifyReader.createShopifyAdapter(h).runTrials(codes) }; }
        catch (error) { return { ok: false, error: String((error as Error).message ?? error) }; }
      }, [result.checkoutHost, trialCodes] as const);
      result.trial = trial;
      result.final = await read();
      expect('trial run completed', trial.ok);
      if (trial.ok) {
        const value = (trial as any).value;
        expect('every supplied code has exactly one recorded outcome', value.attempts.length === trialCodes.length);
        expect('final total matches the order summary', value.totalCents === result.final.totalCents);
        expect('savings equal the measured drop in the payable total', value.savingsCents === result.before.totalCents! - result.final.totalCents!);
        expect('only the best code remains applied', value.appliedCode ? JSON.stringify(result.final.appliedCodes.map((c: string) => c.toUpperCase())) === JSON.stringify([value.appliedCode]) : result.final.appliedCodes.length === 0);
      }
    }
    expect('Pay now was never clicked', await page.evaluate(() => (window as any).__payClicks) === 0);
  } catch (error) {
    if ((error as Error).message !== 'stop') result.failed.push(`error: ${String(error).slice(0, 200)}`);
  } finally {
    await context.close(); await rm(profile, { recursive: true, force: true });
  }
  results.push(result);
  console.log(`${result.failed.length || result.stopped ? 'FAIL' : 'PASS'} ${host}${result.checkoutHost && result.checkoutHost !== host ? ` (checkout on ${result.checkoutHost})` : ''}: ${result.passed.length} passed, ${result.failed.length} failed${result.stopped ? `; ${result.stopped}` : ''}`);
  for (const label of result.failed) console.log(`  FAILED ${label}`);
}
if (args.out) await writeFile(args.out, JSON.stringify(results, null, 2));
process.exit(results.some((result) => result.failed.length || result.stopped) ? 1 : 0);
