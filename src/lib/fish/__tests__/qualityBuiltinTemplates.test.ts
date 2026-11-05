// 【用户要求】2026-11-04 内置模板「结构为底·强势进攻（RAVE×SAPIEN 融合）」：两场赢单的参数原样合成，按账号公式生成、能冻结版本、能保存
import { expect, it, vi } from 'vitest';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { BUILTIN_QUALITY_TEMPLATES, buildFusionTemplatePlan, buildFusionV2TemplatePlan, buildFusionV3TemplatePlan, buildFusionV4TemplatePlan, FUSION_ROUTER_THRESHOLD, FUSION_TEMPLATE_ID, FUSION_TEMPLATE_NAME, FUSION_V2_TEMPLATE_ID, FUSION_V2_TEMPLATE_NAME, FUSION_V3_TEMPLATE_ID, FUSION_V4_ATTACK_FROM_ROUND, FUSION_V4_TEMPLATE_ID, FUSION_V4_TEMPLATE_NAME } from '../qualityBuiltinTemplates';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import { qualityPlanFromTemplate, qualityPlanTemplateSummary } from '../qualityPlanTemplates';
import { evaluateQualityRouter, mergedRacePlan, QUALITY_ROUTER_FIRST_VERSION, QUALITY_ROUTER_RACE_FROM_VERSION, QUALITY_ROUTER_RACE_VERSION, raceSharedAddition } from '../qualityPlanRouter';
import type { QualityGroup } from '../quality';
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

// 【用户要求】2026-11-05 版本 2：与 v1 同一套参数，只把分流提前到第一次结构加仓成交时；进攻分支第 2–8 次＝RAVE 组合2 的第 2–8 次
it('v2 keeps every v1 setting and only moves the decision to the first structural addition', async () => {
  const v1 = buildFusionTemplatePlan(BUILTIN_FEATURES, 'a'), v2 = buildFusionV2TemplatePlan(BUILTIN_FEATURES, 'b', 'v2');
  const r = v2.router!, r1 = v1.router!;
  expect(v2.id).toBe('b'); expect(v2.label).toBe('v2'); expect(r.afterAdditions).toBe(1); expect(r.version).toBe(QUALITY_ROUTER_FIRST_VERSION); expect(r.threshold).toBe(FUSION_ROUTER_THRESHOLD);
  // 编号与标签之外逐位相同（买入过滤、否决等条目的随机编号剔除后比较）
  const noIds = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => k === 'id' || k === 'label' ? undefined : x));
  const shared = ({ addition, router, sellStages, ...rest }: QualityGroup) => ({ rest, sellStages });
  expect(noIds(shared(r.structure))).toEqual(noIds(shared(r1.structure))); expect(noIds(shared(r.attack))).toEqual(noIds(shared(r1.attack)));
  expect(noIds(r.structure.addition)).toEqual(noIds(r1.structure.addition));
  const a = r.attack.addition!.rounds!;
  expect(a).toHaveLength(8); expect(r.attack.addition!.maxRounds).toBe(8); expect(r.structure.addition!.maxRounds).toBe(7);
  expect(noIds(a[0])).toEqual(noIds(r.structure.addition!.rounds![0])); expect(a[0].source).toBe('structure');
  expect(a.slice(1).map(x => [x.source, x.condition?.metric, x.condition?.threshold, x.minGainPct, x.gainBasis, x.entryDistanceAtr, x.supportOffsetAtr]))
    .toEqual([[.75, 11, 2, 1.5], [.8, 12, 2, 1.5], [.85, 13, 2, 1.5], [.9, 14, 2, 1.5], [.9, 15, 3, 2], [.9, 10, 3, 2], [.9, 10, 3.5, 2.5]].map(([t, g, d, k]) => ['custom', 'state', t, g, 'average', d, k]));
  expect(noIds(a.slice(2))).toEqual(noIds(r1.attack.addition!.rounds!.slice(2)));
  for (const x of a) expect(x.entryVetoes).toEqual([{ kind: 'pullback', enabled: true, atr: 2.5, pct: 4, join: 'and' }]);
  expect(planVersionChanges(freezeQualityPlan(v2))).toEqual([]);
  expect(qualityPlanTemplateSummary(v2)).toBe(`第一次结构加仓 · 第一次已收盘 S > ${FUSION_ROUTER_THRESHOLD} 后走进攻，否则保持结构 · 一次选择 · 版本冻结`);
  expect(qualityPlanTemplateSummary(v1)).toBe(`前两次结构加仓 · 第二次已收盘 S > ${FUSION_ROUTER_THRESHOLD} 后走进攻，否则保持结构 · 一次选择 · 版本冻结`);
  // 第一次结构加仓成交时读已收盘 S：JELLYJELLY 2025-10-03 读数 0.956 → 进攻；SAPIEN 0.655 → 结构
  const first = (s: number) => ({ key: 'x', sampleId: 's', groupId: 'g', evaluatedAt: 1, status: 'closed' as const, additionFills: [{ at: 600000, conditions: [{ at: 600000, barOpenTime: 300000, metric: 'state', reading: s }] }] as never, pnl: 1 });
  for (const [reading, branch, calls] of [[.956, 'attack', 2], [.655, 'structure', 1]] as const) {
    const run = vi.fn(async () => first(reading));
    expect((await evaluateQualityRouter(r, run, p => p.id)).routeDecision?.branch).toBe(branch); expect(run).toHaveBeenCalledTimes(calls);
  }
  // 2026-11-06：v4 最新在前，v1 是 89 个信号上实际最好的路径排第二
  expect(BUILTIN_QUALITY_TEMPLATES.map(t => t.id)).toEqual([FUSION_V4_TEMPLATE_ID, FUSION_TEMPLATE_ID, FUSION_V3_TEMPLATE_ID, FUSION_V2_TEMPLATE_ID]);
  expect(BUILTIN_QUALITY_TEMPLATES[3].name).toBe(FUSION_V2_TEMPLATE_NAME);
  expect(buildFusionV2TemplatePlan(BUILTIN_FEATURES).label).toBe(FUSION_V2_TEMPLATE_NAME);
}, 60000);

