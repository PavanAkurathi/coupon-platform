import { mkdir, copyFile } from 'node:fs/promises';
const root = import.meta.dir;
const output = await Bun.build({ entrypoints: [`${root}/src/main.ts`], target: 'browser', format: 'esm', minify: true,
  banner: 'globalThis.__zod_globalConfig={jitless:true};', define: { __API_ORIGIN__: 'null' } });
if (!output.success) throw new Error(output.logs.join('\n'));
await mkdir(`${root}/dist`, { recursive: true });
await Bun.write(`${root}/dist/main.js`, await output.outputs[0]!.text());
for (const file of ['index.html', 'styles.css']) await copyFile(`${root}/public/${file}`, `${root}/dist/${file}`);
console.log('Hold dashboard built.');
