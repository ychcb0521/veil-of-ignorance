/**
 * useCriticalPatternQueue — 处理 evaluateCriticalPatterns 返回的队列，
 * 依次弹出 MandatoryRuleDialog 直到全部处理完。
 */
import { useCallback, useState } from 'react';
import { evaluateCriticalPatterns, type CriticalPatternInfo } from '@/lib/criticalPatternDetector';

/** Stable de-dup key. Pattern-driven items key off pattern.id; catastrophic items key off the source journal. */
function itemKey(p: CriticalPatternInfo): string {
  if (p.pattern) return `pattern:${p.pattern.id}`;
  const j = p.recent_journals[0];
  return j ? `catastrophic:${j.id}` : `unknown:${Math.random()}`;
}

export function useCriticalPatternQueue(userId: string | null) {
  const [queue, setQueue] = useState<CriticalPatternInfo[]>([]);

  const scan = useCallback(async () => {
    if (!userId) return;
    try {
      const list = await evaluateCriticalPatterns(userId);
      if (list.length > 0) setQueue(prev => {
        const seen = new Set(prev.map(itemKey));
        const adds = list.filter(p => !seen.has(itemKey(p)));
        return [...prev, ...adds];
      });
    } catch (e) {
      console.error('[criticalQueue] scan failed', e);
    }
  }, [userId]);

  const current = queue[0] ?? null;
  const resolveCurrent = useCallback(() => {
    setQueue(prev => prev.slice(1));
  }, []);

  return { current, scan, resolveCurrent };
}
