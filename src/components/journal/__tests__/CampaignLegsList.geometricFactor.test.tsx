import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import { buildCampaignLegsExportRows } from '@/lib/campaignLegsPngExport';
import { buildCampaignLegGeometricFactors, LEG_GEOMETRIC_FACTOR_LABEL } from '@/lib/campaignLegGeometricFactor';
import { computeCampaignGeometricMetrics } from '@/lib/campaignGeometricMetrics';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const time = (hour: number) => Date.parse(`2026-10-12T0${hour}:00:00Z`);
function example() {
  const campaign = { id: 'c', direction: 'main_long', status: 'closed_profit', initial_main_size_usdt: 2000, actual_evolution: [] } as unknown as TradeCampaign;
  const sizes = [10, 10, 50.9, 30.45];
  const entries = [100, 100, 120, 140];
  const roles = ['main_open', 'mirror_tp', 'main_add_1', 'main_add_2'] as const;
  const ids = ['main', 'mirror', 'add1', 'add2'];
  const tradeRecords = ids.map((id, index) => ({
    id: `${id}-record`, fillId: id, symbol: 'TESTUSDT', side: 'LONG', action: 'CLOSE', type: 'MARKET',
    entryPrice: entries[index], exitPrice: 160, quantity: sizes[index], fee: 0,
    pnl: sizes[index] * (160 - entries[index]), openTime: time(index < 2 ? 0 : index), closeTime: time(index === 1 ? 1 : 8),
  } as TradeRecord));
  const legs = ids.map((id, index) => ({
    id, campaign_id: 'c', leg_role: roles[index], leg_sequence: index, direction: 'long', trade_record_id: `${id}-record`,
    pre_position_size: sizes[index] * entries[index], pre_entry_price: entries[index],
    pre_simulated_time: new Date(tradeRecords[index].openTime).toISOString(),
    post_simulated_close_time: new Date(tradeRecords[index].closeTime).toISOString(),
  } as TradeJournal));
  return { campaign, legs, tradeRecords, reverseHedgeOrders: [] };
}

