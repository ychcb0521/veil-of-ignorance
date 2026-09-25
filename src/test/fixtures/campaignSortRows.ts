import type { CampaignSortRow } from '@/lib/campaignListSort';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/**
 * 排序测试用的战役行：只填排序会读到的字段（腿决定操作时间、镜像止盈是否成交、有没有加仓、杠杆兜底）。
 * 其余字段给个合法的占位值。
 */
export type SortRowSpec = {
  id: string;
  title?: string;
  symbol?: string;
  pnl?: number | null;
  importance?: number;
  /** 战役记录的初始杠杆；null = 没记，退回各腿里最大的那个。 */
  leverage?: number | null;
  /** 腿上的杠杆（没记初始杠杆时的兜底）。 */
  legLeverage?: number | null;
  /** 主力腿的平仓时刻（ISO）；null = 没有客观操作时间。 */
  time?: string | null;
  /** 镜像止盈腿已成交。 */
  tp?: boolean;
  /** 有一条成交过的加仓腿。 */
  add?: boolean;
  /** 利润捕获率（%，= 盈亏比 b × 100）。 */
  pcr?: number | null;
  /** 预期回撤（%）。 */
  dd?: number;
  /** 主力涨跌幅（%）。 */
  mpc?: number | null;
  arith?: number | null;
  geo?: number | null;
  dsi?: number | null;
  usi?: number | null;
};

const NOW = '2026-01-01T00:00:00.000Z';

function makeLeg(spec: SortRowSpec, suffix: string, role: TradeJournal['leg_role'], recordId: string | null, closeTime: string | null): TradeJournal {
  return {
    id: `${spec.id}-${suffix}`,
    user_id: 'user-1',
    trade_record_id: recordId,
    campaign_id: spec.id,
    leg_role: role,
    leg_sequence: null,
    source: 'post_review',
    symbol: spec.symbol ?? 'BTCUSDT',
    direction: 'long',
    leverage: spec.legLeverage ?? null,
    position_mode: null,
    order_kind: 'main',
    pre_simulated_time: NOW,
    pre_real_time: NOW,
    pre_entry_price: 100,
    post_real_close_time: closeTime,
    created_at: NOW,
    updated_at: NOW,
  } as unknown as TradeJournal;
}

export function makeSortRow(spec: SortRowSpec): CampaignSortRow {
  const campaign = {
    id: spec.id,
    user_id: 'user-1',
    campaign_code: `C-${spec.id}`,
    symbol: spec.symbol ?? 'BTCUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'custom',
    title: spec.title ?? spec.id,
    opened_at: NOW,
    closed_at: NOW,
    initial_main_size_usdt: 1000,
    initial_leverage: spec.leverage ?? null,
    final_realized_pnl: spec.pnl === undefined ? 0 : spec.pnl,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: spec.importance ?? 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: null,
    created_at: NOW,
    updated_at: NOW,
  } as unknown as TradeCampaign;
  const time = spec.time === undefined ? NOW : spec.time;
  const legs: TradeJournal[] = [makeLeg(spec, 'main', 'main_open', null, time)];
  const tradeRecords: TradeRecord[] = [];
  if (spec.add) legs.push(makeLeg(spec, 'add', 'main_add_1', `${spec.id}-add-record`, null));
  if (spec.tp) {
    legs.push(makeLeg(spec, 'tp', 'mirror_tp', `${spec.id}-tp-record`, null));
    // 成交记录不带真实时刻：不影响操作时间，只证明镜像止盈成交了
    tradeRecords.push({
      id: `${spec.id}-tp-record`,
      symbol: spec.symbol ?? 'BTCUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 100,
      exitPrice: 101,
      quantity: 1,
      leverage: 1,
      pnl: 0,
      fee: 0,
      slippage: 0,
      openTime: 0,
      closeTime: 0,
    } as TradeRecord);
  }
  return {
    campaign,
    legs,
    tradeRecords,
    settlement: {} as CampaignSortRow['settlement'],
    profitCaptureRatio: spec.pcr ?? null,
    initialExpectedMaxLoss: 100,
    initialExpectedMaxDrawdownPct: spec.dd ?? 0,
    opportunityQuality: null,
    mainPriceChangePct: spec.mpc ?? null,
    arithmeticExpectancy: spec.arith ?? null,
    geometricExpectancy: spec.geo ?? null,
    dsiContributionPct: spec.dsi ?? null,
    usiContributionPct: spec.usi ?? null,
  };
}

/** 可复现的伪随机数（mulberry32）。 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 一批随机战役：读数都取自很小的候选集（大量并列），且各项都有一部分缺值——
 * 专门用来逼出并列裁决与缺值处理上的差别。
 */
export function randomSortRows(count: number, seed: number): CampaignSortRow[] {
  const random = seededRandom(seed);
  const pick = <T,>(values: readonly T[]) => values[Math.floor(random() * values.length)];
  const titles = ['Alpha', 'alpha', 'Beta', '贝塔', 'Gamma', '伽马 2', '伽马 10', 'Delta', ''];
  return Array.from({ length: count }, (_, index) => makeSortRow({
    id: `r${index}`,
    title: pick(titles),
    symbol: pick(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']),
    pnl: pick([null, -50, -20, 0, 0, 20, 50, 50, 120]),
    importance: pick([0, 0, 1, 3, 5]),
    leverage: pick([null, null, 5, 10, 10, 20]),
    legLeverage: pick([null, 3, 10]),
    time: pick([null, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', '2026-04-10T08:00:00.000Z', '2026-05-20T12:00:00.000Z']),
    tp: random() < 0.5,
    add: random() < 0.5,
    pcr: pick([null, -130, -100, -5, 0, 5, 80, 250, 250, 600]),
    dd: pick([0, 1.5, 2, 2, 3]),
    mpc: pick([null, -2, 0, 1, 2.5, 2.5, 6]),
    arith: pick([null, -1, 0.25, 0.25, 2.5]),
    geo: pick([null, 0.9, 1.25, 1.25, 1.6]),
    dsi: pick([null, null, 12.5, 40]),
    usi: pick([null, null, 8, 30, 30]),
  }));
}
