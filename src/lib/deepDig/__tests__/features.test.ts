import { describe, expect, it } from 'vitest';
import {
  campaignSample, checkDefinition, classifyCampaign, classifySample, compileGroups, DEFAULT_CONTROL, DEFAULT_POSITIVE, definitionKey, DRIFT_SPEED_DEF, mergeFeatureDefs, newFeatureTemplate, previewGroups, removedBuiltins,
  sampleEventRows, signalSample, translateLegacyGroupExpr, upgradeGroupVars,
} from '@/lib/deepDig/features';
import { groupCampaign, mulberry32, type CampaignLabelInput } from '@/lib/deepRsa/grouping';
import type { CampaignGroupRow } from '@/lib/deepRsa/report';

function row(input: Partial<CampaignLabelInput>, letters: CampaignGroupRow['letters'] = { p: 10, c: 5, w: -0.1 }): CampaignGroupRow {
  const full: CampaignLabelInput = {
    campaignId: 'c', symbol: 'BTCUSDT', direction: 'main_long', deleted: false, status: 'closed_profit', settled: true, payoffBasis: 'records',
    correctionsComplete: true, anchorMs: 1, theoreticalB: 1, theoreticalBApplicable: true, payoffRatio: 1, initialExpectedMaxLoss: 100, ...input,
  };
  return { campaignId: full.campaignId, symbol: full.symbol, title: '', anchorMs: full.anchorMs, theoreticalB: full.theoreticalB, payoffRatio: full.payoffRatio, grouping: groupCampaign(full), letters };
}

