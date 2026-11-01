/**
 * 发布不中断（前端一侧）：线上发布新版本后，已经开着的页面继续用旧版本，只在角落提示「新版本已就绪」，
 * 由用户在方便的时候刷新切换。旧版本页面要用到的代码文件由构建保留（scripts/retain_previous_assets.mjs），
 * 所以不刷新也能照常切页面、照常工作。
 *
 * 判断依据是入口文件名（内容哈希）：任何代码改动都会让它变化，不依赖人工改版本戳。
 */
const CHECK_EVERY_MS = 5 * 60_000;

/** 当前页面加载的那一版入口（index.html 里的模块脚本）。 */
export function currentEntry(doc: Document = document): string | null {
  const src = doc.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src');
  return src ? new URL(src, doc.baseURI).pathname : null;
}

/** 线上最新一版的入口；取不到（本机开发、断网、旧站点没有 version.json）一律当作「不知道」。 */
export async function fetchLiveEntry(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher('/version.json', { cache: 'no-store' });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return null;
    const body = await response.json() as { version?: number; entry?: unknown };
    return body?.version === 1 && typeof body.entry === 'string' ? new URL(body.entry, location.origin).pathname : null;
  } catch { return null; }
}

/**
 * 页面回到前台、窗口获得焦点、以及前台时每 5 分钟各查一次；发现新版本回调一次后停止。
 * 返回停止函数。
 */
export function watchForNewVersion(onNewVersion: () => void, fetcher: typeof fetch = fetch): () => void {
  const mine = currentEntry();
  if (!mine) return () => {};
  let stopped = false, checking = false;
  const check = async () => {
    if (stopped || checking || document.visibilityState === 'hidden') return;
    checking = true;
    try {
      const live = await fetchLiveEntry(fetcher);
      if (!stopped && live && live !== mine) { stop(); onNewVersion(); }
    } finally { checking = false; }
  };
  const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
  const timer = setInterval(() => void check(), CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  const stop = () => {
    stopped = true; clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
  return stop;
}
