/**
 * Deep RSA · 第 5 步之后的稳健性检验（不改判定）。
 *
 * 【用户要求】2026-10-15「把你指出的 5 条稳健性检验加进去」（见 docs/deep-rsa/08-results-2026-10-15.md 第 6 节）。
 * 对测试集上检验过的每一项（表征 × 结果目标 × 冻结的 h），在发现期（训练 + 验证）与测试期各做一遍：
 *   ① 控制波动率：偏 Mantel，控制 RDM = |Δ vol_w|（同一个 h）——剔除后还剩多少；
 *   ② 只看战役时点：去掉随机背景，检验「战役 vs 背景混合」造出的相关；
 *   ③ 换目标：24h 期末收益（|Δ| 距离含波动幅度，显著不等于有方向）、24h 最大跌幅（阴性对照：也相关多半是波动率）；
 *   ④ 按标的分块置换：同一个币的事件只在币内互换，检验同币相关让 p 偏乐观；
 *   ⑤ 标签用全部时间段：正样本太少，把验证 / 测试期（含隔离带）的标签也放进来做描述（RSA ρ 与特征对比），不判定。
 * 标准化一律用训练集拟合的参数；置换次数与种子同主流程。原始 p 不做多重校正，只作解释。
 */
import { FEATURE_DEFINITIONS, type FeatureKey } from '@/lib/deepRsa/features';
import type { RunEvent } from '@/lib/deepRsa/pipeline';
import {
  absDiffRdm, euclideanRdm, fitStandardizer, rsaEvaluate, rsaPartialMantel, standardize, type RepresentationSpec, type RsaResult,
} from '@/lib/deepRsa/rsa';

export type RobustnessCheckId = 'volPartial' | 'campaignOnly' | 'endRet' | 'maxDown' | 'symbolBlocks';
export type RobustnessPeriod = 'discovery' | 'test';

export const ROBUSTNESS_CHECKS: readonly { id: RobustnessCheckId; title: string; question: string; pass: string; fail: string }[] = [
  { id: 'volPartial', title: '① 控制波动率', question: '剔除 |Δ 观察窗波动率| 之后，表征 ↔ 结果的相关还剩多少', pass: '剔除波动率后仍显著：不只是波动率', fail: '剔除波动率后不显著：主要由波动率解释' },
  { id: 'campaignOnly', title: '② 只看战役时点', question: '去掉随机背景时点，只在你的战役之间比较', pass: '只看战役仍显著：不是「战役 vs 背景」混合造出来的', fail: '只看战役不显著：可能主要来自战役与背景的差别' },
  // 2026-10-15 更正：|Δ 期末收益| 会混入波动幅度（波动大的事件期末收益天然分散），显著不等于有方向；方向看第 6 步的带符号 Spearman
  { id: 'endRet', title: '③ 换目标：24h 期末收益', question: '表征相似的时点，之后 24h 期末收益的差距是否也小（|Δ| 含波动幅度，不等于方向）', pass: '期末收益的差距也相似：含波动幅度，方向看第 6 步', fail: '期末收益的差距不相似：看不到方向信息' },
  { id: 'maxDown', title: '③ 阴性对照：24h 最大跌幅', question: '表征相似的时点，之后 24h 的最大跌幅是否也相似', pass: '阴性对照也显著：多半是在说波动大小', fail: '阴性对照不显著：不像是单纯的波动率' },
  { id: 'symbolBlocks', title: '④ 按标的分块置换', question: '置换只在同一个币内互换，扣掉同币事件之间的相关', pass: '按标的分块仍显著：不是同币相关造成的', fail: '按标的分块不显著：p 值主要被同币相关撑起来' },
];

export interface RobustnessCheckResult extends RsaResult {
  check: RobustnessCheckId;
  period: RobustnessPeriod;
  /** ④ 才有：所在币至少有 2 个事件、能在币内互换的事件数（太少时检验偏保守）。 */
  movable?: number;
}

