// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface RemoteRow { key: string; value: unknown; updated_at: string }
interface PushRow extends RemoteRow { user_id: string }
interface PushResult { error: { message: string } | null }

const mocks = vi.hoisted(() => {
  const upsert = vi.fn(async (_row: PushRow): Promise<PushResult> => ({ error: null }));
  const eq = vi.fn(async (): Promise<{ data: RemoteRow[]; error: null }> => ({ data: [], error: null }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ upsert, select }));
  return { upsert, eq, select, from };
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));

import { __resetSimStateSyncForTests, hydrateSimState, queueSimStatePush } from '@/lib/simStateSync';
import * as persistedStateStorage from '@/lib/persistedStateStorage';
import {
  clearPersistedStateMemoryForTests,
  getUnpersistedStateMetadata,
  getUnpersistedStateRaw,
  markPersistedStateSynced,
  readPersistedStateRaw,
  writePersistedStateRaw,
} from '@/lib/persistedStateStorage';

const UID = 'recovery-user-a';
const KEY = 'cancelled_orders';
const FULL = `sim_${UID}_${KEY}`;
const SHADOW = `${FULL}__syncts`;
const NOW = Date.parse('2026-10-01T00:00:00Z');
const orders = [{ id: 'protection-a', price: 10 }, { id: 'protection-b', price: 10 }];

function remote(value: unknown, time = Date.now(), key = KEY): void {
  mocks.eq.mockResolvedValue({ data: [{ key, value, updated_at: new Date(time).toISOString() }], error: null });
}

function rejectDataWrites(fullKey = FULL) {
  const original = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === fullKey) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
    original.call(this, key, value);
  });
}

