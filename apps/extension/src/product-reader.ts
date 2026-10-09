import { amazonProductAsin, cleanProductUrl, normalizeGtin, normalizeModel, pageProductSchema, type PageProduct } from '@repo/shared';

// Reads the product the shopper is looking at, on the device. Three readers, each
// observed live on October 8, 2026 (Philips Norelco MG5965/49):
// - Amazon: no structured data; title, buy-box price, detail table model number.
// - Walmart: no Product JSON-LD; the server-rendered __NEXT_DATA__ product record.
// - Everything else: schema.org Product JSON-LD (eBay, Best Buy, most stores).
// On the shopper's page a price is accepted only when the same amount is visible.
// The same readers also parse store pages fetched in the background (no layout):
// there, duplicate hidden blocks must agree and Amazon's buy-box amount is required.

// The page being read: the live document, or a fetched one parsed in the offscreen document.
// buyBoxCents: from Amazon's own offer list, for fetched pages with several purchase modes.
export type Page = { doc: Document; url: URL; live: boolean; buyBoxCents?: number | null };
export type ProductRead =
  | { status: 'product'; product: PageProduct }
  | { status: 'not_product' | 'unrecognized'; reason: string };

const MERCHANT_NAMES: Record<string, string> = {
  'amazon.com': 'Amazon', 'ebay.com': 'eBay', 'bestbuy.com': 'Best Buy', 'walmart.com': 'Walmart', 'target.com': 'Target',
  'costco.com': 'Costco', 'homedepot.com': 'The Home Depot', 'lowes.com': "Lowe's", 'newegg.com': 'Newegg',
  'bhphotovideo.com': 'B&H Photo', 'macys.com': "Macy's", 'kohls.com': "Kohl's", 'ulta.com': 'Ulta Beauty',
  'sephora.com': 'Sephora', 'cvs.com': 'CVS', 'walgreens.com': 'Walgreens', 'samsclub.com': "Sam's Club",
};
// Marketplaces where a listing without a stated condition may be used.
const MARKETPLACES = new Set(['ebay.com', 'mercari.com', 'poshmark.com', 'etsy.com', 'facebook.com', 'craigslist.org', 'offerup.com']);
const rootDomain = (host: string) => host.toLowerCase().split('.').slice(-2).join('.');
export function merchantName(host: string): string {
  return MERCHANT_NAMES[rootDomain(host)] ?? host.replace(/^www\./, '');
}

