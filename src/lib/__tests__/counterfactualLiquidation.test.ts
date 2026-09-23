/**
 * 反事实「Legs 副本」也必须认得爆仓这件事。
 *
 * 事故：副本把强平腿当成一笔普通平仓，平仓价一格随便拖——把 0.9540 拖到 0.8500，
 * 一条保证金只有 1000、而且是交易所在 0.9540 上强制收走的腿，被算出 −3078.96。
 * 交易所收走仓位之后的价格根本不属于它，这个「如果当时不平」的假设在现实里不存在。
 *
 * 规则：
 *   · 强平腿在「实际成交」事实里标出来（actual.liquidated），每一刀带自己的盈亏封顶（pnl_floor_usdt）；
 *   · 这条腿的盈亏在封顶处截断（仓位一格改过时按比例缩放，杠杆不变、保证金同比例变）；
 *   · 权益路径上的那一段带同一个封顶，与战役页的极值算法读同一条规则；
 *   · 编辑器锁死它的平仓价 / 平仓时间（改不动的事）。
 */
import { describe, expect, it } from 'vitest';
import type { KlineData } from '@/hooks/useBinanceData';
import { adoptBaselineLegFacts, buildManualLegs, resolveManualLegEconomics } from '@/lib/campaignSimulationEngine';
import type { CampaignCounterfactualParams, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const MIN = 60_000;
const t0 = Date.parse('2026-08-07T01:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const k = (index: number, open: number, high: number, low: number, close: number): KlineData => ({
  time: t0 + index * MIN, open, high, low, close, volume: 0,
});

const params = (): CampaignCounterfactualParams => ({
  entry: { time: iso(t0), price: 1, size_usdt: 20_000, direction: 'long', leverage: 20 },
  hedge_a: { offset_pct: -2, size_pct: 50 },
  hedge_b: { offset_pct: -4, size_pct: 50 },
  mirror_tp: { offset_pct: 2, size_pct: 50 },
  rolling: {
    enabled: false,
    trigger_rise_pct: 10,
    min_interval_minutes: 60,
    new_hedge_offset_pct: -2,
    rolling_hedge_size_pct: 100,
  },
  exit_rule: 'close_all_on_hedge_trigger',
});

/** 逐仓多单 1.0000 × 20,000 币、20 倍：保证金 1000，0.9540 上按破产价结算。 */
const record = {
  id: 'rec-liq',
  positionId: 'pos-liq',
  fillId: 'pos-liq',
  symbol: 'XUSDT',
  side: 'LONG',
  type: 'MARKET',
  action: 'LIQUIDATION',
  exit_method: 'liquidation',
  liquidationSettlement: 'bankruptcy',
  entryPrice: 1,
  exitPrice: 0.954,
  quantity: 20_000,
  leverage: 20,
  pnl: -1000,
  fee: 12,
  liquidationFeeUsd: 8,
  slippage: 0,
  openTime: t0,
  closeTime: t0 + 60 * MIN,
} as TradeRecord;

const leg = {
  id: 'leg-liq',
  trade_record_id: 'pos-liq',
  leg_sequence: 1,
  source: 'live',
  leg_role: 'main_open',
  direction: 'long',
  symbol: 'XUSDT',
  leverage: 20,
  pre_simulated_time: iso(t0),
  pre_entry_price: 1,
  pre_position_size: 20_000,
} as TradeJournal;

const campaign = {
  id: 'c',
  symbol: 'XUSDT',
  direction: 'main_long',
  status: 'closed_loss',
  strategy_template: 'custom',
  opened_at: iso(t0),
  closed_at: iso(t0 + 60 * MIN),
  final_realized_pnl: -1000,
  actual_evolution: [],
} as unknown as TradeCampaign;

const build = () => buildManualLegs(
  params(),
  [leg],
  [k(0, 1, 1.01, 0.99, 1), k(60, 0.96, 0.96, 0.8, 0.95)],
  [record],
  {},
  { campaign },
);

describe('反事实副本里的爆仓腿', () => {
  it('带上爆仓事实与每一刀的亏损封顶', () => {
    const [manual] = build();
    expect(manual.actual?.liquidated).toBe(true);
    expect(manual.actual?.cuts?.[0].pnl_floor_usdt).toBeCloseTo(-1000, 9);
  });

  it('原样重跑：盈亏仍是交易所结算的 −1000，权益路径那一段带着同一个封顶', () => {
    const [manual] = build();
    const economics = resolveManualLegEconomics(manual);
    expect(economics.netPnl).toBeCloseTo(-1000, 9);
    expect(economics.pathSegments[0].pnlFloorUsd).toBeCloseTo(-1000, 9);
  });

  it('把平仓价拖到 0.8500：亏损封顶在保证金 1000，不是 −3078.96', () => {
    const [manual] = build();
    const dragged = { ...manual, exit_price: 0.85 };
    expect(resolveManualLegEconomics(dragged).netPnl).toBeCloseTo(-1000, 9);
    // 封顶之前算出来的那个数（毛 −3000、再扣两端费率差）就是审计里的 −3078.96
    expect(resolveManualLegEconomics({ ...dragged, actual: undefined }).netPnl).toBeLessThan(-3000);
  });

  /**
   * 本次改动之前保存的分支：腿上带着 actual（所以走「事实原样保留」那条早返回），
   * 但里面既没有 liquidated 也没有各刀的封顶。不补的话，用户当年把强平价拖到 0.8500 存下的那一条
   * 载回来仍读 −3078.96，两格也不锁、还能接着拖。
   */
  it('老分支载回来：强平这件事按当前基线补上，盈亏跟着封顶，存下的平仓价留在（已锁的）格子里', () => {
    const [baseline] = build();
    const savedCuts = baseline.actual?.cuts?.map(cut => {
      const { pnl_floor_usdt: _floor, ...rest } = cut;
      return rest;
    });
    const { liquidated: _liquidated, ...savedActual } = baseline.actual ?? {};
    const saved = {
      ...baseline,
      exit_price: 0.85,
      actual: { ...savedActual, cuts: savedCuts },
    } as typeof baseline;

    // 补之前：没有事实、没有封顶，还是审计里那个 −3078.96
    expect(saved.actual?.liquidated).toBeUndefined();
    expect(resolveManualLegEconomics(saved).netPnl).toBeLessThan(-3000);

    const adopted = adoptBaselineLegFacts(saved, baseline);
    expect(adopted.actual?.liquidated).toBe(true);
    expect(adopted.actual?.cuts?.[0].pnl_floor_usdt).toBeCloseTo(-1000, 9);
    expect(adopted.exit_price).toBe(0.85);
    expect(resolveManualLegEconomics(adopted).netPnl).toBeCloseTo(-1000, 9);
  });

  it('不是强平的腿：载回来的行逐字节不动', () => {
    const [baseline] = build();
    const plain = { ...baseline, actual: { ...baseline.actual!, liquidated: undefined } } as typeof baseline;
    delete plain.actual!.liquidated;
    const plainBaseline = { ...baseline, actual: { ...plain.actual! } } as typeof baseline;
    expect(adoptBaselineLegFacts(plain, plainBaseline)).toBe(plain);
  });

  it('仓位一格改大一倍：保证金同比例变大，封顶跟着到 2000', () => {
    const [manual] = build();
    const doubled = { ...manual, size_usdt: 40_000, exit_price: 0.85 };
    const economics = resolveManualLegEconomics(doubled);
    expect(economics.netPnl).toBeCloseTo(-2000, 9);
    expect(economics.pathSegments[0].pnlFloorUsd).toBeCloseTo(-2000, 9);
  });
});
