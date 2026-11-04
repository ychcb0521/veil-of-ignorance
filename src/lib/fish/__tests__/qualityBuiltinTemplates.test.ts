// 【用户要求】2026-11-04 内置模板「结构为底·强势进攻（RAVE×SAPIEN 融合）」：两场赢单的参数原样合成，按账号公式生成、能冻结版本、能保存
import { expect, it, vi } from 'vitest';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { BUILTIN_QUALITY_TEMPLATES, buildFusionTemplatePlan, FUSION_ROUTER_THRESHOLD, FUSION_TEMPLATE_NAME } from '../qualityBuiltinTemplates';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import { qualityPlanFromTemplate, qualityPlanTemplateSummary } from '../qualityPlanTemplates';
import { evaluateQualityRouter } from '../qualityPlanRouter';
import { replaceQualitySellPlans } from '../qualitySellPlans';
import { newQualityStudy } from '../quality';

it('merges the SAPIEN box prefix, the RAVE attack rounds and the staged exits into one routed plan', () => {
  const plan = buildFusionTemplatePlan(BUILTIN_FEATURES, 'p1', '融合');
  const r = plan.router!;
  expect(plan.id).toBe('p1'); expect(plan.label).toBe('融合'); expect(r.afterAdditions).toBe(2); expect(r.threshold).toBe(FUSION_ROUTER_THRESHOLD);
  // 公共部分：CDA < 0.5 → 涨 5.1% 后状态 S < 0.5；镜像 5% 卖 0.01%；基础止损取 RAVE 的 5% / 15%
  for (const p of [plan, r.structure, r.attack]) {
    expect(p).toMatchObject({ metric: 'CDA', definitionSource: 'account', execution: 'intrabar-1m', vetoFill: 'stop', rule: { direction: '<', threshold: .5 },
      combo: { switchPct: 5.1, beforeLabel: 'CDA 原始值', after: { metric: 'state', rule: { direction: '<', threshold: .5 } } }, mirrorTakeProfit: { enabled: true, gainPct: 5, sellPct: .01 } });
    expect(p.holdingVetoes!.map(v => [v.kind, v.direction, v.threshold, v.enabled])).toEqual([['static-drawdown', '>=', 5, true], ['dynamic-drawdown', '>=', 15, true]]);
    // SAPIEN 的分阶段否决：第 2、3 次加仓后换上 15% 动态回撤 + 1 分钟 5% + 5 分钟 7%，峰值从阶段起算
    expect(p.vetoStages!.map(s => [s.afterAdditions, s.conditions.map(c => [c.kind, c.threshold])])).toEqual([2, 3].map(n => [n, [['dynamic-drawdown', 15], ['drop-1m', 5], ['drop-5m', 7]]]));
    expect([p.vetoStageMode, p.vetoPeakBasis]).toEqual(['overlay', 'stage']);
    expect(p.addition!.supportReduction).toEqual({ enabled: true, minDropAtr: .1, maxPct: 80, version: 2 });
  }
  const sRounds = r.structure.addition!.rounds!, aRounds = r.attack.addition!.rounds!;
  expect(r.structure.addition!.maxRounds).toBe(7); expect(r.attack.addition!.maxRounds).toBe(8);
  // 结构分支＝SAPIEN 5069 的 7 次箱体加仓
  expect(sRounds.map(x => [x.source, x.structure?.algorithm, x.structure?.trigger, x.structure?.kSource, x.structure?.buffer, x.structure?.versions?.box, x.minGainPct, x.prerequisites?.map(c => [c.metric, c.direction, c.threshold])]))
    .toEqual([['raise', .1], ['confirm', .3], ['confirm', .5], ['raise', .7], ['raise', .9], ['raise', 1.1], ['raise', 1.3]].map(([trigger, buffer]) => ['structure', 'dbl5', trigger, 'current', buffer, 'dbl-5-v2', 3, [['state', '>', .65]]]));
  expect(r.structure.sellStages).toMatchObject([{ afterAdditions: 3, metric: 'CDA', label: 'CDA 原始值', rule: { metric: 'CDA', direction: '<', threshold: .5 } }]);
  // 进攻分支：前两次与结构分支完全相同，第 3–8 次＝RAVE 组合2 的第 3–8 次（S/T/K、涨幅按持仓均价）
  expect(aRounds.slice(0, 2)).toEqual(sRounds.slice(0, 2));
  expect(aRounds.slice(2).map(x => [x.source, x.condition?.metric, x.condition?.threshold, x.minGainPct, x.gainBasis, x.entryDistanceAtr, x.supportOffsetAtr]))
    .toEqual([[.8, 12, 2, 1.5], [.85, 13, 2, 1.5], [.9, 14, 2, 1.5], [.9, 15, 3, 2], [.9, 10, 3, 2], [.9, 10, 3.5, 2.5]].map(([t, g, d, k]) => ['custom', 'state', t, g, 'average', d, k]));
  expect(r.attack.sellStages).toBeUndefined();
  // 两条分支每一次都带 SAPIEN 的冲高回落否决（RAVE 原来没有）
  for (const x of [...sRounds, ...aRounds]) expect(x.entryVetoes).toEqual([{ kind: 'pullback', enabled: true, atr: 2.5, pct: 4, join: 'and' }]);
  // 顶层与结构分支同形（条件分支方案的保存形状），分支编号各自独立
  expect(plan.addition).toEqual(r.structure.addition); expect(plan.sellStages).toEqual(r.structure.sellStages);
  expect(new Set([plan.id, r.structure.id, r.attack.id]).size).toBe(3);
  expect(qualityPlanTemplateSummary(plan)).toContain(`S > ${FUSION_ROUTER_THRESHOLD}`);
}, 60000);

