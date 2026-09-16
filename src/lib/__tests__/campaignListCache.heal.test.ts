/**
 * 列表的后台自愈：只检测落库结果与校正后结果不一致的已结束战役，逐场调用详情页打开时的同一个自愈
 * （getCampaignFullData 默认 heal），自己不推补丁、不写库、不触发读取。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignStatus, TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignWithLegs, UserLocalSnapshot } from '@/lib/journalApi';
import {
  CAMPAIGN_LIST_CORRECTIONS_RETRY_MAX_MS,
  CAMPAIGN_LIST_CORRECTIONS_RETRY_MS,
  CAMPAIGN_LIST_HEAL_PAGE_WAIT_MS,
  clearCampaignListCaches,
  createCampaignListCache,
  getCampaignListCache,
  waitForCampaignListHeal,
  whenCampaignListHealIdle,
} from '@/lib/campaignListCache';
import { fetchCampaignSourceRows, getCampaignFullData } from '@/lib/journalApi';
import { fetchLegExitPriceCorrectionsResult } from '@/lib/campaignLegExecution';

type DetailsOptions = { source?: CampaignWithLegs; local?: UserLocalSnapshot; heal?: boolean };
const data = vi.hoisted(() => ({
  sources: [] as CampaignWithLegs[],
  local: {} as UserLocalSnapshot,
  read: (overrides: Partial<UserLocalSnapshot> = {}) => ({ ...data.local, ...overrides }),
  /** 每个缓存建两个读取器：[0] 列表读取用，[1] 后台自愈用（按创建顺序）。 */
  readers: [] as Array<ReturnType<typeof vi.fn>>,
  /** 每场现算的已实现盈亏（没有列出的按 10）；列在 unsettled 里的场次未结算。 */
  totals: {} as Record<string, number>,
  unsettled: new Set<string>(),
  /** 每场结算的来源（没有列出的按 records：每条腿都查得到本地成交）。 */
  basis: {} as Record<string, string>,
  /** 自愈调用（不带预加载数据的 getCampaignFullData）的替身。 */
  heal: vi.fn(async (_id: string): Promise<unknown> => undefined),
}));
vi.mock('@/lib/journalApi', () => ({
  fetchCampaignSourceRows: vi.fn(async () => data.sources),
  assembleCampaignsWithLegs: (_userId: string, rows: CampaignWithLegs[]) => rows,
  createUserLocalSnapshotReader: () => {
    const read = vi.fn(data.read);
    data.readers.push(read);
    return { read };
  },
  // 列表读取带着预加载的行与 heal: false；详情页式的自愈调用不带预加载的行、默认 heal
  getCampaignFullData: vi.fn(async (id: string, options?: DetailsOptions) => (options?.source
    ? { ...options.source, tradeRecords: options.local!.tradeHistory, pendingOrders: [], reverseHedgeOrders: [] }
    : data.heal(id))),
}));
vi.mock('@/lib/campaignLegExecution', () => ({
  fetchLegExitPriceCorrectionsResult: vi.fn(async () => ({ corrections: {}, complete: true })),
}));
vi.mock('@/lib/campaignRealizedPnl', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/campaignRealizedPnl')>(),
  computeCampaignRealizedPnl: (campaign: TradeCampaign, _legs: unknown, _records: unknown, corrections: Record<string, { exitPrice: number }>) => ({
    total: corrections?.leg?.exitPrice ?? data.totals[campaign.id] ?? 10,
    settled: !data.unsettled.has(campaign.id),
    basis: data.basis[campaign.id] ?? 'records',
    recordsByLeg: new Map(),
    byLeg: [],
  }),
}));

function source(id: string, over: Partial<TradeCampaign> = {}): CampaignWithLegs {
  return {
    campaign: {
      id, user_id: 'user-1', symbol: 'BTCUSDT', title: id, status: 'closed_profit', actual_evolution: [],
      opened_at: '2026-01-01T00:00:00Z', closed_at: '2026-01-02T00:00:00Z', final_realized_pnl: 10,
      initial_main_size_usdt: 100, initial_leverage: 1, strategy_template: 'custom', direction: 'main_long',
      ...over,
    } as TradeCampaign,
    legs: [],
  };
}
/** 落库盈利结束 +469.96，校正后 −1756.65。 */
const drifted = (id: string, status: CampaignStatus = 'closed_profit') => {
  data.totals[id] = -1756.65;
  return source(id, { status, final_realized_pnl: 469.96 });
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
/**
 * 会把一场自愈卡住的闸门都登记在这里，afterEach 一律放开。
 * healInFlight 是模块级的：某个用例断言失败、来不及放闸时，后面每个用例的队列都会一直等它，
 * 于是一次计时抖动会连累一整串用例，看起来像另一个 bug。
 */
const healGates: Array<() => void> = [];
function healGate() {
  const gate = deferred<void>();
  healGates.push(() => gate.resolve());
  return gate;
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const healedIds = () => data.heal.mock.calls.map(call => call[0]);
/** 自愈调用：不带预加载的行（战役与腿现读）。 */
const healCallsOf = () => vi.mocked(getCampaignFullData).mock.calls.filter(call => !call[1]?.source);
const listCallsOf = () => vi.mocked(getCampaignFullData).mock.calls.filter(call => call[1]?.source);
const complete = (corrections: Record<string, unknown> = {}) => ({ corrections, complete: true }) as Awaited<ReturnType<typeof fetchLegExitPriceCorrectionsResult>>;
const partial = (corrections: Record<string, unknown> = {}) => ({ corrections, complete: false }) as Awaited<ReturnType<typeof fetchLegExitPriceCorrectionsResult>>;
const LEG_CORRECTION = { exitPrice: -20, originalExitPrice: 10, candleLow: -25, candleHigh: -15 };
const GAP = 5;
/** 列表页挂着（useSyncExternalStore 订阅了缓存）：后台自愈只在这时排下一场。返回退订。 */
const open = (cache: { subscribe: (listener: () => void) => () => void }) => cache.subscribe(() => {});
const correctionCalls = () => vi.mocked(fetchLegExitPriceCorrectionsResult).mock.calls.length;
/** 只冻结 Date（退避按 Date.now 计时）；读取、间隔、校正落地仍走真实定时器。 */
const freezeClock = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const start = Date.parse('2026-09-16T00:00:00Z');
  vi.setSystemTime(start);
  return (offset: number) => vi.setSystemTime(start + offset);
};
/** 轮询到断言通过。冻结 Date 时不用 vi.waitFor：假计时器开着时它每轮都把 Date 往前拨，退避计时就跟着偏了。 */
const until = async (assertion: () => void, timeoutMs = 2_000) => {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (performance.now() > deadline) throw error;
    }
    await sleep(5);
  }
};
/** 本地一处与本场无关的委托变化：足以让条目重建，校正输入（标的 / 腿 / 成交）一个都没变。 */
const touchLocalOrders = (id: string) => {
  data.local = { ...data.local, ordersMap: { BTCUSDT: [{ id, symbol: 'BTCUSDT' } as never] } };
};

