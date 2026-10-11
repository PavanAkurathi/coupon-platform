import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Store builds: one source, a Chrome package and a Firefox package.
const root = mkdtempSync(join(tmpdir(), "hold-build-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const env = { ...process.env, COUPON_API_ORIGIN: "https://coupons.example.test", PRICE_API_ORIGIN: "https://prices.example.test" };

async function build(browser: "chrome" | "firefox") {
  const outdir = join(root, browser);
  const run = Bun.spawnSync(["bun", "run", `${import.meta.dir}/build.ts`, "--target", "beta", "--browser", browser, "--outdir", outdir], { env, stderr: "pipe", stdout: "pipe" });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
  return { outdir, manifest: await Bun.file(join(outdir, "manifest.json")).json() };
}

describe("store builds", () => {
  test("Chrome runs the worker as a service worker with an offscreen parser", async () => {
    const { outdir, manifest } = await build("chrome");
    expect(manifest.background).toEqual({ service_worker: "worker.js", type: "module" });
    expect(manifest.permissions).toContain("offscreen");
    expect(existsSync(join(outdir, "offscreen.js"))).toBe(true);
    expect(manifest.browser_specific_settings).toBeUndefined();
    expect(manifest.description.length).toBeLessThanOrEqual(132);
    expect(existsSync(join(outdir, "dashboard/index.html"))).toBe(true);
    expect(existsSync(join(outdir, "dashboard/styles.css"))).toBe(true);
    expect(manifest.web_accessible_resources).toBeUndefined();
    // The store dashboard hides Coupons and Rewards, and has no coupon service to call.
    expect(await Bun.file(join(outdir, "dashboard/main.js")).text()).not.toContain("coupons.example.test");
    // The Chrome worker leaves page parsing to the offscreen document.
    expect(await Bun.file(join(outdir, "worker.js")).text()).not.toContain("parseFromString");
  }, 60_000);

  test("zod never compiles code with new Function in any bundle", async () => {
    const { outdir } = await build("chrome");
    for (const file of ["worker.js", "popup.js", "price-content.js", "amazon-content.js", "shopify-content.js", "offscreen.js", "dashboard/main.js"]) {
      expect((await Bun.file(join(outdir, file)).text()).startsWith("globalThis.__zod_globalConfig={jitless:true};")).toBe(true);
    }
  }, 60_000);

  test("Firefox runs the same worker as a background page and declares its data use", async () => {
    const { outdir, manifest } = await build("firefox");
    expect(manifest.background).toEqual({ scripts: ["worker.js"], type: "module" });
    expect(manifest.permissions).toEqual(["storage", "activeTab", "scripting"]);
    expect(manifest.optional_host_permissions).toEqual(["https://*/*"]);
    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(existsSync(join(outdir, "offscreen.js")) || existsSync(join(outdir, "offscreen.html"))).toBe(false);
    expect(manifest.browser_specific_settings.gecko).toEqual({
      id: "hold@hold.deals", strict_min_version: "140.0",
      data_collection_permissions: { required: ["browsingActivity", "websiteContent"] },
    });
    expect(manifest.browser_specific_settings.gecko_android).toEqual({ strict_min_version: "142.0" });
    expect(await Bun.file(join(outdir, "worker.js")).text()).not.toMatch(/offscreen\.createDocument|OFFSCREEN_DOCUMENT/);
    expect(manifest.host_permissions).toBeUndefined();
    expect(existsSync(join(outdir, "dashboard/index.html"))).toBe(true);
  }, 60_000);
});
