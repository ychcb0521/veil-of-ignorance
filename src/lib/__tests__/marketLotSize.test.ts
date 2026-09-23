import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ORDER_LOT_SIZE_STAMP,
  SYMBOL_FILTER_DATA,
  SYMBOL_FILTER_SNAPSHOT_DATE,
  binanceSymbolFilters,
  cardCloseLotSize,
  checkLotSize,
  isWholePositionCloseOrder,
  lotSizeCapLabel,
  lotSizeKindOfOrder,
  lotSizeRefusalAtExecution,
  maxOrderUnits,
  pendingLotSizeBadge,
  pendingLotSizeRisk,
  placementLotSize,
  resolveLotSize,
  trailingLotSizePrice,
  twapOrderSliceUnits,
  twapSlicePlan,
  type LotSizeDraft,
} from '@/lib/marketLotSize';
import { initTrailingState, stepTrailingStop } from '@/lib/trailingStop';
import type { PendingOrder, Position } from '@/types/trading';

/**
 * 币安单笔数量上限（MARKET_LOT_SIZE / LOT_SIZE）的数据入口与判定。
 * 数字取自打包的快照（scripts/update-binance-symbol-filters.mjs 从 fapi / dapi 的 exchangeInfo 生成）。
 */

const usdtPos = (quantity: number, over: Partial<Position> = {}): Position => ({
  id: over.id ?? `u-${quantity}`, side: 'LONG', entryPrice: 1, quantity, leverage: 5, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT', margin: quantity / 5, ...over,
});
const coinPos = (contracts: number, over: Partial<Position> = {}): Position => ({
  id: over.id ?? `c-${contracts}`, side: 'LONG', entryPrice: 1, quantity: contracts, contracts, contractSizeUsd: 10,
  leverage: 5, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'KAITO', margin: contracts * 2, ...over,
});
const pending = (over: Partial<PendingOrder>): PendingOrder => ({
  id: 'o', side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 1, quantity: 1, leverage: 5, marginMode: 'isolated',
  settlementMode: 'usdt', status: 'PENDING', createdAt: 0, ...over,
} as PendingOrder);

describe('快照', () => {
  it('结构：快照时间、来源、列名，一行一个标的；强平清算费率存着备用', () => {
    expect(SYMBOL_FILTER_SNAPSHOT_DATE).toBe('2026-09-23');
    expect(SYMBOL_FILTER_DATA.sources).toMatchObject({
      usdmExchangeInfo: 'https://fapi.binance.com/fapi/v1/exchangeInfo',
      coinmExchangeInfo: 'https://dapi.binance.com/dapi/v1/exchangeInfo',
      statuses: ['TRADING'],
    });
    expect(SYMBOL_FILTER_DATA.columns).toEqual([
      'marketMaxQty', 'marketMinQty', 'marketStepSize', 'limitMaxQty', 'limitMinQty', 'limitStepSize', 'liquidationFee',
    ]);
    expect(Object.keys(SYMBOL_FILTER_DATA.usdm).length).toBeGreaterThan(500);
    expect(Object.keys(SYMBOL_FILTER_DATA.coinm)).toContain('BTCUSD_PERP');
    // 只收永续：交割合约（BTCUSD_260925 这类）不在里面
    expect(Object.keys(SYMBOL_FILTER_DATA.coinm).every(s => s.endsWith('_PERP'))).toBe(true);
    const raw = readFileSync(join(process.cwd(), 'src/data/binanceSymbolFilters.json'), 'utf8');
    expect(raw).toContain('\n    "KAITOUSDT": [200000,0.1,0.1,2000000,0.1,0.1,0.015],\n');
  });

  it('已知合约的市价单 / 限价单上限（与币安 exchangeInfo 一致）', () => {
    const market = (s: string) => binanceSymbolFilters('usdm', s)?.market.maxQty;
    expect(market('BTCUSDT')).toBe(120);
    expect(market('ETHUSDT')).toBe(2_000);
    expect(market('KAITOUSDT')).toBe(200_000);
    expect(market('TUTUSDT')).toBe(4_000_000);
    expect(market('ORDIUSDT')).toBe(20_000);
    expect(market('ASTERUSDT')).toBe(400_000);
    expect(binanceSymbolFilters('usdm', 'KAITOUSDT')).toMatchObject({
      limit: { maxQty: 2_000_000, minQty: 0.1, stepSize: 0.1 },
      market: { minQty: 0.1, stepSize: 0.1 },
      liquidationFee: 0.015,
    });
    expect(binanceSymbolFilters('usdm', 'BTCUSDT')?.limit.maxQty).toBe(1_000);
    expect(binanceSymbolFilters('coinm', 'BTCUSD_PERP')).toMatchObject({
      market: { maxQty: 60_000, minQty: 1, stepSize: 1 },
      limit: { maxQty: 1_000_000 },
    });
  });
});