const clean = (value: string | null | undefined) => (value ?? '').replace(/[‎‏ ]/g, ' ').replace(/\s+/g, ' ').trim();
function visible(element: Element | null): element is HTMLElement {
  if (!element || !element.isConnected || !element.getClientRects().length) return false;
  for (let node: HTMLElement | null = element as HTMLElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  return true;
}
// Fetched documents have no layout: every matching element counts.
const shown = (page: Page) => (element: Element) => !page.live || visible(element);
export function dollarsToCents(raw: unknown): number | null {
  const text = typeof raw === 'number' ? raw.toFixed(2) : typeof raw === 'string' ? raw.trim().replace(/^\$/, '').replaceAll(',', '') : '';
  const match = text.match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}
const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// The structured price must be one the shopper can see, or it may be stale.
function priceVisible(page: Page, cents: number): boolean {
  if (!page.live) return true;
  const text = clean(page.doc.body.innerText).replace(/\$\s*(\d[\d,]*)\s*\.\s*(\d{2})/g, '$$$1.$2');
  return text.includes(usd(cents));
}
function packQuantity(title: string): number {
  const match = title.match(/\bpack of (\d{1,3})\b|\b(\d{1,3})[- ]?(?:pack|pk|count|ct)\b/i);
  const value = Number(match?.[1] ?? match?.[2] ?? 1);
  return Number.isInteger(value) && value >= 1 && value <= 1000 ? value : 1;
}
function conditionFromTitle(title: string): 'used' | 'refurbished' | null {
  if (/\b(renewed|refurbished|reconditioned|open[- ]box)\b/i.test(title)) return 'refurbished';
  if (/\b(pre-owned|preowned|used)\b/i.test(title)) return 'used';
  return null;
}
function finish(raw: unknown): ProductRead {
  const parsed = pageProductSchema.safeParse(raw);
  return parsed.success ? { status: 'product', product: parsed.data }
    : { status: 'unrecognized', reason: 'This product could not be identified exactly (model code, UPC or price missing).' };
}

// ---------- Amazon ----------
function amazonRows(document: Document): Map<string, string> {
  const rows = new Map<string, string>();
  // #prodDetails: the newer "Product information" tables (Model Number, UPC), seen October 8, 2026.
  for (const row of document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, #technicalSpecifications_section_1 tr, #productOverview_feature_div tr, #prodDetails tr')) {
    const key = clean(row.querySelector('th, td')?.textContent).toLowerCase();
    const value = clean(row.querySelector('td:last-child')?.textContent);
    if (key && value && !rows.has(key)) rows.set(key, value);
  }
  for (const item of document.querySelectorAll('#detailBullets_feature_div li')) {
    const match = clean(item.textContent).match(/^([^:]{1,60}?)\s*:\s*(.+)$/);
    if (match && !rows.has(match[1]!.toLowerCase())) rows.set(match[1]!.toLowerCase(), match[2]!);
  }
  return rows;
}
function amazonPrice(page: Page): number | null {
  const document = page.doc;
  const toPay = [...document.querySelectorAll('#corePriceDisplay_desktop_feature_div .priceToPay, #corePrice_feature_div .priceToPay')].filter(shown(page));
  const priceOf = (price: Element) => {
    const symbol = clean(price.querySelector('.a-price-symbol')?.textContent);
    const whole = clean(price.querySelector('.a-price-whole')?.textContent).replace(/[.,]/g, '');
    const fraction = clean(price.querySelector('.a-price-fraction')?.textContent);
    return (!page.live || symbol === '$') && /^\d{2}$/.test(fraction) ? dollarsToCents(`${whole}.${fraction}`) : null;
  };
  // Amazon's own buy-box amounts. Pages with several purchase modes (new, used,
  // list price) carry one per mode; the shown price must be one of them.
  const amounts = new Set([...document.querySelectorAll<HTMLInputElement>('input[name="items[0.base][customerVisiblePrice][amount]"]')].map((input) => dollarsToCents(input.value)));
  const currencies = new Set([...document.querySelectorAll<HTMLInputElement>('input[name="items[0.base][customerVisiblePrice][currencyCode]"]')].map((input) => input.value));
  if (amounts.has(null) || (amounts.size && (currencies.size !== 1 || !currencies.has('USD')))) return null;
  if (!page.live) {
    // No layout to tell purchase modes apart: the buy box must be unambiguous, or
    // named by Amazon's own offer list.
    const buyBox = amounts.size === 1 ? [...amounts][0]! : page.buyBoxCents != null && amounts.has(page.buyBoxCents) ? page.buyBoxCents : null;
    if (buyBox === null) return null;
    return new Set(toPay.map(priceOf)).has(buyBox) ? buyBox : null;
  }
  let seen: number | null = null;
  if (toPay.length) {
    const prices = new Set(toPay.map(priceOf));
    if (prices.size !== 1) return null;
    seen = [...prices][0]!;
  } else {
    const offscreen = [...document.querySelectorAll('#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen')]
      .map((node) => clean(node.textContent)).filter(Boolean);
    if (new Set(offscreen).size !== 1) return null;
    seen = dollarsToCents(offscreen[0]);
  }
  if (seen === null || (amounts.size > 0 && !amounts.has(seen))) return null;
  return seen;
}
function amazonShipping(document: Document, priceCents: number): number | null {
  const text = clean(document.querySelector('#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE, #mir-layout-DELIVERY_BLOCK')?.textContent);
  const minimum = text.match(/\bover \$(\d+(?:\.\d{2})?)/i);
  if (/^FREE delivery\b/i.test(text)) return !minimum || priceCents >= (dollarsToCents(minimum[1]) ?? Infinity) ? 0 : null;
  return dollarsToCents(text.match(/^\$(\d+\.\d{2}) delivery\b/i)?.[1]) ?? null;
}
// The buy box alone (ASIN and shown price), for checks within Amazon that need no model code.
export function amazonBuyBox(): { asin: string; priceCents: number } | null {
  const page: Page = { doc: document, url: new URL(location.href), live: true };
  const asin = amazonProductAsin(page.url.href);
  if (!asin || window !== window.top) return null;
  const ids = new Set([...document.querySelectorAll<HTMLInputElement>('input#ASIN, input#asin')].map((input) => input.value));
  if (ids.size !== 1 || !ids.has(asin)) return null;
  const priceCents = amazonPrice(page);
  return priceCents === null ? null : { asin, priceCents };
}
function readAmazon(page: Page, now: Date): ProductRead {
  const document = page.doc;
  const asin = amazonProductAsin(page.url.href);
  if (!asin) return { status: 'not_product', reason: 'Not an Amazon product page.' };
  const ids = new Set([...document.querySelectorAll<HTMLInputElement>('input#ASIN, input#asin')].map((input) => input.value));
  // Fetched pages carry a second, empty #productTitle placeholder.
  const titles = new Set([...document.querySelectorAll('#productTitle')].filter(shown(page)).map((node) => clean(node.textContent)).filter(Boolean));
  if (ids.size !== 1 || !ids.has(asin) || titles.size !== 1) return { status: 'unrecognized', reason: 'The Amazon product is still loading or changed.' };
  const title = [...titles][0]!.slice(0, 300);
  const rows = amazonRows(document);
  const model = normalizeModel(rows.get('item model number') ?? rows.get('model number') ?? rows.get('model name') ?? null);
  const gtins = new Set(clean(rows.get('upc') ?? rows.get('ean') ?? rows.get('gtin') ?? '').split(' ').map(normalizeGtin).filter(Boolean));
  const byline = clean(document.querySelector('#bylineInfo')?.textContent).match(/^(?:Visit the (.+?) Store|Brand: (.+))$/i);
  const brand = clean(rows.get('brand') ?? rows.get('brand name') ?? rows.get('manufacturer') ?? byline?.[1] ?? byline?.[2]) || null;
  const priceCents = amazonPrice(page);
  if (priceCents === null) return { status: 'unrecognized', reason: 'Amazon shows no single buy-box price for this product.' };
  const usedSelected = document.querySelector('#usedAccordionRow.a-accordion-active, #usedBuySection');
  const availability = clean(document.querySelector('#availability')?.textContent);
  const seller = clean(document.querySelector('[offer-display-feature-name="desktop-merchant-info"] .offer-display-feature-text')?.textContent).slice(0, 100) || null;
  return finish({
    identity: { brand: brand?.slice(0, 160) ?? null, model, gtin: gtins.size === 1 ? [...gtins][0] : null,
      // Colour names differ between stores ("Steel" vs "Silver"); the model code pins the variant.
      variant: null,
      packQuantity: packQuantity(title), condition: usedSelected ? 'used' : conditionFromTitle(title) ?? 'new' },
    title, merchant: 'Amazon', merchantDomain: 'www.amazon.com', seller, url: `https://www.amazon.com/dp/${asin}`,
    priceCents, shippingCents: amazonShipping(document, priceCents), currency: 'USD',
    availability: /in stock|left in stock/i.test(availability) ? 'in_stock' : /unavailable|out of stock/i.test(availability) ? 'out_of_stock' : 'unknown',
    observedAt: now.toISOString(), reader: 'amazon',
  });
}

// ---------- Walmart ----------
type WalmartProduct = {
  usItemId?: string; name?: string; brand?: string; model?: string; upc?: string; color?: unknown; conditionType?: string;
  sellerName?: string; availabilityStatus?: string; priceInfo?: { currentPrice?: { price?: number } };
  trustBadges?: { type?: string }[];
};
// Walmart ships free from $35 for everyone; the item's own free-shipping badge must also say so.
const WALMART_FREE_SHIPPING_FROM_CENTS = 3500;
export function walmartData(document: Document): any {
  try { return JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent ?? ''); } catch { return undefined; }
}
function readWalmart(page: Page, now: Date): ProductRead {
  const document = page.doc;
  const id = page.url.pathname.match(/^\/ip\/(?:[^/]+\/)?(\d{5,20})$/)?.[1];
  if (!id) return { status: 'not_product', reason: 'Not a Walmart product page.' };
  const product: WalmartProduct | undefined = walmartData(document)?.props?.pageProps?.initialData?.data?.product;
  // Client-side navigation leaves the first page's record behind; it must be this item.
  if (!product || product.usItemId !== id || !product.name) return { status: 'unrecognized', reason: 'The Walmart product is still loading or changed.' };
  const priceCents = dollarsToCents(product.priceInfo?.currentPrice?.price);
  if (priceCents === null || !priceVisible(page, priceCents)) return { status: 'unrecognized', reason: 'Walmart shows no single current price for this product.' };
  const freeShipping = product.trustBadges?.some((badge) => badge.type === 'FREE_SHIPPING') && priceCents >= WALMART_FREE_SHIPPING_FROM_CENTS;
  const title = clean(product.name).slice(0, 300);
  const condition = /^new$/i.test(product.conditionType ?? '') ? 'new' : conditionFromTitle(title) ?? 'unknown';
  return finish({
    identity: { brand: clean(product.brand) || null, model: normalizeModel(product.model ?? null), gtin: normalizeGtin(product.upc ?? ''),
      variant: null,
      packQuantity: packQuantity(title), condition },
    title, merchant: 'Walmart', merchantDomain: page.url.hostname, seller: clean(product.sellerName).slice(0, 100) || null,
    url: cleanProductUrl(page.url.href), priceCents, shippingCents: freeShipping ? 0 : null, currency: 'USD',
    availability: product.availabilityStatus === 'IN_STOCK' ? 'in_stock' : product.availabilityStatus === 'OUT_OF_STOCK' ? 'out_of_stock' : 'unknown',
    observedAt: now.toISOString(), reader: 'walmart',
  });
}

