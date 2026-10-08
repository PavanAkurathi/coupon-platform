// Browser global for the live onboarding check, which evaluates the reader and the
// trial adapter in a real checkout page. Not part of the shipping extension bundle.
import { inspectShopifyCheckout } from '../src/shopify-checkout-reader';
import { createShopifyAdapter } from '../src/shopify-adapter';
(globalThis as typeof globalThis & { __shopifyReader?: unknown }).__shopifyReader = { inspectShopifyCheckout, createShopifyAdapter };
