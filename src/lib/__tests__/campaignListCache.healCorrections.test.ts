/**
 * 列表后台自愈 × 平仓价校正的完整性。真实的 campaignListCache / campaignLegExecution / campaignRealizedPnl，
 * 只替换 journalApi 的读取（远端行、本地快照、自愈调用）与 1 分钟 K 线接口。
 *
 * 一次 K 线失败（限流 429 / 断网）拿到的「没有校正」不可信：列表不能拿它判定「不偏离」并沿用一整个会话，
 * 也不能拿它把一场已经收敛的战役判成「偏离」。失败的分钟不进 K 线缓存，下一次读取完成时要重新拉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignWithLegs, UserLocalSnapshot } from '@/lib/journalApi';
import { clearCampaignListCaches, createCampaignListCache } from '@/lib/campaignListCache';
import { fetchCampaignSourceRows } from '@/lib/journalApi';
import { fetchCanonicalTimePriceAt } from '@/lib/canonicalTimePrice';
import {
  CORRECTED_LOSS_CAMPAIGN_ID,
  CORRECTED_TOTAL,
  MIRROR_CANDLE,
  MIRROR_CLOSE_MS,
  UNCORRECTED_TOTAL,
  correctedLossLegs,
  correctedLossStoredCampaign,
  correctedLossTradeRecords,
} from '@/test/fixtures/correctedLossCampaign';

type DetailsOptions = { source?: CampaignWithLegs; local?: UserLocalSnapshot; heal?: boolean };
const data = vi.hoisted(() => ({
  sources: [] as CampaignWithLegs[],
  local: {} as UserLocalSnapshot,
  heal: vi.fn(async (_id: string): Promise<unknown> => undefined),
}));
vi.mock('@/lib/journalApi', () => ({
  fetchCampaignSourceRows: vi.fn(async () => data.sources),
  assembleCampaignsWithLegs: (_userId: string, rows: CampaignWithLegs[]) => rows,
  createUserLocalSnapshotReader: () => ({
    read: (overrides: Partial<UserLocalSnapshot> = {}) => ({ ...data.local, ...overrides }),
  }),
  // 列表读取带着预加载的行；详情页式的自愈调用不带
  getCampaignFullData: vi.fn(async (id: string, options?: DetailsOptions) => (options?.source
    ? { ...options.source, tradeRecords: options.local!.tradeHistory, pendingOrders: [], reverseHedgeOrders: [] }
    : data.heal(id))),
}));
vi.mock('@/lib/canonicalTimePrice', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/canonicalTimePrice')>(),
  fetchCanonicalTimePriceAt: vi.fn(),
}));

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const open = (cache: { subscribe: (listener: () => void) => () => void }) => cache.subscribe(() => {});

/**
 * K 线：镜像腿平仓那一分钟前 failures 次抛 429，之后给出真实蜡烛（平仓价在区间外 → 校正）；
 * 其余分钟没有 K 线（不校正、也不算失败）。K 线缓存是模块级的，每个用例用各自的标的隔开。
 */
function klines(failures: number) {
  let left = failures;
  vi.mocked(fetchCanonicalTimePriceAt).mockImplementation(async (_symbol: string, time: number) => {
    if (time !== MIRROR_CLOSE_MS) return null;
    if (left > 0) {
      left -= 1;
      throw new Error('HTTP 429');
    }
    return MIRROR_CANDLE;
  });
}

