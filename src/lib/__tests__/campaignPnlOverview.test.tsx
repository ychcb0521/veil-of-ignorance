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
// 【用户要求】盈亏比与已实现 P&L 分别置顶左右栏；其余递进指标与结果 / 仓位指标依序向下。
const GOLDEN_LABELS = [
  '算术期望',
  '预期回撤',
  '涨跌幅',
  '涨跌幅倍数',
  '盈亏比',
  '加仓效用',
  '几何期望',
  '已实现 P&L',
  '最大预期亏损',
  '峰值涨幅',
  '峰值涨幅倍数',
  '涨幅未兑现',
  '动态最大回撤',
  '仓位放大',
];

const GOLDEN_KEYS = [
  'arithmeticExpectancy',
  'expectedMaxDrawdownPct',
  'mainPriceChange',
  'mainPriceEfficiency',
  'payoffRatio',
  'addEfficiency',
  'geometricExpectancy',
  'realizedPnl',
  'initialExpectedMaxLoss',
  'peakPriceChange',
  'peakPriceEfficiency',
  'unrealizedPriceChangePct',
  'dynamicMaxDrawdownPct',
  'positionAmplification',
];

function winnerMetrics(overrides: Partial<CampaignPnlOverviewMetrics> = {}): CampaignPnlOverviewMetrics {
  return {
    realizedPnl: 200,
    settlement: { basis: 'leg_snapshots', stored: 200, drift: null },
    mainLeverage: 1,
    initialMainExposureNotional: 1000,
    peakUnrealizedPnl: 250.5,
    peakPriceChangePct: 25,
    dynamicMaxDrawdownPct: 12.5,
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
      '+0.50R',
      '10.00%',
      '+20.00%',
      '+2.00',
      '2.00',
      '+1.00',
      '1.20',
      '200.00 USDT',
      '100.00 USDT',
      '+25.00%',
      '+2.50',
      '5.00%',
      '12.50%',
      '1.50x',
    ]);
    const G = '#0ECB81';
    const R = '#F6465D';
    expect(items.map(item => item.color)).toEqual([
      G, undefined, G, G, G, G, G,
      G, undefined, G, G, '#181A20', '#181A20', undefined,
    ]);
    const T = 'text-[#0ECB81]';
    expect(items.map(item => item.valueClassName)).toEqual([
      T, undefined, T, T, T, T, T,
      T, undefined, T, T, 'text-foreground', 'text-foreground', undefined,
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
      peakPriceChangePct: null,
      dynamicMaxDrawdownPct: null,
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
    for (const key of GOLDEN_KEYS) {
      expect(byKey[key].value, key).toBe('—');
    }
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
    // 已实现 -0.3、L 100 → b = -0.003：盈亏比读「0.00」，加仓效用 / 算术期望的说明里也只能是「0.00」
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      payoffRatio: -0.3,
      asymmetricRiskContribution: { group: 'loss', sampleCount: 1, meanSquareTerm: 0, meanSquareShare: 1 },
    }));
    const byKey = Object.fromEntries(items.map(item => [item.key, item]));
    expect(byKey.payoffRatio.value).toBe('0.00');
    for (const key of ['addEfficiency', 'arithmeticExpectancy']) {
      const text = render(<>{byKey[key].help}</>).container.textContent ?? '';
      expect(text, key).not.toContain('-0.00');
    }
    expect(render(<>{byKey.addEfficiency.help}</>).container.textContent).toContain('本场 = 0.00 ÷ |+2.00|');
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
    // 【用户要求】「命名和对应的数字离得太远」：栏宽按内容定（max-content），不撑满半张卡；两栏之间 64px
    const grid = container.querySelector('[data-column]')!.parentElement!;
    // 【用户要求】「空隙不好看」：左栏贴左、右栏贴右，富余落在中间那一列，正中一道淡竖线（至少 64px）
    expect(grid).toHaveClass('grid-cols-[minmax(0,max-content)]', '[@container(min-width:540px)]:grid-cols-[max-content_minmax(64px,1fr)_max-content]');
    const divider = container.querySelector('[data-testid="pnl-overview-column-divider"]') as HTMLElement;
    expect(divider).toHaveClass('hidden', '[@container(min-width:540px)]:col-start-2', '[@container(min-width:540px)]:block');
    expect(divider.style.gridRow).toBe('1 / span 7');
    expect(container.querySelector('[data-column="right"]')).toHaveClass('[@container(min-width:540px)]:col-start-3');
    expect(grid.className).not.toContain('grid-cols-2 ');
    expect(container.querySelector('[data-column]')).toHaveClass('gap-6');
    // 【用户要求】左右对调：递进链七项在左栏、结果与仓位七项在右栏，各自从上往下排；每项按本栏序号落行，左右同一行齐平
    expect([...container.querySelectorAll('[data-column="left"]')].map(node => node.firstElementChild?.textContent))
      .toEqual(['算术期望', '预期回撤', '涨跌幅', '涨跌幅倍数', '盈亏比', '加仓效用', '几何期望']);
    expect([...container.querySelectorAll('[data-column="right"]')].map(node => node.firstElementChild?.textContent))
      .toEqual(['已实现 P&L', '最大预期亏损', '峰值涨幅', '峰值涨幅倍数', '涨幅未兑现', '动态最大回撤', '仓位放大']);
    const rowOf = (label: string) => [...container.querySelectorAll('[data-column]')]
      .find(node => node.firstElementChild?.textContent === label)?.className.match(/:row-start-(\d+)/)?.[1];
    expect(rowOf('算术期望')).toBe('1');
    expect(rowOf('预期回撤')).toBe('2');
    expect(rowOf('盈亏比')).toBe('5');
    expect(rowOf('已实现 P&L')).toBe('1');
    expect(rowOf('最大预期亏损')).toBe('2');
    expect(rowOf('峰值涨幅')).toBe('3');
    expect(rowOf('峰值涨幅倍数')).toBe('4');
    expect(rowOf('涨幅未兑现')).toBe('5');
    expect(rowOf('仓位放大')).toBe('7');
    expect(rowOf('几何期望')).toBe('7');
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
    fireEvent.click(screen.getByRole('button', { name: '已实现 P&L说明' }));
    expect(screen.getByText('复盘快照')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '涨跌幅倍数说明' }));
    expect(screen.getByText('本场 = +20.00% ÷ 10.00% = +2.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加仓效用说明' }));
    expect(screen.getByText('本场 = 2.00 ÷ |+2.00| = +1.00')).toBeInTheDocument();
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
      extraNotes: { unrealizedPriceChangePct: [{ warning: '按 1h K 线估计' }] },
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

    fireEvent.click(screen.getByRole('button', { name: '涨幅未兑现说明' }));
    expect(screen.getByText(/涨幅未兑现 = 峰值涨幅 − 涨跌幅/)).toBeInTheDocument();
    expect(screen.getByText('按 1h K 线估计')).toHaveClass('text-[#F0B90B]');
  });
});

