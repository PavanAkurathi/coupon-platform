import { createApp } from './app';
import { ebaySource, type OfferSource } from './ebay';
import { createOfferService, reviewedFeedSource } from './offers';
import type { PriceOffer } from '@repo/shared';

// Sources switch on from the environment (Bun loads .env). Missing keys are
// reported to the extension as "not configured", never as "no cheaper offer".
const sources: OfferSource[] = [];
const unconfigured: PriceOffer['source'][] = [];
if (process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) {
  sources.push(ebaySource({ clientId: process.env.EBAY_CLIENT_ID, clientSecret: process.env.EBAY_CLIENT_SECRET }));
} else unconfigured.push('ebay_api');
if (process.env.REVIEWED_OFFERS_FILE) {
  const file = process.env.REVIEWED_OFFERS_FILE;
  sources.push(reviewedFeedSource(() => Bun.file(file).json()));
}

const app = createApp({ service: createOfferService({ sources, unconfigured }), corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean) });
const server = Bun.serve({
  hostname: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 3002),
  fetch: (request, bun) => app.fetch(request, { clientAddress: bun.requestIP(request)?.address }),
});
console.log(`price-service listening on ${server.port}; sources: ${sources.map((source) => source.name).join(', ') || 'none'}${unconfigured.length ? `; not configured: ${unconfigured.join(', ')}` : ''}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(); process.exit(0); });