beforeEach(() => {
  vi.clearAllMocks();
  clearCampaignListCaches();
  data.totals = {};
  data.unsettled = new Set();
  data.basis = {};
  vi.mocked(fetchLegExitPriceCorrectionsResult).mockImplementation(async () => complete());
  data.readers = [];
  data.local = { tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [], positionsMap: {} };
  data.heal.mockImplementation(async () => undefined);
  data.sources = [];
});

afterEach(async () => {
  while (healGates.length > 0) healGates.pop()!();
  vi.useRealTimers();
  // 让 runHealTurn 的 await done 走完（healInFlight 归位）再进下一个用例
  await new Promise(resolve => setTimeout(resolve, 0));
});

describe('campaign list background heal', () => {
  it('heals only a drifted closed campaign, once, after the load completes; non-drifted, active, planned and unsettled ones never', async () => {
    const unsettled = source('unsettled', { final_realized_pnl: 469.96 });
    data.unsettled.add('unsettled');
    data.totals.unsettled = -1756.65;
    data.totals.active = -1756.65;
    data.totals.planned = -1756.65;
    data.totals['pnl-only'] = -150;
    data.sources = [
      source('same'),
      drifted('drift'),
      // 状态没变、金额实质不同也算偏离
      source('pnl-only', { status: 'closed_loss', final_realized_pnl: -100 }),
      source('active', { status: 'active', closed_at: null, final_realized_pnl: 469.96 }),
      source('planned', { status: 'planned', closed_at: null, final_realized_pnl: 469.96 }),
      unsettled,
    ];
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    expect(cache.getSnapshot().complete).toBe(true);
    await vi.waitFor(() => expect(healedIds()).toEqual(['drift', 'pnl-only']));
    await sleep(40);
    expect(healedIds()).toEqual(['drift', 'pnl-only']);
    // 调用方式与详情页打开时相同：战役与腿现读（不带预加载的行）、默认 heal；只多给一份现读的本地快照
    const healCalls = healCallsOf();
    expect(healCalls.map(call => call[0])).toEqual(['drift', 'pnl-only']);
    expect(healCalls.every(call => call[1]?.heal === undefined && call[1]?.local !== undefined)).toBe(true);
  });

  it('makes no heal call while the first load is still running (first paint unaffected)', async () => {
    data.sources = [drifted('a'), drifted('b')];
    const cache = createCampaignListCache('user-1', { sliceMs: 0, publishMs: 0, healGapMs: 0 });
    open(cache);
    const gate = deferred<void>();
    const base = vi.mocked(getCampaignFullData).getMockImplementation()!;
    vi.mocked(getCampaignFullData)
      .mockImplementationOnce(base)
      .mockImplementationOnce((async (id: string, options?: DetailsOptions) => {
        await gate.promise;
        return base(id, options);
      }) as never);
    const loading = cache.refresh();
    await vi.waitFor(() => expect(cache.getSnapshot()).toMatchObject({ loaded: 1, complete: false }));
    await sleep(30);
    expect(data.heal).not.toHaveBeenCalled();
    gate.resolve();
    await loading;
    await vi.waitFor(() => expect(healedIds()).toEqual(['a', 'b']));
  });

  it('late corrections that create drift trigger the heal once', async () => {
    data.sources = [source('late')];
    const correction = deferred<Awaited<ReturnType<typeof fetchLegExitPriceCorrectionsResult>>>();
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockReturnValueOnce(correction.promise);
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    await sleep(30);
    expect(data.heal).not.toHaveBeenCalled();
    // 校正回来：+10 → −20，状态翻成亏损结束
    correction.resolve(complete({ leg: LEG_CORRECTION }));
    await vi.waitFor(() => expect(cache.getSnapshot().rows[0].campaign.status).toBe('closed_loss'));
    await vi.waitFor(() => expect(healedIds()).toEqual(['late']));
    await cache.refresh();
    await sleep(30);
    expect(healedIds()).toEqual(['late']);
  });

  it('repeated refreshes (remote and local recomputes) never heal the same campaign twice', async () => {
    data.sources = [drifted('drift')];
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    await vi.waitFor(() => expect(healedIds()).toEqual(['drift']));
    for (let round = 0; round < 3; round += 1) {
      await cache.refresh('remote');
      await sleep(15);
    }
    // 本地成交变了、条目重建：同一场仍不再自愈
    data.local = { ...data.local, tradeHistory: [{ id: 'r1', symbol: 'BTCUSDT' } as never] };
    await cache.refresh('local');
    await sleep(30);
    expect(healedIds()).toEqual(['drift']);
  });

  it('a mutation in progress when the turn comes: skipped, not counted, healed after the next completed load', async () => {
    data.sources = [drifted('drift')];
    const cache = createCampaignListCache('user-1', { healGapMs: 20 });
    open(cache);
    await cache.refresh();
    const finish = cache.beginMutation();
    await sleep(60);
    expect(data.heal).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(healedIds()).toEqual(['drift']));
  });

  it('an optimistic edit on the campaign makes the turn skip it (not counted); the next completed load heals it', async () => {
    data.sources = [drifted('edited')];
    const cache = createCampaignListCache('user-1', { healGapMs: 30 });
    open(cache);
    await cache.refresh();
    // 点星（乐观编辑）在排到之前：这一场让路
    cache.setRows(rows => rows.map(row => ({ ...row, campaign: { ...row.campaign, importance_weight: 5 } })));
    await sleep(80);
    expect(data.heal).not.toHaveBeenCalled();
    // 读取完成、乐观编辑作废：重判后照常自愈
    await cache.refresh('remote');
    await vi.waitFor(() => expect(healedIds()).toEqual(['edited']));
  });

  it('a campaign no longer in the list when its turn comes is skipped', async () => {
    data.sources = [drifted('kept'), drifted('removed')];
    const cache = createCampaignListCache('user-1', { healGapMs: 30 });
    open(cache);
    await cache.refresh();
    // 排到之前，远端核对读回的行里已经没有 removed
    data.sources = [data.sources[0]];
    await cache.refresh('remote');
    await vi.waitFor(() => expect(healedIds()).toEqual(['kept']));
    await sleep(80);
    expect(healedIds()).toEqual(['kept']);
  });

  it('heals one at a time and respects the gap between them', async () => {
    data.sources = [drifted('a'), drifted('b'), drifted('c')];
    let inFlight = 0;
    let maxInFlight = 0;
    const spans: Array<{ start: number; end: number }> = [];
    data.heal.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const start = Date.now();
      await sleep(15);
      inFlight -= 1;
      spans.push({ start, end: Date.now() });
    });
    const cache = createCampaignListCache('user-1', { healGapMs: 40 });
    open(cache);
    await cache.refresh();
    const completedAt = Date.now();
    await vi.waitFor(() => expect(spans).toHaveLength(3), { timeout: 2_000 });
    expect(maxInFlight).toBe(1);
    expect(healedIds()).toEqual(['a', 'b', 'c']);
    // 读取完成后的第一场也先歇一次；之后上一场结束到下一场开始至少一个间隔（容 2 ms 的计时抖动）
    expect(spans[0].start - completedAt).toBeGreaterThanOrEqual(38);
    expect(spans[1].start - spans[0].end).toBeGreaterThanOrEqual(38);
    expect(spans[2].start - spans[1].end).toBeGreaterThanOrEqual(38);
  });

  it('a throwing heal is silent, not retried this session, and the other campaigns continue', async () => {
    data.sources = [drifted('broken'), drifted('fine')];
    data.heal.mockImplementation(async (id: string) => {
      if (id === 'broken') throw new Error('network down');
    });
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    await vi.waitFor(() => expect(healedIds()).toEqual(['broken', 'fine']));
    expect(cache.getSnapshot()).toMatchObject({ error: null, failedCount: 0 });
    await cache.refresh('remote');
    await sleep(30);
    expect(healedIds()).toEqual(['broken', 'fine']);
  });

  it('the queue never triggers a refresh and never republishes rows', async () => {
    data.sources = [drifted('a'), drifted('b')];
    const cache = createCampaignListCache('user-1', { healGapMs: 30 });
    open(cache);
    await cache.refresh();
    // 等晚到的（空）校正落地：之后快照不该再变
    await sleep(10);
    expect(data.heal).not.toHaveBeenCalled();
    const reads = vi.mocked(fetchCampaignSourceRows).mock.calls.length;
    const localReads = data.readers[0].mock.calls.length;
    const listCalls = listCallsOf().length;
    const snapshot = cache.getSnapshot();
    const listener = vi.fn();
    cache.subscribe(listener);
    await vi.waitFor(() => expect(healedIds()).toEqual(['a', 'b']));
    await sleep(60);
    expect(vi.mocked(fetchCampaignSourceRows).mock.calls.length).toBe(reads);
    expect(data.readers[0].mock.calls.length).toBe(localReads);
    expect(listCallsOf().length).toBe(listCalls);
    expect(listener).not.toHaveBeenCalled();
    expect(cache.getSnapshot()).toBe(snapshot);
  });

  it('stops scheduling for a torn-down cache or when another user takes over', async () => {
    data.sources = [drifted('drift')];
    const torn = createCampaignListCache('user-1', { healGapMs: 20 });
    open(torn);
    await torn.refresh();
    clearCampaignListCaches();
    await sleep(60);
    expect(data.heal).not.toHaveBeenCalled();

    const mine = getCampaignListCache('user-1');
    open(mine);
    await mine.refresh();
    // 登出 / 换了用户：别的用户取了缓存
    getCampaignListCache('user-2');
    await sleep(300);
    expect(data.heal).not.toHaveBeenCalled();
  });
});

