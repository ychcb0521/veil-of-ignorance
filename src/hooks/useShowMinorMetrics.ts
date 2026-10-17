/**
 * 不常用指标展开 / 收起（campaignMinorMetrics）：同一页上几处（列表、真实战役与反事实两张盈亏概览）一起变，跟账号走。
 */
import { useCallback, useEffect } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { MINOR_METRICS_STATE_KEY } from '@/lib/campaignMinorMetrics';

const listeners = new Set<(value: boolean) => void>();

export function useShowMinorMetrics(): [boolean, () => void] {
  const [value, setValue] = usePersistedState<boolean>(MINOR_METRICS_STATE_KEY, false);
  useEffect(() => {
    listeners.add(setValue);
    return () => { listeners.delete(setValue); };
  }, [setValue]);
  const toggle = useCallback(() => {
    const next = !value;
    if (listeners.size === 0) setValue(next);
    listeners.forEach(listener => listener(next));
  }, [value, setValue]);
  return [value, toggle];
}
