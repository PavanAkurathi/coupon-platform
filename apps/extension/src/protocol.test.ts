import { describe, expect, test } from "bun:test";
import { contentRequestSchema, isDemoCheckout, popupRequestSchema, resultMatchesCheckout, trialResultSchema, type TrialResult } from "./protocol";
import manifest from "../public/manifest.json";

describe("extension trust boundaries", () => {
  test("only the explicitly supported checkout origin and path can run", () => {
    expect(isDemoCheckout("http://localhost:4173/checkout?ref=creator")).toBe(true);
    for (const url of ["http://localhost:3001/checkout", "http://localhost:4173/other", "https://localhost:4173/checkout", "http://localhost.evil.test:4173/checkout", "http://127.0.0.1:4173/checkout", "not a URL"]) expect(isDemoCheckout(url)).toBe(false);
  });
  test("caller cannot nominate an API origin, tab, account, or arbitrary script", () => {
    expect(popupRequestSchema.safeParse({ type: "run", tabId: 3 }).success).toBe(false);
    expect(popupRequestSchema.safeParse({ type: "save-token", token: "abc", apiUrl: "https://evil.test" }).success).toBe(false);
    expect(popupRequestSchema.safeParse({ type: "try-code", code: "SAVE15", userId: "someone" }).success).toBe(false);
    expect(contentRequestSchema.safeParse({ type: "trial", codes: ["<script>"] }).success).toBe(false);
    expect(contentRequestSchema.safeParse({ type: "trial", codes: Array(11).fill("SAVE15") }).success).toBe(false);
  });
  test("permission surface excludes cookie and redirect APIs", () => {
    for (const permission of ["cookies", "webRequest", "webRequestBlocking", "declarativeNetRequest", "tabs"]) expect(manifest.permissions).not.toContain(permission);
    // offscreen: parsing store pages fetched for price checks (no DOMParser in the worker).
    expect(manifest.permissions).toEqual(["storage", "activeTab", "scripting", "offscreen"]);
    // Every-store price alerts are opt-in: requested from the popup, revocable in Chrome.
    expect(manifest.optional_host_permissions).toEqual(["https://*/*"]);
    expect(manifest.content_scripts.flatMap((entry) => entry.matches)).toEqual(["http://localhost/*"]);
    expect(manifest.host_permissions).toEqual(["http://localhost/*"]);
  });
  test("source cannot acquire cookie or request-rewriting capabilities", async () => {
    const sourcePaths = new Bun.Glob("src/**/*.ts");
    for await (const path of sourcePaths.scan({ cwd: `${import.meta.dir}/..`, absolute: true })) {
      if (path.endsWith(".test.ts")) continue;
      const source = await Bun.file(path).text();
      expect(source).not.toMatch(/document\s*\.\s*cookie|(?:chrome|browser)\s*\.\s*(?:cookies|webRequest|declarativeNetRequest)|(?:location\s*\.\s*(?:href|assign|replace)\s*=)|\.setAttribute\s*\(\s*['"]href/);
    }
  });
  test("a receipt cannot survive a changed cart, total, or promo code", () => {
    const result: TrialResult = { cartKey: "1:10000", savingsCents: 1500, additionalSavingsCents: 1500, appliedCode: "SAVE15", totalCents: 8500, attempts: [] };
    const checkout = { checkout: true, busy: false, completed: true, cartKey: "1:10000", totalCents: 8500, appliedCode: "SAVE15" };
    expect(resultMatchesCheckout(result, checkout)).toBe(true);
    expect(resultMatchesCheckout(result, { ...checkout, cartKey: "2:10000" })).toBe(false);
    expect(resultMatchesCheckout(result, { ...checkout, totalCents: 10000, appliedCode: "" })).toBe(false);
    expect(resultMatchesCheckout(result, { ...checkout, busy: true })).toBe(false);
  });
  test("invalid measured savings cannot leave the content boundary", () => {
    expect(trialResultSchema.safeParse({ savingsCents: -1, additionalSavingsCents: 0, appliedCode: "SAVE15", totalCents: 8500, attempts: [] }).success).toBe(false);
  });
});
