import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { CampaignPnlOverviewPanel } from '@/components/journal/CampaignPnlOverviewPanel';
import {
  buildCampaignPnlOverviewItems,
  pnlColor,
  pnlExportColor,
  type CampaignPnlOverviewMetrics,
} from '@/lib/campaignPnlOverview';

/**
 * 黄金样本：与详情页内联版本（提取前）在 metrics 页面测试那场「winner」战役上的输出逐字对照。
 * 已实现 200、L 100 → b = 200%；P 统一 50% → E = +0.50R；G = 1 + 2×0.1 = 1.20。
 * 【用户要求】主力涨跌幅 +20% → 涨跌幅倍数 = 20 ÷ 10 = +2.00；加仓效用 = b 2.00 ÷ 2.00 = +1.00（只拿主力不加仓的基准）。
 */
// 【用户要求】左右两列对调：左栏是递进链 预期回撤 → 涨跌幅 → 涨跌幅倍数 → 盈亏比 → 加仓效用 → 几何期望 → 算术期望
// （与战役封面、排序栏同序）；右栏是结果与仓位：最大预期亏损、已实现 P&L、主力开仓名义仓位、多方总名义仓位……
const GOLDEN_LABELS = [
  '预期回撤',
  '涨跌幅',
  '涨跌幅倍数',
  '盈亏比',
  '加仓效用',
  '几何期望',
  '算术期望',
  '最大预期亏损',
  '已实现 P&L',
  '峰值浮盈',
  '主力开仓名义仓位',
  '多方总名义仓位',
  '杠杆倍数',
  'DSI/USI 贡献',
];

const GOLDEN_KEYS = [
  'expectedMaxDrawdownPct',
  'mainPriceChange',
  'mainPriceEfficiency',
  'payoffRatio',
  'addEfficiency',
  'geometricExpectancy',
  'arithmeticExpectancy',
  'initialExpectedMaxLoss',
  'realizedPnl',
  'peakUnrealizedPnl',
  'initialMainExposureNotional',
  'mainSideNotional',
  'mainLeverage',
  'asymmetricRiskContribution',
];

