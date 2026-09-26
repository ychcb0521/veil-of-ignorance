import { describe, expect, it } from 'vitest';
import {
  coinQuantityInputValue,
  manualLegCoinQuantity,
  patchCoinQuantity,
  patchEntryPriceKeepingQuantity,
} from '@/lib/manualLegCoinQuantity';

describe('【用户要求】反事实编辑器的币量', () => {
  it('币量 = 名义 ÷ 开仓价（与 Legs 表同一个式子）；缺值不猜', () => {
    expect(manualLegCoinQuantity({ size_usdt: 1_000, entry_price: 4 })).toBe(250);
    expect(manualLegCoinQuantity({ size_usdt: 0, entry_price: 4 })).toBeNull();
    expect(manualLegCoinQuantity({ size_usdt: 1_000, entry_price: 0 })).toBeNull();
  });

  it('只改开仓价时币量不变：名义按新旧价同比例缩放', () => {
    const leg = { size_usdt: 1_000, entry_price: 4 };
    const patch = patchEntryPriceKeepingQuantity(leg, 5);
    expect(patch).toEqual({ entry_price: 5, size_usdt: 1_250 });
    expect(manualLegCoinQuantity({ ...leg, ...patch } as typeof leg)).toBeCloseTo(250, 12);
    // 价格没变、或新价无效：不碰名义
    expect(patchEntryPriceKeepingQuantity(leg, 4)).toEqual({ entry_price: 4 });
    expect(patchEntryPriceKeepingQuantity(leg, 0)).toEqual({ entry_price: 0 });
  });

  it('改币量：名义 = 币量 × 开仓价', () => {
    expect(patchCoinQuantity({ entry_price: 4 }, 300)).toEqual({ size_usdt: 1_200 });
  });

  it('输入框显示十位有效数字，去掉浮点尾巴', () => {
    expect(coinQuantityInputValue(0.1 + 0.2)).toBe(0.3);
    expect(coinQuantityInputValue(null)).toBe('');
  });
});
