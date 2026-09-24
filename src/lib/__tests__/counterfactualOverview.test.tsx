import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CampaignPnlOverviewPanel } from '@/components/journal/CampaignPnlOverviewPanel';
import type { AsymmetricRiskMetricsSummary } from '@/lib/asymmetricRiskMetrics';
import { buildCampaignPnlOverviewItems, formatOverviewPayoffRatio } from '@/lib/campaignPnlOverview';
import { deriveCounterfactualRiskAnchors, simulateCampaign, simulateManualLegScenario } from '@/lib/campaignSimulationEngine';
import {
  buildCounterfactualOverviewMetrics,
  buildCounterfactualRunContext,
  computeCounterfactualPayoffRatio,
  resolveCounterfactualRiskAnchors,
  type CounterfactualOverviewShared,
} from '@/lib/counterfactualOverview';
import type {
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualParams,
  CampaignCounterfactualResult,
} from '@/types/journal';

const MIN = 60_000;
const t0 = new Date('2026-01-01T00:00:00Z').getTime();
const iso = (offsetMinutes: number) => new Date(t0 + offsetMinutes * MIN).toISOString();

/**
 * 默认的腿模拟「从成交记录原样抄来、记录里没有手续费」的副本：带 actual、各项与 actual 一致，
 * 引擎直接取实际结算值（= 毛盈亏），下面这些关于锚与派生项的数字因此仍是整数。
 * 按模拟器费率扣平仓费的路径（改过 / 新增的腿）见文件末尾的专门用例。
 */
function leg(overrides: Partial<CampaignCounterfactualManualLeg> & Pick<CampaignCounterfactualManualLeg, 'id' | 'leg_role'>): CampaignCounterfactualManualLeg {
  const base: CampaignCounterfactualManualLeg = {
    direction: 'long',
    open_time: iso(0),
    close_time: iso(30),
    entry_price: 100,
    exit_price: 100,
    size_usdt: 1000,
    leverage: 3,
    enabled: true,
    ...overrides,
  };
  if ('actual' in overrides) return base;
  const sign = base.direction === 'long' ? 1 : -1;
  return {
    ...base,
    actual: {
      source: 'records',
      direction: base.direction,
      open_time: base.open_time,
      close_time: base.close_time,
      entry_price: base.entry_price,
      exit_price: base.exit_price,
      size_usdt: base.size_usdt,
      realized_pnl_usdt: sign * (base.exit_price - base.entry_price) / base.entry_price * base.size_usdt,
      close_fee_usdt: 0,
      open_fee_usdt: 0,
    },
  };
}

/** 主力 1000 @100 平 106，镜像 500 @100 平 104；对冲 A/B 挂 98 / 96 → d = 4%，敞口 1500，L = 60。 */
const FULL_LEGS: CampaignCounterfactualManualLeg[] = [
  leg({ id: 'main', leg_role: 'main_open', exit_price: 106 }),
  leg({ id: 'mirror', leg_role: 'mirror_tp', size_usdt: 500, exit_price: 104 }),
  leg({ id: 'ha', leg_role: 'hedge_initial_a', direction: 'short', entry_price: 98, exit_price: 98, size_usdt: 500, open_time: iso(1), close_time: iso(2) }),
  leg({ id: 'hb', leg_role: 'hedge_initial_b', direction: 'short', entry_price: 96, exit_price: 96, size_usdt: 500, open_time: iso(1), close_time: iso(2) }),
];

function params(manualLegs: CampaignCounterfactualManualLeg[], extra: Partial<CampaignCounterfactualParams> = {}): CampaignCounterfactualParams {
  return {
    entry: { time: iso(0), price: 100, size_usdt: 1000, direction: 'long', leverage: 3 },
    hedge_a: { offset_pct: -2, size_pct: 50 },
    hedge_b: { offset_pct: -4, size_pct: 50 },
    mirror_tp: { offset_pct: 2, size_pct: 50 },
    rolling: { enabled: false, trigger_rise_pct: 10, min_interval_minutes: 60, new_hedge_offset_pct: -2, rolling_hedge_size_pct: 100 },
    exit_rule: 'manual_only',
    manual_legs: manualLegs,
    ...extra,
  };
}

