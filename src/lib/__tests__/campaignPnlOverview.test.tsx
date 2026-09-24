import { fireEvent, render, screen, within } from '@testing-library/react';
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
 * 已实现 200、L 100 → b = 200%；P 统一 50% → E = +0.50R；G = 1 + 2×0.1 = 1.20。
 * 【用户要求】主力涨幅 +20% → 涨幅效率 = 20 ÷ 10 = +2.00；加仓效率 = b 2.00 ÷ 2.00 = +1.00（只拿主力不加仓的基准）。
 */
// 【用户要求】先左栏（结果与仓位）、再右栏：预期回撤 → 涨幅 → 涨幅效率 → 盈亏比 → 加仓效率 → 几何期望 → 算术期望，
// 与战役封面、排序栏同序，放在同一列（层层递进）。
const GOLDEN_LABELS = [
  '已实现 P&L',
  '峰值浮盈',
  '杠杆倍数',
  '主力开仓名义仓位',
  '最大预期亏损',
  '本场 b 对 DSI/USI 的贡献',
  '预期回撤',
  '涨幅',
  '涨幅效率',
  '盈亏比',
  '加仓效率',
  '几何期望',
  '算术期望',
];

const GOLDEN_KEYS = [
  'realizedPnl',
  'peakUnrealizedPnl',
  'mainLeverage',
  'initialMainExposureNotional',
  'initialExpectedMaxLoss',
  'asymmetricRiskContribution',
  'expectedMaxDrawdownPct',
  'mainPriceChange',
  'mainPriceEfficiency',
  'payoffRatio',
  'addEfficiency',
  'geometricExpectancy',
  'arithmeticExpectancy',
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
    mainPriceChangePct: 20,
    hasMainAdd: true,
    asymmetricRiskContribution: { group: 'win', sampleCount: 1, meanSquareTerm: 4, meanSquareShare: 1 },
    arithmeticExpectancy: 0.5,
    geometricExpectancy: 0.2,
    initialRisk: { drawdownFraction: 0.01, source: 'main_open_snapshot' },
    ...overrides,
  };
}

