// Chrome Web Store images for Hold, rendered from real captures in docs/price-evidence.
// Each screenshot shows a crop of one unedited live capture (October 8, 2026) beside a caption;
// nothing inside the capture is drawn over or changed. Run: bun docs/store-assets/make-assets.ts
// Playwright is the extension package's dev dependency; docs/ has no package of its own.
import { chromium } from '../../apps/extension/node_modules/playwright';
import { join } from 'node:path';

const here = import.meta.dir;
const evidence = join(here, '..', 'price-evidence');
const dataUri = async (file: string) => `data:image/png;base64,${Buffer.from(await Bun.file(join(evidence, file)).arrayBuffer()).toString('base64')}`;

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Instrument+Sans:wght@400..700&family=IBM+Plex+Mono:wght@500;600&display=block">';
const BASE = `
  *{box-sizing:border-box;margin:0}
  body{width:1280px;height:800px;overflow:hidden;position:relative;background:#ffd84a;color:#111614;font-family:"Instrument Sans",Arial,sans-serif}
  .mark{position:absolute;left:56px;top:46px;display:flex;align-items:center;gap:10px;font:900 30px/1 "Big Shoulders Display",Impact,sans-serif;text-transform:uppercase}
  .tagicon{width:38px;height:25px;background:#111614;color:#ffd84a;border-radius:4px 11px 11px 4px;display:grid;place-items:center;font:600 13px "IBM Plex Mono",monospace}
  .copy{position:absolute;left:56px;top:150px;width:372px}
  .eyebrow{font:600 14px/1.4 "IBM Plex Mono",monospace;letter-spacing:.14em;text-transform:uppercase}
  h1{margin-top:18px;font:900 88px/.9 "Big Shoulders Display",Impact,sans-serif;text-transform:uppercase}
  h1 span{display:block;color:#e8461b}
  .sub{margin-top:24px;font-size:22px;line-height:1.45;color:#3b3a2a}
  .foot{position:absolute;left:56px;bottom:44px;width:372px;font:500 13px/1.5 "IBM Plex Mono",monospace;color:#3b3a2a}
  .frame{position:absolute;left:480px;top:72px;width:758px;border:3px solid #111614;border-radius:18px;overflow:hidden;background:#fff;box-shadow:12px 12px 0 #111614}
  .chrome{height:40px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#eceee9;border-bottom:2px solid #111614}
  .dot{width:11px;height:11px;border-radius:50%;background:#c9cec9}
  .url{margin-left:8px;flex:1;background:#fff;border-radius:6px;padding:4px 10px;font:500 13px "IBM Plex Mono",monospace;color:#59635e}
  .shot{width:752px;background-repeat:no-repeat}`;

type Shot = { file: string; out: string; host: string; eyebrow: string; title: [string, string]; sub: string; foot: string; scale: number; left: number; top: number; height: number };
const SHOTS: Shot[] = [
  { file: 'bestbuy-live-check.png', out: '01-cheaper-elsewhere.png', host: 'bestbuy.com', eyebrow: 'Live check · same model',
    title: ['Same item.', 'Less elsewhere.'], sub: 'Hold checks the exact model or barcode at other stores while you shop, then shows you one calm note.',
    foot: 'Real Hold alert on a live product page, October 8, 2026. Prices before tax; they change.', scale: 0.91, left: 448, top: 0, height: 700 },
  { file: 'amazon-pause-live.png', out: '02-hold-before-you-buy.png', host: 'amazon.com', eyebrow: 'Before you buy',
    title: ['It holds your', 'first click.'], sub: 'Cheaper elsewhere? On Amazon, Best Buy and eBay your first Buy click pauses once. Go there, or click again to buy here.',
    foot: 'Real Hold pause on a live product page, October 8, 2026. The lower price was seen moments earlier on another store.', scale: 0.767, left: 300, top: 0, height: 690 },
  { file: 'amazon-banner-live.png', out: '03-remembers-what-you-saw.png', host: 'amazon.com', eyebrow: 'On your device',
    title: ['Remembers', 'what you saw.'], sub: 'Prices of products you viewed stay in your browser, never on a server, so Hold can tell you a store you just visited was cheaper.',
    foot: 'Real Hold alert on a live product page, October 8, 2026. Prices before tax.', scale: 1, left: 522, top: 0, height: 700 },
];

