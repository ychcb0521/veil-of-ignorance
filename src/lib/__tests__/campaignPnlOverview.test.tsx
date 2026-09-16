import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CampaignPnlOverviewPanel } from '@/components/journal/CampaignPnlOverviewPanel';
import {
  buildCampaignPnlOverviewItems,
  buildCampaignPnlOverviewNote,
  pnlColor,
  pnlExportColor,
  type CampaignPnlOverviewMetrics,
} from '@/lib/campaignPnlOverview';

/**
 * 黄金样本：与详情页内联版本（提取前）在 metrics 页面测试那场「winner」战役上的输出逐字对照。
 * 已实现 200、L 100 → b = 200%；d 10 → Q = 2 ÷ 10 = 0.20；P = 50% → E = +0.50R；G = 1 + 2×0.1 = 1.20。
 */
const GOLDEN_LABELS = [
  '已实现 P&L',
  '杠杆倍数',
  '主力开仓名义仓位',
  '峰值浮盈',
  '最大预期亏损',
  '预期回撤',
  '盈亏比',
  '本场 b 对 DSI/USI 的贡献',
  '机会质量',
  '算术期望',
  '几何期望',
  '今日账户总资产',
];

const GOLDEN_KEYS = [
  'realizedPnl',
  'mainLeverage',
  'initialMainExposureNotional',
  'peakUnrealizedPnl',
  'initialExpectedMaxLoss',
  'expectedMaxDrawdownPct',
  'payoffRatio',
  'asymmetricRiskContribution',
  'opportunityQuality',
  'arithmeticExpectancy',
  'geometricExpectancy',
  'todayAccountEquity',
];

function winnerMetrics(overrides: Partial<CampaignPnlOverviewMetrics> = {}): CampaignPnlOverviewMetrics {
  return {
    realizedPnl: 200,
    settlement: { basis: 'leg_snapshots', stored: 200, drift: null },
    mainLeverage: 1,
    initialMainExposureNotional: 1000,
    peakUnrealizedPnl: 250.5,
    initialExpectedMaxLoss: 100,
    expectedMaxDrawdownPct: 10,
    payoffRatio: 200,
    asymmetricRiskContribution: { group: 'win', sampleCount: 1, meanSquareTerm: 4, meanSquareShare: 1 },
    opportunityQuality: 0.2,
    arithmeticExpectancy: 0.5,
    geometricExpectancy: 0.2,
    initialRisk: { drawdownFraction: 0.01, source: 'main_open_snapshot' },
    todayAccountEquity: 10000,
    expectedWinRate: 0.5,
    ...overrides,
  };
}

