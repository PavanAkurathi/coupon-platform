import { describe, expect, test } from 'bun:test';
import { bindSurfacePage, isCouponSurface } from './surface';
import { surfaceRequestSchema } from './protocol';

const getURL = (path: string) => `chrome-extension://test-extension/${path}`;
describe('coupon surface authority', () => {
  test('only exact first-party top-level coupon surfaces may request page actions', () => {
    for (const page of ['popup.html', 'sidepanel.html']) {
      expect(isCouponSurface({ id: 'test-extension', url: getURL(page) }, 'test-extension', getURL)).toBe(true);
    }
    for (const sender of [
      { id: 'other', url: getURL('sidepanel.html') },
      { id: 'test-extension', url: getURL('sidepanel.html'), frameId: 1 },
      { id: 'test-extension', url: getURL('dashboard/index.html') },
      { id: 'test-extension', url: 'https://www.amazon.com/dp/B000000001' },
      { id: 'test-extension', url: getURL('sidepanel.html?pretend=true') },
    ]) expect(isCouponSurface(sender, 'test-extension', getURL)).toBe(false);
  });
  test('a surface request requires an explicit tab and URL', () => {
    expect(surfaceRequestSchema.safeParse({ type: 'surface-request', request: { type: 'run' } }).success).toBe(false);
    expect(surfaceRequestSchema.safeParse({ type: 'surface-request', tabId: 1, url: 'https://store.test/product', request: { type: 'run' } }).success).toBe(true);
  });
  test('a page action is refused after tab switching, navigation, or a same-URL reload', async () => {
    const original = { id: 3, url: 'https://store.test/product', status: 'complete' } as chrome.tabs.Tab;
    let current = { ...original };
    let active = { ...original };
    let revision = 0;
    const tabs = { get: async () => current, query: async () => [active] } as unknown as Pick<typeof chrome.tabs, 'get' | 'query'>;
    const bound = await bindSurfacePage(3, original.url!, tabs, () => revision);
    active = { ...original, id: 4 };
    await expect(bound.assertCurrent()).rejects.toThrow('page changed');
    active = { ...original };
    current = { ...original, url: 'https://store.test/different' };
    await expect(bound.assertCurrent()).rejects.toThrow('page changed');
    current = { ...original };
    revision++;
    await expect(bound.assertCurrent()).rejects.toThrow('page changed');
    const refreshed = await bindSurfacePage(3, original.url!, tabs, () => revision);
    await expect(refreshed.assertCurrent()).resolves.toMatchObject({ id: 3 });
  });
  test('loading pages and stale bindings are rejected before any work', async () => {
    const tab = { id: 3, url: 'https://store.test/product', status: 'loading' } as chrome.tabs.Tab;
    const tabs = { get: async () => tab, query: async () => [tab] } as unknown as Pick<typeof chrome.tabs, 'get' | 'query'>;
    await expect(bindSurfacePage(3, tab.url!, tabs, () => 0)).rejects.toThrow('page changed');
    tab.status = 'complete';
    await expect(bindSurfacePage(3, 'https://store.test/old', tabs, () => 0)).rejects.toThrow('page changed');
  });
});