const summary: AsymmetricRiskMetricsSummary = {
  sampleCount: 2,
  winCount: 1,
  lossCount: 1,
  excludedPayoffCount: 0,
  dsi: 1,
  usi: 2,
  upsideStandardDeviation: null,
  downsideStandardDeviation: null,
  upsidePotential: null,
  downsidePotential: null,
  upr: null,
  omega: null,
  sortino: null,
  sortinoIdentityRhs: null,
  winSquaredSum: 4,
  lossSquaredSum: 1,
};

const shared: CounterfactualOverviewShared = {
  strategyTemplate: 'main_dual_hedge_mirror_tp',
  asymmetricRiskSummary: summary,
  currentAccountEquity: 10_000,
  isOwner: true,
};

const NO_KLINES: never[] = [];

function itemsByKey(metrics: ReturnType<typeof buildCounterfactualOverviewMetrics>) {
  const items = buildCampaignPnlOverviewItems(metrics);
  return { items, byKey: Object.fromEntries(items.map(item => [item.key, item])) };
}

describe('buildCounterfactualOverviewMetrics', () => {
  it('新行：L / 名义 / d / 杠杆读落库字段，盈亏比 = 已实现 ÷ L，绝不是 result.profit_capture_ratio', () => {
    const branchParams = params(FULL_LEGS);
    const result = simulateManualLegScenario(branchParams, NO_KLINES);
    expect(result.initial_expected_max_loss).toBeCloseTo(60, 4);
    expect(result.initial_main_exposure_notional).toBeCloseTo(1500, 4);
    expect(result.expected_max_drawdown_pct).toBeCloseTo(4, 4);
    expect(result.main_leverage).toBe(3);

    const metrics = buildCounterfactualOverviewMetrics({ params: branchParams, result }, shared);
    const { items, byKey } = itemsByKey(metrics);
    expect(items).toHaveLength(13);

    // 主力 +60，镜像 +20 → 80；b = 80 ÷ 60 = 1.3333 → 133.3%
    expect(result.final_realized_pnl).toBeCloseTo(80, 4);
    expect(metrics.payoffRatio).toBeCloseTo((80 / 60) * 100, 6);
    expect(byKey.payoffRatio.value).toBe(formatOverviewPayoffRatio((80 / 60) * 100));
    // 峰值权益 = 80 → profit_capture_ratio = 100，与 b 完全不同，盈亏比列不能印它
    expect(result.profit_capture_ratio).toBe(100);
    expect(byKey.payoffRatio.value).not.toContain('100.0%');
    expect(byKey.realizedPnl.value).toBe('80.00 USDT');
    expect(byKey.mainLeverage.value).toBe('3x');
    expect(byKey.initialMainExposureNotional.value).toBe('1500.00 USDT');
    expect(byKey.initialExpectedMaxLoss.value).toBe('60.00 USDT');
    expect(byKey.expectedMaxDrawdownPct.value).toBe('4.00%');
    // E = 0.5 × 1.3333 − 0.5 = +0.17R；G = 1 + 1.3333 × 0.1 = 1.13
    expect(byKey.arithmeticExpectancy.value).toBe('+0.17R');
    expect(byKey.geometricExpectancy.value).toBe('1.13');
    // 盈利 → USI 组，b² / n = 1.7778 / 1，组内占比 1.7778 / 4
    expect(byKey.asymmetricRiskContribution.value).toBe('USI 44.4%');
    // 【用户要求】「今日账户总资产」不单列，只作几何期望的估算分母（见脚注）
    expect(byKey.todayAccountEquity).toBeUndefined();
    // 没有主力开仓资产快照 → 退到今日总资产，几何期望的说明跟着写明
    expect(metrics.initialRisk).toEqual({ drawdownFraction: 60 / 10_000, source: 'current_account_fallback' });
    expect(render(<>{byKey.geometricExpectancy.help}</>).container.textContent)
      .toContain('本场的资产分母：这场没有开仓时的资产快照，用今日当前总账户资产估算。');
  });

  it('老行（结果上没有锚字段）按 params 重算，得到与新行完全一样的四个锚', () => {
    const branchParams = params(FULL_LEGS);
    const fresh = simulateManualLegScenario(branchParams, NO_KLINES);
    const legacy: CampaignCounterfactualResult = {
      final_realized_pnl: fresh.final_realized_pnl,
      final_r_multiple: fresh.final_r_multiple,
      peak_unrealized_pnl: fresh.peak_unrealized_pnl,
      peak_drawdown: fresh.peak_drawdown,
      profit_capture_ratio: fresh.profit_capture_ratio,
      events: fresh.events,
      legs_summary: fresh.legs_summary,
      state_segments: fresh.state_segments,
      sop_score: 0,
    };
    expect(resolveCounterfactualRiskAnchors({ params: branchParams, result: legacy }, 'main_dual_hedge_mirror_tp'))
      .toEqual(deriveCounterfactualRiskAnchors(branchParams));

    const legacyMetrics = buildCounterfactualOverviewMetrics({ params: branchParams, result: legacy }, shared);
    const freshMetrics = buildCounterfactualOverviewMetrics({ params: branchParams, result: fresh }, shared);
    const strip = ({ helpOverrides: _h, extraNotes: _e, ...rest }: typeof freshMetrics) => rest;
    expect(strip(legacyMetrics)).toEqual(strip(freshMetrics));
    expect(itemsByKey(legacyMetrics).byKey.initialExpectedMaxLoss.value).toBe('60.00 USDT');
  });

  it('落库的锚优先于按 params 重算：四个字段都在就一律读落库值，盈亏比也按落库的 L 算', () => {
    const branchParams = params(FULL_LEGS);
    const fresh = simulateManualLegScenario(branchParams, NO_KLINES);
    // params 会推出 60 / 1500 / 4% / 3x；故意落库一组完全不同的值，哪边赢一眼可见
    const stored: CampaignCounterfactualResult = {
      ...fresh,
      initial_expected_max_loss: 123,
      initial_main_exposure_notional: 999,
      expected_max_drawdown_pct: 7,
      main_leverage: 9,
    };
    expect(resolveCounterfactualRiskAnchors({ params: branchParams, result: stored }, 'main_dual_hedge_mirror_tp')).toEqual({
      initialExpectedMaxLoss: 123,
      initialMainExposureNotional: 999,
      expectedMaxDrawdownPct: 7,
      mainLeverage: 9,
    });
    const metrics = buildCounterfactualOverviewMetrics({ params: branchParams, result: stored }, shared);
    const { byKey } = itemsByKey(metrics);
    expect(byKey.initialExpectedMaxLoss.value).toBe('123.00 USDT');
    expect(byKey.initialMainExposureNotional.value).toBe('999.00 USDT');
    expect(byKey.expectedMaxDrawdownPct.value).toBe('7.00%');
    expect(byKey.mainLeverage.value).toBe('9x');
    expect(metrics.payoffRatio).toBeCloseTo((80 / 123) * 100, 6);
    expect(byKey.payoffRatio.value).toBe(formatOverviewPayoffRatio((80 / 123) * 100));
  });

  it('缺 main_leverage 键的行按老行处理：整组退回 params 重算，不混用半套落库值', () => {
    const branchParams = params(FULL_LEGS);
    const fresh = simulateManualLegScenario(branchParams, NO_KLINES);
    const { main_leverage: _omitted, ...withoutLeverage } = {
      ...fresh,
      initial_expected_max_loss: 123,
      initial_main_exposure_notional: 999,
      expected_max_drawdown_pct: 7,
    };
    expect('main_leverage' in withoutLeverage).toBe(false);
    expect(resolveCounterfactualRiskAnchors({ params: branchParams, result: withoutLeverage }, 'main_dual_hedge_mirror_tp')).toEqual({
      initialExpectedMaxLoss: 60,
      initialMainExposureNotional: 1500,
      expectedMaxDrawdownPct: 4,
      mainLeverage: 3,
    });
    const { byKey } = itemsByKey(buildCounterfactualOverviewMetrics({ params: branchParams, result: withoutLeverage }, shared));
    expect(byKey.initialExpectedMaxLoss.value).toBe('60.00 USDT');
    expect(byKey.mainLeverage.value).toBe('3x');
  });

  it('main_only 战役的老 SOP 行按 main_only 模板重算：没有保护线 → L = 0，L 派生项印「—」而不是被默认模板造出止损线', () => {
    // 无手动腿 → SOP 路径；主力 1000 @100，三根 K 线走到 106，manual_only 不平仓、末根收盘强制结算 → +60
    const sopParams = params([]);
    const klines = [0, 1, 2].map(offset => ({
      time: t0 + offset * MIN,
      open: 100 + offset * 3,
      high: 100 + offset * 3,
      low: 100 + offset * 3,
      close: 100 + offset * 3,
      volume: 1,
    }));
    const fresh = simulateCampaign(sopParams, klines, 'main_only');
    expect(fresh.final_realized_pnl).toBeCloseTo(60, 4);
    expect(fresh.initial_expected_max_loss).toBe(0);
    expect(fresh.final_r_multiple).toBe(0);
    // 陷阱本身：同一份 params 按默认双向对冲模板重算，会凭空得到 L > 0
    expect(deriveCounterfactualRiskAnchors(sopParams, 'main_dual_hedge_mirror_tp').initialExpectedMaxLoss).toBeGreaterThan(0);

    const {
      initial_expected_max_loss: _l,
      initial_main_exposure_notional: _n,
      expected_max_drawdown_pct: _d,
      main_leverage: _lev,
      ...legacy
    } = fresh;
    const mainOnlyShared: CounterfactualOverviewShared = { ...shared, strategyTemplate: 'main_only' };
    expect(resolveCounterfactualRiskAnchors({ params: sopParams, result: legacy }, 'main_only')).toEqual({
      initialExpectedMaxLoss: 0,
      initialMainExposureNotional: 1000,
      expectedMaxDrawdownPct: 0,
      mainLeverage: 3,
    });
    const legacyMetrics = buildCounterfactualOverviewMetrics({ params: sopParams, result: legacy }, mainOnlyShared);
    const freshMetrics = buildCounterfactualOverviewMetrics({ params: sopParams, result: fresh }, mainOnlyShared);
    const strip = ({ helpOverrides: _h, extraNotes: _e, ...rest }: typeof freshMetrics) => rest;
    expect(strip(legacyMetrics)).toEqual(strip(freshMetrics));
    const { byKey } = itemsByKey(legacyMetrics);
    expect(byKey.realizedPnl.value).toBe('60.00 USDT');
    for (const key of ['initialExpectedMaxLoss', 'expectedMaxDrawdownPct', 'mainPriceEfficiency', 'payoffRatio', 'addEfficiency', 'arithmeticExpectancy', 'geometricExpectancy']) {
      expect(byKey[key].value, key).toBe('—');
    }
    expect(legacyMetrics.extraNotes?.payoffRatio).toContainEqual({ warning: '本分支没有初始对冲 A/B，读不到止损线，本项不计算。' });
  });

  it('L = 0（手动腿里没有初始对冲 A/B）：八个 L 派生项全印「—」，没有一个 0.00，并解释原因', () => {
    const mainOnly = params([leg({ id: 'main', leg_role: 'main_open', exit_price: 106 })]);
    const result = simulateManualLegScenario(mainOnly, NO_KLINES);
    expect(result.initial_expected_max_loss).toBe(0);
    // 老逻辑会把 L = 0 时的 R 记成 0，这个 0 绝不能流到盈亏比列上
    expect(result.final_r_multiple).toBe(0);

    const metrics = buildCounterfactualOverviewMetrics({ params: mainOnly, result }, shared);
    const { byKey } = itemsByKey(metrics);
    const lDerived = [
      'initialExpectedMaxLoss',
      'expectedMaxDrawdownPct',
      'mainPriceEfficiency',
      'payoffRatio',
      'addEfficiency',
      'asymmetricRiskContribution',
      'arithmeticExpectancy',
      'geometricExpectancy',
    ];
    for (const key of lDerived) {
      expect(byKey[key].value, key).toBe('—');
      expect(byKey[key].value, key).not.toContain('0.00');
    }
    expect(byKey.realizedPnl.value).toBe('60.00 USDT');
    expect(metrics.payoffRatio).toBeNull();
    expect(metrics.initialRisk).toBeNull();
    for (const key of lDerived) {
      expect(metrics.extraNotes?.[key as keyof typeof metrics.extraNotes]).toContainEqual({
        warning: '手动 Legs 里没有初始对冲 A/B，读不到止损线，本项不计算。',
      });
    }

    render(<CampaignPnlOverviewPanel title="反事实盈亏概览 · 未保存" items={itemsByKey(metrics).items} />);
    fireEvent.click(screen.getByRole('button', { name: '盈亏比说明' }));
    expect(screen.getByText('手动 Legs 里没有初始对冲 A/B，读不到止损线，本项不计算。')).toBeInTheDocument();
  });

  it('峰值浮盈的帮助带上本次运行的 K 线周期与根数；老行没有 run_context 时说明按收盘价估计', () => {
    const withContext = params(FULL_LEGS, {
      run_context: { interval: '1h', from: iso(0), to: iso(120), kline_count: 3, ran_at: iso(200) },
    });
    const result = simulateManualLegScenario(withContext, NO_KLINES);
    const metrics = buildCounterfactualOverviewMetrics({ params: withContext, result }, shared);
    expect(metrics.extraNotes?.peakUnrealizedPnl?.[0]).toContain('1h K 线共 3 根');
    // 手动引擎与战役页共用权益路径算法：一根 K 线里逐个还原持仓状态，
    // 不再是「所有仍持有的腿同在一个极值价上估」
    expect(metrics.extraNotes?.peakUnrealizedPnl?.[0]).toContain('与战役页「盈亏概览」同一算法');
    expect(metrics.extraNotes?.peakUnrealizedPnl?.[0]).toContain('逐个还原持仓状态');
    expect(metrics.extraNotes?.peakUnrealizedPnl?.[0]).not.toContain('仍持有的腿');

    const legacyMetrics = buildCounterfactualOverviewMetrics({ params: params(FULL_LEGS), result }, shared);
    expect(legacyMetrics.extraNotes?.peakUnrealizedPnl?.[0]).toContain('未记录运行时的 K 线周期');
    expect(legacyMetrics.extraNotes?.peakUnrealizedPnl?.[0]).toContain('收盘价');
  });

  it('SOP 推演分支的峰值告诫按引擎写：run_context 在也不能说「最高价 / 最低价」', () => {
    // run_context 是在分流到手动 / SOP 之前挂上去的，SOP 分支同样带着它——
    // 而 simulateCampaign 只在每根 K 线的收盘价上重估权益。
    const sopParams = params([], {
      run_context: { interval: '1h', from: iso(0), to: iso(120), kline_count: 3, ran_at: iso(200) },
    });
    const klines = [0, 1, 2].map(offset => ({
      time: t0 + offset * MIN,
      open: 100 + offset * 3,
      high: 100 + offset * 3,
      low: 100 + offset * 3,
      close: 100 + offset * 3,
      volume: 1,
    }));
    const sopResult = simulateCampaign(sopParams, klines, 'main_dual_hedge_mirror_tp');
    const caveat = buildCounterfactualOverviewMetrics({ params: sopParams, result: sopResult }, shared)
      .extraNotes?.peakUnrealizedPnl?.[0];
    expect(caveat).toContain('1h K 线共 3 根');
    expect(caveat).toContain('只在每根 K 线的收盘价上重估权益');
    expect(caveat).not.toContain('逐个还原持仓状态');
    expect(caveat).not.toContain('最高价、最低价重估');
  });

  it('DSI/USI 贡献标成假设值：本场反事实不在账户样本内', () => {
    const branchParams = params(FULL_LEGS);
    const result = simulateManualLegScenario(branchParams, NO_KLINES);
    const metrics = buildCounterfactualOverviewMetrics({ params: branchParams, result }, shared);
    render(<CampaignPnlOverviewPanel title="反事实盈亏概览" items={itemsByKey(metrics).items} />);
    fireEvent.click(screen.getByRole('button', { name: 'DSI/USI 贡献说明' }));
    expect(screen.getByText(/假设值：本场反事实不在账户样本内/)).toBeInTheDocument();
    expect(screen.getByText(/b = 1\.33，n = 1，/)).toBeInTheDocument();
  });

  it('非所有者不用今日总资产当几何期望的资产分母', () => {
    const branchParams = params(FULL_LEGS);
    const result = simulateManualLegScenario(branchParams, NO_KLINES);
    const metrics = buildCounterfactualOverviewMetrics({ params: branchParams, result }, { ...shared, isOwner: false });
    expect(metrics.initialRisk).toBeNull();
    const geometric = buildCampaignPnlOverviewItems(metrics).find(item => item.key === 'geometricExpectancy');
    expect(render(<>{geometric?.help}</>).container.textContent).not.toContain('本场的资产分母');
  });
});

