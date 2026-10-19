/**
 * 时间机器倍速的「置顶」档位：主栏只摆置顶的几档，其余在下拉里，可编辑（与 K 线周期选择同一个模式）。
 * 【用户要求】2026-10-19「倍速播放的那些，做成可编辑的，就像周期调整那里的模式一样…要在同一行能够放下」。
 * 置顶的只能是 SIMULATION_SPEED_OPTIONS 里的档位，按升序摆，至少留一档；读回的脏数据按这个规则修正。
 */
import { useMemo } from 'react';
import { usePersistedState } from './usePersistedState';
import { SIMULATION_SPEED_OPTIONS } from '@/lib/simulationSpeeds';

export const DEFAULT_PINNED_SPEEDS: readonly number[] = [1, 10, 60, 300, 1800, 3600];

/** 只留合法档位、去重、升序；一档都不剩时回到默认。 */
export function normalizePinnedSpeeds(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [];
  const valid = SIMULATION_SPEED_OPTIONS.filter(s => list.includes(s));
  return valid.length ? valid : [...DEFAULT_PINNED_SPEEDS];
}

export function useSpeedPrefs() {
  const [raw, setRaw] = usePersistedState<number[]>('pinned_speeds', [...DEFAULT_PINNED_SPEEDS]);
  const pinned = useMemo(() => normalizePinnedSpeeds(raw), [raw]);
  const available = useMemo(() => SIMULATION_SPEED_OPTIONS.filter(s => !pinned.includes(s)), [pinned]);
  const togglePin = (speed: number) => {
    setRaw(prev => {
      const cur = normalizePinnedSpeeds(prev);
      if (cur.includes(speed)) return cur.length <= 1 ? cur : cur.filter(s => s !== speed);
      return normalizePinnedSpeeds([...cur, speed]);
    });
  };
  return { pinned, available, togglePin };
}
