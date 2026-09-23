/**
 * 「原样重跑 Legs 副本 ≡ 真实盈亏概览」的黄金夹具。
 *
 * 每一场都是实盘里真会出现的形状：纯多单、带镜像止盈、平仓价被 K 线校正过、
 * 初始对冲从未成交、滚动对冲成交过、币本位空单配多头对冲、每条记录都带手续费、
 * 只剩复盘快照的腿。库级黄金测试与详情页整页测试共用这一份，任何一边再分叉都会在这里翻红。
 *
 * 数字的来历写在各场旁边；手续费按模拟器现行的 Taker 0.05%（TAKER_FEE）写进记录，
 * 记录的 pnl 与引擎一样是「毛盈亏 − 平仓费」，开仓费只存在 openFeeUsd 里。
 *
 * 后半部分（SIMULATOR_PARITY_FIXTURES）不手写记录，而是用模拟器自己的
 * executeSettlementFill / mergeFilledPosition / settlePositionClose 下单、合并、分刀平仓：
 * 市价单带滑点（成交价 ≠ 委托价，pre_position_size 按委托价写）、主力与镜像并成一个仓位、
 * 镜像止盈是对整仓按比例减仓——手写夹具恰好绕开的三件事，实盘每一场都有。
 */
// 详情页测试会在 vi.mock 的工厂里动态 import 这个夹具，运行时不能反过来依赖被 mock 的模块：
// 这里只在运行时依赖模拟器的结算函数（tradingSettlement），它不在任何一个测试的 mock 名单里。
import type { KlineData } from '@/hooks/useBinanceData';
import type { LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import {
  correctedLossCorrections,
  correctedLossLegs,
  correctedLossStoredCampaign,
  correctedLossTradeRecords,
} from '@/test/fixtures/correctedLossCampaign';
import {
  executeSettlementFill,
  getPositionNotionalUsd,
  getPositionUnits,
  mergeFilledPosition,
  scaleSettlementPosition,
  settlePositionClose,
} from '@/lib/tradingSettlement';
import type { CampaignEvent, LegRole, TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, Position, TradeRecord } from '@/types/trading';

export const PARITY_T0 = Date.parse('2026-01-01T00:00:00.000Z');
export const PARITY_MINUTE = 60_000;
export const PARITY_HOUR = 60 * PARITY_MINUTE;
/** 与 src/types/trading.ts 的 TAKER_FEE 相同；夹具只引类型，所以写死并在测试里对账。 */
export const PARITY_TAKER_FEE = 0.0005;

const at = (minutes: number) => PARITY_T0 + minutes * PARITY_MINUTE;
const iso = (ms: number) => new Date(ms).toISOString();

export interface ParityFixture {
  id: string;
  title: string;
  symbol: string;
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  reverseHedgeOrders: CampaignReverseHedgeOrder[];
  corrections: LegExitPriceCorrections;
  klines: KlineData[];
  /**
   * 这一场里按构造**对不上**的指标 → 理由。只有真实面板自己的已知局限才写在这里，
   * 黄金测试对这些项跳过比对、并断言理由非空；其余每一项照样逐分比。
   */
  exclusions?: Partial<Record<ParityMetric, string>>;
  /**
   * 本地委托快照证明从未成交的委托 id（getCampaignFullData 的 unfilledOrderIds）：
   * 通过「记录决策」挂出的保护单，腿上存的是委托 id。页面把它交给权益路径与「Legs 副本」，夹具照样传。
   */
  unfilledOrderIds?: string[];
}

/** 黄金对账逐项比对的指标名（与 counterfactualParity.test.ts 的 PanelNumbers 同名）。 */
export type ParityMetric =
  | 'realizedPnl'
  | 'peakUnrealizedPnl'
  | 'initialExpectedMaxLoss'
  | 'expectedMaxDrawdownPct'
  | 'mainLeverage'
  | 'initialMainExposureNotional'
  | 'payoffRatio'
  | 'arithmeticExpectancy'
  | 'geometricExpectancy'
  | 'dsiUsiTerm'
  | 'mainPriceChangePct'
  | 'mainPriceEfficiency'
  | 'addEfficiency';

interface FilledLegSpec {
  id: string;
  role: LegRole;
  side: 'LONG' | 'SHORT';
  entry: number;
  exit: number;
  /** U 本位是币数；币本位是张数。 */
  qty: number;
  openMs: number;
  closeMs: number;
  leverage?: number;
  /** 币本位：每张面值（USD）。 */
  contractSizeUsd?: number;
  /** 按 Taker 0.05% 把开平仓手续费写进记录。 */
  fees?: boolean;
}

interface PendingHedgeSpec {
  id: string;
  role: LegRole;
  direction: 'long' | 'short';
  trigger: number;
  sizeUsdt: number;
  placedMs: number;
  leverage?: number;
}

interface SnapshotLegSpec {
  id: string;
  role: LegRole;
  direction: 'long' | 'short';
  entry: number;
  exit: number;
  sizeUsdt: number;
  openMs: number;
  closeMs: number;
  realizedPnl: number;
  leverage?: number;
}

function notionalOf(spec: FilledLegSpec): number {
  return spec.contractSizeUsd ? spec.qty * spec.contractSizeUsd : spec.qty * spec.entry;
}

function grossOf(spec: FilledLegSpec, exit = spec.exit): number {
  const sign = spec.side === 'LONG' ? 1 : -1;
  return sign * (exit - spec.entry) / spec.entry * notionalOf(spec);
}

/** 模拟器的收费口径：U 本位 数量 × 成交价 × 费率；币本位 张数 × 面值 × 费率（折美元后价格约掉）。 */
function feeAt(spec: FilledLegSpec, price: number): number {
  if (!spec.fees) return 0;
  return spec.contractSizeUsd
    ? spec.qty * spec.contractSizeUsd * PARITY_TAKER_FEE
    : spec.qty * price * PARITY_TAKER_FEE;
}

function recordOf(spec: FilledLegSpec, symbol: string): TradeRecord {
  const closeFee = feeAt(spec, spec.exit);
  const coin = spec.contractSizeUsd != null;
  return {
    id: `${spec.id}-rec`,
    positionId: `${spec.id}-pos`,
    fillId: `${spec.id}-pos`,
    symbol,
    side: spec.side,
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: spec.entry,
    exitPrice: spec.exit,
    quantity: spec.qty,
    leverage: spec.leverage ?? 1,
    pnl: grossOf(spec) - closeFee,
    fee: closeFee,
    slippage: 0,
    openTime: spec.openMs,
    closeTime: spec.closeMs,
    ...(coin
      ? {
        settlementMode: 'coin' as const,
        settlementAsset: 'BTC',
        contracts: spec.qty,
        contractSizeUsd: spec.contractSizeUsd,
        feeCoin: closeFee / spec.exit,
      }
      : { settlementMode: 'usdt' as const }),
    ...(spec.fees
      ? {
        openFeeUsd: feeAt(spec, spec.entry),
        openFeeCoin: coin ? feeAt(spec, spec.entry) / spec.entry : undefined,
        openFeeRate: PARITY_TAKER_FEE,
        openIsMaker: false,
        closeFeeRate: PARITY_TAKER_FEE,
        closeIsMaker: false,
      }
      : {}),
  };
}

function baseLeg(fixtureId: string, id: string, sequence: number): Partial<TradeJournal> {
  return {
    id,
    user_id: 'user-1',
    campaign_id: fixtureId,
    leg_sequence: sequence,
    position_mode: 'isolated',
    pre_real_time: iso(PARITY_T0),
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: 'parity',
    pre_mental_state: 3,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: true,
    pre_max_loss_usdt: null,
    pre_account_equity_usdt: 10_000,
    post_outcome: null,
    post_realized_pnl: null,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    reason_was_rewritten: false,
    created_at: iso(PARITY_T0),
    updated_at: iso(PARITY_T0),
  };
}

function filledLeg(fixtureId: string, spec: FilledLegSpec, sequence: number, symbol: string): TradeJournal {
  const coin = spec.contractSizeUsd != null;
  return {
    ...baseLeg(fixtureId, spec.id, sequence),
    trade_record_id: `${spec.id}-rec`,
    leg_role: spec.role,
    source: 'live',
    symbol,
    direction: spec.side === 'LONG' ? 'long' : 'short',
    leverage: spec.leverage ?? 1,
    order_kind: spec.role.startsWith('hedge_') ? 'hedge' : 'main',
    pre_simulated_time: iso(spec.openMs),
    pre_entry_price: spec.entry,
    pre_position_size: notionalOf(spec),
    pre_settlement_mode: coin ? 'coin' : 'usdt',
    pre_contract_size_usd: coin ? spec.contractSizeUsd : null,
    pre_contracts: coin ? spec.qty : null,
    post_simulated_close_time: iso(spec.closeMs),
    post_exit_price_snapshot: spec.exit,
  } as TradeJournal;
}

/** 挂出去、从未成交的保护单：没有成交 id、没有平仓快照、没有 hedge_triggered 事件（Legs 表里显示「挂单中」）。 */
function pendingHedgeLeg(fixtureId: string, spec: PendingHedgeSpec, sequence: number, symbol: string): TradeJournal {
  return {
    ...baseLeg(fixtureId, spec.id, sequence),
    trade_record_id: null,
    leg_role: spec.role,
    source: 'live',
    symbol,
    direction: spec.direction,
    leverage: spec.leverage ?? 1,
    order_kind: 'hedge',
    pre_simulated_time: iso(spec.placedMs),
    pre_entry_price: spec.trigger,
    pre_position_size: spec.sizeUsdt,
    pre_account_equity_usdt: null,
  } as TradeJournal;
}

/** 本地没有成交记录、只剩复盘快照的腿：结算读 post_realized_pnl。 */
function snapshotLeg(fixtureId: string, spec: SnapshotLegSpec, sequence: number, symbol: string): TradeJournal {
  return {
    ...baseLeg(fixtureId, spec.id, sequence),
    trade_record_id: null,
    leg_role: spec.role,
    source: 'retroactive_from_record',
    symbol,
    direction: spec.direction,
    leverage: spec.leverage ?? 1,
    order_kind: 'main',
    pre_simulated_time: iso(spec.openMs),
    pre_entry_price: spec.entry,
    pre_position_size: spec.sizeUsdt,
    pre_account_equity_usdt: null,
    post_simulated_close_time: iso(spec.closeMs),
    post_exit_price_snapshot: spec.exit,
    post_realized_pnl: spec.realizedPnl,
    post_outcome: spec.realizedPnl > 0 ? 'win' : spec.realizedPnl < 0 ? 'loss' : 'breakeven',
  } as TradeJournal;
}

interface FixtureInput {
  id: string;
  title: string;
  symbol?: string;
  direction: TradeCampaign['direction'];
  filled: FilledLegSpec[];
  pending?: PendingHedgeSpec[];
  snapshots?: SnapshotLegSpec[];
  corrections?: LegExitPriceCorrections;
  klines: KlineData[];
}

function buildFixture(input: FixtureInput): ParityFixture {
  const symbol = input.symbol ?? 'TESTUSDT';
  const records = input.filled.map(spec => recordOf(spec, symbol));
  let sequence = 0;
  const legs = [
    ...input.filled.map(spec => filledLeg(input.id, spec, ++sequence, symbol)),
    ...(input.pending ?? []).map(spec => pendingHedgeLeg(input.id, spec, ++sequence, symbol)),
    ...(input.snapshots ?? []).map(spec => snapshotLeg(input.id, spec, ++sequence, symbol)),
  ];
  const closeTimes = [
    ...input.filled.map(spec => spec.closeMs),
    ...(input.snapshots ?? []).map(spec => spec.closeMs),
  ];
  const closedAt = Math.max(...closeTimes);
  const storedTotal = records.reduce((sum, record) => sum + record.pnl, 0)
    + (input.snapshots ?? []).reduce((sum, spec) => sum + spec.realizedPnl, 0);
  const main = input.filled.find(spec => spec.role === 'main_open') ?? input.filled[0];
  const campaign = {
    id: input.id,
    user_id: 'user-1',
    campaign_code: `C-${input.id}`,
    symbol,
    direction: input.direction,
    status: storedTotal > 0 ? 'closed_profit' : storedTotal < 0 ? 'closed_loss' : 'closed_breakeven',
    strategy_template: 'custom',
    title: input.title,
    opened_at: iso(PARITY_T0),
    closed_at: iso(closedAt),
    initial_main_size_usdt: notionalOf(main),
    initial_leverage: main.leverage ?? 1,
    final_realized_pnl: storedTotal,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: null,
    created_at: iso(PARITY_T0),
    updated_at: iso(closedAt),
  } as TradeCampaign;
  return {
    id: input.id,
    title: input.title,
    symbol,
    campaign,
    legs,
    tradeRecords: records,
    reverseHedgeOrders: [],
    corrections: input.corrections ?? {},
    klines: input.klines,
  };
}

const bar = (hours: number, open: number, high: number, low: number, close: number): KlineData => ({
  time: PARITY_T0 + hours * PARITY_HOUR,
  open,
  high,
  low,
  close,
  volume: 1,
});

/** 01:00 这根冲到 130：真实峰值由它决定。 */
const LONG_KLINES: KlineData[] = [
  bar(0, 100, 105, 99, 104),
  bar(1, 104, 130, 100, 112),
  bar(2, 112, 115, 105, 110),
  bar(3, 110, 111, 109, 110),
];

/**
 * 01:00 这根冲到 130；02:00 起换成 5 分钟一根，02:50 那根冲到 140。
 * 结束时间记在 02:40 的战役（比 03:00 的最后一次平仓早 20 分钟），窗口截在 02:40 就看不到这根。
 */
const FINE_TAIL_KLINES: KlineData[] = [
  bar(0, 100, 105, 99, 104),
  bar(1, 104, 130, 100, 112),
  ...Array.from({ length: 24 }, (_value, index): KlineData => ({
    time: PARITY_T0 + 2 * PARITY_HOUR + index * 5 * PARITY_MINUTE,
    open: 110,
    high: index === 10 ? 140 : 111,
    low: 109,
    close: 110,
    volume: 1,
  })),
];

/** 结束时间记早了：旧版结束对话框在东八区把 closed_at 记得比模拟时钟早 8 小时。 */
const EIGHT_HOURS = 8 * PARITY_HOUR;

/**
 * 同一场战役，只把战役行上的 closed_at 换掉（结束时间记早了的老战役），其余一切照旧；可以换一套 K 线。
 */
function withClosedAt(
  fixture: ParityFixture,
  over: { id: string; title: string; closedAtMs: number; klines?: KlineData[] },
): ParityFixture {
  return {
    ...fixture,
    id: over.id,
    title: over.title,
    klines: over.klines ?? fixture.klines,
    campaign: {
      ...fixture.campaign,
      id: over.id,
      title: over.title,
      closed_at: iso(over.closedAtMs),
      updated_at: iso(over.closedAtMs),
    },
  };
}

/** 02:00 这根下探到 97：初始对冲 A（98）在这根里被触发。 */
const LONG_KLINES_DIP: KlineData[] = [
  bar(0, 100, 105, 99, 104),
  bar(1, 104, 130, 100, 112),
  bar(2, 112, 115, 97, 110),
  bar(3, 110, 111, 109, 110),
];

const COIN_KLINES: KlineData[] = [
  bar(0, 50_000, 51_200, 49_500, 50_800),
  bar(1, 50_800, 51_000, 49_000, 49_500),
  bar(2, 49_500, 49_800, 47_500, 48_200),
  bar(3, 48_200, 48_500, 47_800, 48_000),
];

const MAIN_LONG: FilledLegSpec = {
  id: 'main', role: 'main_open', side: 'LONG', entry: 100, exit: 110, qty: 10, openMs: at(0), closeMs: at(180),
};

const PENDING_A_98: PendingHedgeSpec = {
  id: 'hedge-a', role: 'hedge_initial_a', direction: 'short', trigger: 98, sizeUsdt: 490, placedMs: at(0),
};
const PENDING_B_96: PendingHedgeSpec = {
  id: 'hedge-b', role: 'hedge_initial_b', direction: 'short', trigger: 96, sizeUsdt: 480, placedMs: at(0),
};

const UNFILLED_HEDGE_FIXTURE: ParityFixture = buildFixture({
  id: 'unfilled-hedge',
  title: '初始对冲未成交',
  direction: 'main_long',
  filled: [MAIN_LONG],
  pending: [{ id: 'hedge-a', role: 'hedge_initial_a', direction: 'short', trigger: 95, sizeUsdt: 475, placedMs: at(0) }],
  klines: LONG_KLINES,
});

export const PARITY_FIXTURES: ParityFixture[] = [
  // ① 纯多单：只有一笔主力，没有保护线（L = 0，派生项两边都是「—」）。
  buildFixture({
    id: 'plain-long',
    title: '纯多单',
    direction: 'main_long',
    filled: [MAIN_LONG],
    klines: LONG_KLINES,
  }),
  // ② 带镜像止盈：主力 40% + 镜像 60% 同刻开出，镜像 01:30 在 104 落袋；A/B 两张保护单挂着没成交。
  buildFixture({
    id: 'mirror-tp',
    title: '带镜像止盈',
    direction: 'main_long',
    filled: [
      { ...MAIN_LONG, qty: 4 },
      { id: 'mirror', role: 'mirror_tp', side: 'LONG', entry: 100, exit: 104, qty: 6, openMs: at(0), closeMs: at(90) },
    ],
    pending: [PENDING_A_98, PENDING_B_96],
    klines: LONG_KLINES,
  }),
  // ③ 平仓价校正：镜像记成 160 平掉（00:30 那一分钟的区间是 99–105），按收盘 104 校正，Δ = −280。
  //    校正前真实峰值把 +300 的幻影利润一路带到 01:00 的高点：300 + 30 × 10 = 600；校正后 20 + 300 = 320。
  buildFixture({
    id: 'exit-correction',
    title: '平仓价校正',
    direction: 'main_long',
    filled: [
      MAIN_LONG,
      { id: 'mirror', role: 'mirror_tp', side: 'LONG', entry: 100, exit: 160, qty: 5, openMs: at(0), closeMs: at(30) },
    ],
    pending: [PENDING_A_98],
    corrections: {
      mirror: { exitPrice: 104, originalExitPrice: 160, candleLow: 99, candleHigh: 105 },
    },
    klines: LONG_KLINES,
  }),
  // ④ 初始对冲 A 从未成交：主力 100→110 × 10，空单 95 × 5 一直挂着。
  //    01:00 这根高点 130 时只有主力 → 300；把挂单当作持有会印出 300 − 35 × 5 = 125。
  UNFILLED_HEDGE_FIXTURE,
  // ⑤ 滚动对冲成交过：01:30 在 120 开空、02:30 在 112 平掉；初始 A/B 未成交。
  buildFixture({
    id: 'rolling-hedge',
    title: '滚动对冲成交',
    direction: 'main_long',
    filled: [
      MAIN_LONG,
      { id: 'rolling', role: 'hedge_rolling', side: 'SHORT', entry: 120, exit: 112, qty: 5, openMs: at(90), closeMs: at(150) },
    ],
    pending: [PENDING_A_98, PENDING_B_96],
    klines: LONG_KLINES,
  }),
  // ⑥ 币本位空单 + 多头对冲：主力 20 张 × 100 USD 空在 50,000；A 多单 51,000 成交后 50,500 平掉；B 52,000 未成交。
  buildFixture({
    id: 'coin-short',
    title: '币本位空单配多头对冲',
    symbol: 'BTCUSDT',
    direction: 'main_short',
    filled: [
      { id: 'main', role: 'main_open', side: 'SHORT', entry: 50_000, exit: 48_000, qty: 20, contractSizeUsd: 100, leverage: 10, fees: true, openMs: at(0), closeMs: at(180) },
      { id: 'hedge-a', role: 'hedge_initial_a', side: 'LONG', entry: 51_000, exit: 50_500, qty: 10, contractSizeUsd: 100, leverage: 10, fees: true, openMs: at(30), closeMs: at(90) },
    ],
    pending: [{ id: 'hedge-b', role: 'hedge_initial_b', direction: 'long', trigger: 52_000, sizeUsdt: 1_000, placedMs: at(0), leverage: 10 }],
    klines: COIN_KLINES,
  }),
  // ⑦ 每条记录都带手续费：主力、镜像、初始对冲 A（02:10 在 98 触发、02:50 在 106 止损）；B 未成交。
  buildFixture({
    id: 'fees-everywhere',
    title: '全部记录带手续费',
    direction: 'main_long',
    filled: [
      { ...MAIN_LONG, qty: 4, leverage: 5, fees: true },
      { id: 'mirror', role: 'mirror_tp', side: 'LONG', entry: 100, exit: 104, qty: 6, leverage: 5, fees: true, openMs: at(0), closeMs: at(90) },
      { id: 'hedge-a', role: 'hedge_initial_a', side: 'SHORT', entry: 98, exit: 106, qty: 5, leverage: 5, fees: true, openMs: at(130), closeMs: at(170) },
    ],
    pending: [PENDING_B_96],
    klines: LONG_KLINES_DIP,
  }),
  // ⑧ 只剩快照的加仓：00:30 在 104 加 5 个、02:30 在 112 平，快照盈亏 39.5（已扣费，不等于毛盈亏 40）。
  buildFixture({
    id: 'snapshot-leg',
    title: '只剩复盘快照的腿',
    direction: 'main_long',
    filled: [{ ...MAIN_LONG, fees: true }],
    pending: [PENDING_A_98, PENDING_B_96],
    snapshots: [{
      id: 'add-1', role: 'main_add_1', direction: 'long', entry: 104, exit: 112, sizeUsdt: 520,
      openMs: at(30), closeMs: at(150), realizedPnl: 39.5,
    }],
    klines: LONG_KLINES,
  }),
  // ④′ 同 ④，结束时间记早了（最后一次平仓 03:00）：
  //    记早 8 小时（窗口整个在开仓之前）——战役页曾只剩最终已实现 100，真值 300；
  //    记早 20 分钟、配 5 分钟尾盘 K 线（02:50 冲到 140）——战役页曾停在 02:40、峰值 300，真值 400。
  withClosedAt(UNFILLED_HEDGE_FIXTURE, {
    id: 'unfilled-hedge-closed-8h-early',
    title: '初始对冲未成交，结束时间记早 8 小时',
    closedAtMs: at(180) - EIGHT_HOURS,
  }),
  withClosedAt(UNFILLED_HEDGE_FIXTURE, {
    id: 'unfilled-hedge-closed-20m-early',
    title: '初始对冲未成交，结束时间记早 20 分钟',
    closedAtMs: at(160),
    klines: FINE_TAIL_KLINES,
  }),
];

// ─────────────────────────────────────────────────────────────────────────────
// 模拟器实跑出来的夹具
// ─────────────────────────────────────────────────────────────────────────────

interface SimOpenSpec {
  /** 仓位 / 成交 id：主力那一笔的 id 就是仓位 id（fills[0].id === position.id）。 */
  id: string;
  side: 'LONG' | 'SHORT';
  /** 委托价（市价单按它带 Taker 滑点成交）。 */
  price: number;
  /** U 本位是币数；币本位是张数。 */
  qty: number;
  openMs: number;
  leverage?: number;
  coin?: { contractSizeUsd: number; asset: string };
}

function simOpen(symbol: string, spec: SimOpenSpec): Position {
  const { position } = executeSettlementFill(symbol, spec.price, {
    side: spec.side,
    quantity: spec.qty,
    leverage: spec.leverage ?? 5,
    marginMode: 'isolated',
    settlementMode: spec.coin ? 'coin' : 'usdt',
    ...(spec.coin
      ? { contracts: spec.qty, contractSizeUsd: spec.coin.contractSizeUsd, settlementAsset: spec.coin.asset }
      : {}),
  }, false, spec.openMs);
  // 仓位 id 由模拟器随机生成；夹具要可复现，换成固定的（此时还没有 fills，合并时按这个 id 补出主力那一笔）。
  return { ...position, id: spec.id };
}

/** 按市价平掉 pos 的 fraction（1 = 全平）；记录 id 换成可复现的 `${label}-n`。 */
function simClose(
  symbol: string,
  pos: Position,
  price: number,
  fraction: number,
  closeMs: number,
  label: string,
): { records: TradeRecord[]; rest: Position | null } {
  const settled = settlePositionClose(symbol, pos, price, getPositionUnits(pos) * fraction, closeMs, 'manual', closeMs);
  if (!settled) throw new Error(`simClose ${label}: nothing to close`);
  const records = settled.records.map((record, index) => ({ ...record, id: `${label}-${index + 1}` }));
  const rest = settled.willFullyClose ? null : scaleSettlementPosition(pos, settled.remainingUnits);
  return { records, rest };
}

interface SimLegSpec {
  id: string;
  role: LegRole;
  direction: 'long' | 'short';
  /** 实时「记录决策」写进 trade_record_id 的那个 id：主力是仓位 id，被并进来的成交是它自己的成交 id。 */
  recordRef: string | null;
  /** 委托价：pre_entry_price。 */
  plannedPrice: number;
  /** OrderPanel 的写法：Number((数量 × 委托价).toFixed(2))；币本位是 张数 × 面值。 */
  plannedSize: number;
  openMs: number;
  closeMs?: number | null;
  exitSnapshot?: number | null;
  realizedSnapshot?: number | null;
  leverage?: number;
  coin?: { contractSizeUsd: number; contracts: number };
}

function simLeg(fixtureId: string, spec: SimLegSpec, sequence: number, symbol: string): TradeJournal {
  const hedge = spec.role.startsWith('hedge_') || spec.role === 'reentry_hedge';
  return {
    ...baseLeg(fixtureId, spec.id, sequence),
    trade_record_id: spec.recordRef,
    leg_role: spec.role,
    source: 'live',
    symbol,
    direction: spec.direction,
    leverage: spec.leverage ?? 5,
    order_kind: hedge ? 'hedge' : 'main',
    pre_simulated_time: iso(spec.openMs),
    pre_entry_price: spec.plannedPrice,
    pre_position_size: spec.plannedSize,
    pre_settlement_mode: spec.coin ? 'coin' : 'usdt',
    pre_contract_size_usd: spec.coin ? spec.coin.contractSizeUsd : null,
    pre_contracts: spec.coin ? spec.coin.contracts : null,
    pre_account_equity_usdt: spec.role === 'main_open' ? 10_000 : null,
    post_simulated_close_time: spec.closeMs != null ? iso(spec.closeMs) : null,
    post_exit_price_snapshot: spec.exitSnapshot ?? null,
    post_realized_pnl: spec.realizedSnapshot ?? null,
  } as TradeJournal;
}

const plannedNotional = (qty: number, price: number) => Number((qty * price).toFixed(2));

function event(over: Partial<CampaignEvent> & Pick<CampaignEvent, 'id' | 'timestamp' | 'event_type'>): CampaignEvent {
  return {
    leg_role: null,
    journal_id: null,
    trade_record_id: null,
    pending_order_id: null,
    price: null,
    size_usdt: null,
    notes: null,
    recorded_at: over.timestamp,
    ...over,
  };
}

interface SimFixtureInput {
  id: string;
  title: string;
  symbol?: string;
  direction: TradeCampaign['direction'];
  legs: SimLegSpec[];
  records: TradeRecord[];
  klines: KlineData[];
  reverseHedgeOrders?: CampaignReverseHedgeOrder[];
  events?: CampaignEvent[];
  corrections?: LegExitPriceCorrections;
  /** 缺省按全部腿里最晚的平仓时刻收；传 null 表示战役还没结束。 */
  closedAtMs?: number | null;
  exclusions?: ParityFixture['exclusions'];
  /** 覆盖战役行上落库的已实现（换了浏览器、本地一条腿都结算不了时，页面读的就是它）。 */
  storedPnl?: number | null;
}

function buildSimFixture(input: SimFixtureInput): ParityFixture {
  const symbol = input.symbol ?? 'SIMUSDT';
  const legs = input.legs.map((spec, index) => simLeg(input.id, spec, index + 1, symbol));
  const closeTimes = [
    ...input.records.map(record => record.closeTime),
    ...input.legs.map(spec => spec.closeMs ?? 0),
  ];
  const closedAt = input.closedAtMs === undefined ? Math.max(...closeTimes) : input.closedAtMs;
  const computedTotal = input.records.reduce((sum, record) => sum + record.pnl, 0)
    + input.legs.reduce((sum, spec) => sum + (spec.recordRef == null || input.records.length === 0 ? spec.realizedSnapshot ?? 0 : 0), 0);
  const storedTotal = input.storedPnl === undefined ? computedTotal : input.storedPnl;
  const main = input.legs.find(spec => spec.role === 'main_open') ?? input.legs[0];
  const campaign = {
    id: input.id,
    user_id: 'user-1',
    campaign_code: `C-${input.id}`,
    symbol,
    direction: input.direction,
    status: closedAt == null
      ? 'active'
      : (storedTotal ?? 0) > 0 ? 'closed_profit' : (storedTotal ?? 0) < 0 ? 'closed_loss' : 'closed_breakeven',
    strategy_template: 'main_dual_hedge_mirror_tp',
    title: input.title,
    opened_at: iso(PARITY_T0),
    closed_at: closedAt == null ? null : iso(closedAt),
    initial_main_size_usdt: main.plannedSize,
    initial_leverage: main.leverage ?? 5,
    final_realized_pnl: closedAt == null ? null : storedTotal,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: input.events ?? [],
    deviation_notes: {},
    deleted_at: null,
    created_at: iso(PARITY_T0),
    updated_at: iso(closedAt ?? PARITY_T0),
  } as TradeCampaign;
  return {
    id: input.id,
    title: input.title,
    symbol,
    campaign,
    legs,
    tradeRecords: input.records,
    reverseHedgeOrders: input.reverseHedgeOrders ?? [],
    corrections: input.corrections ?? {},
    klines: input.klines,
    exclusions: input.exclusions,
  };
}

const SIM_SYMBOL = 'SIMUSDT';

/** 主力 4 + 镜像 6 同一秒市价开出、并成一个仓位；01:30 镜像止盈减仓 60%，03:00 余下全平。 */
function mergedMirrorRecords(): TradeRecord[] {
  const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 4, openMs: at(0) });
  const mirror = simOpen(SIM_SYMBOL, { id: 'fill-mirror', side: 'LONG', price: 100, qty: 6, openMs: at(0) });
  const merged = mergeFilledPosition(SIM_SYMBOL, [main], mirror).survivor;
  const tp = simClose(SIM_SYMBOL, merged, 104, 0.6, at(90), 'tp');
  const last = simClose(SIM_SYMBOL, tp.rest as Position, 110, 1, at(180), 'final');
  return [...tp.records, ...last.records];
}

