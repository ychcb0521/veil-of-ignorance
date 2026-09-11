import { describe, expect, it } from 'vitest';
import { calcLiquidationPrice, calcUnrealizedPnl } from '@/types/trading';
import {
  evaluateIsolatedLiquidation,
  evaluateIsolatedLiquidationOnCandle,
  isolatedLiquidationSettlement,
  positionRiskSince,
  priceObservedWhilePositionOpen,
  nextExposure,
  priceObservedAfter,
  staleToleranceMs,
  stopLossVersusLiquidation,
  updateRiskFloors,
} from '@/lib/liquidationGuards';
import type { PendingOrder, Position } from '@/types/trading';

/**
 * 事故 NAORISUSDT 2025-09-13：两张 0.095 的 5 倍逐仓空单 07:26 触发，
 * 却被 07:07 尖顶附近的 0.158877 判了强平，记录的平仓时间 07:23 早于开仓。
 * 空单开出后价格一路跌到 0.0714，从未靠近强平价约 0.1136。
 */
const t = (hhmm: string) => Date.parse(`2025-09-13T${hhmm}:00+08:00`);
const MIN = 60_000;
const ENTRY = 0.0950272;
const NOTIONAL = 68_420;
const QTY = NOTIONAL / ENTRY;          // ≈ 720,004 枚
const MARGIN = NOTIONAL / 5;           // 13,684

const naorisShort = (over: Partial<Position> = {}): Position => ({
  id: 'hedge-3', side: 'SHORT', entryPrice: ENTRY, quantity: QTY, leverage: 5,
  marginMode: 'isolated', settlementMode: 'usdt', margin: MARGIN, isolatedMargin: MARGIN,
  openTime: t('07:26'),
  fills: [{ id: 'hedge-3', openTime: t('07:26'), entryPrice: ENTRY, units: QTY }],
  ...over,
} as Position);

describe('【回归】NAORIS：比仓位还早的价不得判它的生死', () => {
  it('那个 0.158877 确实足以打爆它——所以旧判据会当场强平', () => {
    const pos = naorisShort();
    const equity = MARGIN + calcUnrealizedPnl(pos, 0.158877);
    expect(equity).toBeLessThan(0);                     // 浮亏约 4.6 万，远超 1.37 万保证金
  });

  it('按旧口径它是「新鲜」的：900 倍下 16 分钟前的价仍在容忍度内', () => {
    expect(t('07:23') - t('07:07')).toBeLessThan(staleToleranceMs(900));
  });

  it('新判据拒绝：价格观察于 07:07，仓位 07:26 才形成', () => {
    const d = evaluateIsolatedLiquidation({
      symbol: 'NAORISUSDT', position: naorisShort(), price: 0.158877,
      priceAsOf: t('07:07'), nowSim: t('07:23'), toleranceMs: staleToleranceMs(900),
    });
    expect(d).toEqual({ liquidate: false, reason: 'price_before_open' });
  });

  it('仓位形成之后观察到的价照常判：真该爆的仍然会爆', () => {
    const d = evaluateIsolatedLiquidation({
      symbol: 'NAORISUSDT', position: naorisShort(), price: 0.12,
      priceAsOf: t('07:40'), nowSim: t('07:40'), toleranceMs: staleToleranceMs(900),
    });
    expect(d.liquidate).toBe(true);
  });
});

