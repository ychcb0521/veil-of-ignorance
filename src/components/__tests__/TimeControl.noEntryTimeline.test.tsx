// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeControl } from '../TimeControl';

/**
 * 「未下单但全程观察」：弹窗打开那一下锁定模拟时间，同一刻也要锁定回放时间线 id——
 * 且赶在自动暂停之前取（暂停本身不分叉，但取章的时刻必须与锁定的模拟时间一致）。
 */
const { dialogProps, getTimelineId } = vi.hoisted(() => ({
  dialogProps: vi.fn(),
  getTimelineId: vi.fn<(symbol?: string) => string | null>(() => 'tl-watch'),
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradeHistory: [],
    positionsMap: {},
    priceMap: { '0GUSDT': 1.5 },
    getEffectiveTime: () => 5_000,
    getTimelineId,
  }),
}));
vi.mock('@/lib/journalApi', () => ({ listAllCampaigns: vi.fn(async () => []) }));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({
  PreTradeSnapshotDialog: (props: Record<string, unknown>) => { dialogProps(props); return null; },
}));
vi.mock('@/lib/signalJumpDiagnostics', async (orig) => ({
  ...(await orig() as object),
  preflightSignalJumpIssues: vi.fn(async () => new Map()),
}));

function renderControl(status: 'playing' | 'paused') {
  const onPause = vi.fn();
  render(
    <TimeControl
      status={status} currentSimulatedTime={5_000} speed={1}
      onStart={() => {}} onPause={onPause} onResume={() => {}} onStop={() => {}} onSetSpeed={() => {}}
      activeSymbol="0GUSDT"
    />,
  );
  return onPause;
}

const lastDialogProps = () => dialogProps.mock.calls[dialogProps.mock.calls.length - 1][0];
const openNoEntry = () => fireEvent.click(screen.getAllByTitle(/未下单但全程观察/)[0]);

beforeEach(() => {
  dialogProps.mockClear();
  getTimelineId.mockClear();
});

describe('空仓观察弹窗锁定的回放时间线', () => {
  it('播放中按下：取当前标的的时间线 id 交给弹窗，然后才自动暂停', () => {
    const onPause = renderControl('playing');
    openNoEntry();
    expect(getTimelineId).toHaveBeenCalledWith('0GUSDT');
    expect(onPause).toHaveBeenCalledTimes(1);
    // 取章早于暂停（暂停不分叉，这里只是把顺序钉住）
    expect(getTimelineId.mock.invocationCallOrder[0]).toBeLessThan(onPause.mock.invocationCallOrder[0]);
    expect(lastDialogProps()).toMatchObject({
      isOpen: true, direction: 'no_entry', symbol: '0GUSDT', simulatedTimeMs: 5_000, timelineId: 'tl-watch',
    });
  });

  it('暂停中按下：同样取章，不再调暂停', () => {
    const onPause = renderControl('paused');
    openNoEntry();
    expect(onPause).not.toHaveBeenCalled();
    expect(lastDialogProps()).toMatchObject({ isOpen: true, timelineId: 'tl-watch' });
  });
});
