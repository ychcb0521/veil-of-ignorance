import { describe, expect, it } from 'vitest';
import {
  applyTransfer,
  maxTransferable,
  roundAmount,
  validateTransfer,
  type WalletBalances,
} from '../walletTransfer';

const wallets = (futures: number, spot = 0, funding = 0): WalletBalances =>
  ({ futures, spot, funding });

const total = (b: WalletBalances) => roundAmount(b.futures + b.spot + b.funding);

describe('validateTransfer', () => {
  it('正常划转通过，金额归整到 8 位', () => {
    const r = validateTransfer(wallets(1000), { from: 'futures', to: 'spot', amount: 250.123456789 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.amount).toBe(250.12345679);
  });

  it('来源与目标相同时拒绝', () => {
    const r = validateTransfer(wallets(1000), { from: 'spot', to: 'spot', amount: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('same-wallet');
  });

  it('金额非正或非有限数时拒绝', () => {
    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = validateTransfer(wallets(1000), { from: 'futures', to: 'spot', amount });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid-amount');
    }
  });

  it('超过可用余额时拒绝', () => {
    const r = validateTransfer(wallets(100), { from: 'futures', to: 'spot', amount: 100.01 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('insufficient');
  });

  it('恰好等于可用余额时放行——「最大」按钮必须能一键划空', () => {
    expect(validateTransfer(wallets(100), { from: 'futures', to: 'spot', amount: 100 }).ok).toBe(true);
  });

  it('浮点尾差不会被误判为超额', () => {
    // 0.1+0.2 = 0.30000000000000004，用户点「最大」拿到的正是这种值
    const balances = wallets(0.1 + 0.2);
    const max = maxTransferable(balances, 'futures');
    expect(validateTransfer(balances, { from: 'futures', to: 'spot', amount: max }).ok).toBe(true);
  });

  it('空钱包划不出任何金额', () => {
    expect(maxTransferable(wallets(0), 'futures')).toBe(0);
    expect(validateTransfer(wallets(0), { from: 'futures', to: 'spot', amount: 1 }).ok).toBe(false);
  });
});

describe('applyTransfer', () => {
  it('搬钱：来源减、目标增', () => {
    const next = applyTransfer(wallets(1000), { from: 'futures', to: 'spot', amount: 300 });
    expect(next.futures).toBe(700);
    expect(next.spot).toBe(300);
    expect(next.funding).toBe(0);
  });

  it('总资产严格不变——这是划转区别于出入金的根本', () => {
    const before = wallets(1385428.31, 12.5, 3.75);
    const after = applyTransfer(before, { from: 'futures', to: 'funding', amount: 1000.07 });
    expect(total(after)).toBe(total(before));
  });

  it('反复往返不产生浮点漂移', () => {
    let b = wallets(1000);
    for (let i = 0; i < 200; i += 1) {
      b = applyTransfer(b, { from: 'futures', to: 'spot', amount: 0.1 });
      b = applyTransfer(b, { from: 'spot', to: 'funding', amount: 0.1 });
      b = applyTransfer(b, { from: 'funding', to: 'futures', amount: 0.1 });
    }
    expect(total(b)).toBe(1000);
    expect(b.futures).toBe(1000);
    expect(b.spot).toBe(0);
    expect(b.funding).toBe(0);
  });

  it('三个钱包两两互转都成立', () => {
    const pairs: Array<[keyof WalletBalances, keyof WalletBalances]> = [
      ['futures', 'spot'], ['spot', 'funding'], ['funding', 'futures'],
      ['spot', 'futures'], ['funding', 'spot'], ['futures', 'funding'],
    ];
    for (const [from, to] of pairs) {
      const before = wallets(100, 100, 100);
      const after = applyTransfer(before, { from, to, amount: 25 });
      expect(after[from]).toBe(75);
      expect(after[to]).toBe(125);
      expect(total(after)).toBe(total(before));
    }
  });
});
