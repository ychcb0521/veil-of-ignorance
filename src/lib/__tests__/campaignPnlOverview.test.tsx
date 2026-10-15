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
 * 展示样本：显式输入几何 b = 2；已实现 200、L 100 是独立结算字段，不参与这里的 b 计算。
 * P 统一 50% → 模型 E = +0.50；G = 1 + 2×0.1 = 1.20。
 * 【用户要求】主力首仓涨跌幅 +20% → 首仓涨跌幅倍数 = 20 ÷ 10 = +2.00；加仓效用 = b 2.00 ÷ 2.00 = +1.00（只拿主力不加仓的基准）。
 */
// 用户指定前五项在左列，独立结算 / 峰值 / 仓位等项在右列，保持 9 / 9 对齐。
const GOLDEN_LABELS = ["预期回撤","相对涨幅","加仓次数","几何仓位","神奇的 b","单位涨幅 G","单位利润 U","仓位利润 W","盈亏比","最大预期亏损","已实现 P&L","仓位放大","加仓效用","几何期望","算术期望","首仓涨跌幅","首仓涨跌幅倍数","峰值涨幅","几何增长 W（b）","涨幅未兑现","动态最大回撤"];

const GOLDEN_KEYS = ["expectedMaxDrawdownPct","effectivePriceChangePct","addCount","positionGeometricMultiple","magicB","unitRise","unitProfit","positionProfit","payoffRatio","initialExpectedMaxLoss","realizedPnl","positionAmplification","addEfficiency","geometricExpectancy","arithmeticExpectancy","mainPriceChange","mainPriceEfficiency","peakPriceChange","geometricGrowth","unrealizedPriceChangePct","dynamicMaxDrawdownPct"];

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
    magicB: 2,
    mainPriceChangePct: 20,
    hasMainAdd: true,
    addCount: 1,
    asymmetricRiskContribution: { group: 'win', sampleCount: 1, meanSquareTerm: 4, meanSquareShare: 1 },
    arithmeticExpectancy: 0.5,
    geometricExpectancy: 0.2,
    initialRisk: { drawdownFraction: 0.01, source: 'main_open_snapshot' },
    ...overrides,
  };
}

describe('【用户要求】加仓效用、几何期望、算术期望：括号外基于盈亏比，括号里基于神奇的 b（理论）', () => {
  it('理论 b = 几何仓位（理论）1.5 × 相对涨幅 2.00 = 3：三项括号里按 b = 3 算', () => {
    // 盈亏比 2；首仓涨跌幅 20% ÷ 预期回撤 10% = 2.00
    const items = buildCampaignPnlOverviewItems(winnerMetrics({ positionGeometricMultipleTheoretical: 1.5, effectivePriceChangePct: 200 }));
    const value = (key: string) => items.find(item => item.key === key)!.value;
    expect(value('addEfficiency')).toBe('+1.00（+1.50）');
    expect(value('arithmeticExpectancy')).toBe('+0.50R（+1.00R）');
    expect(value('geometricExpectancy')).toBe('1.20（1.30）');
  });

  it('理论 b 算不出时不加括号', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics());
    expect(items.find(item => item.key === 'geometricExpectancy')!.value).toBe('1.20');
  });
});