describe('逐根 K 线判定', () => {
  const liq = calcLiquidationPrice(naorisShort());

  it('强平价约 0.1136，空单开出后的 K 线从未靠近它', () => {
    expect(liq).toBeCloseTo(0.11365, 4);
    for (const [start, high, low, close] of [
      [t('07:27'), 0.1011, 0.0931, 0.0948],
      [t('07:35'), 0.0955, 0.0902, 0.0921],
      [t('07:50'), 0.0850, 0.0714, 0.0760],
    ] as const) {
      const d = evaluateIsolatedLiquidationOnCandle({
        symbol: 'NAORISUSDT', position: naorisShort(),
        candle: { high, low, close, startTime: start, endTime: start + MIN },
      });
      expect(d).toMatchObject({ liquidate: false, reason: 'solvent' });
    }
  });

  it('成交所在那根只认收盘：同一分钟里成交之前的尖刺不能算到这张单头上', () => {
    const d = evaluateIsolatedLiquidationOnCandle({
      symbol: 'NAORISUSDT', position: naorisShort(),
      // 07:26 这根：先冲到 0.16（成交之前），再砸穿 0.095 触发空单，收在 0.0948
      candle: { high: 0.16, low: 0.0931, close: 0.0948, startTime: t('07:26') - 1, endTime: t('07:27') },
    });
    expect(d).toMatchObject({ liquidate: false, reason: 'solvent' });
  });

  it('整根都在仓位成形之前的 K 线不参与判定', () => {
    const d = evaluateIsolatedLiquidationOnCandle({
      symbol: 'NAORISUSDT', position: naorisShort(),
      candle: { high: 0.1599, low: 0.15, close: 0.158877, startTime: t('07:07'), endTime: t('07:08') },
    });
    expect(d).toEqual({ liquidate: false, reason: 'candle_before_open' });
  });

  it('影线穿过强平价就爆，哪怕收盘收回来——旧判据只看收盘，看不见这根影线', () => {
    const d = evaluateIsolatedLiquidationOnCandle({
      symbol: 'NAORISUSDT', position: naorisShort(),
      candle: { high: 0.12, low: 0.098, close: 0.10, startTime: t('07:40'), endTime: t('07:41') },
    });
    expect(d.liquidate).toBe(true);
    if (d.liquidate) {
      expect(d.triggerPrice).toBe(0.12);                 // 空单看最高价
      expect(d.exitPrice).toBeCloseTo(liq, 9);           // 记账价是强平价，不是影线顶
    }
  });

  it('跳空越过强平价时，记账价收在这根的成交区间内', () => {
    const d = evaluateIsolatedLiquidationOnCandle({
      symbol: 'NAORISUSDT', position: naorisShort(),
      candle: { high: 0.14, low: 0.13, close: 0.135, startTime: t('07:40'), endTime: t('07:41') },
    });
    expect(d.liquidate).toBe(true);
    if (d.liquidate) expect(d.exitPrice).toBe(0.13);
  });

  it('多单看最低价', () => {
    const long = naorisShort({ side: 'LONG' });
    const longLiq = calcLiquidationPrice(long);
    const d = evaluateIsolatedLiquidationOnCandle({
      symbol: 'NAORISUSDT', position: long,
      candle: { high: 0.096, low: longLiq * 0.99, close: 0.095, startTime: t('07:40'), endTime: t('07:41') },
    });
    expect(d.liquidate).toBe(true);
    if (d.liquidate) expect(d.triggerPrice).toBeCloseTo(longLiq * 0.99, 12);
  });
});

describe('逐仓强平结算：亏掉的恰好是隔离保证金', () => {
  it('在强平价结算：净盈亏 = −保证金，剩余部分记为强平费', () => {
    const pos = naorisShort();
    const liq = calcLiquidationPrice(pos);
    const totals = isolatedLiquidationSettlement({ symbol: 'NAORISUSDT', position: pos, exitPrice: liq });
    expect(totals.netPnl).toBeCloseTo(-MARGIN, 9);
    expect(totals.feeUsd).toBeGreaterThan(0);
    // 毛亏损 + 费用 = 保证金，钱包与记录落在同一个数上
    expect(calcUnrealizedPnl(pos, liq) - totals.feeUsd).toBeCloseTo(-MARGIN, 6);
  });

  it('【回归】亏穿时仍只亏保证金——旧实现记亏 4.6 万，保证金却只有 1.37 万', () => {
    const pos = naorisShort();
    const totals = isolatedLiquidationSettlement({ symbol: 'NAORISUSDT', position: pos, exitPrice: 0.158877 });
    expect(totals.netPnl).toBeCloseTo(-MARGIN, 9);
    expect(calcUnrealizedPnl(pos, 0.158877)).toBeLessThan(-3 * MARGIN);   // 旧口径会记下的数
    expect(totals.feeUsd).toBeGreaterThan(0);                            // 平仓费照收，强平费为 0
    expect(totals.feeUsd).toBeLessThan(0.001 * NOTIONAL * 3);
  });
});

