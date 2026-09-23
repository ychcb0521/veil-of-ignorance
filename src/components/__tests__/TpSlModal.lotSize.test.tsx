import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TpSlModal } from '@/components/TpSlModal';
import { cardCloseLotSize } from '@/lib/marketLotSize';
import type { Position } from '@/types/trading';

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

/**
 * 「止盈/止损」弹窗的单笔市价上限：按成数（不足 100%）挂的那一截触发后是一笔市价单，按各自的触发价判
 * （合成币本位的张数上限随价变化）；100% 平掉整个仓位的不受限（相当于币安 closePosition）。
 */
const SYMBOL = 'KAITOUSDT';
/** 合成币本位 KAITOUSD 50,000 张。 */
const pos: Position = {
  id: 'coin', side: 'LONG', entryPrice: 1.1, quantity: 50_000, contracts: 50_000, contractSizeUsd: 10, leverage: 2,
  marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'KAITO', margin: 250_000, marginCoin: 227_272.7,
  isolatedMargin: 250_000, openTime: 1,
} as Position;

function renderModal() {
  const onConfirm = vi.fn();
  render(
    <TpSlModal
      pos={pos} symbol={SYMBOL} settlementMode="coin" markPrice={1.1} liqPrice={0.6}
      onClose={vi.fn()} onConfirm={onConfirm}
      lotSizeCheck={(fraction, triggerPrice) => cardCloseLotSize(SYMBOL, [pos], fraction, triggerPrice, 'tpsl')}
    />,
  );
  return onConfirm;
}
const [tpInput, slInput] = [0, 1].map(i => () => screen.getAllByPlaceholderText('触发价格')[i] as HTMLInputElement);
const confirm = () => screen.getByRole('button', { name: '确认' }) as HTMLButtonElement;
const setPct = (steps: number) => {
  const thumb = screen.getByRole('slider');
  for (let i = 0; i < steps; i++) fireEvent.keyDown(thumb, { key: 'ArrowLeft' });
};

describe('TpSlModal：单笔市价上限', () => {
  it('100%：不判（平掉整个仓位）', () => {
    const onConfirm = renderModal();
    fireEvent.change(slInput(), { target: { value: '0.9' } });
    expect(screen.queryByTestId('tpsl-lot-size-warning')).toBeNull();
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith(null, 0.9, 100);
  });

  it('50% = 25,000 张：止盈 1.3 上放得下（26,000），止损 0.9 上放不下（18,000）——按各自的触发价判，说的是止损那一张；调到 40%、止损挪到 1.0 放行', () => {
    const onConfirm = renderModal();
    setPct(5);
    fireEvent.change(tpInput(), { target: { value: '1.3' } });
    expect(screen.queryByTestId('tpsl-lot-size-warning')).toBeNull();
    fireEvent.change(slInput(), { target: { value: '0.9' } });
    expect(screen.getByTestId('tpsl-lot-size-warning')).toHaveTextContent('止损（50% 仓位）：单笔市价单最多 18,000 张，这一单 25,000 张');
    expect(confirm().disabled).toBe(true);
    // 40% = 20,000 张：0.9 上仍放不下，止损挪到 1.0（20,000 张）恰好放得下
    setPct(1);
    expect(screen.getByTestId('tpsl-lot-size-warning')).toHaveTextContent('止损（40% 仓位）：单笔市价单最多 18,000 张，这一单 20,000 张');
    fireEvent.change(slInput(), { target: { value: '1.0' } });
    expect(screen.queryByTestId('tpsl-lot-size-warning')).toBeNull();
    fireEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledWith(1.3, 1, 40);
  });

  it('连最小的一格（10% = 5,000 张）都超过上限（止损 0.1 上一笔最多 2,000 张）：只说只能选 100%，不叫人把成数调小', () => {
    renderModal();
    fireEvent.change(slInput(), { target: { value: '0.1' } });
    setPct(5);
    const atHalf = screen.getByTestId('tpsl-lot-size-warning');
    expect(atHalf).toHaveTextContent('止损（50% 仓位）：单笔市价单最多 2,000 张，这一单 25,000 张');
    expect(atHalf).toHaveTextContent('连最小的一格（10%）都超过上限：只能选 100%（平掉整个仓位的不受此限）');
    expect(atHalf).not.toHaveTextContent('调小');
    setPct(4);
    expect(screen.getByTestId('tpsl-lot-size-warning')).toHaveTextContent('止损（10% 仓位）：单笔市价单最多 2,000 张，这一单 5,000 张');
    expect(screen.getByTestId('tpsl-lot-size-warning')).not.toHaveTextContent('调小');
    expect(confirm().disabled).toBe(true);
  });
});
