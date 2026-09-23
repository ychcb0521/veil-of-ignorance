import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LeverageModal } from '@/components/LeverageModal';
import type { PendingOrder, Position, SettlementMode } from '@/types/trading';

/**
 * 杠杆对话框按币安的合约分层：滑块上限是合约第 1 档的最高杠杆，
 * 「当前杠杆倍数最高可持有头寸」按滑块所在杠杆、以合约的单位显示；
 * 持仓和当前委托超过目标杠杆的上限时确认置灰，提示「请调低杠杆倍数至 Nx 以下」。
 */
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

function renderModal(props: {
  symbol: string;
  currentLeverage: number;
  settlementMode?: SettlementMode;
  positions?: Position[];
  orders?: PendingOrder[];
  markPrice?: number;
}) {
  const onConfirm = vi.fn();
  render(
    <LeverageModal
      symbol={props.symbol}
      currentLeverage={props.currentLeverage}
      settlementMode={props.settlementMode}
      positions={props.positions}
      orders={props.orders}
      markPrice={props.markPrice ?? 1}
      onClose={vi.fn()}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm };
}

const slider = () => screen.getByRole('slider');
const input = () => screen.getByTestId('leverage-input') as HTMLInputElement;
const maxPosition = () => screen.getByTestId('leverage-max-position');
const confirm = () => screen.getByTestId('leverage-confirm') as HTMLButtonElement;
const setLeverage = (v: number) => {
  fireEvent.change(input(), { target: { value: String(v) } });
  fireEvent.blur(input());
};

const kaitoCoinPos = (contracts: number, leverage: number): Position => ({
  id: 'k1', side: 'LONG', quantity: contracts, contracts, contractSizeUsd: 10,
  settlementMode: 'coin', settlementAsset: 'KAITO', entryPrice: 1, leverage,
  marginMode: 'isolated', margin: (contracts * 10) / leverage, isolatedMargin: (contracts * 10) / leverage,
  marginCoin: (contracts * 10) / leverage, openTime: 1,
} as Position);

describe('滑块上限 = 合约的最高杠杆', () => {
  it('KAITOUSDT：75x，15x 最高 50,000 USDT', () => {
    renderModal({ symbol: 'KAITOUSDT', currentLeverage: 15, settlementMode: 'usdt' });
    expect(slider()).toHaveAttribute('aria-valuemax', '75');
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('75x');
    expect(screen.getByTestId('leverage-min-label')).toHaveTextContent('1x');
    expect(input().max).toBe('75');
    expect(maxPosition()).toHaveTextContent('当前杠杆倍数最高可持有头寸：50,000 USDT');
    setLeverage(75);
    expect(maxPosition()).toHaveTextContent('5,000 USDT');
    setLeverage(2);
    expect(maxPosition()).toHaveTextContent('7,500,000 USDT');
    // 输入超过上限：失焦后夹回 75
    setLeverage(125);
    expect(input().value).toBe('75');
    expect(screen.queryByTestId('leverage-tier-note')).toBeNull();
  });

  it('BTCUSDT（U 本位）：150x，150x 最高 300,000 USDT', () => {
    renderModal({ symbol: 'BTCUSDT', currentLeverage: 150, settlementMode: 'usdt' });
    expect(slider()).toHaveAttribute('aria-valuemax', '150');
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('150x');
    expect(maxPosition()).toHaveTextContent('300,000 USDT');
  });

  it('BTCUSD（币本位）：125x，上限以 BTC 计', () => {
    renderModal({ symbol: 'BTCUSDT', currentLeverage: 125, settlementMode: 'coin', markPrice: 60_000 });
    expect(slider()).toHaveAttribute('aria-valuemax', '125');
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('125x');
    expect(maxPosition()).toHaveTextContent('当前杠杆倍数最高可持有头寸：5 BTC');
    setLeverage(100);
    expect(maxPosition()).toHaveTextContent('10 BTC');
    setLeverage(50);
    expect(maxPosition()).toHaveTextContent('25 BTC');
    expect(document.body.textContent).not.toMatch(/(^|[^A-Z])USDT/);
  });

  it('合成的 KAITOUSD：借 KAITOUSDT 的分层，按 USD 显示并注明', () => {
    renderModal({ symbol: 'KAITOUSD', currentLeverage: 15, settlementMode: 'coin' });
    expect(slider()).toHaveAttribute('aria-valuemax', '75');
    expect(maxPosition()).toHaveTextContent('50,000 USD');
    expect(screen.getByTestId('leverage-tier-note'))
      .toHaveTextContent('币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 分层折算');
  });

  it('只到 10x 的合约（LUMIAUSDT）：旧版本保存的 35x 打开时停在 10x', () => {
    renderModal({ symbol: 'LUMIAUSDT', currentLeverage: 35, settlementMode: 'usdt' });
    expect(slider()).toHaveAttribute('aria-valuemax', '10');
    expect(input().value).toBe('10');
    expect(maxPosition()).toHaveTextContent('10,000 USDT');
  });
});