// ---------- schema.org Product JSON-LD ----------
type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
const types = (node: Json) => asArray(node['@type']).map(String);
const textOf = (value: unknown): string | null => {
  if (typeof value === 'string' || typeof value === 'number') return clean(String(value)) || null;
  if (isObject(value)) return textOf(value.name);
  if (Array.isArray(value) && value.length === 1) return textOf(value[0]);
  return null;
};
export function jsonLdProducts(scripts: string[]): Json[] {
  const nodes: Json[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4) return;
    for (const item of asArray(value)) {
      if (!isObject(item)) continue;
      if (types(item).includes('Product')) nodes.push(item);
      if (item['@graph']) visit(item['@graph'], depth + 1);
      if (isObject(item.mainEntity)) visit(item.mainEntity, depth + 1);
    }
  };
  for (const script of scripts) { try { visit(JSON.parse(script), 0); } catch { /* Ignore malformed blocks. */ } }
  return nodes;
}
const SCHEMA = /^https?:\/\/schema\.org\//i;
function schemaEnum(value: unknown): string { return (textOf(value) ?? '').replace(SCHEMA, ''); }
function conditionOf(offer: Json, title: string, host: string): 'new' | 'used' | 'refurbished' | 'unknown' {
  const value = schemaEnum(offer.itemCondition);
  if (/^NewCondition$/i.test(value)) return conditionFromTitle(title) ?? 'new';
  if (/^UsedCondition$/i.test(value)) return 'used';
  if (/^RefurbishedCondition$/i.test(value)) return 'refurbished';
  if (value) return 'unknown';
  // Retailers that omit itemCondition sell new; marketplace listings stay unknown.
  return MARKETPLACES.has(rootDomain(host)) ? 'unknown' : conditionFromTitle(title) ?? 'new';
}