/** 一笔主力 10 个：01:30 按 M 减仓 50% 在 104 平一半，03:00 余下在 110 全平。 */
function mReduceRecords(): TradeRecord[] {
  const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
  const half = simClose(SIM_SYMBOL, main, 104, 0.5, at(90), 'half');
  const last = simClose(SIM_SYMBOL, half.rest as Position, 110, 1, at(180), 'final');
  return [...half.records, ...last.records];
}

/** 一笔主力 10 个市价开在 100（成交 100.01），03:00 在 110 全平。 */
function slippedLongRecords(): TradeRecord[] {
  const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
  return simClose(SIM_SYMBOL, main, 110, 1, at(180), 'final').records;
}

const MAIN_10_LEG: SimLegSpec = {
  id: 'main', role: 'main_open', direction: 'long', recordRef: 'pos-main',
  plannedPrice: 100, plannedSize: plannedNotional(10, 100), openMs: at(0), closeMs: at(180),
};
const SIM_PENDING_A: SimLegSpec = {
  id: 'hedge-a', role: 'hedge_initial_a', direction: 'short', recordRef: null,
  plannedPrice: 98, plannedSize: plannedNotional(5, 98), openMs: at(0),
};
const SIM_PENDING_B: SimLegSpec = {
  id: 'hedge-b', role: 'hedge_initial_b', direction: 'short', recordRef: null,
  plannedPrice: 96, plannedSize: plannedNotional(5, 96), openMs: at(0),
};

