import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCampaignKlineTimeWindow } from '@/hooks/useCampaignKlines';
import type { CampaignCounterfactualManualLeg, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import {
  CampaignWhatIfEditor,
  type CampaignWhatIfLoadLegsRequest,
  type CampaignWhatIfRunContext,
} from '../CampaignWhatIfEditor';

/**
 * 编辑器要向页面交代两件事：
 *   1. 点「一键运行」时把基线腿 + 编辑器全部腿（含停用）一起递出去，页面才算得出「改了什么」；
 *   2. 收到 loadLegsRequest（nonce 变化）就用那份腿整体替换副本，基线不动。
 */
vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: () => <div data-testid="counterfactual-chart" />,
}));

const { baselineLegs, baselineState } = vi.hoisted(() => ({
  // 个别用例换一份基线（带实际成交结果与「挂单中」）；缺省用下面这份。
  baselineState: { override: null as CampaignCounterfactualManualLeg[] | null },
  baselineLegs: [
    {
      id: 'main',
      leg_role: 'main_open',
      direction: 'long',
      open_time: '2026-01-02T00:30:00.000Z',
      close_time: '2026-01-02T02:00:00.000Z',
      entry_price: 100,
      exit_price: 110,
      size_usdt: 1_000,
      leverage: 1,
      enabled: true,
    },
    {
      id: 'hedge-a',
      leg_role: 'hedge_initial_a',
      direction: 'short',
      open_time: '2026-01-02T00:40:00.000Z',
      close_time: '2026-01-02T02:00:00.000Z',
      entry_price: 90,
      exit_price: 90,
      size_usdt: 1_000,
      leverage: 1,
      enabled: true,
    },
  ] as CampaignCounterfactualManualLeg[],
}));

vi.mock('@/lib/campaignSimulationEngine', async importOriginal => ({
  // 载入时按基线补齐老行的 adoptBaselineLegFacts 用真的
  ...(await importOriginal<typeof import('@/lib/campaignSimulationEngine')>()),
  buildActualSimulationParams: () => ({
    entry: {
      time: '2026-01-02T00:30:00.000Z',
      price: 100,
      size_usdt: 1_000,
      direction: 'long',
      leverage: 1,
    },
    hedge_a: { offset_pct: 1, size_pct: 50 },
    hedge_b: { offset_pct: 2, size_pct: 50 },
    mirror_tp: { offset_pct: 1, size_pct: 50 },
    rolling: {
      enabled: false,
      trigger_rise_pct: 0,
      min_interval_minutes: 0,
      new_hedge_offset_pct: 0,
      rolling_hedge_size_pct: 0,
    },
    exit_rule: 'manual_only',
  }),
  buildPureSopParams: () => null,
  buildManualLegs: () => (baselineState.override ?? baselineLegs).map(leg => ({ ...leg })),
}));

const campaign: TradeCampaign = {
  id: 'campaign-1',
  user_id: 'user-1',
  campaign_code: 'C-CAMPAIGN1',
  symbol: 'BTCUSDT',
  direction: 'main_long',
  status: 'closed_profit',
  strategy_template: 'custom',
  title: 'BTCUSDT campaign',
  opened_at: '2026-01-02T00:30:00.000Z',
  closed_at: '2026-01-02T02:30:00.000Z',
  initial_main_size_usdt: 1_000,
  initial_leverage: 1,
  final_realized_pnl: 100,
  final_r_multiple: null,
  peak_unrealized_pnl: null,
  peak_drawdown: null,
  importance_weight: 0,
  notes: null,
  actual_evolution: [],
  deviation_notes: {},
  deleted_at: null,
  created_at: '2026-01-02T00:30:00.000Z',
  updated_at: '2026-01-02T02:30:00.000Z',
};

const timeWindow = buildCampaignKlineTimeWindow(
  Date.parse('2026-01-02T00:30:00.000Z'),
  Date.parse('2026-01-02T02:30:00.000Z'),
  Date.parse('2026-01-02T00:30:00.000Z'),
  Date.parse('2026-01-02T02:30:00.000Z'),
);

const klines = [
  { time: timeWindow.fromTime, open: 100, high: 101, low: 99, close: 100, volume: 1 },
  { time: timeWindow.toTime, open: 100, high: 101, low: 99, close: 100, volume: 1 },
];

// 这三个 prop 的身份必须稳定：编辑器的重置 effect 跟着它们走，每次渲染都传新的 [] / {} 就等于每次都「换了战役」。
const noLegs: TradeJournal[] = [];
const noRecords: TradeRecord[] = [];
const noCorrections = {};

