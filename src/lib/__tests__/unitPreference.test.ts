/**
 * 单位偏好的口径 —— 对齐币安：
 *   卡片一 = 标的自身的计量单位（U 本位=币、币本位=张）
 *   卡片二 = 保证金资产，内含常驻的「订单金额 / 初始保证金」子选项
 * 位置也一致：锚在数量框下方的浮层，而不是居中弹窗。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coinContractsFromUsdNotional, coinNotionalUsd } from '@/lib/coinMargined';

const panel = () => readFileSync(join(process.cwd(), 'src/components/OrderPanel.tsx'), 'utf8');

describe('单位偏好的结构与位置', () => {
  it('是锚在数量框旁的浮层，不再是居中弹窗', () => {
    const src = panel();
    expect(src).toContain('data-testid="unit-preference-trigger"');
    expect(src).toContain('<PopoverContent');
    // 旧的居中 BottomSheet 必须彻底移除，避免两套并存
    expect(src).not.toContain('function BottomSheet');
    expect(src).not.toContain('货币单位');
  });

  it('标题为「单位偏好」，与币安一致', () => {
    expect(panel()).toContain('单位偏好');
  });

  it('两种结算方式都有常驻的订单金额 / 初始保证金子选项', () => {
    const src = panel();
    expect(src).toContain("label: '订单金额'");
    expect(src).toContain("label: '初始保证金'");
    expect(src).toContain('data-testid={`unit-sub-${sub.value}`}');
  });

  it('币本位不再出现 USD 档——币安 COIN-M 只有「张」与币', () => {
    expect(panel()).not.toContain('USD_NOTIONAL');
  });
});

describe('币本位「以币计的订单金额」换算', () => {
  const SIZE = 10;
  it('输入币数 → 折成 USD 名义 → 取整到张', () => {
    const price = 0.5;
    const coinAmount = 1_000; // 1000 RUNE 的订单金额
    const contracts = coinContractsFromUsdNotional(coinAmount * price, 'RUNEUSDT', SIZE);
    expect(contracts).toBe(50); // 500 USD ÷ 10
    expect(coinNotionalUsd(contracts, SIZE)).toBe(500);
  });

  it('与「张」档互相换算自洽', () => {
    const price = 0.499876;
    const contracts = 1_234;
    const usd = coinNotionalUsd(contracts, SIZE);
    const coin = usd / price;
    // 从币数换回张数应得到同一个值
    expect(coinContractsFromUsdNotional(coin * price, 'RUNEUSDT', SIZE)).toBe(contracts);
  });
});