/** 开仓那一批反向保护单（±5 分钟 cohort 之内），与 A/B 同价。 */
function openingReverseOrder(id: string, price: number, status: CampaignReverseHedgeOrder['status'] = 'cancelled'): CampaignReverseHedgeOrder {
  return { id, side: 'SHORT', price, createdAt: at(0), cancelledAt: status === 'cancelled' ? at(180) : null, status };
}

/** 00:00 这根下探到 97（初始对冲 A 98 在开仓后不久成交），01:00 这根冲到 130。 */
const EARLY_DIP_KLINES: KlineData[] = [
  bar(0, 100, 105, 97, 104),
  bar(1, 104, 130, 100, 112),
  bar(2, 112, 115, 97, 110),
  bar(3, 110, 111, 109, 110),
];

/**
 * 历史归类战役里的一条腿，本地查不到它的成交记录（换了浏览器），页面只能从 historical_leg_attached 事件还原：
 *   · journalId 为 null：从仓位历史记录归类（campaignEventFromTradeRecord），页面按事件合成一条
 *     id 为 record-<recordId> 的腿（synthesizeJournalFromEvent：委托价、名义、开平时刻、已实现都抄事件）；
 *   · journalId 有值：从已有日志腿归类（campaignEventFromJournal），腿是库里那条（委托价、委托名义），
 *     事件抄的是当时成交记录的成交价与名义；已实现、平仓时刻两边一致。
 */