describe('buildCampaignPnlOverviewItems', () => {
  it('输出与提取前的详情页完全一致的 12 项：键、标签、值、着色、右列', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics());

    expect(items.map(item => item.key)).toEqual(GOLDEN_KEYS);
    expect(items.map(item => item.label)).toEqual(GOLDEN_LABELS);
    expect(items.map(item => item.value)).toEqual([
      '200.00 USDT',
      '1x',
      '1000.00 USDT',
      '250.50',
      '100.00 USDT',
      '10.00%',
      '200.0%（2.00）',
      'USI · b²/n = 4.0000（组内 100.0%）',
      '0.20',
      '+0.50R',
      '1.20',
      '10000.00 USDT',
    ]);
    expect(items.map(item => item.color)).toEqual([
      '#0ECB81',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '#0ECB81',
      undefined,
      '#0ECB81',
      '#0ECB81',
      '#0ECB81',
      undefined,
    ]);
    expect(items.map(item => item.valueClassName)).toEqual([
      'text-[#0ECB81]',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'text-[#0ECB81]',
      undefined,
      'text-[#0ECB81]',
      'text-[#0ECB81]',
      'text-[#0ECB81]',
      undefined,
    ]);
    expect(items.map(item => item.rightColumn ?? false)).toEqual([
      false, false, false, false, false, false, false, false, false, false, false, true,
    ]);
  });

  it('全空 / 全零输入时每一项都印「—」而不是 0.00，着色退回灰色', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      realizedPnl: null,
      settlement: null,
      mainLeverage: null,
      initialMainExposureNotional: 0,
      peakUnrealizedPnl: 0,
      initialExpectedMaxLoss: 0,
      expectedMaxDrawdownPct: 0,
      payoffRatio: null,
      asymmetricRiskContribution: null,
      opportunityQuality: null,
      arithmeticExpectancy: null,
      geometricExpectancy: null,
      initialRisk: null,
      todayAccountEquity: null,
      expectedWinRate: null,
    }));
    const byKey = Object.fromEntries(items.map(item => [item.key, item]));
    for (const key of GOLDEN_KEYS.filter(item => item !== 'peakUnrealizedPnl')) {
      expect(byKey[key].value, key).toBe('—');
    }
    // 峰值浮盈是纯数字列（原版就没有 USDT 后缀），0 就印 0.00
    expect(byKey.peakUnrealizedPnl.value).toBe('0.00');
    expect(byKey.realizedPnl.color).toBe('#64748B');
    expect(byKey.realizedPnl.valueClassName).toBe('text-muted-foreground');
    expect(byKey.payoffRatio.color).toBe('#64748B');
  });

  it('亏损战役的已实现、盈亏比、期望走红色', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      realizedPnl: -50,
      payoffRatio: -50,
      arithmeticExpectancy: -0.75,
      geometricExpectancy: -0.05,
    }));
    const byKey = Object.fromEntries(items.map(item => [item.key, item]));
    expect(byKey.realizedPnl.value).toBe('-50.00 USDT');
    expect(byKey.realizedPnl.color).toBe('#F6465D');
    expect(byKey.payoffRatio.value).toBe('-50.0%（-0.50）');
    expect(byKey.payoffRatio.valueClassName).toBe('text-[#F6465D]');
    expect(byKey.arithmeticExpectancy.value).toBe('-0.75R');
    expect(byKey.geometricExpectancy.value).toBe('0.95');
  });

  it('pnlColor / pnlExportColor 与原详情页同一张色表', () => {
    expect(pnlColor(1)).toBe('text-[#0ECB81]');
    expect(pnlColor(-1)).toBe('text-[#F6465D]');
    expect(pnlColor(0)).toBe('text-muted-foreground');
    expect(pnlColor(null)).toBe('text-muted-foreground');
    expect(pnlExportColor(1)).toBe('#0ECB81');
    expect(pnlExportColor(-1)).toBe('#F6465D');
    expect(pnlExportColor(0)).toBe('#64748B');
    expect(pnlExportColor(null)).toBe('#64748B');
  });
});

describe('CampaignPnlOverviewPanel', () => {
  it('渲染 12 个「{label}说明」按钮（同顺序）与原版帮助文案；没有 subtitle / actions 时 DOM 与原内联版本一致', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics());
    const { container } = render(
      <CampaignPnlOverviewPanel title="盈亏概览" items={items} note="期望口径：2 场有效战役，实时胜率 50.00%。" />,
    );

    expect(screen.getByText('盈亏概览')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button').map(button => button.getAttribute('aria-label'));
    expect(buttons).toEqual(GOLDEN_LABELS.map(label => `${label}说明`));
    expect(container.querySelector('.grid.grid-cols-1.gap-x-8.gap-y-2.sm\\:grid-cols-2')).not.toBeNull();
    expect(container.querySelector('.sm\\:col-start-2')).toHaveTextContent('今日账户总资产');
    expect(screen.getByText('期望口径：2 场有效战役，实时胜率 50.00%。')).toBeInTheDocument();
    // 标题直接是卡片的第一个子节点（没有 actions 时不套 flex 行）
    expect(container.firstElementChild?.firstElementChild).toHaveTextContent('盈亏概览');
    expect(container.firstElementChild?.firstElementChild?.className).toBe('font-medium');

    fireEvent.click(screen.getByRole('button', { name: '机会质量说明' }));
    expect(screen.getByText(/b\* = max（实际盈亏比 b, 1）；Q = b\* ÷ 预期回撤百分点 d/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '算术期望说明' }));
    expect(screen.getByText('本场：50.00% × 2.00 − 50.00%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '几何期望说明' }));
    expect(screen.getByText('本场 x = 1.00%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '本场 b 对 DSI/USI 的贡献说明' }));
    expect(screen.getByText('本场 b = 2.00，n = 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已实现 P&L说明' }));
    expect(screen.getByText('复盘快照')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '最大预期亏损说明' }));
    expect(screen.getByText('最大预期亏损 = 主力开仓名义仓位 × 预期回撤比例')).toBeInTheDocument();
  });

  it('已实现 P&L 的落库漂移提示只在 drift 非空时出现', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      settlement: { basis: 'records', stored: 180, drift: -20 },
    }));
    render(<CampaignPnlOverviewPanel title="盈亏概览" items={items} note="" />);
    fireEvent.click(screen.getByRole('button', { name: '已实现 P&L说明' }));
    expect(screen.getByText(/落库缓存为 180\.00 USDT，与现算值相差 -20\.00 USDT/)).toBeInTheDocument();
    expect(screen.getByText('成交记录')).toBeInTheDocument();
  });

  it('helpOverrides 整段替换、extraNotes 追加在标准文案之后；subtitle / actions / testId 各就各位', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      helpOverrides: { realizedPnl: ['替换后的说明', { formula: 'P&L = Σ 手动腿' }] },
      extraNotes: { peakUnrealizedPnl: [{ warning: '按 1h K 线估计' }] },
    }));
    render(
      <CampaignPnlOverviewPanel
        title="反事实盈亏概览 · 未保存"
        items={items}
        note="脚注"
        subtitle={<span>相对实际 +12.00 USDT</span>}
        actions={<button type="button">保存</button>}
        testId="counterfactual-draft-panel"
      />,
    );
    expect(screen.getByTestId('counterfactual-draft-panel')).toBeInTheDocument();
    expect(screen.getByText('相对实际 +12.00 USDT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '已实现 P&L说明' }));
    expect(screen.getByText('替换后的说明')).toBeInTheDocument();
    expect(screen.getByText('P&L = Σ 手动腿')).toBeInTheDocument();
    expect(screen.queryByText(/这个数与下方 Legs 表的「合计」行/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '峰值浮盈说明' }));
    expect(screen.getByText(/每根 K 线同时使用最高价和最低价重估/)).toBeInTheDocument();
    expect(screen.getByText('按 1h K 线估计')).toHaveClass('text-[#F0B90B]');
  });
});