// 【用户要求】2026-11-05 版本 3：每一次加仓前都分流——箱体与 S/T/K 同时等候、先满足者成交；v1 / v2 的输出不变
it('v3 races the SAPIEN box lane against the RAVE S/T/K lane every round and keeps v1 and v2 unchanged', async () => {
  const v1 = buildFusionTemplatePlan(BUILTIN_FEATURES, 'a'), v2 = buildFusionV2TemplatePlan(BUILTIN_FEATURES, 'b'), v3 = buildFusionV3TemplatePlan(BUILTIN_FEATURES, 'c', 'v3');
  const r = v3.router!;
  expect(v3.label).toBe('v3'); expect(r.afterAdditions).toBe(0); expect(r.version).toBe(QUALITY_ROUTER_RACE_VERSION); expect(r.threshold).toBe(FUSION_ROUTER_THRESHOLD);
  const noIds = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => k === 'id' || k === 'label' ? undefined : x));
  expect(v1.router!.attack.addition!.rounds!.slice(2).map(x => x.condition?.threshold)).toEqual([.8, .85, .9, .9, .9, .9]);
  expect(v2.router!.attack.addition!.rounds!.slice(1).map(x => x.condition?.threshold)).toEqual([.75, .8, .85, .9, .9, .9, .9]);
  expect(v1.router!.structure.addition!.maxRounds).toBe(7); expect(v2.router!.structure.addition!.maxRounds).toBe(7);
  const s = r.structure.addition!.rounds!, a = r.attack.addition!.rounds!;
  expect(s.map(x => [x.source, x.structure?.trigger, x.structure?.buffer])).toEqual([['raise', .1], ['confirm', .3], ['confirm', .5], ['raise', .7], ['raise', .9], ['raise', 1.1], ['raise', 1.3], ['raise', 1.5]].map(([t, b]) => ['structure', t, b]));
  expect(noIds(s.slice(0, 7))).toEqual(noIds(v1.router!.structure.addition!.rounds));
  expect(a.map(x => [x.source, x.condition?.metric, x.condition?.threshold, x.minGainPct, x.gainBasis, x.entryDistanceAtr, x.supportOffsetAtr]))
    .toEqual([[.85, 10, 2, 1.5], [.85, 11, 2, 1.5], [.85, 12, 2, 1.5], [.85, 13, 2, 1.5], [.9, 14, 2, 1.5], [.9, 15, 3, 2], [.9, 10, 3, 2], [.9, 10, 3.5, 2.5]].map(([t, g, d, k]) => ['custom', 'state', t, g, 'average', d, k]));
  for (const x of [...s, ...a]) expect(x.entryVetoes).toEqual([{ kind: 'pullback', enabled: true, atr: 2.5, pct: 4, join: 'and' }]);
  const shared = ({ addition, router, ...rest }: QualityGroup) => rest;
  expect(noIds(shared(r.attack))).toEqual(noIds(shared(r.structure))); expect(r.attack.sellStages).toHaveLength(1);
  expect(noIds(raceSharedAddition(r.attack.addition))).toEqual(noIds(raceSharedAddition(r.structure.addition)));
  const merged = mergedRacePlan(r);
  expect(merged.addition!.rounds).toEqual(s); expect(merged.addition!.alternativeRounds).toEqual(a); expect(merged.addition!.maxRounds).toBe(8);
  const run = vi.fn(async () => ({ key: 'x', sampleId: 's', groupId: 'g', evaluatedAt: 1, status: 'closed' as const, additionFills: [{ at: 1, lane: 'attack' }, { at: 2, lane: 'structure' }] as never, pnl: 1 }));
  const out = await evaluateQualityRouter(r, run, p => p.id);
  expect(run).toHaveBeenCalledTimes(1); expect((run.mock.calls[0] as unknown as [QualityGroup])[0].addition!.alternativeRounds).toEqual(a);
  expect(out.routeDecision).toEqual({ branch: 'race', threshold: FUSION_ROUTER_THRESHOLD });
  expect(planVersionChanges(freezeQualityPlan(v3))).toEqual([]);
  expect(qualityPlanTemplateSummary(v3)).toContain('每轮分流');
  expect(buildFusionV3TemplatePlan(BUILTIN_FEATURES).id).toMatch(/^sell-/);
}, 60000);