// A page price is only useful as an unrestricted offer when its eligibility is
// understood. Never discard a membership/coupon constraint and later mark it false.
const RESTRICTED_OFFER_FIELDS = new Set([
  'eligibleCustomerType', 'eligibleQuantity', 'eligibleTransactionVolume', 'eligibleRegion', 'ineligibleRegion',
  'validForMemberTier', 'membershipPointsEarned', 'discountCode', 'couponCode', 'requiresCoupon', 'requiresMembership',
]);
function restrictedOffer(offer: Json, now: Date): boolean {
  const check = (value: unknown, depth = 0): boolean => {
    if (depth > 8) return true;
    if (Array.isArray(value)) return value.some((item) => check(item, depth + 1));
    if (!isObject(value)) return false;
    for (const [key, item] of Object.entries(value)) {
      if (RESTRICTED_OFFER_FIELDS.has(key) && item !== null && item !== false && item !== undefined) return true;
      if ((key === 'name' || key === 'description') && typeof item === 'string'
        && /\b(?:coupon|promo(?:tion)? code|members?[- ]only|membership|subscribe|subscription)\b/i.test(item)) return true;
      if (['validFrom', 'availabilityStarts', 'validThrough', 'priceValidUntil', 'availabilityEnds'].includes(key)) {
        if (typeof item !== 'string' || !Number.isFinite(Date.parse(item))) return true;
        const starts = key === 'validFrom' || key === 'availabilityStarts';
        if (starts ? Date.parse(item) > now.getTime() : Date.parse(item) <= now.getTime()) return true;
      }
      if (check(item, depth + 1)) return true;
    }
    return false;
  };
  return check(offer);
}

