import { expect, it } from 'vitest';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { makeQualitySellPlan } from '../qualitySellPlans';
import { makeQualityBuyFilter } from '../qualityFilters';
import { defaultStructureAddition } from '../qualityAdditionStructure';
import { prepareQualityRouterDraft } from '../qualityRouterDraft';
import { QUALITY_ROUTER_RACE_VERSION, QUALITY_ROUTER_VERSION, type QualityPlanRouter } from '../qualityPlanRouter';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import { newQualityStudy } from '../quality';
import { saveQualityPlanTemplate, qualityPlanFromTemplate } from '../qualityPlanTemplates';

const fixture = (): QualityPlanRouter => {
  const prerequisite = makeQualityBuyFilter('state:state', '>', .65, true, BUILTIN_FEATURES);
  const structure = { ...makeQualitySellPlan('state:state', '<', .5, BUILTIN_FEATURES, undefined, 'structure'),
    mirrorTakeProfit: { enabled: true, gainPct: 5, sellPct: 50 },
    addition: { enabled: true, source: 'structure' as const, stricterPct: 10, quantityMode: 'calculator' as const, maxRounds: 3, repeat: true,
      structure: defaultStructureAddition(), rounds: [0, 1, 2].map(() => ({ source: 'structure' as const, stricterPct: 10, structure: defaultStructureAddition(), prerequisites: [prerequisite] })) } };
  return { version: QUALITY_ROUTER_VERSION, afterAdditions: 2, threshold: .9, structure, attack: { ...structuredClone(structure), id: 'attack' } };
};
it('synchronizes changed shared settings and first two rounds, keeping the source immutable', () => {
  const old = fixture(), before = structuredClone(old), structure = structuredClone(old.structure);
  structure.mirrorTakeProfit!.sellPct = 23; structure.addition!.rounds![0].structure!.buffer = 1.25;
  const edited = prepareQualityRouterDraft(old, structure, old.attack, .8);
  expect(edited.attack.mirrorTakeProfit!.sellPct).toBe(23);
  expect(edited.attack.addition!.rounds![0].structure!.buffer).toBe(1.25);
  expect(old).toEqual(before);
  expect(planVersionChanges(freezeQualityPlan({ ...edited.structure, router: edited }))).toEqual([]);
});
it('preserves independent later rounds and can save, round-trip and instantiate the edited template', () => {
  const old = fixture(), attack = structuredClone(old.attack);
  attack.addition!.rounds![2].minGainPct = 12;
  const router = prepareQualityRouterDraft(old, old.structure, attack, .85);
  expect(router.structure.addition!.rounds![2].minGainPct).toBeUndefined();
  expect(router.attack.addition!.rounds![2].minGainPct).toBe(12);
  const plan = freezeQualityPlan({ ...old.structure, router });
  const study = saveQualityPlanTemplate(newQualityStudy(), plan, '编辑后的组合');
  const template = JSON.parse(JSON.stringify(study.planTemplates![0]));
  const copy = qualityPlanFromTemplate(template, 'copy');
  expect(copy.router!.threshold).toBe(.85); expect(planVersionChanges(copy)).toEqual([]);
  expect(copy.frozenVersions).not.toEqual(freezeQualityPlan({ ...old.structure, router: old }).frozenVersions);
});
it('rejects conflicting shared edits and invalid decision conditions before saving', () => {
  const old = fixture(), structure = structuredClone(old.structure), attack = structuredClone(old.attack);
  structure.mirrorTakeProfit!.sellPct = 23; attack.mirrorTakeProfit!.sellPct = 67;
  expect(() => prepareQualityRouterDraft(old, structure, attack, .9)).toThrow('公共设置');
  expect(() => prepareQualityRouterDraft(old, old.structure, old.attack, NaN)).toThrow('0 到 1');
  const missing = structuredClone(old.structure); missing.addition!.rounds![1].prerequisites = [];
  expect(() => prepareQualityRouterDraft(old, missing, old.attack, .9)).toThrow('状态 S');
});
it('leaves unchanged frozen branches untouched', () => {
  const old = fixture(); expect(prepareQualityRouterDraft(old, structuredClone(old.structure), structuredClone(old.attack), .9)).toBe(old);
});
it('preserves existing branch-specific protection when editing only a mirror setting', () => {
  const old = fixture(); old.structure.addition!.supportReduction = { enabled: true, minDropAtr: .1, maxPct: 80 };
  const structure = structuredClone(old.structure); structure.mirrorTakeProfit!.sellPct = 23;
  // A normalized calculator form may add a quantity which does not affect execution.
  const attack = structuredClone(old.attack); attack.addition!.quantity = 1;
  const edited = prepareQualityRouterDraft(old, structure, attack, .9);
  expect(edited.structure.addition!.supportReduction).toEqual(old.structure.addition!.supportReduction);
  expect(edited.attack.addition!.supportReduction).toBeUndefined();
  expect(edited.attack.mirrorTakeProfit!.sellPct).toBe(23);
});
it('does not copy unrelated protection while synchronizing a changed first-round setting', () => {
  const old = fixture(); old.structure.addition!.supportReduction = { enabled: true, minDropAtr: .1, maxPct: 80 };
  const structure = structuredClone(old.structure);
  structure.addition!.structure!.buffer = 1.25; structure.addition!.rounds![0].structure!.buffer = 1.25;
  const edited = prepareQualityRouterDraft(old, structure, old.attack, .9);
  expect(edited.attack.addition!.rounds![0].structure!.buffer).toBe(1.25);
  expect(edited.attack.addition!.supportReduction).toBeUndefined();
  expect(edited.structure.addition!.supportReduction).toEqual(old.structure.addition!.supportReduction);
});

// 【用户要求】2026-11-05 版本 3 每轮分流：各轮条件两边独立，其余设置同步；进攻分支各次状态 S 门槛不低于分支门槛
it('race mode keeps each branch\'s rounds, syncs every other setting, and enforces the attack S floor', () => {
  const old = fixture(), attack = structuredClone(old.attack);
  attack.addition!.rounds = attack.addition!.rounds!.map(() => ({ source: 'custom' as const, stricterPct: 10, condition: makeQualityBuyFilter('state:state', '>', .9, true, BUILTIN_FEATURES), minGainPct: 10, gainBasis: 'average' as const, entryDistanceAtr: 2, supportOffsetAtr: 1.5 }));
  Object.assign(attack.addition!, attack.addition!.rounds![0]);
  const race: QualityPlanRouter = { version: QUALITY_ROUTER_RACE_VERSION, afterAdditions: 0, threshold: .85, structure: old.structure, attack };
  const structure = structuredClone(race.structure); structure.mirrorTakeProfit!.sellPct = 23; structure.addition!.rounds![0].structure!.buffer = 1.25;
  const edited = prepareQualityRouterDraft(race, structure, race.attack, .85);
  expect(edited.afterAdditions).toBe(0); expect(edited.attack.mirrorTakeProfit!.sellPct).toBe(23);
  expect(edited.attack.addition!.rounds!.map(r => r.source)).toEqual(['custom', 'custom', 'custom']);
  expect(edited.structure.addition!.rounds![0].structure!.buffer).toBe(1.25); expect(edited.attack.addition!.rounds![0]).toEqual(race.attack.addition!.rounds![0]);
  expect(planVersionChanges(freezeQualityPlan({ ...edited.structure, router: edited }))).toEqual([]);
  expect(() => prepareQualityRouterDraft(race, race.structure, race.attack, .95)).toThrow('不低于分支门槛');
});
