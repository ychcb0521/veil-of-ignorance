/**
 * 「结束战役」对话框的结束时间：输入框里是本地墙钟，写库的是确切的时刻。
 *
 * 曾经按 UTC 墙钟预填（toISOString().slice(0, 16)），却按本地时间解析（new Date('YYYY-MM-DDTHH:mm')）：
 * 用户在东八区，存下的 closed_at 比模拟时钟早 8 小时，战役页的扫描窗口在最后一次平仓之前就截断，
 * 峰值浮盈 / 最大回撤只扫到半程。这里把时区钉在 Asia/Shanghai（vitest 默认的 forks 池里改 TZ 立即生效）；
 * 断言本身不依赖时区：预填 = 本地墙钟，没动过就写确切的模拟时钟，动过就按本地时间解析。
 */
process.env.TZ = 'Asia/Shanghai';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionAccuracyResult } from '@/lib/campaignAnalysis';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { fromLocalDateTimeInputValue, toLocalDateTimeInputValue } from '@/lib/localDateTimeInput';
import {
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
  hedge_precision: [],
  mirror_tp_capture: null,
  initial_expected_max_loss: 10_000,
  profit_capture_ratio: -17.5,
  campaign_max_drawdown_real: 2_000,
  campaign_max_profit_real: 6_000,
} as unknown as DecisionAccuracyResult;

/** 模拟时钟停在一分钟的中间：截到分钟会比它早 30 秒。 */
const SIM_TIME = Date.parse('2026-01-01T03:00:30.000Z');

function renderDialog(currentSimulatedTime = SIM_TIME, open = true) {
  const campaign = correctedLossStoredCampaign({ status: 'active', closed_at: null });
  const legs = correctedLossLegs();
  const tradeRecords = correctedLossTradeRecords();
  const settlement = computeCampaignRealizedPnl(campaign, legs, tradeRecords, correctedLossCorrections());
  const props = {
    onOpenChange: () => undefined,
    campaign,
    legs,
    tradeRecords,
    settlement,
    accuracy,
    onClosed: () => undefined,
  };
  const view = render(<EndCampaignDialog {...props} open={open} currentSimulatedTime={currentSimulatedTime} />);
  const rerender = (next: { currentSimulatedTime?: number; open?: boolean }) => view.rerender(
    <EndCampaignDialog
      {...props}
      open={next.open ?? open}
      currentSimulatedTime={next.currentSimulatedTime ?? currentSimulatedTime}
    />,
  );
  return { rerender };
}

function closedAtInput(): HTMLInputElement {
  return document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
}

async function submittedClosedAt(): Promise<string> {
  fireEvent.click(screen.getByRole('button', { name: '确认结束' }));
  await waitFor(() => expect(closeCampaignMock).toHaveBeenCalledTimes(1));
  const [, patch] = closeCampaignMock.mock.calls[0] as unknown as [string, { closed_at: string }];
  const [, event] = appendCampaignEventMock.mock.calls[0] as unknown as [string, { timestamp: string }];
  expect(event.timestamp).toBe(patch.closed_at);
  return patch.closed_at;
}

/** 整个对话框渲染在负载高的机器上单条就要几秒：留足余量，免得超时被读成失败。 */
describe('EndCampaignDialog · 结束时间按本地墙钟显示、按确切时刻写库', { timeout: 30_000 }, () => {
  beforeEach(() => {
    closeCampaignMock.mockClear();
    appendCampaignEventMock.mockClear();
  });

  it('时区确实钉在东八区（否则下面的「早 8 小时」复现不出来）', () => {
    expect(new Date(SIM_TIME).getTimezoneOffset()).toBe(-480);
  });

  it('预填的是本地墙钟：东八区里 03:00:30Z 显示 11:00，不是 UTC 的 03:00', async () => {
    renderDialog();
    await screen.findByRole('dialog');
    expect(closedAtInput().value).toBe(toLocalDateTimeInputValue(SIM_TIME));
    expect(closedAtInput().value).toBe('2026-01-01T11:00');
    // 按本地时间解析回去，恰是模拟时钟截到分钟——不是早 8 小时
    expect(Date.parse(fromLocalDateTimeInputValue(closedAtInput().value, ''))).toBe(SIM_TIME - 30_000);
  });

  it('没动过结束时间：写库的是确切的模拟时钟（不截到分钟，不早 8 小时）', async () => {
    renderDialog();
    await screen.findByRole('dialog');
    expect(await submittedClosedAt()).toBe(new Date(SIM_TIME).toISOString());
  });

  it('对话框一直挂在页面上：模拟时钟走了，预填与写库都跟着现在的时钟', async () => {
    const { rerender } = renderDialog(SIM_TIME);
    await screen.findByRole('dialog');
    const later = SIM_TIME + 45 * 60_000 + 7_000;
    rerender({ currentSimulatedTime: later });
    expect(closedAtInput().value).toBe(toLocalDateTimeInputValue(later));
    expect(await submittedClosedAt()).toBe(new Date(later).toISOString());
  });

  it('改过结束时间：按输入框里的本地墙钟写库', async () => {
    renderDialog();
    await screen.findByRole('dialog');
    fireEvent.change(closedAtInput(), { target: { value: '2026-01-01T12:15' } });
    expect(closedAtInput().value).toBe('2026-01-01T12:15');
    const closedAt = await submittedClosedAt();
    expect(closedAt).toBe(new Date('2026-01-01T12:15').toISOString());
    expect(closedAt).toBe('2026-01-01T04:15:00.000Z');
  });

  it('改回预填的那一分钟等于没改：仍写确切的模拟时钟；重新打开对话框清掉上次的改动', async () => {
    const { rerender } = renderDialog();
    await screen.findByRole('dialog');
    fireEvent.change(closedAtInput(), { target: { value: '2026-01-01T12:15' } });
    rerender({ open: false });
    rerender({ open: true });
    await screen.findByRole('dialog');
    expect(closedAtInput().value).toBe('2026-01-01T11:00');
    fireEvent.change(closedAtInput(), { target: { value: '2026-01-01T11:05' } });
    fireEvent.change(closedAtInput(), { target: { value: '2026-01-01T11:00' } });
    expect(await submittedClosedAt()).toBe(new Date(SIM_TIME).toISOString());
  });
});
