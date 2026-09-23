import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClosePositionModal } from '@/components/ClosePositionModal';
import { cardCloseLotSize } from '@/lib/marketLotSize';
import type { Position } from '@/types/trading';

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

/**
 * 「平仓」弹窗的单笔市价上限：超过就置灰并说明，「按上限平」把数量改成上限（整张、向下取整），
 * 不替用户拆单、不悄悄只平一部分。不传判定（快照里查不到的合约）就一切照旧。
 */
const SYMBOL = 'KAITOUSDT';
/** 合成币本位 KAITOUSD：在 1.0 上一笔市价单最多 20,000 张。 */
const coinPosition = (contracts: number, over: Partial<Position> = {}): Position => ({
  id: 'coin', side: 'LONG', entryPrice: 1.1, quantity: contracts, contracts, contractSizeUsd: 10, leverage: 2,
  marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'KAITO', margin: contracts * 5,
  marginCoin: contracts * 4.5, isolatedMargin: contracts * 5, openTime: 1, ...over,
} as Position);
const usdtPosition = (quantity: number): Position => ({
  id: 'usdt', side: 'LONG', entryPrice: 1, quantity, leverage: 5, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT', margin: quantity / 5, isolatedMargin: quantity / 5, openTime: 1,
} as Position);

function modal({ symbol = SYMBOL, position = coinPosition(50_000), legs, price = 1, check = true }: {
  symbol?: string; position?: Position; legs?: Position[]; price?: number; check?: boolean;
} = {}, onConfirm = vi.fn()) {
  return (
    <ClosePositionModal
      open onClose={vi.fn()} symbol={symbol} position={position} currentPrice={price} pricePrecision={4}
      onConfirm={onConfirm} legCount={legs?.length ?? 1}
      lotSizeCheck={check ? (fraction) => cardCloseLotSize(symbol, legs ?? [position], fraction, price) : undefined}
    />
  );
}
function renderModal(props: Parameters<typeof modal>[0] = {}) {
  const onConfirm = vi.fn();
  const view = render(modal(props, onConfirm));
  return { onConfirm, rerender: (next: Parameters<typeof modal>[0]) => view.rerender(modal(next, onConfirm)) };
}
const confirm = () => screen.getByRole('button', { name: /^确认平仓/ }) as HTMLButtonElement;
const amountInput = () => screen.getByRole('spinbutton') as HTMLInputElement;

