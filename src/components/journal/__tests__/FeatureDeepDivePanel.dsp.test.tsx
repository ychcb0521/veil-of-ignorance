import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeatureDeepDivePanel } from '@/components/journal/FeatureDeepDivePanel';
import { analyzeFeatureDeepDive, DSP_STUDY, type FeatureDeepDiveResult } from '@/lib/deepRsa/deepDive';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import type { RunEvent } from '@/lib/deepRsa/pipeline';

function events(n: number): RunEvent[] {
  const rand = mulberry32(5);
  const t0 = Date.parse('2025-01-01T00:00:00Z');
  return Array.from({ length: n }, (_, i) => {
    const vol = 0.005 + 0.02 * rand();
    const v = 2e-4 * (rand() - 0.5);
    const f = { vol_w: vol, dsp_v: v, dsp_a: rand() - 0.5, dsp_gap: vol * 2 * (rand() - 0.3) };
    return {
      id: `e${i}`, symbol: `S${i % 20}USDT`, anchorMs: t0 + i * 8 * 3_600_000, kind: i % 3 ? 'event' : 'background',
      featuresByH: { 2: f, 6: f, 12: f }, label: i % 3 ? (rand() < 0.2 ? 'positive' : 'control') : null, outcome: vol * 4,
      block: new Date(t0 + i * 8 * 3_600_000).toISOString().slice(0, 7), momentum: null,
      maxUp: vol * 4, maxDown: -vol * 4, endRet: 300 * v + 0.02 * (rand() - 0.5),
    } as RunEvent;
  });
}

function result(): FeatureDeepDiveResult {
  const { split, ...analysis } = analyzeFeatureDeepDive(events(240), { permutations: 599, bootstrap: 49, study: DSP_STUDY });
  return {
    codeVersion: 'veil-build:test', startedAt: 0, finishedAt: Date.parse('2026-10-16T08:00:00Z'), ...analysis,
    coverage: {
      campaigns: 200, clusters: 160, events: 240, campaignEvents: 160, background: 80, labeled: { positive: 30, control: 130 },
      failed: [], lowCoverage: 3, outcomeMissing: 0, missingTakerEvents: 0, fallbackAvailable: 0, featureMissing: 4,
      discovery: split.train.length + split.val.length, confirmation: split.test.length, embargoed: split.embargoed.length, confirmationCut: split.cutoffs.test,
    },
  };
}

const props = { status: 'idle' as const, progress: null, error: null, canRun: true, groupingReady: true, onRun: vi.fn(), onCancel: vi.fn(), onDownload: vi.fn() };

describe('【用户要求】Deep RSA 第 7 步「动态谢林点检验」：与第 6 步同一个面板，换特征与说明', { timeout: 60_000 }, () => {
  it('没跑过：三个读数的定义、按钮写「开始检验」、testid 用自己的前缀', () => {
    const onRun = vi.fn();
    render(<FeatureDeepDivePanel {...props} study={DSP_STUDY} testIdPrefix="dsp-study" result={null} onRun={onRun} />);
    expect(screen.getByText('动态谢林点的三个读数（进场前最后一根 5m K 线）')).toBeInTheDocument();
    expect(screen.getByTestId('dsp-study-def-dsp_v')).toHaveTextContent('谢林点迁移速度 V');
    expect(screen.getByTestId('dsp-study-def-dsp_a')).toHaveTextContent('主动买方优势 A');
    expect(screen.getByTestId('dsp-study-def-dsp_gap')).toHaveTextContent('现价偏离 DSP');
    expect(screen.getByTestId('dsp-study-run')).toHaveTextContent('开始检验');
    expect(screen.getByTestId('dsp-study-panel').textContent).toContain('第 7 步的报告');
    expect(screen.queryByTestId('deep-dive-panel')).toBeNull();
    fireEvent.click(screen.getByTestId('dsp-study-run'));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('跑完：B 节是 t 检验（实验组 vs 对照组，V 按基点）；C 节 9 行相关检验；D 节写明确认集不独立；H 节是交叉表；结论先写 t 检验', () => {
    render(<FeatureDeepDivePanel {...props} study={DSP_STUDY} testIdPrefix="dsp-study" result={result()} />);
    const a = screen.getByTestId('dsp-study-section-A');
    expect(a.textContent).toContain('特征缺失（成交额覆盖不足）4');
    const vRow = within(a).getByText('谢林点迁移速度 V').closest('tr')!;
    expect(vRow.textContent).not.toMatch(/0\.0000 ~ 0\.0000/);
    fireEvent.click(screen.getByTestId('dsp-study-tab-B'));
    const b = screen.getByTestId('dsp-study-section-B');
    expect(b.textContent).toContain('t 检验：实验组 vs 对照组');
    expect(b.textContent).toContain('Welch');
    for (const f of ['dsp_v', 'dsp_a', 'dsp_gap']) expect(within(b).getByTestId(`dsp-study-ttest-${f}`)).toBeInTheDocument();
    expect(within(b).getByTestId('dsp-study-ttest-dsp_v').textContent).toContain('基点/根');
    expect(within(b).getByTestId('dsp-study-ttest-dsp_v').textContent).toMatch(/差异显著|差异不显著/);
    fireEvent.click(screen.getByTestId('dsp-study-tab-C'));
    const c = screen.getByTestId('dsp-study-section-C');
    for (const f of ['dsp_v', 'dsp_a', 'dsp_gap']) for (const t of ['endRet', 'maxUp', 'maxDown']) {
      expect(within(c).getByTestId(`dsp-study-assoc-${f}-${t}`)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByTestId('dsp-study-tab-D'));
    expect(screen.getByTestId('dsp-study-section-D').textContent).toMatch(/检验未获支持|真正独立的确认要用之后新产生的战役/);
    fireEvent.click(screen.getByTestId('dsp-study-tab-H'));
    const h = screen.getByTestId('dsp-study-section-H');
    expect(h.textContent).toContain('偏离 × 迁移方向交叉');
    expect(h.textContent).toContain('上移（V > 0）');
    expect(screen.getByTestId('dsp-study-conclusion-ttest').textContent).toContain('t 检验（实验组 vs 对照组，B 节）');
    expect(screen.getByTestId('dsp-study-conclusion').textContent).toContain('看 F 节');
  });
});