describe('「仓位何时形成」按播放方向与加仓计算', () => {
  it('合并仓位以最后一笔加仓为准：加仓之前的价描述的是另一个仓位', () => {
    const merged = naorisShort({
      openTime: t('07:26'),
      fills: [
        { id: 'hedge-3', openTime: t('07:26'), entryPrice: ENTRY, units: QTY / 2 },
        { id: 'add-1', openTime: t('07:40'), entryPrice: 0.09, units: QTY / 2 },
      ],
    });
    expect(positionRiskSince(merged)).toBe(t('07:40'));
    expect(priceObservedWhilePositionOpen(t('07:30'), merged)).toBe(false);
    expect(priceObservedWhilePositionOpen(t('07:41'), merged)).toBe(true);
  });

  it('倒放时「之后」是更早的真实时刻', () => {
    const pos = naorisShort();
    expect(priceObservedWhilePositionOpen(t('07:20'), pos, -1)).toBe(true);
    expect(priceObservedWhilePositionOpen(t('07:30'), pos, -1)).toBe(false);
  });

  it('没有开仓时刻的老仓位不加这道约束（向后兼容）', () => {
    const legacy = naorisShort({ openTime: undefined, fills: undefined });
    expect(positionRiskSince(legacy)).toBeNull();
    expect(priceObservedWhilePositionOpen(t('07:00'), legacy)).toBe(true);
  });
});

describe('成形中的那根：插值收盘是合成价，不是成交之后的价', () => {
  // 构造的例子（不是 NAORIS 的真实开盘价）。Index 按进度 p 揭示：
  //   高低点 open + (high|low − open)·min(1, 1.5p)，收盘 open + (close − open)·p
  const bar = { open: 0.155, high: 0.16, low: 0.0931, close: 0.0948 };
  const reveal = (p: number) => {
    const hl = Math.min(1, p * 1.5);
    const interpClose = bar.open + (bar.close - bar.open) * p;
    const rawHigh = bar.open + (bar.high - bar.open) * hl;
    const rawLow = bar.open + (bar.low - bar.open) * hl;
    return {
      interpClose,
      matchHigh: Math.max(bar.open, interpClose, rawHigh),
      matchLow: Math.min(bar.open, interpClose, rawLow),
    };
  };
  const start = t('07:26');
  const fillAt = start + 0.65 * MIN;
  const filledInBar = naorisShort({
    openTime: fillAt,
    fills: [{ id: 'hedge-3', openTime: fillAt, entryPrice: ENTRY, units: QTY }],
  });

  it('空单在进度 0.65 成交的那一刻，插值收盘已高于它的强平价', () => {
    const { interpClose, matchLow } = reveal(0.65);
    expect(matchLow).toBeLessThanOrEqual(0.095);                                   // 卖出止损已触发
    expect(interpClose).toBeGreaterThan(calcLiquidationPrice(naorisShort()));      // 收盘却在强平价之上
  });

  it('【回归】成交所在的成形 K 线不判；按「已收线」口径拿插值收盘去判就会误爆', () => {
    const r = reveal(0.66);
    const candle = { high: r.matchHigh, low: r.matchLow, close: r.interpClose, startTime: start, endTime: start + 0.66 * MIN };
    expect(evaluateIsolatedLiquidationOnCandle({ symbol: 'NAORISUSDT', position: filledInBar, candle }).liquidate).toBe(true);
    expect(evaluateIsolatedLiquidationOnCandle({
      symbol: 'NAORISUSDT', position: filledInBar, candle: { ...candle, settled: false },
    })).toEqual({ liquidate: false, reason: 'forming_candle_straddles_open' });
  });

  it('收线之后用真实收盘 0.0948 判：安然无恙', () => {
    const d = evaluateIsolatedLiquidationOnCandle({
      symbol: 'NAORISUSDT', position: filledInBar,
      candle: { ...bar, startTime: start, endTime: start + MIN, settled: true },
    });
    expect(d).toMatchObject({ liquidate: false, reason: 'solvent' });
  });

  it('仓位成形于更早的 K 线时，成形中的这根照常按已揭示的高低点判', () => {
    const d = evaluateIsolatedLiquidationOnCandle({
      symbol: 'NAORISUSDT', position: naorisShort(),
      candle: { high: 0.12, low: 0.098, close: 0.10, startTime: t('07:40'), endTime: t('07:40') + 30_000, settled: false },
    });
    expect(d.liquidate).toBe(true);
  });
});

