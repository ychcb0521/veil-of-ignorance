import { describe, expect, it } from 'vitest';
import { fUpperP, welchTTest } from '@/lib/deepRsa/deepDive';
import { DEFAULT_COMMANDS, methodsIn, ols, parseCommands, runInference, toggleMethod, type InferenceBlock } from '@/lib/deepDig/commands';
import type { DeepDigRow, DeepDigRowGroup } from '@/lib/deepDig/analysis';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { driftEvents, makeData } from './fixtures';

const DEF = { id: 'x', name: 'x', short: 'X', formula: 'C', scale: 1, unit: '', positive: 'b > 3', control: 'b < 0.5' };
function rows(spec: { g: DeepDigRowGroup; v: number; endRet?: number; vol?: number }[]): DeepDigRow[] {
  return spec.map((s, i) => ({
    id: `r${i}`, symbol: `S${i % 7}USDT`, anchorMs: Date.parse('2025-01-01') + i * 86_400_000, group: s.g, memberIds: [], v: s.v, vol: s.vol ?? 0.01,
    endRet: s.endRet ?? 0, maxUp: 0.01, maxDown: -0.01, period: i % 5 === 4 ? 'confirmation' : 'discovery',
  }));
}
const block = <K extends InferenceBlock['kind']>(bs: InferenceBlock[], kind: K) => bs.find(b => b.kind === kind) as Extract<InferenceBlock, { kind: K }>;