function seed(symbol: string, over: Parameters<typeof correctedLossStoredCampaign>[0] = {}) {
  data.sources = [{ campaign: correctedLossStoredCampaign(over, symbol), legs: correctedLossLegs(symbol) }];
  data.local = {
    tradeHistory: correctedLossTradeRecords(symbol), ordersMap: {}, cancelledOrders: [], filledOrders: [], positionsMap: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearCampaignListCaches();
  data.heal.mockImplementation(async () => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

const RETRY_MS = 60_000;
/** 只冻结 Date（校正重拉的退避按 Date.now 计时）；读取与 K 线仍走真实定时器。 */
function freezeClock() {
  vi.useFakeTimers({ toFake: ['Date'] });
  const start = Date.parse('2026-09-16T00:00:00Z');
  vi.setSystemTime(start);
  return (offset: number) => vi.setSystemTime(start + offset);
}
const mirrorMinuteCalls = () => vi.mocked(fetchCanonicalTimePriceAt).mock.calls.filter(call => call[1] === MIRROR_CLOSE_MS).length;

describe('campaign list background heal · incomplete exit-price corrections', () => {
  it('an always-failing minute: 20 local loads and remote loads inside the interval send no extra K-line request; past it exactly one, then the interval doubles', async () => {
    seed('STORMUSDT');
    klines(Number.POSITIVE_INFINITY);
    const at = freezeClock();
    const cache = createCampaignListCache('user-1', { healGapMs: 5, correctionsRetryMs: RETRY_MS });
    open(cache);
    await cache.refresh();
    await sleep(30);
    expect(mirrorMinuteCalls()).toBe(1);

    for (let round = 0; round < 20; round += 1) {
      await cache.refresh('local');
    }
    await sleep(30);
    expect(mirrorMinuteCalls()).toBe(1);

    at(RETRY_MS - 1);
    await cache.refresh('remote');
    await sleep(30);
    expect(mirrorMinuteCalls()).toBe(1);

    at(RETRY_MS);
    await cache.refresh('remote');
    await sleep(30);
    expect(mirrorMinuteCalls()).toBe(2);

    // 翻倍：下一次最早 RETRY + 2·RETRY
    at(3 * RETRY_MS - 1);
    await cache.refresh('remote');
    await cache.refresh('local');
    await sleep(30);
    expect(mirrorMinuteCalls()).toBe(2);
    at(3 * RETRY_MS);
    await cache.refresh('remote');
    await sleep(30);
    expect(mirrorMinuteCalls()).toBe(3);
    expect(data.heal).not.toHaveBeenCalled();
  });

  it('a K-line failure during the first load is retried by a later remote load past the interval; the drifted campaign is then healed once', async () => {
    seed('RETRYUSDT');
    klines(1);
    const at = freezeClock();
    const cache = createCampaignListCache('user-1', { healGapMs: 5, correctionsRetryMs: RETRY_MS });
    open(cache);
    await cache.refresh();
    await sleep(30);
    // 那一分钟拉失败：行上是未校正的 +469.96，与落库值相同，看起来「不偏离」
    expect(cache.getSnapshot().rows[0].campaign.final_realized_pnl).toBeCloseTo(UNCORRECTED_TOTAL, 2);
    expect(data.heal).not.toHaveBeenCalled();

    // 间隔内的远端核对不重拉
    await cache.refresh('remote');
    await sleep(30);
    expect(mirrorMinuteCalls()).toBe(1);
    expect(data.heal).not.toHaveBeenCalled();

    // 过了间隔的远端核对（行没变、条目沿用）：失败的校正要重新拉，不能当成「无需校正」沿用一整个会话
    at(RETRY_MS);
    await cache.refresh('remote');
    await vi.waitFor(() => expect(cache.getSnapshot().rows[0].campaign.status).toBe('closed_loss'));
    expect(cache.getSnapshot().rows[0].campaign.final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 2);
    await vi.waitFor(() => expect(data.heal.mock.calls).toEqual([[CORRECTED_LOSS_CAMPAIGN_ID]]));

    for (let round = 0; round < 2; round += 1) {
      await cache.refresh('remote');
      await sleep(20);
    }
    await cache.refresh('local');
    await sleep(30);
    expect(data.heal).toHaveBeenCalledTimes(1);
    // 拉齐之后沿用：镜像那一分钟总共只拉了两次（失败一次、成功一次）
    expect(mirrorMinuteCalls()).toBe(2);
    expect(fetchCampaignSourceRows).toHaveBeenCalledTimes(5);
  });

  it('an incomplete correction never makes an already-converged campaign look drifted', async () => {
    // 落库已经是校正后的 closed_loss / −1756.65；这次镜像那一分钟一直拉不到
    seed('HEALEDUSDT', {
      status: 'closed_loss', final_realized_pnl: CORRECTED_TOTAL,
    });
    klines(3);
    // 退避置 0：每次远端核对都重拉，这里只测拉不齐的校正不判偏离
    const cache = createCampaignListCache('user-1', { healGapMs: 5, correctionsRetryMs: 0 });
    open(cache);
    await cache.refresh();
    await sleep(30);
    // 拉不齐时行上是未校正的 closed_profit / +469.96，与落库值「不一致」——但这不可信，不排自愈
    expect(cache.getSnapshot().rows[0].campaign.status).toBe('closed_profit');
    await cache.refresh('remote');
    await sleep(30);
    await cache.refresh('remote');
    await sleep(30);
    expect(data.heal).not.toHaveBeenCalled();
    // K 线恢复：下一次读取完成时拉齐，行与落库一致，仍然不自愈
    await cache.refresh('remote');
    await vi.waitFor(() => expect(cache.getSnapshot().rows[0].campaign.status).toBe('closed_loss'));
    await sleep(30);
    expect(data.heal).not.toHaveBeenCalled();
  });
});