export interface RobustnessRow {
  representation: string;
  target: 'outcome';
  halfLifeHours: number;
  checks: RobustnessCheckResult[];
}

export interface FeatureContrastRow {
  key: FeatureKey;
  posMean: number | null;
  ctlMean: number | null;
  /** 标准化均值差（正 − 对照，合并标准差）。只作描述，未检验。 */
  smd: number | null;
  nPos: number;
  nCtl: number;
}

export interface LabelsAllPeriods {
  rsa: { representation: string; halfLifeHours: number; rho: number; p: number; nEvents: number; nPos: number; nCtl: number }[];
  contrast: { halfLifeHours: number; rows: FeatureContrastRow[] };
}

export interface RobustnessResult {
  alpha: number;
  rows: RobustnessRow[];
  labelsAllPeriods: LabelsAllPeriods;
}

/** 标签目标在验证集上没选出 h 时（例如正样本太少），⑤ 用主分析的 h = 6。 */
export const LABELS_DEFAULT_H = 6;

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

/** 正 / 对照的特征均值与标准化均值差（只作描述，未检验）。第 3 步用训练集，稳健性 ⑤ 用全部时间段。 */
export function featureContrast(events: readonly RunEvent[], h: number): FeatureContrastRow[] {
  return FEATURE_DEFINITIONS.map(d => {
    const vals = (label: string) => events.filter(e => e.label === label)
      .map(e => e.featuresByH[h]?.[d.key]).filter((v): v is number => v != null && Number.isFinite(v));
    const pos = vals('positive');
    const ctl = vals('control');
    const mp = mean(pos);
    const mc = mean(ctl);
    let smd: number | null = null;
    if (mp != null && mc != null && pos.length > 1 && ctl.length > 1) {
      const vp = pos.reduce((s, v) => s + (v - mp) ** 2, 0) / (pos.length - 1);
      const vc = ctl.reduce((s, v) => s + (v - mc) ** 2, 0) / (ctl.length - 1);
      const pooled = Math.sqrt(((pos.length - 1) * vp + (ctl.length - 1) * vc) / (pos.length + ctl.length - 2));
      smd = pooled > 0 ? (mp - mc) / pooled : null;
    }
    return { key: d.key, posMean: mp, ctlMean: mc, smd, nPos: pos.length, nCtl: ctl.length };
  });
}

function movableCount(events: readonly RunEvent[]): number {
  const bySymbol = new Map<string, number>();
  for (const e of events) bySymbol.set(e.symbol, (bySymbol.get(e.symbol) ?? 0) + 1);
  return events.filter(e => (bySymbol.get(e.symbol) ?? 0) >= 2).length;
}

/** ① 偏 Mantel：控制 |Δ vol_w|（同一个 h）。 */
function volPartial(fit: readonly RunEvent[], evals: readonly RunEvent[], rep: RepresentationSpec, h: number, options: { permutations: number; seed: number }): RsaResult {
  const fitRows = fit.filter(e => e.outcome != null).map(e => e.featuresByH[h] ?? {});
  const std = fitStandardizer(fitRows, rep.keys);
  const use = evals.filter(e => e.outcome != null && Number.isFinite(e.featuresByH[h]?.vol_w ?? Number.NaN));
  const fRdm = euclideanRdm(standardize(use.map(e => e.featuresByH[h] ?? {}), std));
  const tRdm = absDiffRdm(use.map(e => e.outcome));
  const cRdm = absDiffRdm(use.map(e => e.featuresByH[h]?.vol_w ?? null));
  const blocks = use.some(e => e.block) ? use.map(e => e.block ?? '') : undefined;
  return rsaPartialMantel(fRdm, tRdm, cRdm, { ...options, blocks });
}

export interface RobustnessContext {
  /** 每做完一项检验调用一次（让出主线程、检查取消、报进度）。 */
  onStep?: (done: number, total: number) => Promise<void> | void;
}

