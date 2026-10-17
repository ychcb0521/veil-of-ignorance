/**
 * 不常用指标展开 / 收起（campaignMinorMetrics）：同一页上几处（列表、真实战役与反事实两张盈亏概览）一起变，跟账号走。
 */
import { useCallback, useEffect, useRef } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { MINOR_METRICS_STATE_KEY } from '@/lib/campaignMinorMetrics';

const listeners = new Set<(value: boolean) => void>();

export function useShowMinorMetrics(): [boolean, () => void] {
  const [value, setValue] = usePersistedState<boolean>(MINOR_METRICS_STATE_KEY, false);
  const currentValue = useRef(value);
  currentValue.current = value;
  useEffect(() => {
    listeners.add(setValue);
    return () => { listeners.delete(setValue); };
  }, [setValue]);
  const toggle = useCallback(() => {
    const next = !currentValue.current;
    currentValue.current = next;
    if (listeners.size === 0) setValue(next);
    listeners.forEach(listener => listener(next));
  }, [setValue]);
  return [value, toggle];
}