describe('应用标的 → 单笔上限（引擎单位）', () => {
  it('U 本位以币计', () => {
    const r = resolveLotSize('KAITOUSDT', 'usdt')!;
    expect(r).toMatchObject({ source: 'usdm', unit: 'KAITO', contractSizeUsd: null, note: null });
    expect(maxOrderUnits('KAITOUSDT', 'usdt', 'market')).toBe(200_000);
    expect(maxOrderUnits('KAITOUSDT', 'usdt', 'limit')).toBe(2_000_000);
    expect(maxOrderUnits('BTCUSDT', 'usdt', 'market')).toBe(120);
  });

  it('币安上线的币本位以张计，与价无关（BTCUSDT 切币本位 = BTCUSD_PERP 60,000 张）', () => {
    const r = resolveLotSize('BTCUSDT', 'coin')!;
    expect(r).toMatchObject({ source: 'coinm', unit: '张', note: null });
    expect(r.filters.binanceSymbol).toBe('BTCUSD_PERP');
    expect(maxOrderUnits('BTCUSDT', 'coin', 'market')).toBe(60_000);
    expect(maxOrderUnits('BTCUSDT', 'coin', 'market', 30_000)).toBe(60_000);
    expect(maxOrderUnits('BTCUSD', 'coin', 'limit')).toBe(1_000_000);
    expect(maxOrderUnits('ETHUSDT', 'coin', 'market')).toBe(500_000);
  });

  it('合成币本位（币安无 KAITO 币本位）：借 KAITOUSDT 的 200,000 KAITO，按价折整张（向下取整），随价变', () => {
    const r = resolveLotSize('KAITOUSDT', 'coin')!;
    expect(r).toMatchObject({ source: 'usdm-proxy', unit: '张', contractSizeUsd: 10 });
    expect(r.note).toBe('币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 的单笔上限折算');
    // 200,000 × 1.0905 ÷ 10 = 21,810
    expect(maxOrderUnits('KAITOUSDT', 'coin', 'market', 1.0905)).toBe(21_810);
    // 价格减半，能下的张数减半
    expect(maxOrderUnits('KAITOUSDT', 'coin', 'market', 0.54525)).toBe(10_905);
    expect(maxOrderUnits('KAITOUSD', 'coin', 'market', 1.0905)).toBe(21_810);
    // 向下取整：200,000 × 1.00009 ÷ 10 = 20,001.8 → 20,001
    expect(maxOrderUnits('KAITOUSDT', 'coin', 'market', 1.00009)).toBe(20_001);
    expect(maxOrderUnits('KAITOUSDT', 'coin', 'limit', 1)).toBe(200_000);
    // 取不到价：不设上限，不拿猜的价拦人
    expect(maxOrderUnits('KAITOUSDT', 'coin', 'market')).toBeNull();
    expect(checkLotSize({ symbol: 'KAITOUSDT', settlement: 'coin', kind: 'market', units: 1e9 }).ok).toBe(true);
  });

  it('快照里查不到的合约：不设上限、从不拦', () => {
    expect(resolveLotSize('NOTAREALCOINUSDT', 'usdt')).toBeNull();
    expect(resolveLotSize('NOTAREALCOINUSDT', 'coin')).toBeNull();
    // 已下架（SETTLING）的合约不在快照里
    expect(resolveLotSize('COMMONUSDT', 'usdt')).toBeNull();
    const check = checkLotSize({ symbol: 'NOTAREALCOINUSDT', settlement: 'usdt', kind: 'market', units: 1e12 });
    expect(check).toMatchObject({ ok: true, maxUnits: null, title: null });
    expect(lotSizeCapLabel(check)).toBeNull();
  });
});

describe('判定与说明', () => {
  it('U 本位超过市价上限：写明上限、这一单、来源与出路（拆单或改限价，并写出限价上限）', () => {
    const check = checkLotSize({ symbol: 'KAITOUSDT', settlement: 'usdt', kind: 'market', units: 250_000 });
    expect(check.ok).toBe(false);
    expect(check.title).toBe('单笔市价单最多 200,000 KAITO，这一单 250,000 KAITO');
    expect(check.source).toBe('币安 KAITOUSDT 的市价单单笔上限（快照 2026-09-23）');
    expect(check.detail).toBe('币安 KAITOUSDT 的市价单单笔上限（快照 2026-09-23）。请拆成几笔市价单，或改用限价单（限价单单笔最多 2,000,000 KAITO）。');
    expect(lotSizeCapLabel(check)).toBe('单笔市价上限 200,000 KAITO');
  });

  it('恰好等于上限放行；按金额折出来的浮点尾巴不算超', () => {
    expect(checkLotSize({ symbol: 'KAITOUSDT', settlement: 'usdt', kind: 'market', units: 200_000 }).ok).toBe(true);
    expect(checkLotSize({ symbol: 'KAITOUSDT', settlement: 'usdt', kind: 'market', units: 200_000.0000000001 }).ok).toBe(true);
    expect(checkLotSize({ symbol: 'KAITOUSDT', settlement: 'usdt', kind: 'market', units: 200_000.1 }).ok).toBe(false);
  });

  it('币本位写张数；合成币本位写明借了谁、按哪个价折', () => {
    const btc = checkLotSize({ symbol: 'BTCUSDT', settlement: 'coin', kind: 'market', units: 60_001 });
    expect(btc.title).toBe('单笔市价单最多 60,000 张，这一单 60,001 张');
    expect(lotSizeCapLabel(btc)).toBe('单笔市价上限 60,000 张');
    const kaito = checkLotSize({ symbol: 'KAITOUSDT', settlement: 'coin', kind: 'market', units: 21_811, price: 1.0905 });
    expect(kaito.title).toBe('单笔市价单最多 21,810 张，这一单 21,811 张');
    expect(kaito.source).toBe('币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 的市价单单笔上限 200,000 KAITO，按价 1.0905、面值 10 USD 折成张（快照 2026-09-23）');
    expect(lotSizeCapLabel(kaito)).toBe('单笔市价上限 21,810 张（按 KAITOUSDT 的 200,000 KAITO 折算）');
  });

  it('U 本位的量按该合约的 stepSize 写（KAITO 一位、BTC 三位），不带浮点尾巴；四舍五入后看着不超的往上进一格', () => {
    // 按 USDT 金额折出来的币数：275,084.72380256 KAITO
    expect(checkLotSize({ symbol: 'KAITOUSDT', settlement: 'usdt', kind: 'market', units: 275_084.72380256 }).title)
      .toBe('单笔市价单最多 200,000 KAITO，这一单 275,084.7 KAITO');
    expect(checkLotSize({ symbol: 'KAITOUSDT', settlement: 'usdt', kind: 'market', units: 200_000.04 }).title)
      .toBe('单笔市价单最多 200,000 KAITO，这一单 200,000.1 KAITO');
    expect(checkLotSize({ symbol: 'BTCUSDT', settlement: 'usdt', kind: 'market', units: 120.00012 }).title)
      .toBe('单笔市价单最多 120 BTC，这一单 120.001 BTC');
    expect(checkLotSize({ symbol: 'BTCUSDT', settlement: 'usdt', kind: 'market', units: 133.3333333 }).title)
      .toBe('单笔市价单最多 120 BTC，这一单 133.333 BTC');
  });

  it('限价单按 LOT_SIZE，出路只说拆单', () => {
    const check = checkLotSize({ symbol: 'KAITOUSDT', settlement: 'usdt', kind: 'limit', units: 2_000_001 });
    expect(check.title).toBe('单笔限价单最多 2,000,000 KAITO，这一单 2,000,001 KAITO');
    expect(check.detail).toBe('币安 KAITOUSDT 的限价单单笔上限（快照 2026-09-23）。请拆成几笔下单。');
    expect(checkLotSize({ symbol: 'KAITOUSDT', settlement: 'usdt', kind: 'limit', units: 250_000 }).ok).toBe(true);
  });
});

