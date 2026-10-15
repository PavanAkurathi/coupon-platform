import { mkdtemp, mkdir, rm, cp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

// Store release: Chrome Web Store zip, Firefox Add-ons zip and the source zip Mozilla
// reviewers rebuild from. Everything comes from a clean export of a commit (default HEAD),
// so uncommitted work never ships, and the Firefox build is checked to rebuild byte for byte.
// Usage: bun run release.ts [--ref HEAD] [--from <exported tree>] [--out <dir>]

// The hosted APIs the beta talks to (see docs/DEPLOY-NEON.md). Override with the env vars.
const ORIGINS = {
  COUPON_API_ORIGIN: process.env.COUPON_API_ORIGIN ?? "https://br-proud-breeze-b7ufxibk-couponapi.compute.c-13.us-east-1.aws.neon.tech",
  PRICE_API_ORIGIN: process.env.PRICE_API_ORIGIN ?? "https://br-proud-breeze-b7ufxibk-priceapi.compute.c-13.us-east-1.aws.neon.tech",
};
const WEB_EXT = "web-ext@10.7.0";
// What Mozilla needs to rebuild the extension, and nothing else.
const SOURCE_PATHS = ["package.json", "bun.lock", "tsconfig.base.json", "turbo.json", "apps/extension", "apps/dashboard", "packages/shared"];
const SOURCE_EXCLUDES = ["apps/extension/dist", "apps/extension/dist-firefox", "apps/extension/beta", "apps/extension/release", "apps/extension/e2e", "apps/extension/demo", "apps/dashboard/dist"];

const { values: args } = parseArgs({
  args: Bun.argv.slice(2), strict: true,
  options: { ref: { type: "string", default: "HEAD" }, from: { type: "string" }, out: { type: "string" } },
});

function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = {}): string {
  const result = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed in ${cwd}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.toString();
}
const step = (text: string) => console.log(`• ${text}`);
async function sha256(path: string): Promise<string> {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
}
async function treeHash(dir: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const files = [...new Bun.Glob("**/*").scanSync({ cwd: dir, dot: true })].sort();
  for (const file of files) hasher.update(`${file}\0`).update(await Bun.file(join(dir, file)).arrayBuffer());
  return hasher.digest("hex");
}

