import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** 内存版 user_sim_state：所有「设备」共用这一张表。 */
const cloud = vi.hoisted(() => {
  type Row = { user_id: string; key: string; value: unknown; updated_at: string };
  const rows = new Map<string, Row>();
  const state = { rows, delayMs: 0, failNext: false, signedOut: false, upserts: [] as string[] };
  const id = (user: string, key: string) => `${user}\u0000${key}`;
  const wait = () => new Promise(resolve => setTimeout(resolve, state.delayMs));
  const query = () => {
    const filters: ((row: Row) => boolean)[] = [];
    const run = async () => { await wait(); return [...rows.values()].filter(row => filters.every(f => f(row))); };
    const builder: any = {
      eq(col: keyof Row, value: string) { filters.push(row => row[col] === value); return builder; },
      in(col: keyof Row, values: string[]) { filters.push(row => values.includes(row[col] as string)); return builder; },
      not(col: keyof Row, _op: 'like', pattern: string) { const prefix = pattern.replace(/%$/, ''); filters.push(row => !(row[col] as string).startsWith(prefix)); return builder; },
      async maybeSingle() { const found = await run(); return { data: found[0] ?? null, error: null }; },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return run().then(data => ({ data, error: null })).then(resolve, reject); },
    };
    return { builder, filters, run };
  };
  const from = () => ({
    select: () => query().builder,
    async upsert(row: Row) {
      await wait();
      if (state.failNext) { state.failNext = false; return { error: { message: 'network' } }; }
      rows.set(id(row.user_id, row.key), structuredClone(row)); state.upserts.push(row.key);
      return { error: null };
    },
    delete() {
      const q = query();
      q.builder.then = (resolve: (v: unknown) => void) => q.run().then(found => { for (const row of found) rows.delete(id(row.user_id, row.key)); return { error: null }; }).then(resolve);
      return q.builder;
    },
  });
  return { state, from };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: cloud.from,
  auth: { getSession: async () => ({ data: { session: cloud.state.signedOut ? null : { user: { id: 'u1' } } } }) },
} }));

type Mod = typeof import('../accountBlobSync');
type Value = { items: number[]; map?: Map<string, number>; nan?: number };
/** 一台「设备」= 一份全新加载的同步模块 + 自己的本机存储。 */
async function device(initial?: Value) {
  vi.resetModules();
  const mod: Mod = await import('../accountBlobSync');
  const local = { value: initial as Value | undefined };
  const adapter = {
    name: 'test-blob',
    read: async () => local.value,
    write: async (_owner: string, value: Value | undefined) => { local.value = value; },
    weight: (value: Value | undefined) => value?.items.length ?? 0,
  };
  return {
    mod, local, adapter,
    /** 新开一页：同一台设备的本机记录保留，页内对账缓存清空。 */
    async reopen() { mod.__startNewPageForTests(); await mod.syncAccountBlobOnLoad(adapter, 'u1'); await mod.flushAccountBlobPushesForTests(); },
    async save(value: Value) { local.value = value; mod.noteAccountBlobSaved(adapter, 'u1'); await mod.flushAccountBlobPushesForTests(); },
  };
}
const head = () => cloud.state.rows.get('u1\u0000idb:test-blob')?.value as { rev: string; parts: number; savedAt: number } | undefined;

beforeEach(() => { cloud.state.rows.clear(); cloud.state.delayMs = 0; cloud.state.failNext = false; cloud.state.signedOut = false; cloud.state.upserts = []; });
afterEach(() => { vi.useRealTimers(); });

