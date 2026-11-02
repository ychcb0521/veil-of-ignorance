// 【用户要求】2026-11-02 持仓监测的组合算法存成模板：整套参数快照，随账号同步，删除不会被另一台设备带回
import { expect, it } from 'vitest';
import { activeQualityPlanTemplates, deleteQualityPlanTemplate, mergeQualityPlanTemplates, qualityPlanFromTemplate, qualityPlanTemplateSummary, renameQualityPlanTemplate, saveQualityPlanTemplate } from '../qualityPlanTemplates';
import { mergeRemoteQualityStudy } from '../qualityStore';
import { newQualityStudy, type QualityGroup } from '../quality';
const plan = { id: 'p1', label: '组合算法1', metric: 'state', snapshot: { featureId: 'state', featureShort: '状态', definitionKey: 'k', statistic: 'raw', interval: '5m', scale: 1, threshold: 0, direction: '<', average: 0, cbi2: 0, startAverage: 0, previousAverage: 0, cutoffMs: 0 },
  rule: { metric: 'state', direction: '<', threshold: .5 }, mirrorTakeProfit: { enabled: true, gainPct: 2.5, sellPct: 67 },
  addition: { enabled: true, source: 'structure', stricterPct: 10, quantityMode: 'calculator', maxRounds: 2, rounds: [{ source: 'structure', stricterPct: 10, minGainPct: 3 }, { source: 'structure', stricterPct: 10 }] },
  holdingVetoes: [{ id: 'v', label: '持仓过程静态最大回撤', kind: 'static-drawdown', direction: '>=', threshold: 5, enabled: true }],
  vetoStages: [{ afterAdditions: 2, conditions: [] }], vetoStageMode: 'overlay' } as unknown as QualityGroup;
it('saves a full snapshot, creates new plans with every parameter, and keeps the saved copy independent', () => {
  let s = saveQualityPlanTemplate(newQualityStudy(1), plan, '  好组合  ', 100);
  const [t] = activeQualityPlanTemplates(s);
  expect(t.name).toBe('好组合'); expect(t.plan).toEqual(plan); expect(t.plan).not.toBe(plan);
  const made = qualityPlanFromTemplate(t, 'p9');
  expect(made).toEqual({ ...plan, id: 'p9', label: '好组合' });
  made.mirrorTakeProfit!.sellPct = 50; expect(activeQualityPlanTemplates(s)[0].plan.mirrorTakeProfit!.sellPct).toBe(67);
  expect(() => saveQualityPlanTemplate(s, plan, '  ')).toThrow('模板名称');
  s = saveQualityPlanTemplate(s, plan, '第二个', 200); expect(activeQualityPlanTemplates(s).map(x => x.name)).toEqual(['第二个', '好组合']);
  expect(qualityPlanTemplateSummary(plan)).toBe('状态 < 0.5 · 镜像 2.5% 卖 67% · 加仓最多 2 次 · 硬性终止 1 条');
});
it('renames and deletes with tombstones that win a merge, so another device cannot bring a deleted template back', () => {
  const a = saveQualityPlanTemplate(newQualityStudy(1), plan, '模板', 100), id = a.planTemplates![0].id;
  const renamed = renameQualityPlanTemplate(a, id, '新名字', 150), deleted = deleteQualityPlanTemplate(a, id, 200);
  expect(activeQualityPlanTemplates(renamed)[0].name).toBe('新名字'); expect(activeQualityPlanTemplates(deleted)).toEqual([]);
  expect(deleted.planTemplates![0].plan).toBeUndefined();
  expect(activeQualityPlanTemplates({ planTemplates: mergeQualityPlanTemplates(deleted.planTemplates, renamed.planTemplates) })).toEqual([]);
  const other = saveQualityPlanTemplate(newQualityStudy(1), plan, '另一台设备', 300);
  expect(activeQualityPlanTemplates(mergeRemoteQualityStudy(renamed, other)).map(t => t.name).sort()).toEqual(['另一台设备', '新名字']);
  expect(activeQualityPlanTemplates(mergeRemoteQualityStudy(deleted, renamed))).toEqual([]);
});
