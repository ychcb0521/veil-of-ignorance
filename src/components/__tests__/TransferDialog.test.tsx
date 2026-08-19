import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TransferDialog } from '@/components/TransferDialog';
import type { WalletBalances } from '@/lib/walletTransfer';

const balances: WalletBalances = { futures: 1000, spot: 250, funding: 0 };

function setup(over: Partial<React.ComponentProps<typeof TransferDialog>> = {}) {
  const onTransfer = vi.fn(() => true);
  const onClose = vi.fn();
  render(
    <TransferDialog open onClose={onClose} balances={balances} onTransfer={onTransfer} {...over} />,
  );
  return { onTransfer, onClose };
}

const amountInput = () => screen.getByTestId('transfer-amount');

describe('TransferDialog', () => {
  it('关闭时不渲染', () => {
    render(<TransferDialog open={false} onClose={() => {}} balances={balances} onTransfer={() => true} />);
    expect(screen.queryByTestId('transfer-dialog')).not.toBeInTheDocument();
  });

  it('默认合约 → 现货，可用额取来源钱包', () => {
    setup();
    expect(screen.getByTestId('transfer-from')).toHaveValue('futures');
    expect(screen.getByTestId('transfer-to')).toHaveValue('spot');
    expect(screen.getByTestId('transfer-available')).toHaveTextContent('1,000.00');
  });

  it('「最大」一键填满并可提交——不因浮点尾差被判超额', () => {
    const { onTransfer } = setup();
    fireEvent.click(screen.getByTestId('transfer-max'));
    expect(amountInput()).toHaveValue(1000);
    fireEvent.click(screen.getByTestId('transfer-submit'));
    expect(onTransfer).toHaveBeenCalledWith('futures', 'spot', 1000);
  });

  it('交换方向后可用额随之切换', () => {
    setup();
    fireEvent.click(screen.getByTestId('transfer-swap'));
    expect(screen.getByTestId('transfer-from')).toHaveValue('spot');
    expect(screen.getByTestId('transfer-to')).toHaveValue('futures');
    expect(screen.getByTestId('transfer-available')).toHaveTextContent('250.00');
  });

  it('把目标选成与来源相同时自动交换，而不是报错', () => {
    setup();
    fireEvent.change(screen.getByTestId('transfer-to'), { target: { value: 'futures' } });
    expect(screen.getByTestId('transfer-to')).toHaveValue('futures');
    expect(screen.getByTestId('transfer-from')).toHaveValue('spot');
  });

  it('超额时提示并禁用提交', () => {
    const { onTransfer } = setup();
    fireEvent.change(amountInput(), { target: { value: '1000.01' } });
    expect(screen.getByTestId('transfer-error')).toHaveTextContent('超过可用余额');
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('transfer-submit'));
    expect(onTransfer).not.toHaveBeenCalled();
  });

  it('刚打开时不飘红，只是不可提交', () => {
    setup();
    expect(screen.queryByTestId('transfer-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();
  });

  it('金额为 0 或负数时不可提交', () => {
    setup();
    for (const v of ['0', '-5']) {
      fireEvent.change(amountInput(), { target: { value: v } });
      expect(screen.getByTestId('transfer-submit')).toBeDisabled();
    }
  });

  it('划转成功后关闭弹窗；失败则留在原地让用户改', () => {
    const { onClose } = setup();
    fireEvent.change(amountInput(), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('transfer-submit'));
    expect(onClose).toHaveBeenCalledTimes(1);

    const failing = vi.fn(() => false);
    render(
      <TransferDialog open onClose={onClose} balances={balances} onTransfer={failing} />,
    );
    const inputs = screen.getAllByTestId('transfer-amount');
    fireEvent.change(inputs[inputs.length - 1], { target: { value: '50' } });
    const submits = screen.getAllByTestId('transfer-submit');
    fireEvent.click(submits[submits.length - 1]);
    expect(failing).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1); // 没有再次关闭
  });

  it('空钱包可用额为 0，无法划出', () => {
    setup({ balances: { futures: 0, spot: 0, funding: 0 } });
    expect(screen.getByTestId('transfer-available')).toHaveTextContent('0.00');
    fireEvent.click(screen.getByTestId('transfer-max'));
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();
  });
});