interface HistoricalEventLegSpec {
  role: LegRole;
  direction: 'long' | 'short';
  recordId: string;
  journalId: string | null;
  /** 事件上的成交价与开仓名义（成交记录的 entryPrice、数量 × entryPrice）。 */
  fillPrice: number;
  fillNotional: number;
  /** 库里那条腿的委托价 / 委托名义（journalId 有值时才用，缺省同成交）。 */
  plannedPrice?: number;
  plannedSize?: number;
  openMs: number;
  closeMs: number;
  exitPrice: number;
  realizedPnl: number;
}

function buildHistoricalEventFixture(input: {
  id: string;
  title: string;
  direction: TradeCampaign['direction'];
  legs: HistoricalEventLegSpec[];
  klines: KlineData[];
}): ParityFixture {
  const legSpecs: SimLegSpec[] = input.legs.map(spec => ({
    id: spec.journalId ?? `record-${spec.recordId}`,
    role: spec.role,
    direction: spec.direction,
    recordRef: spec.recordId,
    plannedPrice: spec.journalId ? spec.plannedPrice ?? spec.fillPrice : spec.fillPrice,
    plannedSize: spec.journalId ? spec.plannedSize ?? spec.fillNotional : spec.fillNotional,
    openMs: spec.openMs,
    closeMs: spec.closeMs,
    exitSnapshot: spec.exitPrice,
    realizedSnapshot: spec.realizedPnl,
  }));
  const events = [
    event({ id: 'ev-hist', timestamp: iso(PARITY_T0), event_type: 'historical_classification_created' }),
    ...input.legs.map(spec => event({
      id: `ev-${spec.recordId}`,
      timestamp: iso(spec.openMs),
      event_type: 'historical_leg_attached',
      leg_role: spec.role,
      journal_id: spec.journalId,
      trade_record_id: spec.recordId,
      price: spec.fillPrice,
      size_usdt: spec.fillNotional,
      direction: spec.direction,
      open_time: iso(spec.openMs),
      close_time: iso(spec.closeMs),
      entry_price: spec.fillPrice,
      exit_price: spec.exitPrice,
      realized_pnl: spec.realizedPnl,
    })),
  ];
  const fixture = buildSimFixture({
    id: input.id,
    title: input.title,
    direction: input.direction,
    legs: legSpecs,
    records: [],
    klines: input.klines,
    events,
  });
  // 按事件合成的腿：来源是「由记录回填」，结算方式未知（synthesizeJournalFromEvent 写 null）。
  const synthesized = new Set(input.legs.filter(spec => spec.journalId == null).map(spec => `record-${spec.recordId}`));
  return {
    ...fixture,
    legs: fixture.legs.map(leg => (synthesized.has(leg.id)
      ? { ...leg, source: 'retroactive_from_record', pre_settlement_mode: null } as TradeJournal
      : leg)),
  };
}

/**
 * 把一场模拟器夹具改成「从已有日志腿归类」的历史战役（ClassifyAsNewCampaignDialog → batchAttachToCampaign）：
 * 归类那一刻，campaignEventFromJournal 给每条腿写一条 historical_leg_attached 快照——
 * 有成交记录的抄成交价、成交名义、开平时刻与盈亏；还没成交的保护单（列表里是「未触发取消」，没有成交 id）
 * 只抄委托价、委托名义与挂出时刻，既没有成交 id 也没有已实现。
 * 页面装配时（mergeHistoricalCampaignLegs）按事件合成的那一份给库里的腿补空字段：挂单的平仓时间因此补成战役结束时刻。
 */
function classifyFromJournals(fixture: ParityFixture, over: { id: string; title: string }): ParityFixture {
  const closedAt = fixture.campaign.closed_at;
  const recordFor = (ref: string | null) => {
    if (!ref) return null;
    const own = fixture.tradeRecords.filter(record => record.id === ref || record.fillId === ref || record.positionId === ref);
    return own.reduce<TradeRecord | null>((latest, record) => (!latest || record.closeTime > latest.closeTime ? record : latest), null);
  };
  const attached = fixture.legs.map(leg => {
    const record = recordFor(leg.trade_record_id);
    return event({
      id: `ev-attach-${leg.id}`,
      timestamp: leg.pre_simulated_time,
      event_type: 'historical_leg_attached',
      leg_role: leg.leg_role,
      journal_id: leg.id,
      trade_record_id: leg.trade_record_id,
      price: record?.entryPrice ?? leg.pre_entry_price,
      size_usdt: record ? Math.abs(getPositionNotionalUsd(record.symbol, record, record.entryPrice)) : leg.pre_position_size,
      direction: leg.direction,
      open_time: record ? iso(record.openTime) : leg.pre_simulated_time,
      close_time: record ? iso(record.closeTime) : leg.post_simulated_close_time,
      entry_price: record?.entryPrice ?? leg.pre_entry_price,
      exit_price: record?.exitPrice ?? leg.post_exit_price_snapshot ?? null,
      realized_pnl: record?.pnl ?? leg.post_realized_pnl,
    });
  });
  const legs = fixture.legs.map((leg, index) => ({
    ...leg,
    post_simulated_close_time: leg.post_simulated_close_time ?? attached[index].close_time ?? closedAt,
    post_exit_price_snapshot: leg.post_exit_price_snapshot ?? attached[index].exit_price ?? null,
    post_realized_pnl: leg.post_realized_pnl ?? attached[index].realized_pnl ?? null,
  }));
  return {
    ...fixture,
    ...over,
    legs,
    campaign: {
      ...fixture.campaign,
      id: over.id,
      title: over.title,
      actual_evolution: [
        event({ id: 'ev-hist', timestamp: fixture.campaign.opened_at, event_type: 'historical_classification_created' }),
        ...attached,
        ...(fixture.campaign.actual_evolution ?? []),
      ],
    },
  };
}

/** TUTUSDT 事故形状（correctedLossCampaign）按 5 分钟一根配的 K 线：00:00–01:00 在 0.083–0.095 之间。 */
const TUT_KLINES: KlineData[] = [
  [0.085, 0.0862, 0.0842, 0.0858],
  [0.0858, 0.0871, 0.0851, 0.0866],
  [0.0866, 0.0912, 0.0861, 0.0905],
  [0.0905, 0.0918, 0.0889, 0.0893],
  [0.0893, 0.0899, 0.0874, 0.0881],
  [0.0881, 0.0889, 0.0869, 0.0886],
  [0.0886, 0.0912, 0.0883, 0.0905],
  [0.0905, 0.0921, 0.0898, 0.0912],
  [0.0912, 0.0931, 0.0905, 0.0925],
  [0.0925, 0.0946, 0.0918, 0.0938],
  [0.0938, 0.0949, 0.0921, 0.0929],
  [0.0929, 0.0935, 0.0908, 0.0916],
  [0.0916, 0.0922, 0.0911, 0.0916],
].map(([open, high, low, close], index) => ({
  time: PARITY_T0 + index * 5 * PARITY_MINUTE,
  open,
  high,
  low,
  close,
  volume: 1,
}));

/** ⑳ TUTUSDT 事故形状：初始对冲计划价 0.0765（入场下方 10%），成交价却在 0.088 / 0.087；镜像平仓价被 K 线校正。 */
function tutFixture(): ParityFixture {
  return {
    id: 'tut-corrected-loss',
    title: 'TUT 校正后亏损（初始对冲计划价 ≠ 成交价）',
    symbol: 'TUTUSDT',
    campaign: correctedLossStoredCampaign(),
    legs: correctedLossLegs(),
    tradeRecords: correctedLossTradeRecords(),
    reverseHedgeOrders: [],
    corrections: correctedLossCorrections(),
    klines: TUT_KLINES,
  };
}

