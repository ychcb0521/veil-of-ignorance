/**
 * 「结束战役」对话框：状态不是选出来的，是算出来的。
 *
 * 已结算的战役由详情页传进来的校正后结算推出状态并预选，其余三个（含「放弃」）锁死；
 * 写库的 final_realized_pnl 就是页面显示的那个数（校正后），不是 Σ record.pnl 的老口径。
 * 未结算时退回原来的手选流程，「放弃」只在这一档可选。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { DecisionAccuracyResult } from '@/lib/campaignAnalysis';
import {
  CORRECTED_LOSS_CLOSED_AT,
  CORRECTED_TOTAL,
  PLANNED_MAX_LOSS_TOTAL,
  activeVariant,
  correctedLossCorrections,
  correctedLossLegs,
  correctedLossStoredCampaign,
  correctedLossTradeRecords,
} from '@/test/fixtures/correctedLossCampaign';
import { EndCampaignDialog } from '../EndCampaignDialog';

const { closeCampaignMock, appendCampaignEventMock } = vi.hoisted(() => ({
  closeCampaignMock: vi.fn(async () => undefined),
  appendCampaignEventMock: vi.fn(async () => undefined),
}));

vi.mock('@/lib/journalApi', () => ({
  closeCampaign: closeCampaignMock,
  appendCampaignEvent: appendCampaignEventMock,
}));

const accuracy = {
  hedge_precision: 0,
  mirror_tp_capture: 0,
  initial_expected_max_loss: 10_000,
  profit_capture_ratio: -17.5,
  campaign_max_drawdown_real: 2_000,
  campaign_max_profit_real: 6_000,
} as unknown as DecisionAccuracyResult;

function statusButton(label: string): HTMLButtonElement {
  return screen.getByRole('button', { name: label }) as HTMLButtonElement;
}

describe('EndCampaignDialog · 由校正后的结算推出状态', () => {
  beforeEach(() => {
    closeCampaignMock.mockClear();
    appendCampaignEventMock.mockClear();
  });

  it('已结算：预选 closed_loss、锁死其余三个状态，写库的金额是校正后的 −1756.65', async () => {
    const campaign = correctedLossStoredCampaign({ status: 'active', closed_at: null });
    const legs = correctedLossLegs();
    const tradeRecords = correctedLossTradeRecords();
    const settlement = computeCampaignRealizedPnl(campaign, legs, tradeRecords, correctedLossCorrections());
    expect(settlement.settled).toBe(true);

    render(
      <EndCampaignDialog
        open
        onOpenChange={() => undefined}
        campaign={campaign}
        legs={legs}
        tradeRecords={tradeRecords}
        settlement={settlement}
        accuracy={accuracy}
        currentSimulatedTime={Date.parse(CORRECTED_LOSS_CLOSED_AT)}
        onClosed={() => undefined}
      />,
    );

    await screen.findByRole('dialog');
    expect(statusButton('closed_loss').className).toContain('border-[#F0B90B]');
    expect(statusButton('closed_profit')).toBeDisabled();
    expect(statusButton('closed_profit')).toHaveAttribute('title', '状态由已实现盈亏推出');
    expect(statusButton('closed_breakeven')).toBeDisabled();
    expect(statusButton('abandoned')).toBeDisabled();
    expect(screen.getByText(/状态由已实现盈亏推出：-1756\.65 USDT/)).toBeInTheDocument();

    // 点被锁死的 closed_profit 没有任何效果
    fireEvent.click(statusButton('closed_profit'));
    expect(statusButton('closed_loss').className).toContain('border-[#F0B90B]');

    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));
    await waitFor(() => expect(closeCampaignMock).toHaveBeenCalledTimes(1));
    const [id, patch] = closeCampaignMock.mock.calls[0] as unknown as [string, {
      status: string;
      final_realized_pnl: number | null;
      final_r_multiple: number | null;
      closed_at: string;
    }];
    expect(id).toBe(campaign.id);
    expect(patch.status).toBe('closed_loss');
    expect(patch.final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(patch.final_r_multiple).toBeCloseTo(CORRECTED_TOTAL / PLANNED_MAX_LOSS_TOTAL, 8);
    expect(appendCampaignEventMock).toHaveBeenCalledTimes(1);
  });

  it('已结算时「放弃」也锁死：它只留给还有腿没平的战役，写进去也会被自愈改回 closed_*', async () => {
    const campaign = correctedLossStoredCampaign({ status: 'active', closed_at: null });
    const legs = correctedLossLegs();
    const tradeRecords = correctedLossTradeRecords();
    const settlement = computeCampaignRealizedPnl(campaign, legs, tradeRecords, correctedLossCorrections());

    render(
      <EndCampaignDialog
        open
        onOpenChange={() => undefined}
        campaign={campaign}
        legs={legs}
        tradeRecords={tradeRecords}
        settlement={settlement}
        accuracy={accuracy}
        currentSimulatedTime={Date.parse(CORRECTED_LOSS_CLOSED_AT)}
        onClosed={() => undefined}
      />,
    );

    await screen.findByRole('dialog');
    expect(statusButton('abandoned')).toBeDisabled();
    expect(statusButton('abandoned')).toHaveAttribute('title', '状态由已实现盈亏推出');
    fireEvent.click(statusButton('abandoned'));
    expect(statusButton('closed_loss').className).toContain('border-[#F0B90B]');
    expect(statusButton('abandoned').className).not.toContain('border-[#F0B90B]');
    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));
    await waitFor(() => expect(closeCampaignMock).toHaveBeenCalledTimes(1));
    expect((closeCampaignMock.mock.calls[0] as unknown as [string, { status: string }])[1].status).toBe('closed_loss');
  });

  it('未结算：退回手选流程，默认 closed_profit，没有按钮被锁死，「放弃」在这一档可选', async () => {
    const active = activeVariant();
    const settlement = computeCampaignRealizedPnl(active.campaign, active.legs, active.tradeRecords, correctedLossCorrections());
    expect(settlement.settled).toBe(false);

    render(
      <EndCampaignDialog
        open
        onOpenChange={() => undefined}
        campaign={active.campaign}
        legs={active.legs}
        tradeRecords={active.tradeRecords}
        settlement={settlement}
        accuracy={accuracy}
        currentSimulatedTime={Date.parse(CORRECTED_LOSS_CLOSED_AT)}
        onClosed={() => undefined}
      />,
    );

    await screen.findByRole('dialog');
    expect(statusButton('closed_profit').className).toContain('border-[#F0B90B]');
    for (const label of ['closed_profit', 'closed_loss', 'closed_breakeven', 'abandoned']) {
      expect(statusButton(label)).not.toBeDisabled();
    }
    expect(screen.queryByText(/状态由已实现盈亏推出/)).not.toBeInTheDocument();
    fireEvent.click(statusButton('closed_loss'));
    expect(statusButton('closed_loss').className).toContain('border-[#F0B90B]');
    fireEvent.click(statusButton('abandoned'));
    expect(statusButton('abandoned').className).toContain('border-[#F0B90B]');
    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));
    await waitFor(() => expect(closeCampaignMock).toHaveBeenCalledTimes(1));
    expect((closeCampaignMock.mock.calls[0] as unknown as [string, { status: string }])[1].status).toBe('abandoned');
  });
});
