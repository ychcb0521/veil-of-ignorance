/**
 * 读路径自愈（getCampaignFullData → healCampaignSummarySnapshots）必须收敛到**校正后**的口径，
 * 且只朝一个方向收敛：
 *
 *   · 校正拉齐 + 与库中值实质不同 → 回写一次（closed_profit/+469.96 → closed_loss/−1756.65）；
 *   · 再读一次 → 补丁完全相同，零回写（幂等）；
 *   · K 线拉取失败 → 什么都不写（否则一次限流会把未校正值写回去，状态来回翻）；
 *   · 失败不进缓存 → 下一次拉到了照常收敛；
 *   · 库里已经是校正后的值 → 零回写；
 *   · 本地查不到某条腿的成交记录（换浏览器 / 清过历史成交）→ 校验不了 ≠ 无需校正，不回写；
 *   · K 线接口挂起（连接卡死而非拒绝）→ 到点返回落库值，不回写，首屏不被拖住；
 *   · 进行中的战役 → 不定性、不回写；
 *   · heal: false（列表页）→ 不拉 K 线、不回写、不返回校正。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeCampaignRealizedPnl, reconcileCampaignWithSettlement } from '@/lib/campaignRealizedPnl';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import {
  CORRECTED_LOSS_CAMPAIGN_ID,
  CORRECTED_LOSS_USER_ID,
  CORRECTED_TOTAL,
  MIRROR_CANDLE,
  MIRROR_CLOSE_MS,
  PLANNED_MAX_LOSS_TOTAL,
  activeVariant,
  correctedLossCorrections,
  correctedLossLegs,
  correctedLossStoredCampaign,
  correctedLossTradeRecords,
} from '@/test/fixtures/correctedLossCampaign';

let campaignRows: Array<Record<string, unknown>> = [];
let journalRows: Array<Record<string, unknown>> = [];
let campaignUpdates: Array<Record<string, unknown>> = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }),
    },
    from: (table: string) => {
      let operation: 'select' | 'update' = 'select';
      let payload: Record<string, unknown> = {};
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const rowsOf = () => (
        table === 'trade_campaigns' ? campaignRows : table === 'trade_journals' ? journalRows : []
      );
      const matching = () => rowsOf().filter(row => filters.every(accept => accept(row)));
      const resolveResult = () => {
        const hits = matching();
        if (operation === 'update') {
          if (table === 'trade_campaigns') campaignUpdates.push({ ...payload });
          for (const row of hits) Object.assign(row, payload);
        }
        return { data: hits.map(row => ({ ...row })), error: null };
      };
      const builder = {
        select() { return builder; },
        update(next: Record<string, unknown>) { operation = 'update'; payload = next; return builder; },
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return builder; },
        in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return builder; },
        order() { return builder; },
        single() {
          const result = resolveResult();
          const row = result.data[0] ?? null;
          return Promise.resolve({ data: row, error: row ? null : { code: 'PGRST116', message: 'not found' } });
        },
        maybeSingle() {
          const result = resolveResult();
          return Promise.resolve({ data: result.data[0] ?? null, error: null });
        },
        then(onFulfilled: (value: { data: unknown; error: unknown }) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  },
}));

// 只替换拉 K 线这一层：校正的构造、完整性判断、缓存都走真代码。
const { fetchCanonicalTimePriceAtMock } = vi.hoisted(() => ({
  fetchCanonicalTimePriceAtMock: vi.fn<(symbol: string, time: number) => Promise<{ high: number; low: number; close: number } | null>>(),
}));
vi.mock('@/lib/canonicalTimePrice', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/canonicalTimePrice')>()),
  fetchCanonicalTimePriceAt: fetchCanonicalTimePriceAtMock,
}));

import { CAMPAIGN_CORRECTIONS_FETCH_TIMEOUT_MS, getCampaignFullData } from '../journalApi';

/** 只有镜像止盈那一分钟有 K 线；其余时刻当作没有数据（不校正）。 */
const candleFor = async (_symbol: string, time: number) => (time === MIRROR_CLOSE_MS ? MIRROR_CANDLE : null);

function seed(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
) {
  campaignRows = [{ ...campaign }];
  journalRows = legs.map(item => ({ ...item }));
  campaignUpdates = [];
  localStorage.clear();
  localStorage.setItem(`sim_${CORRECTED_LOSS_USER_ID}_trade_history`, JSON.stringify(tradeRecords));
}