function buildSimulatorFixtures(): ParityFixture[] {
  const merged = mergedMirrorRecords();
  const reduce = mReduceRecords();
  const slipped = slippedLongRecords();

  // ⑫ 初始对冲 A 计划 98、市价触发成交 97.99；02:50 在 101 止损。
  const slippedHedge = (() => {
    const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
    const hedge = simOpen(SIM_SYMBOL, { id: 'pos-hedge-a', side: 'SHORT', price: 98, qty: 5, openMs: at(130) });
    return [
      ...simClose(SIM_SYMBOL, hedge, 101, 1, at(170), 'hedge').records,
      ...simClose(SIM_SYMBOL, main, 110, 1, at(180), 'final').records,
    ];
  })();

  // ⑭ 历史归类：A/B 腿是从成交回填的（计划价 = 成交价），开仓那一批委托快照在 98 / 96。
  const historical = (() => {
    const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
    const a = simOpen(SIM_SYMBOL, { id: 'pos-hedge-a', side: 'SHORT', price: 98, qty: 5, openMs: at(130) });
    const b = simOpen(SIM_SYMBOL, { id: 'pos-hedge-b', side: 'SHORT', price: 96, qty: 5, openMs: at(135) });
    return {
      main: simClose(SIM_SYMBOL, main, 110, 1, at(180), 'main').records,
      a: simClose(SIM_SYMBOL, a, 101, 1, at(170), 'a').records,
      b: simClose(SIM_SYMBOL, b, 100, 1, at(172), 'b').records,
    };
  })();

  // ⑯ 回场：主力 → 对冲 A 触发并平掉 → 回场主力 + 回场对冲（一张成交、一张挂着没成交）。
  const reentry = (() => {
    const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
    const mainClose = simClose(SIM_SYMBOL, main, 99, 1, at(40), 'main').records;
    const hedge = simOpen(SIM_SYMBOL, { id: 'pos-hedge-a', side: 'SHORT', price: 98, qty: 5, openMs: at(35) });
    const hedgeClose = simClose(SIM_SYMBOL, hedge, 101, 1, at(70), 'hedge').records;
    const re = simOpen(SIM_SYMBOL, { id: 'pos-reentry', side: 'LONG', price: 101, qty: 10, openMs: at(75) });
    const reHedge = simOpen(SIM_SYMBOL, { id: 'pos-reentry-hedge', side: 'SHORT', price: 118, qty: 5, openMs: at(100) });
    return [
      ...mainClose,
      ...hedgeClose,
      ...simClose(SIM_SYMBOL, reHedge, 112, 1, at(150), 'rehedge').records,
      ...simClose(SIM_SYMBOL, re, 110, 1, at(180), 'reentry').records,
    ];
  })();

  // ⑰ 币本位空单主力 + 镜像并仓（BTC 面值 100）：镜像止盈减仓 60%，02:00 触发的多头对冲在 50,500 平掉。
  const coinMerged = (() => {
    const coin = { contractSizeUsd: 100, asset: 'BTC' };
    const main = simOpen('BTCUSDT', { id: 'pos-main', side: 'SHORT', price: 50_000, qty: 8, openMs: at(0), leverage: 10, coin });
    const mirror = simOpen('BTCUSDT', { id: 'fill-mirror', side: 'SHORT', price: 50_000, qty: 12, openMs: at(0), leverage: 10, coin });
    const mergedPos = mergeFilledPosition('BTCUSDT', [main], mirror).survivor;
    const tp = simClose('BTCUSDT', mergedPos, 49_000, 0.6, at(90), 'tp');
    const hedge = simOpen('BTCUSDT', { id: 'pos-hedge-a', side: 'LONG', price: 51_000, qty: 10, openMs: at(30), leverage: 10, coin });
    return [
      ...simClose('BTCUSDT', hedge, 50_500, 1, at(60), 'hedge').records,
      ...tp.records,
      ...simClose('BTCUSDT', tp.rest as Position, 48_000, 1, at(180), 'final').records,
    ];
  })();

  // ⑳ 两笔主力先后开：主力 1 00:00–01:00；主力 2 是 01:15 挂的限价单、01:30 才成交，03:20 平掉；各有一对挂着的 A/B。
  const twoMains = (() => {
    const first = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
    const second = simOpen(SIM_SYMBOL, { id: 'pos-main2', side: 'LONG', price: 110, qty: 20, openMs: at(90) });
    return [
      ...simClose(SIM_SYMBOL, first, 104, 1, at(60), 'main').records,
      ...simClose(SIM_SYMBOL, second, 112, 1, at(200), 'main2').records,
    ];
  })();

  // ㉑ 主力 10 个（00:00–03:20）+ 00:20–00:50 的一笔 2 个试单主力（没有保护）；A 02:05 成交、02:50 平掉，B 挂着。
  const probeMain = (() => {
    const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
    const probe = simOpen(SIM_SYMBOL, { id: 'pos-probe', side: 'LONG', price: 103, qty: 2, openMs: at(20) });
    const hedge = simOpen(SIM_SYMBOL, { id: 'pos-hedge-a', side: 'SHORT', price: 98, qty: 5, openMs: at(125) });
    return [
      ...simClose(SIM_SYMBOL, probe, 104, 1, at(50), 'probe').records,
      ...simClose(SIM_SYMBOL, hedge, 101, 1, at(170), 'hedge').records,
      ...simClose(SIM_SYMBOL, main, 110, 1, at(200), 'main').records,
    ];
  })();

  // ㉒ 00:30 加仓 5 个（104）并进主力仓位，但没记决策、没有腿；03:00 整仓在 110 平掉。
  const mergedAddNoLeg = (() => {
    const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
    const add = simOpen(SIM_SYMBOL, { id: 'fill-add', side: 'LONG', price: 104, qty: 5, openMs: at(30) });
    const merged = mergeFilledPosition(SIM_SYMBOL, [main], add).survivor;
    return simClose(SIM_SYMBOL, merged, 110, 1, at(180), 'final').records;
  })();

  // ㉘ 进行中：主力 10 个 00:50 在 104 平掉（之后再没有成交记录）。
  const activeEarlyMain = (() => {
    const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
    return simClose(SIM_SYMBOL, main, 104, 1, at(50), 'main').records;
  })();

  // ㉜ 历史归类时抄进事件的成交价：主力委托 100、对冲 A 委托 98，市价成交带滑点。
  const slippedMainFill = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
  const slippedHedgeFill = simOpen(SIM_SYMBOL, { id: 'pos-hedge-a', side: 'SHORT', price: 98, qty: 5, openMs: at(30) });

  // ㊳ M 减仓 50%：00:30 在 104 平一半（01:00 那根冲高之前），03:00 余下在 110 全平。
  const earlyHalf = (() => {
    const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
    const half = simClose(SIM_SYMBOL, main, 104, 0.5, at(30), 'half');
    const last = simClose(SIM_SYMBOL, half.rest as Position, 110, 1, at(180), 'final');
    return { records: [...half.records, ...last.records], last: last.records[0] };
  })();

  // ㉓ 初始对冲 A 00:00 挂在 98、02:10 才成交（02:50 平掉）；另一张 A 00:50 挂在 95 一直没成交。
  const earlyPlacedHedge = (() => {
    const main = simOpen(SIM_SYMBOL, { id: 'pos-main', side: 'LONG', price: 100, qty: 10, openMs: at(0) });
    const hedge = simOpen(SIM_SYMBOL, { id: 'pos-hedge-a', side: 'SHORT', price: 98, qty: 5, openMs: at(130) });
    return [
      ...simClose(SIM_SYMBOL, hedge, 101, 1, at(170), 'hedge').records,
      ...simClose(SIM_SYMBOL, main, 110, 1, at(180), 'final').records,
    ];
  })();

  return [
    // ⑨ 主力与镜像并成一个仓位，镜像止盈 = 整仓按比例减 60%：两条腿各有两刀（01:30 在 104、03:00 在 110）。
    buildSimFixture({
      id: 'sim-merged-mirror',
      title: '模拟器：主力 + 镜像并仓，镜像止盈减仓 60%',
      direction: 'main_long',
      legs: [
        { ...MAIN_10_LEG, plannedSize: plannedNotional(4, 100) },
        { id: 'mirror', role: 'mirror_tp', direction: 'long', recordRef: 'fill-mirror', plannedPrice: 100, plannedSize: plannedNotional(6, 100), openMs: at(0), closeMs: at(180) },
        SIM_PENDING_A,
        SIM_PENDING_B,
      ],
      records: merged,
      klines: LONG_KLINES,
    }),
    // ⑩ M 减仓 50%：同一条主力腿两刀（01:30 在 104 一半，03:00 在 110 另一半）。
    buildSimFixture({
      id: 'sim-m-reduce',
      title: '模拟器：M 减仓 50%',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: reduce,
      klines: LONG_KLINES,
    }),
    // ⑪ 市价单滑点：委托 100、成交 100.01，pre_position_size 按委托价写成 1000.00。
    buildSimFixture({
      id: 'sim-slippage',
      title: '模拟器：市价单滑点',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: slipped,
      klines: LONG_KLINES,
    }),
    // ⑫ 对冲 A 计划 98、成交 97.99：风险锚按计划价（委托快照），不按滑点后的成交价。
    buildSimFixture({
      id: 'sim-slipped-hedge',
      title: '模拟器：对冲按计划价锚定',
      direction: 'main_long',
      legs: [
        MAIN_10_LEG,
        { ...SIM_PENDING_A, recordRef: 'pos-hedge-a', openMs: at(0), closeMs: at(170) },
        SIM_PENDING_B,
      ],
      records: slippedHedge,
      klines: LONG_KLINES_DIP,
    }),
    // ⑬ 对冲 B 只存在于反向委托（96）里，没有日志腿；A 是挂着的日志腿（98）。
    buildSimFixture({
      id: 'sim-reverse-order-only',
      title: '模拟器：对冲 B 只在委托里',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A],
      records: slipped,
      klines: LONG_KLINES,
      reverseHedgeOrders: [openingReverseOrder('ord-a', 98), openingReverseOrder('ord-b', 96)],
    }),
    // ⑭ 历史归类战役：A/B 腿按成交回填（97.99 / 95.99），委托快照 98 / 96 才是 ex-ante 边界。
    buildSimFixture({
      id: 'sim-historical-reverse',
      title: '模拟器：历史归类，委托快照定边界',
      direction: 'main_long',
      legs: [
        { ...MAIN_10_LEG, recordRef: 'main-1', plannedPrice: historical.main[0].entryPrice, plannedSize: historical.main[0].quantity * historical.main[0].entryPrice },
        { id: 'hedge-a', role: 'hedge_initial_a', direction: 'short', recordRef: 'a-1', plannedPrice: historical.a[0].entryPrice, plannedSize: historical.a[0].quantity * historical.a[0].entryPrice, openMs: at(130), closeMs: at(170) },
        { id: 'hedge-b', role: 'hedge_initial_b', direction: 'short', recordRef: 'b-1', plannedPrice: historical.b[0].entryPrice, plannedSize: historical.b[0].quantity * historical.b[0].entryPrice, openMs: at(135), closeMs: at(172) },
      ],
      records: [...historical.main, ...historical.a, ...historical.b],
      klines: LONG_KLINES_DIP,
      reverseHedgeOrders: [
        { ...openingReverseOrder('ord-a', 98, 'triggered'), fillPrice: historical.a[0].entryPrice, triggeredAt: at(130), tradeRecordId: 'a-1' },
        { ...openingReverseOrder('ord-b', 96, 'triggered'), fillPrice: historical.b[0].entryPrice, triggeredAt: at(135), tradeRecordId: 'b-1' },
      ],
      events: [event({ id: 'ev-hist', timestamp: iso(at(0)), event_type: 'historical_classification_created' })],
    }),
    // ⑮ 换了浏览器、本地没有成交记录：两条腿都挂着成交 id，只剩复盘快照；对冲没有 hedge_triggered 事件。
    //    战役页的权益路径不持有这张对冲（不知道它什么时候成交），已实现照计它的快照。
    buildSimFixture({
      id: 'sim-no-local-records',
      title: '模拟器：本地没有成交记录',
      direction: 'main_long',
      legs: [
        { ...MAIN_10_LEG, exitSnapshot: 110, realizedSnapshot: 99.4 },
        { ...SIM_PENDING_A, recordRef: 'pos-hedge-a', closeMs: at(170), exitSnapshot: 101, realizedSnapshot: -15.3 },
        SIM_PENDING_B,
      ],
      records: [],
      klines: LONG_KLINES_DIP,
    }),
    // ⑯ 快照对冲：00:00 挂出、02:10 触发（事件流里有 hedge_triggered），02:50 平掉，只剩快照。
    buildSimFixture({
      id: 'sim-snapshot-hedge-triggered',
      title: '模拟器：快照对冲按触发时刻持有',
      direction: 'main_long',
      legs: [
        MAIN_10_LEG,
        { ...SIM_PENDING_A, recordRef: null, closeMs: at(170), exitSnapshot: 101, realizedSnapshot: -15.3 },
        SIM_PENDING_B,
      ],
      records: slipped,
      klines: LONG_KLINES_DIP,
      events: [event({
        id: 'ev-trigger-a', timestamp: iso(at(130)), event_type: 'hedge_triggered',
        leg_role: 'hedge_initial_a', journal_id: 'hedge-a', price: 98, size_usdt: 490,
      })],
    }),
    // ⑰ 回场：回场对冲一张成交、一张挂着（没有成交 id、没有快照）。
    buildSimFixture({
      id: 'sim-reentry-pending',
      title: '模拟器：回场对冲一张未成交',
      direction: 'main_long',
      legs: [
        { ...MAIN_10_LEG, closeMs: at(40) },
        { ...SIM_PENDING_A, recordRef: 'pos-hedge-a', openMs: at(35), closeMs: at(70) },
        { id: 'reentry', role: 'reentry_main', direction: 'long', recordRef: 'pos-reentry', plannedPrice: 101, plannedSize: plannedNotional(10, 101), openMs: at(75), closeMs: at(180) },
        { id: 'rehedge-1', role: 'reentry_hedge', direction: 'short', recordRef: 'pos-reentry-hedge', plannedPrice: 118, plannedSize: plannedNotional(5, 118), openMs: at(100), closeMs: at(150) },
        { id: 'rehedge-2', role: 'reentry_hedge', direction: 'short', recordRef: null, plannedPrice: 125, plannedSize: plannedNotional(5, 125), openMs: at(100) },
      ],
      records: reentry,
      klines: LONG_KLINES,
    }),
    // ⑱ 币本位空单：主力 8 张 + 镜像 12 张并仓，镜像止盈减仓 60%；多头对冲 A 00:30 触发、01:00 平掉；B 挂着。
    buildSimFixture({
      id: 'sim-coin-merged',
      title: '模拟器：币本位并仓空单',
      symbol: 'BTCUSDT',
      direction: 'main_short',
      legs: [
        { id: 'main', role: 'main_open', direction: 'short', recordRef: 'pos-main', plannedPrice: 50_000, plannedSize: 800, openMs: at(0), closeMs: at(180), leverage: 10, coin: { contractSizeUsd: 100, contracts: 8 } },
        { id: 'mirror', role: 'mirror_tp', direction: 'short', recordRef: 'fill-mirror', plannedPrice: 50_000, plannedSize: 1_200, openMs: at(0), closeMs: at(180), leverage: 10, coin: { contractSizeUsd: 100, contracts: 12 } },
        { id: 'hedge-a', role: 'hedge_initial_a', direction: 'long', recordRef: 'pos-hedge-a', plannedPrice: 51_000, plannedSize: 1_000, openMs: at(0), closeMs: at(60), leverage: 10, coin: { contractSizeUsd: 100, contracts: 10 } },
        { id: 'hedge-b', role: 'hedge_initial_b', direction: 'long', recordRef: null, plannedPrice: 52_000, plannedSize: 1_000, openMs: at(0), leverage: 10, coin: { contractSizeUsd: 100, contracts: 10 } },
      ],
      records: coinMerged,
      klines: COIN_KLINES,
    }),
    // ⑳ 两笔主力先后开（第二笔是限价单，挂出 ≠ 成交）：各自的 A/B 按「挂出那一刻开着 / 紧随其后开出」的主力归属。
    buildSimFixture({
      id: 'sim-two-mains-sequential',
      title: '模拟器：两笔主力先后开，第二笔限价成交',
      direction: 'main_long',
      legs: [
        { ...MAIN_10_LEG, closeMs: at(60) },
        SIM_PENDING_A,
        SIM_PENDING_B,
        { id: 'main2', role: 'main_open', direction: 'long', recordRef: 'pos-main2', plannedPrice: 110, plannedSize: plannedNotional(20, 110), openMs: at(75), closeMs: at(200) },
        { id: 'hedge-a2', role: 'hedge_initial_a', direction: 'short', recordRef: null, plannedPrice: 107, plannedSize: plannedNotional(10, 107), openMs: at(75) },
        { id: 'hedge-b2', role: 'hedge_initial_b', direction: 'short', recordRef: null, plannedPrice: 104, plannedSize: plannedNotional(10, 104), openMs: at(75) },
      ],
      records: twoMains,
      klines: LONG_KLINES,
    }),
    // ㉑ 一笔没有保护的小试单主力：A 在 02:05 成交时试单早已平掉，A 仍归大主力。
    buildSimFixture({
      id: 'sim-probe-main',
      title: '模拟器：大主力 + 已平的试单主力',
      direction: 'main_long',
      legs: [
        { ...MAIN_10_LEG, closeMs: at(200) },
        { ...SIM_PENDING_A, recordRef: 'pos-hedge-a', closeMs: at(170) },
        SIM_PENDING_B,
        { id: 'probe', role: 'main_open', direction: 'long', recordRef: 'pos-probe', plannedPrice: 103, plannedSize: plannedNotional(2, 103), openMs: at(20), closeMs: at(50) },
      ],
      records: probeMain,
      klines: LONG_KLINES_DIP,
    }),
    // ㉒ 并进主力仓位、却没有腿的加仓：已实现与峰值算它（主力按仓位 id 认领了它那一刀），主力开仓名义仓位不算。
    buildSimFixture({
      id: 'sim-merged-add-no-leg',
      title: '模拟器：没有腿的加仓并进主力',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: mergedAddNoLeg,
      klines: LONG_KLINES,
    }),
    // ㉓ 同一角色两张初始对冲：战役页按挂出时刻取第一张（98），不按成交时刻。
    buildSimFixture({
      id: 'sim-hedge-placed-early',
      title: '模拟器：先挂后成交的初始对冲',
      direction: 'main_long',
      legs: [
        MAIN_10_LEG,
        { ...SIM_PENDING_A, recordRef: 'pos-hedge-a', closeMs: at(170) },
        { id: 'hedge-a2', role: 'hedge_initial_a', direction: 'short', recordRef: null, plannedPrice: 95, plannedSize: plannedNotional(5, 95), openMs: at(50) },
        SIM_PENDING_B,
      ],
      records: earlyPlacedHedge,
      klines: LONG_KLINES_DIP,
    }),
    // ㉔ 换了浏览器、云端水化没跑完：主力挂着成交 id 但本地没有记录，也没有复盘快照——页面读落库的 99.4。
    buildSimFixture({
      id: 'sim-no-settlement-stored',
      title: '模拟器：一条腿都结算不了，读落库值',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: [],
      klines: LONG_KLINES,
      storedPnl: 99.4,
    }),
    // ㉕ 同上，但 99.4 来自事件流（main_fully_closed 带着已实现），落库值是空的（机会质量因此不算）。
    buildSimFixture({
      id: 'sim-no-settlement-events',
      title: '模拟器：一条腿都结算不了，读事件流',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: [],
      klines: LONG_KLINES,
      storedPnl: null,
      events: [event({
        id: 'ev-main-closed', timestamp: iso(at(180)), event_type: 'main_fully_closed',
        leg_role: 'main_open', journal_id: 'main', price: 110, size_usdt: 1000, realized_pnl: 99.4,
      })],
    }),
    // ㉖ 同上，连落库值与事件都没有：已实现记 0，战役页不算「已了结」，机会质量是「—」。
    buildSimFixture({
      id: 'sim-no-settlement-null',
      title: '模拟器：一条腿都结算不了，也没有落库值',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: [],
      klines: LONG_KLINES,
      storedPnl: null,
    }),
    // ㉗ 进行中的战役，腿都平了（A/B 还挂着）：战役页不算「已了结」，机会质量是「—」。
    buildSimFixture({
      id: 'sim-active-all-closed',
      title: '模拟器：进行中、主力已平',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: slipped,
      klines: LONG_KLINES,
      closedAtMs: null,
    }),
    // ⑲ 进行中的战役，主力还没平：战役页的权益路径只扫到「最晚一条结算记录」为止（没有就是开仓那一刻），
    //    副本持有这笔主力到最后一根 K 线。峰值浮盈因此按构造对不上。
    buildSimFixture({
      id: 'sim-active-open-main',
      title: '模拟器：进行中、主力未平',
      direction: 'main_long',
      legs: [{ ...MAIN_10_LEG, recordRef: null, closeMs: null }, SIM_PENDING_A, SIM_PENDING_B],
      records: [],
      klines: LONG_KLINES,
      closedAtMs: null,
      exclusions: {
        peakUnrealizedPnl: '进行中的战役：真实面板的权益路径只扫到最晚一条结算记录（一条都没有时就是开仓那一刻），'
          + '副本把未平的主力持有到最后一根 K 线；这是真实面板对进行中战役的已知局限，不是副本的口径差。',
      },
    }),
    // ㉘ 进行中的战役，主力 00:50 已平；只剩快照的加仓 01:00–02:40 在最晚一条成交记录之后才平。
    //    战役页的权益路径扫到 00:50 就停，01:00 那根 130 的高点看不到；副本照常持有这笔加仓。
    buildSimFixture({
      id: 'sim-active-snapshot-after-records',
      title: '模拟器：进行中、快照腿在最后一条成交之后才平',
      direction: 'main_long',
      legs: [
        { ...MAIN_10_LEG, closeMs: at(50) },
        SIM_PENDING_A,
        {
          id: 'add-1', role: 'main_add_1', direction: 'long', recordRef: null, plannedPrice: 104,
          plannedSize: plannedNotional(5, 104), openMs: at(60), closeMs: at(160), exitSnapshot: 112, realizedSnapshot: 39.72,
        },
      ],
      records: activeEarlyMain,
      klines: LONG_KLINES,
      closedAtMs: null,
      exclusions: {
        peakUnrealizedPnl: '进行中的战役：真实面板的权益路径只扫到最晚一条结算记录（这里是 00:50），'
          + '之后才平的只剩快照的腿不在其中；副本照常持有它到它的平仓时刻。这是真实面板对进行中战役的已知局限。',
      },
    }),
    // ㉙ 老数据：对冲 A 没有成交记录，事件流里 00:10 触发、00:20 撤单（没有平仓时间）。
    //    战役页的权益路径按撤单时刻放下它，副本也按撤单时刻平。
    buildSimFixture({
      id: 'sim-hedge-cancelled-after-trigger',
      title: '模拟器：对冲触发后又撤单（老事件）',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: slipped,
      klines: LONG_KLINES,
      events: [
        event({
          id: 'ev-trigger-a', timestamp: iso(at(10)), event_type: 'hedge_triggered',
          leg_role: 'hedge_initial_a', journal_id: 'hedge-a', price: 98, size_usdt: 490,
        }),
        event({
          id: 'ev-cancel-a', timestamp: iso(at(20)), event_type: 'hedge_cancelled',
          leg_role: 'hedge_initial_a', journal_id: 'hedge-a', price: 98, size_usdt: 490,
        }),
      ],
    }),
    // ㉚ 历史归类（从仓位历史记录归类）、本地没有成交记录：对冲 A 只能从 historical_leg_attached 事件还原
    //    （页面合成的腿 id 是 record-rec-a）。战役页的权益路径持有它，副本也必须持有：01:00 那根 130 的高点
    //    主力 +300、空头对冲 −160，峰值 140，而不是把对冲当成「成交时刻未知」丢掉的 300。
    buildHistoricalEventFixture({
      id: 'sim-hist-event-hedge',
      title: '模拟器：历史归类，对冲只在事件里',
      direction: 'main_long',
      legs: [
        {
          role: 'main_open', direction: 'long', recordId: 'rec-main', journalId: 'main', fillPrice: 100, fillNotional: 1000,
          openMs: at(0), closeMs: at(180), exitPrice: 110, realizedPnl: 99.45,
        },
        {
          role: 'hedge_initial_a', direction: 'short', recordId: 'rec-a', journalId: null, fillPrice: 98, fillNotional: 490,
          openMs: at(30), closeMs: at(180), exitPrice: 110, realizedPnl: -60.28,
        },
      ],
      klines: EARLY_DIP_KLINES,
    }),
    // ㉛ 同上，主力也是按事件合成的腿（record-rec-main）：它既作为主力快照上了路径，
    //    同一笔的 historical_leg_attached 事件不能再放一遍——否则 01:00 那根的峰值是 600 而不是 300。
    buildHistoricalEventFixture({
      id: 'sim-hist-event-only',
      title: '模拟器：历史归类，每条腿都只在事件里',
      direction: 'main_long',
      legs: [
        {
          role: 'main_open', direction: 'long', recordId: 'rec-main', journalId: null, fillPrice: 100, fillNotional: 1000,
          openMs: at(0), closeMs: at(180), exitPrice: 110, realizedPnl: 99.45,
        },
        {
          role: 'hedge_initial_a', direction: 'short', recordId: 'rec-a', journalId: null, fillPrice: 98, fillNotional: 490,
          openMs: at(130), closeMs: at(170), exitPrice: 101, realizedPnl: -15.25,
        },
      ],
      klines: LONG_KLINES_DIP,
    }),
    // ㉜ 历史归类（从已有日志腿归类）、本地没有成交记录：库里的对冲腿写着委托价 98 × 490，
    //    事件抄的是当时的成交价（市价滑点后）与成交名义。战役页的权益路径按事件持有，副本也按事件的成交价与数量。
    buildHistoricalEventFixture({
      id: 'sim-hist-event-fill-price',
      title: '模拟器：历史归类，对冲按事件里的成交价持有',
      direction: 'main_long',
      legs: [
        {
          role: 'main_open', direction: 'long', recordId: 'pos-main', journalId: 'main',
          fillPrice: slippedMainFill.entryPrice, fillNotional: slippedMainFill.entryPrice * 10,
          plannedPrice: 100, plannedSize: plannedNotional(10, 100),
          openMs: at(0), closeMs: at(180), exitPrice: 110, realizedPnl: 99.35,
        },
        {
          role: 'hedge_initial_a', direction: 'short', recordId: 'pos-hedge-a', journalId: 'hedge-a',
          fillPrice: slippedHedgeFill.entryPrice, fillNotional: slippedHedgeFill.entryPrice * 5,
          plannedPrice: 98, plannedSize: plannedNotional(5, 98),
          openMs: at(30), closeMs: at(180), exitPrice: 110, realizedPnl: -60.33,
        },
      ],
      klines: EARLY_DIP_KLINES,
    }),
    // ㉝ 从日志腿归类、A/B 归类时还挂着没成交（事件里没有成交 id、没有已实现，只有委托价与挂出时刻）：
    //    与实时战役 sim-slippage 同一场，战役页不能把这两张挂单从 00:00 持有到结束（01:00 那根 130 的高点上
    //    会各亏 32 × 5、34 × 5），峰值仍是 299.90；副本给它们标「挂单中」。
    classifyFromJournals(buildSimFixture({
      id: 'sim-journal-classified-pending',
      title: '模拟器：从日志归类，A/B 归类时未成交',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: slipped,
      klines: LONG_KLINES,
    }), { id: 'sim-journal-classified-pending', title: '模拟器：从日志归类，A/B 归类时未成交' }),
    // ㉞ 从日志腿归类时对冲 A 还没平（事件里没有平仓时间、没有已实现），后来腿上补了 00:50 平仓、−5.25；
    //    本地没有成交记录。已实现取腿上的 −5.25，战役页的权益路径也必须在 00:50 放下它、之后计 −5.25，
    //    而不是按事件把它持有到 03:00：01:00 那根 130 的高点上峰值 300 − 5.25 = 294.75（不是 140）。
    staleHedgeEventFixture(),
    // ㉟ 同 ⑪，结束时间记早 8 小时（旧版结束对话框在东八区把 closed_at 记得比模拟时钟早 8 小时，窗口整个在开仓之前）：
    //    战役页曾只剩最终已实现 99.24，真值 299.90。
    withClosedAt(buildSimFixture({
      id: 'sim-slippage',
      title: '模拟器：市价单滑点',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: slipped,
      klines: LONG_KLINES,
    }), { id: 'sim-slippage-closed-8h-early', title: '模拟器：市价单滑点，结束时间记早 8 小时', closedAtMs: at(180) - EIGHT_HOURS }),
    // ㊱ 同 ⑪，结束时间记早 20 分钟（02:40），尾盘 5 分钟一根、02:50 冲到 140：战役页曾停在 02:40、峰值 299.90，真值 399.90。
    withClosedAt(buildSimFixture({
      id: 'sim-slippage',
      title: '模拟器：市价单滑点',
      direction: 'main_long',
      legs: [MAIN_10_LEG, SIM_PENDING_A, SIM_PENDING_B],
      records: slipped,
      klines: FINE_TAIL_KLINES,
    }), { id: 'sim-slippage-closed-20m-early', title: '模拟器：市价单滑点，结束时间记早 20 分钟', closedAtMs: at(160) }),
    // ㊲ 同 ㉝，但 A/B 是通过「记录决策」挂出的：腿与归类事件上的「成交 id」其实是委托 id（ord-hedge-a / ord-hedge-b），
    //    本地委托记录里这两张已撤单。战役页不持有它们（峰值 299.90，不是从挂出时刻持有到结束的 99.24），副本标「挂单中」。
    {
      ...classifyFromJournals(buildSimFixture({
        id: 'sim-journal-classified-order-id',
        title: '模拟器：从日志归类，A/B 挂着委托 id、从未成交',
        direction: 'main_long',
        legs: [MAIN_10_LEG, { ...SIM_PENDING_A, recordRef: 'ord-hedge-a' }, { ...SIM_PENDING_B, recordRef: 'ord-hedge-b' }],
        records: slipped,
        klines: LONG_KLINES,
      }), { id: 'sim-journal-classified-order-id', title: '模拟器：从日志归类，A/B 挂着委托 id、从未成交' }),
      unfilledOrderIds: ['ord-hedge-a', 'ord-hedge-b'],
    },
    // ㊳ 实时主力 M 减仓 50%（00:30、03:00 两刀），之后又把 03:00 那一刀作为回填的加仓腿归进同一场：
    //    Legs 表里主力按仓位 id 查到的是 03:00 那一刀（归加仓腿认领），主力自己只认领到 00:30 那一刀。
    //    战役页的路径让主力在 00:30 放下，副本若照抄查到的那一刀的平仓时间，会把主力的一半持有到 03:00。
    claimedByAddLegFixture(earlyHalf),
  ];
}