describe('逐根判定的风险下限：记录的开仓时刻可能取自落后的界面时钟', () => {
  it('撮合成交按撮合时钟记录：下限就是它本身，精度不受影响', () => {
    const pos = naorisShort();                                   // since = 07:26
    const floors = updateRiskFloors(new Map(), [pos], t('07:25') + 30_000, t('07:26'));
    expect(floors.get(pos.id)?.floor).toBe(t('07:26'));
  });

  it('【回归】手动市价单记在落后的界面时钟上：成交所在那根里成交之前的尖刺不能算到它头上', () => {
    // 界面时钟落后：记录的开仓时刻 07:10，真实成交在 07:25 这根里、尖刺之后
    const lagged = naorisShort({
      openTime: t('07:10'),
      fills: [{ id: 'hedge-3', openTime: t('07:10'), entryPrice: ENTRY, units: QTY }],
    });
    const spikeBar = { high: 0.16, low: 0.0931, close: 0.0948, startTime: t('07:25'), endTime: t('07:26'), settled: true };
    // 直接信记录的时刻：07:25 这根整根被当成「成形之后」，尖顶 0.16 打爆空单
    expect(evaluateIsolatedLiquidationOnCandle({ symbol: 'NAORISUSDT', position: lagged, candle: spikeBar }).liquidate)
      .toBe(true);
    // 上一次判定停在 07:25:20，这副构成第一次出现在那之后
    const floors = updateRiskFloors(new Map(), [lagged], t('07:25') + 20_000, t('07:26'));
    const d = evaluateIsolatedLiquidationOnCandle({
      symbol: 'NAORISUSDT', position: lagged, candle: spikeBar, riskSince: floors.get(lagged.id)!.floor,
    });
    expect(d).toMatchObject({ liquidate: false, reason: 'solvent' });   // 这根只认收盘 0.0948
  });

  it('下限记下后不随时钟前进而改变；加仓（构成变了）才重取', () => {
    const pos = naorisShort();
    const first = updateRiskFloors(new Map(), [pos], t('07:25'), t('07:26'));
    const later = updateRiskFloors(first, [pos], t('07:40'), t('07:41'));
    expect(later.get(pos.id)).toBe(first.get(pos.id));
    const added = naorisShort({
      fills: [...(pos.fills ?? []), { id: 'add-1', openTime: t('07:30'), entryPrice: 0.09, units: QTY / 2 }],
    });
    // 加仓记在 07:30（落后的界面时钟），第一次被看到时判定已走到 07:41
    expect(updateRiskFloors(later, [added], t('07:41'), t('07:42')).get(pos.id)?.floor).toBe(t('07:41'));
  });

  it('第一次判定、或时钟倒退（跳时间、换方向）：没有可信的「上一次」，这一根整根跳过', () => {
    const pos = naorisShort();
    expect(updateRiskFloors(new Map(), [pos], undefined, t('08:00')).get(pos.id)?.floor).toBe(t('08:00'));
    expect(updateRiskFloors(new Map(), [pos], t('09:00'), t('08:00')).get(pos.id)?.floor).toBe(t('08:00'));
    const legacy = naorisShort({ openTime: undefined, fills: undefined });
    expect(updateRiskFloors(new Map(), [legacy], t('07:59'), t('08:00')).get(legacy.id)?.floor).toBe(t('07:59'));
  });

  it('已不在的仓位从表里清掉', () => {
    const pos = naorisShort();
    const floors = updateRiskFloors(new Map(), [pos], t('07:25'), t('07:26'));
    expect(updateRiskFloors(floors, [], t('07:26'), t('07:27')).size).toBe(0);
  });
});

