import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { Position } from '@/types/trading';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    setSymbolLeverage: vi.fn(), tradingMode: 'direct',
    setTradeHistory: vi.fn(), setBalance: vi.fn(),
  }),
}));
vi.mock('@/lib/journalApi', () => ({
  findUnreviewedJournalForClose: vi.fn(async () => null),
  listJournals: vi.fn(async () => []),
  listJournalsByTradeRecordId: vi.fn(async () => []),
  backfillJournalFromRecord: vi.fn(),
  getJournalById: vi.fn(),
  syncTradeRecordCorrectionToJournals: vi.fn(async () => []),
}));
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

/**
 * 【复核 r7】两笔的卡也必须能**按成数平仓**，以及卡上的「保证金比率」要写先死的那一笔。
 *
 * 第 7 轮复核实测到的两件事：
 *   (b) children.length > 1 时按钮变成「全部平仓」，一点就市价平掉卡上每一笔、无弹窗无确认——
 *       一张有两笔的卡因此再也不能减仓 50%，而这个系统的止盈本来就是机械的镜像减半。
 *   (d) 卡上的「保证金比率」把两笔的保证金、盈亏、维持保证金各自加总再相除，于是在一条腿
 *       已经到强平价的价位上仍显示一个好看的数——与同一张卡上的「强平价格（最先）」讲相反的故事。
 *
 * 规则二让「分层加仓并进更新前的仓位」，两笔的卡因此少见了，但规则三那一格
 * （靠对冲豁免开的一笔旁边站着分层仓位）、以及混杠杆 / 混保证金模式的组仍会出现。
 */
const SYMBOL = 'KAITOUSDT';
const TIERED = { riskModel: 'binance-tiers-v1', riskSymbol: SYMBOL } as const;

const usdtPos = (id: string, quantity: number, entryPrice: number, over: Partial<Position> = {}): Position => ({
  id, side: 'LONG', quantity, entryPrice, leverage: 20, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT',
  margin: (quantity * entryPrice) / 20, isolatedMargin: (quantity * entryPrice) / 20, openTime: 1,
  ...over,
} as Position);

function renderPanel(positions: Position[], onClosePosition = vi.fn()) {
  const onCloseAllPositions = vi.fn();
  const ui = (list: Position[]) => (
    <PositionPanel
      positionsMap={{ [SYMBOL]: list }}
      ordersMap={{ [SYMBOL]: [] }}
      tradeHistory={[]}
      priceMap={{ [SYMBOL]: 0.96 }}
      activeSymbol={SYMBOL}
      onClosePosition={onClosePosition}
      onCancelOrder={vi.fn()}
      onCloseAllPositions={onCloseAllPositions}
      availableBalance={1_000_000}
      activeTab="positions"
      onTabChange={vi.fn()}
    />
  );
  const { rerender } = render(ui(positions));
  return { onClosePosition, onCloseAllPositions, rerender: (list: Position[]) => rerender(ui(list)) };
}

/** 卡上的「平仓」按钮（不是顶部工具栏里的「一键平仓」）。 */
const cardCloseButton = () => screen.getByRole('button', { name: '平仓' });

