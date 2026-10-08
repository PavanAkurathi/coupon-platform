import { mkdir, copyFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";

// PLACEHOLDER PRODUCT NAME: the founder has not chosen the final name. Change it here
// only, before any Web Store listing. Keep it neutral (no merchant, competitor or affiliate wording).
const PRODUCT_NAME = "Checkout Savings";
const DEV_API_ORIGIN = "http://localhost:3001";
const ICON_SIZES = [16, 32, 48, 128];
const LOCAL_HOST = /(^|\.)localhost$|^127\.|^\[::1\]$/;
const LOCAL_URL = /https?:\/\/(?:[a-z0-9.-]*localhost|127\.[0-9.]+|\[::1\])\b/;
const dir = import.meta.dir;

type Manifest = {
  name: string; icons: Record<string, string>; host_permissions?: string[];
  content_scripts?: { matches: string[]; js: string[] }[]; background: { service_worker: string };
  action: { default_popup: string; default_icon: Record<string, string> }; content_security_policy: { extension_pages: string };
};

const { values: args } = parseArgs({
  args: Bun.argv.slice(2), strict: true,
  options: { target: { type: "string", default: "dev" }, outdir: { type: "string" }, icons: { type: "boolean", default: false } },
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
if (target === "dev" && process.env.COUPON_API_ORIGIN) console.warn(`COUPON_API_ORIGIN is ignored for dev builds; using ${DEV_API_ORIGIN}.`);
const apiOrigin = target === "dev" ? DEV_API_ORIGIN : betaApiOrigin(process.env.COUPON_API_ORIGIN);

function betaApiOrigin(raw: string | undefined): string {
  if (!raw) throw new Error("Beta builds need COUPON_API_ORIGIN, e.g. COUPON_API_ORIGIN=https://api.example.com");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`COUPON_API_ORIGIN is not a URL: ${raw}`); }
  if (url.protocol !== "https:") throw new Error(`COUPON_API_ORIGIN must use https: ${raw}`);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(`COUPON_API_ORIGIN must be a bare origin (no path, query or credentials): ${raw}`);
  if (LOCAL_HOST.test(url.hostname)) throw new Error(`COUPON_API_ORIGIN must be a hosted API, not ${url.hostname}`);
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(url.origin)) throw new Error(`COUPON_API_ORIGIN has an unsupported host: ${raw}`);
  return url.origin;
}

// Bundle and check everything in memory first: a failed build never touches the previous output.
// content.js is the localhost demo checkout script; beta ships without it.
const entries = target === "dev" ? ["worker", "popup", "content", "amazon-content"] : ["worker", "popup", "amazon-content"];
const bundles = new Map<string, string>();
for (const entry of entries) {
  const result = await Bun.build({
    entrypoints: [`${dir}/src/${entry}.ts`], target: "browser",
    format: entry === "content" || entry === "amazon-content" ? "iife" : "esm", minify: true,
    define: { __BUILD_TARGET__: JSON.stringify(target), __API_ORIGIN__: JSON.stringify(apiOrigin) },
  });
  if (!result.success || result.outputs.length !== 1) throw new AggregateError(result.logs, `${entry} build failed`);
  bundles.set(`${entry}.js`, await result.outputs[0]!.text());
}
const staticFiles = ["popup.html", "popup.css", "icon.svg", ...ICON_SIZES.map((size) => `icon-${size}.png`)];

const manifest: Manifest = await Bun.file(`${dir}/public/manifest.json`).json();
manifest.name = target === "dev" ? `${PRODUCT_NAME} (dev)` : PRODUCT_NAME;
manifest.content_security_policy.extension_pages = manifest.content_security_policy.extension_pages.replace("__API_ORIGIN__", apiOrigin);
if (target === "beta") {
  // The localhost grant and content script exist only for the demo checkout.
  manifest.host_permissions = manifest.host_permissions?.filter((pattern) => !LOCAL_URL.test(pattern));
  manifest.content_scripts = manifest.content_scripts?.filter((script) => !script.matches.some((pattern) => LOCAL_URL.test(pattern)));
  if (!manifest.host_permissions?.length) delete manifest.host_permissions;
  if (!manifest.content_scripts?.length) delete manifest.content_scripts;
}
const manifestText = JSON.stringify(manifest, null, 2);
if (/__[A-Z_]+__/.test(manifestText)) throw new Error("Manifest template has an unfilled placeholder.");
const referenced = [
  manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon), ...(manifest.content_scripts ?? []).flatMap((script) => script.js),
];
for (const file of referenced) if (!bundles.has(file) && !staticFiles.includes(file)) throw new Error(`Manifest references missing file ${file}`);
if (target === "beta") {
  if (LOCAL_URL.test(manifestText) || manifestText.includes("http://")) throw new Error("Beta manifest still grants local or plain-http access.");
  for (const [file, text] of bundles) if (LOCAL_URL.test(text)) throw new Error(`Beta ${file} still contains a local URL.`);
  // popup.html is owned by the checkout-review packet; its demo link is flagged rather than rewritten here.
  if (LOCAL_URL.test(await Bun.file(`${dir}/public/popup.html`).text())) console.warn("Warning: beta popup.html still links to the localhost demo checkout.");
}

// The default dev outdir is the unpacked extension the founder has installed. Beta never writes there by default.
const outdir = resolve(dir, args.outdir ?? (target === "dev" ? "dist" : "beta/dist"));
if (existsSync(outdir) && (await readdir(outdir)).length && !existsSync(`${outdir}/manifest.json`)) {
  throw new Error(`Refusing to clear ${outdir}: it is not a previous extension build.`);
}
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
for (const [file, text] of bundles) await Bun.write(`${outdir}/${file}`, text);
for (const file of staticFiles) await copyFile(`${dir}/public/${file}`, `${outdir}/${file}`);
await Bun.write(`${outdir}/manifest.json`, `${manifestText}\n`);
console.log(`Extension ready (${target}, API ${apiOrigin}): ${relative(process.cwd(), outdir) || "."}`);
