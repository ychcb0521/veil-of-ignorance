import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeCampaign } from '@/types/journal';
import type { CampaignWithLegs, UserLocalSnapshot } from '@/lib/journalApi';
import { createCampaignListCache, getCampaignListCache, clearCampaignListCaches } from '@/lib/campaignListCache';
import { fetchCampaignSourceRows, getCampaignFullData } from '@/lib/journalApi';
import { fetchLegExitPriceCorrections } from '@/lib/campaignLegExecution';

type DetailsOptions = { source: CampaignWithLegs; local: UserLocalSnapshot };
const data = vi.hoisted(() => ({
  sources: [] as CampaignWithLegs[],
  local: {} as UserLocalSnapshot,
  /** 与真实读取器同一约定：页面给的内存数据优先，其余键才读本地存储（这里就是 data.local）。 */
  read: vi.fn((overrides: Partial<UserLocalSnapshot> = {}) => ({ ...data.local, ...overrides })),
  /** 单场详情的替身：默认把全部本地成交当本场成交、不给回放界（缓存按最保守的「无界」处理）。 */
  details: ((_id: string, { source, local }: DetailsOptions) => ({
    ...source, tradeRecords: local.tradeHistory, pendingOrders: [], reverseHedgeOrders: [],
  })) as (id: string, options: DetailsOptions) => Record<string, unknown>,
}));
// 远端只给原始行；这里把「已装配的 sources」直接当原始行，装配是恒等映射。
vi.mock('@/lib/journalApi', () => ({
  fetchCampaignSourceRows: vi.fn(async () => data.sources),
  assembleCampaignsWithLegs: (_userId: string, rows: CampaignWithLegs[]) => rows,
  createUserLocalSnapshotReader: () => ({ read: data.read }),
  getCampaignFullData: vi.fn(async (id: string, options: DetailsOptions) => data.details(id, options)),
}));
vi.mock('@/lib/campaignLegExecution', () => {
  const fetchLegExitPriceCorrections = vi.fn(async (..._args: unknown[]): Promise<Record<string, unknown>> => ({}));
  return {
    fetchLegExitPriceCorrections,
    // 列表读的是带完整性标记的版本：沿用上面的替身，结果按拉齐了处理
    fetchLegExitPriceCorrectionsResult: vi.fn(async (...args: unknown[]) => ({ corrections: await fetchLegExitPriceCorrections(...args), complete: true })),
  };
});
vi.mock('@/lib/campaignRealizedPnl', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/campaignRealizedPnl')>(),
  computeCampaignRealizedPnl: (_campaign: unknown, _legs: unknown, _records: unknown, corrections: Record<string, { exitPrice: number }>) => ({
    total: corrections?.leg?.exitPrice ?? 10, settled: true, byLeg: [],
  }),
}));

function source(id: string, symbol = 'BTCUSDT'): CampaignWithLegs {
  return {
    campaign: {
      id, user_id: 'user-1', symbol, title: id, status: 'closed_profit', actual_evolution: [],
      opened_at: '2026-01-01T00:00:00Z', closed_at: '2026-01-02T00:00:00Z',
      initial_main_size_usdt: 100, initial_leverage: 1, strategy_template: 'custom', direction: 'main_long',
    } as TradeCampaign,
    legs: [],
  };
}
/** mock 里远端原始行就是已装配的 sources。 */
type SourceRows = Awaited<ReturnType<typeof fetchCampaignSourceRows>>;
const asRows = (sources: CampaignWithLegs[]) => sources as unknown as SourceRows;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const defaultDetails = data.details;

beforeEach(() => {
  vi.clearAllMocks();
  clearCampaignListCaches();
  data.sources = [source('one'), source('two', 'ETHUSDT')];
  data.local = { tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [], positionsMap: {} };
  data.details = defaultDetails;
});

/** 等后台的平仓价校正落地、快照不再变。 */
async function settled(cache: ReturnType<typeof createCampaignListCache>) {
  let last = '';
  for (let round = 0; round < 40; round += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
    const current = JSON.stringify(cache.getSnapshot());
    if (current === last) return;
    last = current;
  }
}

