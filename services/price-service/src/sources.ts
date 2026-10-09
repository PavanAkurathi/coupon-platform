import type { PriceOffer } from '@repo/shared';
import { ebaySource, type OfferSource } from './ebay';

// Sources switch on from the environment. Missing keys are reported to the
// extension as "not configured", never as "no cheaper offer".
export function apiSources(env: Record<string, string | undefined>): { sources: OfferSource[]; unconfigured: PriceOffer['source'][] } {
  const sources: OfferSource[] = [];
  const unconfigured: PriceOffer['source'][] = [];
  if (env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) {
    sources.push(ebaySource({ clientId: env.EBAY_CLIENT_ID, clientSecret: env.EBAY_CLIENT_SECRET }));
  } else unconfigured.push('ebay_api');
  return { sources, unconfigured };
}
export const corsOrigins = (raw: string | undefined) => (raw ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
