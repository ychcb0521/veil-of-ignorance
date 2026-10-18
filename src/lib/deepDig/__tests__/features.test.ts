import { describe, expect, it } from 'vitest';
import {
  campaignSample, checkDefinition, classifyCampaign, classifySample, compileGroups, DEFAULT_CONTROL, DEFAULT_POSITIVE, definitionKey, DRIFT_SPEED_DEF, mergeFeatureDefs, newFeatureTemplate, previewGroups, removedBuiltins,
  DRIFT_SPEED_FORMULA, EMA_DRIFT_SPEED_FORMULA, featureWindowMs, formulaParamUse, sampleEventRows, signalSample, translateLegacyGroupExpr, upgradeGroupVars,
} from '@/lib/deepDig/features';
import { groupCampaign, mulberry32, type CampaignLabelInput } from '@/lib/deepRsa/grouping';
import { buildCampaignGroupReport, type CampaignGroupRow } from '@/lib/deepRsa/report';
import { buildRunItems } from '@/lib/deepRsa/pipeline';

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
    // 以前的两版默认公式（写死 6 小时；按 hl 平滑成交额）读进来都换成现在的默认公式（过去 avgh 小时平均成交额）
    const legacyFormula = EMA_DRIFT_SPEED_FORMULA.replace('ema(Q, hl))  #', 'ema(Q, 6))   #').replace('ema(U, hl, 0)           # 漂移速度：按半衰期 hl 指数平滑', 'ema(U, 6, 0)            # 漂移速度：半衰期 6 小时指数平滑').replace('Q = B + S；hl = 上面选的半衰期（小时）', 'Q = B + S');
    expect(legacyFormula).not.toBe(EMA_DRIFT_SPEED_FORMULA);
    for (const formula of [legacyFormula, EMA_DRIFT_SPEED_FORMULA]) {
      expect(mergeFeatureDefs([{ ...DRIFT_SPEED_DEF, formula, builtin: undefined }])[0].formula).toBe(DRIFT_SPEED_DEF.formula);
      // 结果口径变了：按旧公式算的结果要提示重跑
      expect(definitionKey({ ...DRIFT_SPEED_DEF, formula })).not.toBe(definitionKey(DRIFT_SPEED_DEF));
    }
    // 写死 6 小时那版与按 hl 那版（默认半衰期）结果一样
    expect(definitionKey({ ...DRIFT_SPEED_DEF, formula: legacyFormula })).toBe(definitionKey({ ...DRIFT_SPEED_DEF, formula: EMA_DRIFT_SPEED_FORMULA }));
    // 改过的公式不动
    expect(mergeFeatureDefs([{ ...DRIFT_SPEED_DEF, formula: 'ln(C)' }])[0].formula).toBe('ln(C)');
    // 平均时长：改了算定义改动，默认 24 不进键；观察窗跟着放宽
    expect(definitionKey({ ...DRIFT_SPEED_DEF, avgHours: 48 })).not.toBe(definitionKey(DRIFT_SPEED_DEF));
    expect(definitionKey({ ...DRIFT_SPEED_DEF, avgHours: 24 })).toBe(definitionKey(DRIFT_SPEED_DEF));
    expect(featureWindowMs({ avgHours: 48 })).toBe(72 * 3_600_000);
    expect(formulaParamUse(DRIFT_SPEED_FORMULA)).toEqual({ hl: true, avgh: true });
    expect(formulaParamUse('ln(C / prev(C, 12))')).toEqual({ hl: false, avgh: false });
    expect(formulaParamUse('ln(')).toBeNull();
    // 换周期 / 半衰期算定义改动；默认值不进键
    expect(definitionKey({ ...DRIFT_SPEED_DEF, interval: '15m' })).not.toBe(definitionKey(DRIFT_SPEED_DEF));
    expect(definitionKey({ ...DRIFT_SPEED_DEF, halfLifeHours: 12 })).not.toBe(definitionKey(DRIFT_SPEED_DEF));
    expect(definitionKey({ ...DRIFT_SPEED_DEF, interval: '5m', halfLifeHours: 6 })).toBe(definitionKey(DRIFT_SPEED_DEF));
    // 观察窗：默认 48 小时；半衰期长了放到 8 个半衰期；周期粗了至少 50 根
    expect(featureWindowMs({})).toBe(48 * 3_600_000);
    expect(featureWindowMs({ halfLifeHours: 12 })).toBe(96 * 3_600_000);
    expect(featureWindowMs({ interval: '4h' })).toBe(200 * 3_600_000);
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

  it('【用户要求】信号单独算数据：没有交易战役也纳入；同币 48 小时内的几条信号不合并，每条一个事件、各自带评级', () => {
    const t0 = Date.parse('2026-08-12T01:30:00Z');
    const sig = (id: string, hours: number, quality?: number) => signalSample({ id, symbol: 'SOLUSDT', timeMs: t0 + hours * 3_600_000, timeLabel: '', fallbackZone: '', quality });
    const g = compileGroups('s >= 4', 's <= 2', 'signals');
    // 战役汇总是空的（一场战役都没有），信号照样成为事件
    const empty = buildCampaignGroupReport([], true);
    const rows = sampleEventRows([sig('a', 0, 5), sig('b', 3, 1), sig('c', 10, 3)], g);
    const { items } = buildRunItems(empty, 1, 0, rows, false);
    expect(items.map(i => [i.id, i.label, i.anchorMs - t0])).toEqual([
      ['a', 'positive', 0], ['b', 'control', 3 * 3_600_000], ['c', null, 10 * 3_600_000],
    ]);
    // 对照：按战役的做法合簇时，一正一负会被并成一个「冲突」事件，两条都进不了比较
    const merged = buildRunItems(empty, 1, 0, rows, true).items;
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBeNull();
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
    // 【用户要求】BSS 是第二个内置特征值
    expect(merged.map(d => d.id)).toEqual([DRIFT_SPEED_DEF.id, 'bss', b.id, a.id]);
    expect(merged[0]).toMatchObject({ name: '改过的名字', builtin: true });
    expect(checkDefinition(a)).toEqual({ formula: null, groups: null, scale: null });
    // 内置项删掉 = 隐藏，可恢复
    const hidden = [{ ...DRIFT_SPEED_DEF, builtin: undefined, removed: true }];
    expect(mergeFeatureDefs(hidden).map(d => d.id)).toEqual(['bss']);
    expect(removedBuiltins(hidden).map(d => d.id)).toEqual([DRIFT_SPEED_DEF.id]);
  });
});
