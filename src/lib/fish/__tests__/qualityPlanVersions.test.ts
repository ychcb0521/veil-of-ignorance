// 【用户要求】2026-11-02 「持仓监测」模板涉及的所有算法都做版本保护：保存时冻结版本清单，版本对不上就拒绝运行 / 新建
import { describe, expect, it } from 'vitest';
import { backfillPlanVersions, comparePlanVersions, freezeQualityPlan, freezeSavedPlans, planVersionChanges, qualityPlanVersions, refreezeSyncedFormulas, versionTags } from '../qualityPlanVersions';
import { qualityPlanFromTemplate, saveQualityPlanTemplate } from '../qualityPlanTemplates';
import { newQualityStudy, type QualityGroup } from '../quality';
import { defaultStructureAddition } from '../qualityAdditionStructure';
const snap = (key: string) => ({ featureId: 'state', featureShort: '状态', definitionKey: key, statistic: 'raw', interval: '5m', scale: 1, threshold: 0, direction: '<', average: 0, cbi2: 0, startAverage: 0, previousAverage: 0, cutoffMs: 0 }) as unknown as QualityGroup['snapshot'];
const structure = { ...defaultStructureAddition('dbl5'), kSource: 'current' as const, buffer: .1 };
const plan = { id: 'p1', label: '组合算法1', metric: 'state', snapshot: snap('formula-A'), execution: 'intrabar-1m', definitionSource: 'account', vetoFill: 'stop',
  rule: { metric: 'state', direction: '<', threshold: .5 }, mirrorTakeProfit: { enabled: true, gainPct: 2.5, sellPct: 67 },
  addition: { enabled: true, source: 'structure', structure, stricterPct: 10, quantityMode: 'calculator', maxRounds: 2, minGainPct: 3, rounds: [{ source: 'structure', structure, stricterPct: 10, minGainPct: 3 }, { source: 'structure', structure: { ...structure, kSource: 'guard' as const }, stricterPct: 10 }] },
  holdingVetoes: [{ id: 'v', label: '持仓过程静态最大回撤', kind: 'static-drawdown', direction: '>=', threshold: 5, enabled: true }],
  vetoStages: [{ afterAdditions: 2, conditions: [{ id: 'c', label: '1分钟内跌幅', kind: 'drop-1m', direction: '>=', threshold: 5, enabled: true }] }], vetoStageMode: 'overlay' } as unknown as QualityGroup;

