/**
 * 反事实编辑器里的爆仓腿：平仓价与平仓时间两格锁死。
 *
 * 「如果当时晚一点平」对一条被强平的腿不成立——仓位是交易所在强平价上收走的，
 * 那之后的价格根本不属于它。以前这两格随便拖：0.9540 拖到 0.8500，
 * 一条保证金只有 1000 的腿被算出 −3078.96。
 */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCampaignKlineTimeWindow } from '@/hooks/useCampaignKlines';
import type { CampaignCounterfactualManualLeg, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import { CampaignWhatIfEditor } from '../CampaignWhatIfEditor';

vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: () => <div data-testid="counterfactual-chart" />,
}));

const { baselineLegs } = vi.hoisted(() => ({
  baselineLegs: [
    {
      id: 'liq',
      leg_role: 'main_open',
      direction: 'long',
      open_time: '2026-01-02T00:30:00.000Z',
      close_time: '2026-01-02T02:00:00.000Z',
      entry_price: 1,
      exit_price: 0.954,
      size_usdt: 20_000,
      leverage: 20,
      enabled: true,
      actual: {
        source: 'records',
        direction: 'long',
        open_time: '2026-01-02T00:30:00.000Z',
        close_time: '2026-01-02T02:00:00.000Z',
        entry_price: 1,
        exit_price: 0.954,
        size_usdt: 20_000,
        realized_pnl_usdt: -1000,
        close_fee_usdt: 12,
        open_fee_usdt: 10,
        liquidated: true,
        cuts: [{
          open_time: '2026-01-02T00:30:00.000Z',
          close_time: '2026-01-02T02:00:00.000Z',
          entry_price: 1,
          exit_price: 0.954,
          size_usdt: 20_000,
          realized_pnl_usdt: -1000,
          close_fee_usdt: 12,
          close_fee_rate: 0.0005,
          open_fee_usdt: 10,
          open_fee_rate: 0.0005,
          pnl_floor_usdt: -1000,
        }],
      },
    },
    {
      id: 'normal',
      leg_role: 'main_add_1',
      direction: 'long',
      open_time: '2026-01-02T00:40:00.000Z',
      close_time: '2026-01-02T02:00:00.000Z',
      entry_price: 1,
      exit_price: 1.1,
      size_usdt: 1_000,
      leverage: 20,
      enabled: true,
    },
  ] as CampaignCounterfactualManualLeg[],
}));

vi.mock('@/lib/campaignSimulationEngine', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/campaignSimulationEngine')>()),
  buildActualSimulationParams: () => ({
    entry: { time: '2026-01-02T00:30:00.000Z', price: 1, size_usdt: 20_000, direction: 'long', leverage: 20 },
    hedge_a: { offset_pct: 1, size_pct: 50 },
    hedge_b: { offset_pct: 2, size_pct: 50 },
    mirror_tp: { offset_pct: 1, size_pct: 50 },
    rolling: {
      enabled: false, trigger_rise_pct: 0, min_interval_minutes: 0,
      new_hedge_offset_pct: 0, rolling_hedge_size_pct: 0,
    },
    exit_rule: 'manual_only',
  }),
  buildPureSopParams: () => null,
  buildManualLegs: () => baselineLegs.map(leg => ({ ...leg })),
}));

const campaign: TradeCampaign = {
  id: 'campaign-1',
  user_id: 'user-1',
  campaign_code: 'C-CAMPAIGN1',
  symbol: 'XUSDT',
  direction: 'main_long',
  status: 'closed_loss',
  strategy_template: 'custom',
  title: 'XUSDT campaign',
  opened_at: '2026-01-02T00:30:00.000Z',
  closed_at: '2026-01-02T02:30:00.000Z',
  initial_main_size_usdt: 20_000,
  initial_leverage: 20,
  final_realized_pnl: -1000,
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
  { time: timeWindow.fromTime, open: 1, high: 1.01, low: 0.99, close: 1, volume: 1 },
  { time: timeWindow.toTime, open: 1, high: 1.01, low: 0.8, close: 0.95, volume: 1 },
];

const noLegs: TradeJournal[] = [];
const noRecords: TradeRecord[] = [];
const noCorrections = {};

const renderEditor = () => render(
  <CampaignWhatIfEditor
    campaign={campaign}
    legs={noLegs}
    tradeRecords={noRecords}
    legExitPriceCorrections={noCorrections}
    klines={klines}
    klinesLoading={false}
    interval="5m"
    klineTimeWindow={timeWindow}
    timezone="Asia/Shanghai"
    whatIfRunning={false}
    onRunWhatIf={vi.fn()}
    loadLegsRequest={null}
  />,
);

describe('反事实编辑器：爆仓腿改不动平仓那一端', () => {
  beforeEach(() => vi.clearAllMocks());

  it('爆仓腿挂红色「爆仓」标记，方向 / 平仓价 / 平仓时间三格禁用并写明原因；其余腿照常可改', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('counterfactual-leg-exit-price-liq')).toBeInTheDocument());

    expect(screen.getByTestId('counterfactual-leg-liquidated-liq').textContent).toBe('爆仓');
    const exitPrice = screen.getByTestId('counterfactual-leg-exit-price-liq') as HTMLInputElement;
    const closeTime = screen.getByTestId('counterfactual-leg-close-time-liq') as HTMLInputElement;
    expect(exitPrice.disabled).toBe(true);
    expect(closeTime.disabled).toBe(true);
    expect(exitPrice.getAttribute('title')).toContain('被交易所强平');

    expect(screen.queryByTestId('counterfactual-leg-liquidated-normal')).toBeNull();
    expect((screen.getByTestId('counterfactual-leg-exit-price-normal') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByTestId('counterfactual-leg-close-time-normal') as HTMLInputElement).disabled).toBe(false);
    // 方向也锁死：多单翻成空单后这笔强平在现实里已不存在，锁着的平仓价与按原方向算的封顶都会套错方向
    const direction = screen.getByTestId('counterfactual-leg-direction-liq') as HTMLSelectElement;
    expect(direction.disabled).toBe(true);
    expect(direction.title).toContain('方向');
    expect((screen.getByTestId('counterfactual-leg-direction-normal') as HTMLSelectElement).disabled).toBe(false);
  });
});
