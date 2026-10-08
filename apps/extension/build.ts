import { mkdir, copyFile, rm } from "node:fs/promises";

await rm(`${import.meta.dir}/dist`, { recursive: true, force: true });
await mkdir(`${import.meta.dir}/dist`, { recursive: true });
for (const entry of ["worker", "popup", "content", "amazon-content"]) {
  const result = await Bun.build({
    entrypoints: [`${import.meta.dir}/src/${entry}.ts`],
    outdir: `${import.meta.dir}/dist`, target: "browser",
    format: entry === "content" || entry === "amazon-content" ? "iife" : "esm", minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, `${entry} build failed`);
}
for (const file of ["manifest.json", "popup.html", "popup.css", "icon.svg"]) {
  await copyFile(`${import.meta.dir}/public/${file}`, `${import.meta.dir}/dist/${file}`);
}
console.log("Extension ready: apps/extension/dist");
