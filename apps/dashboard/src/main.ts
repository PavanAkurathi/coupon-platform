import { cleanProductUrl, canAutoApplyCoupon, candidatesResponseSchema, merchantsResponseSchema, watchlistSchema, WATCHLIST_KEY,
  emptyWatchlist, type SavedItem, type WatchlistRequest, type Candidate, type Merchant } from '@repo/shared';
import { inExtension, send } from './store';
import { dollars, priceState, selectItems } from './view-model';

declare const __API_ORIGIN__: string | null | undefined;
const api = typeof __API_ORIGIN__ === 'string' ? __API_ORIGIN__ : null;
const root = document.querySelector<HTMLDivElement>('#app')!;
const dialog = document.querySelector<HTMLDialogElement>('#editor')!;
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const esc = (text: unknown) => String(text).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]!);
const date = (value: string) => new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let list = emptyWatchlist();
let loadError = '';
let search = '', filter = 'all', sort = 'recent';
let couponMessage = 'Refresh to check for reviewed codes. Availability depends on the store and your cart.';
let coupons: { merchant: Merchant; codes: Candidate[] }[] = [];
let couponLoading = false;
let toastTimer: ReturnType<typeof setTimeout>;
const icons: Record<string, string> = {
  list: '<rect x="5" y="7" width="14" height="14" rx="3"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  coupons: '<path d="M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4Z"/><path d="M14 7v2m0 2v2m0 2v2"/>',
  stores: '<path d="m3 9 2-5h14l2 5M4 10v10h16V10M9 20v-7h6v7"/><path d="M3 9c0 3 4 3 4 0 0 3 5 3 5 0 0 3 5 3 5 0 0 3 4 3 4 0"/>',
  rewards: '<path d="M4 9h16v4H4zm2 4v8h12v-8M12 9v12"/><path d="M12 9C3 9 6 0 12 6c6-6 9 3 0 3Z"/>',
  trust: '<path d="M12 3 4 6v5c0 5 8 10 8 10s8-5 8-10V6Z"/><path d="m8 12 3 3 5-6"/>',
  settings: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  arrow: '<path d="M6 18 18 6M6 6h12v12"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
};
const icon = (name: string, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? icons.list}</svg>`;
const page = () => ['list','coupons','stores','rewards','trust','settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'list';
function notify(message: string) {
  const toast = document.querySelector<HTMLDivElement>('#toast')!;
  toast.textContent = message; toast.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 5000);
}
async function mutate(request: WatchlistRequest, message: string) {
  try { list = await send(request); loadError = ''; render(); notify(message); }
  catch (error) { notify(error instanceof Error ? error.message : 'That change could not be saved.'); throw error; }
}
function shell() {
  const nav = [['list','My list'],['coupons','Coupons'],['stores','Stores'],['rewards','Rewards'],['trust','The Hold promise']];
  root.innerHTML = `<aside class="sidebar"><a href="#list" class="wordmark" aria-label="Hold home"><span class="brand-symbol">h</span>HOLD<span class="brand-period">.</span></a><div class="nav-label">SHOP ON YOUR TERMS</div><nav aria-label="Main navigation">${nav.map(([id,label]) => `<a href="#${id}" ${page()===id ? 'aria-current="page"':''}>${icon(id!)}<span>${label}</span>${id==='list'?`<span class="nav-count">${list.items.length}</span>`:''}</a>`).join('')}</nav><div class="sidebar-bottom"><div class="private-note">${icon('trust')}<div><strong>Yours to keep.</strong><p>Your list stays in this browser.</p></div></div><a class="settings-link" href="#settings">${icon('settings')} Settings & data</a></div></aside>
  <div class="workspace"><header class="topbar"><span class="crumb">YOUR SHOPPING, A LITTLE MORE CONSIDERED</span><span class="local-pill"><i></i>${inExtension?'Extension dashboard':'Browser-local dashboard'}</span></header><main id="content" tabindex="-1"></main><footer class="page-footer"><span>Good things are worth a little Hold.</span><a href="#trust">See how Hold works ${icon('arrow')}</a></footer></div>`;
}
function art() { return `<div class="hold-art" aria-hidden="true"><div class="art-ring"></div><div class="art-card"><span>ON MY TERMS</span><strong>h</strong><span>A LITTLE HOLD.</span></div><div class="art-tag"><span>WAIT FOR</span><strong>your price.</strong><i></i></div><span class="art-spark">✳</span></div>`; }
function intro(eyebrow: string, title: string, subtitle: string, action = '') { return `<div class="page-intro"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }
function chart(item: SavedItem, large = false) {
  const points = item.history;
  if (points.length < 2) return `<div class="no-history">${points.length ? 'One price recorded. Visit again to start a history.' : 'No price recorded yet.'}</div>`;
  const prices = points.map((point) => point.priceCents);
  const lo = Math.min(...prices), hi = Math.max(...prices), range = Math.max(hi-lo, 100);
  const coords = prices.map((value, index) => `${8 + index / (prices.length-1) * 304},${68 - (value-lo)/range * 52}`).join(' ');
  return `<svg class="chart ${large?'large':''}" viewBox="0 0 320 80" role="img" aria-label="Recorded item prices, ${esc(money(prices[0]!))} to ${esc(money(prices.at(-1)!))}. Open item for all observations."><path d="M8 69h304" class="chart-base"/><polyline points="${coords}"/></svg>`;
}
function itemCard(item: SavedItem) {
  const state = priceState(item), host = new URL(item.url).hostname.replace(/^www\./,'');
  return `<article class="item-card"><div class="item-visual"><span class="product-glyph">${icon('list')}</span><span class="category-pill">${esc(host)}</span><button class="more-button" data-edit="${item.id}" aria-label="Edit ${esc(item.title)}">•••</button></div><div class="item-body"><div class="item-evidence">${state.verified?'Seen on store page':state.latest?'Price entered by you':'Saved link'}${state.latest&&!state.fresh?' · needs a refresh':''}</div><button class="item-title" data-detail="${item.id}">${esc(item.title)}</button><div class="price-line"><strong>${state.latest ? money(state.latest.priceCents) : '—'}</strong><span>${item.targetCents ? `Target ${money(item.targetCents)}` : 'No target set'}</span></div>${chart(item)}<div class="item-bottom"><span class="${state.atTarget?'target-met':'muted'}">${state.atTarget ? 'Recorded price meets target' : state.latest ? `Recorded ${date(state.latest.observedAt)}` : 'Save a price to start'}</span><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="Visit ${esc(host)} for ${esc(item.title)}">${icon('arrow')}</a></div></div></article>`;
}
function listView() {
  const ready = list.items.filter((item) => priceState(item).atTarget).length;
  return `${intro('A LITTLE PATIENCE. A BETTER PURCHASE.', 'Your next good buy.', 'Keep the things you want. Come back when the price feels right.', '<button class="button primary" id="add-item"><span>＋</span> Save an item</button>')}
  <section class="hero-card"><div class="hero-copy"><span class="eyebrow">THE HOLD LIST</span><h2>Love it.<br>Hold it.<br><em>Make it yours.</em></h2><p>A home for your maybes, your someday purchases, and the things worth waiting for.</p><button class="text-button" id="how-to-save">How saving works <span>↗</span></button></div>${art()}<div class="hero-stats"><div><strong>${list.items.length.toString().padStart(2,'0')}</strong><span>saved items</span></div><div><strong>${list.items.filter((item)=>item.targetCents!==null).length.toString().padStart(2,'0')}</strong><span>price targets</span></div><div><strong id="target-count">${ready.toString().padStart(2,'0')}</strong><span>at your target*</span></div></div></section>
  <div class="section-heading"><h2>Your list <span>${list.items.length}</span></h2><div class="list-controls"><label class="search-box">${icon('search')}<input id="search" type="search" placeholder="Find a saved item" value="${esc(search)}" aria-label="Search saved items"></label><select id="sort" aria-label="Sort saved items"><option value="recent" ${sort==='recent'?'selected':''}>Recently updated</option><option value="price" ${sort==='price'?'selected':''}>Price: low to high</option><option value="name" ${sort==='name'?'selected':''}>Name: A to Z</option></select></div></div>
  <div class="filter-row" role="group" aria-label="Filter saved items">${[['all','All items'],['target','With a target'],['ready','At my target']].map(([id,label])=>`<button data-filter="${id}" class="filter ${filter===id?'selected':''}" aria-pressed="${filter===id}">${label}</button>`).join('')}</div><div id="items-region"></div><p class="footnote">*Based on the last 15 minutes of recorded item prices, before shipping and tax. A target match is not a confirmed saving. No monitoring while the browser is closed.</p>`;
}
function renderItems() {
  const region = document.querySelector('#items-region'); if (!region) return;
  const items = selectItems(list.items,search,filter,sort);
  region.innerHTML = loadError ? `<div class="empty-state error-panel"><h3>Your list needs attention.</h3><p>${esc(loadError)}</p><a href="#settings" class="button">Open data settings</a></div>` : items.length ? `<div class="item-grid">${items.map(itemCard).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">${icon('list')}</div><div><h3>${list.items.length?'Nothing matches this view.':'Make room for something good.'}</h3><p>${list.items.length?'Try another search or filter.':'Save your first item from a store page, or add a link here. No account needed.'}</p></div>${list.items.length?'<button class="button" id="reset-filters">Clear filters</button>':'<button class="button" id="empty-add">Save your first item <span>＋</span></button>'}</div>`;
  region.querySelector('#empty-add')?.addEventListener('click',()=>edit());
  region.querySelector('#reset-filters')?.addEventListener('click',()=>{ search='';filter='all';render(); });
  region.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((button)=>button.addEventListener('click',()=>edit(list.items.find((item)=>item.id===button.dataset.edit))));
  region.querySelectorAll<HTMLButtonElement>('[data-detail]').forEach((button)=>button.addEventListener('click',()=>detail(list.items.find((item)=>item.id===button.dataset.detail)!)));
}
function storesView() {
  const stores = [ ['Amazon','amazon.com','Product prices & visible coupons','Some product pages can be read. Coupon selection stays on Amazon; eligibility and totals must be confirmed there.'],
    ['Walmart','walmart.com','Product price comparison','Some public product prices can be checked. Shipping, condition and exact-item matches still determine whether a comparison is usable.'],
    ['Best Buy','bestbuy.com','Viewed product prices','Hold can read supported pages you visit. Background product requests have been blocked; cross-store coverage is incomplete.'],
    ['Other stores',null,'Coverage varies','Structured product pages may work when you visit. A recognized store is not a promise of coupon testing or a cheaper price.'] ];
  return `${intro('KNOW BEFORE YOU GO', 'A clear view of coverage.', 'A store name isn’t a promise. Here’s what the current extension can actually do.')}<div class="notice">Limited beta · Price checks work only when Hold can identify the exact item and verify the price. No Shopify merchant is enabled for automatic code testing.</div><div class="store-grid">${stores.map(([name,host,label,copy],i)=>`<article class="store-card"><div class="store-logo store-${i}">${esc(name![0])}</div><h2>${name}</h2><span class="small-label">${label}</span><p>${copy}</p>${host?`<a href="https://www.${host}/" target="_blank" rel="noopener noreferrer" class="text-button">Visit store ${icon('arrow')}</a>`:'<a href="#trust" class="text-button">What a price check needs ↗</a>'}</article>`).join('')}</div><div class="editorial-note"><span>01 / COVERAGE COMES FIRST</span><h2>A smaller promise,<br>kept properly.</h2><p>Affiliate-network feeds are planned to improve coverage. Partner stores, codes and payouts will appear only when access and evidence are in place.</p></div>`;
}
function couponsView() {
  return `${intro('REAL CODES. CLEAR EVIDENCE.', 'A code worth trying.', 'Reviewed public codes, with recent shopper confirmations. Your cart decides whether one works.', `<button class="button" id="refresh-coupons" ${couponLoading?'disabled':''}>${couponLoading?'Checking…':'Refresh codes'} ↻</button>`)}<div class="notice">${esc(couponMessage)}</div>${coupons.length?`<div class="coupon-grid">${coupons.flatMap(({merchant,codes})=>codes.map((code)=>`<article class="coupon-card"><span class="eyebrow">${esc(merchant.name)}</span><h2>${esc(code.code)}</h2><p>${code.confirmations} recent confirmations · last success ${date(code.lastConfirmedAt)}.</p><p>Eligibility varies. Previous success does not guarantee a discount on your order.</p><button class="button" data-copy="${esc(code.code)}" data-merchant="${merchant.id}">Copy code</button><span class="small-label">${code.expiresAt?`Expires ${date(code.expiresAt)}`:'No published expiry'}</span></article>`)).join('')}</div>`:`<div class="empty-state tall"><div class="empty-icon">${icon('coupons')}</div><h2>No reviewed codes to show.</h2><p>Hold won’t fill this space with guesses. Approved offers will show their evidence here when available.</p><a class="text-button" href="#stores">See current store coverage ↗</a></div>`}`;
}
function rewardsView() { return `${intro('NO POINTS WITHOUT PROOF', 'Savings first. Rewards later.', 'Cash back and reward payouts are not available in this version.')}<div class="reward-panel"><div class="reward-art">${icon('rewards')}</div><span class="eyebrow">NOT AVAILABLE YET</span><h2>A real reward<br>needs a real settlement.</h2><p>There are no points to activate or balances to redeem. Hold’s current focus is helping you make a better purchase.</p><a href="#list" class="button primary">Back to my list →</a></div><div class="principle-grid"><article><span>01</span><h3>Prices come first.</h3><p>Commission data stays separate from price ranking.</p></article><article><span>02</span><h3>Your savings stay yours.</h3><p>We don’t subtract a fee from a coupon discount.</p></article><article><span>03</span><h3>No imaginary earnings.</h3><p>Pending, confirmed and reversed earnings need merchant evidence before rewards can launch.</p></article></div>`; }
function trustView() { return `${intro('THE HOLD PROMISE', 'A little help.<br>A lot less guesswork.', 'Clear evidence, useful comparisons, and the final decision in your hands.')}<div class="principle-grid trust-grid">${[
  ['The exact item.','A cheaper price only matters if it buys the same thing. Product identifiers, model, condition, quantity and bundle differences all count.'],
  ['The full picture.','A lower-price alert needs fresh evidence and known shipping. Comparisons are before tax; check the final total on the store.'],
  ['Your choice, every time.','Hold does not submit orders. Retailer links open when you click. Coupon trials require explicit shopper action and reviewed attribution.'],
  ['A list that stays yours.','Saved products and their price history stay in this browser. The standalone dashboard and extension have separate lists; backups let you transfer them deliberately.'],
  ['Clear limits.','Saving an item does not create background monitoring or email alerts. With price alerts enabled, the extension can update saved prices as you revisit readable pages.'],
  ['Evidence over incentives.','Ranking is independent of commission. Amazon remains comparison only. Affiliate-network activation and cash back are not part of this dashboard.'],
].map(([title,body],i)=>`<article><span>0${i+1}</span><h3>${title}</h3><p>${body}</p></article>`).join('')}</div>`; }
function settingsView() { return `${loadError?`<div class="notice">${esc(loadError)} Existing data was left untouched.</div>`:''}${intro('YOUR LIST. YOUR CONTROL.', 'Keep it. Move it. Clear it.', 'No account or cloud sync. Export a backup before changing browsers or clearing browser data.')}<div class="settings-card"><div><h2>Saved items & history</h2><p>${list.items.length} saved items in ${inExtension?'the Hold extension':'this website’s browser storage'}. The two lists do not sync automatically.</p></div><div class="setting-actions"><button class="button" id="export" ${loadError?'disabled':''}>Export backup</button><button class="button" id="import">Import backup</button><input type="file" id="import-file" accept="application/json,.json" hidden></div></div><div class="settings-card"><div><h2>About imported prices</h2><p>Imported history is labeled “entered by you.” A backup cannot prove that Hold observed a store price. Import adds new links and keeps existing entries.</p></div></div>${!inExtension?'<div class="settings-card"><div><h2>Recover unreadable data</h2><p>Download the raw saved file if the list cannot be opened. Reset only after keeping a copy.</p></div><button class="button" id="recovery">Export recovery copy</button></div>':''}<div class="settings-card danger"><div><h2>Clear this Hold list</h2><p>Deletes saved items, targets and price history in this dashboard. This cannot be undone without your backup.</p></div><button class="button danger-button" id="clear-data">Clear list</button></div>`; }
function render() {
  shell(); const content = document.querySelector('#content')!;
  content.innerHTML = ({ list: listView, stores: storesView, coupons: couponsView, rewards: rewardsView, trust: trustView, settings: settingsView })[page()]!();
  document.title = `${page()==='list'?'Your list':page()[0]!.toUpperCase()+page().slice(1)} · Hold`;
  if (page()==='list') {
    renderItems();
    document.querySelector('#add-item')?.addEventListener('click',()=>edit());
    document.querySelector('#how-to-save')?.addEventListener('click',howToSave);
    document.querySelector<HTMLInputElement>('#search')?.addEventListener('input',(event)=>{search=(event.target as HTMLInputElement).value;renderItems();});
    document.querySelector<HTMLSelectElement>('#sort')?.addEventListener('change',(event)=>{sort=(event.target as HTMLSelectElement).value;renderItems();});
    document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button)=>button.addEventListener('click',()=>{filter=button.dataset.filter!;render();}));
  }
  document.querySelector('#refresh-coupons')?.addEventListener('click',()=>void refreshCoupons());
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button)=>button.addEventListener('click',()=>void copyCoupon(button)));
  document.querySelector('#export')?.addEventListener('click',()=>download(JSON.stringify(list,null,2),'hold-list.json'));
  document.querySelector('#recovery')?.addEventListener('click',()=>download(localStorage.getItem(WATCHLIST_KEY)??'null','hold-recovery.json'));
  document.querySelector('#import')?.addEventListener('click',()=>document.querySelector<HTMLInputElement>('#import-file')!.click());
  document.querySelector('#import-file')?.addEventListener('change',(event)=>void importFile((event.target as HTMLInputElement).files?.[0]));
  document.querySelector('#clear-data')?.addEventListener('click',()=>confirmAction('Clear your Hold list?', 'All saved items and price history in this dashboard will be deleted. Export a backup first if you may want them again.', 'Clear list',()=>mutate({type:'hold-clear'},'Your list has been cleared.')));
}
function openDialog(html: string) {
  dialog.innerHTML = `<button class="close-dialog" aria-label="Close dialog">×</button>${html}`;
  dialog.querySelector('.close-dialog')!.addEventListener('click',()=>dialog.close());
  if (!dialog.open) dialog.showModal();
}
function howToSave() { openDialog(`<div class="eyebrow">A LIST WITHOUT THE NOISE</div><h2 id="dialog-title">Save it for later.</h2><ol class="steps"><li><strong>From the extension</strong><p>On a readable product page, open Hold and choose Save item. The packaged dashboard keeps the page’s price and identity.</p></li><li><strong>From this dashboard</strong><p>Add a product link and an optional price and target. Prices you type are labeled as yours.</p></li><li><strong>Come back with context</strong><p>See your recorded history and revisit the store. There are no scheduled checks or background alerts while your browser is closed.</p></li></ol><button class="button primary" id="dialog-add">Save a link →</button>`); dialog.querySelector('#dialog-add')!.addEventListener('click',()=>edit()); }
function edit(item?: SavedItem) {
  openDialog(`<div class="eyebrow">MAKE A LITTLE ROOM</div><h2 id="dialog-title">${item?'Edit your saved item.':'Put it on Hold.'}</h2><p class="dialog-lead">${item?'Record a new price or change what you’re hoping to pay.':'A link is enough to start. Add a price whenever you’re ready.'}</p><form id="item-form"><label>Product name<input name="title" required maxlength="300" value="${esc(item?.title??'')}" placeholder="What caught your eye?"></label><label>Product link<input name="url" type="url" required maxlength="2000" value="${esc(item?.url??'')}" ${item?'readonly':''} placeholder="https://store.com/product"></label><div class="form-row"><label>${item?'Record a new price':'Price you saw'} (USD)<input name="price" inputmode="decimal" placeholder="Optional · e.g. 129.99"></label><label>Your target price (USD)<input name="target" inputmode="decimal" value="${item?.targetCents ? (item.targetCents/100).toFixed(2):''}" placeholder="Optional · e.g. 99.00"></label></div><p class="form-note">Prices entered here are personal notes, before shipping and tax. Tracking parameters are removed from saved links.</p><p class="form-error" id="form-error" role="alert"></p><button class="button primary" type="submit">${item?'Save changes':'Save item'} →</button>${item?'<button class="text-button remove-item" type="button" id="remove-item">Remove from my list</button>':''}</form>`);
  dialog.querySelector<HTMLFormElement>('#item-form')!.addEventListener('submit',async(event)=>{
    event.preventDefault(); const form=event.currentTarget as HTMLFormElement, values=new FormData(form), button=form.querySelector<HTMLButtonElement>('[type=submit]')!; button.disabled=true;
    try { const url=cleanProductUrl(String(values.get('url'))); if(!url) throw new Error('Use a public HTTPS product link without a sign-in or custom port.');
      const input={title:String(values.get('title')),url,priceCents:dollars(String(values.get('price'))),targetCents:dollars(String(values.get('target')))};
      await mutate({type:'hold-put-item',item:input},item?'Changes saved.':'Saved to your Hold list.');dialog.close();
    } catch(error) { dialog.querySelector('#form-error')!.textContent=error instanceof Error?error.message:'Could not save.'; } finally {button.disabled=false;}
  });
  dialog.querySelector('#remove-item')?.addEventListener('click',()=>confirmAction('Remove this item?',item!.title,'Remove item',()=>mutate({type:'hold-remove',id:item!.id},'Item removed.')));
}
function detail(item: SavedItem) {
  openDialog(`<div class="eyebrow">YOUR RECORDED HISTORY</div><h2 id="dialog-title">${esc(item.title)}</h2><p class="dialog-lead">${esc(new URL(item.url).hostname)} · ${item.targetCents?`Target ${money(item.targetCents)}`:'No target set'}</p>${chart(item,true)}<p class="form-note">Item price before shipping and tax. These observations are not purchase receipts or confirmed savings.</p><div class="history-table"><table><thead><tr><th>Date</th><th>Price</th><th>Source</th></tr></thead><tbody>${[...item.history].reverse().map((point)=>`<tr><td>${date(point.observedAt)}</td><td>${money(point.priceCents)}</td><td>${point.source==='page'?'Store page':'Entered by you'}</td></tr>`).join('')||'<tr><td colspan="3">No price recorded yet.</td></tr>'}</tbody></table></div><div class="dialog-actions"><button class="button" id="detail-edit">Edit item</button><a class="button primary" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Visit store ↗</a></div>`);
  dialog.querySelector('#detail-edit')!.addEventListener('click',()=>edit(item));
}
function confirmAction(title:string,body:string,label:string,action:()=>Promise<unknown>) {
  openDialog(`<h2 id="dialog-title">${esc(title)}</h2><p class="dialog-lead">${esc(body)}</p><div class="dialog-actions"><button class="button" id="cancel">Keep it</button><button class="button danger-button" id="confirm">${esc(label)}</button></div>`);
  dialog.querySelector('#cancel')!.addEventListener('click',()=>dialog.close());
  dialog.querySelector<HTMLButtonElement>('#confirm')!.addEventListener('click',async(event)=>{const button=event.currentTarget as HTMLButtonElement;button.disabled=true;try {await action();dialog.close();}catch{}finally{button.disabled=false;}});
}
function download(content:string,filename:string) { const url=URL.createObjectURL(new Blob([content],{type:'application/json'})); const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
async function importFile(file?:File) { if(!file)return; try {if(file.size>10_000_000)throw new Error('Choose a Hold backup smaller than 10 MB.'); const backup=watchlistSchema.parse(JSON.parse(await file.text())); const before=list.items.length;list=await send({type:'hold-import',list:backup});loadError='';render();notify(`Imported ${list.items.length-before} new items. Imported prices are personal notes.`);}catch(error){notify(error instanceof Error&&error.message.length<200?error.message:'This is not a valid Hold backup. Your list was not changed.');} }
async function getJson(path:string) { if(!api)throw new Error('Reviewed coupon service is not connected in this standalone dashboard.');const response=await fetch(`${api}${path}`,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('The coupon service is unavailable. Please try again later.');return response.json(); }
const currentCode=(code:Candidate)=>canAutoApplyCoupon(code)&&Date.parse(code.lastConfirmedAt)<=Date.now()&&Date.parse(code.lastConfirmedAt)>=Date.now()-30*24*60*60_000&&(!code.expiresAt||Date.parse(code.expiresAt)>Date.now());
async function refreshCoupons() { couponLoading=true;render();try {const {merchants}=merchantsResponseSchema.parse(await getJson('/v1/merchants')); const results=[];let failures=0;
  for(const merchant of merchants.slice(0,20)){try {const response=candidatesResponseSchema.parse(await getJson(`/v1/coupons/candidates?merchantId=${encodeURIComponent(merchant.id)}&limit=10`));if(response.merchantId!==merchant.id)throw new Error('Merchant mismatch');const codes=response.candidates.filter(currentCode);if(codes.length)results.push({merchant,codes});}catch{failures++;}}
  coupons=results;couponMessage=failures?`${failures} stores could not be checked. Showing only codes with current evidence.`:merchants.length?'Checked enabled stores. Review your final total at checkout.':'No stores are enabled for coupon testing yet. There are no reviewed codes to show.';
  }catch(error){coupons=[];couponMessage=error instanceof Error?error.message:'Codes could not be checked.';}finally{couponLoading=false;render();} }
async function copyCoupon(button:HTMLButtonElement) { try {button.disabled=true;const merchantId=button.dataset.merchant!;const response=candidatesResponseSchema.parse(await getJson(`/v1/coupons/candidates?merchantId=${encodeURIComponent(merchantId)}&limit=20`));const code=response.merchantId===merchantId?response.candidates.find((entry)=>entry.code===button.dataset.copy&&currentCode(entry)):null;if(!code)throw new Error('This code no longer has current approval. Refresh the list.');await navigator.clipboard.writeText(code.code);notify('Code copied. Confirm eligibility and your final total at the store.');}catch(error){notify(error instanceof Error?error.message:'Could not copy the code.');}finally{button.disabled=false;} }
window.addEventListener('hashchange',()=>{render();document.querySelector<HTMLElement>('#content')?.focus();});
window.addEventListener('storage',async(event)=>{if(event.key===WATCHLIST_KEY&&!inExtension){try{list=await send({type:'hold-list'});loadError='';render();}catch(error){loadError=String(error);render();}}});
window.addEventListener('focus',()=>{void send({type:'hold-list'}).then((updated)=>{list=updated;loadError='';if(!dialog.open)render();}).catch(()=>undefined);});
setInterval(()=>{if(page()==='list'&&!dialog.open){renderItems();const count=document.querySelector('#target-count');if(count)count.textContent=list.items.filter((item)=>priceState(item).atTarget).length.toString().padStart(2,'0');}},60_000);
try { list=await send({type:'hold-list'}); } catch(error){loadError=error instanceof Error?error.message:'Your list could not be opened.';}
render();