/**
 * 超过上限时「怎么办」按单子的类型写：市价单拆成几笔或改用限价单；条件单、跟踪委托、市价止盈止损
 * 触发后才按市价成交，出路是拆成几张同类的单——不叫人改用限价单：止损方向的单子（S₁ 的对冲在现价下方卖出、
 * 突破加仓在现价上方买入）换成同价的限价单是立刻能成交的单，当场就按现价成交了。
 */
describe('被拒时的出路按单子的类型写', () => {
  const SOURCE = '币安 KAITOUSDT 的市价单单笔上限（快照 2026-09-23）。';
  const draft = (over: Partial<LotSizeDraft>): LotSizeDraft => ({ type: 'MARKET', quantity: 250_000, settlementMode: 'usdt', ...over });
  const stamped = (over: Partial<PendingOrder>) => pending({ ...ORDER_LOT_SIZE_STAMP, quantity: 250_000, ...over });

  it('下单时：条件单 / 跟踪委托 / 市价止盈止损拆成几张同类的单，不写「改用限价单」；市价单与最优价照旧', () => {
    const cond = placementLotSize('KAITOUSDT', draft({ type: 'CONDITIONAL', stopPrice: 0.9 }), 1).refusal;
    expect(cond?.detail).toBe(`${SOURCE}请拆成几张条件单（每张不超过上限）。`);
    const trailing = placementLotSize('KAITOUSDT', draft({ type: 'TRAILING_STOP', stopPrice: 1.1, callbackRate: 0.01 }), 1).refusal;
    expect(trailing?.detail).toBe(`${SOURCE}请拆成几张跟踪委托（每张不超过上限）。`);
    const legacy = placementLotSize('KAITOUSDT', draft({ type: 'MARKET_TP_SL', stopPrice: 0.9 }), 1).refusal;
    expect(legacy?.detail).toBe(`${SOURCE}请拆成几张市价止盈止损单（每张不超过上限）。`);
    for (const refusal of [cond, trailing, legacy]) expect(refusal?.detail).not.toContain('限价单');
    // 市价单、最优价（立即吃单，就是一笔市价单）：拆成几笔市价单，或改用限价单
    const market = placementLotSize('KAITOUSDT', draft({}), 1).refusal;
    expect(market?.detail).toBe(`${SOURCE}请拆成几笔市价单，或改用限价单（限价单单笔最多 2,000,000 KAITO）。`);
    const best = placementLotSize('KAITOUSDT', draft({ type: 'CONDITIONAL', priceSelection: 'BEST', stopPrice: 0.9 }), 1).refusal;
    expect(best?.detail).toBe(market?.detail);
  });

  it('挂着的单（委托列表的标记）：撤单后拆成几张重挂；触发那一刻已撤单：拆成几张重新挂', () => {
    const cond = stamped({ side: 'SHORT', stopPrice: 0.9 });
    expect(pendingLotSizeRisk('KAITOUSDT', cond, 1)?.detail).toBe(`${SOURCE}请撤单后拆成几张条件单重挂（每张不超过上限）。`);
    expect(lotSizeRefusalAtExecution('KAITOUSDT', cond, 0.9)?.detail).toBe(`${SOURCE}请拆成几张条件单重新挂（每张不超过上限）。`);
    const trailing = stamped({ type: 'TRAILING_STOP', side: 'SHORT', stopPrice: 1.1, callbackRate: 0.01, trailingActivated: false });
    expect(pendingLotSizeRisk('KAITOUSDT', trailing, 1)?.detail).toBe(`${SOURCE}请撤单后拆成几张跟踪委托重挂（每张不超过上限）。`);
    expect(lotSizeRefusalAtExecution('KAITOUSDT', trailing, 1.089)?.detail).toBe(`${SOURCE}请拆成几张跟踪委托重新挂（每张不超过上限）。`);
  });
});