function shotHtml(shot: Shot, uri: string): string {
  return `<!doctype html><meta charset="utf-8">${FONTS}<style>${BASE}</style>
  <div class="mark"><span class="tagicon">$</span>Hold</div>
  <div class="copy"><p class="eyebrow">${shot.eyebrow}</p><h1>${shot.title[0]}<span>${shot.title[1]}</span></h1><p class="sub">${shot.sub}</p></div>
  <p class="foot">${shot.foot}</p>
  <div class="frame"><div class="chrome"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="url">${shot.host}</span></div>
    <div class="shot" style="height:${shot.height}px;background-image:url(${uri});background-size:${1280 * shot.scale}px auto;background-position:${-shot.left * shot.scale}px ${-shot.top * shot.scale}px"></div></div>`;
}

const NEVER = [
  ['No account', 'No sign-up, no login, no email.'],
  ['No cookies read', 'Its own store checks send none.'],
  ['No affiliate links', 'Never added, removed or swapped.'],
  ['Nothing sold', 'No ads, no trackers, no data brokers.'],
  ['No card details', 'Never reads payment fields or places orders.'],
  ['Your list stays local', 'Products you viewed stay in your browser.'],
];
const neverHtml = `<!doctype html><meta charset="utf-8">${FONTS}<style>${BASE}
  body{background:#111614;color:#f3f5f2}.tagicon{background:#ffd84a;color:#111614}
  .copy{width:420px}.sub{color:#c9d1cb}h1 span{color:#ff6a3d}.foot{color:#9ba79f;width:420px}
  ul{position:absolute;left:540px;top:120px;width:684px;list-style:none;padding:0;border-top:2px solid #f3f5f2}
  li{display:grid;grid-template-columns:44px 1fr;gap:8px;padding:19px 0;border-bottom:1px solid #2f3833}
  .x{font:900 34px/1 "Big Shoulders Display",Impact,sans-serif;color:#ff6a3d}
  strong{display:block;font:800 34px/1 "Big Shoulders Display",Impact,sans-serif;text-transform:uppercase;letter-spacing:.01em}
  li p{margin-top:6px;font-size:19px;color:#b6c0b9}</style>
  <div class="mark"><span class="tagicon">$</span>Hold</div>
  <div class="copy"><p class="eyebrow" style="color:#ffd84a">Privacy, plainly</p><h1>On your side.<span>Nothing else.</span></h1>
    <p class="sub">Hold earns no commission, so nothing decides which deal you see. Alerts on every store stay off until you turn them on.</p></div>
  <p class="foot">Every line checked against Hold's code. Full privacy policy linked on this listing.</p>
  <ul>${NEVER.map(([title, text]) => `<li><span class="x">✕</span><div><strong>${title}</strong><p>${text}</p></div></li>`).join('')}</ul>`;

const tileHtml = `<!doctype html><meta charset="utf-8">${FONTS}<style>
  *{box-sizing:border-box;margin:0}
  body{width:440px;height:280px;overflow:hidden;position:relative;background:#ffd84a;color:#111614;font-family:"Instrument Sans",Arial,sans-serif}
  .stamp{position:absolute;left:50px;top:34px;transform:rotate(-8deg);font:900 118px/.82 "Big Shoulders Display",Impact,sans-serif;color:#e8461b;border:9px double #e8461b;border-radius:16px;padding:12px 22px 4px;letter-spacing:.05em;background:rgba(232,70,27,.07)}
  .line{position:absolute;left:44px;bottom:36px;font:700 25px/1.15 "Instrument Sans",Arial,sans-serif}
  .line span{display:block;font:600 13px/1.4 "IBM Plex Mono",monospace;letter-spacing:.12em;text-transform:uppercase;margin-top:8px;color:#3b3a2a}
</style>
  <div class="stamp">HOLD</div>
  <p class="line">Check before you buy.<span>Same item · cheaper elsewhere?</span></p>`;

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
async function render(html: string, out: string, width: number, height: number) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Every image uses all three families; a fallback font must fail the build, not ship.
  const missing = await page.evaluate(() => {
    const loaded = new Set([...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replaceAll('"', '')));
    return ['Big Shoulders Display', 'Instrument Sans', 'IBM Plex Mono'].filter((family) => !loaded.has(family));
  });
  if (missing.length) throw new Error(`${out}: fonts did not load: ${missing.join(', ')}`);
  await page.screenshot({ path: join(here, out), clip: { x: 0, y: 0, width, height } });
  await page.close();
  console.log(`wrote ${out} (${width}x${height})`);
}
try {
  for (const shot of SHOTS) await render(shotHtml(shot, await dataUri(shot.file)), shot.out, 1280, 800);
  await render(neverHtml, '04-privacy.png', 1280, 800);
  await render(tileHtml, 'promo-tile-440x280.png', 440, 280);
} finally { await browser.close(); }