describe('【用户要求】Deep dig 推断统计命令：可选方法 + 可自己写', { timeout: 60_000 }, () => {
  it('解析：方法名、组名、变量式子、选项写错时逐行说明', () => {
    const { commands, errors } = parseCommands([
      '# 注释',
      'ttest(X, 实验组, 对照组)',
      'foo(X)',
      'ttest(X, 甲组, 对照组)',
      'regress(endRet ~ X + Y)',
      'regress(endRet X)',
      'mannwhitney(X, 实验组, 对照组, cv=3)',
      'ml(实验组 ~ X, model=svm)',
      'anova(X, 实验组)',
      '随便写',
    ].join('\n'));
    expect(commands.map(c => c.line)).toEqual([2]);
    expect(errors.map(e => e.line)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(errors[0].message).toContain('没有「foo」这个方法');
    expect(errors[1].message).toContain('不认识组名「甲组」');
    expect(errors[2].message).toContain('不认识「Y」');
    expect(errors[3].message).toContain('regress(y ~ x1 + x2)');
    expect(errors[4].message).toContain('没有 cv= 这个选项');
    expect(errors[5].message).toContain('logistic 或 knn');
    expect(errors[6].message).toContain('至少要两个组');
    expect(errors[7].message).toContain('方法名(参数');
  });

  it('勾选方法：加一行默认写法；取消：删掉这个方法的行（一元 / 多元回归分开）', () => {
    expect([...methodsIn(DEFAULT_COMMANDS)].sort()).toEqual(['mannwhitney', 'quintiles', 'spearman', 'ttest']);
    let text = toggleMethod(DEFAULT_COMMANDS, 'mregress', true);
    text = toggleMethod(text, 'regress', true);
    expect(text.split('\n').slice(-2)).toEqual(['regress(endRet ~ X + vol)', 'regress(endRet ~ X)']);
    expect(methodsIn(text).has('mregress')).toBe(true);
    text = toggleMethod(text, 'regress', false);
    expect(text).toContain('regress(endRet ~ X + vol)');
    expect(text).not.toMatch(/regress\(endRet ~ X\)$/m);
    expect(toggleMethod(text, 'ttest', false)).not.toContain('ttest(');
  });

  it('最小二乘与 scipy / numpy 逐位一致；F 分布上尾与 scipy 一致', () => {
    const y = [1.2, 2.3, 2.9, 4.1, 5.2, 5.8, 7.4, 8.1, 8.8, 10.3];
    const x2 = [0.5, 0.1, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 1.0];
    const fit = ols(y, y.map((_, i) => [i + 1, x2[i]]))!;
    [0.08608695652174086, 0.9861739130434782, 0.18173913043478343].forEach((b, i) => expect(fit.terms[i].beta).toBeCloseTo(b, 10));
    [0.18491743710944084, 0.02799326719715996, 0.2799326719715996].forEach((se, i) => expect(fit.terms[i].se).toBeCloseTo(se, 10));
    [0.655679932997246, 3.8536829441816025e-09, 0.5369050007896167].forEach((p, i) => expect(fit.terms[i].p).toBeCloseTo(p, 8));
    expect(fit.r2).toBeCloseTo(0.9953267605828422, 10);
    expect(fit.f).toBeCloseTo(745.445150798343, 6);
    expect(fit.pF).toBeCloseTo(6.9769098122425034e-09, 12);
    expect(fUpperP(4, 1, 10)).toBeCloseTo(0.07338803477074037, 10);
  });

  it('方差分析与 scipy.stats.f_oneway 一致；t 检验与直接算一致（变量按显示单位）', () => {
    const data = rows([
      ...[1, 2, 3, 4.5].map(v => ({ g: 'positive' as const, v })),
      ...[2, 3.5, 4, 5, 6].map(v => ({ g: 'control' as const, v })),
      ...[5, 6, 7.5].map(v => ({ g: 'other' as const, v })),
    ]);
    const inf = runInference({ rows: data, definition: DEF, finishedAt: 1 }, 'anova(X, 实验组, 对照组, 其他)\nttest(X * 10, 实验组, 对照组)');
    const a = block(inf.blocks, 'anova');
    expect(a.f).toBeCloseTo(5.079597638311831, 10);
    expect(a.p).toBeCloseTo(0.03337287369958098, 10);
    const t = block(inf.blocks, 'ttest');
    expect(t.result.diff).toBeCloseTo(welchTTest([10, 20, 30, 45], [20, 35, 40, 50, 60]).diff!, 10);
    expect(inf.commands).toContain('anova');
  });

  it('默认命令在合成数据上：t 检验、排名比较、相关、五分位都有结果；写错的行作为错误卡片留在原位置', () => {
    const data = makeData(driftEvents(240, -1e-4));
    const inf = runInference(data, `${DEFAULT_COMMANDS}\nfoo(X)`, { excludedKey: 'k' });
    expect(inf.blocks.map(b => b.kind)).toEqual(['ttest', 'mannwhitney', 'spearman', 'quintiles', 'error']);
    expect(block(inf.blocks, 'ttest').result.p).toBeLessThan(0.05);
    expect(block(inf.blocks, 'spearman').rows.map(r => r.target)).toEqual(['endRet', 'maxUp', 'maxDown']);
    expect(block(inf.blocks, 'quintiles').bins).toHaveLength(5);
    expect(inf.excludedKey).toBe('k');
  });

  it('RSA 与机器学习：植入「特征决定组别」时检出，打乱后检不出', () => {
    const rand = mulberry32(3);
    const spec = Array.from({ length: 120 }, (_, i) => {
      const g: DeepDigRowGroup = i % 3 === 0 ? 'positive' : 'control';
      return { g, v: (g === 'positive' ? 1.5 : 0) + rand(), endRet: rand() - 0.5, vol: 0.01 + 0.01 * rand() };
    });
    const strong = runInference({ rows: rows(spec), definition: DEF, finishedAt: 1 }, 'rsa(X, 组别, perm=99)\nml(实验组 ~ X + vol, cv=5, perm=49)\nml(实验组 ~ X, model=knn, k=9, perm=0)\nregress(endRet ~ X + vol + 实验组)');
    expect(block(strong.blocks, 'rsa').r).toBeGreaterThan(0.2);
    expect(block(strong.blocks, 'rsa').p).toBeLessThan(0.05);
    const ml = strong.blocks.filter(b => b.kind === 'ml') as Extract<InferenceBlock, { kind: 'ml' }>[];
    expect(ml[0].auc).toBeGreaterThan(0.85);
    expect(ml[0].p).toBeLessThan(0.05);
    expect(ml[0].coefficients!.map(c => c.term)).toEqual(['X', 'vol']);
    expect(ml[1].auc).toBeGreaterThan(0.8);
    expect(block(strong.blocks, 'regress').terms.map(t => t.term)).toEqual(['截距', 'X', 'vol', '实验组']);
    const shuffled = spec.map((s, i) => ({ ...s, v: spec[(i * 37) % spec.length].v * 0 + rand() }));
    const none = runInference({ rows: rows(shuffled), definition: DEF, finishedAt: 1 }, 'ml(实验组 ~ X, cv=5, perm=49)');
    expect(block(none.blocks, 'ml').auc).toBeLessThan(0.7);
  });
});
