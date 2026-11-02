// 【用户要求】2026-11-02 持仓监测加仓：支撑线下移时按减仓计算器减仓，X＝(S−K′)÷(T−K′)
import { describe, expect, it } from 'vitest';
import { additionIdentity, additionPosition, defaultQualityAddition, supportDropReduction, validateQualityAddition, type QualityAdditionFill, type QualityReductionFill } from '../qualityAddition';
import { qualityAdditionStopOrders } from '../qualityAdditionStopOrder';
import { qualityGeometricPosition } from '../qualityPresentation';
import { additionDraft, parseAdditionDraft } from '@/components/FishQualityAdditionEditor';

const fill = (at: number, price: number, quantity: number, K: number, coinsBefore: number): QualityAdditionFill => ({ at, price, quantity, notional: price * quantity, scanFrom: 0, reading: 0, threshold: 0, direction: '>', metric: 'x', label: 'x', barOpenTime: at,
  sizing: { support: K, previousSupport: K - 1, atr: 1, atrAt: at, coinsBefore, realAverageBefore: 1, baseCoins: quantity, mirrorCoins: 0, mirrorUsed: 0 } });
const cut = (at: number, price: number, fraction: number, held: number, cost: number, previousK: number, newK: number): QualityReductionFill => ({ at, price, fraction, quantity: fraction * held, costRemoved: fraction * cost, realizedPnl: fraction * held * price - fraction * cost,
  breakeven: 0, previousK, newK, previousSupport: previousK + 1, newSupport: newK + 1, atr: 1 });

describe('support-drop reduction (reduction calculator formula)', () => {
  it('sells X = (S − K′)/(T − K′) so hitting K′ afterwards breaks even for the whole trade', () => {
    // 持 10 枚、成本 1000、已落袋 50 → 保本价 95；新 K′=90，T=100 → X=0.5
    const p = { held: 10, cost: 1000, realized: 50 }, r = supportDropReduction(p, 100, 90, 80)!;
    expect(r.breakeven).toBeCloseTo(95); expect(r.fraction).toBeCloseTo(.5);
    const left = p.held * (1 - r.fraction), pnlAtK = p.realized + r.fraction * p.held * 100 - r.fraction * p.cost + left * 90 - p.cost * (1 - r.fraction);
    expect(pnlAtK).toBeCloseTo(0, 9);
  });
  it('only moves K when breakeven is already below K′, and refuses when T is too low or the cut exceeds the cap', () => {
    expect(supportDropReduction({ held: 10, cost: 800, realized: 0 }, 100, 90, 80)).toEqual({ fraction: 0, breakeven: 80 });
    expect(supportDropReduction({ held: 10, cost: 1000, realized: 0 }, 100, 90, 80)).toBeUndefined(); // S＝T，X＝1，无法保本
    expect(supportDropReduction({ held: 10, cost: 1000, realized: 50 }, 100, 90, 40)).toBeUndefined(); // 需减 50% > 上限 40%
    expect(supportDropReduction({ held: 10, cost: 1000, realized: 50 }, 90, 90, 80)).toBeUndefined();
  });
  it('books the reduction in position PnL, keeps totals equal to per-lot cash flow, and shrinks the geometric position', () => {
    const add = fill(2000, 120, 1, 110, .5), reduction = cut(3000, 115, .4, 1.5, 50 + 120, 110, 105);
    const pos = additionPosition(100, 100, 108, true, [add], { at: 1000, price: 110, fraction: .5 }, [reduction]);
    expect(pos.reductionPnl).toBeCloseTo(.4 * 1.5 * 115 - .4 * 170);
    // 现金流：卖出所得 − 投入
    const cash = .5 * 110 + .4 * 1.5 * 115 + .6 * 1.5 * 108 - (100 + 120);
    expect(pos.totalPnl).toBeCloseTo(cash, 9);
    const base = { status: 'closed' as const, entryPrice: 100, initialNotional: 100, mirrorFill: { at: 1000, price: 110, fraction: .5, atOpen: true, gainPct: 10 }, additionFills: [add], additionFill: add };
    expect(qualityGeometricPosition({ ...base, additionReductions: [reduction] } as never)! / qualityGeometricPosition(base as never)!).toBeCloseTo(.6);
  });
  it('shows the lowered K as a new stop order after the original one', () => {
    const add = fill(2000, 120, 1, 110, .5), r = cut(3000, 115, .4, 1.5, 170, 110, 105);
    const orders = qualityAdditionStopOrders({ quality_addition_fill: add } as never, { closed_at: new Date(4000).toISOString(), comparison: { sellEvidence: { additionFills: [add], additionReductions: [r], triggerCause: { kind: 'addition-support', threshold: 105 } } } } as never);
    expect(orders.map(o => [o.price, o.status, o.endedAt])).toEqual([[110, 'lowered', 3000], [105, 'triggered', 4000]]);
    expect(orders[1].label).toBe('支撑线 K′'); expect(orders[1].detail).toContain('减仓 40%');
  });
  it('is off by default, has its own run identity and validates its inputs; the editor round-trips it', () => {
    const rule = { ...defaultQualityAddition(), enabled: true };
    expect(rule.supportReduction).toBeUndefined();
    const on = { ...rule, supportReduction: { enabled: true, minDropAtr: .5, maxPct: 80 } };
    expect(JSON.stringify(additionIdentity(on))).not.toBe(JSON.stringify(additionIdentity(rule)));
    expect(JSON.stringify(additionIdentity({ ...on, supportReduction: { ...on.supportReduction, enabled: false } }))).toBe(JSON.stringify(additionIdentity(rule)));
    for (const bad of [{ minDropAtr: -1 }, { maxPct: 0 }, { maxPct: 101 }, { minDropAtr: NaN }]) expect(() => validateQualityAddition({ ...on, supportReduction: { ...on.supportReduction, ...bad } })).toThrow();
    const d = additionDraft(on as never); expect(d.supportReduction).toEqual({ enabled: true, minDropAtr: '0.5', maxPct: '80', exitEnabled: false, exitAfterDrops: '3' });
    expect(parseAdditionDraft({ ...d, supportReduction: { enabled: true, minDropAtr: '1', maxPct: '60' } }, []).supportReduction).toEqual({ enabled: true, minDropAtr: 1, maxPct: 60 });
    expect(parseAdditionDraft({ ...d, supportReduction: { enabled: false, minDropAtr: '1', maxPct: '60' } }, []).supportReduction).toBeUndefined();
  });
});