describe('buildCampaignPnlOverviewItems', () => {
  it('输出 13 项（原 12 项 + 涨幅 / 涨幅效率 / 加仓效率 − 今日账户总资产 − 机会质量）：键、标签、值、着色、右列', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics());

    expect(items.map(item => item.key)).toEqual(GOLDEN_KEYS);
    expect(items.map(item => item.label)).toEqual(GOLDEN_LABELS);
    expect(items.map(item => item.value)).toEqual([
      '200.00 USDT',
      '250.50',
      '1x',
      '1000.00 USDT',
      '100.00 USDT',
      'USI · b²/n = 4.0000（组内 100.0%）',
      '10.00%',
      '+20.00%',
      '+2.00',
      '200.0%（2.00）',
      '+1.00',
      '1.20',
      '+0.50R',
    ]);
    expect(items.map(item => item.color)).toEqual([
      '#0ECB81',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '#0ECB81',
      '#0ECB81',
      '#0ECB81',
      '#0ECB81',
      '#0ECB81',
      '#0ECB81',
    ]);
    expect(items.map(item => item.valueClassName)).toEqual([
      'text-[#0ECB81]',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'text-[#0ECB81]',
      'text-[#0ECB81]',
      'text-[#0ECB81]',
      'text-[#0ECB81]',
      'text-[#0ECB81]',
      'text-[#0ECB81]',
    ]);
    expect(items.map(item => item.rightColumn ?? false)).toEqual([
      // 左栏 6 项（结果与仓位），右栏 7 项（递进链）；两栏排 7 行
      false, false, false, false, false, false,
      true, true, true, true, true, true, true,
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
      arithmeticExpectancy: null,
      geometricExpectancy: null,
      initialRisk: null,
      mainPriceChangePct: null,
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

  it('【用户要求】没有加仓的战役不算加仓效率：印「—」，说明里写明原因；涨幅与涨幅效率照算', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({ hasMainAdd: false }));
    const byKey = Object.fromEntries(items.map(item => [item.key, item]));
    expect(byKey.addEfficiency.value).toBe('—');
    expect(byKey.mainPriceChange.value).toBe('+20.00%');
    expect(byKey.mainPriceEfficiency.value).toBe('+2.00');
    const { container } = render(<>{byKey.addEfficiency.help}</>);
    expect(container.textContent).toContain('本场没有加仓，不计算加仓效率。');
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
  it('渲染 13 个「{label}说明」按钮（同顺序）与原版帮助文案；DOM 与原内联版本一致', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics());
    const { container } = render(
      <CampaignPnlOverviewPanel title="盈亏概览" items={items} note="期望口径：2 场有效战役，实时胜率 50.00%。" />,
    );

    expect(screen.getByText('盈亏概览')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button').map(button => button.getAttribute('aria-label'));
    expect(buttons).toEqual(GOLDEN_LABELS.map(label => `${label}说明`));
    expect(container.querySelector('.grid.grid-cols-1.gap-x-8.gap-y-2.sm\\:grid-cols-2')).not.toBeNull();
    // 【用户要求】递进链七项同在右栏、从上往下排；左栏六项。每项按本栏序号落行，左右同一行齐平
    expect([...container.querySelectorAll('.sm\\:col-start-2')].map(node => node.firstElementChild?.textContent))
      .toEqual(['预期回撤', '涨幅', '涨幅效率', '盈亏比', '加仓效率', '几何期望', '算术期望']);
    expect([...container.querySelectorAll('.sm\\:col-start-1')].map(node => node.firstElementChild?.textContent))
      .toEqual(['已实现 P&L', '峰值浮盈', '杠杆倍数', '主力开仓名义仓位', '最大预期亏损', '本场 b 对 DSI/USI 的贡献']);
    const rowOf = (label: string) => [...container.querySelectorAll('[data-column]')]
      .find(node => node.firstElementChild?.textContent === label)?.className.match(/sm:row-start-(\d+)/)?.[1];
    expect(rowOf('已实现 P&L')).toBe('1');
    expect(rowOf('预期回撤')).toBe('1');
    expect(rowOf('本场 b 对 DSI/USI 的贡献')).toBe('6');
    expect(rowOf('算术期望')).toBe('7');
    expect(screen.getByText('期望口径：2 场有效战役，实时胜率 50.00%。')).toBeInTheDocument();
    // 标题直接是卡片的第一个子节点（不套 flex 行），紧跟 13 项网格与脚注，没有别的行
    expect(container.firstElementChild?.firstElementChild).toHaveTextContent('盈亏概览');
    // 标题单行截断、悬停看全名：反事实分支名最长 20 字，并排的窄栏里折行会让面板比上方「盈亏概览」高一行
    expect(container.firstElementChild?.firstElementChild?.className).toBe('truncate font-medium');
    expect(container.firstElementChild?.firstElementChild?.getAttribute('title')).toBe('盈亏概览');
    expect(container.firstElementChild?.children).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: '算术期望说明' }));
    expect(screen.getByText('本场：50.00% × 2.00 − 50.00%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '几何期望说明' }));
    expect(screen.getByText('本场 x = 1.00%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '本场 b 对 DSI/USI 的贡献说明' }));
    expect(screen.getByText('本场 b = 2.00，n = 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已实现 P&L说明' }));
    expect(screen.getByText('复盘快照')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '涨幅效率说明' }));
    expect(screen.getByText('本场 = +20.00% ÷ 10.00% = +2.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加仓效率说明' }));
    expect(screen.getByText('本场 = 2.00 ÷ +2.00 = +1.00')).toBeInTheDocument();
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

  it('helpOverrides 整段替换、extraNotes 追加在标准文案之后；testId 落在卡片上，卡片里只有 13 个说明按钮', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      helpOverrides: { realizedPnl: ['替换后的说明', { formula: 'P&L = Σ 手动腿' }] },
      extraNotes: { peakUnrealizedPnl: [{ warning: '按 1h K 线估计' }] },
    }));
    render(
      <CampaignPnlOverviewPanel
        title="反事实盈亏概览 · 未保存"
        items={items}
        note="脚注"
        testId="counterfactual-draft-overview"
      />,
    );
    const panel = screen.getByTestId('counterfactual-draft-overview');
    expect(panel.firstElementChild).toHaveTextContent('反事实盈亏概览 · 未保存');
    // 「相对实际」与 保存 / 丢弃 挪到了左边的「相对原始的变化情况」：面板里只剩 13 个说明按钮
    expect(within(panel).getAllByRole('button').map(button => button.getAttribute('aria-label')))
      .toEqual(GOLDEN_LABELS.map(label => `${label}说明`));
    expect(panel).not.toHaveTextContent('相对实际');

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
  const base = { initialRiskSource: null } as const;

  it('【用户要求】期望口径：算术期望的胜率统一取 50%，不再等账户样本、不写实时胜率', () => {
    expect(buildCampaignPnlOverviewNote(base)).toBe('期望口径：算术期望的胜率统一取 50%。');
  });

  it('资产分母来源的补充句跟着 initialRiskSource 走', () => {
    expect(buildCampaignPnlOverviewNote({ initialRiskSource: 'main_open_snapshot' }))
      .toBe('期望口径：算术期望的胜率统一取 50%。 本场几何期望的资产分母使用主力开仓实时总资产快照。');
    expect(buildCampaignPnlOverviewNote({ initialRiskSource: 'current_account_fallback' }))
      .toBe('期望口径：算术期望的胜率统一取 50%。 本场几何期望的资产分母使用今日当前总账户资产估算。');
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