function winnerMetrics(overrides: Partial<CampaignPnlOverviewMetrics> = {}): CampaignPnlOverviewMetrics {
  return {
    realizedPnl: 200,
    settlement: { basis: 'leg_snapshots', stored: 200, drift: null },
    mainLeverage: 1,
    initialMainExposureNotional: 1000,
    peakUnrealizedPnl: 250.5,
    initialExpectedMaxLoss: 100,
    mainSideNotional: { side: 'long', total: 1500 },
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
  it('输出 14 项（新增多方总名义仓位）：键、标签、值、着色、分栏', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics());

    expect(items.map(item => item.key)).toEqual(GOLDEN_KEYS);
    expect(items.map(item => item.label)).toEqual(GOLDEN_LABELS);
    expect(items.map(item => item.value)).toEqual([
      '10.00%',
      '+20.00%',
      '+2.00',
      '2.00',
      '+1.00',
      '1.20',
      '+0.50R',
      '100.00 USDT',
      '200.00 USDT',
      '250.50 USDT',
      '1000.00 USDT',
      '1500.00 USDT',
      '1x',
      'USI 100.0%',
    ]);
    const G = '#0ECB81';
    expect(items.map(item => item.color)).toEqual([
      undefined, G, G, G, G, G, G,
      undefined, G, undefined, undefined, undefined, undefined, undefined,
    ]);
    const T = 'text-[#0ECB81]';
    expect(items.map(item => item.valueClassName)).toEqual([
      undefined, T, T, T, T, T, T,
      undefined, T, undefined, undefined, undefined, undefined, undefined,
    ]);
    expect(items.map(item => item.rightColumn ?? false)).toEqual([
      // 左栏 7 项（递进链），右栏 7 项（结果与仓位）；两栏排 7 行
      false, false, false, false, false, false, false,
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
      mainSideNotional: null,
    }));
    const byKey = Object.fromEntries(items.map(item => [item.key, item]));
    for (const key of GOLDEN_KEYS.filter(item => item !== 'peakUnrealizedPnl')) {
      expect(byKey[key].value, key).toBe('—');
    }
    // 【用户要求】峰值浮盈带单位；0 就印 0.00 USDT
    expect(byKey.peakUnrealizedPnl.value).toBe('0.00 USDT');
    expect(byKey.realizedPnl.color).toBe('#64748B');
    expect(byKey.realizedPnl.valueClassName).toBe('text-muted-foreground');
    expect(byKey.payoffRatio.color).toBe('#64748B');
  });

  it('【用户要求】没有加仓的战役不算加仓效用：印「—」，说明里写明原因；涨跌幅与涨跌幅倍数照算', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({ hasMainAdd: false }));
    const byKey = Object.fromEntries(items.map(item => [item.key, item]));
    expect(byKey.addEfficiency.value).toBe('—');
    expect(byKey.mainPriceChange.value).toBe('+20.00%');
    expect(byKey.mainPriceEfficiency.value).toBe('+2.00');
    const { container } = render(<>{byKey.addEfficiency.help}</>);
    expect(container.textContent).toContain('本场没有加仓，不计算加仓效用。');
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
    expect(byKey.payoffRatio.value).toBe('-0.50');
    expect(byKey.payoffRatio.valueClassName).toBe('text-[#F6465D]');
    expect(byKey.arithmeticExpectancy.value).toBe('-0.75R');
    expect(byKey.geometricExpectancy.value).toBe('0.95');
  });

  it('【用户要求】盈亏比只写两位小数的 b：取整为 0.00 的读数用中性色，颜色跟着读者看到的数走（同涨跌幅倍数）', () => {
    // 已实现 -3、L 1000 → b = -0.003，读数「0.00」：不能是红色的 0.00
    for (const payoffRatio of [-0.3, 0.3, -0.49]) {
      const byKey = Object.fromEntries(buildCampaignPnlOverviewItems(winnerMetrics({ payoffRatio })).map(item => [item.key, item]));
      expect(byKey.payoffRatio.value, String(payoffRatio)).toBe('0.00');
      expect(byKey.payoffRatio.valueClassName, String(payoffRatio)).toBe('text-muted-foreground');
      expect(byKey.payoffRatio.color, String(payoffRatio)).toBe('#64748B');
    }
    // 取整后不为 0 的仍按正负上色
    const loss = Object.fromEntries(buildCampaignPnlOverviewItems(winnerMetrics({ payoffRatio: -0.6 })).map(item => [item.key, item]));
    expect(loss.payoffRatio.value).toBe('-0.01');
    expect(loss.payoffRatio.valueClassName).toBe('text-[#F6465D]');
    expect(loss.payoffRatio.color).toBe('#F6465D');
  });

  it('【用户要求】说明（ⓘ）里引用的 b 与盈亏比读数同一个写法：取整为 0 写 0.00，不写 -0.00', () => {
    // 已实现 -0.3、L 100 → b = -0.003：盈亏比读「0.00」，加仓效用 / DSI 贡献 / 算术期望的说明里也只能是「0.00」
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      payoffRatio: -0.3,
      asymmetricRiskContribution: { group: 'loss', sampleCount: 1, meanSquareTerm: 0, meanSquareShare: 1 },
    }));
    const byKey = Object.fromEntries(items.map(item => [item.key, item]));
    expect(byKey.payoffRatio.value).toBe('0.00');
    for (const key of ['addEfficiency', 'asymmetricRiskContribution', 'arithmeticExpectancy']) {
      const text = render(<>{byKey[key].help}</>).container.textContent ?? '';
      expect(text, key).not.toContain('-0.00');
    }
    expect(render(<>{byKey.addEfficiency.help}</>).container.textContent).toContain('本场 = 0.00 ÷ +2.00');
    expect(render(<>{byKey.asymmetricRiskContribution.help}</>).container.textContent).toContain('本场：DSI 下行组，b = 0.00，');
    expect(render(<>{byKey.arithmeticExpectancy.help}</>).container.textContent).toContain('本场：50.00% × 0.00 − 50.00%');
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
  it('渲染 14 个「{label}说明」按钮（同顺序）与原版帮助文案；DOM 与原内联版本一致', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics());
    const { container } = render(
      <CampaignPnlOverviewPanel title="盈亏概览" items={items} />,
    );

    expect(screen.getByText('盈亏概览')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button').map(button => button.getAttribute('aria-label'));
    expect(buttons).toEqual(GOLDEN_LABELS.map(label => `${label}说明`));
    // 两栏还是一栏看面板自己的宽度（容器查询）：面板内容宽 ≥ 540px 才并排
    expect(container.firstElementChild).toHaveClass('[container-type:inline-size]');
    expect(container.querySelector('.grid.grid-cols-1.gap-x-8.gap-y-2')).toHaveClass('[@container(min-width:540px)]:grid-cols-2');
    // 【用户要求】左右对调：递进链七项在左栏、结果与仓位七项在右栏，各自从上往下排；每项按本栏序号落行，左右同一行齐平
    expect([...container.querySelectorAll('[data-column="left"]')].map(node => node.firstElementChild?.textContent))
      .toEqual(['预期回撤', '涨跌幅', '涨跌幅倍数', '盈亏比', '加仓效用', '几何期望', '算术期望']);
    expect([...container.querySelectorAll('[data-column="right"]')].map(node => node.firstElementChild?.textContent))
      .toEqual(['最大预期亏损', '已实现 P&L', '峰值浮盈', '主力开仓名义仓位', '多方总名义仓位', '杠杆倍数', 'DSI/USI 贡献']);
    const rowOf = (label: string) => [...container.querySelectorAll('[data-column]')]
      .find(node => node.firstElementChild?.textContent === label)?.className.match(/:row-start-(\d+)/)?.[1];
    expect(rowOf('预期回撤')).toBe('1');
    // 【用户要求】最大预期亏损在右栏第一个，与预期回撤同一行
    expect(rowOf('最大预期亏损')).toBe('1');
    expect(rowOf('已实现 P&L')).toBe('2');
    expect(rowOf('峰值浮盈')).toBe('3');
    expect(rowOf('多方总名义仓位')).toBe('5');
    expect(rowOf('DSI/USI 贡献')).toBe('7');
    expect(rowOf('算术期望')).toBe('7');
    // 【用户要求】底部「期望口径」那行脚注删掉
    expect(screen.queryByText(/期望口径/)).not.toBeInTheDocument();
    // 标题直接是卡片的第一个子节点（不套 flex 行），紧跟 13 项网格与脚注，没有别的行
    expect(container.firstElementChild?.firstElementChild).toHaveTextContent('盈亏概览');
    // 标题单行截断、悬停看全名：反事实分支名最长 20 字，并排的窄栏里折行会让面板比上方「盈亏概览」高一行
    expect(container.firstElementChild?.firstElementChild?.className).toBe('truncate font-medium');
    expect(container.firstElementChild?.firstElementChild?.getAttribute('title')).toBe('盈亏概览');
    expect(container.firstElementChild?.children).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '算术期望说明' }));
    expect(screen.getByText('本场：50.00% × 2.00 − 50.00%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '几何期望说明' }));
    expect(screen.getByText('本场 x = 1.00%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'DSI/USI 贡献说明' }));
    expect(screen.getByText(/b = 2\.00，n = 1，b²\/n = 4\.0000，组内占比 100\.00%/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已实现 P&L说明' }));
    expect(screen.getByText('复盘快照')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '涨跌幅倍数说明' }));
    expect(screen.getByText('本场 = +20.00% ÷ 10.00% = +2.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加仓效用说明' }));
    expect(screen.getByText('本场 = 2.00 ÷ +2.00 = +1.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '最大预期亏损说明' }));
    expect(screen.getByText('最大预期亏损 = 主力开仓名义仓位 × 预期回撤比例')).toBeInTheDocument();
  });

  it('已实现 P&L 的落库漂移提示只在 drift 非空时出现', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      settlement: { basis: 'records', stored: 180, drift: -20 },
    }));
    render(<CampaignPnlOverviewPanel title="盈亏概览" items={items} />);
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

describe('【用户要求】盈亏概览简化：DSI/USI 贡献只写组与占比，细节进说明；脚注删掉、资产分母写进几何期望的说明', () => {
  const byKey = (overrides: Partial<CampaignPnlOverviewMetrics> = {}) =>
    Object.fromEntries(buildCampaignPnlOverviewItems(winnerMetrics(overrides)).map(item => [item.key, item]));
  const helpText = (help: ReactNode) => render(<>{help}</>).container.textContent ?? '';

  it('DSI/USI 贡献：读数「USI 12.3%」，不到 0.1% 写「<0.1%」；均方项、b、n 在说明里', () => {
    expect(byKey({ asymmetricRiskContribution: { group: 'win', sampleCount: 7, meanSquareTerm: 0.0498, meanSquareShare: 0.1234 } })
      .asymmetricRiskContribution.value).toBe('USI 12.3%');
    const tiny = byKey({ asymmetricRiskContribution: { group: 'loss', sampleCount: 30, meanSquareTerm: 0.0018, meanSquareShare: 0.0002 } }).asymmetricRiskContribution;
    expect(tiny.value).toBe('DSI <0.1%');
    const text = helpText(tiny.help);
    expect(text).toContain('组内占比 = 本场 b² ÷ 对应组 Σb²');
    expect(text).toContain('本场：DSI 下行组，b = 2.00，n = 30，b²/n = 0.0018，组内占比 0.02%');
    expect(byKey({ asymmetricRiskContribution: null }).asymmetricRiskContribution.value).toBe('—');
  });

  it('峰值浮盈带单位 USDT', () => {
    expect(byKey().peakUnrealizedPnl.value).toBe('250.50 USDT');
  });

  it('几何期望的说明写明本场资产分母用的是哪一种（原来在脚注里）', () => {
    expect(helpText(byKey().geometricExpectancy.help)).toContain('本场的资产分母：主力开仓那一刻的账户总资产快照。');
    expect(helpText(byKey({ initialRisk: { drawdownFraction: 0.01, source: 'current_account_fallback' } }).geometricExpectancy.help))
      .toContain('本场的资产分母：这场没有开仓时的资产快照，用今日当前总账户资产估算。');
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