describe('campaign list retained snapshots', () => {
  it('returns the same completed rows immediately and only checks the batch source on return', async () => {
    const cache = getCampaignListCache('user-1');
    await cache.refresh();
    const rows = cache.getSnapshot().rows;
    expect(cache.getSnapshot().complete).toBe(true);
    const remote = deferred<SourceRows>();
    vi.mocked(fetchCampaignSourceRows).mockReturnValueOnce(remote.promise);
    const returning = getCampaignListCache('user-1');
    const pending = returning.refresh();
    expect(returning.getSnapshot().rows).toBe(rows);
    expect(returning.getSnapshot().complete).toBe(true);
    remote.resolve(asRows(data.sources.map(item => JSON.parse(JSON.stringify(item)))));
    await pending;
    expect(returning.getSnapshot().rows).toBe(rows);
    expect(getCampaignFullData).toHaveBeenCalledTimes(2);
    expect(fetchLegExitPriceCorrections).toHaveBeenCalledTimes(2);
  });

  it('shares in-flight loading and finishes while the page is unmounted', async () => {
    const remote = deferred<SourceRows>();
    vi.mocked(fetchCampaignSourceRows).mockReturnValueOnce(remote.promise);
    const cache = createCampaignListCache('user-1');
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);
    const first = cache.refresh();
    unsubscribe();
    const callsBefore = listener.mock.calls.length;
    expect(cache.refresh()).toBe(first);
    remote.resolve(asRows(data.sources));
    await first;
    expect(listener).toHaveBeenCalledTimes(callsBefore);
    expect(cache.getSnapshot()).toMatchObject({ complete: true, total: 2 });
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
  });

  it('recomputes changed legs even without a campaign timestamp change, and removes deleted campaigns', async () => {
    const cache = createCampaignListCache('user-1');
    await cache.refresh();
    const oldRows = cache.getSnapshot().rows;
    data.sources = [{ ...data.sources[0], legs: [{ id: 'new-leg', leg_role: 'mirror_tp' } as never] }, data.sources[1]];
    await cache.refresh();
    expect(cache.getSnapshot().rows[0]).not.toBe(oldRows[0]);
    expect(cache.getSnapshot().rows[1]).toBe(oldRows[1]);
    expect(getCampaignFullData).toHaveBeenCalledTimes(3);
    data.sources = [data.sources[1]];
    await cache.refresh();
    expect(cache.getSnapshot().rows.map(row => row.campaign.id)).toEqual(['two']);
  });

  it('invalidates only symbols whose local trading input changed, without touching the remote source', async () => {
    const cache = createCampaignListCache('user-1');
    await cache.refresh();
    const oldRows = cache.getSnapshot().rows;
    data.local = { ...data.local, ordersMap: { BTCUSDT: [{ id: 'new-order' } as never] } };
    await cache.refresh('local');
    expect(getCampaignFullData).toHaveBeenCalledTimes(3);
    expect(vi.mocked(getCampaignFullData).mock.calls[2][0]).toBe('one');
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
    // 重算结果逐字段相同：沿用同一个行对象，卡片与散点图不为它重绘
    expect(cache.getSnapshot().rows[0]).toBe(oldRows[0]);
    expect(cache.getSnapshot().rows[1]).toBe(oldRows[1]);
    // 结果真的变了才换对象，且仍只换那一个标的
    data.local = { ...data.local, tradeHistory: [{ id: 'r1', symbol: 'BTCUSDT' } as never] };
    await cache.refresh('local');
    expect(getCampaignFullData).toHaveBeenCalledTimes(4);
    expect(cache.getSnapshot().rows[0]).not.toBe(oldRows[0]);
    expect(cache.getSnapshot().rows[1]).toBe(oldRows[1]);
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
  });

  it('keeps a successful snapshot on failure and recovers on retry', async () => {
    const cache = createCampaignListCache('user-1');
    await cache.refresh();
    const rows = cache.getSnapshot().rows;
    vi.mocked(fetchCampaignSourceRows).mockRejectedValueOnce(new Error('offline'));
    await cache.refresh();
    expect(cache.getSnapshot()).toMatchObject({ complete: true, refreshing: false, error: 'offline' });
    expect(cache.getSnapshot().rows).toBe(rows);
    await cache.refresh();
    expect(cache.getSnapshot().error).toBeNull();
    expect(cache.getSnapshot().rows).toBe(rows);
  });

  it('does not mark an initial read failure as a successful empty chart', async () => {
    const cache = createCampaignListCache('user-1');
    vi.mocked(fetchCampaignSourceRows).mockRejectedValueOnce(new Error('offline'));
    await cache.refresh();
    expect(cache.getSnapshot()).toMatchObject({ complete: false, error: 'offline', rows: [] });
    await cache.refresh();
    expect(cache.getSnapshot()).toMatchObject({ complete: true, error: null, total: 2 });
  });

  it('retains completed price corrections without requesting them again', async () => {
    const cache = createCampaignListCache('user-1');
    vi.mocked(fetchLegExitPriceCorrections).mockResolvedValueOnce({ leg: {
      exitPrice: 42, originalExitPrice: 10, candleLow: 40, candleHigh: 45,
    } });
    await cache.refresh();
    await vi.waitFor(() => expect(cache.getSnapshot().rows[0].settlement.total).toBe(42));
    const corrected = cache.getSnapshot().rows[0];
    await cache.refresh();
    expect(cache.getSnapshot().rows[0]).toBe(corrected);
    expect(fetchLegExitPriceCorrections).toHaveBeenCalledTimes(2);
  });

  it('late reads and price corrections cannot undo a local edit or resurrect a deleted campaign', async () => {
    const cache = createCampaignListCache('user-1');
    const correction = deferred<Awaited<ReturnType<typeof fetchLegExitPriceCorrections>>>();
    vi.mocked(fetchLegExitPriceCorrections).mockReturnValueOnce(correction.promise);
    await cache.refresh();
    const remote = deferred<SourceRows>();
    vi.mocked(fetchCampaignSourceRows).mockReturnValueOnce(remote.promise);
    const loading = cache.refresh();
    cache.setRows(rows => rows.filter(row => row.campaign.id !== 'one'));
    remote.resolve(asRows(data.sources));
    correction.resolve({ leg: { exitPrice: 42, originalExitPrice: 10, candleLow: 40, candleHigh: 45 } });
    await loading;
    expect(cache.getSnapshot().rows.map(row => row.campaign.id)).toEqual(['two']);
  });

  it('isolates snapshots by user, including empty and still-loading accounts', async () => {
    const first = getCampaignListCache('user-1');
    await first.refresh();
    const second = getCampaignListCache('user-2');
    expect(second.getSnapshot().rows).toEqual([]);
    expect(second.getSnapshot().complete).toBe(false);
    expect(first.getSnapshot().rows).toHaveLength(2);
  });

  it('queues changed data during loading, and does not overwrite edits with a pre-save read', async () => {
    const remote = deferred<SourceRows>();
    vi.mocked(fetchCampaignSourceRows).mockReturnValueOnce(remote.promise);
    const cache = createCampaignListCache('user-1');
    const initial = cache.refresh();
    const finish = cache.beginMutation();
    void cache.refresh('remote');
    remote.resolve(asRows(data.sources));
    await initial;
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
    data.sources = [{ ...data.sources[0], campaign: { ...data.sources[0].campaign, title: 'saved edit' } }];
    // 首次加载不会为了排队的请求而中断：它先完整地完成，写入结束后才以远端为准核对一次
    expect(cache.getSnapshot()).toMatchObject({ complete: true, total: 2 });
    finish();
    await vi.waitFor(() => expect(cache.getSnapshot().rows.map(row => row.campaign.title)).toEqual(['saved edit']));
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2);
  });

  it('reports a single failed campaign, keeps its old row, and retries it without recomputing healthy rows', async () => {
    const cache = createCampaignListCache('user-1');
    await cache.refresh();
    const firstRow = cache.getSnapshot().rows[0];
    data.sources = [{ ...data.sources[0], campaign: { ...data.sources[0].campaign, title: 'updated' } }, data.sources[1]];
    vi.mocked(getCampaignFullData).mockRejectedValueOnce(new Error('broken leg'));
    await cache.refresh();
    expect(cache.getSnapshot()).toMatchObject({ complete: true, failedCount: 1 });
    expect(cache.getSnapshot().rows[0]).toBe(firstRow);
    await cache.refresh();
    expect(cache.getSnapshot().failedCount).toBe(0);
    expect(cache.getSnapshot().rows[0].campaign.title).toBe('updated');
    expect(getCampaignFullData).toHaveBeenCalledTimes(4);
  });

  it('a running first load never restarts: focus, trade-data changes and a star click during it fold into one follow-up', async () => {
    data.sources = [source('one'), source('two', 'ETHUSDT'), source('three', 'SOLUSDT')];
    // 每算完一场就让出并提交进度，好在中途插入操作
    const cache = createCampaignListCache('user-1', { sliceMs: 0, publishMs: 0 });
    const gate = deferred<void>();
    const fullData = async (_id: string, { source, local }: { source: CampaignWithLegs; local: UserLocalSnapshot }) => ({
      ...source, tradeRecords: local.tradeHistory, pendingOrders: [], reverseHedgeOrders: [],
    });
    vi.mocked(getCampaignFullData)
      .mockImplementationOnce(fullData as never)
      .mockImplementationOnce((async (id: string, options: { source: CampaignWithLegs; local: UserLocalSnapshot }) => {
        await gate.promise;
        return fullData(id, options);
      }) as never);
    const seq: Array<{ loaded: number; rows: number; complete: boolean }> = [];
    cache.subscribe(() => {
      const current = cache.getSnapshot();
      seq.push({ loaded: current.loaded, rows: current.rows.length, complete: current.complete });
    });
    const first = cache.refresh();
    await vi.waitFor(() => expect(cache.getSnapshot()).toMatchObject({ loaded: 1, total: 3, complete: false }));
    expect(cache.getSnapshot().rows).toHaveLength(1);

    // 首载期间：窗口焦点（一分钟内）、成交数据变化、点星
    void cache.refresh('remote', { maxAgeMs: 60_000 });
    void cache.refresh('local');
    const finish = cache.beginMutation();
    cache.setRows(rows => rows.map(row => ({ ...row, campaign: { ...row.campaign, importance_weight: 5 } })));
    data.sources = [{ ...data.sources[0], campaign: { ...data.sources[0].campaign, importance_weight: 5 } }, data.sources[1], data.sources[2]];
    finish();
    // 首载还在跑：没有重来（进度没回退、行没清空），也没有第二次远端读取
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
    expect(getCampaignFullData).toHaveBeenCalledTimes(2);
    expect(cache.getSnapshot()).toMatchObject({ loaded: 1, total: 3, complete: false });
    expect(cache.getSnapshot().rows).toHaveLength(1);
    gate.resolve();
    await first;

    const loadedSeq = seq.map(item => item.loaded);
    expect(loadedSeq.every((value, index) => index === 0 || value >= loadedSeq[index - 1])).toBe(true);
    expect(seq.every((item, index) => index === 0 || item.rows >= seq[index - 1].rows)).toBe(true);
    expect(seq.filter((item, index) => index > 0 && item.complete !== seq[index - 1].complete)).toHaveLength(1);
    expect(cache.getSnapshot()).toMatchObject({ complete: true, loaded: 3, total: 3 });
    expect(cache.getSnapshot().rows.map(row => row.campaign.id)).toEqual(['one', 'two', 'three']);
    // 乐观编辑没有被收尾的首载盖掉
    expect(cache.getSnapshot().rows[0].campaign.importance_weight).toBe(5);

    // 首载一结束只补一次核对（写入结束 → 远端），只重算被编辑的那一场；complete 不再掉回去
    await vi.waitFor(() => expect(cache.getSnapshot().refreshing).toBe(false));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2);
    expect(getCampaignFullData).toHaveBeenCalledTimes(4);
    expect(vi.mocked(getCampaignFullData).mock.calls[3][0]).toBe('one');
    expect(cache.getSnapshot().rows[0].campaign.importance_weight).toBe(5);
    expect(cache.getSnapshot()).toMatchObject({ complete: true, loaded: 3, total: 3, failedCount: 0 });
    // 后续核对期间进度与行数也一直停在满值，没有回到 0/3
    expect(seq.filter(item => item.complete).every(item => item.loaded === 3 && item.rows === 3)).toBe(true);
  });

  it('an optimistic importance edit survives a background read that raced the save', async () => {
    const cache = createCampaignListCache('user-1');
    await cache.refresh();
    const remote = deferred<SourceRows>();
    vi.mocked(fetchCampaignSourceRows).mockReturnValueOnce(remote.promise);
    const reload = cache.refresh('remote');
    const finish = cache.beginMutation();
    cache.setRows(rows => rows.map(row => (
      row.campaign.id === 'one' ? { ...row, campaign: { ...row.campaign, importance_weight: 4 } } : row
    )));
    // 远端这次读到的还是保存前的值
    remote.resolve(asRows(data.sources));
    await reload;
    expect(cache.getSnapshot().rows[0].campaign.importance_weight).toBe(4);
    expect(cache.getSnapshot().rows.map(row => row.campaign.id)).toEqual(['one', 'two']);
    data.sources =[{ ...data.sources[0], campaign: { ...data.sources[0].campaign, importance_weight: 4 } }, data.sources[1]];
    finish();
    await vi.waitFor(() => expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(cache.getSnapshot().refreshing).toBe(false));
    expect(cache.getSnapshot().rows[0].campaign.importance_weight).toBe(4);
  });

  it('focus-style refreshes read the remote at most once per window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const cache = createCampaignListCache('user-1');
      await cache.refresh();
      await cache.refresh('remote', { maxAgeMs: 60_000 });
      await cache.refresh('remote', { maxAgeMs: 60_000 });
      expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 61_000);
      await cache.refresh('remote', { maxAgeMs: 60_000 });
      expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2);
      // 不足一分钟的本地核对不受此限，也不碰远端
      await cache.refresh('local');
      expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it('a star click or a delete during the first load is never shown reverted by a progress publish', async () => {
    for (const variant of ['star', 'delete'] as const) {
      vi.clearAllMocks();
      data.sources = [source('one'), source('two', 'ETHUSDT'), source('three', 'SOLUSDT')];
      const cache = createCampaignListCache('user-1', { sliceMs: 0, publishMs: 0 });
      const gate = deferred<void>();
      vi.mocked(getCampaignFullData)
        .mockImplementationOnce((async (id: string, options: DetailsOptions) => data.details(id, options)) as never)
        .mockImplementationOnce((async (id: string, options: DetailsOptions) => {
          await gate.promise;
          return data.details(id, options);
        }) as never);
      const seen: Array<{ loaded: number; weight: number | undefined; hasOne: boolean }> = [];
      cache.subscribe(() => {
        const current = cache.getSnapshot();
        const one = current.rows.find(row => row.campaign.id === 'one');
        seen.push({ loaded: current.loaded, weight: one?.campaign.importance_weight, hasOne: Boolean(one) });
      });
      const first = cache.refresh();
      await vi.waitFor(() => expect(cache.getSnapshot()).toMatchObject({ loaded: 1, complete: false }));
      const finish = cache.beginMutation();
      if (variant === 'star') {
        cache.setRows(rows => rows.map(row => ({ ...row, campaign: { ...row.campaign, importance_weight: 5 } })));
      } else {
        cache.setRows(rows => rows.filter(row => row.campaign.id !== 'one'));
      }
      const editedAt = seen.length;
      gate.resolve();
      await first;
      // 编辑之后的每一次提交（进度提交、收尾提交）都带着编辑后的样子
      const after = seen.slice(editedAt);
      expect(after.length).toBeGreaterThan(1);
      if (variant === 'star') expect(after.every(item => item.weight === 5)).toBe(true);
      else expect(after.every(item => !item.hasOne)).toBe(true);
      expect(cache.getSnapshot()).toMatchObject({ complete: true, loaded: 3, total: 3 });
      finish();
    }
  });

  it('a failed remote read does not arm the focus gate: the next online / focus event reads again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const cache = createCampaignListCache('user-1');
      vi.mocked(fetchCampaignSourceRows).mockRejectedValueOnce(new Error('Failed to fetch'));
      await cache.refresh();
      expect(cache.getSnapshot()).toMatchObject({ complete: false, error: 'Failed to fetch' });
      vi.setSystemTime(Date.now() + 5_000);
      // 五秒后联网了：不能因为「刚读过」而不读
      await cache.refresh('remote', { maxAgeMs: 60_000 });
      expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2);
      expect(cache.getSnapshot()).toMatchObject({ complete: true, error: null, total: 2 });
      // 成功之后的焦点仍受一分钟闸门约束
      await cache.refresh('remote', { maxAgeMs: 60_000 });
      expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2);
      // 完整列表之后的一次失败也一样：三秒后的联网事件立刻重读
      vi.setSystemTime(Date.now() + 61_000);
      vi.mocked(fetchCampaignSourceRows).mockRejectedValueOnce(new Error('Failed to fetch'));
      await cache.refresh('remote', { maxAgeMs: 60_000 });
      expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(3);
      expect(cache.getSnapshot()).toMatchObject({ complete: true, error: 'Failed to fetch' });
      vi.setSystemTime(Date.now() + 3_000);
      await cache.refresh('remote', { maxAgeMs: 60_000 });
      expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(4);
      expect(cache.getSnapshot().error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a remote read that never settles times out: rows kept, error shown, the queued local change still reconciled, retry works', async () => {
    const cache = createCampaignListCache('user-1', { remoteTimeoutMs: 30 });
    await cache.refresh();
    const rows = cache.getSnapshot().rows;
    vi.mocked(fetchCampaignSourceRows).mockReturnValueOnce(new Promise(() => {}));
    const hung = cache.refresh('remote');
    expect(cache.getSnapshot().refreshing).toBe(true);
    // 远端还没回来时成交变了：这次请求跟着正在进行的读取，不另排
    data.local = { ...data.local, tradeHistory: [{ id: 'r1', symbol: 'BTCUSDT' } as never] };
    expect(cache.refresh('local')).toBe(hung);
    await hung;
    expect(cache.getSnapshot()).toMatchObject({ complete: true, refreshing: false });
    expect(cache.getSnapshot().error).toContain('超时');
    // 读远端失败，但等它期间的本地变化没丢：用上次的远端行核对了一遍，只重算牵涉的那一场
    expect(getCampaignFullData).toHaveBeenCalledTimes(3);
    expect(vi.mocked(getCampaignFullData).mock.calls[2][0]).toBe('one');
    expect(cache.getSnapshot().rows[0]).not.toBe(rows[0]);
    expect(cache.getSnapshot().rows[1]).toBe(rows[1]);
    // 重试：读回来就清掉错误
    await cache.refresh('remote');
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(3);
    expect(cache.getSnapshot()).toMatchObject({ error: null, refreshing: false });
  });

  it('late price corrections survive a reconcile that overlaps them', async () => {
    const cache = createCampaignListCache('user-1');
    const correction = deferred<Awaited<ReturnType<typeof fetchLegExitPriceCorrections>>>();
    vi.mocked(fetchLegExitPriceCorrections).mockReturnValueOnce(correction.promise);
    await cache.refresh();
    const uncorrected = cache.getSnapshot().rows[0];
    expect(uncorrected.settlement.total).toBe(10);
    // 一次只牵涉 ETHUSDT 的本地核对停在重算 two 的半路上，这时 one 的校正才回来
    data.local = { ...data.local, ordersMap: { ETHUSDT: [{ id: 'eth-order' } as never] } };
    const gate = deferred<void>();
    vi.mocked(getCampaignFullData).mockImplementationOnce((async (id: string, options: DetailsOptions) => {
      await gate.promise;
      return data.details(id, options);
    }) as never);
    const reconcile = cache.refresh('local');
    await vi.waitFor(() => expect(getCampaignFullData).toHaveBeenCalledTimes(3));
    expect(vi.mocked(getCampaignFullData).mock.calls[2][0]).toBe('two');
    correction.resolve({ leg: { exitPrice: 42, originalExitPrice: 10, candleLow: 40, candleHigh: 45 } });
    await vi.waitFor(() => expect(cache.getSnapshot().rows[0].settlement.total).toBe(42));
    const corrected = cache.getSnapshot().rows[0];
    gate.resolve();
    await reconcile;
    // 收尾提交按缓存条目取行：校正过的那一行还在，不会被循环里早先拿到的旧引用盖回去
    expect(cache.getSnapshot().rows[0]).toBe(corrected);
    expect(cache.getSnapshot().rows[0].settlement.total).toBe(42);
    // 之后的无差别核对也不会再把它跳回去
    await cache.refresh('local');
    expect(cache.getSnapshot().rows[0]).toBe(corrected);
    expect(fetchLegExitPriceCorrections).toHaveBeenCalledTimes(2);
  });

  it('local changes only recompute the campaigns they can reach: sealed closed campaigns ignore later orders, fills, funding and trailing-stop moves', async () => {
    const closedAt = '2026-01-02T00:00:00Z';
    // 今天在回放同一段行情：模拟时刻落在老战役的委托窗口里，真实时刻却晚于它们的窗口一次坐下来以上
    const simNow = Date.parse('2026-01-01T12:00:00Z');
    const later = Date.parse(closedAt) + 3 * 60 * 60_000;
    const closedA = source('closed-a');
    closedA.campaign = { ...closedA.campaign, actual_evolution: [{ id: 'e1', pending_order_id: 'evt-o' } as never] };
    const openC = source('open-c');
    openC.campaign = { ...openC.campaign, status: 'active', closed_at: null };
    openC.legs = [{ id: 'leg', trade_record_id: 'open-c-main' } as never];
    data.sources = [closedA, source('closed-b'), openC, source('eth', 'ETHUSDT')];
    data.details = (_id, { source: current, local }) => ({
      ...current,
      tradeRecords: local.tradeHistory.filter(record => current.legs.some(leg => leg.trade_record_id === record.id || leg.trade_record_id === record.positionId)),
      pendingOrders: [], reverseHedgeOrders: [],
      replayAnchored: true,
      replayEndRealAt: current.campaign.closed_at ? Date.parse(current.campaign.closed_at) : null,
    });
    const cache = createCampaignListCache('user-1');
    await cache.refresh();
    const rows = cache.getSnapshot().rows;
    const recomputed = async (mutate: () => void) => {
      vi.mocked(getCampaignFullData).mockClear();
      mutate();
      await cache.refresh('local');
      expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(1);
      return vi.mocked(getCampaignFullData).mock.calls.map(call => call[0]);
    };
    const order = (extra: Record<string, unknown>) => ({
      symbol: 'BTCUSDT', price: 100, stopPrice: 100, quantity: 1, leverage: 5, marginMode: 'isolated', status: 'NEW',
      createdAt: simNow, createdRealAt: later, ...extra,
    } as never);

    // 挂一张跟踪止损（减仓单）：只有进行中的战役可能被同标的新事件接上
    let trailing = order({ id: 'ts', side: 'LONG', type: 'TRAILING_STOP', reduceOnly: true, peakPrice: 101 });
    expect(await recomputed(() => { data.local = { ...data.local, ordersMap: { BTCUSDT: [trailing] } }; })).toEqual(['open-c']);
    // 之后每根 K 线改 peakPrice / stopPrice：挂单时刻没动、也不是开仓单，一场都不重算
    for (const peak of [102, 103, 104]) {
      trailing = { ...(trailing as object), peakPrice: peak, stopPrice: peak - 1 } as never;
      expect(await recomputed(() => { data.local = { ...data.local, ordersMap: { BTCUSDT: [trailing] } }; })).toEqual([]);
    }
    // 资金费：只有持有那个仓位的进行中战役
    expect(await recomputed(() => {
      data.local = { ...data.local, tradeHistory: [...data.local.tradeHistory, { id: 'f1', symbol: 'BTCUSDT', action: 'FUNDING', positionId: 'open-c-main', closedRealAt: later } as never] };
    })).toEqual(['open-c']);
    // 今天成交的一张开仓空单（模拟时刻在老战役的窗口里）：老战役的时间线到不了今天，只有进行中的重算
    expect(await recomputed(() => {
      data.local = {
        ...data.local,
        filledOrders: [order({ id: 'fo', side: 'SHORT', type: 'CONDITIONAL', triggerPrice: 100, filledAt: simNow + 1, filledRealAt: later + 1, positionId: 'p-new' })],
        positionsMap: { BTCUSDT: [{ id: 'p-new' }] },
      };
    })).toEqual(['open-c']);
    // 没有真实时刻的老单子挂在老战役的窗口里：拿不准归属，老战役也重算
    expect(await recomputed(() => {
      data.local = { ...data.local, ordersMap: { BTCUSDT: [trailing, order({ id: 'legacy', side: 'SHORT', type: 'LIMIT', createdRealAt: undefined })] } };
    })).toEqual(['closed-a', 'closed-b', 'open-c']);
    // 事件流里记了 id 的委托快照变了：它记在 closed-a 的事件流里
    expect(await recomputed(() => {
      data.local = { ...data.local, cancelledOrders: [order({ id: 'evt-o', side: 'SHORT', type: 'CONDITIONAL', cancelledAt: simNow, cancelledRealAt: later })] };
    })).toEqual(['closed-a', 'open-c']);
    // 撤单快照的上限淘汰了一张老战役那次坐下来里的单子：那个时代的战役重算
    const old = order({ id: 'old', side: 'SHORT', type: 'CONDITIONAL', createdRealAt: Date.parse(closedAt) - 60_000, cancelledAt: simNow, cancelledRealAt: Date.parse(closedAt) - 30_000 });
    expect(await recomputed(() => { data.local = { ...data.local, cancelledOrders: [...data.local.cancelledOrders, old] }; }))
      .toEqual(['closed-a', 'closed-b', 'open-c']);
    expect(await recomputed(() => { data.local = { ...data.local, cancelledOrders: data.local.cancelledOrders.filter(item => item.id !== 'old') }; }))
      .toEqual(['closed-a', 'closed-b', 'open-c']);
    // 别的标的一次都没重算；没变的行一直是同一个对象
    const after = cache.getSnapshot().rows;
    expect(after.map(row => row.campaign.id)).toEqual(rows.map(row => row.campaign.id));
    expect(after[1]).toBe(rows[1]);
    expect(after[3]).toBe(rows[3]);
  });

  it('in-memory inputs are used for every reconcile once given, instead of parsing the storage snapshot', async () => {
    const cache = createCampaignListCache('user-1');
    const tradeHistory = [{ id: 'mem', symbol: 'BTCUSDT' }] as never[];
    const inputs = { tradeHistory, ordersMap: {}, filledOrders: [], positionsMap: {} };
    await cache.refresh('remote', { local: inputs });
    expect(data.read).toHaveBeenLastCalledWith(inputs);
    expect(vi.mocked(getCampaignFullData).mock.calls[0][1].local.tradeHistory).toBe(tradeHistory);
    // 写入结束后的远端核对、重试：都还是这几份引用
    cache.beginMutation()();
    await vi.waitFor(() => expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2));
    await settled(cache);
    expect(data.read).toHaveBeenLastCalledWith(inputs);
    await cache.refresh('remote');
    expect(data.read).toHaveBeenLastCalledWith(inputs);
    // 没有内存数据的调用方（测试、别的页面）仍读本地存储
    const plain = createCampaignListCache('user-1');
    await plain.refresh();
    expect(data.read).toHaveBeenLastCalledWith(undefined);
  });
});