function renderEditor(
  onRunWhatIf: ReturnType<typeof vi.fn>,
  loadLegsRequest: CampaignWhatIfLoadLegsRequest | null = null,
  campaignRow: TradeCampaign = campaign,
) {
  return (
    <CampaignWhatIfEditor
      campaign={campaignRow}
      legs={noLegs}
      tradeRecords={noRecords}
      legExitPriceCorrections={noCorrections}
      klines={klines}
      klinesLoading={false}
      interval="5m"
      klineTimeWindow={timeWindow}
      timezone="Asia/Shanghai"
      whatIfRunning={false}
      onRunWhatIf={onRunWhatIf}
      loadLegsRequest={loadLegsRequest}
    />
  );
}

describe('CampaignWhatIfEditor run context and load-legs request', () => {
  it('反事实 Legs 与原始 Legs 同样先完整纵向展开，再显示辅助盘面', async () => {
    render(renderEditor(vi.fn()));
    const table = await screen.findByTestId('counterfactual-legs-table');
    const chart = screen.getByTestId('counterfactual-chart-section');

    expect(table.className).toContain('order-3');
    expect(chart.className).toContain('order-4');
    expect(table.className).not.toContain('max-h-');
    expect(table.className).not.toContain('overflow-y-auto');
    expect(within(table).getAllByRole('row')).toHaveLength(baselineLegs.length + 1);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    baselineState.override = null;
  });

  it('一键运行递出基线腿与编辑器全部腿；停用的腿留在 manualLegs、不进 params.manual_legs', async () => {
    const onRunWhatIf = vi.fn();
    render(renderEditor(onRunWhatIf));

    await waitFor(() => expect(screen.getAllByDisplayValue('110')).toHaveLength(1));
    // 改主力平仓价、停用初始对冲 A
    fireEvent.change(screen.getByDisplayValue('110'), { target: { value: '120' } });
    fireEvent.click(screen.getAllByRole('button', { name: '停用' })[1]);

    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));

    expect(onRunWhatIf).toHaveBeenCalledTimes(1);
    const [label, params, context] = onRunWhatIf.mock.calls[0] as [string, { manual_legs: CampaignCounterfactualManualLeg[] }, CampaignWhatIfRunContext];
    expect(label).toBe('手动调整');
    expect(params.manual_legs.map(leg => leg.id)).toEqual(['main']);
    expect(params.manual_legs[0].exit_price).toBe(120);
    // 基线是重置那一刻的 buildManualLegs 输出，编辑不动它
    expect(context.baselineLegs).toEqual(baselineLegs);
    expect(context.manualLegs.map(leg => [leg.id, leg.enabled, leg.exit_price])).toEqual([
      ['main', true, 120],
      ['hedge-a', false, 90],
    ]);
  });

  it('loadLegsRequest 的 nonce 变化时整体替换副本（保留 id），基线不变；同一 nonce 重渲染不重复载入', async () => {
    const onRunWhatIf = vi.fn();
    const loaded: CampaignCounterfactualManualLeg[] = [
      { ...baselineLegs[0], exit_price: 130, size_usdt: 700 },
      {
        id: 'manual-77',
        leg_role: 'hedge_rolling',
        direction: 'short',
        open_time: '2026-01-02T01:00:00.000Z',
        close_time: '2026-01-02T02:00:00.000Z',
        entry_price: 95,
        exit_price: 92,
        size_usdt: 500,
        leverage: 1,
        enabled: true,
      },
    ];
    const view = render(renderEditor(onRunWhatIf));
    await waitFor(() => expect(screen.getAllByDisplayValue('110')).toHaveLength(1));

    view.rerender(renderEditor(onRunWhatIf, { nonce: 1, legs: loaded }));
    await waitFor(() => expect(screen.getByDisplayValue('130')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('110')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('92')).toBeInTheDocument();

    // 载入后再改一格，再用同一个 nonce 重渲染：不能把刚改的又冲掉
    fireEvent.change(screen.getByDisplayValue('130'), { target: { value: '135' } });
    view.rerender(renderEditor(onRunWhatIf, { nonce: 1, legs: loaded }));
    expect(screen.getByDisplayValue('135')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    const [, params, context] = onRunWhatIf.mock.calls[0] as [string, { manual_legs: CampaignCounterfactualManualLeg[] }, CampaignWhatIfRunContext];
    expect(params.manual_legs.map(leg => [leg.id, leg.exit_price, leg.size_usdt])).toEqual([
      ['main', 135, 700],
      ['manual-77', 92, 500],
    ]);
    expect(context.baselineLegs).toEqual(baselineLegs);

    // 「还原 Legs」仍回到基线
    fireEvent.click(screen.getByRole('button', { name: '还原 Legs' }));
    await waitFor(() => expect(screen.getByDisplayValue('110')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('92')).not.toBeInTheDocument();
  });

  it('战役行只换对象不换推演参数（如「保存备注」只写 deviation_notes）：载入与手改的腿都不被重置', async () => {
    const onRunWhatIf = vi.fn();
    const loaded: CampaignCounterfactualManualLeg[] = [{ ...baselineLegs[0], exit_price: 123 }];
    const view = render(renderEditor(onRunWhatIf));
    await waitFor(() => expect(screen.getAllByDisplayValue('110')).toHaveLength(1));

    view.rerender(renderEditor(onRunWhatIf, { nonce: 1, legs: loaded }));
    await waitFor(() => expect(screen.getByDisplayValue('123')).toBeInTheDocument());

    // 页面「保存备注」后 setCampaign({ ...prev, deviation_notes })：新对象、同样的推演参数
    const withNotes: TradeCampaign = {
      ...campaign,
      deviation_notes: { main: { category: '开仓', reason: '早了', fix: '等回踩' } },
    };
    view.rerender(renderEditor(onRunWhatIf, { nonce: 1, legs: loaded }, withNotes));
    expect(screen.getByDisplayValue('123')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('110')).not.toBeInTheDocument();

    // 手改到一半再保存一次备注，同样不能被冲掉
    fireEvent.change(screen.getByDisplayValue('123'), { target: { value: '125' } });
    view.rerender(renderEditor(onRunWhatIf, { nonce: 1, legs: loaded }, { ...withNotes, deviation_notes: { ...withNotes.deviation_notes } }));
    expect(screen.getByDisplayValue('125')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    const [, params, context] = onRunWhatIf.mock.calls[0] as [string, { manual_legs: CampaignCounterfactualManualLeg[] }, CampaignWhatIfRunContext];
    expect(params.manual_legs.map(leg => [leg.id, leg.exit_price])).toEqual([['main', 125]]);
    expect(context.baselineLegs).toEqual(baselineLegs);
  });

  it('载入口径统一之前保存的分支：没改过的挂单按基线补回「挂单中」，实际成交结果照补；改过价的挂单按成交处理，但开关照画、能切回去', async () => {
    const actualMain: CampaignCounterfactualManualLeg['actual'] = {
      source: 'records',
      direction: 'long',
      open_time: baselineLegs[0].open_time,
      close_time: baselineLegs[0].close_time,
      entry_price: 100,
      exit_price: 110,
      size_usdt: 1_000,
      realized_pnl_usdt: 99.45,
      close_fee_usdt: 0.55,
      open_fee_usdt: 0.5,
    };
    baselineState.override = [
      { ...baselineLegs[0], actual: actualMain },
      { ...baselineLegs[1], filled: false },
    ];
    const onRunWhatIf = vi.fn();
    // 老行：两条腿都没有 actual / filled，内容与基线一致；挂单的平仓时间是保存那一刻 K 线窗口的末根（与现在不同）
    const legacy = baselineLegs.map(leg => (leg.id === 'hedge-a' ? { ...leg, close_time: '2026-01-02T02:45:00.000Z' } : { ...leg }));
    const view = render(renderEditor(onRunWhatIf));
    await waitFor(() => expect(screen.getByTestId('counterfactual-leg-filled-toggle-hedge-a')).toBeInTheDocument());

    view.rerender(renderEditor(onRunWhatIf, { nonce: 1, legs: legacy }));
    await waitFor(() => expect(screen.getByTestId('counterfactual-leg-filled-toggle-hedge-a')).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.getByText('挂单中')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    const [, params, context] = onRunWhatIf.mock.calls[0] as [string, { manual_legs: CampaignCounterfactualManualLeg[] }, CampaignWhatIfRunContext];
    expect(params.manual_legs[0].actual).toEqual(actualMain);
    expect(params.manual_legs[1].filled).toBe(false);
    // 挂单的平仓时间只是兜底：换回基线的，不算改动
    expect(params.manual_legs[1].close_time).toBe(baselineLegs[1].close_time);
    // 补回来的只是事实：与基线比没有任何改动
    expect(context.manualLegs.map(leg => leg.filled)).toEqual([undefined, false]);

    // 老行里改过价的挂单：老引擎当它成交，用户当时就在模拟成交——写成 filled: true，开关照画（「已成交」按下）
    const editedLegacy = [legacy[0], { ...legacy[1], entry_price: 97 }];
    view.rerender(renderEditor(onRunWhatIf, { nonce: 2, legs: editedLegacy }));
    await waitFor(() => expect(screen.getByDisplayValue('97')).toBeInTheDocument());
    const toggle = screen.getByTestId('counterfactual-leg-filled-toggle-hedge-a');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('挂单中')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    const [, editedParams] = onRunWhatIf.mock.calls[1] as [string, { manual_legs: CampaignCounterfactualManualLeg[] }];
    expect(editedParams.manual_legs[1].filled).toBe(true);
    expect(editedParams.manual_legs[0].actual).toEqual(actualMain);

    // 价改回原值、再点开关切回「未成交」：这条腿回到挂单
    fireEvent.change(screen.getByDisplayValue('97'), { target: { value: '90' } });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('挂单中')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    const [, revertedParams] = onRunWhatIf.mock.calls[2] as [string, { manual_legs: CampaignCounterfactualManualLeg[] }];
    expect(revertedParams.manual_legs[1]).toMatchObject({ filled: false, entry_price: 90 });
  });

  it('载入时带上那次运行的改动摘要：没改过平仓时间的未平仓腿按基线当前的兜底值收；没有摘要的老行认不出，原样保留', async () => {
    // 进行中的战役、主力还没平：基线的平仓时间是现在 K 线窗口的末根（02:00），比老行保存时的末根（01:30）晚
    const actualOpenMain: CampaignCounterfactualManualLeg['actual'] = {
      source: 'unsettled',
      direction: 'long',
      open_time: baselineLegs[0].open_time,
      close_time: baselineLegs[0].close_time,
      entry_price: 100,
      exit_price: 100,
      size_usdt: 1_000,
      realized_pnl_usdt: 0,
      close_fee_usdt: null,
      open_fee_usdt: null,
      close_time_fallback: true,
      still_open: true,
    };
    baselineState.override = [
      { ...baselineLegs[0], exit_price: 100, actual: actualOpenMain },
      { ...baselineLegs[1], filled: false },
    ];
    const onRunWhatIf = vi.fn();
    const legacy = [
      { ...baselineLegs[0], exit_price: 100, close_time: '2026-01-02T01:30:00.000Z' },
      { ...baselineLegs[1], close_time: '2026-01-02T01:30:00.000Z' },
    ];
    const view = render(renderEditor(onRunWhatIf));
    await waitFor(() => expect(screen.getByTestId('counterfactual-leg-filled-toggle-hedge-a')).toBeInTheDocument());

    // 没有摘要、运行时末根（01:45）也对不上：认不出，保存的 01:30 原样保留
    view.rerender(renderEditor(onRunWhatIf, { nonce: 1, legs: legacy, savedWindowEnd: '2026-01-02T01:45:00.000Z' }));
    await waitFor(() => expect(screen.getByTestId('counterfactual-leg-filled-toggle-hedge-a')).toHaveAttribute('aria-pressed', 'false'));
    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    const [, withoutSummary] = onRunWhatIf.mock.calls[0] as [string, { manual_legs: CampaignCounterfactualManualLeg[] }];
    expect(withoutSummary.manual_legs[0].close_time).toBe('2026-01-02T01:30:00.000Z');

    // 带着「未改动」的摘要：换成基线当前的 02:00，与基线比没有改动
    view.rerender(renderEditor(onRunWhatIf, {
      nonce: 2,
      legs: legacy,
      savedWindowEnd: '2026-01-02T01:45:00.000Z',
      savedChangeSummary: { short: '未改动', lines: [], legs: [] },
    }));
    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    await waitFor(() => expect(onRunWhatIf).toHaveBeenCalledTimes(2));
    const [, withSummary, context] = onRunWhatIf.mock.calls[1] as [string, { manual_legs: CampaignCounterfactualManualLeg[] }, CampaignWhatIfRunContext];
    expect(withSummary.manual_legs[0].close_time).toBe(baselineLegs[0].close_time);
    expect(withSummary.manual_legs[0].actual).toEqual(actualOpenMain);
    expect(context.manualLegs.map(leg => leg.close_time)).toEqual(context.baselineLegs.map(leg => leg.close_time));
  });

  it('币本位战役里「增添」的腿抄原始 Legs 的结算方式与面值，按币本位收费', async () => {
    baselineState.override = [
      { ...baselineLegs[0], settlement_mode: 'coin', contract_size_usd: 100 },
      { ...baselineLegs[1] },
    ];
    const onRunWhatIf = vi.fn();
    render(renderEditor(onRunWhatIf));
    await waitFor(() => expect(screen.getAllByDisplayValue('110')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '增添' }));
    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    const [, params] = onRunWhatIf.mock.calls[0] as [string, { manual_legs: CampaignCounterfactualManualLeg[] }];
    const added = params.manual_legs.find(leg => leg.id.startsWith('manual-'));
    expect(added).toMatchObject({ settlement_mode: 'coin', contract_size_usd: 100 });
  });
});
