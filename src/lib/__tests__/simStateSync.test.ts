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
  setActiveSyncUser,
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

  it('下单面板的结算方式 symbol_settlement_mode 不推送——它只活在当前会话，每次打开都回到币本位', async () => {
    queueSimStatePush(UID, 'symbol_settlement_mode', { RUNEUSD: 'usdt' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(localStorage.getItem(`sim_${UID}_symbol_settlement_mode__syncts`)).toBeNull();
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

  it('云端残留的 symbol_settlement_mode 行不水化——别的设备不能把 U 本位再塞回来', async () => {
    mocks.eq.mockImplementation(async () => ({
      data: [
        { key: 'symbol_settlement_mode', value: { RUNEUSD: 'usdt' }, updated_at: '2026-08-17T00:00:00Z' },
        { key: 'balance', value: 88_000, updated_at: '2026-08-17T00:00:00Z' },
      ],
      error: null,
    }));
    const result = await hydrateSimState(UID);
    expect(result.applied).toBe(1);
    expect(localStorage.getItem(`sim_${UID}_symbol_settlement_mode`)).toBeNull();
    expect(JSON.parse(localStorage.getItem(`sim_${UID}_balance`)!)).toBe(88_000);
  });

  it('本地残留的 symbol_settlement_mode 不做存量回填', async () => {
    localStorage.setItem(`sim_${UID}_symbol_settlement_mode`, JSON.stringify({ RUNEUSD: 'usdt' }));
    mocks.eq.mockImplementation(async () => ({ data: [], error: null }));
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


/**
 * 同一标签页里换账号：冲刷监听器绝不能还认着上一个人。
 *
 * 事故：installFlushHooks 只装一次，两个监听器闭包捕获了**第一次**见到的 userId。
 * 退出再登另一个号（不刷新），页面隐藏 / 关闭时积压的推送仍写进前一个人的云端行——
 * B 的持仓、余额、成交历史覆盖掉 A 的存档，而云端只留最后一版，不可逆。
 */
describe('账号切换后的云端归属', () => {
  const userIdsOf = (calls: unknown[][]) =>
    calls.map(c => (c[0] as { user_id?: string })?.user_id);

  it('【回归】切到 B 之后，页面隐藏冲刷必须写 B，不能写 A', async () => {
    queueSimStatePush('user-A', 'balance', 1);
    await vi.runAllTimersAsync();
    mocks.upsert.mockClear();

    setActiveSyncUser('user-B');
    queueSimStatePush('user-B', 'balance', 2);
    // 不等防抖，直接模拟「切标签页 / 关窗口」那一刻的冲刷
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    await vi.runAllTimersAsync();

    const ids = userIdsOf(mocks.upsert.mock.calls);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain('user-A');
    expect(ids.every(id => id === 'user-B')).toBe(true);
  });

  it('切换时先把上一个人的积压推给他自己，不丢也不串', async () => {
    queueSimStatePush('user-A', 'positions_map', { a: 1 });
    setActiveSyncUser('user-B');            // 应当当场冲刷 A 的积压
    await vi.runAllTimersAsync();
    const ids = userIdsOf(mocks.upsert.mock.calls);
    expect(ids).toContain('user-A');
    expect(ids).not.toContain('user-B');
  });

  it('退出登录（归属置空）后，冲刷监听器不再推任何东西', async () => {
    queueSimStatePush('user-A', 'balance', 1);
    await vi.runAllTimersAsync();
    setActiveSyncUser(null);
    mocks.upsert.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    await vi.runAllTimersAsync();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

/**
 * 回放时间线登记表描述的是**历史**：两台设备各自分叉出来的时间线都真实发生过。
 * 整键写者胜会把其中一台的节点整个抹掉，那台设备上盖过章的委托从此指向不存在的节点。
 */
describe('hydrateSimState · 回放时间线登记表按节点并集合并', () => {
  const KEY = `sim_${UID}_replay_timelines_v1`;
  const node = (id: string, scope = 'synced') => ({
    id, scope, parentId: null, cause: 'start', direction: 1, forkSimTime: 1_000, startedRealAt: 100,
    endSimTime: null, endedRealAt: null, carried: {}, lastSimTime: 1_000, lastRealAt: 100,
  });
  const pushedTimelines = () => mocks.upsert.mock.calls
    .map(call => (call as unknown[])[0] as { key: string; value: { nodes: Record<string, unknown> } })
    .filter(payload => payload.key === 'replay_timelines_v1');

  it('本地比远端新也不整键保留：远端独有的节点照样并进来，合并结果推回云端', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, nodes: { a: node('a') }, current: { synced: 'a' } }));
    localStorage.setItem(`${KEY}__syncts`, String(Date.parse('2026-09-20T00:00:00Z')));
    mocks.eq.mockImplementation(async () => ({
      data: [{
        key: 'replay_timelines_v1',
        value: { v: 1, nodes: { b: node('b', 'coin:ETHUSDT') }, current: { 'coin:ETHUSDT': 'b' } },
        updated_at: '2026-09-01T00:00:00Z',
      }],
      error: null,
    }));
    await hydrateSimState(UID);
    const merged = JSON.parse(localStorage.getItem(KEY)!);
    expect(Object.keys(merged.nodes).sort()).toEqual(['a', 'b']);
    expect(merged.current).toEqual({ synced: 'a', 'coin:ETHUSDT': 'b' });

    // 登记表走慢档（20 秒）：快档的 1.5 秒过去还没推
    await vi.advanceTimersByTimeAsync(1_600);
    expect(pushedTimelines()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(20_000);
    const pushed = pushedTimelines();
    expect(pushed).toHaveLength(1);
    expect(Object.keys(pushed[0].value.nodes).sort()).toEqual(['a', 'b']);
  });

  it('并集之后再修剪：远端留着的、太老的已结束节点不会借水化长回来', async () => {
    const stale = {
      ...node('stale'), startedRealAt: Date.parse('2025-01-01T00:00:00Z'), lastRealAt: Date.parse('2025-01-01T01:00:00Z'),
      endSimTime: 2_000, endedRealAt: Date.parse('2025-01-01T01:00:00Z'),
    };
    localStorage.setItem(KEY, JSON.stringify({ v: 1, nodes: { a: node('a') }, current: { synced: 'a' } }));
    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'replay_timelines_v1', value: { v: 1, nodes: { stale }, current: {} }, updated_at: '2026-09-01T00:00:00Z' }],
      error: null,
    }));
    await hydrateSimState(UID);
    const merged = JSON.parse(localStorage.getItem(KEY)!);
    expect(Object.keys(merged.nodes)).toEqual(['a']);
  });

  it('远端比本地新也不整键覆盖：本地独有的节点不丢', async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, nodes: { a: node('a') }, current: { synced: 'a' } }));
    localStorage.setItem(`${KEY}__syncts`, String(Date.parse('2026-08-01T00:00:00Z')));
    mocks.eq.mockImplementation(async () => ({
      data: [{
        key: 'replay_timelines_v1',
        value: { v: 1, nodes: { b: node('b') }, current: { synced: 'b' } },
        updated_at: '2026-09-01T00:00:00Z',
      }],
      error: null,
    }));
    await hydrateSimState(UID);
    const merged = JSON.parse(localStorage.getItem(KEY)!);
    expect(Object.keys(merged.nodes).sort()).toEqual(['a', 'b']);
    // 同步时钟的指针优先本地
    expect(merged.current.synced).toBe('a');
  });

  it('合并结果与远端一致：不推送', async () => {
    const value = { v: 1, nodes: { a: node('a') }, current: { synced: 'a' } };
    localStorage.setItem(KEY, JSON.stringify(value));
    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'replay_timelines_v1', value, updated_at: '2026-09-01T00:00:00Z' }],
      error: null,
    }));
    await hydrateSimState(UID);
    await vi.advanceTimersByTimeAsync(21_600);
    expect(pushedTimelines()).toHaveLength(0);
  });

  it('本地没有这个键：照旧整键写回', async () => {
    const value = { v: 1, nodes: { b: node('b') }, current: { synced: 'b' } };
    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'replay_timelines_v1', value, updated_at: '2026-09-01T00:00:00Z' }],
      error: null,
    }));
    const result = await hydrateSimState(UID);
    expect(result.applied).toBe(1);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(value);
  });

  it('其余键仍是写者胜：并集合并只作用于登记表', async () => {
    localStorage.setItem(`sim_${UID}_orders_map`, JSON.stringify({ BTCUSDT: [{ id: 'local' }] }));
    localStorage.setItem(`sim_${UID}_orders_map__syncts`, String(Date.parse('2026-09-20T00:00:00Z')));
    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'orders_map', value: { ETHUSDT: [{ id: 'remote' }] }, updated_at: '2026-09-01T00:00:00Z' }],
      error: null,
    }));
    await hydrateSimState(UID);
    expect(JSON.parse(localStorage.getItem(`sim_${UID}_orders_map`)!)).toEqual({ BTCUSDT: [{ id: 'local' }] });
  });
});
