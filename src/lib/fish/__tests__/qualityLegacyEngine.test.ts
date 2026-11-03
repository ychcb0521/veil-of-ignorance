/** 【用户要求】2026-11-03 旧模板复原：旧引擎方案的识别、版本保护、模板与同步规则。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { newQualityStudy, qualityResultKey, type QualityGroup, type QualitySample } from '../quality';
import { qualitySellKey } from '../qualityCampaignArchive';
import { syncQualitySellDefinitions } from '../qualityComparison';
import { hasPreBoxAdditionShape, isLegacyQualityPlan, LEGACY_QUALITY_ENGINE, legacyAdditionRows, withLegacyEngine } from '../qualityLegacyEngine';
import { campaignPlanForTemplate, saveQualityPlanTemplate } from '../qualityPlanTemplates';
import { backfillPlanVersions, freezeQualityPlan, freezeSavedPlans, planVersionChanges } from '../qualityPlanVersions';

const fixture = JSON.parse(gunzipSync(readFileSync(join(process.cwd(), 'src/lib/fish/legacy/__tests__/fixtures/rave-2026-04-09-combo2.json.gz'))).toString('utf8')) as { plan: QualityGroup; sample: QualitySample };
const original = fixture.plan;

describe('旧引擎方案', () => {
  it('只有带入场距离的 11-01 之前形态才算旧形态；标记后版本＝引擎＋全部参数指纹', () => {
    expect(hasPreBoxAdditionShape(original)).toBe(true);
    expect(hasPreBoxAdditionShape({ addition: { ...original.addition!, enabled: false } })).toBe(false);
    const tagged = withLegacyEngine(freezeQualityPlan(original));
    expect(isLegacyQualityPlan(tagged)).toBe(true);
    expect(tagged.frozenVersions!.map(v => v.key)).toEqual(['engine', 'legacy-params']);
    expect(planVersionChanges(tagged)).toEqual([]);
    // 改名称、换编号、字段顺序不同：指纹不变
    const reordered = Object.fromEntries(Object.entries({ ...tagged, label: '新名字', id: 'x' }).reverse()) as unknown as QualityGroup;
    expect(planVersionChanges(reordered)).toEqual([]);
    // 任何参数变了都被拦下
    const edited = { ...tagged, addition: { ...tagged.addition!, rounds: tagged.addition!.rounds!.map((r, i) => i ? r : { ...r, entryBufferAtr: 3 }) } };
    expect(planVersionChanges(edited).map(c => c.key)).toEqual(['legacy-params']);
  });

  it('保存时不因「用户保存」而重新冻结：参数被改动仍按版本不符拦下', () => {
    const tagged = withLegacyEngine(original);
    const edited = { ...tagged, addition: { ...tagged.addition!, source: 'structure' as const } };
    const [saved] = freezeSavedPlans([tagged], [edited]);
    expect(saved.frozenVersions).toEqual(tagged.frozenVersions);
    expect(planVersionChanges(saved)).not.toEqual([]);
    const [renamed] = freezeSavedPlans([tagged], [{ ...tagged, label: '改个名' }]);
    expect(planVersionChanges(renamed)).toEqual([]);
  });

  it('打开时把旧形态的模板标为旧引擎（替换按当前代码误记的版本），其它模板不动', () => {
    const wrong = { id: 't1', name: '算法组合3-0（b=2005.48）', savedAt: 1, updatedAt: 1, plan: freezeQualityPlan(original) };
    const normal = { id: 't2', name: '普通', savedAt: 1, updatedAt: 1, plan: freezeQualityPlan({ ...original, addition: undefined }) };
    const study = backfillPlanVersions({ ...newQualityStudy(), planTemplates: [wrong, normal] });
    expect(study.planTemplates![0].plan!.engine).toBe(LEGACY_QUALITY_ENGINE);
    expect(study.planTemplates![0].updatedAt).toBe(1);
    expect(study.planTemplates![1]).toBe(normal);
    expect(backfillPlanVersions(study)).toBe(study);
  });

  it('从战役存模板：旧形态→旧引擎；版本保护之前的其它方案不存；已冻结的照存', () => {
    expect(campaignPlanForTemplate(original).engine).toBe(LEGACY_QUALITY_ENGINE);
    expect(() => campaignPlanForTemplate({ ...original, addition: undefined })).toThrow('版本保护之前');
    const frozen = freezeQualityPlan({ ...original, addition: undefined });
    expect(campaignPlanForTemplate(frozen)).toBe(frozen);
    const study = saveQualityPlanTemplate(newQualityStudy(), original, '组合2');
    expect(study.planTemplates![0].plan!.engine).toBe(LEGACY_QUALITY_ENGINE);
  });

  it('不跟随账号公式：同步时旧引擎方案原样保留', () => {
    const tagged = withLegacyEngine(original);
    const synced = syncQualitySellDefinitions({ ...newQualityStudy(), sellPlans: [tagged] }, []);
    expect(synced.sellPlans![0]).toBe(tagged);
  });

  it('结果编号与卖出身份带引擎：与同参数的当前引擎结果分开', () => {
    const tagged = withLegacyEngine(original), plain = { ...tagged, engine: undefined };
    expect(qualityResultKey(fixture.sample, tagged, 0)).not.toBe(qualityResultKey(fixture.sample, plain, 0));
    expect(qualitySellKey(tagged)).not.toBe(qualitySellKey(plain));
  });

  it('加仓设置逐次列出旧引擎的原始参数', () => {
    expect(legacyAdditionRows(original.addition).map(r => [r.trigger, r.entryBufferAtr, r.supportOffsetAtr, r.minGainPct])).toEqual([
      ['状态 S 原始值 > 0.7', 2, 1.5, 10], ['状态 S 原始值 > 0.75', 2, 1.5, 11], ['状态 S 原始值 > 0.8', 2, 1.5, 12], ['状态 S 原始值 > 0.85', 2, 1.5, 13],
      ['状态 S 原始值 > 0.9', 2, 1.5, 14], ['状态 S 原始值 > 0.9', 3, 2, 15], ['状态 S 原始值 > 0.9', 3, 2, 10], ['状态 S 原始值 > 0.9', 3.5, 2.5, 10]]);
  });
});
