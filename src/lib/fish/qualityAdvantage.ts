/** Optional, versioned overlay. It never writes the sizing inputs or changes K. */
import type { ResearchBar } from '@/lib/deepRsa/window';
import { evaluateFishProgram, shortFishHash, type FishSnapshot } from './algorithm';
import { qualityMetricPlan, type QualityGroup } from './quality';
import { createStructureAdditionReader, validateStructureAddition, type StructureAdditionRule } from './qualityAdditionStructure';
import type { FishReconstructionLoader } from './reconstruction';
import type { TradeSignal } from '@/lib/signalLibrary';
import { validateFishBars } from './shared';

const MINUTE = 60_000, STEP = 5 * MINUTE;
export const QUALITY_ADVANTAGE_VERSION = 'addition-advantage-soft-exit-v1';
export interface QualityAdvantageRule {
  version: typeof QUALITY_ADVANTAGE_VERSION;
  state: { snapshot: FishSnapshot; metric: string };
  structure: StructureAdditionRule;
  screenWeak: boolean;
  beforeFirst: boolean;
  afterAddition: boolean;
  confirmations: 1 | 2;
}
export interface QualityAdvantageObservation {
  at: number;
  grade: 'A' | 'B' | 'W' | 'U';
  structureValid?: boolean;
  closes?: number[];
  states?: number[];
  reason?: string;
}
export interface QualityAdvantageState {
  at: number; seller: string; count: number; required: number;
  observation: QualityAdvantageObservation;
}
export type QualityAdvantageOptions = Pick<QualityAdvantageRule, 'screenWeak' | 'beforeFirst' | 'afterAddition' | 'confirmations'>;
export function withQualityAdvantageOptions(plan: QualityGroup, options?: QualityAdvantageOptions): QualityGroup {
  if (!options || !plan.advantage) return plan;
  return { ...plan, advantage: { ...plan.advantage, ...options }, ...(plan.router ? { router: { ...plan.router,
    structure: withQualityAdvantageOptions(plan.router.structure, options), attack: withQualityAdvantageOptions(plan.router.attack, options) } } : {}) };
}
const canonical = (value: unknown) => JSON.stringify(value, (_k, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const qualityAdvantageIdentity = (g: Pick<QualityGroup, 'advantage'>) => g.advantage
  ? [QUALITY_ADVANTAGE_VERSION, JSON.parse(canonical(g.advantage))] : null;
export const qualityAdvantageFingerprint = (g: Pick<QualityGroup, 'advantage'>) => shortFishHash(canonical(qualityAdvantageIdentity(g)));

export function validateQualityAdvantage(g: QualityGroup): void {
  if (g.router) { validateQualityAdvantage(g.router.structure); validateQualityAdvantage(g.router.attack); }
  const r = g.advantage;
  if (!r) return;
  if (g.engine || g.execution !== 'intrabar-1m' || !g.addition?.enabled || g.addition.quantityMode !== 'calculator')
    throw Error('优势筛选模板须沿用当前引擎、1 分钟复原卖出与平衡公式加仓的原方案');
  if (r.version !== QUALITY_ADVANTAGE_VERSION) throw Error('优势筛选与退出灵敏度版本不可用');
  if (![1, 2].includes(r.confirmations) || [r.screenWeak, r.beforeFirst, r.afterAddition].some(v => typeof v !== 'boolean'))
    throw Error('优势筛选开关或软退出确认次数无效');
  if (!r.state?.snapshot?.definitionKey || r.state.metric !== 'state' || r.state.snapshot.interval !== '5m')
    throw Error('优势筛选须保留原方案已冻结的 5 分钟状态 S 公式');
  validateStructureAddition(r.structure);
  if (r.structure.algorithm !== 'dbl5') throw Error('优势分级须使用原方案的 DBL-5 结构');
}

/** Three adjacent CLOSED bars; the last item's timestamp is its close time. */
export function classifyQualityAdvantage(at: number, bars: readonly ResearchBar[], states: readonly number[], structureValid?: boolean): QualityAdvantageObservation {
  const last = bars.slice(-3), s = states.slice(-3), cut = Math.floor(at / STEP) * STEP;
  if (last.length !== 3 || s.length !== 3 || last.some((b, i) => b.openTime + STEP !== cut - (2 - i) * STEP ||
    ![b.close, b.high].every(Number.isFinite) || b.close <= 0 || b.high < b.close) || s.some(v => !Number.isFinite(v) || v < 0 || v > 1))
    return { at: cut, grade: 'U', reason: '辅助 5 分钟序列缺失或不连续，沿用原加仓与单次软退出' };
  const closes = last.map(b => b.close);
  const weak = closes[2] < closes[1] && closes[1] < closes[0] && s[2] < s[1] && s[1] < s[0];
  // W needs only price/state. An unknown structure must never disable a known W veto.
  const grade = weak ? 'W' : structureValid == null ? 'U' : structureValid && s[2] >= s[1] && closes[2] > Math.max(last[0].high, last[1].high) ? 'A' : 'B';
  return { at: cut, grade, structureValid, closes, states: s, ...(grade === 'U' ? { reason: 'DBL-5 辅助结构不可用，沿用原规则' } : {}) };
}

/** Every request only loads data closed by its own decision time. Stable entry-relative seed. */
export function createQualityAdvantageReader(rule: QualityAdvantageRule, o: { row: TradeSignal; entry: number; end: number; load: FishReconstructionLoader; signal: AbortSignal }) {
  const { plan, scale } = qualityMetricPlan(rule.state.snapshot, rule.state.metric);
  const structure = createStructureAdditionReader(o);
  let cursor = Math.floor(o.entry / STEP) * STEP - (plan.warm + 3) * STEP;
  const history: ResearchBar[] = [];
  const observations = new Map<number, QualityAdvantageObservation>();
  return async (at: number): Promise<QualityAdvantageObservation> => {
    const cut = Math.floor(at / STEP) * STEP;
    const cached = observations.get(cut); if (cached) return cached;
    if (o.signal.aborted) throw new DOMException('已暂停', 'AbortError');
    let result: QualityAdvantageObservation;
    try {
      if (plan.step !== STEP || cursor < 0) throw Error('状态 S 辅助历史不足');
      while (cursor < cut) {
        const to = Math.min(cut, cursor + 500 * STEP), bars = await o.load(o.row, cursor, to, plan, o.signal);
        validateFishBars(bars, to, (to - cursor) / STEP, STEP);
        history.push(...bars); cursor = to;
      }
      const visible = history.filter(b => b.openTime + STEP <= cut);
      const values = evaluateFishProgram(visible, plan).average;
      let valid: boolean | undefined;
      try {
        // Establish the native reader without treating any event as an addition.
        await structure(rule.structure, cut, cut, []);
        const latest = (await structure.supports(rule.structure, cut)).at(-1);
        if (latest?.at === cut) valid = latest.support != null && latest.support > 0;
      } catch (error) { if (o.signal.aborted) throw error; }
      result = classifyQualityAdvantage(at, visible, [...values].map(v => v * scale), valid);
    } catch (error) {
      if (o.signal.aborted) throw error;
      result = { at: cut, grade: 'U', reason: error instanceof Error ? error.message : '辅助读数缺失' };
    }
    observations.set(cut, result); return result;
  };
}

export function requiredSoftConfirmations(rule: QualityAdvantageRule, added: number, observation: QualityAdvantageObservation): number {
  if (observation.grade === 'U' || observation.grade === 'W') return 1;
  return added === 0 ? rule.beforeFirst && observation.structureValid ? rule.confirmations : 1
    : rule.afterAddition && observation.grade === 'A' ? rule.confirmations : 1;
}
/** A gap, false reading, or a change of seller resets the streak. An addition alone does not. */
export function advanceQualitySoftConfirmation(previous: QualityAdvantageState | undefined, at: number, seller: string, met: boolean, required: number, observation: QualityAdvantageObservation): QualityAdvantageState {
  const same = previous?.seller === seller;
  const count = !met ? 0 : same && previous.at === at ? previous.count : same && previous.at === at - MINUTE ? Math.min(2, previous.count + 1) : 1;
  return { at, seller, count, required, observation };
}

export const QUALITY_ADVANTAGE_EXPLANATION = [
  '加仓筛选：最近三根完整 5 分钟线，收盘价连续两次下降且状态 S 连续两次下降（W），跳过这一次机会。拒绝不计成功轮次、不消耗镜像余额；下一次仍按原时机判断。普通 B 级也允许加仓。',
  '首次加仓前：DBL-5 有效且非 W 时，原软卖出条件需连续两根已完成 1 分钟读数确认。加仓后：DBL-5 有效、S 不下降且收盘突破前两根最高价（A）时用两根；其余用原单次。每根完整 5 分钟线重新分级。',
  '硬退出：原 K、回撤止损、急跌止损及支撑下移减仓保持原规则。只改变软退出确认，指标与阶段切换后不跨阶段累计。辅助缺失回退原规则并留记录。',
  '依据：A 表 23 笔已分类算法退出中 10 笔标记为卖后 6 小时误报，均未加仓；LISTA、VIRTUAL 有轻微越过 0.5 后上涨的案例。RAVE 最后加仓后 1 分钟退出，说明放大后需及时重评。这些仅支持研究方向，两根确认与 W 筛选尚未证明提高收益。',
  '净利润回吐保护暂不启用：现有回放没有完整手续费、滑点和资金费，不能把毛利润冒充净利润。先分别对照筛选、首加前确认和加仓后确认，追踪 SAPIEN/RAVE 等放大赢家是否被误伤。',
] as const;