describe('单子按市价还是限价判', () => {
  it('市价、条件委托、市价止盈止损、跟踪委托（市价执行）、TWAP、最优价按市价；其余按限价', () => {
    expect(lotSizeKindOfOrder({ type: 'MARKET' })).toBe('market');
    expect(lotSizeKindOfOrder({ type: 'CONDITIONAL' })).toBe('market');
    expect(lotSizeKindOfOrder({ type: 'MARKET_TP_SL' })).toBe('market');
    expect(lotSizeKindOfOrder({ type: 'TRAILING_STOP' })).toBe('market');
    expect(lotSizeKindOfOrder({ type: 'TRAILING_STOP', trailingExecType: 'LIMIT' })).toBe('limit');
    expect(lotSizeKindOfOrder({ type: 'TWAP' })).toBe('market');
    expect(lotSizeKindOfOrder({ type: 'LIMIT', priceSelection: 'BEST' })).toBe('market');
    for (const type of ['LIMIT', 'POST_ONLY', 'LIMIT_TP_SL', 'SCALED'] as const) {
      expect(lotSizeKindOfOrder({ type })).toBe('limit');
    }
  });

  it('平掉整个仓位的止盈止损（100%）豁免；按成数的与开仓单不豁免', () => {
    expect(isWholePositionCloseOrder({ reduceOnly: true, reducePercentage: 100 })).toBe(true);
    expect(isWholePositionCloseOrder({ reduceOnly: true, reducePercentage: 50 })).toBe(false);
    expect(isWholePositionCloseOrder({ reduceOnly: false, reducePercentage: 100 })).toBe(false);
    expect(isWholePositionCloseOrder({ reduceOnly: true })).toBe(false);
  });
});

