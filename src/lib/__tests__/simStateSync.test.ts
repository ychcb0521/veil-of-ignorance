// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const upsert = vi.fn(async () => ({ error: null }));
  const eq = vi.fn(async () => ({ data: [], error: null }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ upsert, select }));
  return { upsert, eq, select, from };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: mocks.from },
}));

import {
  __resetSimStateSyncForTests,
  hydrateSimState,
  logicalKeyOf,
  queueSimStatePush,
} from '@/lib/simStateSync';

const UID = 'u-1';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  __resetSimStateSyncForTests();
  mocks.upsert.mockClear();
  mocks.eq.mockClear();
  mocks.eq.mockImplementation(async () => ({ data: [], error: null }));
  mocks.upsert.mockImplementation(async () => ({ error: null }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('queueSimStatePush', () => {
  it('防抖合并：同一键连续写只推最后一版', async () => {
    queueSimStatePush(UID, 'balance', 100);
    queueSimStatePush(UID, 'balance', 200);
    queueSimStatePush(UID, 'balance', 300);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const payload = mocks.upsert.mock.calls[0][0] as { key: string; value: unknown };
    expect(payload.key).toBe('balance');
    expect(payload.value).toBe(300);
  });

  it('时间线心跳类键用长节流窗口，不会每秒打一次库', async () => {
    queueSimStatePush(UID, 'coin_timelines_v2', { a: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.upsert).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });

  it('行情缓存 price_map 不推送——可重建数据没有同步价值', async () => {
    queueSimStatePush(UID, 'price_map', { BTCUSDT: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('推送失败会自动重试一次——瞬时抖动不该让这笔永远上不了云', async () => {
    let calls = 0;
    mocks.upsert.mockImplementation(async () => {
      calls += 1;
      return calls === 1 ? { error: { code: '500', message: 'temporary' } } : { error: null };
    });
    queueSimStatePush(UID, 'balance', 42);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(3_200);
    expect(calls).toBe(2); // 重试成功
  });

  it('重试仍失败则放弃，不无限重试', async () => {
    mocks.upsert.mockImplementation(async () => ({ error: { code: '500', message: 'down' } }));
    queueSimStatePush(UID, 'balance', 42);
    await vi.advanceTimersByTimeAsync(1_600);
    await vi.advanceTimersByTimeAsync(3_200);
    const after = mocks.upsert.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.upsert.mock.calls.length).toBe(after);
  });

  it('表不存在时静默停用，之后不再尝试推送', async () => {
    mocks.upsert.mockImplementation(async () => ({
      error: { code: 'PGRST205', message: "Could not find the table 'public.user_sim_state'" },
    }));
    queueSimStatePush(UID, 'balance', 1);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    queueSimStatePush(UID, 'balance', 2);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(mocks.upsert).toHaveBeenCalledTimes(1); // 不再第二次
  });
});

describe('hydrateSimState', () => {
  it('新浏览器（本地为空）：远端全量写回 localStorage', async () => {
    mocks.eq.mockImplementation(async () => ({
      data: [
        { key: 'balance', value: 88_000, updated_at: '2026-08-17T00:00:00Z' },
        { key: 'positions_map', value: { BTCUSDT: [] }, updated_at: '2026-08-17T00:00:00Z' },
      ],
      error: null,
    }));
    const result = await hydrateSimState(UID);
    expect(result.status).toBe('hydrated');
    expect(result.applied).toBe(2);
    expect(JSON.parse(localStorage.getItem(`sim_${UID}_balance`)!)).toBe(88_000);
    expect(JSON.parse(localStorage.getItem(`sim_${UID}_positions_map`)!)).toEqual({ BTCUSDT: [] });
  });

  it('本地比远端新时不回滚本地', async () => {
    localStorage.setItem(`sim_${UID}_balance`, '999');
    localStorage.setItem(`sim_${UID}_balance__syncts`, String(Date.parse('2026-08-17T10:00:00Z')));
    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'balance', value: 111, updated_at: '2026-08-17T00:00:00Z' }],
      error: null,
    }));
    const result = await hydrateSimState(UID);
    expect(result.applied).toBe(0);
    expect(localStorage.getItem(`sim_${UID}_balance`)).toBe('999');
  });

  it('远端比本地新时覆盖本地——另一台浏览器的最新操作会同步过来', async () => {
    localStorage.setItem(`sim_${UID}_balance`, '111');
    localStorage.setItem(`sim_${UID}_balance__syncts`, String(Date.parse('2026-08-16T00:00:00Z')));
    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'balance', value: 999, updated_at: '2026-08-17T00:00:00Z' }],
      error: null,
    }));
    const result = await hydrateSimState(UID);
    expect(result.applied).toBe(1);
    expect(JSON.parse(localStorage.getItem(`sim_${UID}_balance`)!)).toBe(999);
  });

  it('三处非 sim_ 前缀的存储也按各自的键写回', async () => {
    mocks.eq.mockImplementation(async () => ({
      data: [
        { key: 'blind_spots_v1', value: [{ id: 'b1' }], updated_at: '2026-08-17T00:00:00Z' },
        { key: 'journal_mirror_v1', value: { [UID]: { j1: { note: 'x' } } }, updated_at: '2026-08-17T00:00:00Z' },
        { key: 'emotion_diary_v1', value: [{ diary_date: '2026-08-16' }], updated_at: '2026-08-17T00:00:00Z' },
      ],
      error: null,
    }));
    await hydrateSimState(UID);
    expect(JSON.parse(localStorage.getItem(`veil:blindspots:${UID}`)!)).toEqual([{ id: 'b1' }]);
    expect(JSON.parse(localStorage.getItem('journal_local_mirror_v1')!)).toEqual({ [UID]: { j1: { note: 'x' } } });
    expect(JSON.parse(localStorage.getItem(`decision_emotion_diaries_v1:${UID}`)!))
      .toEqual([{ diary_date: '2026-08-16' }]);
  });

  it('信号库经全局键映射写回 veil.signalLibrary.v1', async () => {
    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'signal_library_v1', value: [{ id: 's1' }], updated_at: '2026-08-17T00:00:00Z' }],
      error: null,
    }));
    await hydrateSimState(UID);
    expect(JSON.parse(localStorage.getItem('veil.signalLibrary.v1')!)).toEqual([{ id: 's1' }]);
  });

  it('存量回填：本地有、云端没有的键会补推一次', async () => {
    localStorage.setItem(`sim_${UID}_trade_history`, JSON.stringify([{ id: 't1' }]));
    mocks.eq.mockImplementation(async () => ({ data: [], error: null }));
    await hydrateSimState(UID);
    await vi.advanceTimersByTimeAsync(1_600);
    const pushed = mocks.upsert.mock.calls.map(call => (call[0] as { key: string }).key);
    expect(pushed).toContain('trade_history');
  });

  it('已在云端的键不重复回填', async () => {
    localStorage.setItem(`sim_${UID}_trade_history`, JSON.stringify([{ id: 't1' }]));
    localStorage.setItem(`sim_${UID}_trade_history__syncts`, String(Date.parse('2026-08-18T00:00:00Z')));
    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'trade_history', value: [], updated_at: '2026-08-17T00:00:00Z' }],
      error: null,
    }));
    await hydrateSimState(UID);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('表不存在 → table-missing，纯本地模式', async () => {
    mocks.eq.mockImplementation(async () => ({
      data: null,
      error: { code: '42P01', message: 'relation "user_sim_state" does not exist' },
    }));
    const result = await hydrateSimState(UID);
    expect(result.status).toBe('table-missing');
  });

  it('网络异常 → error，绝不抛出', async () => {
    mocks.eq.mockImplementation(async () => { throw new Error('network down'); });
    await expect(hydrateSimState(UID)).resolves.toEqual({ status: 'error', applied: 0 });
  });
});

describe('logicalKeyOf', () => {
  it('还原逻辑键并过滤影子键', () => {
    expect(logicalKeyOf(`sim_${UID}_balance`, UID)).toBe('balance');
    expect(logicalKeyOf(`sim_${UID}_balance__syncts`, UID)).toBeNull();
    expect(logicalKeyOf('app-theme', UID)).toBeNull();
    expect(logicalKeyOf('sim_other_balance', UID)).toBeNull();
  });
});