it('freezes without version drift, survives the ordinary save path and template cloning', () => {
  const plan = buildFusionTemplatePlan(BUILTIN_FEATURES, 'p2');
  const frozen = freezeQualityPlan(plan);
  expect(planVersionChanges(frozen)).toEqual([]);
  expect(frozen.frozenVersions!.map(e => e.key)).toEqual(expect.arrayContaining(['router', 'structure:box-1', 'structure:sell-stages', 'attack:trigger-3', 'attack:veto-stages']));
  const study = replaceQualitySellPlans(newQualityStudy(1), [plan]);
  expect(study.sellPlans![0].router).toEqual(plan.router); expect(planVersionChanges(study.sellPlans![0])).toEqual([]);
  const copy = qualityPlanFromTemplate({ id: 't', name: '存成模板', savedAt: 1, updatedAt: 1, plan: frozen }, 'p3');
  expect(copy.router).toEqual(plan.router); expect(copy.id).toBe('p3');
  expect(BUILTIN_QUALITY_TEMPLATES.map(t => t.name)).toContain(FUSION_TEMPLATE_NAME);
  expect(buildFusionTemplatePlan(BUILTIN_FEATURES).id).toMatch(/^sell-/);
}, 60000);

it('routes a RAVE-like second addition to attack and a SAPIEN-like one to structure', async () => {
  const router = buildFusionTemplatePlan(BUILTIN_FEATURES, 'p4').router!;
  const fills = (s: number) => [{ at: 600000 }, { at: 1200000, conditions: [{ at: 1200000, barOpenTime: 900000, metric: 'state', reading: s }] }] as never;
  const result = (s: number) => ({ key: 'x', sampleId: 's', groupId: 'g', evaluatedAt: 1, status: 'closed' as const, additionFills: fills(s), pnl: 1 });
  // RAVE 第 2 次加仓时状态 S 0.955、SAPIEN 0.688
  for (const [reading, branch, calls] of [[.955, 'attack', 2], [.688, 'structure', 1], [.85, 'structure', 1]] as const) {
    const run = vi.fn(async () => result(reading));
    expect((await evaluateQualityRouter(router, run, p => p.id)).routeDecision?.branch).toBe(branch); expect(run).toHaveBeenCalledTimes(calls);
  }
}, 60000);

it('refuses to build when the account lacks the CDA or state formula', () => {
  expect(() => buildFusionTemplatePlan(BUILTIN_FEATURES.filter(d => d.id !== 'cda'))).toThrow('CDA');
  expect(() => buildFusionTemplatePlan(BUILTIN_FEATURES.filter(d => d.id !== 'state'))).toThrow('状态 S');
}, 60000);
