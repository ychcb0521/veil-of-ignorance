// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PreTradeSnapshotDialog } from '@/components/journal/PreTradeSnapshotDialog';
import { toast } from '@/lib/notificationCenter';
import type { PlaceOrderParams } from '@/contexts/TradingContext';
import type { SnapshotPayload } from '@/components/journal/PreTradeSnapshotForm';

/**
 * 弹窗打开那一刻锁定的回放时间线 id，随快照 / 空仓观望一起交给 journalApi（pre_timeline_id）。
 * 锁定发生在打开那一下：表单填了多久、期间钟有没有被倒回，都不改这枚章。
 */
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

const { api, recordObservationLogged } = vi.hoisted(() => ({
  api: {
    // 入参显式写成一个对象：mock.calls[n][0] 才有类型（vi.fn(async () => …) 的入参会被推成空元组）
    createJournalPreSnapshot: vi.fn(async (_input: Record<string, unknown>) => ({ id: 'j-1' })),
    createNoTradeJournal: vi.fn(async (_input: Record<string, unknown>) => ({ id: 'j-2' })),
    findUnreviewedJournals: vi.fn(async () => []),
    updateJournalTradeRef: vi.fn(async () => undefined),
  },
  recordObservationLogged: vi.fn(),
}));

// user 与 ctx 都必须是同一个对象：弹窗的「待评价」效应依赖 user 与 positionsMap，
// 每次渲染换一个新对象会让它无限重跑（setState → 重渲染 → 新对象 → 效应再跑），测试卡死。
vi.mock('@/contexts/AuthContext', () => {
  const auth = { user: { id: 'u-1' } };
  return { useAuth: () => auth };
});
vi.mock('@/contexts/TradingContext', () => {
  const ctx = {
    positionsMap: {},
    getSymbolLeverage: () => 5,
    getSymbolMarginMode: () => 'isolated',
    recordObservationLogged,
  };
  return { useTradingContext: () => ctx };
});
vi.mock('@/lib/journalApi', () => api);
vi.mock('@/lib/notificationCenter', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
// 表单本身不是这里的题目：两个按钮分别走「提交快照」与「太难不做」。
vi.mock('@/components/journal/PreTradeSnapshotForm', () => ({
  PreTradeSnapshotForm: ({ onSubmit, onTooHard }: {
    onSubmit: (payload: SnapshotPayload) => void;
    onTooHard: (input: { order_kind: 'main' | 'hedge' }) => void;
  }) => (
    <div>
      <button onClick={() => onSubmit({ order_kind: 'main', pre_entry_reason: '理由', pre_mental_state: 3 } as unknown as SnapshotPayload)}>
        提交快照
      </button>
      <button onClick={() => onTooHard({ order_kind: 'main' })}>太难不做</button>
    </div>
  ),
}));

const SIM = Date.parse('2024-01-15T08:00:00.000Z');

function renderDialog(over: Partial<ComponentProps<typeof PreTradeSnapshotDialog>> = {}) {
  const props: ComponentProps<typeof PreTradeSnapshotDialog> = {
    isOpen: true,
    onOpenChange: vi.fn(),
    mode: 'trade',
    symbol: 'BTCUSDT',
    direction: 'long',
    simulatedTimeMs: SIM,
    timelineId: 'tl-x',
    lockedEntryPrice: 100,
    leverage: 10,
    marginMode: 'isolated',
    pricePrecision: 2,
    ...over,
  };
  const view = render(<PreTradeSnapshotDialog {...props} />);
  return { ...view, props };
}

beforeEach(() => {
  api.createJournalPreSnapshot.mockClear();
  api.createNoTradeJournal.mockClear();
});

describe('开仓快照弹窗 · 回放时间线随快照落盘', () => {
  it('提交快照：pre_timeline_id 是打开那一刻锁定的 id，与 pre_simulated_time 同源', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('提交快照'));
    await waitFor(() => expect(api.createJournalPreSnapshot).toHaveBeenCalledTimes(1));
    expect(api.createJournalPreSnapshot.mock.calls[0][0]).toMatchObject({
      user_id: 'u-1',
      symbol: 'BTCUSDT',
      pre_simulated_time: new Date(SIM).toISOString(),
      pre_timeline_id: 'tl-x',
      pre_entry_price: 100,
    });
  });

  it('太难不做 → 确认空仓观望：createNoTradeJournal 同样带这枚章', async () => {
    renderDialog();
    fireEvent.click(screen.getByText('太难不做'));
    fireEvent.click(await screen.findByText('确认空仓观望'));
    await waitFor(() => expect(api.createNoTradeJournal).toHaveBeenCalledTimes(1));
    expect(api.createNoTradeJournal.mock.calls[0][0]).toMatchObject({
      symbol: 'BTCUSDT',
      direction: 'long',
      pre_simulated_time: new Date(SIM).toISOString(),
      pre_timeline_id: 'tl-x',
      no_trade_would_be_entry_price: 100,
    });
    expect(api.createJournalPreSnapshot).not.toHaveBeenCalled();
  });

  it('关掉再打开：重新锁定新的时间线 id；钟停着打开则是 null', async () => {
    const { rerender, props } = renderDialog();
    rerender(<PreTradeSnapshotDialog {...props} isOpen={false} />);
    rerender(<PreTradeSnapshotDialog {...props} isOpen timelineId="tl-y" simulatedTimeMs={SIM + 60_000} />);
    fireEvent.click(screen.getByText('提交快照'));
    await waitFor(() => expect(api.createJournalPreSnapshot).toHaveBeenCalledTimes(1));
    expect(api.createJournalPreSnapshot.mock.calls[0][0]).toMatchObject({
      pre_timeline_id: 'tl-y',
      pre_simulated_time: new Date(SIM + 60_000).toISOString(),
    });

    rerender(<PreTradeSnapshotDialog {...props} isOpen={false} />);
    rerender(<PreTradeSnapshotDialog {...props} isOpen timelineId={null} />);
    fireEvent.click(screen.getByText('提交快照'));
    await waitFor(() => expect(api.createJournalPreSnapshot).toHaveBeenCalledTimes(2));
    expect(api.createJournalPreSnapshot.mock.calls[1][0]).toMatchObject({ pre_timeline_id: null });
  });
});