function claimedByAddLegFixture(input: { records: TradeRecord[]; last: TradeRecord }): ParityFixture {
  const { last } = input;
  const fixture = buildSimFixture({
    id: 'sim-close-claimed-by-add-leg',
    title: '模拟器：主力最后一刀被回填的加仓腿认领',
    direction: 'main_long',
    legs: [
      MAIN_10_LEG,
      SIM_PENDING_A,
      SIM_PENDING_B,
      {
        id: 'add-1', role: 'main_add_1', direction: 'long', recordRef: last.id,
        plannedPrice: last.entryPrice, plannedSize: getPositionNotionalUsd(last.symbol, last, last.entryPrice),
        openMs: last.openTime, closeMs: last.closeTime, exitSnapshot: last.exitPrice, realizedSnapshot: last.pnl,
      },
    ],
    records: input.records,
    klines: LONG_KLINES,
  });
  return {
    ...fixture,
    legs: fixture.legs.map(leg => (leg.id === 'add-1' ? { ...leg, source: 'retroactive_from_record' } as TradeJournal : leg)),
  };
}

/** ㉞ 的形状（见上）：事件是归类那一刻的快照，腿后来补上了平仓时刻与已实现。 */
function staleHedgeEventFixture(): ParityFixture {
  const fixture = buildHistoricalEventFixture({
    id: 'sim-hist-stale-event',
    title: '模拟器：历史归类时对冲未平，腿后来补了平仓',
    direction: 'main_long',
    legs: [
      {
        role: 'main_open', direction: 'long', recordId: 'pos-main', journalId: 'main', fillPrice: 100, fillNotional: 1000,
        openMs: at(0), closeMs: at(180), exitPrice: 110, realizedPnl: 99.45,
      },
      {
        role: 'hedge_initial_a', direction: 'short', recordId: 'pos-hedge-a', journalId: 'hedge-a', fillPrice: 98, fillNotional: 490,
        openMs: at(0), closeMs: at(50), exitPrice: 99, realizedPnl: -5.25,
      },
    ],
    klines: EARLY_DIP_KLINES,
  });
  return {
    ...fixture,
    campaign: {
      ...fixture.campaign,
      actual_evolution: fixture.campaign.actual_evolution.map(item => (item.journal_id === 'hedge-a'
        ? { ...item, close_time: null, exit_price: null, realized_pnl: null }
        : item)),
    },
  };
}