describe('buildCampaignPnlOverviewNote', () => {
  const base = {
    performanceLoading: false,
    performanceError: false,
    expectedWinRate: 0.5,
    payoffRatioSampleCount: 2,
    initialRiskSource: null,
  } as const;

  it('四种期望口径文案与原详情页逐字一致', () => {
    expect(buildCampaignPnlOverviewNote({ ...base, performanceLoading: true }))
      .toBe('正在按同一账户的有效战役口径计算期望…');
    expect(buildCampaignPnlOverviewNote({ ...base, performanceError: true }))
      .toBe('暂无可计算期望的有效战役样本。');
    expect(buildCampaignPnlOverviewNote({ ...base, expectedWinRate: null }))
      .toBe('暂无可计算胜率的有效战役样本。');
    expect(buildCampaignPnlOverviewNote(base))
      .toBe('期望口径：2 场有效战役，实时胜率 50.00%。');
  });

  it('资产分母来源的补充句跟着 initialRiskSource 走', () => {
    expect(buildCampaignPnlOverviewNote({ ...base, initialRiskSource: 'main_open_snapshot' }))
      .toBe('期望口径：2 场有效战役，实时胜率 50.00%。 本场几何期望的资产分母使用主力开仓实时总资产快照。');
    expect(buildCampaignPnlOverviewNote({ ...base, initialRiskSource: 'current_account_fallback' }))
      .toBe('期望口径：2 场有效战役，实时胜率 50.00%。 本场几何期望的资产分母使用今日当前总账户资产估算。');
  });
});

describe('峰值浮盈的说明：分刀还原只在本地有成交记录时成立', () => {
  const peakHelp = () => {
    const item = buildCampaignPnlOverviewItems(winnerMetrics()).find(entry => entry.key === 'peakUnrealizedPnl');
    const { container } = render(<>{item?.help}</>);
    return container.textContent ?? '';
  };

  it('「每一刀都计入」带着前提；本地没有成交记录时按 Leg 快照整条还原、峰值可能偏高，这一句写明', () => {
    const help = peakHelp();
    expect(help).toContain('本地有成交记录时，一条腿分几刀平掉（M 减仓、并仓后的镜像止盈），每一刀都计入');
    expect(help).not.toContain('切换仓位状态，一条腿分几刀平掉时每一刀都计入');
    expect(help).toContain('本地没有成交记录时（换了浏览器、清过历史成交），主力 / 镜像腿按 Leg 快照整条还原');
    expect(help).toContain('峰值浮盈可能高于实际峰值');
  });

  it('已结束战役的窗口不早于最后一次平仓；挂着委托 id 的保护单按本地委托记录判定', () => {
    const help = peakHelp();
    expect(help).toContain('已结束的战役从开仓扫到结束时间，但不早于最后一次平仓');
    expect(help).toContain('本地委托记录显示它已撤单或仍挂着时同样按从未成交处理');
  });
});
