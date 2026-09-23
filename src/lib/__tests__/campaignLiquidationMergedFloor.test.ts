/**
 * 爆仓腿的封顶必须恰好是「交易所真正结算掉的那笔钱」，不能按「开仓名义 ÷ 开仓杠杆」估。
 *
 * 三处会估错：
 *   ① 合并仓位（主力 + 加仓）整仓强平：拆账后每一片各估一个保证金，相加比整仓保证金大一截
 *      （0.3@100,000 + 0.2@110,000 的整仓保证金 2600，逐片估出 3740，最大回撤超报 43.8%）；
 *   ② 持仓中途提过杠杆：record.leverage 按设计恒为**开仓**杠杆，隔离保证金却已经变小
 *      （20x 开仓、提到 40x 后保证金 1000 → 500，估出来仍是 1000）；
 *   ③ 全仓强平：根本没有保证金封顶，用 |结算值| 去封会把这条腿更早的真实浮亏截掉
 *      （先跌到浮亏 4000、最后被别的标的拖爆并结算 +1900，最大回撤会读成 1900）。
 *
 * 这一组夹具全部走真引擎：isolatedLiquidationSettlement 定净盈亏、buildCloseRecords 拆刀，
 * 再交给战役页的 computeDecisionAccuracy —— 与用户看到的是同一条路径。
 */
import { describe, expect, it } from 'vitest';
import type { KlineData } from '@/hooks/useBinanceData';
import { computeDecisionAccuracy } from '@/lib/campaignAnalysis';
import { isolatedLiquidationSettlement } from '@/lib/liquidationGuards';
import { liquidationPnlFloorUsd } from '@/lib/liquidationRecord';
import { buildCloseRecords } from '@/lib/tradingSettlement';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { Position, TradeRecord } from '@/types/trading';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-05-01T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const bar = (hours: number, open: number, high: number, low: number, close: number): KlineData => ({
  time: T0 + hours * HOUR, open, high, low, close, volume: 1,
});

const campaignOf = (symbol: string, sizeUsdt: number, leverage: number): TradeCampaign => ({
  id: 'c',
  user_id: 'u',
  campaign_code: 'C',
  symbol,
  direction: 'main_long',
  status: 'closed_loss',
  strategy_template: 'custom',
  title: 'c',
  opened_at: iso(T0),
  closed_at: iso(T0 + 3 * HOUR),
  initial_main_size_usdt: sizeUsdt,
  initial_leverage: leverage,
  final_realized_pnl: null,
  final_r_multiple: null,
  peak_unrealized_pnl: null,
  peak_drawdown: null,
  importance_weight: 0,
  notes: null,
  actual_evolution: [],
  deviation_notes: {},
  deleted_at: null,
  created_at: iso(T0),
  updated_at: iso(T0),
} as unknown as TradeCampaign);

const legOf = (id: string, recordId: string, symbol: string, entry: number, sizeUsdt: number): TradeJournal => ({
  id,
  user_id: 'u',
  campaign_id: 'c',
  source: 'live',
  symbol,
  direction: 'long',
  leverage: 20,
  leg_role: id === 'main' ? 'main_open' : 'main_add_1',
  leg_sequence: id === 'main' ? 1 : 2,
  trade_record_id: recordId,
  pre_simulated_time: iso(T0),
  pre_entry_price: entry,
  pre_position_size: sizeUsdt,
} as unknown as TradeJournal);

/** 逐仓强平走真引擎：定净盈亏（= −隔离保证金）→ 拆成每笔成交自己的记录。 */
function liquidate(symbol: string, position: Position, exitPrice: number, closeTime: number): TradeRecord[] {
  const totals = isolatedLiquidationSettlement({ symbol, position, exitPrice });
  return buildCloseRecords({
    symbol,
    pos: position,
    closeQty: Number(position.quantity),
    fillPrice: exitPrice,
    closeTime,
    exitMethod: 'liquidation',
    totals,
  }).map(record => ({
    ...record,
    action: 'LIQUIDATION' as const,
    liquidationSettlement: 'bankruptcy' as const,
  }));
}