// 【用户要求】2026-11-06 版本 4「结构开局 · 进攻接力」：与 v3 同一套分支，只加闸门——前两次只走箱体，进攻分支从第 3 次起参与竞速；v3 不变
it('v4 is v3 with the attack lane gated until the third addition', async () => {
  const v3 = buildFusionV3TemplatePlan(BUILTIN_FEATURES, 'c'), v4 = buildFusionV4TemplatePlan(BUILTIN_FEATURES, 'd', 'v4');
  const r = v4.router!;
  expect(v4.label).toBe('v4'); expect(r.afterAdditions).toBe(0); expect(r.version).toBe(QUALITY_ROUTER_RACE_FROM_VERSION); expect(r.threshold).toBe(FUSION_ROUTER_THRESHOLD);
  expect(r.attackFromRound).toBe(FUSION_V4_ATTACK_FROM_ROUND); expect(FUSION_V4_ATTACK_FROM_ROUND).toBe(3);
  expect(v3.router!.attackFromRound).toBeUndefined(); expect(v3.router!.version).toBe(QUALITY_ROUTER_RACE_VERSION);
  const noIds = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => k === 'id' || k === 'label' ? undefined : x));
  expect(noIds(r.structure)).toEqual(noIds(v3.router!.structure)); expect(noIds(r.attack)).toEqual(noIds(v3.router!.attack));
  expect(r.structure.addition!.attackFromRound).toBeUndefined(); expect(v4.addition!.attackFromRound).toBeUndefined();
  const merged = mergedRacePlan(r);
  expect(merged.addition!.attackFromRound).toBe(3); expect(merged.addition!.alternativeRounds).toEqual(r.attack.addition!.rounds); expect(mergedRacePlan(v3.router!).addition!.attackFromRound).toBeUndefined();
  const run = vi.fn(async () => ({ key: 'x', sampleId: 's', groupId: 'g', evaluatedAt: 1, status: 'closed' as const, additionFills: [] as never, pnl: 1 }));
  const out = await evaluateQualityRouter(r, run, p => p.id);
  expect((run.mock.calls[0] as unknown as [QualityGroup])[0].addition!.attackFromRound).toBe(3); expect(out.routeDecision).toEqual({ branch: 'race', threshold: FUSION_ROUTER_THRESHOLD });
  const frozen = freezeQualityPlan(v4);
  expect(planVersionChanges(frozen)).toEqual([]);
  expect(frozen.frozenVersions!.find(e => e.key === 'router')!.version).toContain(QUALITY_ROUTER_RACE_FROM_VERSION);
  expect(frozen.frozenVersions!.find(e => e.key === 'router')!.summary).toContain('前 2 次只走结构分支，进攻分支从第 3 次加仓起参与竞速');
  expect(qualityPlanTemplateSummary(v4)).toContain('进攻从第 3 次起');
  const copy = qualityPlanFromTemplate({ id: 't', name: '存成模板', savedAt: 1, updatedAt: 1, plan: frozen }, 'e');
  expect(copy.router!.attackFromRound).toBe(3);
  expect(BUILTIN_QUALITY_TEMPLATES[0].name).toBe(FUSION_V4_TEMPLATE_NAME); expect(buildFusionV4TemplatePlan(BUILTIN_FEATURES).id).toMatch(/^sell-/);
}, 60000);