function setLocalTradeHistory(tradeRecords: TradeRecord[] | null) {
  const key = `sim_${CORRECTED_LOSS_USER_ID}_trade_history`;
  if (tradeRecords == null) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(tradeRecords));
}

function storedCampaign(id = CORRECTED_LOSS_CAMPAIGN_ID) {
  return campaignRows.find(row => row.id === id) as unknown as TradeCampaign;
}

describe('getCampaignFullData 自愈收敛到校正后的状态', () => {
  beforeEach(() => {
    fetchCanonicalTimePriceAtMock.mockReset();
    fetchCanonicalTimePriceAtMock.mockImplementation(candleFor);
  });

  it('校正拉齐后回写一次：closed_profit/+469.96 → closed_loss/−1756.65，再读不再写', async () => {
    // 每个用例一个 symbol：拉取按 symbol + 时刻缓存在模块里，用例之间不能互相污染。
    const symbol = 'TUTUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));

    const first = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(1);
    expect(campaignUpdates[0]).toMatchObject({ status: 'closed_loss', direction: 'main_long' });
    expect(campaignUpdates[0].final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(campaignUpdates[0].final_r_multiple).toBeCloseTo(CORRECTED_TOTAL / PLANNED_MAX_LOSS_TOTAL, 8);
    // 返回给详情页的就是回写后的行，附带同一份校正
    expect(first.campaign.status).toBe('closed_loss');
    expect(first.campaign.final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(first.legExitPriceCorrections?.['leg-mirror']?.exitPrice).toBe(MIRROR_CANDLE.close);
    expect(first.legExitPriceCorrections?.['leg-mirror']?.originalExitPrice).toBeCloseTo(0.0966898, 10);
    expect(Object.keys(first.legExitPriceCorrections ?? {})).toEqual(['leg-mirror']);
    expect(storedCampaign().status).toBe('closed_loss');

    const second = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(1);           // 幂等：没有第二次写
    expect(second.campaign.status).toBe('closed_loss');
    expect(storedCampaign().status).toBe('closed_loss'); // 没有被翻回去
  });

  it('K 线拉取失败时什么都不写，库里保持原样；失败不进缓存，下一次拉到了照常收敛', async () => {
    const symbol = 'TUTFAILUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));
    fetchCanonicalTimePriceAtMock.mockImplementation(async () => { throw new Error('HTTP 429'); });

    const failed = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(0);
    expect(storedCampaign().status).toBe('closed_profit');
    expect(storedCampaign().final_realized_pnl).toBeCloseTo(469.96, 6);
    expect(failed.campaign.status).toBe('closed_profit');
    expect(failed.legExitPriceCorrections).toEqual({});

    fetchCanonicalTimePriceAtMock.mockImplementation(candleFor);
    const recovered = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(1);
    expect(recovered.campaign.status).toBe('closed_loss');
    expect(storedCampaign().status).toBe('closed_loss');
  });

  it('库里已经是校正后的值时零回写', async () => {
    const symbol = 'TUTSTEADYUSDT';
    const legs = correctedLossLegs(symbol);
    const records = correctedLossTradeRecords(symbol);
    const settled = reconcileCampaignWithSettlement(
      correctedLossStoredCampaign({}, symbol),
      legs,
      computeCampaignRealizedPnl(correctedLossStoredCampaign({}, symbol), legs, records, correctedLossCorrections()),
    );
    seed(settled, legs, records);

    const result = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(0);
    expect(result.campaign.status).toBe('closed_loss');
    expect(result.campaign.final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
  });

  it('进行中的战役（有腿未结算）不定性、不回写', async () => {
    const symbol = 'TUTACTIVEUSDT';
    const active = activeVariant(symbol);
    seed(active.campaign, active.legs, active.tradeRecords);

    const result = await getCampaignFullData('tut-active');
    expect(campaignUpdates).toHaveLength(0);
    expect(result.campaign.status).toBe('active');
    expect(storedCampaign('tut-active').status).toBe('active');
  });

  it('库里收敛后，换到没有本地成交记录的浏览器再读：校验不了 ≠ 无需校正，零回写、不翻回去', async () => {
    const symbol = 'TUTNORECUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));

    await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(1);
    expect(storedCampaign().status).toBe('closed_loss');
    // 第一次读取把**未校正**的 record.pnl 回填进了腿快照——快照永远不带校正，
    // 没有记录的读取只能从它算出 +469.96，这正是会翻回去的那个数。
    expect(journalRows.find(row => row.id === 'leg-mirror')?.post_realized_pnl).toBeCloseTo(5621.17, 6);

    // 换了一台浏览器：云端水化没跑完 / 清过历史成交，本地一条成交记录都没有
    setLocalTradeHistory(null);
    const withoutRecords = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(1);                  // 没有第二次写
    expect(storedCampaign().status).toBe('closed_loss');
    expect(storedCampaign().final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(withoutRecords.campaign.status).toBe('closed_loss');
    expect(withoutRecords.campaign.final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(withoutRecords.legExitPriceCorrections).toEqual({});

    // 记录回来了：补丁与库里完全一致，仍然零回写——三次读取的写日志只有最初那一条
    setLocalTradeHistory(correctedLossTradeRecords(symbol));
    const withRecords = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(1);
    expect(withRecords.campaign.status).toBe('closed_loss');
    expect(withRecords.campaign.final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
  });

  it('只缺被校正那条腿的成交记录时同样不回写：少一条记录就是校验不完整', async () => {
    const symbol = 'TUTPARTIALUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));
    await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(1);

    setLocalTradeHistory(correctedLossTradeRecords(symbol).filter(record => record.id !== 'r-mirror'));
    const partial = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(1);
    expect(storedCampaign().status).toBe('closed_loss');
    expect(storedCampaign().final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(partial.legExitPriceCorrections).toEqual({});
  });

  it('heal: false（列表页）不拉 K 线、不回写、不返回校正', async () => {
    const symbol = 'TUTLISTUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));

    const result = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID, { heal: false });
    expect(fetchCanonicalTimePriceAtMock).not.toHaveBeenCalledWith(symbol, expect.anything());
    expect(campaignUpdates).toHaveLength(0);
    expect(result.campaign.status).toBe('closed_profit');
    expect(result.legExitPriceCorrections).toBeUndefined();
  });

  const mirrorKey = `sim_${CORRECTED_LOSS_USER_ID}_trade_campaigns`;
  const readMirror = () => JSON.parse(localStorage.getItem(mirrorKey) ?? '[]') as TradeCampaign[];

  it('云端回写成功、本地没有这场的镜像行：不往镜像里插整行（软删后别处恢复的战役不会被本地副本藏起来）', async () => {
    const symbol = 'TUTNOMIRRORUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));
    const other = { ...correctedLossStoredCampaign({}, symbol), id: 'other-local' };
    localStorage.setItem(mirrorKey, JSON.stringify([other]));

    const healed = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(1);
    expect(healed.campaign.status).toBe('closed_loss');
    expect(readMirror().map(row => row.id)).toEqual(['other-local']);
  });

  it('云端回写成功、本地已有这场的镜像行：换成服务端返回的行', async () => {
    const symbol = 'TUTMIRRORUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));
    const other = { ...correctedLossStoredCampaign({}, symbol), id: 'other-local' };
    localStorage.setItem(mirrorKey, JSON.stringify([
      { ...correctedLossStoredCampaign({}, symbol), title: 'stale mirror copy' },
      other,
    ]));

    await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(campaignUpdates).toHaveLength(1);
    const mirror = readMirror();
    expect(mirror.map(row => row.id)).toEqual([CORRECTED_LOSS_CAMPAIGN_ID, 'other-local']);
    expect(mirror[0]).toEqual(storedCampaign());
    expect(mirror[0].status).toBe('closed_loss');
    expect(mirror[0].final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
  });

  /**
   * 部署的库还没有 deleted_at 列时，软删只写得进镜像行的墓碑（见 deleteCampaign 的兜底与 mergeCampaigns）。
   * 云端回写成功的这一支若把服务端返回的整行原样写回镜像，这条墓碑就被一次读路径上的写悄悄抹掉——
   * 页面闸到点放行之后，刚删掉的战役会在下一次读取时复活。立场与上面「找不到」的兜底必须一致。
   */
  it('云端回写成功、自愈期间这一场在别处被软删（库里还没有 deleted_at 列）：镜像上的墓碑留得住', async () => {
    const symbol = 'TUTTOMBSTONEUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));
    const stored = correctedLossStoredCampaign({}, symbol);
    localStorage.setItem(mirrorKey, JSON.stringify([stored]));
    const deletedAt = '2026-09-16T02:00:00.000Z';
    // 自愈正等 K 线：页面闸到点放行，删除在这期间落地（库里没有这一列，墓碑只落在镜像上）
    fetchCanonicalTimePriceAtMock.mockImplementation(async (_symbol, time) => {
      localStorage.setItem(mirrorKey, JSON.stringify([{ ...stored, deleted_at: deletedAt, updated_at: deletedAt }]));
      return time === MIRROR_CLOSE_MS ? MIRROR_CANDLE : null;
    });

    const healed = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    // 云端照常收敛（那张表没有 deleted_at 列，补丁本来也不碰它）
    expect(campaignUpdates).toHaveLength(1);
    expect(healed.campaign.status).toBe('closed_loss');
    expect(storedCampaign().status).toBe('closed_loss');
    // 镜像上的墓碑没被服务端返回的整行盖掉
    const mirror = readMirror();
    expect(mirror.map(row => row.id)).toEqual([CORRECTED_LOSS_CAMPAIGN_ID]);
    expect(mirror[0].deleted_at).toBe(deletedAt);
  });

  /**
   * 云端没有这一行（本地战役 / 这张表不存在）时走「找不到」兜底。自愈跑在读路径上，
   * 列表页的后台自愈还会与页面的写并行：页面闸到点放行之后，它随时可能落地。
   * 所以兜底这一笔只能把汇总补丁打在**此刻**的镜像行上，不能把开头读到的整行写回去。
   */
  it('本地战役：自愈期间这一场在别处被删，落地时不复活它（墓碑不被盖回去）', async () => {
    const symbol = 'TUTLOCALDELUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));
    // 云端一行都没有：读与写都走「找不到」，这一场只存在于本地镜像
    campaignRows = [];
    const stored = correctedLossStoredCampaign({}, symbol);
    localStorage.setItem(mirrorKey, JSON.stringify([stored]));
    const deletedAt = '2026-09-16T00:00:00.000Z';
    // 自愈正等 K 线：页面闸到点放行，删除在这期间落地（镜像上写下墓碑）
    fetchCanonicalTimePriceAtMock.mockImplementation(async (_symbol, time) => {
      localStorage.setItem(mirrorKey, JSON.stringify([{ ...stored, deleted_at: deletedAt, updated_at: deletedAt }]));
      return time === MIRROR_CLOSE_MS ? MIRROR_CANDLE : null;
    });

    const healed = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    // 手里的这一份照旧是校正后的数，但库（镜像）上的墓碑必须留着
    expect(healed.campaign.status).toBe('closed_loss');
    const mirror = readMirror();
    expect(mirror.map(row => row.id)).toEqual([CORRECTED_LOSS_CAMPAIGN_ID]);
    expect(mirror[0].deleted_at).toBe(deletedAt);
    expect(mirror[0].status).toBe('closed_profit');
  });

  it('本地战役：云端没有这一行时照旧收敛，但只盖汇总字段（并发的改名留得住）', async () => {
    const symbol = 'TUTLOCALHEALUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));
    campaignRows = [];
    const stored = correctedLossStoredCampaign({}, symbol);
    localStorage.setItem(mirrorKey, JSON.stringify([stored]));
    fetchCanonicalTimePriceAtMock.mockImplementation(async (_symbol, time) => {
      localStorage.setItem(mirrorKey, JSON.stringify([{ ...stored, title: 'renamed elsewhere' }]));
      return time === MIRROR_CLOSE_MS ? MIRROR_CANDLE : null;
    });

    const healed = await getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
    expect(healed.campaign.status).toBe('closed_loss');
    const mirror = readMirror();
    expect(mirror).toHaveLength(1);
    expect(mirror[0].status).toBe('closed_loss');
    expect(mirror[0].final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(mirror[0].title).toBe('renamed elsewhere');
  });

  // 放在最后：挂起的请求永远不结算，会一直占着模块级的并发槽位。
  it('K 线接口挂起（连接卡死而非拒绝）时到点返回落库值、不回写，详情页首屏不被拖住', async () => {
    const symbol = 'TUTSTALLUSDT';
    seed(correctedLossStoredCampaign({}, symbol), correctedLossLegs(symbol), correctedLossTradeRecords(symbol));
    fetchCanonicalTimePriceAtMock.mockImplementation(() => new Promise(() => undefined));
    vi.useFakeTimers();
    try {
      const pending = getCampaignFullData(CORRECTED_LOSS_CAMPAIGN_ID);
      await vi.advanceTimersByTimeAsync(CAMPAIGN_CORRECTIONS_FETCH_TIMEOUT_MS + 1);
      const stalled = await pending;
      expect(campaignUpdates).toHaveLength(0);
      expect(stalled.campaign.status).toBe('closed_profit');
      expect(stalled.legExitPriceCorrections).toEqual({});
      expect(storedCampaign().status).toBe('closed_profit');
    } finally {
      vi.useRealTimers();
    }
  });
});