describe('【复核 r7】两笔的卡照样能按成数平仓', () => {
  const legacy = () => usdtPos('pre-update', 40_000, 1);
  /** 11,500 USDT 的分层加仓（@0.96 → 11,979.1667 个币）。 */
  const add = () => usdtPos('tiered-add', 11_500 / 0.96, 0.96, TIERED);

  it('按钮仍叫「平仓」、开的是同一个弹窗，成数摊到卡上每一笔（下标从大到小）', () => {
    const { onClosePosition, onCloseAllPositions } = renderPanel([legacy(), add()]);
    fireEvent.click(cardCloseButton());
    // 弹窗开了（不是一键市价平掉两笔）
    expect(screen.getByText('市价平仓')).toBeTruthy();
    expect(screen.getByTestId('close-leg-note')).toHaveTextContent('这张卡上有 2 笔仓位');
    expect(onCloseAllPositions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    fireEvent.click(screen.getByRole('button', { name: /^确认平仓/ }));
    expect(onClosePosition).toHaveBeenCalledTimes(2);
    // 下标从大到小：成数为 1 时那一笔会整个从数组里移除，下标随之前移
    expect(onClosePosition.mock.calls.map(c => c[1])).toEqual([1, 0]);
    for (const call of onClosePosition.mock.calls) {
      expect(call[0]).toBe(SYMBOL);
      expect(call[2] as number).toBeCloseTo(0.5, 6);
    }
  });

  it('「全部平仓」这个按钮不再存在：不会有一键、无确认、市价平掉两笔的路径', () => {
    renderPanel([legacy(), add()]);
    expect(screen.queryByRole('button', { name: '全部平仓' })).toBeNull();
  });

  it('只有一笔时一切照旧：一次调用、成数就是弹窗里那个，也不写那句说明', () => {
    const { onClosePosition } = renderPanel([legacy()]);
    fireEvent.click(cardCloseButton());
    expect(screen.queryByTestId('close-leg-note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '25%' }));
    fireEvent.click(screen.getByRole('button', { name: /^确认平仓/ }));
    expect(onClosePosition).toHaveBeenCalledTimes(1);
    expect(onClosePosition.mock.calls[0][0]).toBe(SYMBOL);
    expect(onClosePosition.mock.calls[0][1]).toBe(0);
    expect(onClosePosition.mock.calls[0][2] as number).toBeCloseTo(0.25, 6);
  });

  /**
   * 【复核 r8】那句说明不能硬写「维持保证金口径不同」：规则二之后两笔的卡多半来自杠杆 / 保证金模式 / 结算方式不同
   * （两笔都按旧 0.4% 也会因为杠杆不同而不并），口径不同只剩规则三那一格。
   */
  it('说明里不硬写「维持保证金口径不同」：10x + 20x 两笔都按旧 0.4% 的卡也写得对', () => {
    renderPanel([usdtPos('a', 10_000, 1, { leverage: 10 }), usdtPos('b', 10_000, 1, { leverage: 20 })]);
    fireEvent.click(cardCloseButton());
    const note = screen.getByTestId('close-leg-note');
    expect(note).toHaveTextContent('这张卡上有 2 笔仓位（杠杆 / 保证金模式 / 结算方式 / 维持保证金口径任一不同，没有合并）');
    expect(note.textContent).not.toContain('（维持保证金口径不同，没有合并）');
  });

  /**
   * 【复核 r8】弹窗开着的时候有一笔被强平：显示的仓位按还活着的腿重算，不是打开时的快照——
   * 否则「可用 51,979.1667」与预计盈亏仍写着两笔的合计，用户确认的是「50%」于一个已经不存在的数。
   * 挑好的成数保住：50% 仍是剩下那一笔的 50%。
   */
  it('弹窗开着时一笔被强平：可用数量与说明按还活着的腿重算、成数不变、确认只打活着的那笔', () => {
    const { onClosePosition, rerender } = renderPanel([legacy(), add()]);
    fireEvent.click(cardCloseButton());
    expect(screen.getByText(/可用 51,979\.1667 KAITO/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('25989.5833');

    // 加仓那一笔被强平（从盘上消失）
    rerender([legacy()]);
    expect(screen.queryByTestId('close-leg-note')).toBeNull();
    expect(screen.getByText(/可用 40,000\.0000 KAITO/)).toBeTruthy();
    expect(screen.queryByText(/51,979/)).toBeNull();
    // 成数保住：仍是 50%，按新的可用数量换算
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('20000');

    fireEvent.click(screen.getByRole('button', { name: /^确认平仓/ }));
    expect(onClosePosition).toHaveBeenCalledTimes(1);
    expect(onClosePosition.mock.calls[0][1]).toBe(0);
    expect(onClosePosition.mock.calls[0][2] as number).toBeCloseTo(0.5, 6);
  });

  it('弹窗里的数量与开仓价是这一组的合计与加权价，所以 100% 盖住整张卡', () => {
    const { onClosePosition } = renderPanel([legacy(), add()]);
    fireEvent.click(cardCloseButton());
    // 合计 40,000 + 11,979.1667 = 51,979.1667 个币
    expect(screen.getByText(/可用 51,979\.1667 KAITO/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '100%' }));
    fireEvent.click(screen.getByRole('button', { name: /^确认平仓/ }));
    expect(onClosePosition.mock.calls.map(c => c[2])).toEqual([1, 1]);
  });
});

describe('【复核 r7】逐仓多笔卡上的「保证金比率（最高）」写先死的那一笔', () => {
  it('更新前 40,000 @1.0 + 分层 11,500 USDT @0.96、标记价 0.96：写 38.40%（合计那个数 31.65% 放在悬停里）', () => {
    renderPanel([usdtPos('pre-update', 40_000, 1), usdtPos('tiered-add', 11_500 / 0.96, 0.96, TIERED)]);
    /**
     * 逐笔：旧仓位 维持 38,400 × 0.4% = 153.60，权益 2,000 − 1,600 = 400 → 38.40%；
     *       分层那一笔 维持 11,500 × 2% − 75 = 155，权益 575 → 26.96%。
     * 合计口径 308.60 / 975 = 31.65% —— 那是拿旧仓位的保证金去垫，而逐仓保证金并不共用。
     */
    const cell = screen.getByText('保证金比率（最高）').parentElement!;
    expect(cell.textContent).toContain('38.40%');
    expect(cell.getAttribute('title')).toContain('整组合计是 31.65%');
    expect(cell.getAttribute('title')).toContain('与左边的「强平价格（最先）」是同一笔');
    // 同一张卡的「强平价格（最先）」正是那一笔（旧仓位 0.954）
    expect(screen.getByText('强平价格（最先）').parentElement!.textContent).toContain('0.954000');
  });

  it('只有一笔时照旧写「保证金比率」、不带悬停', () => {
    renderPanel([usdtPos('solo', 40_000, 1)]);
    // 表头里也有「保证金比率」四个字，取卡片上那个（带百分比读数的）
    const cell = screen.getAllByText('保证金比率')
      .map(el => el.parentElement!)
      .find(el => el.textContent?.includes('%'))!;
    expect(cell.textContent).toContain('38.40%');
    expect(cell.getAttribute('title')).toBeNull();
    expect(screen.queryByText('保证金比率（最高）')).toBeNull();
  });
});
