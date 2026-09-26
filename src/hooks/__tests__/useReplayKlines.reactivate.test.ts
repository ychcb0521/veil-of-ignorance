/**
 * useReplayKlines：中间只是停用过（symbol 置空）、参数原样回来时，不重拉。
 *
 * 详情页的另拉槽在盘面回到计算那一份时把 symbol 置空，切回来同一组参数又落进同一个槽。
 * 旧写法第一帧把手上的数据交出去，effect 随即又置「加载中」重拉一遍：
 * 盘面先挂上、再闪一下「加载 K 线…」、数据回来再挂一次，每来回一趟多一份请求。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReplayKlines } from '@/hooks/useReplayKlines';
import { SYNTH_T0, createSynthFapiFetch, synthKlineRange } from '@/test/fixtures/syntheticCampaignKlines';

const FROM = SYNTH_T0;
const TO = SYNTH_T0 + 5 * 60 * 60_000;

let synth = createSynthFapiFetch();

beforeEach(() => {
  synth = createSynthFapiFetch();
  vi.stubGlobal('fetch', vi.fn(synth.fetchImpl));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

type Props = { symbol: string; interval: string; from: number; to: number };

function renderReplay(initial: Props) {
  const frames: Array<{ symbol: string; loading: boolean; count: number }> = [];
  const view = renderHook((props: Props) => {
    const result = useReplayKlines(props.symbol, props.from, props.to, props.interval);
    frames.push({ symbol: props.symbol, loading: result.loading, count: result.klines.length });
    return result;
  }, { initialProps: initial });
  return { ...view, frames };
}

describe('useReplayKlines：停用后原样回来不重拉', () => {
  it('同一组参数：拉完 → 停用 → 回来，不发请求，第一帧起就是现成数据、不闪加载', async () => {
    const active: Props = { symbol: 'TUTUSDT', interval: '15m', from: FROM, to: TO };
    const { result, rerender, frames } = renderReplay(active);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const loaded = result.current.klines;
    expect(loaded).toEqual(synthKlineRange('15m', FROM, TO));
    expect(synth.calls).toHaveLength(1);

    for (let round = 0; round < 3; round++) {
      // 槽空出来时周期、窗口也换成占位值（详情页就是这样）
      rerender({ symbol: '', interval: '5m', from: FROM - 1, to: TO + 1 });
      expect(result.current.loading).toBe(true);
      frames.length = 0;
      rerender(active);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.klines).toBe(loaded);
      // 回来之后每一帧都不是「加载中」
      expect(frames.filter(frame => frame.symbol).every(frame => !frame.loading)).toBe(true);
    }
    expect(synth.calls).toHaveLength(1);
  });

  it('停用期间换过别的参数并拉完：回到旧参数要重拉（手上的已不是那一份）', async () => {
    const a: Props = { symbol: 'TUTUSDT', interval: '15m', from: FROM, to: TO };
    const b: Props = { symbol: 'TUTUSDT', interval: '1h', from: FROM, to: TO };
    const { result, rerender } = renderReplay(a);
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender(b);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.klines).toEqual(synthKlineRange('1h', FROM, TO));
    rerender({ ...a, symbol: '' });
    rerender(a);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.klines).toEqual(synthKlineRange('15m', FROM, TO));
    expect(synth.calls.map(call => call.interval)).toEqual(['15m', '1h', '15m']);
  });

  it('上一次失败了：停用再回来照常重拉', async () => {
    synth.failIntervals.add('15m');
    const a: Props = { symbol: 'TUTUSDT', interval: '15m', from: FROM, to: TO };
    const { result, rerender } = renderReplay(a);
    await waitFor(() => expect(result.current.error).toBe('API 429'));
    synth.failIntervals.clear();
    rerender({ ...a, symbol: '' });
    rerender(a);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.klines).toEqual(synthKlineRange('15m', FROM, TO));
    expect(synth.calls).toHaveLength(2);
  });

  it('还在拉的时候被停用：回来照常重拉（被中断的那一趟不算数）', async () => {
    synth.holdIntervals.add('15m');
    const a: Props = { symbol: 'TUTUSDT', interval: '15m', from: FROM, to: TO };
    const { result, rerender } = renderReplay(a);
    rerender({ ...a, symbol: '' });
    synth.releaseHeld();
    rerender(a);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.klines).toEqual(synthKlineRange('15m', FROM, TO));
    expect(synth.calls).toHaveLength(2);
  });

  it('重试（reload）照常重拉', async () => {
    const a: Props = { symbol: 'TUTUSDT', interval: '15m', from: FROM, to: TO };
    const { result } = renderReplay(a);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.reload());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(synth.calls).toHaveLength(2);
  });
});