describe('Legs per-add geometric factor', () => {
  it('counterfactual or legacy tables without a campaign never crash while mirror evidence is unavailable', () => {
    const data = example();
    render(<MemoryRouter><CampaignLegsList legs={data.legs} tradeRecords={data.tradeRecords} /></MemoryRouter>);
    expect(screen.getByTestId('leg-geometric-factor-mirror')).toHaveTextContent('—');
    expect(screen.getByTestId('leg-geometric-factor-theoretical-mirror')).toHaveTextContent('—');
    expect(screen.getByTestId('leg-geometric-factor-add1')).toHaveTextContent('6.09×');
  });
  it('renders the actual factor after share; its product matches campaign geometry and PNG', () => {
    const data = example();
    render(<MemoryRouter><CampaignLegsList {...data} /></MemoryRouter>);
    const header = screen.getByLabelText(LEG_GEOMETRIC_FACTOR_LABEL);
    expect(header.querySelector('span')).toHaveTextContent('1+α');
    expect(header).not.toHaveTextContent('仓位的几何复利');
    expect(within(header).getByRole('button', { name: '仓位的几何复利说明' })).toBeInTheDocument();
    expect(header.previousElementSibling).toBe(screen.getByRole('button', { name: /^按多单占比排序/ }));
    expect(header.nextElementSibling).toHaveTextContent('1+α（理论）');
    expect(header.nextElementSibling?.nextElementSibling).toHaveTextContent('加仓校验');
    expect(screen.getByTestId('leg-geometric-factor-add1')).toHaveTextContent('6.09×');
    expect(screen.getByTestId('leg-geometric-factor-add2')).toHaveTextContent('1.50×');
    expect(screen.getByTestId('leg-geometric-factor-main')).toBeEmptyDOMElement();
    expect(screen.getByTestId('leg-geometric-factor-mirror')).toHaveTextContent('0.50×');
    expect(screen.getByTestId('leg-geometric-factor-theoretical-mirror')).toHaveTextContent('0.50×');
    expect(screen.getByTestId('leg-geometric-factor-add1')).toHaveAttribute('title', expect.stringContaining('1 + 50.9 ÷ 10'));
    const factors = buildCampaignLegGeometricFactors(data);
    const product = factors.get('add1')!.multiple * factors.get('add2')!.multiple;
    expect(computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords).positionGeometricMultiple).toBeCloseTo(0.5 * product, 12);
    const png = buildCampaignLegsExportRows(data);
    expect(png.find(row => row.legId === 'add1')!.cells[10][0].text).toBe('6.09×');
    expect(png.find(row => row.legId === 'add2')!.cells[10][0].text).toBe('1.50×');
    expect(png.find(row => row.legId === 'mirror')!.cells[10][0].text).toBe('0.50×');
    expect(png.find(row => row.legId === 'mirror')!.cells[11][0].text).toBe('0.50×');
    expect(png.every(row => row.cells.length === 15)).toBe(true);
    expect(screen.getByTestId('legs-total-row').children).toHaveLength(15);
    fireEvent.click(screen.getByRole('button', { name: /^按多单占比排序/ }));
    expect(screen.getByTestId('leg-geometric-factor-add1')).toHaveTextContent('6.09×');
  });

  it('mirror actual and theoretical cells open the first-cut process based on main plus mirror coins', () => {
    render(<MemoryRouter><CampaignLegsList {...example()} /></MemoryRouter>);
    fireEvent.click(within(screen.getByTestId('leg-geometric-factor-mirror')).getByRole('button'));
    let dialog = screen.getByTestId('leg-geometric-factor-detail-dialog');
    expect(dialog).toHaveTextContent('镜像止盈 · 减仓因子');
    expect(dialog).toHaveTextContent('Q前 = 20 币（主力 + 镜像）');
    expect(dialog).toHaveTextContent('αf = ΔQ减 ÷ Q前 = 10 ÷ 20 ≈ 0.5（50.00%）');
    expect(dialog).toHaveTextContent('Q后 = Q前 − ΔQ减 = 20 − 10 = 10 币');
    expect(dialog).toHaveTextContent('1 − αf = Q后 ÷ Q前 = 10 ÷ 20 ≈ 0.5 ≈ 0.50×');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    fireEvent.click(within(screen.getByTestId('leg-geometric-factor-theoretical-mirror')).getByRole('button'));
    dialog = screen.getByTestId('leg-geometric-factor-detail-dialog');
    expect(dialog).toHaveTextContent('镜像止盈 · 减仓因子（理论）');
    expect(dialog).toHaveTextContent('理论累计公式也使用实际首次减仓比例，故此减仓因子与实际值相同');
  });

  it('simultaneous mirror cuts multiply to the one first-reduction factor instead of counting the cut twice', () => {
    const data = example();
    data.tradeRecords[1].quantity = 7;
    data.legs[1].pre_position_size = 700;
    data.legs.push({ ...data.legs[1], id: 'mirror2', trade_record_id: 'mirror2-record', pre_position_size: 300 });
    data.tradeRecords.push({ ...data.tradeRecords[1], id: 'mirror2-record', fillId: 'mirror2', quantity: 3 });
    const metrics = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords);
    const factors = metrics.geometricMetricBasis.initialReductionFactors!;
    expect(factors).toHaveLength(2);
    expect(factors.reduce((product, factor) => product * factor.multiple, 1)).toBeCloseTo(1 - metrics.geometricMetricBasis.earlyReductionFraction!);
    expect(factors.find(factor => factor.legId === 'mirror')?.beforeCoins).toBeCloseTo(20);
    expect(factors.find(factor => factor.legId === 'mirror2')?.beforeCoins).toBeCloseTo(13);
  });

  it('clicking each actual factor opens its own substituted process; close and sorting preserve row identity', () => {
    const data = example();
    render(<MemoryRouter><CampaignLegsList {...data} /></MemoryRouter>);
    fireEvent.click(within(screen.getByTestId('leg-geometric-factor-add1')).getByRole('button'));
    let dialog = screen.getByTestId('leg-geometric-factor-detail-dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('加仓1 · 仓位的几何复利');
    expect(dialog).toHaveTextContent('Q前 = 10 币');
    expect(dialog).toHaveTextContent('ΔQ = 50.9 币');
    expect(dialog).toHaveTextContent('α = ΔQ ÷ Q前 = 50.9 ÷ 10 ≈ 5.09（509.00%）');
    expect(dialog).toHaveTextContent('Q后 = Q前 + ΔQ = 10 + 50.9 = 60.9 币');
    expect(dialog).toHaveTextContent('60.9 ÷ 10 ≈ 6.09 ≈ 6.09×');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(screen.queryByTestId('leg-geometric-factor-detail-dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^按多单占比排序/ }));
    fireEvent.click(within(screen.getByTestId('leg-geometric-factor-add2')).getByRole('button'));
    dialog = screen.getByTestId('leg-geometric-factor-detail-dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('加仓2 · 仓位的几何复利');
    expect(dialog).toHaveTextContent('Q前 = 60.9 币');
    expect(dialog).toHaveTextContent('ΔQ = 30.45 币');
    expect(dialog).toHaveTextContent('30.45 ÷ 60.9 ≈ 0.5（50.00%）');
    expect(within(dialog).getByTestId('leg-geometric-factor-detail-value')).toHaveTextContent('1.50×');
  });

  it('the quiet header explanation names the metric without adding a second header line', () => {
    render(<MemoryRouter><CampaignLegsList {...example()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '仓位的几何复利说明' }));
    expect(screen.getByText('仓位的几何复利', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/点击加仓行的倍数/)).toBeInTheDocument();
  });

  it('missing prior quantity is unknown and never substituted with an allowable maximum', () => {
    const data = example();
    data.legs[0].pre_position_size = null;
    render(<MemoryRouter><CampaignLegsList {...data} /></MemoryRouter>);
    expect(screen.getByTestId('leg-geometric-factor-add1')).toHaveTextContent('—');
    expect(within(screen.getByTestId('leg-geometric-factor-add1')).queryByRole('button')).not.toBeInTheDocument();
    expect(buildCampaignLegsExportRows(data).find(row => row.legId === 'add1')!.cells[10][0].text).toBe('—');
  });
  it('theoretical column is separate, shows substituted budget once, and later uses actual weighted cost', () => {
    const data = example();
    const orders = [
      { id: 'k1', side: 'SHORT', price: 110, status: 'cancelled', createdAt: time(2), cancelledAt: time(3) },
      { id: 'k2', side: 'SHORT', price: 130, status: 'cancelled', createdAt: time(3), cancelledAt: time(8) },
    ] as typeof data.reverseHedgeOrders;
    render(<MemoryRouter><CampaignLegsList {...data} reverseHedgeOrders={orders} /></MemoryRouter>);
    expect(screen.getByTestId('leg-geometric-factor-add1')).toHaveTextContent('6.09×');
    expect(screen.getByTestId('leg-geometric-factor-theoretical-add1')).toHaveTextContent('8.00×');
    fireEvent.click(within(screen.getByTestId('leg-geometric-factor-theoretical-add1')).getByRole('button'));
    let dialog = screen.getByTestId('leg-geometric-factor-detail-dialog');
    expect(dialog).toHaveTextContent('G = 600 U');
    expect(dialog).toHaveTextContent('K* = K + G ÷ Q前 = 170');
    expect(dialog).toHaveTextContent('170 − 100');
    expect(dialog).toHaveTextContent('|120 − 110|');
    expect(dialog).toHaveTextContent('700.00%');
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    fireEvent.click(within(screen.getByTestId('leg-geometric-factor-theoretical-add2')).getByRole('button'));
    dialog = screen.getByTestId('leg-geometric-factor-detail-dialog');
    expect(dialog).toHaveTextContent('使用当次实际持仓加权成本 S前，不使用扣除 G 的保本线');
    expect(dialog).not.toHaveTextContent('G = 600');
    const metrics = computeCampaignGeometricMetrics(data.campaign, data.legs, data.tradeRecords, orders);
    expect(metrics.positionGeometricMultiple).toBeCloseTo(0.5 * 6.09 * 1.5);
    expect(metrics.positionGeometricMultipleTheoretical).toBeCloseTo(0.5 * 8 * (1 + (130 - (1000 + 50.9 * 120) / 60.9) / 10));
    const png = buildCampaignLegsExportRows({ ...data, reverseHedgeOrders: orders });
    expect(png.find(row => row.legId === 'add1')!.cells[11][0].text).toBe('8.00×');
  });
  it('an add without actual-fill evidence never invents a geometric factor', () => {
    const data = example();
    data.tradeRecords = data.tradeRecords.filter(record => record.id !== 'add2-record');
    data.legs[3].trade_record_id = null;
    data.legs[3].post_simulated_close_time = null;
    render(<MemoryRouter><CampaignLegsList {...data} /></MemoryRouter>);
    expect(screen.getByTestId('leg-geometric-factor-add2')).toBeEmptyDOMElement();
    expect(buildCampaignLegsExportRows(data).find(row => row.legId === 'add2')!.cells[10][0].text).toBe('');
  });
});