describe('下单时（placementLotSize，引擎与面板共用）', () => {
  const draft = (over: Partial<LotSizeDraft>): LotSizeDraft => ({ type: 'MARKET', quantity: 0, settlementMode: 'usdt', ...over });

  it('市价按现价；条件委托按触发价（合成币本位的张数上限随价变）', () => {
    expect(placementLotSize('KAITOUSDT', draft({ quantity: 250_000 }), 1).refusal?.title)
      .toBe('单笔市价单最多 200,000 KAITO，这一单 250,000 KAITO');
    const coin = (over: Partial<LotSizeDraft>) => draft({ settlementMode: 'coin', contracts: over.quantity, ...over });
    // 现价 1.0905 → 21,810 张；触发价 1.2 → 24,000 张；触发价 0.9 → 18,000 张
    expect(placementLotSize('KAITOUSDT', coin({ quantity: 23_000 }), 1.0905).refusal).not.toBeNull();
    expect(placementLotSize('KAITOUSDT', coin({ type: 'CONDITIONAL', stopPrice: 1.2, quantity: 23_000 }), 1.0905).refusal).toBeNull();
    const low = placementLotSize('KAITOUSDT', coin({ type: 'CONDITIONAL', stopPrice: 0.9, quantity: 20_000 }), 1.0905);
    expect(low.refusal?.title).toBe('单笔市价单最多 18,000 张，这一单 20,000 张');
    expect(low.main.maxUnits).toBe(18_000);
    // 跟踪委托按激活价；没有激活价按现价
    expect(placementLotSize('KAITOUSDT', coin({ type: 'TRAILING_STOP', stopPrice: 0.9, quantity: 20_000 }), 1.0905).refusal).not.toBeNull();
    expect(placementLotSize('KAITOUSDT', coin({ type: 'TRAILING_STOP', stopPrice: 0, quantity: 20_000 }), 1.0905).refusal).toBeNull();
  });

  it('TWAP：每一片不得超过市价上限（片数与引擎同一个式子）', () => {
    const twap = (quantity: number) => draft({ type: 'TWAP', quantity, twapDuration: 60, twapInterval: 3 });
    const over = placementLotSize('KAITOUSDT', twap(4_400_000), 0.1);
    expect(over.pieces).toBe(20);
    expect(over.main.units).toBe(220_000);
    expect(over.refusalLead).toBe('TWAP 每一片（共 20 片）：');
    // 超的是一片，不是整张 TWAP：写「这一片」，出路是让每一片更小
    expect(over.refusal?.title).toBe('单笔市价单最多 200,000 KAITO，这一片 220,000 KAITO');
    expect(over.refusal?.detail).toBe('币安 KAITOUSDT 的市价单单笔上限（快照 2026-09-23）。请减少总量（每一片 = 总量 ÷ 片数，片数按总时长自动定，1 小时以上约 20 片）。');
    expect(placementLotSize('KAITOUSDT', twap(4_000_000), 0.1).refusal).toBeNull();
  });

  it('分段订单：每张子单按各自的委托价、限价上限判；合成币本位最低价那张最紧', () => {
    const scaled = (quantity: number, over: Partial<LotSizeDraft> = {}) => draft({
      type: 'SCALED', quantity, scaledCount: 5, scaledStartPrice: 0.09, scaledEndPrice: 0.1, ...over,
    });
    const over = placementLotSize('KAITOUSDT', scaled(11_000_000), 0.1);
    expect(over.pieces).toBe(5);
    expect(over.main.kind).toBe('limit');
    expect(over.refusalLead).toBe('分段订单第 1 张子单：');
    expect(over.refusal?.title).toBe('单笔限价单最多 2,000,000 KAITO，这张子单 2,200,000 KAITO');
    expect(placementLotSize('KAITOUSDT', scaled(10_000_000), 0.1).refusal).toBeNull();
    // 合成币本位：0.5→1.0 五张各 20,000 张；0.5 上只能 200,000 张（限价上限 2,000,000 KAITO × 0.5 ÷ 10 = 100,000）
    const coin = placementLotSize('KAITOUSDT', scaled(600_000, {
      settlementMode: 'coin', contracts: 600_000, scaledStartPrice: 0.5, scaledEndPrice: 1.0,
    }), 1);
    expect(coin.main.maxUnits).toBe(100_000);
    expect(coin.refusal?.title).toBe('单笔限价单最多 100,000 张，这张子单 120,000 张');
  });

  it('最优价（BEST）先于 TWAP / 分段：引擎整笔立即吃单，按一笔市价单判全量（不是一片 / 一张子单）', () => {
    const twapBest = placementLotSize('KAITOUSDT', draft({
      type: 'TWAP', priceSelection: 'BEST', quantity: 1_000_000, twapDuration: 60, twapInterval: 5,
    }), 0.1);
    expect(twapBest.pieces).toBe(1);
    expect(twapBest.refusalLead).toBe('');
    expect(twapBest.main.kind).toBe('market');
    expect(twapBest.refusal?.title).toBe('单笔市价单最多 200,000 KAITO，这一单 1,000,000 KAITO');
    const scaledBest = placementLotSize('KAITOUSDT', draft({
      type: 'SCALED', priceSelection: 'BEST', quantity: 3_000_000, scaledCount: 5, scaledStartPrice: 0.09, scaledEndPrice: 0.1,
    }), 0.1);
    expect(scaledBest.pieces).toBe(1);
    expect(scaledBest.main.kind).toBe('market');
    expect(scaledBest.refusal?.title).toBe('单笔市价单最多 200,000 KAITO，这一单 3,000,000 KAITO');
    expect(placementLotSize('KAITOUSDT', draft({ type: 'TWAP', priceSelection: 'BEST', quantity: 200_000 }), 0.1).refusal).toBeNull();
  });

  it('跟踪委托（合成币本位）按「激活价 × (1 − 回调幅度)」判：卖出方向触发成交价不会低于它', () => {
    const coin = (over: Partial<LotSizeDraft>) => draft({ settlementMode: 'coin', contracts: over.quantity, ...over });
    // 激活价 1.1、回调 1%：1.089 上 200,000 KAITO = 21,780 张；按激活价判是 22,000 张，触发在 1.09395 时会被拒
    const over = placementLotSize('KAITOUSDT', coin({ type: 'TRAILING_STOP', stopPrice: 1.1, callbackRate: 0.01, quantity: 22_000 }), 1.0905);
    expect(over.refusal?.title).toBe('单笔市价单最多 21,780 张，这一单 22,000 张');
    expect(over.main.maxUnits).toBe(21_780);
    expect(placementLotSize('KAITOUSDT', coin({ type: 'TRAILING_STOP', stopPrice: 1.1, callbackRate: 0.01, quantity: 21_780 }), 1.0905).refusal).toBeNull();
    // 没有激活价：按现价下方一个回调幅度（1.0905 × 0.99 = 1.079595 → 21,591 张）
    expect(placementLotSize('KAITOUSDT', coin({ type: 'TRAILING_STOP', stopPrice: 0, callbackRate: 0.01, quantity: 21_600 }), 1.0905).main.maxUnits).toBe(21_591);
    // U 本位的上限与价无关
    expect(placementLotSize('KAITOUSDT', draft({ type: 'TRAILING_STOP', stopPrice: 1.1, callbackRate: 0.05, quantity: 200_000 }), 1).refusal).toBeNull();
  });

  it('跟踪委托一律按市价上限判：引擎挂出去的跟踪委托都是市价执行（存下来的是 trailingExecType: MARKET），调用方传 LIMIT 也一样', () => {
    // handlePlaceOrder 把 PlaceOrderParams 整个传进来，里面带着调用方的 trailingExecType
    const asLimit = placementLotSize('KAITOUSDT', {
      ...draft({ type: 'TRAILING_STOP', stopPrice: 1.1, callbackRate: 0.01, quantity: 250_000 }),
      trailingExecType: 'LIMIT',
    } as LotSizeDraft, 1);
    expect(asLimit.main.kind).toBe('market');
    expect(asLimit.refusal?.title).toBe('单笔市价单最多 200,000 KAITO，这一单 250,000 KAITO');
    // 存下来的单与触发时的再判是同一个口径
    const stored = pending({ ...ORDER_LOT_SIZE_STAMP, type: 'TRAILING_STOP', trailingExecType: 'MARKET', quantity: 250_000 });
    expect(lotSizeRefusalAtExecution('KAITOUSDT', stored, 1)?.title).toBe(asLimit.refusal?.title);
  });

  it('限价按 LOT_SIZE；随单止盈止损成数不足 100% 时那一截按市价上限，100% 不受限', () => {
    const limit = (quantity: number, over: Partial<LotSizeDraft> = {}) => draft({ type: 'LIMIT', price: 0.9, quantity, ...over });
    expect(placementLotSize('KAITOUSDT', limit(250_000), 1).refusal).toBeNull();
    expect(placementLotSize('KAITOUSDT', limit(2_000_001), 1).refusal?.title).toBe('单笔限价单最多 2,000,000 KAITO，这一单 2,000,001 KAITO');
    const half = placementLotSize('KAITOUSDT', limit(1_000_000, { slTriggerPrice: 0.8, tpSlPercentage: 50 }), 1);
    expect(half.refusalLead).toBe('随单止损（50% 仓位）：');
    expect(half.refusal?.title).toBe('单笔市价单最多 200,000 KAITO，这一单 500,000 KAITO');
    expect(half.refusal?.detail).toContain('把成数调到 100%');
    expect(placementLotSize('KAITOUSDT', limit(1_000_000, { slTriggerPrice: 0.8, tpSlPercentage: 100 }), 1).refusal).toBeNull();
  });
});