describe('【复审】兜底判定：成交所在那一分钟的插值价不算', () => {
  const fillAt = t('07:26') + 38_773;
  const filled = naorisShort({ openTime: fillAt, fills: [{ id: 'hedge-3', openTime: fillAt, entryPrice: ENTRY, units: QTY }] });

  it('07:26:39 取到的规范价 0.11587 已高于强平价，但它是成交那一分钟里的插值——不判', () => {
    const d = evaluateIsolatedLiquidation({
      symbol: 'NAORISUSDT', position: filled, price: 0.11587,
      priceAsOf: t('07:26') + 39_000, nowSim: t('07:26') + 40_000, toleranceMs: staleToleranceMs(1),
    });
    expect(d).toEqual({ liquidate: false, reason: 'price_before_open' });
  });

  it('下一分钟起照常判', () => {
    const d = evaluateIsolatedLiquidation({
      symbol: 'NAORISUSDT', position: filled, price: 0.12,
      priceAsOf: t('07:27'), nowSim: t('07:27'), toleranceMs: staleToleranceMs(1),
    });
    expect(d.liquidate).toBe(true);
  });

  it('倒放：这一分钟整个早于成交才算', () => {
    expect(priceObservedAfter(t('07:25') + 30_000, fillAt, -1)).toBe(true);
    expect(priceObservedAfter(t('07:26') + 10_000, fillAt, -1)).toBe(false);
  });
});