function deferredPush() {
  let resolve!: (result: PushResult) => void;
  const promise = new Promise<PushResult>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  __resetSimStateSyncForTests();
  mocks.upsert.mockReset();
  mocks.eq.mockReset();
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.eq.mockResolvedValue({ data: [], error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetSimStateSyncForTests();
  vi.useRealTimers();
});

describe('sim state quota recovery', () => {
  it('quota 本地内存值获云端确认后不再永久 dirty，拒绝旧远端但接受新远端且不虚假落盘', async () => {
    localStorage.setItem(FULL, '[]');
    localStorage.setItem(SHADOW, '1');
    rejectDataWrites();
    const notify = vi.spyOn(persistedStateStorage, 'notifyPersistedStateHydrated');
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    expect(getUnpersistedStateMetadata(FULL)).toMatchObject({ source: 'local' });
    queueSimStatePush(UID, KEY, orders);
    await vi.advanceTimersByTimeAsync(1_600);
    const ackTs = Date.parse(mocks.upsert.mock.calls[0]![0].updated_at);
    expect(getUnpersistedStateMetadata(FULL)).toMatchObject({ source: 'remote', updatedAt: ackTs });
    expect(notify).not.toHaveBeenCalled(); // 确认不改变内容，也不是一次水合。
    expect(localStorage.getItem(FULL)).toBe('[]');
    expect(localStorage.getItem(SHADOW)).toBe('1');

    remote([], ackTs - 1);
    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(JSON.parse(readPersistedStateRaw(FULL)!)).toEqual(orders);
    const newer = [...orders, { id: 'new-remote', price: 12 }];
    remote(newer, ackTs + 1);
    expect((await hydrateSimState(UID)).applied).toBe(1);
    expect(JSON.parse(readPersistedStateRaw(FULL)!)).toEqual(newer);
    expect(getUnpersistedStateMetadata(FULL)).toMatchObject({ source: 'remote', updatedAt: ackTs + 1 });
    expect(localStorage.getItem(SHADOW)).toBe('1');
  });

  it('成功确认的 raw 已不匹配最新内存时，不解除那份未排队本地修改的 dirty 保护', async () => {
    const first = deferredPush();
    mocks.upsert.mockReturnValueOnce(first.promise);
    rejectDataWrites();
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    queueSimStatePush(UID, KEY, orders);
    await vi.advanceTimersByTimeAsync(1_600);
    const newer = [...orders, { id: 'new-local', price: 12 }];
    writePersistedStateRaw(FULL, JSON.stringify(newer));
    first.resolve({ error: null });
    await Promise.resolve();

    expect(getUnpersistedStateMetadata(FULL)).toMatchObject({ source: 'local' });
    remote(orders, NOW + 60_000);
    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(JSON.parse(readPersistedStateRaw(FULL)!)).toEqual(newer);
  });

  it('旧 generation 的确认即使 raw 完全相同，也不能提前解除新 generation 的 dirty 保护', async () => {
    const first = deferredPush();
    mocks.upsert.mockReturnValueOnce(first.promise);
    rejectDataWrites();
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    queueSimStatePush(UID, KEY, orders);
    await vi.advanceTimersByTimeAsync(1_600);
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    queueSimStatePush(UID, KEY, orders);
    first.resolve({ error: null });
    await Promise.resolve();

    expect(getUnpersistedStateMetadata(FULL)).toMatchObject({ source: 'local' });
    remote([], NOW + 60_000);
    expect((await hydrateSimState(UID)).applied).toBe(0);
    await vi.advanceTimersByTimeAsync(1_600);
    const latestAckTs = Date.parse(mocks.upsert.mock.calls[1]![0].updated_at);
    expect(getUnpersistedStateMetadata(FULL)).toMatchObject({ source: 'remote', updatedAt: latestAckTs });
  });

  it('标记已同步仅更新精确匹配内存的来源，既不写磁盘也不倒退已确认时间戳', () => {
    const writes = rejectDataWrites();
    const raw = JSON.stringify(orders);
    writePersistedStateRaw(FULL, raw);
    const calls = writes.mock.calls.length;
    markPersistedStateSynced(FULL, '[]', NOW);
    expect(getUnpersistedStateMetadata(FULL)).toMatchObject({ source: 'local' });
    markPersistedStateSynced(FULL, raw, NOW);
    markPersistedStateSynced(FULL, raw, NOW - 1);
    expect(getUnpersistedStateMetadata(FULL)).toMatchObject({ source: 'remote', updatedAt: NOW });
    expect(readPersistedStateRaw(FULL)).toBe(raw);
    expect(writes).toHaveBeenCalledTimes(calls);
    expect(localStorage.getItem(SHADOW)).toBeNull();
  });

  it('数据写失败但影子键可写时，入队和成功推送都不能给旧本地内容盖章；重载可恢复云端', async () => {
    localStorage.setItem(FULL, '[]');
    localStorage.setItem(SHADOW, '1');
    const writes = rejectDataWrites();

    expect(writePersistedStateRaw(FULL, JSON.stringify(orders))).toBe(false);
    queueSimStatePush(UID, KEY, orders);
    expect(localStorage.getItem(SHADOW)).toBe('1');
    await vi.advanceTimersByTimeAsync(1_600);

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const pushed = mocks.upsert.mock.calls[0]![0];
    expect(pushed.value).toEqual(orders);
    expect(localStorage.getItem(FULL)).toBe('[]');
    expect(readPersistedStateRaw(FULL)).toBe(JSON.stringify(orders));
    expect(localStorage.getItem(SHADOW)).toBe('1');

    writes.mockRestore();
    __resetSimStateSyncForTests(); // 新页面没有旧内存，磁盘数据仍然是旧值。
    mocks.eq.mockResolvedValue({ data: [pushed], error: null });
    expect(await hydrateSimState(UID)).toEqual({ status: 'hydrated', applied: 1 });
    expect(JSON.parse(localStorage.getItem(FULL)!)).toEqual(orders);
    expect(Number(localStorage.getItem(SHADOW))).toBe(Date.parse(pushed.updated_at));
  });

  it('已有旧版本等戳但不同内容的坏状态会修复，无须删除用户交易数据', async () => {
    localStorage.setItem(FULL, '[]');
    localStorage.setItem(SHADOW, String(NOW));
    remote(orders);

    expect((await hydrateSimState(UID)).applied).toBe(1);
    expect(JSON.parse(localStorage.getItem(FULL)!)).toEqual(orders);
  });

  it('JSONB 只重排对象属性时不算内容损坏，保留本地原始序列化', async () => {
    const localRaw = '[{"price":10,"id":"protection-a","metadata":{"z":1,"a":2}}]';
    localStorage.setItem(FULL, localRaw);
    localStorage.setItem(SHADOW, String(NOW));
    remote([{ id: 'protection-a', metadata: { a: 2, z: 1 }, price: 10 }]);

    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(localStorage.getItem(FULL)).toBe(localRaw);
  });

  it('数组顺序不相同仍算不同内容，不能被对象键无序比较吞掉', async () => {
    localStorage.setItem(FULL, JSON.stringify([...orders].reverse()));
    localStorage.setItem(SHADOW, String(NOW));
    remote(orders);

    expect((await hydrateSimState(UID)).applied).toBe(1);
    expect(JSON.parse(localStorage.getItem(FULL)!)).toEqual(orders);
  });

  it('远端更旧时即使内容不同，也保留正常较新的本地数据', async () => {
    localStorage.setItem(FULL, JSON.stringify(orders));
    localStorage.setItem(SHADOW, String(NOW + 1));
    remote([]);

    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(JSON.parse(localStorage.getItem(FULL)!)).toEqual(orders);
  });

  it('水合时仍无空间也能从共享内存读到云端值，但不能推进磁盘影子戳', async () => {
    localStorage.setItem(FULL, '[]');
    localStorage.setItem(SHADOW, '1');
    rejectDataWrites();
    remote(orders);

    expect((await hydrateSimState(UID)).applied).toBe(1);
    expect(localStorage.getItem(FULL)).toBe('[]');
    expect(JSON.parse(readPersistedStateRaw(FULL)!)).toEqual(orders);
    expect(getUnpersistedStateRaw(FULL)).toBe(JSON.stringify(orders));
    expect(getUnpersistedStateMetadata(FULL)).toMatchObject({ source: 'remote', updatedAt: NOW });
    expect(localStorage.getItem(SHADOW)).toBe('1');
  });

  it('云端 V1 因 quota 暂存在内存后，V0 不回滚它；恢复空间后 V2 可继续采纳落盘', async () => {
    localStorage.setItem(FULL, '[]');
    localStorage.setItem(SHADOW, '1');
    const writes = rejectDataWrites();
    remote(orders);
    expect((await hydrateSimState(UID)).applied).toBe(1);

    remote([], NOW - 1);
    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(JSON.parse(readPersistedStateRaw(FULL)!)).toEqual(orders);

    writes.mockRestore();
    const laterOrders = [...orders, { id: 'protection-c', price: 11 }];
    remote(laterOrders, NOW + 1);
    expect((await hydrateSimState(UID)).applied).toBe(1);
    expect(JSON.parse(localStorage.getItem(FULL)!)).toEqual(laterOrders);
    expect(getUnpersistedStateRaw(FULL)).toBeUndefined();
    expect(Number(localStorage.getItem(SHADOW))).toBe(NOW + 1);
  });

  it('空间仍满时也能把内存远端 V1 更新到 V2，不能误认成未提交的本地操作', async () => {
    rejectDataWrites();
    remote(orders);
    expect((await hydrateSimState(UID)).applied).toBe(1);
    const laterOrders = [...orders, { id: 'protection-c', price: 11 }];
    remote(laterOrders, NOW + 1);

    expect((await hydrateSimState(UID)).applied).toBe(1);
    expect(JSON.parse(readPersistedStateRaw(FULL)!)).toEqual(laterOrders);
    expect(getUnpersistedStateMetadata(FULL)).toMatchObject({ source: 'remote', updatedAt: NOW + 1 });
    expect(localStorage.getItem(SHADOW)).toBeNull();
  });

  it('没有排队的 dirty 内存值也不被水合旧云端覆盖', async () => {
    localStorage.setItem(FULL, '[]');
    rejectDataWrites();
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    remote([{ id: 'remote-only' }], NOW + 60_000);

    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(JSON.parse(readPersistedStateRaw(FULL)!)).toEqual(orders);
  });
});

describe('unfinished pushes remain protected during recovery', () => {
  it('同毫秒但内容不同的排队中新值，不会被等戳恢复路径覆盖', async () => {
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    queueSimStatePush(UID, KEY, orders);
    remote([]);

    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(JSON.parse(localStorage.getItem(FULL)!)).toEqual(orders);
  });

  it('已离开防抖队列但请求仍在进行中的新值，同样不能被水合覆盖', async () => {
    const first = deferredPush();
    mocks.upsert.mockReturnValueOnce(first.promise);
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    queueSimStatePush(UID, KEY, orders);
    await vi.advanceTimersByTimeAsync(1_600);
    remote([], NOW + 60_000);

    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(JSON.parse(localStorage.getItem(FULL)!)).toEqual(orders);
    first.resolve({ error: null });
    await Promise.resolve();
  });

  it('旧请求成功既不能为不同的本地内容盖章，也不能解除新一代的水合保护', async () => {
    const first = deferredPush();
    mocks.upsert.mockReturnValueOnce(first.promise);
    writePersistedStateRaw(FULL, '[]');
    queueSimStatePush(UID, KEY, []);
    await vi.advanceTimersByTimeAsync(1_600);

    // 第二次写入失败：磁盘仍是第一版，但最新操作只存在内存中。
    const writes = rejectDataWrites();
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    queueSimStatePush(UID, KEY, orders);
    first.resolve({ error: null });
    await Promise.resolve();

    // 恢复写盘并清掉 dirty 标记，确保下面真正由新 generation 而非内存标记保护。
    writes.mockRestore();
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    const shadowAfterFirst = localStorage.getItem(SHADOW);
    remote([], NOW + 60_000);
    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(JSON.parse(localStorage.getItem(FULL)!)).toEqual(orders);
    expect(localStorage.getItem(SHADOW)).toBe(shadowAfterFirst);

    await vi.advanceTimersByTimeAsync(1_600);
    remote([{ id: 'later-remote' }], NOW + 60_000);
    expect((await hydrateSimState(UID)).applied).toBe(1); // 最新代成功后正常恢复远端更新。
  });

  it('推送期间磁盘已变成另一内容，成功回调不推进这份不同内容的影子戳', async () => {
    const first = deferredPush();
    mocks.upsert.mockReturnValueOnce(first.promise);
    writePersistedStateRaw(FULL, '[]');
    queueSimStatePush(UID, KEY, []);
    await vi.advanceTimersByTimeAsync(1_600);
    localStorage.setItem(FULL, JSON.stringify(orders));
    first.resolve({ error: null });
    await Promise.resolve();

    expect(localStorage.getItem(SHADOW)).toBe(String(NOW));
  });

  it('最终重试也失败后仍保护未上云的本地新值', async () => {
    mocks.upsert.mockResolvedValue({ error: { message: 'synthetic offline' } });
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    queueSimStatePush(UID, KEY, orders);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    remote([], NOW + 60_000);

    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(JSON.parse(localStorage.getItem(FULL)!)).toEqual(orders);
  });

  it('A 的 dirty 和进行中推送不会阻止 B 恢复，B 的同名键也不覆盖 A 内存', async () => {
    const first = deferredPush();
    mocks.upsert.mockReturnValueOnce(first.promise);
    const writes = rejectDataWrites();
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    queueSimStatePush(UID, KEY, orders);
    writes.mockRestore();

    const userB = 'recovery-user-b';
    const fullB = `sim_${userB}_${KEY}`;
    localStorage.setItem(fullB, '[]');
    localStorage.setItem(`${fullB}__syncts`, String(NOW));
    remote([{ id: 'b-protection' }]);

    expect((await hydrateSimState(userB)).applied).toBe(1);
    expect(JSON.parse(localStorage.getItem(fullB)!)).toEqual([{ id: 'b-protection' }]);
    expect(JSON.parse(readPersistedStateRaw(FULL)!)).toEqual(orders);
    expect(mocks.upsert.mock.calls[0]![0].user_id).toBe(UID);
    first.resolve({ error: null });
    await Promise.resolve();
  });
});

describe('replay history remains a union while quota recovery is active', () => {
  const key = 'replay_timelines_v1';
  const full = `sim_${UID}_${key}`;
  const node = (id: string) => ({
    id, scope: 'synced', parentId: null, cause: 'start', direction: 1,
    forkSimTime: 1_000, startedRealAt: NOW, endSimTime: null, endedRealAt: null,
    carried: {}, lastSimTime: 1_000, lastRealAt: NOW,
  });

  it('dirty/尚未推送的本地登记表仍并入远端独有节点，不丢本地指针且不虚假盖章', async () => {
    const notify = vi.spyOn(persistedStateStorage, 'notifyPersistedStateHydrated');
    const local = { v: 1, nodes: { a: node('a') }, current: { synced: 'a' } };
    rejectDataWrites(full);
    writePersistedStateRaw(full, JSON.stringify(local));
    queueSimStatePush(UID, key, local);
    remote({ v: 1, nodes: { b: node('b') }, current: { synced: 'b' } }, NOW, key);

    expect((await hydrateSimState(UID)).applied).toBe(1);
    const merged = JSON.parse(readPersistedStateRaw(full)!);
    expect(Object.keys(merged.nodes).sort()).toEqual(['a', 'b']);
    expect(merged.current.synced).toBe('a');
    expect(notify).toHaveBeenCalledExactlyOnceWith(full);
    expect(localStorage.getItem(`${full}__syncts`)).toBeNull();
    await vi.advanceTimersByTimeAsync(20_100);
    expect(mocks.upsert.mock.calls[0]![0].value).toEqual(merged);
    expect(localStorage.getItem(`${full}__syncts`)).toBeNull();

    clearPersistedStateMemoryForTests();
  });

  it('远端恰为本地超集时也替换排队旧版本，不能稍后把远端新增节点抹掉', async () => {
    const local = { v: 1, nodes: { a: node('a') }, current: { synced: 'a' } };
    const superset = { v: 1, nodes: { a: node('a'), b: node('b') }, current: { synced: 'a' } };
    writePersistedStateRaw(full, JSON.stringify(local));
    queueSimStatePush(UID, key, local);
    remote(superset, NOW, key);

    expect((await hydrateSimState(UID)).applied).toBe(1);
    await vi.advanceTimersByTimeAsync(20_100);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.upsert.mock.calls[0]![0].value).toEqual(superset);
    expect(JSON.parse(localStorage.getItem(full)!)).toEqual(superset);
  });

  it('登记表合并结果未改变时不发送水合通知', async () => {
    const notify = vi.spyOn(persistedStateStorage, 'notifyPersistedStateHydrated');
    const local = { v: 1, nodes: { a: node('a') }, current: { synced: 'a' } };
    writePersistedStateRaw(full, JSON.stringify(local));
    remote(local, NOW, key);

    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('hydration notifications only follow accepted state', () => {
  it.each([false, true])('采纳远端后通知已挂载读者，写盘失败=%s 时也可读到新内容', async quotaFailure => {
    localStorage.setItem(FULL, '[]');
    if (quotaFailure) rejectDataWrites();
    const observed: Array<{ fullKey: string; raw: string | null }> = [];
    const notify = vi.spyOn(persistedStateStorage, 'notifyPersistedStateHydrated').mockImplementation(fullKey => {
      observed.push({ fullKey, raw: readPersistedStateRaw(fullKey) });
    });
    remote(orders);

    expect((await hydrateSimState(UID)).applied).toBe(1);
    expect(notify).toHaveBeenCalledExactlyOnceWith(FULL);
    expect(observed).toEqual([{ fullKey: FULL, raw: JSON.stringify(orders) }]);
  });

  it.each(['older', 'equal', 'dirty', 'pending'] as const)('保留 %s 本地值时不发出水合通知', async reason => {
    const notify = vi.spyOn(persistedStateStorage, 'notifyPersistedStateHydrated');
    if (reason === 'dirty') rejectDataWrites();
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    if (reason === 'pending') queueSimStatePush(UID, KEY, orders);
    if (reason === 'older') localStorage.setItem(SHADOW, String(NOW + 1));
    if (reason === 'equal') localStorage.setItem(SHADOW, String(NOW));
    remote(reason === 'equal' ? orders : []);

    expect((await hydrateSimState(UID)).applied).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(JSON.parse(readPersistedStateRaw(FULL)!)).toEqual(orders);
  });

  it('只入队和推送本地值不发出水合通知', async () => {
    const notify = vi.spyOn(persistedStateStorage, 'notifyPersistedStateHydrated');
    writePersistedStateRaw(FULL, JSON.stringify(orders));
    queueSimStatePush(UID, KEY, orders);
    await vi.advanceTimersByTimeAsync(1_600);

    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});
