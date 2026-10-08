// Browser global for the live onboarding check, which evaluates the reader in a
// real checkout page. Not part of the shipping extension bundle.
import { inspectShopifyCheckout } from '../src/shopify-checkout-reader';
(globalThis as typeof globalThis & { __shopifyReader?: unknown }).__shopifyReader = { inspectShopifyCheckout };
