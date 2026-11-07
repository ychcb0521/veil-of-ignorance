import { expect, it } from 'vitest';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { buildFusionTemplatePlan } from '../qualityBuiltinTemplates';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import { splitQualityBranches } from '../qualitySplitBranches';
import { newQualityStudy } from '../quality';
import { replaceQualitySellPlans } from '../qualitySellPlans';

it('detaches the saved branches, retaining mixed attack rounds, formulas, stops and every parameter through save', () => {
  const source = buildFusionTemplatePlan(BUILTIN_FEATURES, 'original');
  const attack = source.router!.attack;
  attack.addition!.rounds![5] = structuredClone(source.router!.structure.addition!.rounds![5]);
  attack.addition!.rounds![5].minGainPct = 2;
  attack.mirrorTakeProfit = { enabled: true, gainPct: 2.5, sellPct: 67 };
  source.router!.structure.mirrorTakeProfit = structuredClone(attack.mirrorTakeProfit);
  const frozen = freezeQualityPlan(source), before = structuredClone(frozen);
  const copies = splitQualityBranches(frozen, { structure: 'structure', attack: 'attack' });
  for (const [i, branch] of (['structure', 'attack'] as const).entries()) {
    const { id: _id, label: _label, frozenVersions: _versions, ...expected } = frozen.router![branch];
    const { id, label, frozenVersions, ...actual } = copies[i];
    expect(actual).toEqual(expected);
    expect(id).toBe(branch); expect(label).toContain(i ? '进攻型' : '结构型');
    expect(frozenVersions).toBeDefined(); expect(planVersionChanges(copies[i])).toEqual([]);
    expect(copies[i].router).toBeUndefined();
  }
  expect(copies[1].addition!.rounds![5]).toMatchObject({ source: 'structure', minGainPct: 2 });
  const study = replaceQualitySellPlans(newQualityStudy(), [frozen]);
  const saved = replaceQualitySellPlans(study, [frozen, ...copies]).sellPlans!;
  expect(saved[0]).toEqual(before);
  for (let i = 0; i < 2; i++) expect(saved[i + 1]).toEqual(copies[i]);
  copies[1].addition!.rounds![5].minGainPct = 99;
  expect(frozen).toEqual(before);
});

it('rejects version drift and duplicate IDs instead of silently upgrading the source', () => {
  const source = freezeQualityPlan(buildFusionTemplatePlan(BUILTIN_FEATURES, 'original'));
  expect(() => splitQualityBranches(source, { structure: 'original', attack: 'attack' })).toThrow('新编号');
  source.frozenVersions![0].version = 'unexpected-v99';
  expect(() => splitQualityBranches(source, { structure: 'structure', attack: 'attack' })).toThrow('冻结版本');
});

it('retains shared initialization and historical filters while keeping detached copies independent', () => {
  const source = buildFusionTemplatePlan(BUILTIN_FEATURES, 'original');
  source.initialization = 'turing-origin-v1'; source.buyFilters = [];
  const copies = splitQualityBranches(freezeQualityPlan(source), { structure: 's', attack: 'a' });
  for (const p of copies) {
    expect(p.initialization).toBe(source.initialization); expect(p.buyFilters).toEqual([]);
    expect(planVersionChanges(p)).toEqual([]);
  }
});