export async function runRobustness(
  split: { train: RunEvent[]; val: RunEvent[]; test: RunEvent[]; embargoed?: RunEvent[] },
  tested: readonly { representation: string; target: 'label' | 'outcome'; halfLifeHours: number }[],
  representations: readonly RepresentationSpec[],
  labelHalfLife: (representation: string) => number | null,
  options: { permutations: number; seed: number; alpha: number },
  ctx: RobustnessContext = {},
): Promise<RobustnessResult> {
  const fit = split.train;
  const periods: { period: RobustnessPeriod; events: RunEvent[] }[] = [
    { period: 'discovery', events: [...split.train, ...split.val] },
    { period: 'test', events: split.test },
  ];
  const outcomeTested = tested.filter(t => t.target === 'outcome' && representations.some(r => r.name === t.representation));
  const total = outcomeTested.length * periods.length * ROBUSTNESS_CHECKS.length + representations.length;
  let step = 0;
  const opts = () => ({ permutations: options.permutations, seed: options.seed + 104729 * (step + 1) });
  const done = async () => { step += 1; await ctx.onStep?.(step, total); };
  const withOutcome = (events: readonly RunEvent[], key: 'endRet' | 'maxDown') => events.map(e => ({ ...e, outcome: e[key] }));
  const strip = ({ rho, p, nEvents, nPairs, permutations }: RsaResult): RsaResult => ({ rho, p, nEvents, nPairs, permutations });

  const rows: RobustnessRow[] = [];
  for (const t of outcomeTested) {
    const rep = representations.find(r => r.name === t.representation)!;
    const h = t.halfLifeHours;
    const checks: RobustnessCheckResult[] = [];
    for (const { period, events } of periods) {
      const run: Record<RobustnessCheckId, () => RsaResult> = {
        volPartial: () => volPartial(fit, events, rep, h, opts()),
        campaignOnly: () => rsaEvaluate(fit, events.filter(e => e.kind === 'event'), rep, h, 'outcome', opts()),
        endRet: () => rsaEvaluate(withOutcome(fit, 'endRet'), withOutcome(events, 'endRet'), rep, h, 'outcome', opts()),
        maxDown: () => rsaEvaluate(withOutcome(fit, 'maxDown'), withOutcome(events, 'maxDown'), rep, h, 'outcome', opts()),
        symbolBlocks: () => rsaEvaluate(fit, events.map(e => ({ ...e, block: e.symbol })), rep, h, 'outcome', opts()),
      };
      for (const c of ROBUSTNESS_CHECKS) {
        const extra = c.id === 'symbolBlocks' ? { movable: movableCount(events.filter(e => e.outcome != null)) } : {};
        checks.push({ check: c.id, period, ...strip(run[c.id]()), ...extra });
        await done();
      }
    }
    rows.push({ representation: t.representation, target: 'outcome', halfLifeHours: h, checks });
  }

  // ⑤ 标签用全部时间段（描述；标准化仍用训练集）。隔离带里的事件也放进来：这里不做样本外判定，正样本越多越好
  const all = [...split.train, ...split.val, ...split.test, ...(split.embargoed ?? [])];
  const nPos = all.filter(e => e.label === 'positive').length;
  const nCtl = all.filter(e => e.label === 'control').length;
  const rsa: LabelsAllPeriods['rsa'] = [];
  for (const rep of representations) {
    const h = labelHalfLife(rep.name) ?? LABELS_DEFAULT_H;
    const r = rsaEvaluate(fit, all, rep, h, 'label', opts());
    rsa.push({ representation: rep.name, halfLifeHours: h, rho: r.rho, p: r.p, nEvents: r.nEvents, nPos, nCtl });
    await done();
  }
  return {
    alpha: options.alpha, rows,
    labelsAllPeriods: { rsa, contrast: { halfLifeHours: LABELS_DEFAULT_H, rows: featureContrast(all, LABELS_DEFAULT_H) } },
  };
}