describe('plan version manifest', () => {
  it('freezes independent history scope without rewriting the old template manifest',()=>{
    const saved=freezeQualityPlan(plan),before=structuredClone(saved),wide=freezeQualityPlan({...saved,addition:{...saved.addition!,entryVetoes:[{kind:'pullback',enabled:true,pct:10,historyHours:6}]}});
    expect(wide.frozenVersions!.find(v=>v.key==='veto-history')?.version).toContain('addition-veto-history-v1');expect(planVersionChanges(wide)).toEqual([]);
    const changed=structuredClone(wide);changed.addition!.entryVetoes![0].historyHours=12;expect(planVersionChanges(changed).some(c=>c.key==='veto-history')).toBe(true);
    expect(planVersionChanges(saved)).toEqual([]);expect(saved).toEqual(before);
  });
  it('versions the lower-wick algorithm only when enabled, preserves old manifests and rejects changed lower-wick parameters',()=>{
    const saved=freezeQualityPlan(plan),before=structuredClone(saved),withOff={...saved,addition:{...saved.addition!,entryVetoes:[{kind:'lower-wick' as const,enabled:false}]}};
    expect(qualityPlanVersions(withOff)).toEqual(saved.frozenVersions);expect(planVersionChanges(saved)).toEqual([]);
    const next=freezeQualityPlan({...saved,addition:{...saved.addition!,rounds:saved.addition!.rounds!.map((r,i)=>i===0?{...r,entryVetoes:[{kind:'lower-wick',enabled:true,lookbackBars:12,atr:1.5,ratio:60}]}:r)}});
    expect(next.frozenVersions!.find(v=>v.key==='lower-wick-veto')?.version).toContain('addition-lower-wick-v1');expect(planVersionChanges(next)).toEqual([]);
    const changed=structuredClone(next);changed.addition!.rounds![0].entryVetoes![0].ratio=70;
    expect(planVersionChanges(changed).some(c=>c.key==='lower-wick-veto')).toBe(true);expect(saved).toEqual(before);
  });
  it('lists every algorithm with engine versions and formula fingerprints', () => {
    const v = qualityPlanVersions(plan), by = Object.fromEntries(v.map(e => [e.key, e]));
    expect(v.map(e => e.key)).toEqual(['sell', 'execution', 'mirror', 'hard-stop', 'addition', 'box-1', 'box-2', 'veto-stages', 'hard-stop-params']);
    expect(by.sell.version).toMatch(/^公式 #/); expect(by.execution.version).toBe('intrabar-1m-v1'); expect(by.mirror.version).toBe('mirror-limit-v1');
    expect(by['hard-stop'].version).toBe('holding-veto-v3');
    expect(by.addition.version).toContain('holding-add-after-half-2atr-balance-v3');
    expect(by['box-1']).toMatchObject({ name: expect.stringContaining('DBL-5 v2'), version: expect.stringContaining('dbl-5-v2') });
    expect(by['box-2'].name).toContain('防守线 v1'); expect(by['box-2'].version).toContain('dbl5-guard-v1');
    expect(versionTags(['x', ['holding-veto-v3', 1, ['k-from-current-box-v2']], 'holding-veto-v3'])).toEqual(['holding-veto-v3', 'k-from-current-box-v2']);
  });
  // 【用户要求】2026-11-03 防守线「只用实线」写进版本清单；默认「实线和虚线」不改旧清单
  it('names the solid-only guard line and its version in the manifest', () => {
    const guard = { ...defaultStructureAddition('dbl5'), kSource: 'guard' as const, buffer: 0 };
    const of = (s: typeof guard & { guardTrendOnly?: boolean }) => Object.fromEntries(qualityPlanVersions({ ...plan, addition: { ...plan.addition!, maxRounds: 1, rounds: [{ source: 'structure', structure: s, stricterPct: 10 }] } } as QualityGroup).map(e => [e.key, e]))['box-1'];
    expect(of({ ...guard, guardTrendOnly: true })).toMatchObject({ name: expect.stringContaining('K＝防守线（只用实线）'), version: expect.stringContaining('guard-trend-only-v1') });
    expect(of(guard).version).not.toContain('guard-trend-only'); expect(of(guard).name).not.toContain('只用实线');
  });
  it('keeps the saved manifest while the plan is unchanged and refreezes when the user edits it', () => {
    const saved = freezeQualityPlan(plan), aged = { ...saved, frozenVersions: saved.frozenVersions!.map(e => e.key === 'hard-stop' ? { ...e, version: 'holding-veto-v2' } : e) };
    // 内容没改：沿用已存清单（模拟代码升级后，旧清单照样能查出差异）
    const [same] = freezeSavedPlans([aged], [{ ...plan }]);
    expect(same.frozenVersions).toBe(aged.frozenVersions); expect(planVersionChanges(same)).toEqual([expect.objectContaining({ key: 'hard-stop', from: 'holding-veto-v2', to: 'holding-veto-v3' })]);
    // 用户改过再保存＝认可当前版本
    const [edited] = freezeSavedPlans([aged], [{ ...plan, rule: { ...plan.rule!, threshold: .4 } }]);
    expect(planVersionChanges(edited)).toEqual([]);
    expect(edited.addition!.rounds![1].structure!.versions).toEqual({ box: 'dbl-5-v2', guard: 'dbl5-guard-v1' });
  });
  it('refuses to save or use a template whose versions no longer match the code', () => {
    const study = saveQualityPlanTemplate(newQualityStudy(1), plan, '好组合', 100), t = study.planTemplates![0] as Required<typeof study.planTemplates>[number] & { plan: QualityGroup };
    expect(planVersionChanges(t.plan)).toEqual([]); expect(qualityPlanFromTemplate(t, 'p2').frozenVersions).toEqual(t.plan.frozenVersions);
    const stale = { ...t, plan: { ...t.plan, frozenVersions: t.plan.frozenVersions!.map(e => e.key === 'box-1' ? { ...e, version: 'dbl-5-v1' } : e) } };
    expect(() => qualityPlanFromTemplate(stale, 'p3')).toThrow('dbl-5-v1');
    expect(() => saveQualityPlanTemplate(newQualityStudy(1), stale.plan, '再存')).toThrow('不能存为模板');
  });
  it('backfills unfrozen plans and templates, and re-freezes only formula changes that follow the account', () => {
    const study = { ...newQualityStudy(1), sellPlans: [plan], planTemplates: [{ id: 't', name: '旧模板', savedAt: 1, updatedAt: 1, plan }] };
    const filled = backfillPlanVersions(study);
    expect(filled.sellPlans![0].frozenVersions?.length).toBeGreaterThan(0); expect(filled.planTemplates![0].plan!.frozenVersions?.length).toBeGreaterThan(0);
    expect(backfillPlanVersions(filled)).toBe(filled);
    const followed = { ...filled.sellPlans![0], snapshot: snap('formula-B') };
    expect(planVersionChanges(followed).map(c => c.key)).toEqual(['sell']);
    expect(planVersionChanges(refreezeSyncedFormulas({ sellPlans: [followed] }).sellPlans![0])).toEqual([]);
    const engine = { ...filled.sellPlans![0], frozenVersions: filled.sellPlans![0].frozenVersions!.map(e => e.key === 'mirror' ? { ...e, version: 'mirror-limit-v0' } : e) };
    expect(planVersionChanges(refreezeSyncedFormulas({ sellPlans: [engine] }).sellPlans![0]).map(c => c.key)).toEqual(['mirror']);
    expect(comparePlanVersions([], qualityPlanVersions(plan)).every(c => c.from === null)).toBe(true);
  });
});