describe('buildCampaignPnlOverviewItems', () => {
  it('shows the initial-entry denominator and its substitution in both actual and theoretical b methods', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      positionGeometricMultiple: 3, positionGeometricMultipleTheoretical: 2.5,
      effectivePriceChangePct: 800, magicB: 24,
      geometricMetricBasis: { initialCoins: 10, initialEntryPrice: 100, initialStopPrice: 90, earlyReductionFraction: 0.5,
        addRatios: [5], finalExitPrice: 220, lastSupport: 140 },
    }));
    const riseHelp = render(<>{items.find(item => item.key === 'effectivePriceChangePct')!.help}</>).container;
    expect(riseHelp).toHaveTextContent('相对涨幅 = (F − Kₘ) ÷ (E − K初)');
    expect(riseHelp).toHaveTextContent('(F − Kₘ) ÷ (E − K初) = (220 − 140) ÷ (100 − 90) ≈ 8');
    expect(items.find(item => item.key === 'effectivePriceChangePct')?.value).toBe('8.00×');
    expect(items.find(item => item.key === 'positionGeometricMultiple')?.value).toBe('3.00x（2.50x）');
    expect(items.find(item => item.key === 'magicB')?.value).toBe('24.00（20.00）');
    const help = render(<>{items.find(item => item.key === 'magicB')!.help}</>).container;
    for (const id of ['magic-b-worked', 'magic-b-theoretical-worked']) {
      expect(help.querySelector(`[data-testid="${id}"]`)).toHaveTextContent('(220 − 140) ÷ (100 − 90) ≈ 8');
    }
    expect(help.querySelector('[data-testid="magic-b-worked"]')).toHaveTextContent('≈ 24.00000000');
    expect(help.querySelector('[data-testid="magic-b-theoretical-worked"]')).toHaveTextContent('≈ 20.00000000');
    expect(items.some(item => item.key === 'positionGeometricMultipleTheoretical')).toBe(false);
    const growthHelp = render(<>{items.find(item => item.key === 'positionGeometricMultiple')!.help}</>).container;
    expect(growthHelp.querySelector('[data-testid="position-geometric-theoretical-help"]')).toHaveTextContent('几何仓位（理论） 2.50x');
  });
  it('shows method three with the theoretical multiple and full-precision decimal rise without changing actual b', () => {
    const multiple = 3.141592653589793;
    const rise = 21.4240630332;
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      positionGeometricMultiple: 2, positionGeometricMultipleTheoretical: multiple,
      effectivePriceChangePct: rise, magicB: 2 * rise / 100,
    }));
    const magic = items.find(item => item.key === 'magicB')!;
    expect(magic.value).toBe('0.43（0.67）');
    const help = render(<>{magic.help}</>).container;
    expect(help).toHaveTextContent('方法三 · 神奇的 b（理论）');
    expect(help).toHaveTextContent('神奇的 b（理论） = 几何仓位（理论） × 相对涨幅');
    const worked = help.querySelector('[data-testid="magic-b-theoretical-worked"]');
    expect(worked).toHaveTextContent('b（理论） = 3.14159265359 × 0.214240630332');
    expect(worked).toHaveTextContent(`≈ ${(multiple * rise / 100).toFixed(8)}`);
    expect(worked).not.toHaveTextContent('β');
    expect(worked).not.toHaveTextContent('÷');
    expect(help.querySelector('[data-testid="magic-b-worked"]')).toHaveTextContent(`≈ ${(2 * rise / 100).toFixed(8)}`);
    expect(help.querySelector('[data-testid="magic-b-direct-worked"]')).toBeNull();
  });
  it.each([0, -20])('method three preserves a zero or negative effective rise (%s)', rise => {
    const help = render(<>{buildCampaignPnlOverviewItems(winnerMetrics({
      positionGeometricMultipleTheoretical: 3, effectivePriceChangePct: rise,
    })).find(item => item.key === 'magicB')!.help}</>).container;
    expect(help.querySelector('[data-testid="magic-b-theoretical-worked"]')).toHaveTextContent(`≈ ${(3 * rise / 100).toFixed(8)}`);
  });
  it.each([
    [null, 20], [undefined, 20], [Infinity, 20], [3, null], [3, undefined], [3, NaN],
  ])('method three marks missing/invalid inputs unavailable (%s, %s) without falling back to actual b', (multiple, rise) => {
    const help = render(<>{buildCampaignPnlOverviewItems(winnerMetrics({
      positionGeometricMultiple: 2, positionGeometricMultipleTheoretical: multiple,
      effectivePriceChangePct: rise,
    })).find(item => item.key === 'magicB')!.help}</>).container;
    expect(help.querySelector('[data-testid="magic-b-theoretical-worked"]')).toBeNull();
    expect(help.querySelector('[data-testid="magic-b-theoretical-unavailable"]')).toHaveTextContent('本场：—');
  });
  it('places effective rise before magic b and substitutes the decimal percentage', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({ positionGeometricMultiple: 2, effectivePriceChangePct: 50, expectedMaxDrawdownPct: 10, magicB: 1,
      geometricMetricBasis: {initialCoins: 10, earlyReductionFraction: 0.5, addRatios: [1], finalExitPrice: 150, lastSupport: 100 } }));
    const keys = items.map(item => item.key);
    expect(keys.slice(0, 9)).toEqual(["expectedMaxDrawdownPct","effectivePriceChangePct","addCount","positionGeometricMultiple","magicB","unitRise","unitProfit","positionProfit","payoffRatio"]);
    expect(items.find(item => item.key === 'effectivePriceChangePct')?.value).toBe('0.50×');
    expect(items.find(item => item.key === 'effectivePriceChangeMultiple')).toBeUndefined();
    const magic = items.find(item => item.key === 'magicB')!;
    expect(magic.rightColumn).toBeUndefined();
    expect(magic.value).toBe('1.00');
    const help = render(<>{magic.help}</>).container;
    const worked = help.querySelector('[data-testid="magic-b-worked"]');
    expect(worked).toHaveTextContent('相对涨幅 = 0.5 倍');
    expect(worked).toHaveTextContent('b = 2 × 0.5');
    expect(worked).toHaveTextContent('≈ 1.00000000');
    expect(worked).not.toHaveTextContent('β');
    expect(worked).not.toHaveTextContent('÷');
    expect(help.querySelector('[data-testid="magic-b-direct-worked"]')).toBeNull();
    expect(help).not.toHaveTextContent('+ 结算修正');
    expect(worked).not.toHaveTextContent('结算修正');
    // 【用户要求】神奇的 b 的说明不再列方法一（原盈亏比）
    expect(help).not.toHaveTextContent('算法一 · 原盈亏比');
    expect(help).toHaveTextContent('算法二 · 几何公式');
    expect(help).toHaveTextContent('结算口径可能存在差异');
    expect(items.find(item => item.key === 'payoffRatio')?.value).toBe('2.00');
    expect(items.find(item => item.key === 'addEfficiency')?.value).toBe('+1.00');
    expect(items.find(item => item.key === 'arithmeticExpectancy')?.value).toBe('+0.50R');
    expect(items.find(item => item.key === 'geometricExpectancy')?.value).toBe('1.20');
  });
  it('does not fall back to legacy realized b when the new geometric b is missing', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({ magicB: null }));
    for (const key of ['magicB']) {
      expect(items.find(item => item.key === key)?.value).toBe('—');
    }
    const help = render(<>{items.find(item => item.key === 'magicB')?.help}</>).container;
    expect(help).toHaveTextContent('显示「—」');
    expect(help).not.toHaveTextContent('使用净结算法');
    expect(items.find(item => item.key === 'realizedPnl')?.value).toBe('200.00 USDT');
    expect(items.find(item => item.key === 'payoffRatio')?.value).toBe('2.00');
    expect(items.find(item => item.key === 'arithmeticExpectancy')?.value).toBe('+0.50R');
  });
  it('expands every actual plus-alpha factor without multiplying by early retention', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      positionGeometricMultiple: 3,
      geometricMetricBasis: { initialCoins: 10, earlyReductionFraction: 0.6, addRatios: [0.5, 1.5, 1], finalExitPrice: 220, lastSupport: 140 },
    }));
    const item = items.find(value => value.key === 'positionGeometricMultiple')!;
    const { container } = render(<>{item.help}</>);
    expect(container.querySelector('[data-testid="position-geometric-substitution"]')).toHaveTextContent('(1 + 50.00%)× (1 + 150.00%)× (1 + 100.00%)');
    expect(container.querySelector('[data-testid="position-geometric-substitution"]')).toHaveTextContent('(1 − 60.00%)');
    expect(container.querySelector('[data-testid="position-geometric-factors"]')).toHaveTextContent('≈ 0.4× 1.5× 2.5× 2');
    expect(container.querySelector('[data-testid="position-geometric-result"]')).toHaveTextContent('≈ 3.00 倍');
    expect(container.textContent).toContain('3 次加仓');
    expect(item.value).toBe('3.00x');
  });

  it('does not require the early-reduction fraction, and an empty add product is one', () => {
    const overview = (reduction: number | null, ratios: number[] | null, multiple: number | null) => buildCampaignPnlOverviewItems(winnerMetrics({
      positionGeometricMultiple: multiple,
      geometricMetricBasis: { initialCoins: 10, earlyReductionFraction: reduction, addRatios: ratios, finalExitPrice: null, lastSupport: null },
    })).find(value => value.key === 'positionGeometricMultiple')!;
    const empty = render(<>{overview(0, [], 1).help}</>);
    expect(empty.container.querySelector('[data-testid="position-geometric-result"]')).toHaveTextContent('1.00 倍');
    expect(empty.container.textContent).toContain('0 次加仓');
    empty.unmount();
    const missing = render(<>{overview(null, null, null).help}</>);
    expect(missing.container.querySelector('[data-testid="position-geometric-worked"]')).toBeNull();
    expect(missing.container.textContent).toContain('暂不能展开计算');
  });

  it('shows substituted first-add S0 and distinguishes the allowable ratio from the actual factor', () => {
    const item = buildCampaignPnlOverviewItems(winnerMetrics({
      positionGeometricMultiple: 2,
      geometricMetricBasis: { initialCoins: 10, earlyReductionFraction: 0.5, addRatios: [1], finalExitPrice: 220, lastSupport: 110,
        firstAdd: { beforeCoins: 5, addCoins: 5, costLine: 100, breakevenLine: 80, bankedProfit: 100, support: 110, addPrice: 130, allowedRatio: 1.5, actualRatio: 1,
          afterCoins: 10, afterCostLine: 115, afterBreakevenLine: 105 } },
    })).find(value => value.key === 'positionGeometricMultiple')!;
    const { container } = render(<>{item.help}</>);
    const first = container.querySelector('[data-testid="position-geometric-first-add"]');
    expect(first).toHaveTextContent('实际止损 K₁ 不变');
    expect(first).toHaveTextContent('max(0, 110 − 100 + 100 ÷ 5) ÷ (130 − 110) ≈ 150.00%');
    expect(first).toHaveTextContent('115 − 100 ÷ 10 ≈ 105');
    expect(first).toHaveTextContent('α₁实际 = 5 ÷ 5 ≈ 100.00%');
    expect(container.querySelector('[data-testid="position-geometric-result"]')).toHaveTextContent('1.00 倍');
  });

  it('【用户要求】单位涨幅 G = F − Kₘ、单位利润 U = Q × G、仓位利润 W = U × 几何仓位：读数、颜色与本场代入', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      positionGeometricMultiple: 2, positionGeometricMultipleTheoretical: 2.5,
      unitRise: 50, unitProfit: 500, positionProfit: 1000, positionProfitTheoretical: 1250,
      geometricMetricBasis: { initialCoins: 10, earlyReductionFraction: 0, addRatios: [1], finalExitPrice: 150, lastSupport: 100 },
    }));
    const byKey = Object.fromEntries(items.map(item => [item.key, item]));
    expect(byKey.unitRise.value).toBe('50.0000');
    expect(byKey.unitProfit.value).toBe('500.00');
    expect(byKey.positionProfit.value).toBe('1,000.00（1,250.00）');
    expect(byKey.unitRise.valueClassName).toBe('text-[#0ECB81]');
    expect(render(<>{byKey.unitRise.help}</>).container).toHaveTextContent('G = 150.0000 − 100.0000 ≈ 50.0000');
    expect(render(<>{byKey.unitProfit.help}</>).container).toHaveTextContent('U = 10 币 × 50.0000 ≈ 500.00 USDT');
    const w = render(<>{byKey.positionProfit.help}</>).container;
    expect(w).toHaveTextContent('W = 500.00 × 2.0000 ≈ 1,000.00 USDT');
    expect(w).toHaveTextContent('W（理论）= 500.00 × 2.5000 ≈ 1,250.00 USDT');
    const loss = Object.fromEntries(buildCampaignPnlOverviewItems(winnerMetrics({ unitRise: -0.00012346, unitProfit: -12.3, positionProfit: null }))
      .map(item => [item.key, item]));
    expect(loss.unitRise.value).toBe('-0.0001235');
    expect(loss.unitProfit.valueClassName).toBe('text-[#F6465D]');
    expect(loss.positionProfit.value).toBe('—');
  });

  it('explains that F is exactly the same exit basis as the price-change metric', () => {
    const item = buildCampaignPnlOverviewItems(winnerMetrics({
      effectivePriceChangePct: 50,
      geometricMetricBasis: { initialCoins: 10, initialEntryPrice: 140, initialStopPrice: 100, earlyReductionFraction: 0.5, addRatios: [1], finalExitPrice: 210, lastSupport: 140 },
    })).find(value => value.key === 'effectivePriceChangePct')!;
    const { container } = render(<>{item.help}</>);
    expect(container.textContent).toContain('F 与「首仓涨跌幅」的平仓价同源');
    expect(container.textContent).toContain('F = 210；Kₘ = 140');
    expect(container.textContent).not.toContain('按币量加权');
  });

  it('输出 14 项（新增多方总名义仓位）：键、标签、值、着色、分栏', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics());

    expect(items.map(item => item.key)).toEqual(GOLDEN_KEYS);
    expect(items.map(item => item.label)).toEqual(GOLDEN_LABELS);
    expect(items.map(item => item.value)).toEqual(["10.00%", "—", "1", "—", "2.00", "—", "—", "—", "2.00", "100.00 USDT", "200.00 USDT", "1.50x", "+1.00", "1.20", "+0.50R", "+20.00%", "+2.00", "+25.00%", "1.20", "5.00%", "12.50%"]);
    const G = '#0ECB81';
    const R = '#F6465D';
    expect(items.map(item => item.color)).toEqual([undefined, "#64748B", "#1E2329", "#1E2329", "#0ECB81", "#64748B", "#64748B", "#64748B", "#0ECB81", undefined, "#0ECB81", undefined, "#0ECB81", "#0ECB81", "#0ECB81", "#0ECB81", "#0ECB81", "#0ECB81", "#0ECB81", "#181A20", "#181A20"]);
    const T = 'text-[#0ECB81]';
    expect(items.map(item => item.valueClassName)).toEqual([undefined, "text-muted-foreground", "text-foreground/85", "text-foreground/85", "text-[#0ECB81]", "text-muted-foreground", "text-muted-foreground", "text-muted-foreground", "text-[#0ECB81]", undefined, "text-[#0ECB81]", undefined, "text-[#0ECB81]", "text-[#0ECB81]", "text-[#0ECB81]", "text-[#0ECB81]", "text-[#0ECB81]", "text-[#0ECB81]", "text-[#0ECB81]", "text-foreground", "text-foreground"]);
    expect(items.map(item => item.column)).toEqual([0,0,0,0,0,0,0,0,0,1,1,1,1,1,1,2,2,2,2,2,2]);
  });

  it('全空 / 全零输入时每一项都印「—」而不是 0.00，着色退回灰色', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      realizedPnl: null,
      addCount: null,
      settlement: null,
      mainLeverage: null,
      initialMainExposureNotional: 0,
      peakUnrealizedPnl: 0,
      peakPriceChangePct: null,
      dynamicMaxDrawdownPct: null,
      initialExpectedMaxLoss: 0,
      expectedMaxDrawdownPct: 0,
      payoffRatio: null,
      magicB: null,
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
    expect(byKey.magicB.color).toBe('#64748B');
  });

  it('【用户要求】没有加仓的战役不算加仓效用：印「—」，说明里写明原因；首仓涨跌幅与首仓涨跌幅倍数照算', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({ hasMainAdd: false, addCount: 0 }));
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
      magicB: -0.5,
      arithmeticExpectancy: -0.75,
      geometricExpectancy: -0.05,
    }));
    const byKey = Object.fromEntries(items.map(item => [item.key, item]));
    expect(byKey.realizedPnl.value).toBe('-50.00 USDT');
    expect(byKey.realizedPnl.color).toBe('#F6465D');
    expect(byKey.magicB.value).toBe('-0.50');
    expect(byKey.magicB.valueClassName).toBe('text-[#F6465D]');
    expect(byKey.arithmeticExpectancy.value).toBe('-0.75R');
    expect(byKey.geometricExpectancy.value).toBe('0.95');
  });

  it('【用户要求】盈亏比只写两位小数的 b：取整为 0.00 的读数用中性色，颜色跟着读者看到的数走（同首仓涨跌幅倍数）', () => {
    // 已实现 -3、L 1000 → b = -0.003，读数「0.00」：不能是红色的 0.00
    for (const payoffRatio of [-0.3, 0.3, -0.49]) {
      const byKey = Object.fromEntries(buildCampaignPnlOverviewItems(winnerMetrics({ magicB: payoffRatio / 100 })).map(item => [item.key, item]));
      expect(byKey.magicB.value, String(payoffRatio)).toBe('0.00');
      expect(byKey.magicB.valueClassName, String(payoffRatio)).toBe('text-muted-foreground');
      expect(byKey.magicB.color, String(payoffRatio)).toBe('#64748B');
    }
    // 取整后不为 0 的仍按正负上色
    const loss = Object.fromEntries(buildCampaignPnlOverviewItems(winnerMetrics({ magicB: -0.006 })).map(item => [item.key, item]));
    expect(loss.magicB.value).toBe('-0.01');
    expect(loss.magicB.valueClassName).toBe('text-[#F6465D]');
    expect(loss.magicB.color).toBe('#F6465D');
  });

  it('【用户要求】说明（ⓘ）里引用的 b 与盈亏比读数同一个写法：取整为 0 写 0.00，不写 -0.00', () => {
    // 已实现 -0.3、L 100 → b = -0.003：盈亏比读「0.00」，加仓效用 / 算术期望的说明里也只能是「0.00」
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      payoffRatio: -0.3,
      magicB: -0.003, realizedPnl: -0.3,
      asymmetricRiskContribution: { group: 'loss', sampleCount: 1, meanSquareTerm: 0, meanSquareShare: 1 },
    }));
    const byKey = Object.fromEntries(items.map(item => [item.key, item]));
    expect(byKey.magicB.value).toBe('0.00');
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
    expect(container.firstElementChild).toHaveClass('[container-type:inline-size]');
    expect(container.querySelector('[data-testid="pnl-overview-three-columns"]')).toHaveClass('[@container(min-width:840px)]:grid-cols-3');
    for (const [index, name] of ['left', 'middle', 'right'].entries()) {
      const rows = [...container.querySelectorAll('[data-column="' + name + '"]')];
      // 左列九项（几何链接上单位涨幅 G、单位利润 U、仓位利润 W），另两列各六项
      const [from, to] = [[0, 9], [9, 15], [15, 21]][index];
      expect(rows.map(node => node.firstElementChild?.textContent)).toEqual(GOLDEN_LABELS.slice(from, to));
      expect(rows).toHaveLength(to - from);
      for (const row of rows) expect(row).toHaveClass('min-h-5', 'gap-3');
    }
    // 【用户要求】底部「期望口径」那行脚注删掉
    expect(screen.queryByText(/期望口径/)).not.toBeInTheDocument();
    // 标题直接是卡片的第一个子节点（不套 flex 行），紧跟 13 项网格与脚注，没有别的行
    expect(container.firstElementChild?.firstElementChild).toHaveTextContent('盈亏概览');
    // 标题单行截断、悬停看全名：反事实分支名最长 20 字，并排的窄栏里折行会让面板比上方「盈亏概览」高一行
    expect(container.firstElementChild?.firstElementChild?.className).toBe('truncate font-medium');
    expect(container.firstElementChild?.firstElementChild?.getAttribute('title')).toBe('盈亏概览');
    expect(container.firstElementChild?.children).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '算术期望说明' }));
    expect(screen.getByText('本场：50.00% × 2.00 − 50.00% = +0.50R')).toBeInTheDocument();
    expect(screen.getByText('方法一 · 基于盈亏比（括号外）')).toBeInTheDocument();
    expect(screen.getByText('方法二 · 基于神奇的 b（理论）（括号内）')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '几何期望说明' }));
    expect(screen.getByText('本场：max(0, 1 + 2.00 × 10%) ≈ 1.20')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已实现 P&L说明' }));
    expect(screen.getByText('复盘快照')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '首仓涨跌幅倍数说明' }));
    expect(screen.getByText('本场 = +20.00% ÷ 10.00% = +2.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加仓效用说明' }));
    expect(screen.getByText('本场 = 2.00 ÷ |+2.00| = +1.00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '最大预期亏损说明' }));
    expect(screen.getByText('最大预期亏损 = 主力开仓名义仓位 × 预期回撤比例')).toBeInTheDocument();
  });

  it('【用户要求】仓位放大的说明写明按什么计：两个数都是名义仓位、各自带 USDT，算式一行一项', () => {
    const items = buildCampaignPnlOverviewItems(winnerMetrics({
      initialMainExposureNotional: 11287940,
      mainSideNotional: { side: 'long', total: 34155120 },
    }));
    const amplification = items.find(item => item.key === 'positionAmplification')!;
    expect(amplification.value).toBe('3.03x');
    const { container } = render(<>{amplification.help}</>);
    const worked = container.querySelector('[data-testid="position-amplification-worked"]') as HTMLElement;
    expect(container.textContent).toContain('两项都是名义仓位，单位 USDT：每条腿的名义仓位 = 开仓价 × 币量，不是币量，也不是保证金。');
    // 本场：被除数、除数、结果各占一行，数字与单位在同一格里（不会从中间折断）
    expect([...worked.children].map(node => node.textContent))
      .toEqual(['本场', '=', '34155120.00 USDT', '', '−', '0.00 USDT', '', '=', '34155120.00 USDT', '', '÷', '11287940.00 USDT', '', '=', '3.03x']);
    for (const cell of [2, 5, 8, 11]) expect(worked.children[cell]).toHaveClass('text-right');
    // 公式同样一行一项：原来接成一行，「主力开仓名义仓位」的最后一个字被挤到第二行
    expect(container.textContent).toContain('仓位放大=（多方总名义仓位−镜像止盈名义仓位）÷主力开仓名义仓位');
    expect(container.textContent).not.toContain('本场 = 34155120.00 ÷ 11287940.00');
    // 主空战役：分子是空方
    const short = buildCampaignPnlOverviewItems(winnerMetrics({ mainSideNotional: { side: 'short', total: 1500 } }))
      .find(item => item.key === 'positionAmplification')!;
    expect(render(<>{short.help}</>).container.textContent).toContain('仓位放大=（空方总名义仓位−镜像止盈名义仓位）÷主力开仓名义仓位');
    // 算不出时不写「本场」
    const missing = buildCampaignPnlOverviewItems(winnerMetrics({ mainSideNotional: null }))
      .find(item => item.key === 'positionAmplification')!;
    expect(missing.value).toBe('—');
    expect(render(<>{missing.help}</>).container.querySelector('[data-testid="position-amplification-worked"]')).toBeNull();
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
    expect(screen.getByText(/涨幅未兑现 = 峰值涨幅 − 首仓涨跌幅/)).toBeInTheDocument();
    expect(screen.getByText('按 1h K 线估计')).toHaveClass('text-[#F0B90B]');
  });
});

