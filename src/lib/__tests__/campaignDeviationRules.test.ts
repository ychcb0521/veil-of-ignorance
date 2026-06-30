import { describe, expect, it } from 'vitest';
import {
  buildCampaignDeviationRuleDrafts,
  campaignDeviationRuleSourceKeys,
  normalizeDeviationRuleLooseKey,
  normalizeDeviationRuleSourceKey,
  normalizeDeviationRuleText,
} from '@/lib/campaignDeviationRules';
import type { ManualLegDeviationCost } from '@/lib/campaignSimulationEngine';

const costs: ManualLegDeviationCost[] = [
  { legId: 'leg-1', leg_role: 'Hedge_rolling', cost_usdt: 963.64 },
  { legId: 'leg-2', leg_role: 'Hedge_rolling', cost_usdt: 393.09 },
  { legId: 'leg-3', leg_role: 'mirror_tp', cost_usdt: -20 },
];

describe('campaign deviation rule drafts', () => {
  it('把手填修正后的规则与违规操作合成规则文本', () => {
    const drafts = buildCampaignDeviationRuleDrafts({
      'leg-1': {
        category: '滚动对冲',
        reason: '触发后手动拆掉太早',
        fix: '触发后的委托空只延续到这条对冲被手动拆掉的时间点',
      },
    }, costs);

    expect(drafts).toEqual([
      {
        rowKey: 'leg-1',
        violation: '滚动对冲：触发后手动拆掉太早',
        fix: '触发后的委托空只延续到这条对冲被手动拆掉的时间点',
        ruleText: '【战役偏离】违规操作：滚动对冲：触发后手动拆掉太早。修正后的规则：触发后的委托空只延续到这条对冲被手动拆掉的时间点',
      },
    ]);
  });

  it('未手填违规操作时回退到偏离腿角色，并跳过空规则', () => {
    const drafts = buildCampaignDeviationRuleDrafts({
      'leg-1': { fix: '对冲撤掉必须有明确结束条件' },
      'leg-3': { category: '镜像止盈', fix: '   ' },
    }, costs);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].ruleText).toBe(
      '【战役偏离】违规操作：Hedge_rolling。修正后的规则：对冲撤掉必须有明确结束条件',
    );
  });

  it('手动清空违规操作时不回退到腿角色', () => {
    const drafts = buildCampaignDeviationRuleDrafts({
      'leg-1': { category: '', fix: '只保留修正后的规则本体' },
    }, costs);

    expect(drafts[0].ruleText).toBe('【战役偏离】修正后的规则：只保留修正后的规则本体');
  });

  it('只汇总当前偏离明细中存在的行', () => {
    const drafts = buildCampaignDeviationRuleDrafts({
      'stale-leg': { fix: '旧分支残留不应进入规则' },
      'leg-1': { fix: '当前偏离行才进入规则' },
    }, costs);

    expect(drafts.map(draft => draft.rowKey)).toEqual(['leg-1']);
  });

  it('同一条规则重复出现时只保留一条', () => {
    const drafts = buildCampaignDeviationRuleDrafts({
      'leg-1': { fix: '同类偏离 按同一规则处理' },
      'leg-2': { fix: ' 同类偏离   按同一规则处理 ' },
    }, costs);

    expect(drafts).toHaveLength(1);
    expect(drafts[0].rowKey).toBe('leg-1');
  });

  it('规则文本归一化会清理多余空白', () => {
    expect(normalizeDeviationRuleText('  A   B \n C  ')).toBe('A B C');
  });

  it('来源匹配 key 会兼容旧规则里的空格和英文冒号', () => {
    const oldRuleText = '【战役偏离】违规操作： hedge_rolling: 新的支撑位产生的时候突然在用旧的支撑位。修正后的规则：在“裸奔阶段”，当有新的支撑位产生的时候，要迅速把对冲挪到新的支撑位';
    const fix = '在“裸奔阶段”，当有新的支撑位产生的时候，要迅速把对冲挪到新的支撑位';

    expect(campaignDeviationRuleSourceKeys(oldRuleText)).toContain(
      normalizeDeviationRuleSourceKey(fix),
    );
  });

  it('宽松来源 key 会兼容重复标点和多余空格', () => {
    expect(normalizeDeviationRuleLooseKey(' 入场价格低于谢林点时，不能开单！  更不能用浅的支撑位。。 '))
      .toBe(normalizeDeviationRuleLooseKey('入场价格低于谢林点时，不能开单!更不能用浅的支撑位。'));
  });
});
