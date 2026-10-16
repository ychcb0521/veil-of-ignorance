import { describe, expect, it } from 'vitest';
import {
  checkDefinition, classifyCampaign, compileGroups, DEFAULT_CONTROL, DEFAULT_POSITIVE, DRIFT_SPEED_DEF, mergeFeatureDefs, newFeatureTemplate, previewGroups,
} from '@/lib/deepDig/features';
import { groupCampaign, mulberry32, type CampaignLabelInput } from '@/lib/deepRsa/grouping';
import type { CampaignGroupRow } from '@/lib/deepRsa/report';

function row(input: Partial<CampaignLabelInput>, metrics: CampaignGroupRow['metrics'] = { pnl: 10, chg: 5, wear: -0.1 }): CampaignGroupRow {
  const full: CampaignLabelInput = {
    campaignId: 'c', symbol: 'BTCUSDT', direction: 'main_long', deleted: false, status: 'closed_profit', settled: true, payoffBasis: 'records',
    correctionsComplete: true, anchorMs: 1, theoreticalB: 1, theoreticalBApplicable: true, payoffRatio: 1, initialExpectedMaxLoss: 100, ...input,
  };
  return { campaignId: full.campaignId, symbol: full.symbol, title: '', anchorMs: full.anchorMs, theoreticalB: full.theoreticalB, payoffRatio: full.payoffRatio, grouping: groupCampaign(full), metrics };
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

  it('自定义标准：用其他读数；用到的读数缺失 → 其他战役；同时满足 → 冲突', () => {
    const g = compileGroups('chg > 20', 'pnl < 0');
    expect(classifyCampaign(row({}, { pnl: 5, chg: 30, wear: null }), g).group).toBe('positive');
    expect(classifyCampaign(row({}, { pnl: -5, chg: 3, wear: null }), g).group).toBe('control');
    expect(classifyCampaign(row({}, { pnl: -5, chg: 30, wear: null }), g)).toEqual({ group: 'conflict', reason: 'conflict' });
    expect(classifyCampaign(row({}, { pnl: null, chg: 30, wear: null }), g)).toEqual({ group: 'other', reason: 'missing' });
    // wear 没被用到：缺了也不影响
    expect(classifyCampaign(row({}, { pnl: 1, chg: 1, wear: null }), g)).toEqual({ group: 'other', reason: 'neither' });
    // 未结算：不进两组
    expect(classifyCampaign(row({ status: 'open' }, { pnl: 1, chg: 30, wear: null }), g).reason).toBe('unreliable');
    expect(previewGroups([row({}, { pnl: 5, chg: 30, wear: null }), row({ deleted: true }, { pnl: 5, chg: 30, wear: null })], g)).toEqual({ positive: 1, control: 0, conflict: 0, other: 0 });
  });

  it('保存前检查：公式、分组标准、显示倍数', () => {
    expect(checkDefinition(DRIFT_SPEED_DEF)).toEqual({ formula: null, groups: null, scale: null });
    const bad = checkDefinition({ formula: 'ln(X)', positive: 'b >', control: 'q < 1', scale: 0 });
    expect(bad.formula).toContain('不认识「X」');
    expect(bad.groups).toContain('实验组条件');
    expect(bad.scale).toContain('正数');
    expect(checkDefinition({ ...DRIFT_SPEED_DEF, control: 'q < 1' }).groups).toContain('对照组条件：不认识「q」');
  });

  it('定义合并：内置项可被覆盖（不能删），新增项按创建先后排在后面', () => {
    const a = newFeatureTemplate(2000);
    const b = newFeatureTemplate(1000);
    const merged = mergeFeatureDefs([a, { ...DRIFT_SPEED_DEF, name: '改过的名字', builtin: undefined }, b]);
    expect(merged.map(d => d.id)).toEqual([DRIFT_SPEED_DEF.id, b.id, a.id]);
    expect(merged[0]).toMatchObject({ name: '改过的名字', builtin: true });
    expect(checkDefinition(a)).toEqual({ formula: null, groups: null, scale: null });
  });
});
