// 【用户要求】2026-11-02 持仓监测战役的「委托」里放进加仓所参考的支撑线 K（提前挂上的止损，与对冲空单作用一致）
import { expect, it } from 'vitest';
import { qualityAdditionStopOrder } from '../qualityAdditionStopOrder';
const fill = (at: number, K: number, guard?: number) => ({ at, price: K + 1, notional: 10, quantity: 1, scanFrom: 0, reading: 0, threshold: 0, direction: '>' as const, metric: 'x', label: 'x', barOpenTime: at, sizing: { support: K, previousSupport: K - 1, atr: 1, atrAt: at, coinsBefore: 1, realAverageBefore: 1, baseCoins: 1, mirrorCoins: 0, mirrorUsed: 0 }, ...(guard ? { structureEvidence: { guardCloses: guard } as never } : {}) });
const camp = (fills: ReturnType<typeof fill>[], closedAt: number | null, cause?: { kind: string; threshold: number }) => ({ closed_at: closedAt == null ? null : new Date(closedAt).toISOString(), comparison: { sellEvidence: { additionFills: fills, triggerCause: cause } } } as never);
it('marks each addition K as moved up by the next addition, triggered when the exit hit it, cancelled otherwise, pending while held', () => {
  const a = fill(1000, 10), b = fill(2000, 12), fills = [a, b];
  expect(qualityAdditionStopOrder({ quality_addition_fill: a } as never, camp(fills, 3000, { kind: 'addition-support', threshold: 12 }))).toMatchObject({ price: 10, placedAt: 1000, status: 'replaced', endedAt: 2000, label: '支撑线 K' });
  expect(qualityAdditionStopOrder({ quality_addition_fill: b } as never, camp(fills, 3000, { kind: 'addition-support', threshold: 12 }))).toMatchObject({ price: 12, status: 'triggered', endedAt: 3000 });
  expect(qualityAdditionStopOrder({ quality_addition_fill: b } as never, camp(fills, 3000, { kind: 'dynamic-drawdown', threshold: 30 }))).toMatchObject({ status: 'cancelled', endedAt: 3000 });
  expect(qualityAdditionStopOrder({ quality_addition_fill: b } as never, camp(fills, null))).toMatchObject({ status: 'pending', endedAt: null });
  expect(qualityAdditionStopOrder({ quality_addition_fill: fill(1000, 10, 2) } as never, camp([fill(1000, 10, 2)], null))).toMatchObject({ label: '防守线 K', detail: expect.stringContaining('2 根') });
  expect(qualityAdditionStopOrder({} as never, camp([], null))).toBeUndefined();
});