describe('accountBlobSync', () => {
  it('uploads existing local data when the account has none, and a new device gets it back intact', async () => {
    const a = await device({ items: [1, 2, 3], map: new Map([['x', 1]]), nan: Number.NaN });
    await a.reopen();
    expect(head()?.parts).toBe(1);
    const b = await device();
    await b.reopen();
    expect(b.local.value?.items).toEqual([1, 2, 3]);
    expect(b.local.value?.map).toBeInstanceOf(Map);
    expect(b.local.value?.map?.get('x')).toBe(1);
    expect(Number.isNaN(b.local.value?.nan)).toBe(true);
  });

  it('never lets an empty, never-synced page overwrite the account copy', async () => {
    const a = await device({ items: [1, 2, 3] });
    await a.reopen();
    const before = head()?.rev;
    // 新设备在对账前就保存了空白页（例如网络慢、先用了本机）
    const b = await device();
    await b.save({ items: [] });
    expect(head()?.rev).toBe(before);
    await b.reopen();
    expect(b.local.value?.items).toEqual([1, 2, 3]);
  });

  it('follows edits across devices: the device that did not change adopts, the one that did uploads', async () => {
    const a = await device({ items: [1] });
    await a.reopen();
    const b = await device();
    await b.reopen();
    await b.save({ items: [1, 2] });
    // A 没改过 → 新开一页时取 B 的版本
    await a.reopen();
    expect(a.local.value?.items).toEqual([1, 2]);
    // A 接着改 → 上传；B 新开一页取回
    await a.save({ items: [1, 2, 5] });
    await b.reopen();
    expect(b.local.value?.items).toEqual([1, 2, 5]);
  });

  it('keeps the later save when both devices changed, and keeps the replaced local copy', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000);
    const a = await device({ items: [1] });
    await a.reopen();
    const b = await device();
    await b.reopen();
    vi.setSystemTime(2_000);
    a.local.value = { items: [1, 9] };
    // A 保存了但还没传上去（离线）
    cloud.state.failNext = true;
    await a.save({ items: [1, 9] });
    vi.setSystemTime(3_000);
    await b.save({ items: [1, 2, 3] });
    await a.reopen();
    expect(a.local.value?.items).toEqual([1, 2, 3]);
    const replaced = await a.mod.readReplacedAccountBlob('test-blob', 'u1');
    expect((replaced?.value as Value).items).toEqual([1, 9]);
  });

  it('with two pre-sync copies, keeps the one with more content', async () => {
    const small = await device({ items: [1] });
    await small.reopen();
    const big = await device({ items: [1, 2, 3, 4] });
    await big.reopen();
    expect(big.local.value?.items).toEqual([1, 2, 3, 4]);
    const third = await device();
    await third.reopen();
    expect(third.local.value?.items).toEqual([1, 2, 3, 4]);
  });

  it('splits large data into several rows and removes leftovers when it shrinks', async () => {
    const random = () => Array.from({ length: 400_000 }, (_, i) => (i * 2654435761) % 1_000_003);
    const a = await device({ items: random() });
    await a.reopen();
    expect(head()!.parts).toBeGreaterThan(1);
    const b = await device();
    await b.reopen();
    expect(b.local.value?.items.length).toBe(400_000);
    await b.save({ items: [7] });
    expect(head()!.parts).toBe(1);
    expect([...cloud.state.rows.keys()].filter(k => k.includes('idb:test-blob#'))).toEqual(['u1\u0000idb:test-blob#0']);
  }, 30_000); // 要真的压缩几 MB 数据，机器忙时 5 秒不够

  it('ignores a half-written upload from another device', async () => {
    const a = await device({ items: [1, 2] });
    await a.reopen();
    const chunk = cloud.state.rows.get('u1\u0000idb:test-blob#0')!;
    chunk.value = { ...(chunk.value as object), rev: 'other' };
    const b = await device();
    await b.reopen();
    expect(b.local.value).toBeUndefined();
  });

  it('stops waiting after the timeout and does not change local data afterwards', async () => {
    const a = await device({ items: [1, 2] });
    await a.reopen();
    const b = await device();
    cloud.state.delayMs = 80;
    await b.mod.syncAccountBlobOnLoad(b.adapter, 'u1', 20);
    expect(b.local.value).toBeUndefined();
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(b.local.value).toBeUndefined();
  });

  it('does nothing in the cloud when that account is not signed in, and catches up after sign-in', async () => {
    cloud.state.signedOut = true;
    const a = await device({ items: [1, 2] });
    await a.reopen();
    await a.save({ items: [1, 2, 3] });
    expect(cloud.state.rows.size).toBe(0);
    cloud.state.signedOut = false;
    await a.reopen();
    const b = await device();
    await b.reopen();
    expect(b.local.value?.items).toEqual([1, 2, 3]);
  });

  it('does not upload again when a save did not change the content', async () => {
    const a = await device({ items: [1, 2] });
    await a.reopen();
    const uploads = cloud.state.upserts.length;
    await a.save({ items: [1, 2] });
    await a.save({ items: [1, 2] });
    expect(cloud.state.upserts.length).toBe(uploads);
    await a.save({ items: [1, 2, 3] });
    expect(cloud.state.upserts.length).toBeGreaterThan(uploads);
    // 取回云端的设备，原样再存一次也不重传
    const b = await device();
    await b.reopen();
    const after = cloud.state.upserts.length;
    await b.save({ items: [1, 2, 3] });
    expect(cloud.state.upserts.length).toBe(after);
  });

  it('compresses with gzip and restores exactly', async () => {
    const mod = await import('../accountBlobSync');
    const value = { rows: Array.from({ length: 2_000 }, (_, i) => ({ symbol: 'BTCUSDT', i, inf: i % 7 ? i : Number.POSITIVE_INFINITY })) };
    const encoded = await mod.encodeAccountBlob(value);
    expect(encoded.enc).toBe('gzip');
    expect(encoded.text.length).toBeLessThan(encoded.bytes / 5);
    expect(await mod.decodeAccountBlob(encoded.enc, encoded.text)).toEqual(value);
  });

  it('login hydration skips these rows entirely', async () => {
    const a = await device({ items: [1, 2] });
    await a.reopen();
    const { hydrateSimState } = await import('../simStateSync');
    await hydrateSimState('u1');
    for (let i = 0; i < localStorage.length; i += 1) expect(localStorage.key(i)).not.toContain('idb:');
  });
});