describe('已实现 P&L 的手续费口径', () => {
  const helpText = (paragraphs: unknown[] | undefined) => (paragraphs ?? [])
    .map(paragraph => (typeof paragraph === 'string' ? paragraph : JSON.stringify(paragraph)))
    .join('\n');

  it('改过的腿从实际结算值出发、只加改动的钱（平仓费按这一刀自己的费率）；帮助写明净额口径与扣掉的金额，开仓费单列不扣', () => {
    // 实际：主力 1000 @100 平 106，记录净额 60 − 平仓费 10 × 106 × 0.05% = 59.47，开仓费 0.50
    const feeMain = leg({
      id: 'main',
      leg_role: 'main_open',
      exit_price: 106,
      actual: {
        source: 'records', direction: 'long', open_time: iso(0), close_time: iso(30), entry_price: 100, exit_price: 106,
        size_usdt: 1000, realized_pnl_usdt: 59.47, close_fee_usdt: 0.53, open_fee_usdt: 0.5,
        cuts: [{
          open_time: iso(0), close_time: iso(30), entry_price: 100, exit_price: 106, size_usdt: 1000,
          realized_pnl_usdt: 59.47, close_fee_usdt: 0.53, close_fee_rate: 0.0005, open_fee_usdt: 0.5, open_fee_rate: 0.0005,
        }],
      },
    });
    // 平仓价 106 → 110：毛盈亏 +40，平仓费 0.53 → 10 × 110 × 0.05% = 0.55 → 净额 59.47 + 40 − 0.02 = 99.45
    const edited = FULL_LEGS.map(item => (item.id === 'main' ? { ...feeMain, exit_price: 110 } : item));
    const branchParams = params(edited);
    const result = simulateManualLegScenario(branchParams, NO_KLINES);
    // 镜像 +20 仍取实际结算值；两张对冲按记录也是 0
    expect(result.final_realized_pnl).toBeCloseTo(100 - 0.55 + 20, 4);
    expect(result.fees_total).toBeCloseTo(0.55, 4);
    expect(result.open_fees_total).toBeCloseTo(0.5, 4);
    expect(result).not.toHaveProperty('fee_unknown_leg_count');
    const main = result.legs_summary.find(item => item.leg_role === 'main_open');
    expect(main).toMatchObject({ pnl_basis: 'adjusted', status: 'filled' });
    expect(main?.close_fee_usdt).toBeCloseTo(0.55, 4);

    const metrics = buildCounterfactualOverviewMetrics({ params: branchParams, result }, shared);
    const text = helpText(metrics.helpOverrides?.realizedPnl);
    expect(text).toContain('净额，已扣平仓手续费');
    expect(text).toContain('本分支已扣平仓手续费 0.55 USDT；开仓手续费 0.50 USDT');
    expect(text).toContain('原样重跑时已实现 P&L 逐分复现上方「盈亏概览」');
    expect(text).toContain('只加上这次改动本身值的钱');
    expect(text).toContain('分几刀平掉的腿更早平掉的刀维持实际成交');
    expect(text).not.toContain('毛盈亏，而实际');
    expect(text).not.toContain('金额未知');
    expect(helpText(metrics.extraNotes?.peakUnrealizedPnl)).toContain('同一份净额');
    expect(helpText(metrics.extraNotes?.peakUnrealizedPnl)).toContain('进行中的战役');
    expect(helpText(metrics.extraNotes?.initialExpectedMaxLoss)).toContain('初始对冲按委托价');
  });

  it('只剩复盘快照的腿：手续费已含在快照里、金额未知，不印成「0.00」，单独说明', () => {
    const snapshotMain = leg({
      id: 'main',
      leg_role: 'main_open',
      exit_price: 106,
      actual: {
        source: 'leg_snapshot', direction: 'long', open_time: iso(0), close_time: iso(30), entry_price: 100, exit_price: 106,
        size_usdt: 1000, realized_pnl_usdt: 59.4, close_fee_usdt: null, open_fee_usdt: null,
      },
    });
    const branchParams = params(FULL_LEGS.map(item => (item.id === 'main' ? snapshotMain : item)));
    const result = simulateManualLegScenario(branchParams, NO_KLINES);
    expect(result.final_realized_pnl).toBeCloseTo(59.4 + 20, 6);
    expect(result.fees_total).toBe(0);
    expect(result.fee_unknown_leg_count).toBe(1);
    const text = helpText(buildCounterfactualOverviewMetrics({ params: branchParams, result }, shared).helpOverrides?.realizedPnl);
    expect(text).toContain('另有 1 条腿只剩复盘快照或摊自战役级已实现，手续费已含在盈亏里、金额未知');
  });

  it('没有 fees_total 的老行：如实标明是毛盈亏，「相对实际」里含手续费', () => {
    const branchParams = params(FULL_LEGS);
    const { fees_total: _fees, open_fees_total: _openFees, ...legacy } = simulateManualLegScenario(branchParams, NO_KLINES);
    const metrics = buildCounterfactualOverviewMetrics({ params: branchParams, result: legacy }, shared);
    const text = helpText(metrics.helpOverrides?.realizedPnl);
    expect(text).toContain('未扣任何手续费的毛盈亏');
    expect(text).toContain('「相对实际」里多出了这部分手续费');
    expect(text).not.toContain('净额，已扣平仓手续费');
    expect(helpText(metrics.extraNotes?.peakUnrealizedPnl)).toContain('按毛盈亏计入');
    // 数值照读，不因口径不同而改写
    expect(metrics.realizedPnl).toBeCloseTo(80, 4);
  });

  it('挂单中的保护单：不进已实现与峰值，但 L 与预期回撤照旧由它定义', () => {
    const pending = FULL_LEGS.map(item => (
      item.leg_role.startsWith('hedge_')
        ? { ...item, filled: false, actual: undefined, open_time: iso(0), close_time: iso(30) }
        : item
    ));
    const branchParams = params(pending);
    const result = simulateManualLegScenario(branchParams, NO_KLINES);
    expect(result.final_realized_pnl).toBeCloseTo(80, 4);
    expect(result.fees_total).toBe(0);
    expect(result.initial_expected_max_loss).toBeCloseTo(60, 4);
    expect(result.expected_max_drawdown_pct).toBeCloseTo(4, 4);
    expect(result.legs_summary.filter(item => item.pnl_basis === 'unfilled')).toHaveLength(2);
    expect(result.legs_summary.filter(item => item.status === 'never_triggered')).toHaveLength(2);
    expect(result.events.every(event => !String(event.leg_role).startsWith('hedge_'))).toBe(true);
    const { byKey } = itemsByKey(buildCounterfactualOverviewMetrics({ params: branchParams, result }, shared));
    expect(byKey.initialExpectedMaxLoss.value).toBe('60.00 USDT');
    expect(byKey.payoffRatio.value).toBe(formatOverviewPayoffRatio((80 / 60) * 100));
  });
});

describe('computeCounterfactualPayoffRatio', () => {
  it('L ≤ 0 时为 null 而不是 0', () => {
    expect(computeCounterfactualPayoffRatio(80, 0)).toBeNull();
    expect(computeCounterfactualPayoffRatio(80, -1)).toBeNull();
    expect(computeCounterfactualPayoffRatio(80, 40)).toBe(200);
    expect(computeCounterfactualPayoffRatio(-20, 40)).toBe(-50);
  });
});

describe('buildCounterfactualRunContext', () => {
  it('记录周期、首末 K 线开盘时刻、根数与运行时刻；没有 K 线时为 null', () => {
    const klines = [0, 60, 120].map(offset => ({ time: t0 + offset * MIN, open: 1, high: 1, low: 1, close: 1, volume: 0 }));
    expect(buildCounterfactualRunContext(klines, '1h', new Date(t0 + 200 * MIN))).toEqual({
      interval: '1h',
      from: iso(0),
      to: iso(120),
      kline_count: 3,
      ran_at: iso(200),
    });
    expect(buildCounterfactualRunContext([], '1m')).toBeNull();
  });
});
