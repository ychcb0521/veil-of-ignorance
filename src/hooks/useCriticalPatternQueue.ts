/**
 * useCriticalPatternQueue — 处理 evaluateCriticalPatterns 返回的队列，
 * 依次弹出 MandatoryRuleDialog 直到全部处理完。
 */
import { useCallback, useState } from 'react';
import { evaluateCriticalPatterns, type CriticalPatternInfo } from '@/lib/criticalPatternDetector';

export function useCriticalPatternQueue(userId: string | null) {
  const [queue, setQueue] = useState<CriticalPatternInfo[]>([]);

  const scan = useCallback(async () => {
    if (!userId) return;
    try {
      const list = await evaluateCriticalPatterns(userId);
      if (list.length > 0) setQueue(prev => {
        const seen = new Set(prev.map(p => p.pattern.id));
        const adds = list.filter(p => !seen.has(p.pattern.id));
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
