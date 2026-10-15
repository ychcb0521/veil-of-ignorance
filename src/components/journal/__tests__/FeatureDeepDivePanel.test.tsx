import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FeatureDeepDivePanel } from '@/components/journal/FeatureDeepDivePanel';
import { analyzeFeatureDeepDive, type FeatureDeepDiveResult } from '@/lib/deepRsa/deepDive';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import type { RunEvent } from '@/lib/deepRsa/pipeline';

function events(n: number): RunEvent[] {
  const rand = mulberry32(3);
  const t0 = Date.parse('2025-01-01T00:00:00Z');
  return Array.from({ length: n }, (_, i) => {
    const vol = 0.005 + 0.02 * rand();
    const imb = rand() - 0.5;
    const f = { vol_w: vol, taker_imb_w: imb, taker_imb_shift_w: rand() - 0.5, vwap12_dev: vol * 3 * (rand() - 0.3), poc_dev_w: vol * 2 * (rand() - 0.3), fallback_dev: null };
    return {
      id: `e${i}`, symbol: `S${i % 20}USDT`, anchorMs: t0 + i * 8 * 3_600_000, kind: i % 3 ? 'event' : 'background',
      featuresByH: { 2: f, 6: f, 12: f }, label: i % 3 ? (imb > 0.3 ? 'positive' : 'control') : null, outcome: vol * 4,
      block: new Date(t0 + i * 8 * 3_600_000).toISOString().slice(0, 7), momentum: null,
      maxUp: vol * 4, maxDown: -vol * 4, endRet: 0.1 * imb + 0.02 * (rand() - 0.5),
    } as RunEvent;
  });
}

function result(): FeatureDeepDiveResult {
  const { split, ...analysis } = analyzeFeatureDeepDive(events(240), { permutations: 599, bootstrap: 49 });
  return {
    codeVersion: 'veil-build:test', startedAt: 0, finishedAt: Date.parse('2026-10-15T08:00:00Z'), ...analysis,
    coverage: {
      campaigns: 200, clusters: 160, events: 240, campaignEvents: 160, background: 80, labeled: { positive: 30, control: 130 },
      failed: [], lowCoverage: 3, outcomeMissing: 0, missingTakerEvents: 0, fallbackAvailable: 0,
      discovery: split.train.length + split.val.length, confirmation: split.test.length, embargoed: split.embargoed.length, confirmationCut: split.cutoffs.test,
    },
  };
}

const props = { status: 'idle' as const, progress: null, error: null, canRun: true, groupingReady: true, onRun: vi.fn(), onCancel: vi.fn(), onDownload: vi.fn() };

describe('【用户要求】Deep RSA 第 6 步「特征深挖」：定义、步骤、一节一节点开', { timeout: 60_000 }, () => {
  it('没跑过：先给三个特征的定义与四步操作；点「开始深挖」触发运行；下载按钮灰着', () => {
    const onRun = vi.fn();
    render(<FeatureDeepDivePanel {...props} result={null} onRun={onRun} />);
    expect(screen.getByTestId('deep-dive-def-taker_imb_w')).toHaveTextContent('加权主动买卖失衡');
    expect(screen.getByTestId('deep-dive-def-taker_imb_shift_w')).toHaveTextContent('失衡的近期偏移');
    expect(screen.getByTestId('deep-dive-def-vwap12_dev')).toHaveTextContent('谢林候选 a · 偏离 12h VWAP');
    expect(screen.getByTestId('deep-dive-def-poc_dev_w')).toHaveTextContent('谢林候选 b · 偏离成交密集区 POC');
    fireEvent.click(screen.getByTestId('deep-dive-run'));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('deep-dive-download')).toBeDisabled();
    expect(screen.queryByTestId('deep-dive-section-A')).toBeNull();
  });

  it('跑完：A → G 一节一节点开，每节先写「怎么读」；B 节 12 行；最后有结论', () => {
    render(<FeatureDeepDivePanel {...props} result={result()} />);
    expect(screen.getByTestId('deep-dive-section-A')).toHaveTextContent('怎么读');
    fireEvent.click(screen.getByTestId('deep-dive-next'));
    const b = screen.getByTestId('deep-dive-section-B');
    expect(within(b).getAllByText(/24h 期末收益|24h 最大涨幅|24h 最大跌幅/).length).toBeGreaterThanOrEqual(12);
    expect(within(b).getByTestId('deep-dive-assoc-taker_imb_w-endRet')).toBeInTheDocument();
    for (const id of ['C', 'D', 'E', 'F', 'G']) {
      fireEvent.click(screen.getByTestId(`deep-dive-tab-${id}`));
      expect(screen.getByTestId(`deep-dive-section-${id}`)).toHaveTextContent('怎么读');
    }
    expect(screen.getByTestId('deep-dive-conclusion')).toHaveTextContent(/已验证|检验未获支持/);
    expect(screen.getByTestId('deep-dive-download')).not.toBeDisabled();
  });
});
