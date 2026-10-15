// Extension pages have a different authority from merchant content scripts.
export function isCouponSurface(sender: chrome.runtime.MessageSender, runtimeId: string, getURL: (path: string) => string): boolean {
  return sender.id === runtimeId && (sender.frameId === undefined || sender.frameId === 0)
    && ['popup.html', 'sidepanel.html'].some((path) => sender.url === getURL(path));
}

type TabAccess = Pick<typeof chrome.tabs, 'get' | 'query'>;
export async function bindSurfacePage(tabId: number, url: string, tabs: TabAccess, revision: () => number) {
  const initialRevision = revision();
  const assertCurrent = async () => {
    const [current, active] = await Promise.all([tabs.get(tabId), tabs.query({ active: true, currentWindow: true })]);
    if (revision() !== initialRevision || current.url !== url || current.status === 'loading'
      || active[0]?.id !== tabId || active[0]?.url !== url) {
      throw new Error('The page changed. Check this page again before continuing.');
    }
    return current;
  };
  const tab = await assertCurrent();
  return { tab, assertCurrent };
}
