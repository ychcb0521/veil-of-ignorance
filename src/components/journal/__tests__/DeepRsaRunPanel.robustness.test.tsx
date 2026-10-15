import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeepRsaRunPanel } from '@/components/journal/DeepRsaRunPanel';
import type { DeepRsaRunResult } from '@/lib/deepRsa/pipeline';
import type { RobustnessCheckId, RobustnessResult } from '@/lib/deepRsa/robustness';

const check = (id: RobustnessCheckId, period: 'discovery' | 'test', rho: number, p: number, extra = {}) =>
  ({ check: id, period, rho, p, nEvents: period === 'discovery' ? 420 : 110, nPairs: 1000, permutations: 1999, ...extra });

const robustness: RobustnessResult = {
  alpha: 0.05,
  rows: [{
    representation: 'schelling', target: 'outcome', halfLifeHours: 6,
    checks: [
      check('volPartial', 'discovery', 0.02, 0.31), check('volPartial', 'test', 0.01, 0.42),
      check('campaignOnly', 'discovery', 0.12, 0.004), check('campaignOnly', 'test', 0.1, 0.03),
      check('endRet', 'discovery', 0.01, 0.4), check('endRet', 'test', -0.02, 0.7),
      check('maxDown', 'discovery', 0.15, 0.001), check('maxDown', 'test', 0.13, 0.002),
      check('symbolBlocks', 'discovery', 0.12, 0.02, { movable: 380 }), check('symbolBlocks', 'test', 0.1, 0.09, { movable: 64 }),
    ],
  }],
  labelsAllPeriods: {
    rsa: [
      { representation: 'price', halfLifeHours: 6, rho: 0.01, p: 0.4, nEvents: 60, nPos: 11, nCtl: 49 },
      { representation: 'orderFlow', halfLifeHours: 2, rho: 0.03, p: 0.2, nEvents: 60, nPos: 11, nCtl: 49 },
      { representation: 'schelling', halfLifeHours: 12, rho: -0.01, p: 0.6, nEvents: 60, nPos: 11, nCtl: 49 },
    ],
    contrast: { halfLifeHours: 6, rows: [{ key: 'taker_imb_w', posMean: 0.05, ctlMean: -0.01, smd: 0.6, nPos: 11, nCtl: 49 }] },
  },
};

function result(withRobustness: boolean): DeepRsaRunResult {
  return {
    codeVersion: 'veil-build:test', startedAt: 0, finishedAt: Date.parse('2026-10-15T08:00:00Z'), seed: 1, permutations: 1999,
    coverage: {
      campaigns: 300, clusters: 220, labeled: { positive: 6, control: 40 }, background: 150, fetched: 366, failed: [],
      lowCoverage: 2, outcomeMissing: 0, missingTakerEvents: 0,
    },
    split: { train: 300, val: 100, test: 110, embargoed: 10, valCut: null, testCut: null },
    featureContrast: { halfLifeHours: 6, rows: [] },
    panel: [],
    selection: [],
    oos: [{ representation: 'schelling', target: 'outcome', halfLifeHours: 6, rho: 0.11, p: 0.004, pHolm: 0.004, nEvents: 110, verdict: '已验证' }],
    ...(withRobustness ? { robustness } : {}),
    backtest: { skippedReason: '标签目标没有样本外通过，不进入交易回测' },
    conclusions: { rsa: '已验证', backtest: '检验未获支持' },
  };
}

const props = { status: 'idle' as const, progress: null, error: null, plannedItems: 0, canRun: true, onRun: () => {}, onCancel: () => {}, onDownload: () => {} };

describe('Deep RSA 运行结果 · 稳健性检验（不改判定）', () => {
  it('5 项检验逐行列出发现期 / 测试期 ρ 与 p，读法按测试期；阴性对照显著时报警', () => {
    render(<DeepRsaRunPanel {...props} result={result(true)} />);
    expect(screen.getByText('稳健性检验（不改判定）')).toBeInTheDocument();
    const row = (title: string) => screen.getByText(title).closest('tr')!;
    expect(within(row('① 控制波动率')).getAllByText('剔除波动率后不显著：主要由波动率解释')).toHaveLength(2); // 桌面列 + 手机行内
    expect(within(row('② 只看战役时点')).getAllByText(/只看战役仍显著/)).toHaveLength(2);
    expect(within(row('③ 换目标：24h 期末收益')).getAllByText(/看不到方向信息/)).toHaveLength(2);
    expect(within(row('③ 阴性对照：24h 最大跌幅')).getAllByText(/多半是在说波动大小/)).toHaveLength(2);
    const blocks = row('④ 按标的分块置换');
    expect(within(blocks).getAllByText(/p 值主要被同币相关撑起来/)).toHaveLength(2);
    expect(blocks.textContent).toContain('可在币内互换 64 个');
    expect(blocks.textContent).toContain('420 / 110');
    expect(screen.getByText(/⑤ 标签用全部时间段/).textContent).toContain('正 11 · 对照 49');
    // 判定照旧
    expect(screen.getAllByText('已验证').length).toBeGreaterThan(0);
  });

  it('旧版结果没有稳健性检验：不显示这一节', () => {
    render(<DeepRsaRunPanel {...props} result={result(false)} />);
    expect(screen.queryByText('稳健性检验（不改判定）')).toBeNull();
  });
});