describe('【用户要求】盈亏概览：峰值价格指标、涨幅未兑现与几何期望', () => {
  const byKey = (overrides: Partial<CampaignPnlOverviewMetrics> = {}) =>
    Object.fromEntries(buildCampaignPnlOverviewItems(winnerMetrics(overrides)).map(item => [item.key, item]));
  const helpText = (help: ReactNode) => render(<>{help}</>).container.textContent ?? '';

  it('峰值涨幅、峰值涨幅倍数与涨幅未兑现使用同一价格路径；没有路径时均为「—」', () => {
    expect(byKey().peakPriceChange.value).toBe('+25.00%');
    expect(byKey().peakPriceEfficiency.value).toBe('+2.50');
    expect(byKey({ peakPriceChangePct: null }).peakPriceChange.value).toBe('—');
    expect(byKey({ peakPriceChangePct: null }).peakPriceEfficiency.value).toBe('—');
    expect(byKey({ peakPriceChangePct: null }).unrealizedPriceChangePct.value).toBe('—');
  });

  it('涨幅未兑现 = 25% − 20% = 5%；不超过两倍预期回撤用正文色，超过才用风险色', () => {
    expect(byKey().unrealizedPriceChangePct.value).toBe('5.00%');
    expect(byKey().unrealizedPriceChangePct.color).toBe('#181A20');
    expect(byKey({ mainPriceChangePct: 5 }).unrealizedPriceChangePct.color).toBe('#181A20');
    expect(byKey({ mainPriceChangePct: 4.99 }).unrealizedPriceChangePct.color).toBe('#F6465D');
    expect(byKey({ mainPriceChangePct: 25 }).unrealizedPriceChangePct.value).toBe('0.00%');
    expect(byKey({ mainPriceChangePct: 30 }).unrealizedPriceChangePct.value).toBe('-5.00%');
    expect(byKey({ mainPriceChangePct: 30 }).unrealizedPriceChangePct.color).toBe('#181A20');
    expect(byKey({ peakPriceChangePct: 0 }).unrealizedPriceChangePct.value).toBe('-20.00%');
    expect(byKey({ peakPriceChangePct: 10, expectedMaxDrawdownPct: 10 }).unrealizedPriceChangePct.value).not.toBe('—');
    expect(byKey({ peakPriceChangePct: 9.99, expectedMaxDrawdownPct: 10 }).unrealizedPriceChangePct.value).not.toBe('—');
    expect(byKey({ peakPriceChangePct: 10.01, expectedMaxDrawdownPct: 10 }).unrealizedPriceChangePct.value).not.toBe('—');
  });

  it('几何期望的说明写明本场资产分母用的是哪一种（原来在脚注里）', () => {
    expect(helpText(byKey().geometricExpectancy.help)).toContain('本场的资产分母：主力开仓那一刻的账户总资产快照。');
    expect(helpText(byKey({ initialRisk: { drawdownFraction: 0.01, source: 'current_account_fallback' } }).geometricExpectancy.help))
      .toContain('本场的资产分母：这场没有开仓时的资产快照，用今日当前总账户资产估算。');
  });
});
