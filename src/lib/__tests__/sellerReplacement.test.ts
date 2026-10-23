import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_FEATURES, SELLER_CONTROL_DEF, mergeFeatureDefs, removedBuiltins } from '@/lib/deepDig/features';
import { DOWNWARD_DRIFT_DEF, SELLER_PUSH_DEF } from '@/lib/deepDig/__tests__/fixtures/retiredSellerFeatures';
import { CUSTOM_RESEARCH_INDICATORS, migrateResearchIndicators } from '@/lib/researchIndicators';
import { accountFeatureDefs, chartFeatureDef } from '@/lib/featureSource';
import { FEATURES_KEY } from '@/lib/deepDig/features';
import { fishCardsKey, loadFishCardsForScan, readFishCards } from '@/lib/fish/cards';
import { fishPreferenceKey, readFishPreference } from '@/lib/fish/preferences';
import { fishCardPlans } from '@/lib/fish/scanPlan';
import type { FishCard } from '@/components/FishAlgorithmCard';

beforeEach(() => localStorage.clear());
const available = BUILTIN_FEATURES.map(d => d.id);
const oldCard = (featureId: string): FishCard => ({ id: featureId, featureId, enabled: true,
  pref: { statistic: 'avg_b_2', direction: '<', threshold: '-15', constraints: [], sellerSignVersion: 1 } });

describe('卖控替代 DSP·b，移除卖推', () => {
  it('旧账号定义不作为自制项复活；卖控自定义公式和其他特征值保持原样，历史存储不删除', () => {
    const control = { ...SELLER_CONTROL_DEF, formula: `${SELLER_CONTROL_DEF.formula}\navg_bc_2 = avg(bc, 24)`, halfLifeHours: 12 };
    const saved = [DOWNWARD_DRIFT_DEF, { ...SELLER_PUSH_DEF, builtin: undefined }, control];
    const raw = JSON.stringify(saved);
    localStorage.setItem('sim_anon_' + FEATURES_KEY, raw);
    expect(mergeFeatureDefs(saved).map(d => d.id)).not.toContain('drift-speed-down-z');
    expect(accountFeatureDefs().map(d => d.id)).not.toContain('seller-push');
    expect(chartFeatureDef('drift-speed-down-z')).toBeUndefined();
    expect(chartFeatureDef('seller-push')).toBeUndefined();
    expect(chartFeatureDef('seller-control')).toMatchObject(control);
    expect(removedBuiltins(saved.map(d => ({ ...d, removed: true }))).map(d => d.id)).toEqual(['seller-control']);
    expect(localStorage.getItem('sim_anon_' + FEATURES_KEY)).toBe(raw);
  });

  it('指标表注册卖控及 bc 均值，不再注册 DSP·b；旧图保留参数及均值可见性，新图已有卖控时不重复', () => {
    expect(CUSTOM_RESEARCH_INDICATORS.find(d => d.id === 'SELLER_CONTROL')).toMatchObject({ featureId: 'seller-control', core: 'bc', seller: true, neutral: 0 });
    expect(CUSTOM_RESEARCH_INDICATORS.map(d => d.featureId)).not.toContain('drift-speed-down-z');
    expect(CUSTOM_RESEARCH_INDICATORS.map(d => d.featureId)).not.toContain('seller-push');
    const old = { type: 'DSP_B', period: 12, enabled: true, showAverage: true, color: '#123456' };
    const unrelated = { type: 'BSS', period: 12, enabled: true };
    const migrated = migrateResearchIndicators([old, unrelated]);
    expect(migrated).toEqual([{ ...old, type: 'SELLER_CONTROL' }, unrelated]);
    expect(migrateResearchIndicators(migrated)).toEqual(migrated);
    const control = { type: 'SELLER_CONTROL', period: 6, enabled: false };
    expect(migrateResearchIndicators([old, unrelated, control])).toEqual([unrelated, control]);
    expect(old.type).toBe('DSP_B');
  });

  it('捕捞卡替换 DSP·b 时清空不适用的门槛、统计量与建议，保留既有卖控手动设定', () => {
    localStorage.setItem(fishPreferenceKey('drift-speed-down-z'), JSON.stringify(oldCard('drift-speed-down-z').pref));
    expect(readFishPreference('seller-control')).toMatchObject({ direction: '<', threshold: '', sellerSignVersion: 1 });
    const control: FishCard = { ...oldCard('seller-control'), pref: { statistic: 'bc', direction: '<', threshold: '-2.75', constraints: [], sellerSignVersion: 1 } };
    localStorage.setItem(fishCardsKey(), JSON.stringify([oldCard('drift-speed-down-z'), oldCard('seller-push'), control]));
    const cards = readFishCards();
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ featureId: 'seller-control', pref: { statistic: '结果', direction: '<', threshold: '', sellerSignVersion: 1 } });
    expect(cards[0].pref.lastSuggestion).toBeUndefined();
    expect(cards[1]).toEqual(control);
    expect(fishCardPlans([cards[0]], BUILTIN_FEATURES).error).toContain('请填写有限数字阈值');
    expect(fishCardPlans([control], BUILTIN_FEATURES).plans[0].def.id).toBe('seller-control');
  });

  it('已移除的算法不会在首卡处静默回退成 CBI-2；仅保存卖推时不会自动运行默认四卡', () => {
    for (const id of ['seller-push', 'drift-speed-down-z']) {
      const result = fishCardPlans([oldCard(id)], BUILTIN_FEATURES);
      expect(result.plans).toEqual([]);
      expect(result.pool).toEqual([]);
      expect(result.error).not.toBe('');
    }
    localStorage.setItem(fishCardsKey(), JSON.stringify([oldCard('seller-push')]));
    expect(readFishCards()).toEqual([]);
    expect(loadFishCardsForScan(available)).toEqual([]);
  });
});
