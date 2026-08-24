// @vitest-environment jsdom
/**
 * 「本地更新的操作不会被云端旧值回滚」这道护栏的回归守卫。
 *
 * 同步层的注释承诺：「远端行 updated_at 晚于本地影子时间戳（或本地根本没有该键）
 * 才覆盖本地——旧浏览器里更新的本地操作不会被回滚」。
 *
 * 但影子戳与 updated_at 记的是两个不同的时刻：
 *   queueSimStatePush 在**入队**时 writeShadowTs(Date.now())
 *   pushNow 在**推送**时（防抖 1.5s 之后）才写 updated_at = new Date()
 * 于是 localTs 恒比 remoteTs 小 1.5 秒，`localTs >= remoteTs` 对任何推送成功过的键
 * **永远为假**——护栏从来没有生效过，hydrate 一律用远端覆盖本地。
 *
 * 平时无害（远端内容与本地一致），但只要远端那行是陈的（上一笔推送失败、
 * 或最新一笔还没推上去），这次覆盖就会把用户刚做的操作抹掉：
 * 删过历史成交、又交易了一笔，重启后那一笔不见了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** upsert 的行形状：显式写出来，mock.calls[0][0] 才有类型（否则推成空元组）。 */
interface SimStateRow { user_id: string; key: string; value: unknown; updated_at: string }

const mocks = vi.hoisted(() => {
  const upsert = vi.fn(async (_row: { user_id: string; key: string; value: unknown; updated_at: string }) => ({
    error: null as { message: string } | null,
  }));
  const eq = vi.fn(async () => ({
    data: [] as Array<{ key: string; value: unknown; updated_at: string }>,
    error: null as { message: string } | null,
  }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ upsert, select }));
  return { upsert, eq, select, from };
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));

import { __resetSimStateSyncForTests, hydrateSimState, queueSimStatePush } from '@/lib/simStateSync';

const UID = 'u-1';
const FULL = `sim_${UID}_trade_history`;
const SHADOW = `${FULL}__syncts`;

/** 复刻 usePersistedState 的写路径：先落 localStorage，再入队推送。 */
function localWrite(value: unknown) {
  localStorage.setItem(FULL, JSON.stringify(value));
  queueSimStatePush(UID, 'trade_history', value);
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  __resetSimStateSyncForTests();
  mocks.upsert.mockClear();
  mocks.eq.mockClear();
  mocks.eq.mockImplementation(async () => ({ data: [], error: null }));
  mocks.upsert.mockImplementation(async () => ({ error: null }));
});
afterEach(() => { vi.useRealTimers(); });

describe('影子时间戳与 updated_at 必须同源', () => {
  it('推送成功后，影子戳不早于云端那一行的 updated_at', async () => {
    localWrite([{ id: 'A' }]);
    await vi.advanceTimersByTimeAsync(1_600);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);

    const pushed = mocks.upsert.mock.calls[0]![0] as SimStateRow;
    const remoteTs = Date.parse(pushed.updated_at);
    const localTs = Number(localStorage.getItem(SHADOW));

    // 这一条是护栏能否成立的全部前提
    expect(localTs).toBeGreaterThanOrEqual(remoteTs);
  });

  it('云端那一行是陈的时候，hydrate 不许用它盖掉本地更新的值', async () => {
    // 本地写了新值并推送成功
    localWrite([{ id: 'A' }, { id: 'B' }]);
    await vi.advanceTimersByTimeAsync(1_600);
    const pushed = mocks.upsert.mock.calls[0]![0] as SimStateRow;

    // 云端返回一行**比这次推送更早**的旧值（例如上一台机器留下的、或推送前的版本）
    const staleRemote = new Date(Date.parse(pushed.updated_at) - 60_000).toISOString();
    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'trade_history', value: [{ id: 'A' }], updated_at: staleRemote }],
      error: null,
    }));

    await hydrateSimState(UID);
    expect(JSON.parse(localStorage.getItem(FULL) as string)).toEqual([{ id: 'A' }, { id: 'B' }]);
  });

  it('云端确实更新（别的设备写的）时，仍然要覆盖本地——不能修成永不覆盖', async () => {
    localWrite([{ id: 'A' }]);
    await vi.advanceTimersByTimeAsync(1_600);
    const pushed = mocks.upsert.mock.calls[0]![0] as SimStateRow;

    const newerRemote = new Date(Date.parse(pushed.updated_at) + 60_000).toISOString();
    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'trade_history', value: [{ id: 'A' }, { id: 'Z' }], updated_at: newerRemote }],
      error: null,
    }));

    await hydrateSimState(UID);
    expect(JSON.parse(localStorage.getItem(FULL) as string)).toEqual([{ id: 'A' }, { id: 'Z' }]);
  });

  it('推送失败后的重试，不许把已经过期的旧值重新写上云并盖掉新值', async () => {
    // 这是真正会丢数据的一条：
    // 推送失败 → 3 秒后带着**旧 value** 重试；而这 3 秒里用户又交易了一笔。
    // 重试用的是旧值、却盖上了新的 updated_at，于是云端回到旧版本，
    // 下次 hydrate 再用这个「更新的」旧值把本地那笔新成交抹掉。
    mocks.upsert.mockImplementationOnce(async () => ({ error: { message: 'network blip' } }));
    localWrite([{ id: 'A' }]);
    await vi.advanceTimersByTimeAsync(1_600);        // 第一次推送，失败
    expect(mocks.upsert).toHaveBeenCalledTimes(1);

    // 重试窗口内又交易了一笔
    localWrite([{ id: 'A' }, { id: 'B' }]);
    await vi.advanceTimersByTimeAsync(5_000);        // 重试(3s) 与新推送(1.5s) 都跑完

    // 云端最终必须是新值，不能被那次带着旧 value 的重试盖回去
    const last = mocks.upsert.mock.calls[mocks.upsert.mock.calls.length - 1]![0] as SimStateRow;
    expect(last.value).toEqual([{ id: 'A' }, { id: 'B' }]);

    // 而且本地也不能被自己推上去的旧值回滚
    const pushedAll = mocks.upsert.mock.calls.map(c => c[0] as SimStateRow);
    const staleRetry = pushedAll.find(p => JSON.stringify(p.value) === JSON.stringify([{ id: 'A' }]));
    if (staleRetry) {
      mocks.eq.mockImplementation(async () => ({
        data: [{ key: 'trade_history', value: [{ id: 'A' }], updated_at: staleRetry.updated_at }],
        error: null,
      }));
      await hydrateSimState(UID);
      expect(JSON.parse(localStorage.getItem(FULL) as string)).toEqual([{ id: 'A' }, { id: 'B' }]);
    }
  });

  it('本地写了但还没推上去时，云端旧值同样不许回滚它', async () => {
    localWrite([{ id: 'A' }]);
    await vi.advanceTimersByTimeAsync(1_600);
    const pushed = mocks.upsert.mock.calls[0]![0] as SimStateRow;

    // 第二笔本地写入，推送还在防抖窗口里没发出去
    await vi.advanceTimersByTimeAsync(5_000);
    localWrite([{ id: 'A' }, { id: 'B' }]);

    mocks.eq.mockImplementation(async () => ({
      data: [{ key: 'trade_history', value: [{ id: 'A' }], updated_at: pushed.updated_at }],
      error: null,
    }));
    await hydrateSimState(UID);
    expect(JSON.parse(localStorage.getItem(FULL) as string)).toEqual([{ id: 'A' }, { id: 'B' }]);
  });
});
