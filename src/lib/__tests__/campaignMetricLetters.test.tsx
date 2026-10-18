import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAMPAIGN_METRIC_LETTERS, formatRangeValue, LETTER_BY_CARD_MODE, LETTER_BY_OVERVIEW_KEY, letterRanges } from '@/lib/campaignMetricLetters';
import { MetricLetterTable } from '@/components/journal/MetricLetterTable';
import { PnlMetricLabel } from '@/components/journal/CampaignPnlOverviewPanel';
import { parseFormula } from '@/lib/deepDig/formula';

describe('【用户要求】交易战役指标字母表：每个指标一个字母，交易战役与 Deep dig 共用', () => {
  it('字母与拼写都不重复；已有字母沿用（d、G、U、W、E、η、L₀），冲突按确认的方案（b 盈亏比、B 神奇的 b）；【用户要求】机会质量（原 q）删除', () => {
    const names = CAMPAIGN_METRIC_LETTERS.flatMap(m => [m.letter, ...m.aliases]);
    expect(new Set(names).size).toBe(names.length);
    const by = Object.fromEntries(CAMPAIGN_METRIC_LETTERS.map(m => [m.letter, m.name]));
    expect(by).toMatchObject({
      d: '预期回撤', G: '相对涨幅', 'ΔP': '单位涨幅', U: '单位利润', W: '仓位利润', E: '算术期望', η: '首仓涨跌幅倍数', 'L₀': '最大预期亏损',
      b: '盈亏比', B: '神奇的 b', 'Bₜ': '神奇的 b（理论）', c: '首仓涨跌幅', s: '信号评分',
    });
    expect(by.q).toBeUndefined();
    expect(CAMPAIGN_METRIC_LETTERS.some(m => m.name.includes('机会质量'))).toBe(false);
    // 每个字母和拼写都能直接写进分组标准
    expect(() => parseFormula(names.join(' + '), new Set(names))).not.toThrow();
  });

  it('【用户要求】不常用指标在指标表里折起来：A y E U W Wₜ 默认不显示（仍在表里），「交易战役」右上角很淡的「›」展开；分组标准里用到的照常显示', () => {
    localStorage.clear();
    const { unmount } = render(<MetricLetterTable sources={['campaign']} />);
    const row = (key: string) => screen.getByTestId(`metric-letter-${key}`);
    for (const key of ['A', 'y', 'E', 'U', 'W', 'Wt']) expect(row(key)).toHaveClass('hidden');
    expect(row('b')).not.toHaveClass('hidden');
    const toggle = screen.getByRole('switch', { name: '显示不常用指标' });
    fireEvent.click(toggle);
    for (const key of ['A', 'y', 'E', 'U', 'W', 'Wt']) expect(row(key)).not.toHaveClass('hidden');
    fireEvent.click(toggle);
    unmount();
    render(<MetricLetterTable sources={['campaign']} highlight={new Set(['U'])} />);
    expect(row('U')).not.toHaveClass('hidden');
    expect(row('W')).toHaveClass('hidden');
    localStorage.clear();
  });

  it('封面不再绘制字母前缀，释义保留在指标表', () => {
    const page = readFileSync(join(process.cwd(), 'src/pages/JournalCampaignsPage.tsx'), 'utf8');
    expect(page).not.toContain("before:content-");
    expect(page).not.toContain("CARD_METRIC_LETTER_CLASS");
  });

  it('封面十八项、盈亏概览各项都有字母', () => {
    expect([...LETTER_BY_CARD_MODE.keys()].sort()).toEqual([
      'addCount', 'addEfficiency', 'arithmeticExpectancy', 'captureRate', 'effectivePriceChangePct', 'executionWear', 'expectedDrawdownPct', 'geometricExpectancy',
      'magicB', 'mainPriceChange', 'mainPriceEfficiency', 'mirrorTp', 'positionAmplification', 'positionGeometricMultiple', 'positionProfit', 'unitProfit', 'unitRise', 'unrealizedPriceChangePct',
    ].sort());
    for (const k of ['payoffRatio', 'realizedPnl', 'peakPriceChange', 'dynamicMaxDrawdownPct', 'initialExpectedMaxLoss', 'mainLeverage']) expect(LETTER_BY_OVERVIEW_KEY.has(k)).toBe(true);
  });

  it('表格：交易战役与信号库两段；名称前的小字母不和名字里已有的重复', () => {
    render(<MetricLetterTable />);
    expect(screen.getByTestId('metric-letter-table')).toHaveTextContent('交易战役');
    expect(screen.getByTestId('metric-letter-table')).toHaveTextContent('信号库');
    expect(screen.getByTestId('metric-letter-eta')).toHaveTextContent('η首仓涨跌幅倍数');
    expect(screen.getByTestId('metric-letter-eta')).toHaveTextContent('也可写 eta');
    const { container } = render(<><PnlMetricLabel label="预期回撤" letter="d">x</PnlMetricLabel><PnlMetricLabel label="单位涨幅 ΔP" letter="ΔP">y</PnlMetricLabel></>);
    const tags = container.querySelectorAll('[data-testid="metric-letter-tag"]');
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute('data-letter')).toBe('d');
    // 字母用 ::before 画，不进文字内容
    expect(container.textContent).not.toContain('d预期回撤');
  });

  it('【用户要求】每个指标可以输入的数值范围：按本机样本算最小 ~ 最大、中位数、有读数的个数；给了才多一列', () => {
    const r = letterRanges([{ h: 3, c: 1 }, { h: 12.345, c: null }, { h: 0.5 }, { c: Number.NaN }], ['h', 'c', 'n']);
    expect(r.h).toEqual({ min: 0.5, max: 12.345, median: 3, n: 3, total: 4 });
    expect(r.c).toMatchObject({ min: 1, max: 1, n: 1, total: 4 });
    expect(r.n.n).toBe(0);
    expect([formatRangeValue(3), formatRangeValue(12.345), formatRangeValue(0.5), formatRangeValue(-0.0001), formatRangeValue(1234.5)]).toEqual(['3', '12.3', '0.500', '0.000', '1235']);
    const { unmount } = render(<MetricLetterTable sources={['campaign']} />);
    expect(screen.queryAllByTestId('metric-letter-range')).toHaveLength(0);
    unmount();
    render(<MetricLetterTable sources={['campaign']} ranges={r} />);
    const cell = (key: string) => screen.getByTestId(`metric-letter-${key}`).querySelector('[data-testid="metric-letter-range"]');
    expect(cell('h')!.textContent).toBe('0.500 ~ 12.3中位 3 · 3/4');
    expect(cell('h')!.getAttribute('title')).toContain('本机 4 场里 3 场有读数');
    expect(cell('n')!.textContent).toBe('没有读数');
    expect(cell('d')).toBeNull(); // 这一节没给的字母：格子空着
  });
});