describe('campaign list background heal · review round 1', () => {
  it('no list page subscribed when the turn comes (detail / classify page open): skipped, not counted, healed after returning', async () => {
    data.sources = [drifted('drift')];
    const cache = createCampaignListCache('user-1', { healGapMs: 20 });
    const close = open(cache);
    await cache.refresh();
    // 进了详情页：列表页退订，排到时让路
    close();
    await sleep(60);
    expect(data.heal).not.toHaveBeenCalled();
    // 读取在列表页不在时完成：照样只排队、不跑
    await cache.refresh('remote');
    await sleep(60);
    expect(data.heal).not.toHaveBeenCalled();
    // 回到列表页：挂载时的核对完成后重判，照常自愈
    open(cache);
    await cache.refresh('remote');
    await vi.waitFor(() => expect(healedIds()).toEqual(['drift']));
  });

  it('a heal that never settles stalls only the background queue: no second heal starts, idle stays pending, page gates resolve within their cap', async () => {
    data.sources = [drifted('hung'), drifted('b')];
    const hang = healGate();
    data.heal.mockImplementation(async (id: string) => {
      if (id === 'hung') await hang.promise;
    });
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    await vi.waitFor(() => expect(healedIds()).toEqual(['hung']));
    let idle = false;
    void whenCampaignListHealIdle('hung').then(() => { idle = true; });
    let anyIdle = false;
    void whenCampaignListHealIdle().then(() => { anyIdle = true; });

    // 页面闸（详情页打开 / 列表页写入）最多等上限，挂死的自愈拖不住页面
    const startedAt = Date.now();
    await waitForCampaignListHeal('hung', 60);
    await waitForCampaignListHeal(undefined, 60);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    await sleep(80);
    // 队列不另起一场：b 没开始，那一场也还没算让出
    expect(healedIds()).toEqual(['hung']);
    expect(idle).toBe(false);
    expect(anyIdle).toBe(false);

    hang.resolve();
    await vi.waitFor(() => expect(healedIds()).toEqual(['hung', 'b']));
    expect(idle).toBe(true);
    expect(anyIdle).toBe(true);
    await cache.refresh('remote');
    await sleep(40);
    expect(healedIds()).toEqual(['hung', 'b']);
  });

  it('a list-page write started while a heal is in flight waits for that heal to land before writing', async () => {
    data.sources = [drifted('a')];
    const gate = healGate();
    const order: string[] = [];
    data.heal.mockImplementation(async () => {
      await gate.promise;
      order.push('heal');
    });
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    await vi.waitFor(() => expect(healedIds()).toEqual(['a']));
    // 别的战役（详情页打开的是另一场）不必等
    let otherIdle = false;
    void whenCampaignListHealIdle('other').then(() => { otherIdle = true; });
    await sleep(0);
    expect(otherIdle).toBe(true);
    // 列表页删除的顺序：beginMutation → 乐观拿掉行 → 等自愈让出 → 写
    const finish = cache.beginMutation();
    cache.setRows(rows => rows.filter(row => row.campaign.id !== 'a'));
    const write = (async () => {
      await whenCampaignListHealIdle();
      order.push('delete');
    })();
    let sameIdle = false;
    void whenCampaignListHealIdle('a').then(() => { sameIdle = true; });
    await sleep(30);
    expect(order).toEqual([]);
    expect(sameIdle).toBe(false);
    gate.resolve();
    await write;
    expect(order).toEqual(['heal', 'delete']);
    expect(sameIdle).toBe(true);
    finish();
  });

  it('only queues campaigns the heal could write: every leg linked and recorded locally (a settled abandoned one included)', async () => {
    data.basis = { snapshots: 'leg_snapshots', mixed: 'mixed' };
    data.sources = [
      drifted('ok'),
      { ...drifted('unlinked'), legs: [{ id: 'l1', trade_record_id: null } as unknown as TradeJournal] },
      drifted('snapshots'),
      drifted('mixed'),
      drifted('abandoned', 'abandoned'),
    ];
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    // 已结算的「放弃」：详情自愈会按校正后的盈亏改写它，后台同样排进去
    await vi.waitFor(() => expect(healedIds()).toEqual(['ok', 'abandoned']));
    await sleep(40);
    expect(healedIds()).toEqual(['ok', 'abandoned']);
  });

  it('after a heal backfills leg snapshots and the stored outcome, the next remote refresh keeps the corrected row (no flicker, no refetch)', async () => {
    const leg = { id: 'leg', trade_record_id: 'r1' } as unknown as TradeJournal;
    data.sources = [{ ...source('tut', { status: 'closed_profit', final_realized_pnl: 10 }), legs: [leg] }];
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockImplementation(async () => complete({ leg: LEG_CORRECTION }));
    data.heal.mockImplementation(async () => {
      // 详情页的自愈：腿快照回填 post_*，落库结果改成校正后的值
      const current = data.sources[0];
      data.sources = [{
        campaign: { ...current.campaign, status: 'closed_loss', final_realized_pnl: -20, updated_at: '2026-09-16T00:00:00Z' },
        legs: [{ ...leg, post_realized_pnl: 10, post_outcome: 'win' } as unknown as TradeJournal],
      }];
    });
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    await vi.waitFor(() => expect(healedIds()).toEqual(['tut']));
    expect(cache.getSnapshot().rows[0].campaign.status).toBe('closed_loss');
    const statuses: string[] = [];
    cache.subscribe(() => { statuses.push(cache.getSnapshot().rows[0]?.campaign.status); });
    await cache.refresh('remote');
    await sleep(30);
    expect(cache.getSnapshot().rows[0].campaign.status).toBe('closed_loss');
    expect(statuses.filter(status => status !== 'closed_loss')).toEqual([]);
    expect(fetchLegExitPriceCorrectionsResult).toHaveBeenCalledTimes(1);
  });
});