describe('【复审】跳时间、换方向不得让仓位永久免死', () => {
  const tol = staleToleranceMs(1);   // 60 秒

  it('正常播放：起点就是仓位形成的时刻；界面时钟略落后也不重置', () => {
    expect(nextExposure(undefined, naorisShort(), t('07:26') - 20_000, 1, tol).start).toBe(t('07:26'));
  });

  it('带着仓位跳回更早的日期：起点改从此刻算，之后的价照常判；此后随时钟前进不再变', () => {
    const pos = naorisShort();
    const jumped = nextExposure(nextExposure(undefined, pos, t('07:30'), 1, tol), pos, t('05:00'), 1, tol);
    expect(jumped.start).toBe(t('05:00'));
    expect(priceObservedWhilePositionOpen(t('05:01'), pos, 1)).toBe(false);   // 只比时间戳：要等回到 07:26
    expect(priceObservedAfter(t('05:01'), jumped.start, 1)).toBe(true);
    expect(nextExposure(jumped, pos, t('05:10'), 1, tol).start).toBe(t('05:00'));
  });

  it('正放开仓后倒放：起点改从倒放开始的那一刻算', () => {
    const pos = naorisShort();
    const rev = nextExposure(nextExposure(undefined, pos, t('07:40'), 1, tol), pos, t('07:40'), -1, tol);
    expect(rev.start).toBe(t('07:40'));
    expect(priceObservedAfter(t('07:35'), rev.start, -1)).toBe(true);
  });

  it('高倍速下跳得近不重置：空窗是时钟走回开仓时刻的那一段，不超过 5 秒真实时间', () => {
    const e = nextExposure(undefined, naorisShort(), t('07:00'), 1, staleToleranceMs(3600));
    expect(e.start).toBe(t('07:26'));
    expect((t('07:26') - t('07:00')) / 3600).toBeLessThanOrEqual(5_000);
  });

  it('加仓（构成变了）重新取；老仓位没有开仓时刻则不加约束', () => {
    const pos = naorisShort();
    const before = nextExposure(undefined, pos, t('07:30'), 1, tol);
    const added = naorisShort({ fills: [...(pos.fills ?? []), { id: 'add-1', openTime: t('07:40'), entryPrice: 0.09, units: QTY / 2 }] });
    expect(nextExposure(before, added, t('07:41'), 1, tol).start).toBe(t('07:40'));
    expect(nextExposure(undefined, naorisShort({ openTime: undefined, fills: undefined }), t('07:00'), 1, tol))
      .toEqual({ since: null, start: null });
  });

  it('逐根判定的下限同样会重置；落后在容忍度内则不动', () => {
    const pos = naorisShort();
    const first = updateRiskFloors(new Map(), [pos], t('07:25'), t('07:26'), 60_000);
    expect(updateRiskFloors(first, [pos], t('07:27'), t('05:00'), 60_000).get(pos.id)?.floor).toBe(t('05:00'));
    expect(updateRiskFloors(new Map(), [pos], t('05:00'), t('05:01'), 60_000).get(pos.id)?.floor).toBe(t('05:01'));
    expect(updateRiskFloors(first, [pos], t('07:26'), t('07:25') + 30_000, 60_000).get(pos.id)).toBe(first.get(pos.id));
  });
});

describe('【复审】止损在强平价之外：强平排在撮合之前', () => {
  const sl = (over: Partial<PendingOrder>): PendingOrder => ({
    id: 'sl', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 0, quantity: 1, leverage: 5,
    marginMode: 'isolated', status: 'PENDING', createdAt: 0,
    reduceOnly: true, linkedPositionId: 'long-1', reduceKind: 'SL', triggerDirection: 'DOWN', operator: '<=', ...over,
  } as PendingOrder);
  const long = naorisShort({ id: 'long-1', side: 'LONG' });
  const liq = calcLiquidationPrice(long);
  const at = (p: number, over: Partial<PendingOrder> = {}) => sl({ price: p, stopPrice: p, ...over });

  it('多单：止损在强平价之上先触发；在强平价之下则价格到不了止损就先爆了', () => {
    expect(stopLossVersusLiquidation(long, [at(liq * 1.05)])).toBe('stop_first');
    expect(stopLossVersusLiquidation(long, [at(liq * 0.9)])).toBe('liquidation_first');
    expect(stopLossVersusLiquidation(long, [at(liq * 0.9), at(liq * 1.05, { id: 'sl2' })])).toBe('stop_first');
  });

  it('空单对称', () => {
    const short = naorisShort({ id: 's-1' });
    const sliq = calcLiquidationPrice(short);
    const up = (p: number) => at(p, { side: 'LONG', linkedPositionId: 's-1', triggerDirection: 'UP', operator: '>=' });
    expect(stopLossVersusLiquidation(short, [up(sliq * 0.98)])).toBe('stop_first');
    expect(stopLossVersusLiquidation(short, [up(sliq * 1.1)])).toBe('liquidation_first');
  });

  it('没有止损、止盈单、挂在别的仓位上的止损都不算', () => {
    expect(stopLossVersusLiquidation(long, [])).toBe('no_stop');
    expect(stopLossVersusLiquidation(long, [at(liq * 2, { reduceKind: 'TP' })])).toBe('no_stop');
    expect(stopLossVersusLiquidation(long, [at(liq * 0.9, { linkedPositionId: 'other' })])).toBe('no_stop');
  });
});