describe('触发 / 执行时（lotSizeRefusalAtExecution）与委托列表的标记', () => {
  const stamped = (over: Partial<PendingOrder>) => pending({ ...ORDER_LOT_SIZE_STAMP, ...over });

  it('只判本次更新之后下的（带戳）、按市价成交的、不是「平掉整个仓位」的单', () => {
    const over = { quantity: 250_000 };
    expect(lotSizeRefusalAtExecution('KAITOUSDT', stamped(over), 1)?.title).toBe('单笔市价单最多 200,000 KAITO，这一单 250,000 KAITO');
    // 更新前挂出的：触发时不再判
    expect(lotSizeRefusalAtExecution('KAITOUSDT', pending(over), 1)).toBeNull();
    // 限价单：量与上限在下单时就定了
    expect(lotSizeRefusalAtExecution('KAITOUSDT', stamped({ ...over, type: 'LIMIT', price: 0.9 }), 1)).toBeNull();
    // 100% 的止盈止损：相当于 closePosition，不受限
    expect(lotSizeRefusalAtExecution('KAITOUSDT', stamped({ ...over, reduceOnly: true, reducePercentage: 100 }), 1)).toBeNull();
    // 按成数的止盈止损：照判
    expect(lotSizeRefusalAtExecution('KAITOUSDT', stamped({ ...over, reduceOnly: true, reducePercentage: 50 }), 1)).not.toBeNull();
  });

  it('合成币本位按这一刻的价折张：下单时按 1.0 放行的 20,000 张，在 0.95 上超限', () => {
    const order = stamped({ settlementMode: 'coin', contracts: 20_000, quantity: 20_000, contractSizeUsd: 10, stopPrice: 1.0 });
    expect(lotSizeRefusalAtExecution('KAITOUSDT', order, 1.0)).toBeNull();
    expect(lotSizeRefusalAtExecution('KAITOUSDT', order, 0.95)?.title).toBe('单笔市价单最多 19,000 张，这一单 20,000 张');
  });

  it('委托列表：条件单按触发价、TWAP 按每一片、跟踪委托未激活按激活价；标记上的字', () => {
    const coin = { settlementMode: 'coin' as const, contractSizeUsd: 10 };
    // 触发价 0.95 上 19,000 张：20,000 张到时会被拒
    const cond = stamped({ ...coin, contracts: 20_000, quantity: 20_000, stopPrice: 0.95 });
    expect(pendingLotSizeRisk('KAITOUSDT', cond, 1.1)?.maxUnits).toBe(19_000);
    expect(pendingLotSizeRisk('KAITOUSDT', { ...cond, stopPrice: 1.0 }, 1.1)).toBeNull();
    expect(pendingLotSizeRisk('KAITOUSDT', { ...cond, lotSizeRule: undefined }, 1.1)).toBeNull();
    expect(pendingLotSizeBadge(cond)).toBe('触发时将超单笔上限');

    const twap = stamped({
      type: 'TWAP', quantity: 4_400_000, twapTotalQty: 4_400_000, twapFilledQty: 0, twapInterval: 180_000,
      createdAt: 0, twapEndTime: 3_600_000, status: 'ACTIVE',
    });
    expect(twapOrderSliceUnits(twap)).toBe(220_000);
    expect(pendingLotSizeRisk('KAITOUSDT', twap, 0.1)?.units).toBe(220_000);
    expect(pendingLotSizeRisk('KAITOUSDT', twap, 0.1)?.title).toBe('单笔市价单最多 200,000 KAITO，这一片 220,000 KAITO');
    expect(pendingLotSizeBadge(twap)).toBe('执行时将超单笔上限');

    const trailing = stamped({ ...coin, type: 'TRAILING_STOP', contracts: 20_000, quantity: 20_000, stopPrice: 0.95, trailingActivated: false });
    expect(pendingLotSizeRisk('KAITOUSDT', trailing, 1.1)).not.toBeNull();
    // 已激活：按现价（1.1 上 22,000 张，放得下）
    expect(pendingLotSizeRisk('KAITOUSDT', { ...trailing, trailingActivated: true }, 1.1)).toBeNull();
  });

  it('跟踪委托的标记按「回调线」：未激活按激活价 × (1 − 回调幅度)，已激活卖出按峰值 × (1 − 回调幅度)、买入按谷底 × (1 + 回调幅度)', () => {
    const coin = { settlementMode: 'coin' as const, contractSizeUsd: 10 };
    const short = stamped({
      ...coin, type: 'TRAILING_STOP', side: 'SHORT', contracts: 22_000, quantity: 22_000, stopPrice: 1.1, callbackRate: 0.01,
      trailingActivated: false,
    });
    expect(trailingLotSizePrice(short, 1.0905)).toBeCloseTo(1.089, 12);
    // 按激活价 1.1 判是 22,000 张、放得下；真正的成交价不会高于回调线，下单前就该标出来
    expect(pendingLotSizeRisk('KAITOUSDT', short, 1.0905)?.title).toBe('单笔市价单最多 21,780 张，这一单 22,000 张');
    // 已激活、峰值 1.105：触发价 1.09395，一笔最多 21,879 张——标记与触发时的再判同一个结论
    const peaked = { ...short, trailingActivated: true, peakPrice: 1.105 };
    expect(trailingLotSizePrice(peaked, 1.105)).toBeCloseTo(1.09395, 12);
    const risk = pendingLotSizeRisk('KAITOUSDT', peaked, 1.105);
    expect(risk?.title).toBe('单笔市价单最多 21,879 张，这一单 22,000 张');
    expect(lotSizeRefusalAtExecution('KAITOUSDT', peaked, 1.105 * 0.99)?.title).toBe(risk?.title);
    // 买入方向：谷底 1.0 → 回调线 1.01（20,200 张）；谷底再低到 0.99 → 0.9999（19,998 张）
    const long = stamped({
      ...coin, type: 'TRAILING_STOP', side: 'LONG', contracts: 20_100, quantity: 20_100, stopPrice: 1.05, callbackRate: 0.01,
      trailingActivated: true, troughPrice: 1.0,
    });
    expect(trailingLotSizePrice(long, 1.0)).toBeCloseTo(1.01, 12);
    expect(pendingLotSizeRisk('KAITOUSDT', long, 1.0)).toBeNull();
    expect(pendingLotSizeRisk('KAITOUSDT', { ...long, troughPrice: 0.99 }, 0.99)?.maxUnits).toBe(19_998);
  });

  it('「挂得出去就不会在触发时被拒」只对有激活价的卖出跟踪委托成立：没有激活价的，峰值从挂出之后第一段行情算起，可能在触发时被拒', () => {
    const coin = { settlementMode: 'coin' as const, contractSizeUsd: 10 };
    const draft = (stopPrice: number, contracts: number): LotSizeDraft => ({
      type: 'TRAILING_STOP', side: 'SHORT', stopPrice, callbackRate: 0.01, quantity: contracts, contracts, ...coin,
    } as LotSizeDraft);
    const order = (stopPrice: number, contracts: number) => pending({
      ...ORDER_LOT_SIZE_STAMP, ...coin, type: 'TRAILING_STOP', side: 'SHORT', stopPrice, callbackRate: 0.01,
      quantity: contracts, contracts, trailingActivated: !(stopPrice > 0),
    });
    const fillOn = (activation: number, high: number, low: number) => stepTrailingStop({
      side: 'SHORT', callbackRate: 0.01, activationPrice: activation || null, state: initTrailingState(activation || null), high, low,
    }).triggerPrice;

    // 没有激活价：现价 1.0905 下单按 1.079595 判（21,591 张），21,547 张挂得出去
    expect(placementLotSize('KAITOUSDT', draft(0, 21_547), 1.0905).refusal).toBeNull();
    // 挂出之后第一段行情 1.066–1.080（在现价下方）：峰值从 1.080 起算，1.0692 触发——那里一笔最多 21,384 张，被拒
    const fill = fillOn(0, 1.08, 1.066)!;
    expect(fill).toBeCloseTo(1.0692, 12);
    expect(lotSizeRefusalAtExecution('KAITOUSDT', order(0, 21_547), fill)?.title).toBe('单笔市价单最多 21,384 张，这一单 21,547 张');

    // 有激活价 1.1：峰值从激活价起算，同样一段先冲到 1.1 再回落的行情，成交价不低于 1.089，挂得出去的 21,780 张不会被拒
    expect(placementLotSize('KAITOUSDT', draft(1.1, 21_780), 1.0905).refusal).toBeNull();
    const activatedFill = fillOn(1.1, 1.1, 1.05)!;
    expect(activatedFill).toBeGreaterThanOrEqual(1.089 - 1e-12);
    expect(lotSizeRefusalAtExecution('KAITOUSDT', order(1.1, 21_780), activatedFill)).toBeNull();
  });

  it('TWAP 切片：片数 = ⌊总时长 ÷ 间隔⌋，币本位每片取整张', () => {
    expect(twapSlicePlan({ totalQty: 1_000, durationMs: 3_600_000, intervalMs: 180_000, coin: false })).toEqual({ totalSlices: 20, sliceQty: 50 });
    expect(twapSlicePlan({ totalQty: 1_001, durationMs: 3_600_000, intervalMs: 180_000, coin: true })).toEqual({ totalSlices: 20, sliceQty: 50 });
    expect(twapSlicePlan({ totalQty: 5, durationMs: 3_600_000, intervalMs: 180_000, coin: true }).sliceQty).toBe(1);
  });
});