describe('campaign list background heal · review round 2', () => {
  const linked = (id: string, over: Partial<TradeCampaign> = {}): CampaignWithLegs => ({
    ...source(id, over), legs: [{ id: 'leg', trade_record_id: 'r1' } as unknown as TradeJournal],
  });

  it('incomplete corrections are re-requested on the next completed load (reused and rebuilt entries), stay on the row without flicker, and never drive a heal', async () => {
    data.sources = [linked('part', { status: 'closed_profit', final_realized_pnl: 10 })];
    vi.mocked(fetchLegExitPriceCorrectionsResult)
      .mockResolvedValueOnce(partial({ leg: LEG_CORRECTION }))
      .mockResolvedValueOnce(partial({ leg: LEG_CORRECTION }))
      .mockResolvedValueOnce(partial({ leg: LEG_CORRECTION }))
      .mockResolvedValue(complete({ leg: LEG_CORRECTION }));
    // 退避间隔置 0：这里只测每次远端核对都会重拉；间隔与翻倍见 correction retry backoff
    const cache = createCampaignListCache('user-1', { healGapMs: GAP, correctionsRetryMs: 0 });
    open(cache);
    const statuses: string[] = [];
    cache.subscribe(() => {
      const row = cache.getSnapshot().rows[0];
      if (row) statuses.push(row.campaign.status);
    });
    await cache.refresh();
    // 拉到的一部分照样显示（−20 → 亏损结束），但不可信：不自愈
    await vi.waitFor(() => expect(cache.getSnapshot().rows[0].campaign.status).toBe('closed_loss'));
    // 首载在校正回来之前按未校正的数画过一次（盈利结束），那是首屏；从这里起不许再跳回去
    statuses.length = 0;
    await sleep(30);
    expect(data.heal).not.toHaveBeenCalled();

    // 行没变（条目沿用）：重拉；拿到同样的一部分，不重画行
    const rows = cache.getSnapshot().rows;
    await cache.refresh('remote');
    await vi.waitFor(() => expect(fetchLegExitPriceCorrectionsResult).toHaveBeenCalledTimes(2));
    await sleep(30);
    expect(cache.getSnapshot().rows).toBe(rows);
    expect(data.heal).not.toHaveBeenCalled();

    // 行变了但校正输入没变（改了标题，条目重建）：先按上一份校正显示、再重拉
    data.sources = [linked('part', { status: 'closed_profit', final_realized_pnl: 10, title: 'renamed' })];
    await cache.refresh('remote');
    expect(cache.getSnapshot().rows[0]).toMatchObject({ campaign: { title: 'renamed', status: 'closed_loss' } });
    await vi.waitFor(() => expect(fetchLegExitPriceCorrectionsResult).toHaveBeenCalledTimes(3));
    await sleep(30);
    expect(data.heal).not.toHaveBeenCalled();

    // 这次拉齐：落库 +10 / 盈利 与校正后 −20 / 亏损不一致，自愈一次
    await cache.refresh('remote');
    await vi.waitFor(() => expect(healedIds()).toEqual(['part']));
    await cache.refresh('remote');
    await sleep(30);
    expect(fetchLegExitPriceCorrectionsResult).toHaveBeenCalledTimes(4);
    expect(healedIds()).toEqual(['part']);
    expect(statuses.filter(status => status !== 'closed_loss')).toEqual([]);
  });

  it('a correction fetch that throws is re-requested on the next completed load as well', async () => {
    data.sources = [linked('thrown')];
    data.totals.thrown = 10;
    vi.mocked(fetchLegExitPriceCorrectionsResult)
      .mockRejectedValueOnce(new Error('HTTP 429'))
      .mockResolvedValue(complete({ leg: LEG_CORRECTION }));
    const cache = createCampaignListCache('user-1', { healGapMs: GAP, correctionsRetryMs: 0 });
    open(cache);
    await cache.refresh();
    await sleep(30);
    expect(data.heal).not.toHaveBeenCalled();
    await cache.refresh('remote');
    await vi.waitFor(() => expect(healedIds()).toEqual(['thrown']));
    expect(fetchLegExitPriceCorrectionsResult).toHaveBeenCalledTimes(2);
  });

  it('each heal reads the local snapshot fresh at its turn through a reader of its own, never the list page overrides', async () => {
    data.sources = [drifted('fresh')];
    const cache = createCampaignListCache('user-1', { healGapMs: 30 });
    open(cache);
    const pageTrades = [{ id: 'page-only', symbol: 'BTCUSDT' }] as never;
    await cache.refresh('remote', { local: { tradeHistory: pageTrades, ordersMap: {}, filledOrders: [], positionsMap: {} } });
    // 排到之前本地存储里的成交变了：自愈拿到的是这一刻的
    const stored = [{ id: 'stored-now', symbol: 'BTCUSDT' }] as never;
    data.local = { ...data.local, tradeHistory: stored };
    await vi.waitFor(() => expect(healedIds()).toEqual(['fresh']));
    const [call] = healCallsOf();
    expect(call[1]?.local?.tradeHistory).toBe(stored);
    expect(call[1]?.source).toBeUndefined();
    expect(data.readers).toHaveLength(2);
    expect(data.readers[1]).toHaveBeenCalledWith();
  });
});

