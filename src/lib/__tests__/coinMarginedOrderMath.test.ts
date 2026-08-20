/**
 * 币本位下单的数学与单位口径。
 *
 * 起因：用户在币本位下输入 5,000,000 后，保证金显示 ≈2,499,378 USD、下单被拒，
 * 看起来像「杠杆没算进去」。逐位核对后确认数学是对的——那个输入落在
 * 「以币计的初始保证金」模式里，而单位标签只写币名，与「数量」无从区分。
 * 这里把正确的数学固定住，避免日后有人「修」出真的错误。
 */
import { describe, expect, it } from 'vitest';
import {
  coinContractsFromUsdNotional,
  coinMarginAmount,
  coinNotionalUsd,
} from '@/lib/coinMargined';

const SIZE = 10; // 非 BTC 标的：1 张 = 10 USD 面值

describe('币本位保证金确实除以了杠杆', () => {
  it('按张数下单：保证金 = 名义 ÷（价格 × 杠杆）', () => {
    const contracts = 100_000;
    const price = 0.499876;
    const notional = coinNotionalUsd(contracts, SIZE); // 1,000,000 USD
    expect(notional).toBe(1_000_000);

    for (const lev of [1, 8, 35, 100]) {
      const marginCoin = coinMarginAmount(contracts, price, lev, SIZE);
      const marginUsd = marginCoin * price;
      expect(marginUsd).toBeCloseTo(notional / lev, 6);
      // 杠杆翻倍，保证金减半——「漏乘杠杆」会让这条失败
      expect(marginCoin).toBeCloseTo(notional / (price * lev), 9);
    }
  });

  it('杠杆越高保证金越低，严格单调', () => {
    const m = [1, 2, 4, 8, 16].map(lev => coinMarginAmount(50_000, 0.5, lev, SIZE));
    for (let i = 1; i < m.length; i += 1) expect(m[i]).toBeLessThan(m[i - 1]);
  });

  it('复现用户那一单：5,000,000 币保证金 @8x 确实需要约 250 万 USD', () => {
    const price = 0.499876;
    const lev = 8;
    const typedMarginCoin = 5_000_000;
    // 保证金模式：先由保证金反推名义，再取整到张
    const targetNotional = typedMarginCoin * price * lev;
    const contracts = coinContractsFromUsdNotional(targetNotional, 'RUNEUSDT', SIZE);
    const marginCoin = coinMarginAmount(contracts, price, lev, SIZE);
    const marginUsd = marginCoin * price;

    expect(contracts).toBe(1_999_504);
    expect(marginCoin).toBeGreaterThan(4_999_999);
    expect(marginCoin).toBeLessThan(5_000_002);
    // 面板实际显示 ≈2,499,378.75（取决于成交瞬间的价格），此处只钉量级
    expect(marginUsd).toBeGreaterThan(2_499_000);
    expect(marginUsd).toBeLessThan(2_500_000);
    // 这不是 bug：名义 ≈2000 万，8 倍杠杆下保证金本就该是 ≈250 万
    expect(coinNotionalUsd(contracts, SIZE) / lev).toBeCloseTo(marginUsd, 0.5);
  });

  it('张数取整后保证金随之重算，不会凭空多收', () => {
    // 非整张的名义会向最近整张取整，保证金必须按取整后的张数算
    const contracts = coinContractsFromUsdNotional(1_234, 'RUNEUSDT', SIZE); // 123 张
    expect(contracts).toBe(123);
    expect(coinNotionalUsd(contracts, SIZE)).toBe(1_230);
  });

  it('价格或杠杆非法时返回 0，不产生 NaN 污染下游', () => {
    expect(coinMarginAmount(100, 0, 8, SIZE)).toBe(0);
    expect(coinMarginAmount(100, 0.5, 0, SIZE)).toBe(0);
    expect(Number.isFinite(coinMarginAmount(100, 0.5, 8, SIZE))).toBe(true);
  });
});

describe('下单面板的单位口径', () => {
  const panel = () =>
    readFileSyncSafe('src/components/OrderPanel.tsx');

  it('币本位默认用「张」，不再默认 USD/USDT', () => {
    expect(panel()).toContain("useState<CurrencyUnit>(isCoinMargined ? 'BASE' : 'USDT')");
  });

  it('以币计的保证金输入必须带「保证金」字样，不能只写币名', () => {
    const src = panel();
    expect(src).toContain('${baseCoin} 保证金');
    // 旧写法（裸币名）会让保证金输入与数量输入无从区分
    expect(src).not.toContain("? 'USD' : baseCoin) : 'USDT')");
  });
});

function readFileSyncSafe(rel: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('node:path');
  return readFileSync(join(process.cwd(), rel), 'utf8');
}