describe('【用户要求】Deep dig 分组标准：按用户写的条件划分组别', () => {
  it('默认标准与原 Deep RSA 分组逐场一致（随机 2000 场，含缺失、无加仓、未结算、L₀ 无效、盈亏来源弱）', () => {
    const groups = compileGroups(DEFAULT_POSITIVE, DEFAULT_CONTROL);
    const rand = mulberry32(9);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const vals = [null, 0.2, 0.5, 1, 3, 3.5, 8];
    for (let i = 0; i < 2000; i++) {
      const r = row({
        theoreticalB: pick(vals), theoreticalBApplicable: rand() < 0.8, payoffRatio: pick(vals),
        status: pick(['closed_profit', 'closed_loss', 'open']), settled: rand() < 0.9, payoffBasis: pick(['records', 'mixed', 'none', 'campaign_summary'] as const),
        initialExpectedMaxLoss: pick([100, 0, null]), correctionsComplete: pick([true, true, false]),
      });
      const mine = classifyCampaign(r, groups).group;
      const orig = r.grouping.group;
      const expected = orig === 'positive' || orig === 'control' || orig === 'conflict' ? orig : 'other';
      expect(mine, JSON.stringify(r.grouping)).toBe(expected);
    }
  });

  it('自定义标准：用指标字母；用到的读数缺失 → 其他战役；同时满足 → 冲突', () => {
    const g = compileGroups('c > 20', 'p < 0');
    expect(classifyCampaign(row({}, { p: 5, c: 30 }), g).group).toBe('positive');
    expect(classifyCampaign(row({}, { p: -5, c: 3 }), g).group).toBe('control');
    expect(classifyCampaign(row({}, { p: -5, c: 30 }), g)).toEqual({ group: 'conflict', reason: 'conflict' });
    expect(classifyCampaign(row({}, { p: null, c: 30 }), g)).toEqual({ group: 'other', reason: 'missing' });
    // w 没被用到：缺了也不影响
    expect(classifyCampaign(row({}, { p: 1, c: 1, w: null }), g)).toEqual({ group: 'other', reason: 'neither' });
    // 未结算：不进两组
    expect(classifyCampaign(row({ status: 'open' }, { p: 1, c: 30 }), g).reason).toBe('unreliable');
    // 希腊字母 / 下标也可以用拼写
    const eta = compileGroups('eta > 2 and Bt > 1', 'L0 < 50');
    expect([...eta.inputs].sort()).toEqual(['Bₜ', 'L₀', 'η'].sort());
    expect(classifyCampaign(row({ theoreticalB: 4 }, { η: 3, 'L₀': 100 }), eta).group).toBe('positive');
    expect(classifyCampaign(row({ theoreticalB: 4 }, { η: null, 'L₀': 100 }), eta).reason).toBe('missing');
    const samples = [row({}, { p: 5, c: 30 }), row({ deleted: true }, { p: 5, c: 30 })].map(campaignSample);
    expect(previewGroups(samples, g)).toEqual({ positive: 1, control: 0, conflict: 0, other: 0 });
  });

  it('旧写法自动换成指标字母，意思不变：b → Bₜ、r → b、pnl → p、chg → c、wear → w', () => {
    expect(translateLegacyGroupExpr('b > 5 or r > 5')).toBe('Bₜ > 5 or b > 5');
    expect(translateLegacyGroupExpr('pnl < 0 and chg > 3 and not (wear < -1)')).toBe('p < 0 and c > 3 and not (w < -1)');
    const old = { ...DRIFT_SPEED_DEF, positive: 'b > 5 or r > 5', control: 'b < 0 or r < 0', groupVars: undefined, builtin: undefined };
    const merged = mergeFeatureDefs([old])[0];
    expect(merged).toMatchObject({ positive: 'Bₜ > 5 or b > 5', control: 'Bₜ < 0 or b < 0', groupVars: 2 });
    // 新写法不再翻译
    expect(upgradeGroupVars({ positive: 'b > 3', control: 'r < 0.5', groupVars: 2 as const }).positive).toBe('b > 3');
    // 旧结果里的定义也按同一规则换算：definitionKey 相同，不会误报「定义改过了」
    expect(definitionKey({ ...old })).toBe(definitionKey(merged));
  });

  it('【用户要求】样本来自信号库：时间点 = 信号时间，s = 星级；没评分缺失，探顶区等不进样本', () => {
    const g = compileGroups('s >= 4', 's <= 2', 'signals');
    const sig = (id: string, quality?: number, zone = '') => signalSample({ id, symbol: 'SOLUSDT', timeMs: Date.parse('2026-08-12T01:30:00Z'), timeLabel: '', fallbackZone: zone, quality });
    expect(sig('a', 5)).toMatchObject({ anchorMs: Date.parse('2026-08-12T01:30:00Z'), excluded: false });
    expect(classifySample(sig('a', 5), g).group).toBe('positive');
    expect(classifySample(sig('b', 1), g).group).toBe('control');
    expect(classifySample(sig('c', 3), g)).toEqual({ group: 'other', reason: 'neither' });
    expect(classifySample(sig('d'), g)).toEqual({ group: 'other', reason: 'missing' });
    expect(sig('e', 5, '探顶区 1.2').excluded).toBe(true);
    expect(() => compileGroups('c > 1', 's < 2', 'signals')).toThrow('不认识「c」');
    expect(() => compileGroups('s > 1', 'b < 2', 'campaigns')).toThrow('不认识「s」');
    expect(sampleEventRows([sig('a', 5), sig('d'), sig('e', 5, '探顶区')], g).map(r => [r.id, r.group])).toEqual([['a', 'positive'], ['d', 'middle']]);
  });

  it('保存前检查：公式、分组标准、显示倍数', () => {
    expect(checkDefinition(DRIFT_SPEED_DEF)).toEqual({ formula: null, groups: null, scale: null });
    const bad = checkDefinition({ formula: 'ln(X)', positive: 'b >', control: 'Q < 1', scale: 0 });
    expect(bad.formula).toContain('不认识「X」');
    expect(bad.groups).toContain('实验组条件');
    expect(bad.scale).toContain('正数');
    expect(checkDefinition({ ...DRIFT_SPEED_DEF, control: 'Q < 1' }).groups).toContain('对照组条件：不认识「Q」');
  });

  it('定义合并：内置项可被覆盖（不能删），新增项按创建先后排在后面', () => {
    const a = newFeatureTemplate(2000);
    const b = newFeatureTemplate(1000);
    const merged = mergeFeatureDefs([a, { ...DRIFT_SPEED_DEF, name: '改过的名字', builtin: undefined }, b]);
    expect(merged.map(d => d.id)).toEqual([DRIFT_SPEED_DEF.id, b.id, a.id]);
    expect(merged[0]).toMatchObject({ name: '改过的名字', builtin: true });
    expect(checkDefinition(a)).toEqual({ formula: null, groups: null, scale: null });
    // 内置项删掉 = 隐藏，可恢复
    const hidden = [{ ...DRIFT_SPEED_DEF, builtin: undefined, removed: true }];
    expect(mergeFeatureDefs(hidden).map(d => d.id)).toEqual([]);
    expect(removedBuiltins(hidden).map(d => d.id)).toEqual([DRIFT_SPEED_DEF.id]);
  });
});