describe('campaign list background heal · review round 3', () => {
  const linked = (id: string, over: Partial<TradeCampaign> = {}, recordId = 'r1'): CampaignWithLegs => ({
    ...source(id, over), legs: [{ id: 'leg', trade_record_id: recordId } as unknown as TradeJournal],
  });

  it('exports the retry and page-wait defaults', () => {
    expect(CAMPAIGN_LIST_CORRECTIONS_RETRY_MS).toBe(60_000);
    expect(CAMPAIGN_LIST_CORRECTIONS_RETRY_MAX_MS).toBe(600_000);
    expect(CAMPAIGN_LIST_HEAL_PAGE_WAIT_MS).toBe(2_000);
  });

  it('incomplete corrections: local loads never re-request; remote loads only past a per-id interval that doubles to its cap and survives rebuilds; a complete result clears it', async () => {
    const R = 1_000;
    const at = freezeClock();
    data.sources = [linked('flaky')];
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockResolvedValue(partial({ leg: LEG_CORRECTION }));
    const cache = createCampaignListCache('user-1', { healGapMs: GAP, correctionsRetryMs: R, correctionsRetryMaxMs: 4 * R });
    open(cache);
    const statuses: string[] = [];
    await cache.refresh();
    await until(() => expect(cache.getSnapshot().rows[0].campaign.status).toBe('closed_loss'));
    cache.subscribe(() => { statuses.push(cache.getSnapshot().rows[0]?.campaign.status); });
    expect(correctionCalls()).toBe(1);

    // 跨标签页 storage 事件 / 交易状态变化驱动的本地核对：一次都不重拉
    for (let round = 0; round < 20; round += 1) await cache.refresh('local');
    await sleep(20);
    expect(correctionCalls()).toBe(1);

    // 间隔（1R）内的远端核对：不重拉
    at(R - 1);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(1);
    // 到点：恰好重拉一次，间隔翻倍到 2R（下一次最早 3R）
    at(R);
    await cache.refresh('remote');
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(2);

    // 条目重建（改了标题）不重置计时：仍在间隔内，不重拉，行照旧显示那一部分校正
    data.sources = [linked('flaky', { title: 'renamed' })];
    at(3 * R - 1);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(2);
    expect(cache.getSnapshot().rows[0]).toMatchObject({ campaign: { title: 'renamed', status: 'closed_loss' } });
    at(3 * R);
    // 过了间隔也只有远端核对才重拉：本地核对一次都不发
    for (let round = 0; round < 5; round += 1) await cache.refresh('local');
    await sleep(20);
    expect(correctionCalls()).toBe(2);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(3);

    // 再翻倍到 4R（封顶）：下一次最早 7R；之后仍按 4R
    at(7 * R - 1);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(3);
    at(7 * R);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(4);
    at(11 * R - 1);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(4);
    at(11 * R);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(5);
    expect(data.heal).not.toHaveBeenCalled();

    // 拉齐：清掉计时；落库 +10 / 盈利 与校正后 −20 / 亏损不一致，自愈一次
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockResolvedValue(complete({ leg: LEG_CORRECTION }));
    at(15 * R);
    await cache.refresh('remote');
    await until(() => expect(healedIds()).toEqual(['flaky']));
    expect(correctionCalls()).toBe(6);
    // 退避期间行一直显示那一部分校正，没跳回未校正的数
    expect(statuses.filter(status => status !== 'closed_loss')).toEqual([]);

    // 计时已清：挂的成交换了（新的校正输入）又没拉齐，间隔从 1R 重新起算，而不是接着 4R
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockResolvedValue(partial({ leg: LEG_CORRECTION }));
    data.sources = [linked('flaky', { title: 'renamed' }, 'r2')];
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(7);
    at(16 * R);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(8);
  });

  it('a thrown correction fetch backs off the same way and never drives a heal', async () => {
    const R = 1_000;
    const at = freezeClock();
    data.sources = [linked('thrown')];
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockRejectedValue(new Error('HTTP 429'));
    const cache = createCampaignListCache('user-1', { healGapMs: GAP, correctionsRetryMs: R });
    open(cache);
    await cache.refresh();
    await sleep(20);
    for (let round = 0; round < 5; round += 1) await cache.refresh('local');
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(1);
    at(R);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(2);
    at(3 * R - 1);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(2);
    expect(data.heal).not.toHaveBeenCalled();
  });

  it('a heal that runs longer than the old 30 s turn cap never overlaps the next one, and idle stays pending until it settles', async () => {
    // 连 Date 一起冻：页面闸的上限从那一场开始算起（按 Date.now），假计时器与真实钟不能各走各的
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    data.sources = [drifted('a'), drifted('b')];
    let inFlight = 0;
    let maxInFlight = 0;
    data.heal.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 45_000));
      inFlight -= 1;
    });
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    await vi.advanceTimersByTimeAsync(GAP);
    expect(healedIds()).toEqual(['a']);
    let idle = false;
    void whenCampaignListHealIdle('a').then(() => { idle = true; });
    // 页面闸按默认上限（2 s）放行，不等那一场
    let gateOpen = false;
    void waitForCampaignListHeal('a').then(() => { gateOpen = true; });
    await vi.advanceTimersByTimeAsync(CAMPAIGN_LIST_HEAL_PAGE_WAIT_MS - 1);
    expect(gateOpen).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(gateOpen).toBe(true);

    await vi.advanceTimersByTimeAsync(40_000);
    expect(healedIds()).toEqual(['a']);
    expect(idle).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(idle).toBe(true);
    expect(healedIds()).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(inFlight).toBe(0);
    expect(maxInFlight).toBe(1);
  });

  it('with no heal in flight every gate resolves immediately (also right after a heal has landed)', async () => {
    const settled: string[] = [];
    const probe = () => {
      void whenCampaignListHealIdle().then(() => settled.push('idle'));
      void whenCampaignListHealIdle('x').then(() => settled.push('idle:x'));
      void waitForCampaignListHeal().then(() => settled.push('gate'));
      void waitForCampaignListHeal('x').then(() => settled.push('gate:x'));
    };
    probe();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toHaveLength(4);

    data.sources = [drifted('done')];
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    await vi.waitFor(() => expect(healedIds()).toEqual(['done']));
    await sleep(0);
    settled.length = 0;
    probe();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toHaveLength(4);
  });

  it('a campaign whose cached row carries deleted_at is never healed, whether deleted before queueing or before its turn', async () => {
    data.sources = [
      { ...drifted('deleted'), campaign: { ...drifted('deleted').campaign, deleted_at: '2026-09-15T00:00:00Z' } },
      drifted('later'),
      drifted('kept'),
    ];
    const cache = createCampaignListCache('user-1', { healGapMs: 40 });
    open(cache);
    await cache.refresh();
    // 排到之前，远端核对读回的 later 已经被别处软删
    data.sources = [
      data.sources[0],
      { ...data.sources[1], campaign: { ...data.sources[1].campaign, deleted_at: '2026-09-16T00:00:00Z' } },
      data.sources[2],
    ];
    await cache.refresh('remote');
    await vi.waitFor(() => expect(healedIds()).toEqual(['kept']));
    await sleep(100);
    expect(healedIds()).toEqual(['kept']);
  });
});