export const SIMULATOR_PARITY_FIXTURES: ParityFixture[] = [...buildSimulatorFixtures(), tutFixture()];

export function parityFixture(id: string): ParityFixture {
  const fixture = [...PARITY_FIXTURES, ...SIMULATOR_PARITY_FIXTURES].find(item => item.id === id);
  if (!fixture) throw new Error(`unknown parity fixture ${id}`);
  return fixture;
}

// ─────────────────────────────────────────────────────────────────────────────
// 随机形状（黄金测试的随机一维）：同样用模拟器下单 / 合并 / 分刀平仓，形状按种子可复现。
// ─────────────────────────────────────────────────────────────────────────────

/** 可复现的伪随机数（mulberry32）。 */
function seededRandom(seed: number): () => number {
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
 * 按种子生成一场战役：一或两笔主力（第二笔可以是先挂后成交的限价单，与第一笔的持仓窗口或先后、或重叠），
 * 并进主力仓位的镜像（可能按比例止盈减仓）、并进来却没有腿的加仓、M 减仓，
 * 每笔主力的初始对冲 A/B（挂着、先挂后成交、缺失，偶尔挂在利润侧），同角色的第二张挂单，
 * 开仓那一批反向委托，平仓价校正，本地没有成交记录（只剩部分快照、读落库值或事件流），进行中的战役。
 * 进行中的战役里每条腿都已平（未平的腿是真实面板已知的局限，另有固定夹具）。
 */
export function randomParityFixture(seed: number): ParityFixture {
  const rnd = seededRandom(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(rnd() * items.length)];
  const chance = (p: number) => rnd() < p;
  const round2 = (value: number) => Math.round(value * 100) / 100;
  const long = chance(0.7);
  const sign = long ? 1 : -1;
  const side: 'LONG' | 'SHORT' = long ? 'LONG' : 'SHORT';
  const hedgeSide: 'LONG' | 'SHORT' = long ? 'SHORT' : 'LONG';
  const direction: 'long' | 'short' = long ? 'long' : 'short';
  const hedgeDirection: 'long' | 'short' = long ? 'short' : 'long';

  const klines: KlineData[] = [];
  let last = 100;
  for (let hour = 0; hour < 7; hour += 1) {
    const open = last;
    const close = round2(open + (rnd() - 0.5) * 8);
    const high = round2(Math.max(open, close) + rnd() * 12);
    const low = round2(Math.max(50, Math.min(open, close) - rnd() * 12));
    klines.push(bar(hour, open, high, low, close));
    last = close;
  }
  const priceAt = (minute: number) => {
    const candle = klines[Math.min(klines.length - 1, Math.floor(minute / 60))];
    return round2(candle.low + (candle.high - candle.low) * rnd());
  };

  const records: TradeRecord[] = [];
  const legs: SimLegSpec[] = [];
  const reverseHedgeOrders: CampaignReverseHedgeOrder[] = [];
  const corrections: LegExitPriceCorrections = {};
  const leverage = pick([1, 3, 5, 10]);

  // 主力 1（+ 并仓的镜像、没有腿的加仓），分刀平掉
  const qty1 = 4 + Math.floor(rnd() * 12);
  const close1 = pick([90, 120, 150, 180]);
  let position = simOpen(SIM_SYMBOL, { id: 'pos-main', side, price: 100, qty: qty1, openMs: at(0), leverage });
  const mirror = chance(0.5);
  const mirrorQty = 2 + Math.floor(rnd() * 10);
  if (mirror) {
    const fill = simOpen(SIM_SYMBOL, { id: 'fill-mirror', side, price: 100, qty: mirrorQty, openMs: at(0), leverage });
    position = mergeFilledPosition(SIM_SYMBOL, [position], fill).survivor;
  }
  if (chance(0.25)) {
    const add = simOpen(SIM_SYMBOL, { id: 'fill-add', side, price: priceAt(20), qty: 1 + Math.floor(rnd() * 6), openMs: at(20), leverage });
    position = mergeFilledPosition(SIM_SYMBOL, [position], add).survivor;
  }
  let rest: Position | null = position;
  if (mirror && chance(0.7)) {
    const tp = simClose(SIM_SYMBOL, rest, round2(100 + sign * 3), 0.6, at(pick([30, 45])), 'tp');
    records.push(...tp.records);
    rest = tp.rest;
  }
  if (rest && chance(0.25)) {
    const half = simClose(SIM_SYMBOL, rest, priceAt(60), 0.5, at(60), 'half');
    records.push(...half.records);
    rest = half.rest;
  }
  let mainExit = priceAt(close1);
  if (rest) {
    const final = simClose(SIM_SYMBOL, rest, mainExit, 1, at(close1), 'final');
    records.push(...final.records);
    mainExit = final.records[0]?.exitPrice ?? mainExit;
  }
  legs.push({
    id: 'main', role: 'main_open', direction, recordRef: 'pos-main', plannedPrice: 100,
    plannedSize: plannedNotional(qty1, 100), openMs: at(0), closeMs: at(close1), exitSnapshot: mainExit, leverage,
  });
  if (mirror) {
    legs.push({
      id: 'mirror', role: 'mirror_tp', direction, recordRef: 'fill-mirror', plannedPrice: 100,
      plannedSize: plannedNotional(mirrorQty, 100), openMs: at(0), closeMs: at(close1), exitSnapshot: mainExit, leverage,
    });
  }
  if (chance(0.2)) {
    const candle = klines[Math.min(klines.length - 1, Math.floor(close1 / 60))];
    corrections.main = {
      exitPrice: round2((candle.low + candle.high) / 2),
      originalExitPrice: mainExit,
      candleLow: candle.low,
      candleHigh: candle.high,
    };
  }

  // 一笔主力的初始对冲 A/B：挂着、先挂后成交、缺失；偶尔挂在利润侧
  const addHedges = (suffix: string, entry: number, placedAt: number, windowEnd: number) => {
    for (const [role, distance] of [['hedge_initial_a', 0.02], ['hedge_initial_b', 0.04]] as const) {
      const mode = pick(['pending', 'pending', 'filled', 'absent']);
      if (mode === 'absent') continue;
      const price = round2(chance(0.1) ? entry * (1 + sign * 0.03) : entry * (1 - sign * distance * (0.5 + rnd())));
      const placed = placedAt + pick([0, 0, 2, 10]);
      const qty = 2 + Math.floor(rnd() * 8);
      const id = `${role === 'hedge_initial_a' ? 'hedge-a' : 'hedge-b'}${suffix}`;
      if (chance(0.3)) {
        reverseHedgeOrders.push({
          id: `ord-${id}`, side: hedgeSide, price, createdAt: at(placed), cancelledAt: at(windowEnd), status: 'cancelled',
        });
      }
      if (mode === 'pending') {
        legs.push({ id, role, direction: hedgeDirection, recordRef: null, plannedPrice: price, plannedSize: plannedNotional(qty, price), openMs: at(placed), leverage });
        continue;
      }
      const fillAt = placed + pick([0, 20, 60, 110]);
      const closeAt = fillAt + pick([10, 30, 50]);
      const hedge = simOpen(SIM_SYMBOL, { id: `pos-${id}`, side: hedgeSide, price, qty, openMs: at(fillAt), leverage });
      const closed = simClose(SIM_SYMBOL, hedge, priceAt(closeAt), 1, at(closeAt), `close-${id}`);
      records.push(...closed.records);
      legs.push({
        id, role, direction: hedgeDirection, recordRef: `pos-${id}`, plannedPrice: price, plannedSize: plannedNotional(qty, price),
        openMs: at(placed), closeMs: at(closeAt), exitSnapshot: closed.records[0].exitPrice, leverage,
      });
    }
    if (chance(0.15)) {
      const price = round2(entry * (1 - sign * 0.05));
      legs.push({ id: `hedge-a-extra${suffix}`, role: 'hedge_initial_a', direction: hedgeDirection, recordRef: null, plannedPrice: price, plannedSize: plannedNotional(3, price), openMs: at(placedAt + 30), leverage });
    }
  };
  addHedges('', 100, 0, close1);

  // 主力 2：先挂后成交的限价单，与主力 1 先后或重叠
  if (chance(0.45)) {
    const placed = pick([20, 45, 60, 75, 100]);
    const filledAt = placed + pick([0, 15, 30]);
    const closeAt = filledAt + pick([30, 60, 120, 200]);
    const entry = priceAt(filledAt);
    const qty2 = 1 + Math.floor(rnd() * 25);
    const second = simOpen(SIM_SYMBOL, { id: 'pos-main2', side, price: entry, qty: qty2, openMs: at(filledAt), leverage });
    const closed = simClose(SIM_SYMBOL, second, priceAt(closeAt), 1, at(closeAt), 'main2');
    records.push(...closed.records);
    legs.push({
      id: 'main2', role: 'main_open', direction, recordRef: 'pos-main2', plannedPrice: entry, plannedSize: plannedNotional(qty2, entry),
      openMs: at(placed), closeMs: at(closeAt), exitSnapshot: closed.records[0].exitPrice, leverage,
    });
    addHedges('-2', entry, placed, closeAt);
  }

  const active = chance(0.15);
  const noLocalRecords = !active && chance(0.12);
  let storedPnl: number | null | undefined;
  const events: CampaignEvent[] = [];
  let fixtureRecords = records;
  if (noLocalRecords) {
    fixtureRecords = [];
    const withSnapshots = chance(0.5);
    for (const leg of legs) {
      if (leg.recordRef != null && withSnapshots && chance(0.7)) leg.realizedSnapshot = round2((rnd() - 0.4) * 80);
    }
    storedPnl = pick([round2((rnd() - 0.3) * 150), null]);
    if (chance(0.3)) {
      events.push(event({
        id: 'ev-main-closed', timestamp: iso(at(close1)), event_type: 'main_fully_closed',
        leg_role: 'main_open', journal_id: 'main', price: mainExit, size_usdt: plannedNotional(qty1, 100),
        realized_pnl: round2((rnd() - 0.3) * 150),
      }));
    }
  }
  if (chance(0.1)) {
    events.push(event({
      id: 'ev-hedge-a', timestamp: iso(at(pick([0, 50, 90]))), event_type: 'hedge_placed',
      leg_role: 'hedge_initial_a', price: round2(100 * (1 - sign * 0.06)),
    }));
  }

  return buildSimFixture({
    id: `random-${seed}`,
    title: `随机形状 #${seed}`,
    direction: long ? 'main_long' : 'main_short',
    legs,
    records: fixtureRecords,
    klines,
    reverseHedgeOrders,
    events,
    corrections: noLocalRecords ? {} : corrections,
    ...(active ? { closedAtMs: null } : {}),
    ...(storedPnl !== undefined ? { storedPnl } : {}),
  });
}
