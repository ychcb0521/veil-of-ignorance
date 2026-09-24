import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PositionPanel } from '@/components/PositionPanel';
import type { Position } from '@/types/trading';
import type { LeverageChangePlan } from '@/lib/leverageRestatement';

/**
 * 持仓卡上的「杠杆」按钮：对话框按**仓位自己的结算方式**取分层（U 本位仓位用 U 本位分层），
 * 确认时必须把同一个结算方式交给引擎（applySymbolLeverage）。
 * 否则下单面板停在默认的币本位时，引擎会按币本位的上限（BNB 20x、SOL 50x、BTC 125x）
 * 把对话框已经放行的杠杆夹低、甚至拒绝。
 */
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    setSymbolLeverage: vi.fn(), tradingMode: 'direct',
    // 杠杆对话框按合约分层取上限：币安标准持仓限制模式（默认是无限制）
    positionLimitMode: 'binance',
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

const bnbLong = (settlementMode: 'usdt' | 'coin'): Position => (settlementMode === 'usdt'
  ? {
    id: 'bnb-u', side: 'LONG', quantity: 10, entryPrice: 600, leverage: 20, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT', margin: 300, isolatedMargin: 300, openTime: 0,
    riskModel: 'binance-tiers-v1', riskSymbol: 'BNBUSDT',
  }
  : {
    id: 'bnb-c', side: 'LONG', quantity: 60, contracts: 60, contractSizeUsd: 10, entryPrice: 600, leverage: 10,
    marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'BNB', margin: 60, isolatedMargin: 60,
    marginCoin: 0.1, openTime: 0, riskModel: 'binance-tiers-v1', riskSymbol: 'BNBUSDT',
  }) as Position;

function openDialog(position: Position) {
  const onApply = vi.fn((_s: string, to: number) => ({ ok: true, refusal: null, to, totalReleaseUsd: 0 }) as unknown as LeverageChangePlan);
  render(
    <PositionPanel
      positionsMap={{ BNBUSDT: [position] }}
      ordersMap={{}}
      tradeHistory={[]}
      priceMap={{ BNBUSDT: 600 }}
      activeSymbol="BNBUSDT"
      onClosePosition={vi.fn()}
      onCancelOrder={vi.fn()}
      onApplySymbolLeverage={onApply}
      availableBalance={1_000_000}
      activeTab="positions"
      onTabChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '杠杆' }));
  return onApply;
}

const setLeverage = (v: number) => {
  const input = screen.getByTestId('leverage-input') as HTMLInputElement;
  fireEvent.change(input, { target: { value: String(v) } });
  fireEvent.blur(input);
};

describe('持仓卡的杠杆对话框把仓位的结算方式交给引擎', () => {
  it('BNBUSDT U 本位 20x → 40x：对话框按 U 本位（上限 75x）放行，引擎收到的也是 U 本位', () => {
    const onApply = openDialog(bnbLong('usdt'));
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('75x');
    setLeverage(40);
    expect(screen.queryByTestId('leverage-refusal')).toBeNull();
    fireEvent.click(screen.getByTestId('leverage-confirm'));
    expect(onApply).toHaveBeenCalledWith('BNBUSDT', 40, 'usdt');
  });

  it('币本位仓位（BNBUSD 上限 20x）：引擎收到币本位', () => {
    const onApply = openDialog(bnbLong('coin'));
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('20x');
    setLeverage(15);
    fireEvent.click(screen.getByTestId('leverage-confirm'));
    expect(onApply).toHaveBeenCalledWith('BNBUSDT', 15, 'coin');
  });
});

describe('【复核】同一个币上 U 本位与币本位各有一张卡：对话框按**点的那张卡**取结算方式', () => {
  function openCard(index: number) {
    const onApply = vi.fn((_s: string, to: number) => ({ ok: true, refusal: null, to, totalReleaseUsd: 0 }) as unknown as LeverageChangePlan);
    // 两张卡都是 10x（杠杆下限按标的所有仓位取，两边同为 10x 才不互相卡住）
    const usdtLong = { ...bnbLong('usdt'), leverage: 10, margin: 600, isolatedMargin: 600 } as Position;
    const coinShort = { ...bnbLong('coin'), id: 'bnb-c-short', side: 'SHORT' } as Position;
    render(
      <PositionPanel
        positionsMap={{ BNBUSDT: [usdtLong, coinShort] }}
        ordersMap={{}}
        tradeHistory={[]}
        priceMap={{ BNBUSDT: 600 }}
        activeSymbol="BNBUSDT"
        onClosePosition={vi.fn()}
        onCancelOrder={vi.fn()}
        onApplySymbolLeverage={onApply}
        availableBalance={1_000_000}
        activeTab="positions"
        onTabChange={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole('button', { name: '杠杆' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[index]);
    return onApply;
  }

  it('点币本位那张（空）：上限 20x，确认时交给引擎的是币本位', () => {
    const onApply = openCard(1);
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('20x');
    setLeverage(15);
    fireEvent.click(screen.getByTestId('leverage-confirm'));
    expect(onApply).toHaveBeenCalledWith('BNBUSDT', 15, 'coin');
  });

  it('点 U 本位那张（多）：上限 75x，交给引擎的是 U 本位', () => {
    const onApply = openCard(0);
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('75x');
    setLeverage(18);
    fireEvent.click(screen.getByTestId('leverage-confirm'));
    expect(onApply).toHaveBeenCalledWith('BNBUSDT', 18, 'usdt');
  });

  it('点 U 本位那张提到 21x：U 本位允许，但另有币本位仓位（最高 20x）→ 说明卡在哪一张', () => {
    const onApply = openCard(0);
    setLeverage(21);
    expect(screen.getByTestId('leverage-refusal')).toHaveTextContent('另有币本位持仓或委托：21x 超过该合约最高杠杆 20x');
    expect((screen.getByTestId('leverage-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
  });
});