describe('【复核】决策记录模式：引擎拒单时不报「已提交订单」', () => {
  const orderParams = { side: 'LONG', type: 'MARKET', quantity: 1 } as unknown as PlaceOrderParams;
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    api.updateJournalTradeRef.mockClear();
  });

  it('引擎返回 null（被拒，例如超过杠杆分层上限）：不报成功、不关联订单，说清快照已存但没有下单', async () => {
    const onPlaceOrder = vi.fn(() => null);
    const { props } = renderDialog({ orderParams, onPlaceOrder });
    fireEvent.click(screen.getByText('提交快照'));
    await waitFor(() => expect(onPlaceOrder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalledWith('已记录开仓快照并提交订单');
    expect(vi.mocked(toast.error).mock.calls.at(-1)?.[0]).toBe('订单被拒，没有下单；开仓快照已保存，但没有关联订单');
    expect(api.updateJournalTradeRef).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('下单抛错：同样不报成功', async () => {
    const onPlaceOrder = vi.fn(() => { throw new Error('boom'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderDialog({ orderParams, onPlaceOrder });
    fireEvent.click(screen.getByText('提交快照'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalledWith('已记录开仓快照并提交订单');
  });

  it('下出去了：报成功并关联成交 id', async () => {
    const onPlaceOrder = vi.fn(() => ({ id: 'fill-1' }));
    renderDialog({ orderParams, onPlaceOrder });
    fireEvent.click(screen.getByText('提交快照'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('已记录开仓快照并提交订单'));
    expect(api.updateJournalTradeRef).toHaveBeenCalledWith('j-1', 'fill-1');
  });

  it('下出去了但没有可关联的成交 id（分段 / 跟踪 / TWAP 返回空 id）：报成功、不关联', async () => {
    const onPlaceOrder = vi.fn(() => ({ id: '' }));
    renderDialog({ orderParams, onPlaceOrder });
    fireEvent.click(screen.getByText('提交快照'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('已记录开仓快照并提交订单'));
    expect(api.updateJournalTradeRef).not.toHaveBeenCalled();
  });
});
