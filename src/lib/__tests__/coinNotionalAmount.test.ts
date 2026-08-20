import { describe, expect, it } from 'vitest';
import { coinNotionalAmount, coinNotionalUsd, formatCoinAmount } from '@/lib/coinMargined';

describe('名义仓位的币本位计数', () => {
  it('USD 名义按价格折成币数', () => {
    // 用户截图那条委托：1,499,560 USD @ 0.494092
    const coin = coinNotionalAmount(1_499_560, 0.494092);
    expect(coin).not.toBeNull();
    expect(coin!).toBeCloseTo(3_034_981.339508, 4);
  });

  it('与「张 → USD 名义」链路自洽', () => {
    const SIZE = 10;
    const price = 0.5;
    const contracts = 1_000;
    const usd = coinNotionalUsd(contracts, SIZE); // 10,000 USD
    expect(coinNotionalAmount(usd, price)).toBeCloseTo(20_000, 9); // 20,000 枚
  });

  it('价格非正时返回 null，不臆造 0——0 会被误读成空仓', () => {
    expect(coinNotionalAmount(1_000, 0)).toBeNull();
    expect(coinNotionalAmount(1_000, -1)).toBeNull();
    expect(coinNotionalAmount(1_000, Number.NaN)).toBeNull();
  });

  it('名义为非有限数时同样返回 null', () => {
    expect(coinNotionalAmount(Number.NaN, 0.5)).toBeNull();
    expect(coinNotionalAmount(Number.POSITIVE_INFINITY, 0.5)).toBeNull();
  });

  it('名义为 0 时给出 0 枚，而不是 null——那是合法的空委托', () => {
    expect(coinNotionalAmount(0, 0.5)).toBe(0);
  });

  it('格式化带上币种，便于与 USD 副读数区分', () => {
    expect(formatCoinAmount(3_034_981.339508, 'RUNE')).toBe('3034981.339508 RUNE');
  });
});