describe('合并仓位整仓强平：封顶是整仓保证金，不是逐片估出来的和', () => {
  /**
   * 主力 0.3 @100,000 + 加仓 0.2 @110,000 → 合并 0.5 @104,000，名义 52,000，20 倍 → 隔离保证金 2600。
   * 破产价 98,800 上整仓毛亏恰好 −2600；拆刀后主力 −360、加仓 −2240（Σ = −2600）。
   */
  const position = {
    id: 'pos-merged',
    side: 'LONG',
    entryPrice: 104_000,
    quantity: 0.5,
    leverage: 20,
    openLeverage: 20,
    marginMode: 'isolated',
    margin: 2_600,
    isolatedMargin: 2_600,
    openTime: T0,
    fills: [
      { id: 'fill-main', openTime: T0, entryPrice: 100_000, units: 0.3, openLeverage: 20 },
      { id: 'fill-add', openTime: T0 + HOUR / 2, entryPrice: 110_000, units: 0.2, openLeverage: 20 },
    ],
  } as unknown as Position;

  // 强平时刻落在第三根 K 线中间：收在边界上的话「平仓前一刻」会退到上一根，那根 60,000 的影线就照不到这条腿。
  const records = liquidate('BTCUSDT', position, 98_800, T0 + 2 * HOUR + HOUR / 2);
  const legs = [
    legOf('main', records[0].id, 'BTCUSDT', 100_000, 30_000),
    legOf('add', records[1].id, 'BTCUSDT', 110_000, 22_000),
  ];
  // 强平那根 K 线的影线砸到 60,000：不封顶时这一段会被当成十几倍于保证金的浮亏。
  const klines = [
    bar(0, 104_000, 105_000, 103_000, 104_000),
    bar(1, 103_000, 103_500, 99_000, 99_500),
    bar(2, 99_000, 99_000, 60_000, 98_800),
    bar(3, 98_800, 99_000, 98_000, 98_500),
  ];

  it('引擎合约：Σ各刀盈亏恰好是 −隔离保证金', () => {
    expect(records).toHaveLength(2);
    expect(records[0].pnl).toBeCloseTo(-360, 6);
    expect(records[1].pnl).toBeCloseTo(-2240, 6);
    expect(records.reduce((sum, r) => sum + Number(r.pnl), 0)).toBeCloseTo(-2600, 6);
  });

  it('每一刀的封顶 = 它自己结算掉的那笔钱，相加正是整仓保证金 2600（按名义 ÷ 杠杆估会得到 3740）', () => {
    const floors = records.map(record => liquidationPnlFloorUsd(record) as number);
    expect(floors[0]).toBeCloseTo(-360, 6);
    expect(floors[1]).toBeCloseTo(-2240, 6);
    expect(floors.reduce((sum, f) => sum + f, 0)).toBeCloseTo(-2600, 6);
  });

  it('最大回撤 = 2600（整仓保证金），不是 3740', () => {
    const accuracy = computeDecisionAccuracy(campaignOf('BTCUSDT', 52_000, 20), legs, records, klines, []);
    expect(accuracy.campaign_max_drawdown_real).toBeCloseTo(2600, 6);
  });
});

describe('分片封顶与整仓封顶等价：破产价之下各片读回自己的结算值', () => {
  /**
   * 两笔成交并成的逐仓多单：10,000 @1.0000 与 10,000 @0.9000 → 合并 20,000 @0.9500，
   * 名义 19,000、20 倍 → 保证金 950，破产价 0.90250（整仓毛亏恰好 −950）。
   * 拆账后主力 −975、加仓 **+25**：加仓那一片在破产价上仍是赚的，封顶因此是正数。
   * 各片的毛利都是价格的单调函数、拐点同在破产价上，所以逐片截断与整仓截断完全等价：
   * 破产价之下每一片读回自己的结算值，相加正是 −950。
   * 封顶写成正数（max(名义 ÷ 杠杆, |结算值|) = 975 / 450）时，加仓那一片会被压成 −450，
   * 0.8500 上读出 −1425，比交易所收走的多报 475。
   */
  const position = {
    id: 'pos-two-fills',
    side: 'LONG',
    entryPrice: 0.95,
    quantity: 20_000,
    leverage: 20,
    openLeverage: 20,
    marginMode: 'isolated',
    margin: 950,
    isolatedMargin: 950,
    openTime: T0,
    fills: [
      { id: 'fill-a', openTime: T0, entryPrice: 1, units: 10_000, openLeverage: 20 },
      { id: 'fill-b', openTime: T0 + HOUR / 2, entryPrice: 0.9, units: 10_000, openLeverage: 20 },
    ],
  } as unknown as Position;

  const records = liquidate('XUSDT', position, 0.9025, T0 + 2 * HOUR + HOUR / 2);
  const legs = [
    legOf('main', records[0].id, 'XUSDT', 1, 10_000),
    legOf('add', records[1].id, 'XUSDT', 0.9, 9_000),
  ];
  // 第二根 K 线最低 0.9030（仍在破产价 0.90250 之上、还没强平），第三根才砸到破产价以下。
  const klines = [
    bar(0, 1, 1.001, 0.99, 0.995),
    bar(1, 0.99, 0.99, 0.903, 0.91),
    bar(2, 0.91, 0.91, 0.85, 0.9025),
    bar(3, 0.9025, 0.905, 0.9, 0.9),
  ];

  it('拆账后加仓那一片在破产价上是正的，封顶带符号', () => {
    expect(records[0].pnl).toBeCloseTo(-975, 6);
    expect(records[1].pnl).toBeCloseTo(25, 6);
    expect(liquidationPnlFloorUsd(records[1])).toBeCloseTo(25, 6);
  });

  it('最大回撤 = 950（整仓保证金）：0.9030 那一刻读 −940，强平那根 K 线砸到 0.8500 也只读 −950', () => {
    const accuracy = computeDecisionAccuracy(campaignOf('XUSDT', 19_000, 20), legs, records, klines, []);
    expect(accuracy.campaign_max_drawdown_real).toBeCloseTo(950, 6);
  });

  it('封顶只在强平那根 K 线内生效：更早的 K 线跌到 0.9000 读的是真实浮亏 −1000，不被封顶抬成 −950', () => {
    // 强平之前仓位结构未必是最终这个样子（提杠杆、加仓都会改封顶），那时的浮亏是账户真实经历过的回撤。
    const earlier = [klines[0], bar(1, 0.99, 0.99, 0.9, 0.91), klines[2], klines[3]];
    const accuracy = computeDecisionAccuracy(campaignOf('XUSDT', 19_000, 20), legs, records, earlier, []);
    expect(accuracy.campaign_max_drawdown_real).toBeCloseTo(1000, 6);
  });
});