// 【用户要求】2026-11-02 K 连续下移 N 次（次数自设）即全仓卖出，加仓后重新计数
describe('exit after N consecutive K drops', () => {
  it('validates the count, adds its own identity and round-trips through the editor', () => {
    const on = { ...defaultQualityAddition(), enabled: true, supportReduction: { enabled: true, minDropAtr: .5, maxPct: 80 } };
    const exit = { ...on, supportReduction: { ...on.supportReduction, exitAfterDrops: 3 } };
    expect(JSON.stringify(additionIdentity(exit))).not.toBe(JSON.stringify(additionIdentity(on)));
    expect(JSON.stringify(additionIdentity(exit))).toContain('exit-after-support-drops-v1');
    for (const bad of [0, 2.5, 21]) expect(() => validateQualityAddition({ ...exit, supportReduction: { ...exit.supportReduction, exitAfterDrops: bad } })).toThrow('次数');
    const d = additionDraft(exit as never); expect(d.supportReduction).toMatchObject({ exitEnabled: true, exitAfterDrops: '3' });
    expect(parseAdditionDraft({ ...d, supportReduction: { ...d.supportReduction!, exitAfterDrops: '2' } }, []).supportReduction).toEqual({ enabled: true, minDropAtr: .5, maxPct: 80, exitAfterDrops: 2 });
    expect(parseAdditionDraft({ ...d, supportReduction: { ...d.supportReduction!, exitEnabled: false } }, []).supportReduction).toEqual({ enabled: true, minDropAtr: .5, maxPct: 80 });
  });
});