function shippingOf(offer: Json): number | null {
  const details = asArray(offer.shippingDetails);
  if (!details.length || details.some((detail) => !isObject(detail))) return null;
  const rates: number[] = [];
  for (const detail of details as Json[]) {
    // State/postcode, order-value, membership and other conditional tariffs need
    // shopper eligibility evidence that this reader deliberately does not collect.
    if (Object.keys(detail).some((key) => !['@type', 'shippingRate', 'shippingDestination', 'deliveryTime'].includes(key))) return null;
    const destinations = asArray(detail.shippingDestination);
    if (!destinations.length || destinations.some((region) => !isObject(region)
      || Object.keys(region).some((key) => !['@type', 'addressCountry'].includes(key)))) return null;
    const countries = (destinations as Json[]).map((region) => textOf(region.addressCountry));
    if (countries.some((country) => !country)) return null;
    if (!countries.some((country) => /^(US|USA)$/i.test(country!))) continue;
    const rate = detail.shippingRate;
    if (!isObject(rate) || rate.currency !== 'USD'
      || Object.keys(rate).some((key) => !['@type', 'value', 'currency'].includes(key))) return null;
    const cents = /^(?:0|0\.0|0\.00)$/.test(String(rate.value)) ? 0 : dollarsToCents(rate.value);
    if (cents === null) return null;
    rates.push(cents);
  }
  const cents = new Set(rates);
  return cents.size === 1 ? [...cents][0]! : null;
}
function samePage(url: string | null, here: string | null): boolean {
  return Boolean(url && here && (url === here || here.startsWith(url) || url.startsWith(here)));
}
function absolute(raw: string, base: URL): string | null {
  try { return cleanProductUrl(new URL(raw, base).href); } catch { return null; }
}