describe('ClosePositionModal：单笔市价上限', () => {
  it('50,000 张全平超过 20,000 张：置灰并说明来源；「按上限平」留 0.2% 余量（19,960 张），确认后按这个成数平', () => {
    const { onConfirm } = renderModal();
    const warning = screen.getByTestId('close-lot-size-warning');
    expect(warning).toHaveTextContent('单笔市价单最多 20,000 张，这一单 50,000 张');
    expect(warning).toHaveTextContent('币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 的市价单单笔上限 200,000 KAITO');
    expect(confirm().disabled).toBe(true);
    expect(screen.getByTestId('close-lot-size-fill-max')).toHaveTextContent('按上限平 19,960 张');
    fireEvent.click(screen.getByTestId('close-lot-size-fill-max'));
    expect(screen.queryByTestId('close-lot-size-warning')).toBeNull();
    expect(amountInput().value).toBe('19960');
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0] as number).toBeCloseTo(19_960 / 50_000, 9);
  });

  it('合成币本位 163,578 张 @1.0905：「按上限平 21,766 张」，跌一个 tick（1.0904，上限 21,808）按钮不会再被置灰', () => {
    const position = coinPosition(163_578);
    const { rerender } = renderModal({ position, price: 1.0905 });
    expect(screen.getByTestId('close-lot-size-warning')).toHaveTextContent('单笔市价单最多 21,810 张，这一单 163,578 张');
    expect(screen.getByTestId('close-lot-size-fill-max')).toHaveTextContent('按上限平 21,766 张');
    fireEvent.click(screen.getByTestId('close-lot-size-fill-max'));
    expect(confirm().disabled).toBe(false);
    for (const price of [1.0904, 1.0903, 1.09, 1.089]) {
      rerender({ position, price });
      expect(screen.queryByTestId('close-lot-size-warning')).toBeNull();
      expect(confirm().disabled).toBe(false);
    }
  });

  it('仓位是上限的 100 多倍（CYPH 250,000，一笔最多 2,000）：照样给「按上限平 2,000 CYPH」，确认后按 0.8% 平', () => {
    const { onConfirm } = renderModal({ symbol: 'CYPHUSDT', position: usdtPosition(250_000), price: 1 });
    expect(screen.getByTestId('close-lot-size-warning')).toHaveTextContent('单笔市价单最多 2,000 CYPH，这一单 250,000 CYPH');
    expect(screen.getByTestId('close-lot-size-fill-max')).toHaveTextContent('按上限平 2,000 CYPH');
    fireEvent.click(screen.getByTestId('close-lot-size-fill-max'));
    expect(amountInput().value).toBe('2000');
    fireEvent.click(confirm());
    expect(onConfirm.mock.calls[0][0] as number).toBeCloseTo(0.008, 9);
  });

  it('确认按钮上的成数就是引擎真正平掉的成数：0.8%（不是四舍五入的 1%）；600,000 的仓位平 2,000 是 0.33%（不是 0%）；整数成数照旧写整数', () => {
    const { onConfirm } = renderModal({ symbol: 'CYPHUSDT', position: usdtPosition(250_000), price: 1 });
    fireEvent.click(screen.getByTestId('close-lot-size-fill-max'));
    expect(confirm()).toHaveTextContent(/^确认平仓 \(0\.8%\)$/);
    fireEvent.click(confirm());
    expect(onConfirm.mock.calls[0][0] as number).toBeCloseTo(0.008, 9);
    cleanup();

    renderModal({ symbol: 'CYPHUSDT', position: usdtPosition(600_000), price: 1 });
    fireEvent.click(screen.getByTestId('close-lot-size-fill-max'));
    expect(amountInput().value).toBe('2000');
    // 不到 1% 的写两位有效数字
    expect(confirm()).toHaveTextContent(/^确认平仓 \(0\.33%\)$/);
    // 更小的成数也不写成 0%：60 CYPH = 0.01%
    fireEvent.change(amountInput(), { target: { value: '60' } });
    expect(confirm()).toHaveTextContent(/^确认平仓 \(0\.01%\)$/);
    fireEvent.change(amountInput(), { target: { value: '1500' } });
    expect(confirm()).toHaveTextContent(/^确认平仓 \(0\.25%\)$/);
    cleanup();

    renderModal({ symbol: 'CYPHUSDT', position: usdtPosition(1_000), price: 1 });
    expect(confirm()).toHaveTextContent(/^确认平仓 \(100%\)$/);
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    expect(confirm()).toHaveTextContent(/^确认平仓 \(50%\)$/);
    fireEvent.change(amountInput(), { target: { value: '333' } });
    expect(confirm()).toHaveTextContent(/^确认平仓 \(33\.3%\)$/);
    // 差一丝才到 100% 的也不写成 100%：999.9 / 1,000 = 99.99% → 往下截成 99.9%
    fireEvent.change(amountInput(), { target: { value: '999.9' } });
    expect(confirm()).toHaveTextContent(/^确认平仓 \(99\.9%\)$/);
  });

  it('币本位两笔一样大的仓位（SUIUSD 各 1,500 张，一笔最多 1,000 张）：「按上限平 1,000 张」，点了就放行（不多给一张）', () => {
    const leg = (id: string, leverage: number) => coinPosition(1_500, { id, leverage, settlementAsset: 'SUI' });
    const legs = [leg('a', 2), leg('b', 5)];
    const card = coinPosition(3_000, { id: 'card', settlementAsset: 'SUI' });
    const { onConfirm } = renderModal({ symbol: 'SUIUSDT', position: card, legs, price: 3 });
    expect(screen.getByTestId('close-lot-size-warning')).toHaveTextContent('单笔市价单最多 1,000 张，这一单 3,000 张');
    expect(screen.getByTestId('close-lot-size-fill-max')).toHaveTextContent('按上限平 1,000 张');
    fireEvent.click(screen.getByTestId('close-lot-size-fill-max'));
    expect(screen.queryByTestId('close-lot-size-warning')).toBeNull();
    expect(confirm().disabled).toBe(false);
    fireEvent.click(confirm());
    // 摊到两笔各 500 张，合计 1,000 张
    const fraction = onConfirm.mock.calls[0][0] as number;
    expect(cardCloseLotSize('SUIUSDT', legs, fraction, 3).orders.map(o => o.units)).toEqual([1_000]);
  });

  it('填 1,500 CYPH（不到 1%）：按填的量判，不按 1% 的 2,500 判', () => {
    renderModal({ symbol: 'CYPHUSDT', position: usdtPosition(250_000), price: 1 });
    fireEvent.change(amountInput(), { target: { value: '1500' } });
    expect(screen.queryByTestId('close-lot-size-warning')).toBeNull();
    expect(confirm().disabled).toBe(false);
    fireEvent.change(amountInput(), { target: { value: '2500' } });
    expect(screen.getByTestId('close-lot-size-warning')).toHaveTextContent('这一单 2,500 CYPH');
  });

  it('连 1 张都超过上限（合成币本位价极低：0.00004 上 200,000 KAITO 不到 1 张）：不给「按上限平」，指向 100% 止盈止损与一键平仓', () => {
    renderModal({ position: coinPosition(5), price: 0.00004 });
    const warning = screen.getByTestId('close-lot-size-warning');
    expect(screen.queryByTestId('close-lot-size-fill-max')).toBeNull();
    expect(warning).toHaveTextContent('连最小的一笔（1 张）都超过上限，市价平仓平不了');
    expect(warning).toHaveTextContent('设 100% 的止盈止损');
    expect(warning).toHaveTextContent('「一键平仓」');
    expect(confirm().disabled).toBe(true);
  });

  it('手填超过上限的数量同样置灰；填回上限以内放行', () => {
    renderModal();
    fireEvent.change(amountInput(), { target: { value: '20001' } });
    expect(screen.getByTestId('close-lot-size-warning')).toHaveTextContent('这一单 20,001 张');
    fireEvent.change(amountInput(), { target: { value: '15000' } });
    expect(screen.queryByTestId('close-lot-size-warning')).toBeNull();
    expect(confirm().disabled).toBe(false);
  });

  it('不传判定：一切照旧（全平直接放行）', () => {
    const { onConfirm } = renderModal({ check: false });
    expect(screen.queryByTestId('close-lot-size-warning')).toBeNull();
    fireEvent.click(confirm());
    expect(onConfirm.mock.calls[0][0]).toBe(1);
  });
});
