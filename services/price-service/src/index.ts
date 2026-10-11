import { createApp } from './app';
import { createOfferService, reviewedFeedSource } from './offers';
import { apiSources, corsOrigins } from './sources';

// Local and Docker entry (Bun loads .env).
const { sources, unconfigured } = apiSources(process.env);
if (process.env.REVIEWED_OFFERS_FILE) {
  const file = process.env.REVIEWED_OFFERS_FILE;
  sources.push(reviewedFeedSource(() => Bun.file(file).json()));
}

const app = createApp({ service: createOfferService({ sources, unconfigured }), corsOrigins: corsOrigins(process.env.CORS_ORIGINS) });
const server = Bun.serve({
  hostname: process.env.HOST ?? '0.0.0.0', port: Number(process.env.PORT ?? 3002),
  fetch: (request, bun) => app.fetch(request, { clientAddress: bun.requestIP(request)?.address }),
});
console.log(`price-service listening on ${server.port}; sources: ${sources.map((source) => source.name).join(', ') || 'none'}${unconfigured.length ? `; not configured: ${unconfigured.join(', ')}` : ''}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.stop(); process.exit(0); });
