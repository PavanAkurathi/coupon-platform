import { mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";

// Product name chosen by the founder on October 9, 2026. Keep it neutral (no merchant, competitor or affiliate wording).
const PRODUCT_NAME = "Hold";
const DEV_API_ORIGIN = "http://localhost:3001";
const DEV_PRICE_API_ORIGIN = "http://localhost:3002";
const ICON_SIZES = [16, 32, 48, 128];
const LOCAL_HOST = /(^|\.)localhost$|^127\.|^\[::1\]$/;
const LOCAL_URL = /https?:\/\/(?:[a-z0-9.-]*localhost|127\.[0-9.]+|\[::1\])\b/;
// Firefox: the add-on ID is permanent once submitted to addons.mozilla.org.
// 140 (desktop) and 142 (Android) are the first releases with built-in data collection consent.
const FIREFOX_ID = "hold@hold.deals";
const FIREFOX_MIN_VERSION = "140.0";
const FIREFOX_ANDROID_MIN_VERSION = "142.0";
// What leaves the browser (docs/STORE-RELEASE.md): the product read from the page and the
// store's domain go to the price service, and the product's name or barcode to Amazon and Walmart searches.
const FIREFOX_DATA_COLLECTION = ["browsingActivity", "websiteContent"];
const STORE_DESCRIPTION_MAX = 132;
const ZOD_JITLESS = "globalThis.__zod_globalConfig={jitless:true};";
const dir = import.meta.dir;

type Manifest = {
  name: string; description: string; icons: Record<string, string>; permissions: string[]; host_permissions?: string[]; minimum_chrome_version?: string;
  content_scripts?: { matches: string[]; js: string[] }[]; background: { service_worker?: string; scripts?: string[]; type?: string }; optional_host_permissions?: string[];
  action: { default_popup: string; default_icon: Record<string, string> }; content_security_policy: { extension_pages: string };
  browser_specific_settings?: {
    gecko: { id: string; strict_min_version: string; data_collection_permissions: { required: string[] } };
    gecko_android: { strict_min_version: string };
  };
};

const { values: args } = parseArgs({
  args: Bun.argv.slice(2), strict: true,
  options: {
    target: { type: "string", default: "dev" }, browser: { type: "string", default: "chrome" },
    outdir: { type: "string" }, icons: { type: "boolean", default: false },
  },
});

if (args.icons) {
  // Regenerates the committed PNGs from icon.svg. Store guidance: the 128px icon is 96px art plus 16px padding.
  const { chromium } = await import("playwright");
  const svg = await Bun.file(`${dir}/public/icon.svg`).text();
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
  for (const size of ICON_SIZES) {
    const art = size === 128 ? 96 : size;
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${art}px;height:${art}px;margin:${(size - art) / 2}px}</style>${svg}`);
    await page.screenshot({ path: `${dir}/public/icon-${size}.png`, omitBackground: true });
    await page.close();
  }
  await browser.close();
  console.log(`Icons written: ${ICON_SIZES.map((size) => `public/icon-${size}.png`).join(", ")}`);
  process.exit(0);
}

const target = args.target;
if (target !== "dev" && target !== "beta") throw new Error(`Unknown --target "${target}". Use dev or beta.`);
const browser = args.browser;
if (browser !== "chrome" && browser !== "firefox") throw new Error(`Unknown --browser "${browser}". Use chrome or firefox.`);
if (target === "dev" && process.env.COUPON_API_ORIGIN) console.warn(`COUPON_API_ORIGIN is ignored for dev builds; using ${DEV_API_ORIGIN}.`);
const apiOrigin = target === "dev" ? DEV_API_ORIGIN : betaApiOrigin(process.env.COUPON_API_ORIGIN);
// The price service is optional: without one, comparisons use prices seen in this browser only.
const priceApiOrigin = target === "dev" ? DEV_PRICE_API_ORIGIN
  : process.env.PRICE_API_ORIGIN ? betaApiOrigin(process.env.PRICE_API_ORIGIN, "PRICE_API_ORIGIN") : null;

function betaApiOrigin(raw: string | undefined, name = "COUPON_API_ORIGIN"): string {
  if (!raw) throw new Error(`Beta builds need ${name}, e.g. ${name}=https://api.example.com`);
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${name} is not a URL: ${raw}`); }
  if (url.protocol !== "https:") throw new Error(`${name} must use https: ${raw}`);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(`${name} must be a bare origin (no path, query or credentials): ${raw}`);
  if (LOCAL_HOST.test(url.hostname)) throw new Error(`${name} must be a hosted API, not ${url.hostname}`);
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(url.origin)) throw new Error(`${name} has an unsupported host: ${raw}`);
  return url.origin;
}

// Bundle and check everything in memory first: a failed build never touches the previous output.
// content.js is the localhost demo checkout script; beta ships without it.
// offscreen is Chrome's DOMParser stand-in; Firefox's background page parses directly.
const entries = ["worker", "popup", ...(target === "dev" ? ["content"] : []), "amazon-content", "shopify-content", "price-content", ...(browser === "chrome" ? ["offscreen"] : [])];
const bundles = new Map<string, string>();
for (const entry of entries) {
  const result = await Bun.build({
    entrypoints: [`${dir}/src/${entry}.ts`], target: "browser",
    format: entry === "worker" || entry === "popup" || entry === "offscreen" ? "esm" : "iife", minify: true,
    define: { __BUILD_TARGET__: JSON.stringify(target), __BROWSER__: JSON.stringify(browser), __API_ORIGIN__: JSON.stringify(apiOrigin), __PRICE_API_ORIGIN__: JSON.stringify(priceApiOrigin) },
    // zod compiles parsers with new Function unless jitless. Extension CSP blocks that and
    // logs a violation for zod's probe; jitless never tries. Set before zod first loads.
    banner: ZOD_JITLESS,
  });
  if (!result.success || result.outputs.length !== 1) throw new AggregateError(result.logs, `${entry} build failed`);
  bundles.set(`${entry}.js`, await result.outputs[0]!.text());
}
const staticFiles = ["popup.html", "popup.css", ...(browser === "chrome" ? ["offscreen.html"] : []), "icon.svg", ...ICON_SIZES.map((size) => `icon-${size}.png`)];
const dashboard = await Bun.build({
  entrypoints: [resolve(dir, '../dashboard/src/main.ts')], target: 'browser', format: 'esm', minify: true,
  banner: ZOD_JITLESS, define: { __API_ORIGIN__: JSON.stringify(apiOrigin) },
});
if (!dashboard.success || dashboard.outputs.length !== 1) throw new AggregateError(dashboard.logs, 'Dashboard build failed');
bundles.set('dashboard/main.js', await dashboard.outputs[0]!.text());
const dashboardAssets = new Map<string, string>();
for (const file of ['index.html', 'styles.css']) dashboardAssets.set(file, await Bun.file(resolve(dir, `../dashboard/public/${file}`)).text());
// Stores the worker checks live for price comparisons (see src/store-lookups.ts).
const LIVE_STORE_ORIGINS = ["https://www.amazon.com", "https://www.walmart.com"];

const manifest: Manifest = await Bun.file(`${dir}/public/manifest.json`).json();
manifest.name = target === "dev" ? `${PRODUCT_NAME} (dev)` : PRODUCT_NAME;
manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace("__API_ORIGIN__", [apiOrigin, priceApiOrigin, ...LIVE_STORE_ORIGINS].filter(Boolean).join(" "));
if (target === "beta") {
  // The localhost grant and content script exist only for the demo checkout.
  manifest.host_permissions = manifest.host_permissions?.filter((pattern) => !LOCAL_URL.test(pattern));
  manifest.content_scripts = manifest.content_scripts?.filter((script) => !script.matches.some((pattern) => LOCAL_URL.test(pattern)));
  if (!manifest.host_permissions?.length) delete manifest.host_permissions;
  if (!manifest.content_scripts?.length) delete manifest.content_scripts;
}
if (browser === "firefox") {
  // Firefox has no extension service workers or offscreen documents: the same worker
  // runs as a background page. Chrome ignores background.scripts, Firefox needs it.
  manifest.background = { scripts: [manifest.background.service_worker!], type: "module" };
  manifest.permissions = manifest.permissions.filter((permission) => permission !== "offscreen");
  delete manifest.minimum_chrome_version;
  manifest.browser_specific_settings = {
    gecko: { id: FIREFOX_ID, strict_min_version: FIREFOX_MIN_VERSION, data_collection_permissions: { required: FIREFOX_DATA_COLLECTION } },
    gecko_android: { strict_min_version: FIREFOX_ANDROID_MIN_VERSION },
  };
}
// Both stores reject a manifest description over 132 characters.
if (manifest.description.length > STORE_DESCRIPTION_MAX) throw new Error(`Manifest description is ${manifest.description.length} characters; the stores allow ${STORE_DESCRIPTION_MAX}.`);
const manifestText = JSON.stringify(manifest, null, 2);
if (/__[A-Z_]+__/.test(manifestText)) throw new Error("Manifest template has an unfilled placeholder.");
// price-content.js is injected at runtime (popup or registered after the opt-in), not listed in the manifest.
if (!bundles.has("price-content.js")) throw new Error("price-content.js is missing.");
const referenced = [
  ...(manifest.background.service_worker ? [manifest.background.service_worker] : manifest.background.scripts ?? []), manifest.action.default_popup, ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon), ...(manifest.content_scripts ?? []).flatMap((script) => script.js),
];
for (const file of referenced) if (!bundles.has(file) && !staticFiles.includes(file)) throw new Error(`Manifest references missing file ${file}`);
if (target === "beta") {
  if (LOCAL_URL.test(manifestText) || manifestText.includes("http://")) throw new Error("Beta manifest still grants local or plain-http access.");
  for (const [file, text] of bundles) if (LOCAL_URL.test(text)) throw new Error(`Beta ${file} still contains a local URL.`);
  // popup.html is owned by the checkout-review packet; its demo link is flagged rather than rewritten here.
  if (LOCAL_URL.test(await Bun.file(`${dir}/public/popup.html`).text())) console.warn("Warning: beta popup.html still links to the localhost demo checkout.");
}

// The default dev Chrome outdir is the unpacked extension the founder has installed. Beta and Firefox never write there by default.
const outdir = resolve(dir, args.outdir ?? `${target === "dev" ? "" : "beta/"}dist${browser === "firefox" ? "-firefox" : ""}`);
if (existsSync(outdir) && (await readdir(outdir)).length && !existsSync(`${outdir}/manifest.json`)) {
  throw new Error(`Refusing to clear ${outdir}: it is not a previous extension build.`);
}
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await mkdir(`${outdir}/dashboard`, { recursive: true });
for (const [file, text] of bundles) await Bun.write(`${outdir}/${file}`, text);
for (const [file, text] of dashboardAssets) await Bun.write(`${outdir}/dashboard/${file}`, text);
for (const file of staticFiles) await copyFile(`${dir}/public/${file}`, `${outdir}/${file}`);
await Bun.write(`${outdir}/manifest.json`, `${manifestText}\n`);
console.log(`Extension ready (${target}, ${browser}, API ${apiOrigin}, prices ${priceApiOrigin ?? "this browser only"}): ${relative(process.cwd(), outdir) || "."}`);