const work = await mkdtemp(join(tmpdir(), "hold-release-"));
try {
  let tree = join(work, "tree");
  let label: string;
  if (args.from) {
    tree = resolve(args.from);
    label = `tree ${tree}`;
  } else {
    const repo = run(["git", "rev-parse", "--show-toplevel"], import.meta.dir).trim();
    const commit = run(["git", "rev-parse", "--short", args.ref], repo).trim();
    await mkdir(tree);
    run(["sh", "-c", `git archive ${commit} | tar -x -C "${tree}"`], repo);
    label = `commit ${commit}`;
  }
  const extension = join(tree, "apps/extension");
  const { PRODUCT_NAME, PRODUCT_SLUG } = existsSync(join(extension, 'product.ts'))
    ? await import(join(extension, 'product.ts')) as { PRODUCT_NAME: string; PRODUCT_SLUG: string }
    : { PRODUCT_NAME: 'Hold', PRODUCT_SLUG: 'hold' };
  const manifest = await Bun.file(join(extension, "public/manifest.json")).json();
  const version: string = manifest.version;
  const out = resolve(args.out ?? join(import.meta.dir, "release", version));
  if (existsSync(out)) throw new Error(`${out} already exists; bump the manifest version or pick another --out.`);
  console.log(`${PRODUCT_NAME} ${version} from ${label}`);

  step("install (frozen lockfile)");
  run(["bun", "install", "--frozen-lockfile"], tree);
  step("typecheck");
  run(["bunx", "tsc", "--noEmit"], extension);
  step("unit tests");
  run(["bun", "test"], extension);
  run(["bun", "test"], join(tree, "packages/shared"));

  for (const browser of ["chrome", "firefox"]) {
    step(`build ${browser}`);
    run(["bun", "run", "build.ts", "--target", "beta", "--browser", browser, "--outdir", join(work, browser)], extension, ORIGINS);
  }
  step("lint the Firefox build (Mozilla's own checker)");
  const lint = JSON.parse(run(["bunx", WEB_EXT, "lint", "--source-dir", join(work, "firefox"), "--output", "json"], work));
  if (lint.summary.errors) throw new Error(`web-ext lint: ${lint.summary.errors} errors\n${JSON.stringify(lint.errors, null, 2)}`);
  const warnings = (lint.warnings as { code: string; file?: string }[]).map((warning) => `${warning.code}${warning.file ? ` (${warning.file})` : ""}`);

  step("source package for Mozilla review");
  const source = join(work, "source");
  const shipped = (file: string) => !file.split(sep).includes("node_modules") && !file.endsWith(".DS_Store")
    && !SOURCE_EXCLUDES.some((skip) => file === join(tree, skip) || file.startsWith(join(tree, skip) + sep));
  for (const path of SOURCE_PATHS) await cp(join(tree, path), join(source, path), { recursive: true, filter: shipped });
  // The lockfile lists every workspace; the backend services ship as package.json only (no code).
  for (const manifestPath of new Bun.Glob("services/*/package.json").scanSync({ cwd: tree })) await cp(join(tree, manifestPath), join(source, manifestPath));
  await writeFile(join(source, "SOURCE-BUILD.md"), [
    `# Building ${PRODUCT_NAME} ${version} for Firefox`,
    "",
    "The submitted extension is bundled and minified with Bun from the TypeScript in `apps/extension/src`, `apps/dashboard/src` and `packages/shared/src`.",
    "",
    "1. Install Bun 1.3.14 (https://bun.sh): `curl -fsSL https://bun.sh/install | bash -s bun-v1.3.14`",
    "2. In this folder: `bun install --frozen-lockfile`",
    `3. \`COUPON_API_ORIGIN=${ORIGINS.COUPON_API_ORIGIN} PRICE_API_ORIGIN=${ORIGINS.PRICE_API_ORIGIN} bun run --cwd apps/extension build.ts --target beta --browser firefox\``,
    "",
    "The output in `apps/extension/beta/dist-firefox` is identical to the submitted package. The two origins are the extension's own hosted services; they are build-time constants, not secrets.",
    "",
  ].join("\n"));

  const zips = { chrome: `${PRODUCT_SLUG}-chrome-${version}.zip`, firefox: `${PRODUCT_SLUG}-firefox-${version}.zip`, source: `${PRODUCT_SLUG}-source-${version}.zip` };
  const zipped = join(work, "zips");
  await mkdir(zipped);
  for (const [name, zip] of Object.entries(zips)) run(["zip", "-X", "-q", "-r", join(zipped, zip), "."], join(work, name));

  step("rebuild Firefox from the source zip, as a reviewer would, and compare");
  const verify = join(work, "verify");
  await mkdir(verify);
  run(["unzip", "-q", join(zipped, zips.source), "-d", verify], work);
  run(["bun", "install", "--frozen-lockfile"], verify);
  run(["bun", "run", "--cwd", "apps/extension", "build.ts", "--target", "beta", "--browser", "firefox"], verify, ORIGINS);
  const [submitted, rebuilt] = await Promise.all([treeHash(join(work, "firefox")), treeHash(join(verify, "apps/extension/beta/dist-firefox"))]);
  if (submitted !== rebuilt) throw new Error("The Firefox build does not reproduce from the source zip.");

  await mkdir(out, { recursive: true });
  for (const zip of Object.values(zips)) await cp(join(zipped, zip), join(out, zip));
  const sums = await Promise.all(Object.values(zips).map(async (zip) => `${await sha256(join(out, zip))}  ${zip}`));
  await writeFile(join(out, "SHA256SUMS"), `${sums.join("\n")}\n`);
  await writeFile(join(out, "RELEASE.txt"), [
    `${PRODUCT_NAME} ${version} from ${label}, built ${new Date().toISOString()}`,
    `Chrome Web Store: ${zips.chrome}`,
    `Firefox Add-ons: ${zips.firefox} (+ ${zips.source} when asked for source code)`,
    `Firefox lint: 0 errors, ${warnings.length} warnings${warnings.length ? `: ${warnings.join(", ")}` : ""}`,
    "Firefox build reproduces byte for byte from the source zip.",
    "",
  ].join("\n"));
  console.log(`\nRelease ready in ${out}\n${sums.join("\n")}\nFirefox lint: 0 errors, ${warnings.length} warnings`);
} finally {
  await rm(work, { recursive: true, force: true });
}