describe('【用户要求】盈亏概览：峰值价格指标、涨幅未兑现与几何期望', () => {
  const byKey = (overrides: Partial<CampaignPnlOverviewMetrics> = {}) =>
    Object.fromEntries(buildCampaignPnlOverviewItems(winnerMetrics(overrides)).map(item => [item.key, item]));
  const helpText = (help: ReactNode) => render(<>{help}</>).container.textContent ?? '';

  it('峰值涨幅与涨幅未兑现使用同一价格路径；没有路径时均为「—」；「峰值涨幅倍数」已删除', () => {
    expect(byKey().peakPriceChange.value).toBe('+25.00%');
    expect(byKey({ peakPriceChangePct: null }).peakPriceChange.value).toBe('—');
    expect(byKey({ peakPriceChangePct: null }).unrealizedPriceChangePct.value).toBe('—');
    expect(byKey()).not.toHaveProperty('peakPriceEfficiency');
  });

  it('【用户要求】几何增长 W（b）= 1 + 0.1 × 相对涨幅 × 几何仓位：括号外基于几何仓位，括号里基于几何仓位（理论）', () => {
    const item = byKey({ magicB: 25, effectivePriceChangePct: 800, positionGeometricMultiple: 3.125, positionGeometricMultipleTheoretical: 2.5 }).geometricGrowth;
    expect(item.label).toBe('几何增长 W（b）');
    expect(item.value).toBe('3.50（3.00）');
    expect(item.valueClassName).toBe('text-[#0ECB81]');
    expect(item.column).toBe(2);
    const help = helpText(item.help);
    expect(help).toContain('方法一（读数括号外）');
    expect(help).toContain('本场：1 + 0.1 × 8.0000 × 3.1250 ≈ 3.50');
    expect(help).toContain('方法二（读数括号内）');
    expect(help).toContain('本场：1 + 0.1 × 8.0000 × 2.5000 ≈ 3.00');
    // b < 0：W < 1 用风险色；不设 0 的下限
    const loss = byKey({ magicB: -12, effectivePriceChangePct: null }).geometricGrowth;
    expect(loss.value).toBe('-0.20');
    expect(loss.valueClassName).toBe('text-[#F6465D]');
    expect(byKey({ magicB: 0 }).geometricGrowth.value).toBe('1.00');
    expect(byKey({ magicB: null }).geometricGrowth.value).toBe('—');
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

  it('几何期望使用固定 10% 模型，不随实际资产风险比例变化', () => {
    expect(helpText(byKey().geometricExpectancy.help)).toContain('固定风险比例 x = 10%');
    expect(helpText(byKey({ initialRisk: { drawdownFraction: 0.01, source: 'current_account_fallback' } }).geometricExpectancy.help))
      .toContain('本场：max(0, 1 + 2.00 × 10%) ≈ 1.20');
  });
});