describe('持仓和当前委托超过目标杠杆的上限：确认置灰', () => {
  it('持仓 60,000 USD（10x）：提到 15x 被拒，提示「请调低杠杆倍数至 10x 以下」', () => {
    const { onConfirm } = renderModal({
      symbol: 'KAITOUSD', currentLeverage: 10, settlementMode: 'coin',
      positions: [kaitoCoinPos(6_000, 10)],
    });
    expect(screen.getByTestId('leverage-exposure')).toHaveTextContent('60,000 USD · 最高 10x');
    setLeverage(15);
    expect(screen.getByTestId('leverage-refusal')).toHaveTextContent('请调低杠杆倍数至 10x 以下');
    expect(screen.getByTestId('leverage-refusal')).toHaveTextContent('超过 15x 最高可持有头寸 50,000 USD');
    expect(confirm().disabled).toBe(true);
    fireEvent.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('挂单也算：持仓 20,000 + 挂单 40,000 → 同样被拒', () => {
    const order = {
      id: 'o1', side: 'SHORT', type: 'LIMIT', price: 1.2, stopPrice: 0, quantity: 4_000, contracts: 4_000,
      contractSizeUsd: 10, settlementMode: 'coin', leverage: 10, marginMode: 'isolated', status: 'NEW', createdAt: 0,
    } as PendingOrder;
    renderModal({
      symbol: 'KAITOUSD', currentLeverage: 10, settlementMode: 'coin',
      positions: [kaitoCoinPos(2_000, 10)], orders: [order],
    });
    setLeverage(15);
    expect(screen.getByTestId('leverage-refusal')).toHaveTextContent('请调低杠杆倍数至 10x 以下');
    expect(confirm().disabled).toBe(true);
  });

  it('在上限之内可以确认', () => {
    const { onConfirm } = renderModal({
      symbol: 'KAITOUSD', currentLeverage: 10, settlementMode: 'coin',
      positions: [kaitoCoinPos(4_000, 10)],
    });
    setLeverage(20);                         // 20x 最高 50,000，持仓 40,000
    expect(screen.queryByTestId('leverage-refusal')).toBeNull();
    expect(confirm().disabled).toBe(false);
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith(20);
  });

  it('超过最高一档：任何杠杆都不行，不写「最高 0x」', () => {
    renderModal({
      symbol: 'KAITOUSD', currentLeverage: 2, settlementMode: 'coin',
      positions: [kaitoCoinPos(1_300_000, 1)],        // 13,000,000 USD > 12,500,000
    });
    expect(screen.getByTestId('leverage-exposure')).toHaveTextContent('13,000,000 USD · 超过该合约最大可持有头寸');
    expect(screen.getByTestId('leverage-exposure')).not.toHaveTextContent('0x');
    setLeverage(3);                                   // 杠杆没变时不提示；换一个杠杆才判
    expect(screen.getByTestId('leverage-refusal'))
      .toHaveTextContent('超过该合约最大可持有头寸 12,500,000 USD（任何杠杆都不可开）');
    expect(confirm().disabled).toBe(true);
  });

  it('逐仓有持仓不能降杠杆的规则保留（下限卡在滑块上）', () => {
    renderModal({
      symbol: 'KAITOUSD', currentLeverage: 20, settlementMode: 'coin',
      positions: [kaitoCoinPos(1_000, 20)],
    });
    expect(slider()).toHaveAttribute('aria-valuemin', '20');
    expect(screen.getByTestId('leverage-min-label')).toHaveTextContent('20x');
    setLeverage(5);
    expect(input().value).toBe('20');
  });

  it('旧版本 125x 的持仓放在 75x 的合约上：滑块停在 75，确认被拒（逐仓不能降杠杆）', () => {
    renderModal({
      symbol: 'KAITOUSD', currentLeverage: 125, settlementMode: 'coin',
      positions: [kaitoCoinPos(100, 125)],
    });
    expect(slider()).toHaveAttribute('aria-valuemax', '75');
    expect(input().value).toBe('75');
    // 滑块上哪个值都选不了：照实说平仓前杠杆调不了，而不是叫人「提高到 125x」（选不到）
    expect(screen.getByTestId('leverage-refusal')).toHaveTextContent(
      '逐仓有持仓时不能降杠杆：现有仓位按 125x 开（高于该合约现在的最高杠杆 75x，是更新前按旧规则开的），平仓前无法调整杠杆；新单最高只能用 75x',
    );
    expect(confirm().disabled).toBe(true);
  });
});

describe('【复核】现有仓位已超过它自己杠杆的上限：对话框说清只能减仓', () => {
  /** 更新前按 35x 开的 20,000 KAITO（旧通用表允许；新分层 35x 最多 10,000）。 */
  const legacy = {
    id: 'legacy', side: 'LONG', quantity: 20_000, entryPrice: 1, leverage: 35, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT', margin: 20_000 / 35, isolatedMargin: 20_000 / 35, openTime: 1,
  } as Position;

  it('一打开（停在当前 35x）就摆出来，确认置灰；提到 40x 也不叫人「调低至 25x」', () => {
    const { onConfirm } = renderModal({
      symbol: 'KAITOUSDT', currentLeverage: 35, settlementMode: 'usdt', positions: [legacy],
    });
    const refusal = () => screen.getByTestId('leverage-refusal');
    expect(refusal()).toHaveTextContent('调整杠杆解决不了');
    expect(refusal()).toHaveTextContent('（含更新前按旧规则开的仓位）');
    expect(refusal()).toHaveTextContent('只能先减仓或撤单，把总量降到 10,000 USDT 以下再开新单');
    expect(confirm().disabled).toBe(true);
    setLeverage(40);
    expect(refusal()).not.toHaveTextContent('请调低杠杆倍数至 25x');
    expect(refusal()).toHaveTextContent('只能先减仓或撤单');
    expect(confirm().disabled).toBe(true);
    fireEvent.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('【复核 r3】已挂的带戳触发单：调到这个杠杆后触发时会被拒——确认前提醒，不拦', () => {
  /**
   * 真币本位 BTCUSD（以 BTC 计）：多 12 BTC（12,000 张 @100,000，20x）+ 空头止损对冲 10,800 张 @90,000。
   * 现价下 12 + 12 = 24 BTC；到 90,000 时多仓折成 13.33 BTC → 25.33 BTC。
   * 20x 最高 150 BTC 都放得下；提到 50x（最高 25 BTC）现价下放得下（对话框放行），触发时放不下。
   */
  const btcLong = (over: Partial<Position> = {}): Position => ({
    id: 'b1', side: 'LONG', quantity: 12_000, contracts: 12_000, contractSizeUsd: 100,
    settlementMode: 'coin', settlementAsset: 'BTC', entryPrice: 100_000, leverage: 20,
    marginMode: 'isolated', margin: 60_000, isolatedMargin: 60_000, marginCoin: 0.6, openTime: 1,
    riskModel: 'binance-tiers-v1', riskSymbol: 'BTCUSDT', ...over,
  } as Position);
  const hedge = (over: Partial<PendingOrder> = {}): PendingOrder => ({
    id: 'h1', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 90_000, quantity: 10_800, contracts: 10_800,
    contractSizeUsd: 100, settlementMode: 'coin', settlementAsset: 'BTC', leverage: 20, marginMode: 'isolated',
    status: 'PENDING', createdAt: 0, riskModel: 'binance-tiers-v1', ...over,
  } as PendingOrder);

  it('提到 50x：确认前摆出「杠杆调到 50x 后，已挂的做空条件单 90,000.00 触发时…」，确认键照常可点；回到 20x 就没有', () => {
    const { onConfirm } = renderModal({
      symbol: 'BTCUSDT', currentLeverage: 20, settlementMode: 'coin', positions: [btcLong()], orders: [hedge()], markPrice: 100_000,
    });
    setLeverage(50);
    const box = screen.getByTestId('leverage-trigger-risk');
    expect(box).toHaveTextContent('杠杆调到 50x 后，已挂的做空条件单 90,000.00 触发时会因超出当前杠杆最高可持有头寸被拒');
    expect(box).toHaveTextContent('超过 50x 最高 25 BTC');
    expect(screen.queryByTestId('leverage-refusal')).toBeNull();
    expect(confirm().disabled).toBe(false);
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith(50);
    setLeverage(20);
    expect(screen.queryByTestId('leverage-trigger-risk')).toBeNull();
  });

  it('【复核 r5 · 二】路的起点是现价：挂着穿价的买入限价 20,000 @1.1 到 1.2 时已是持仓——10x 提到 15x 时，多头条件单 22,000 @1.2 触发时会被拒', () => {
    const usdtOrder = (over: Partial<PendingOrder>): PendingOrder => ({
      id: 'o', side: 'LONG', type: 'LIMIT', price: 0, stopPrice: 0, quantity: 0, leverage: 10, marginMode: 'isolated',
      settlementMode: 'usdt', settlementAsset: 'USDT', status: 'NEW', createdAt: 0, riskModel: 'binance-tiers-v1', ...over,
    } as PendingOrder);
    const orders = [
      usdtOrder({ id: 'crossed-buy', price: 1.1, quantity: 20_000 }),
      usdtOrder({ id: 'stop', type: 'CONDITIONAL', stopPrice: 1.2, quantity: 22_000, status: 'PENDING' }),
    ];
    renderModal({ symbol: 'KAITOUSDT', currentLeverage: 10, settlementMode: 'usdt', orders, markPrice: 1 });
    // 现价下 20,000 + 26,400 = 46,400 ≤ 50,000（对话框放行）；到 1.2 时 24,000 + 26,400 = 50,400
    // （不知道现价的话买单按 1.1 挂着：22,000 + 26,400 = 48,400，看不出来）
    setLeverage(15);
    expect(screen.queryByTestId('leverage-refusal')).toBeNull();
    const box = screen.getByTestId('leverage-trigger-risk');
    expect(box).toHaveTextContent('杠杆调到 15x 后，已挂的做多条件单');
    expect(box).toHaveTextContent('= 50,400 USDT');
    expect(confirm().disabled).toBe(false);
  });

  it('更新前挂的对冲单（没有戳）触发时不再判：不提醒', () => {
    renderModal({
      symbol: 'BTCUSDT', currentLeverage: 20, settlementMode: 'coin', positions: [btcLong()],
      orders: [hedge({ riskModel: undefined })], markPrice: 100_000,
    });
    setLeverage(50);
    expect(screen.queryByTestId('leverage-trigger-risk')).toBeNull();
  });

  it('对话框本来就拒绝的杠杆不再叠一条预警（多 13 BTC：现价下 25 BTC 以上，50x 直接拒）', () => {
    renderModal({
      symbol: 'BTCUSDT', currentLeverage: 20, settlementMode: 'coin',
      positions: [btcLong({ quantity: 13_100, contracts: 13_100 })], orders: [hedge()], markPrice: 100_000,
    });
    setLeverage(50);
    expect(screen.getByTestId('leverage-refusal')).toBeInTheDocument();
    expect(screen.queryByTestId('leverage-trigger-risk')).toBeNull();
  });
});