describe('持仓卡：市价平仓 / 按成数的止盈止损（cardCloseLotSize）', () => {
  it('一笔 300,000 KAITO：100% 超限，最多按 2/3 平；50% 放行', () => {
    const legs = [usdtPos(300_000)];
    const full = cardCloseLotSize('KAITOUSDT', legs, 1, 1);
    expect(full.ok).toBe(false);
    expect(full.refusal?.title).toBe('单笔市价单最多 200,000 KAITO，这一单 300,000 KAITO');
    expect(full.maxFraction).toBeCloseTo(2 / 3, 6);
    expect(full.maxFraction * 300_000).toBeLessThanOrEqual(200_000);
    expect(cardCloseLotSize('KAITOUSDT', legs, 0.5, 1).ok).toBe(true);
  });

  it('同一张卡上同一种结算方式的几笔合计成一笔市价单；U 本位与币本位各算各的', () => {
    const two = [usdtPos(150_000, { id: 'a' }), usdtPos(100_000, { id: 'b' })];
    expect(cardCloseLotSize('KAITOUSDT', two, 1, 1).refusal?.title).toBe('单笔市价单最多 200,000 KAITO，这一单 250,000 KAITO');
    const mixed = [usdtPos(150_000, { id: 'a' }), coinPos(15_000, { id: 'c' })];
    const verdict = cardCloseLotSize('KAITOUSDT', mixed, 1, 1);
    // U 本位 150,000 KAITO 放得下；合成币本位在 1.0 上 20,000 张，15,000 张也放得下
    expect(verdict.ok).toBe(true);
    expect(verdict.orders.map(o => [o.settlement, o.units])).toEqual([['usdt', 150_000], ['coin', 15_000]]);
    const tooMany = cardCloseLotSize('KAITOUSDT', [usdtPos(150_000, { id: 'a' }), coinPos(25_000, { id: 'c' })], 1, 1);
    expect(tooMany.refusal?.title).toBe('单笔市价单最多 20,000 张，这一单 25,000 张');
    // 合成币本位按现价折张：「按上限平」在 20,000 张前留 0.2% 余量 → ⌊20,000 × 0.998⌋ = 19,960 张
    expect(Math.floor(tooMany.maxFraction * 25_000 + 1e-6)).toBe(19_960);
  });

  it('止盈止损：100%（平掉整个仓位）不受限；成数不足 100% 按触发价判', () => {
    const legs = [coinPos(50_000)];
    expect(cardCloseLotSize('KAITOUSDT', legs, 1, 0.5, 'tpsl')).toMatchObject({ ok: true, maxFraction: 1 });
    // 50% = 25,000 张；触发价 1.2 上 24,000 张
    expect(cardCloseLotSize('KAITOUSDT', legs, 0.5, 1.2, 'tpsl').refusal?.title).toBe('单笔市价单最多 24,000 张，这一单 25,000 张');
    expect(cardCloseLotSize('KAITOUSDT', legs, 0.5, 1.3, 'tpsl').ok).toBe(true);
  });

  it('合成币本位的市价平仓按现价折张、现价每帧在变：「按上限平」的成数在上限前留 0.2% 余量（判定本身不留）', () => {
    const legs = [coinPos(163_578)];
    const verdict = cardCloseLotSize('KAITOUSDT', legs, 1, 1.0905);
    expect(verdict.refusal?.title).toBe('单笔市价单最多 21,810 张，这一单 163,578 张');
    // ⌊21,810 × 0.998⌋ = 21,766：跌 0.01%（1.0904 上 21,808 张）仍放得下
    expect(Math.floor(verdict.maxFraction * 163_578 + 1e-6)).toBe(21_766);
    expect(cardCloseLotSize('KAITOUSDT', legs, 21_766 / 163_578, 1.0904).ok).toBe(true);
    // 判定照旧按确切的上限：21,810 张本身放行
    expect(cardCloseLotSize('KAITOUSDT', legs, 21_810 / 163_578, 1.0905).ok).toBe(true);
    // 止盈止损钉在触发价上，不留余量
    const tpsl = cardCloseLotSize('KAITOUSDT', legs, 0.5, 1.0905, 'tpsl');
    expect(Math.floor(tpsl.maxFraction * 163_578 + 1e-6)).toBe(21_810);
  });

  it('仓位是上限的 100 多倍（CYPH 250,000，一笔最多 2,000）：也能按上限平，不被 1% 的下限卡死', () => {
    const legs = [usdtPos(250_000)];
    const verdict = cardCloseLotSize('CYPHUSDT', legs, 1, 1);
    expect(verdict.refusal?.title).toBe('单笔市价单最多 2,000 CYPH，这一单 250,000 CYPH');
    expect(verdict.maxFraction).toBeCloseTo(0.008, 9);
    // 填的是 1,500 就判 1,500（不再按 1% 的 2,500 判）
    const typed = cardCloseLotSize('CYPHUSDT', legs, 1_500 / 250_000, 1);
    expect(typed.ok).toBe(true);
    expect(typed.orders[0].units).toBeCloseTo(1_500, 6);
  });

  it('快照里查不到的合约：从不拦', () => {
    expect(cardCloseLotSize('NOTAREALCOINUSDT', [usdtPos(1e12)], 1, 1)).toMatchObject({ ok: true, maxFraction: 1 });
  });
});