describe('持仓中途提过杠杆：封顶按实际结算掉的保证金', () => {
  it('20 倍开仓、提到 40 倍后强平：最大回撤 500，不是按开仓杠杆估出的 1000', () => {
    const record = {
      id: 'rec-lev',
      positionId: 'pos-lev',
      fillId: 'pos-lev',
      symbol: 'XUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'LIQUIDATION',
      exit_method: 'liquidation',
      liquidationSettlement: 'bankruptcy',
      entryPrice: 1,
      exitPrice: 0.977,
      quantity: 20_000,
      leverage: 20,          // 开仓杠杆；提杠杆之后隔离保证金已经是 500
      pnl: -500,
      fee: 10,
      liquidationFeeUsd: 4,
      slippage: 0,
      openTime: T0,
      closeTime: T0 + 2 * HOUR + HOUR / 2,
    } as TradeRecord;
    const legs = [legOf('main', 'pos-lev', 'XUSDT', 1, 20_000)];
    const klines = [
      bar(0, 1, 1.002, 0.99, 0.995),
      bar(1, 0.99, 0.995, 0.98, 0.98),
      bar(2, 0.98, 0.98, 0.8, 0.977),
      bar(3, 0.977, 0.98, 0.97, 0.975),
    ];
    const accuracy = computeDecisionAccuracy(campaignOf('XUSDT', 20_000, 20), legs, [record], klines, []);
    expect(accuracy.campaign_max_drawdown_real).toBeCloseTo(500, 6);
  });
});

describe('全仓强平不封顶：整个钱包兜底，腿在更早的价位上可以亏得更多', () => {
  it('先跌到浮亏 4000、最后被拖爆时结算 +1900：最大回撤仍是 4000', () => {
    const record = {
      id: 'rec-cross',
      positionId: 'pos-cross',
      fillId: 'pos-cross',
      symbol: 'XUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'LIQUIDATION',
      exit_method: 'liquidation',
      // 全仓强平不带 bankruptcy 标记（引擎有意为之：没有保证金封顶）
      entryPrice: 1,
      exitPrice: 1.1,
      quantity: 20_000,
      leverage: 20,
      pnl: 1_900,
      fee: 100,
      liquidationFeeUsd: 110,
      slippage: 0,
      openTime: T0,
      closeTime: T0 + 3 * HOUR,
    } as TradeRecord;
    const legs = [legOf('main', 'pos-cross', 'XUSDT', 1, 20_000)];
    const klines = [
      bar(0, 1, 1.002, 0.99, 0.995),
      bar(1, 0.99, 0.99, 0.8, 0.85),      // 真实浮亏 4000
      bar(2, 0.85, 1.05, 0.85, 1.05),
      bar(3, 1.05, 1.1, 1.05, 1.1),
    ];
    expect(liquidationPnlFloorUsd(record)).toBeNull();
    const accuracy = computeDecisionAccuracy(campaignOf('XUSDT', 20_000, 20), legs, [record], klines, []);
    expect(accuracy.campaign_max_drawdown_real).toBeCloseTo(4000, 6);
  });
});
