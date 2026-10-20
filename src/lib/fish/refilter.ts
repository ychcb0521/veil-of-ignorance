/**
 * 捕捞完成后把阈值往严里调：用本轮留下的逐币读数当场重判，不用重扫。
 * 【用户要求】2026-10-20「捕捉运行完成之后，将区间值调大之后能更细致过滤，而不用再重新运行」。
 *
 * 为什么能做到逐位一致：阈值只出现在主条件「所选序列 方向 阈值/倍率」里。
 * 往严里调（> 调大、< 调小）时，严阈值下满足的根一定也满足宽阈值，所以：
 *   - 宽阈值下没命中（below / blocked / 读数不全 / 失败）的币，严阈值下也不会命中；
 *   - 命中或起点不明的币，留下可用区间（first..截止）的读数与「约束是否满足」，用新阈值重新跑同一个
 *     classifyFishProgram，起点、读数、轨迹、越线次数都与按新阈值重扫一模一样。
 * 往宽里调（> 调小、< 调大）会有原来没命中的币冒出来，做不到，只能重新捕捞。
 */
import { classifyFishProgram, type FishProgram, type FishValues } from './algorithm';
import { definitionKey } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishMemberResult } from './intersection';

/** 信号挂在哪家、哪个市场：与捕捞时写进信号的字段相同，重判出的信号照样落在原处。 */
export interface FishPlace { symbol: string; exchange: string; market?: string; underlying?: string; binanceSymbol?: string | null }
/**
 * 与阈值无关的逐币读数（只留命中 / 起点不明的币）：可用区间每根的读数和条件状态。
 * state：0 = 读数或约束不是有限数（条件不明），1 = 约束全满足，2 = 有约束不满足。
 */
export interface FishTail { length: number; from: number; t0: number; step: number; cutoffMs: number; average: Float64Array; state: Uint8Array; value: number; place: FishPlace }

/** 把交易所 / 市场写进信号（id、exchange、美股标的），捕捞与重判共用同一条规则。 */
export function placeFishSignal(signal: TradeSignal, place: FishPlace, algorithmKey: string): TradeSignal {
  if (place.market === 'us_stock') {
    signal.market = 'us_stock'; signal.underlying = place.underlying; signal.exchange = place.exchange as TradeSignal['exchange']; signal.binanceSymbol = null;
    signal.id = `fish-us-${place.exchange}-${place.underlying}-${signal.timeMs}-${encodeURIComponent(algorithmKey)}`;
  } else if (place.exchange !== 'binance') {
    signal.id = `fish-${place.exchange}-${place.symbol}-${signal.timeMs}-${encodeURIComponent(algorithmKey)}`;
    signal.exchange = place.exchange as TradeSignal['exchange']; signal.binanceSymbol = place.binanceSymbol ?? null;
  }
  return signal;
}

/** 截下这个币可用区间的读数（K 线不连续就不留，之后调阈值时这一轮按「需要重扫」处理）。 */
export function fishTail(bars: readonly ResearchBar[], r: FishValues, plan: FishProgram, cutoffMs: number, place: FishPlace): FishTail | undefined {
  const end = bars.length - 1, from = plan.warm - 1;
  if (end < from || !bars.length) return undefined;
  const t0 = bars[0].openTime;
  for (let i = from; i <= end; i++) if (bars[i].openTime !== t0 + i * plan.step) return undefined;
  const average = r.average.slice(from, end + 1), state = new Uint8Array(end - from + 1);
  for (let i = from; i <= end; i++) {
    const c = r.condition[i];
    state[i - from] = !Number.isFinite(c) ? 0 : c === 1 ? 1 : r.main[i] !== 0 ? 2 : r.constraints.every(x => x[i] !== 0) ? 1 : 2;
  }
  return { length: bars.length, from, t0, step: plan.step, cutoffMs, average, state, value: r.value[end], place };
}

/** 两套算法只差阈值、且 target 不比 base 宽：target 的结果能由 base 这一轮直接算出。 */
export function fishTightenable(base: FishProgram, target: FishProgram): boolean {
  if (!sameFamily(base, target)) return false;
  const d = base.settings.direction;
  return d === '>' ? target.settings.threshold >= base.settings.threshold : target.settings.threshold <= base.settings.threshold;
}
/** 只差阈值（同一特征值定义、统计量、方向、约束、倍率）。 */
export function sameFamily(base: FishProgram, target: FishProgram): boolean {
  return base.def.id === target.def.id && definitionKey(base.def) === definitionKey(target.def) && base.settings.statistic === target.settings.statistic
    && base.settings.direction === target.settings.direction && base.constraintKey === target.constraintKey && base.scale === target.scale && base.unit === target.unit;
}

/** 一个币在新阈值下的结论；需要的读数没留下来就返回 null。 */
export function tightenFishResult(result: FishMemberResult, target: FishProgram): FishMemberResult | null {
  if (result.outcome === 'blocked') {
    const t = target.settings.threshold / target.scale, a = result.reading;
    return a !== undefined && Number.isFinite(a) && !(target.settings.direction === '>' ? a > t : a < t) ? { outcome: 'below', reading: a } : result;
  }
  if (result.outcome !== 'hit' && result.outcome !== 'unknown') return result;
  const tail = result.tail;
  if (!tail) return null;
  const { length, from, t0, step } = tail, end = length - 1, t = target.settings.threshold / target.scale, above = target.settings.direction === '>';
  const average = new Float64Array(length).fill(NaN), main = new Float64Array(length).fill(NaN), condition = new Float64Array(length).fill(NaN), ok = new Float64Array(length).fill(NaN), value = new Float64Array(length).fill(NaN);
  average.set(tail.average, from); value[end] = tail.value;
  for (let i = from; i <= end; i++) {
    const a = average[i], s = tail.state[i - from];
    if (Number.isFinite(a)) main[i] = (above ? a > t : a < t) ? 1 : 0;
    if (s === 0) continue;
    ok[i] = s === 1 ? 1 : 0;
    condition[i] = s === 1 && main[i] === 1 ? 1 : 0;
  }
  const r: FishValues = { value, average, main, constraints: target.constraintNames.map(() => ok), condition };
  const bars = Array.from({ length }, (_, i) => ({ openTime: t0 + i * step })) as ResearchBar[];
  const next = classifyFishProgram(tail.place.symbol, bars, r, tail.cutoffMs, target);
  if (next.signal) placeFishSignal(next.signal, tail.place, target.algorithmKey);
  const out: FishMemberResult = { outcome: next.outcome, reading: result.reading };
  if (next.signal) out.signal = next.signal;
  if (next.snapshot) out.snapshot = next.snapshot;
  if (next.boundaryMs !== undefined) out.boundaryMs = next.boundaryMs;
  // 读数与阈值无关：留着，之后再调严（或调回本轮阈值）还能继续算
  if (next.outcome === 'hit' || next.outcome === 'unknown') out.tail = tail;
  return out;
}