describe('campaign list background heal · review round 4', () => {
  const linked = (id: string, over: Partial<TradeCampaign> = {}): CampaignWithLegs => ({
    ...source(id, over), legs: [{ id: 'leg', trade_record_id: 'r1' } as unknown as TradeJournal],
  });

  it('同一场的校正拉取按战役 id 单飞：在飞时条目重建不再重复发起，一次失败也只让间隔翻一倍', async () => {
    const R = 1_000;
    const at = freezeClock();
    data.sources = [linked('shared')];
    const pending = deferred<Awaited<ReturnType<typeof fetchLegExitPriceCorrectionsResult>>>();
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockReturnValueOnce(pending.promise);
    const cache = createCampaignListCache('user-1', { healGapMs: GAP, correctionsRetryMs: R, correctionsRetryMaxMs: 64 * R });
    open(cache);
    await cache.refresh();

    // 那一分钟还挂在慢 429 上；这期间 5 次本地重算把条目重建了 5 遍（校正输入没变）
    for (let round = 0; round < 5; round += 1) {
      touchLocalOrders(`o${round}`);
      await cache.refresh('local');
    }
    await sleep(20);
    expect(correctionCalls()).toBe(1);

    pending.resolve(partial({ leg: LEG_CORRECTION }));
    await sleep(20);
    // 一次拉取只记一次没拉齐：间隔仍是 1R（不是 2^5 · R，也没跳到封顶）
    at(R - 1);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(1);
    at(R);
    await cache.refresh('remote');
    await sleep(20);
    expect(correctionCalls()).toBe(2);
  });

  it('重拉在飞时条目被本地重算重建（校正输入没变）：晚到的完整校正落在新条目上，照常收敛并自愈', async () => {
    const R = 1_000;
    const at = freezeClock();
    data.sources = [linked('rebuilt', { status: 'closed_profit', final_realized_pnl: 10 })];
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockResolvedValueOnce(partial({ leg: LEG_CORRECTION }));
    const cache = createCampaignListCache('user-1', { healGapMs: GAP, correctionsRetryMs: R });
    open(cache);
    await cache.refresh();
    await until(() => expect(cache.getSnapshot().rows[0].campaign.status).toBe('closed_loss'));
    expect(correctionCalls()).toBe(1);
    expect(data.heal).not.toHaveBeenCalled();

    // 退避到点：远端核对重拉，这一次会拉齐，但还挂在网络上
    const retry = deferred<Awaited<ReturnType<typeof fetchLegExitPriceCorrectionsResult>>>();
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockReturnValueOnce(retry.promise);
    at(R);
    await cache.refresh('remote');
    await until(() => expect(correctionCalls()).toBe(2));

    // 拉取在飞时交易状态变了：条目重建，这一条不许再发起（退避挡着），落地的结果也不能丢
    touchLocalOrders('o-rebuild');
    await cache.refresh('local');
    retry.resolve(complete({ leg: LEG_CORRECTION }));
    await until(() => expect(healedIds()).toEqual(['rebuilt']));
    expect(correctionCalls()).toBe(2);
  });

  it('挂死的自愈只在它开始后的上限内挡页面：过了上限，之后每一次页面闸立即放行（登出换用户也一样）', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    data.sources = [drifted('hung')];
    const hang = healGate();
    data.heal.mockImplementation(async () => { await hang.promise; });
    const cache = createCampaignListCache('user-1', { healGapMs: GAP });
    open(cache);
    await cache.refresh();
    // 晚到的（空）校正落地后才排队：拨到这一场真的开始
    for (let round = 0; round < 20 && healedIds().length === 0; round += 1) await vi.advanceTimersByTimeAsync(GAP);
    expect(healedIds()).toEqual(['hung']);

    // 这一场刚开始：页面闸照旧等满上限（它已经跑了不到一个间隔，留出这点余量）
    let first = false;
    void waitForCampaignListHeal().then(() => { first = true; });
    await vi.advanceTimersByTimeAsync(CAMPAIGN_LIST_HEAL_PAGE_WAIT_MS - GAP - 1);
    expect(first).toBe(false);
    await vi.advanceTimersByTimeAsync(GAP + 1);
    expect(first).toBe(true);

    // 十分钟后它还挂着：之后的每一次写入都不该再赔上一个上限
    await vi.advanceTimersByTimeAsync(600_000);
    const settled: string[] = [];
    void waitForCampaignListHeal().then(() => settled.push('gate'));
    void waitForCampaignListHeal('hung').then(() => settled.push('gate:hung'));
    clearCampaignListCaches();
    getCampaignListCache('user-2');
    void waitForCampaignListHeal().then(() => settled.push('gate:after-logout'));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveLength(3);

    // 不设上限的让出闸照旧：那一场落定之前不报让出
    let idle = false;
    void whenCampaignListHealIdle('hung').then(() => { idle = true; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(idle).toBe(false);
    hang.resolve();
    await vi.advanceTimersByTimeAsync(GAP * 2);
    expect(idle).toBe(true);
  });
});

describe('campaign list background heal · review round 5', () => {
  const linked = (id: string, over: Partial<TradeCampaign> = {}): CampaignWithLegs => ({
    ...source(id, over), legs: [{ id: 'leg', trade_record_id: 'r1' } as unknown as TradeJournal],
  });

  it('一场挂死的校正拉取只耽误它自己：同批别的场次照常落地、照常自愈，退避到点还重拉得动', async () => {
    const R = 1_000;
    const at = freezeClock();
    data.sources = [
      linked('hung', { symbol: 'HUNGUSDT' }),
      linked('healthy', { status: 'closed_profit', final_realized_pnl: 10 }),
    ];
    // HUNGUSDT 那一场的连接卡死（永不落定）；另一场先只拉到一部分
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockImplementation(async (symbol: string) => (
      symbol === 'HUNGUSDT' ? new Promise<never>(() => undefined) : partial({ leg: LEG_CORRECTION })
    ));
    const cache = createCampaignListCache('user-1', { healGapMs: GAP, correctionsRetryMs: R });
    open(cache);
    await cache.refresh();

    // 同批的健康场次照常落地：−20 → 亏损结束（挂死的那一场照旧是未校正的数）
    await until(() => expect(cache.getSnapshot().rows[1].campaign.status).toBe('closed_loss'));
    expect(cache.getSnapshot().rows[0].campaign.status).toBe('closed_profit');
    expect(correctionCalls()).toBe(2);
    // 只拉到一部分：还不能拿它判定偏离
    expect(data.heal).not.toHaveBeenCalled();

    // 退避到点：健康场次的在飞槽位早已让出，重拉得动；挂死的那一场还占着自己的槽位，不重复发起
    vi.mocked(fetchLegExitPriceCorrectionsResult).mockImplementation(async (symbol: string) => (
      symbol === 'HUNGUSDT' ? new Promise<never>(() => undefined) : complete({ leg: LEG_CORRECTION })
    ));
    at(R);
    await cache.refresh('remote');
    // 这次拉齐：落库 +10 / 盈利 与校正后 −20 / 亏损不一致，自愈一次
    await until(() => expect(healedIds()).toEqual(['healthy']));
    expect(correctionCalls()).toBe(3);
  });

  it('挂死的自愈只在看门狗到点前挡住别的缓存：登出换用户后新队列照常自愈，让出闸照旧不报让出', async () => {
    data.sources = [drifted('hung')];
    const hang = healGate();
    data.heal.mockImplementation(async (id: string) => { if (id === 'hung') await hang.promise; });
    const stale = createCampaignListCache('user-1', { healGapMs: GAP, healWatchdogMs: 120 });
    open(stale);
    await stale.refresh();
    await vi.waitFor(() => expect(healedIds()).toEqual(['hung']));

    // 登出、换用户登录：上一个用户留下的那一场永远不落定
    clearCampaignListCaches();
    data.sources = [drifted('next')];
    const fresh = createCampaignListCache('user-2', { healGapMs: GAP, healWatchdogMs: 120 });
    open(fresh);
    await fresh.refresh();
    // 看门狗到点之前照旧单飞：不抢在那一场前面跑
    await sleep(60);
    expect(healedIds()).toEqual(['hung']);
    // 到点之后：新用户的队列照常自愈
    await vi.waitFor(() => expect(healedIds()).toEqual(['hung', 'next']));

    // 那一场随时可能写：不设上限的让出闸照旧不报让出（有上限的页面闸不受影响）
    let idle = false;
    void whenCampaignListHealIdle().then(() => { idle = true; });
    let hungIdle = false;
    void whenCampaignListHealIdle('hung').then(() => { hungIdle = true; });
    await waitForCampaignListHeal();
    await sleep(30);
    expect(idle).toBe(false);
    expect(hungIdle).toBe(false);
    hang.resolve();
    await vi.waitFor(() => expect(idle).toBe(true));
    expect(hungIdle).toBe(true);
  });
});