const PRODUCT_SCOPE = '[itemscope][itemtype~="https://schema.org/Product"], [itemscope][itemtype~="http://schema.org/Product"]';
function jsonLdPriceVisible(page: Page, title: string, cents: number): boolean {
  if (!page.live) return true;
  const matches = (element: Element) => {
    if (!visible(element)) return false;
    const text = clean((element as HTMLElement).innerText);
    const values = [...text.matchAll(/(?:US\s*)?\$\s*(\d{1,3}(?:,\d{3})*|\d+)\s*\.\s*(\d{2})(?!\d)/g)]
      .map((match) => dollarsToCents(`${match[1]}.${match[2]}`));
    if (!values.length) values.push(dollarsToCents(text));
    return values.length > 0 && values.every((value) => value === cents);
  };
  // This eBay primary-price region was observed in the live integration. Do not
  // invent selectors for other stores or use a recommendation's matching amount.
  if (page.url.hostname === 'www.ebay.com') {
    const prices = [...page.doc.querySelectorAll('.x-price-primary')].filter(visible);
    return prices.length === 1 && matches(prices[0]!);
  }
  // Most stores (Best Buy among them) publish JSON-LD without microdata scopes.
  if (!page.doc.querySelector(PRODUCT_SCOPE)) return priceVisible(page, cents);
  const scopes = [...page.doc.querySelectorAll(PRODUCT_SCOPE)].filter(visible).filter((scope) =>
    [...scope.querySelectorAll('[itemprop~="name"]')].some((name) => visible(name)
      && name.closest(PRODUCT_SCOPE) === scope && clean(name.innerText).toLowerCase() === title.toLowerCase()));
  if (scopes.length !== 1) return false;
  const scope = scopes[0]!;
  const prices = [...scope.querySelectorAll('[itemprop~="price"]')]
    .filter((price) => price.closest(PRODUCT_SCOPE) === scope && visible(price));
  return prices.length > 0 && prices.every(matches);
}
export function readJsonLd(page: Page, now: Date): ProductRead {
  const products = jsonLdProducts([...page.doc.querySelectorAll('script[type="application/ld+json"]')].map((script) => script.textContent ?? ''));
  if (!products.length) return { status: 'not_product', reason: 'No product information on this page.' };
  const here = cleanProductUrl(page.url.href);
  const own = products.filter((node) => {
    const urls = [node.url, ...asArray(node.offers).filter(isObject).map((offer) => offer.url)].map((url) => typeof url === 'string' ? absolute(url, page.url) : null);
    return here && urls.some((url) => samePage(url, here));
  });
  // A page with a single Product describes that product (Best Buy's JSON-LD URL omits
  // the /sku/ suffix of the page URL); several Products need a URL match.
  const candidates = products.length === 1 ? products : own;
  if (candidates.length !== 1) return { status: 'unrecognized', reason: 'This page lists several products.' };
  const node = candidates[0]!;
  const title = clean(textOf(node.name)).slice(0, 300);
  const host = page.url.hostname;
  // One explicit, unrestricted USD Offer for this exact page. Aggregate offers,
  // mixed currencies, variant offers and unknown eligibility never become a price.
  const pool = asArray(node.offers).filter(isObject);
  if (!pool.length || pool.some((offer) => !types(offer).includes('Offer') || types(offer).includes('AggregateOffer')
    || textOf(offer.priceCurrency) !== 'USD' || dollarsToCents(offer.price) === null || restrictedOffer(offer, now)
    || (offer.url !== undefined && (typeof offer.url !== 'string' || !samePage(absolute(offer.url, page.url), here))))) {
    return { status: 'unrecognized', reason: 'This page has no unrestricted price for this exact product.' };
  }
  const prices = new Set(pool.map((offer) => dollarsToCents(offer.price)));
  if (!pool.length || prices.size !== 1) return { status: 'unrecognized', reason: 'This page has no single price for the product.' };
  const offer = pool[0]!;
  const priceCents = [...prices][0]!;
  if (!jsonLdPriceVisible(page, title, priceCents)) return { status: 'unrecognized', reason: 'The listed price is not visible in a recognized product price region.' };
  const gtins = new Set(['gtin14', 'gtin13', 'gtin12', 'gtin8', 'gtin'].map((key) => normalizeGtin(textOf(node[key]) ?? '')).filter(Boolean));
  const mpn = normalizeModel(textOf(node.mpn)); const model = normalizeModel(textOf(node.model));
  const availability = schemaEnum(offer.availability);
  return finish({
    identity: { brand: textOf(node.brand)?.slice(0, 160) ?? null, model: mpn ?? model, gtin: gtins.size === 1 ? [...gtins][0] : null,
      variant: textOf(node.color)?.slice(0, 160) ?? null, packQuantity: packQuantity(title), condition: conditionOf(offer, title, host) },
    title, merchant: merchantName(host), merchantDomain: host, seller: textOf(offer.seller)?.slice(0, 100) ?? null,
    url: cleanProductUrl(page.url.href), priceCents, shippingCents: shippingOf(offer), currency: 'USD',
    availability: /^(InStock|LimitedAvailability|OnlineOnly)$/i.test(availability) ? 'in_stock'
      : /^(OutOfStock|SoldOut|Discontinued|InStoreOnly)$/i.test(availability) ? 'out_of_stock' : 'unknown',
    observedAt: now.toISOString(), reader: 'json-ld',
  });
}

export function readProduct(page: Page, now = new Date()): ProductRead {
  if (page.url.protocol !== 'https:') return { status: 'not_product', reason: 'Not a secure store page.' };
  if (page.url.hostname === 'www.amazon.com') return readAmazon(page, now);
  if (page.url.hostname === 'www.walmart.com') return readWalmart(page, now);
  return readJsonLd(page, now);
}
export function readProductPage(now = new Date()): ProductRead {
  if (window !== window.top) return { status: 'not_product', reason: 'Not a secure store page.' };
  return readProduct({ doc: document, url: new URL(location.href), live: true }, now);
}
