import { useCallback, useEffect, useMemo, useState } from 'react';

/** Only mounted cards are paged. Statistics, sorting, selection and exports keep the full dataset. */
export const CAMPAIGNS_PER_PAGE = 40;
const PAGE_KEY = 'journal-campaign-card-page:';
function readPage(key: string, scope: string): number {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return saved?.scope === scope && Number.isSafeInteger(saved.page) && saved.page > 0 ? saved.page : 1;
  } catch { return 1; }
}
export function useCampaignPagination({ count, scope, historyKey, ready }: {
  count: number; scope: string; historyKey: string; ready: boolean;
}) {
  const storageKey = `${PAGE_KEY}${historyKey}`;
  const restored = useMemo(() => readPage(storageKey, scope), [storageKey, scope]);
  const [requested, setRequested] = useState(() => ({ scope, page: restored }));
  useEffect(() => {
    setRequested(current => current.scope === scope ? current : { scope, page: restored });
  }, [scope, restored]);
  const pages = Math.max(1, Math.ceil(count / CAMPAIGNS_PER_PAGE));
  const page = Math.min(pages, requested.scope === scope ? requested.page : restored);
  useEffect(() => {
    // Do not overwrite a restored later page while its rows are still arriving.
    if (!ready) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ scope, page })); } catch { /* Optional navigation state. */ }
  }, [storageKey, scope, page, ready]);
  const setPage = useCallback((next: number) => {
    setRequested({ scope, page: Math.max(1, Math.min(pages, Math.trunc(next) || 1)) });
  }, [scope, pages]);
  return { page, pages, start: (page - 1) * CAMPAIGNS_PER_PAGE, end: Math.min(count, page * CAMPAIGNS_PER_PAGE), setPage };
}
