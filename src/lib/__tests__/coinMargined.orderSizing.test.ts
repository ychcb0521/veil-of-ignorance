import { describe, expect, it } from 'vitest';
import {
  coinContractsExact,
  coinContractsExactFromUsdNotional,
  coinNotionalUsd,
  getCoinMarginedContractSizeUsd,
  roundCoinContracts,
} from '@/lib/coinMargined';

/**
 * 用户截图那一单：API3/USD 币本位 6x，现价 0.409200，
 * 在「以币计的订单金额」里填 10 API3。
 *   期望：10 × 0.4092 = 4.092 USD 名义
 *   实得：24.437928 API3 ≈ 10.00 USD —— 整整 2.4 倍，而输入框一直显示 10
 * 机制：4.092 / 10（一张面值）= 0.409 张 → Math.round → 0 → Math.max(1, 0) = 1 张。
 */
const PRICE = 0.409200;
const SIZE = 10;            // API3 非 BTC，一张 10 USD

describe('币本位下单量不得被静默放大', () => {
  it('【回归】不足一张时返回 0，而不是被放大成 1 张', () => {
    const notionalUsd = 10 * PRICE;                    // 4.092 USD
    expect(notionalUsd / SIZE).toBeCloseTo(0.4092, 4); // 0.409 张

    // 旧行为：放大成 1 张 = 10 USD ≈ 24.44 币
    expect(roundCoinContracts(notionalUsd / SIZE)).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    void 0;
    const inflatedCoin = coinNotionalUsd(1, SIZE) / PRICE;
    expect(inflatedCoin).toBeCloseTo(24.437928, 6);    // 正是截图里那个数

    // 新行为：不足一张就是 0，交给调用方去拒绝并报最小量
    expect(coinContractsExact(notionalUsd / SIZE)).toBe(0);
    expect(coinContractsExactFromUsdNotional(notionalUsd, 'API3USD', SIZE)).toBe(0);
  });

  it('一张的最小币量随价浮动——面值锁在 USD 上', () => {
    expect(SIZE / PRICE).toBeCloseTo(24.437928, 6);
    // 价格翻倍，一张只要一半的币
    expect(SIZE / (PRICE * 2)).toBeCloseTo(12.218964, 6);
    expect(getCoinMarginedContractSizeUsd('BTCUSD')).toBe(100);
    expect(getCoinMarginedContractSizeUsd('API3USD')).toBe(10);
  });

  it('向下取整，绝不给多——输入框里的数是用户的授权上限', () => {
    // 四舍五入下 3.7 张会变 4 张，用户填 37 个币拿到 48.88 个（+32%）。
    // 少开可以再补一单；多开要付一个 taker 来回加滑点才削得回去。
    expect(coinContractsExactFromUsdNotional(10, 'API3USD', SIZE)).toBe(1);
    expect(coinContractsExactFromUsdNotional(37, 'API3USD', SIZE)).toBe(3);   // 3.7 → 3
    expect(coinContractsExactFromUsdNotional(34, 'API3USD', SIZE)).toBe(3);   // 3.4 → 3
    expect(coinContractsExact(1.999)).toBe(1);
  });

  it('[0.5, 1) 这一档也必须是 0——四舍五入会在这里悄悄放大到 2 倍', () => {
    // 13 API3 × 0.4092 = 5.3196 USD = 0.532 张。旧的 Math.round 会给 1 张（+88%）。
    expect(coinContractsExactFromUsdNotional(13 * PRICE, 'API3USD', SIZE)).toBe(0);
    expect(coinContractsExact(0.5)).toBe(0);
    expect(coinContractsExact(0.99)).toBe(0);
  });

  it('浮点噪声不该把 3 张吃成 2 张', () => {
    expect(coinContractsExact(2.9999999999)).toBe(3);
  });

  it('不传面值时按标的推导——BTC 一张 100 USD，其余 10 USD', () => {
    expect(coinContractsExactFromUsdNotional(250, 'BTCUSD')).toBe(2);   // 2.5 → 2
    expect(coinContractsExactFromUsdNotional(4.092, 'API3USD')).toBe(0);
  });

  it('【回归】填 88 拿到 72.956016——框里的数与委托里的数必须能对上', () => {
    // 用户第二次报的那一单：API3 @0.411207，「API3 金额」档填 88。
    const PRICE2 = 0.411207;
    const notionalUsd = 88 * PRICE2;                       // 36.186216 USD
    const contracts = coinContractsExactFromUsdNotional(notionalUsd, 'API3USD', SIZE);
    expect(contracts).toBe(3);                             // 3.6186 → 向下取整
    const actualCoin = coinNotionalUsd(contracts, SIZE) / PRICE2;
    // 截图里是 72.956016，用的是未四舍五入的标记价；这里拿显示价 0.411207 复算，
    // 只对得到小数点后 3 位。要害是「3 张」这个整数，不是末位。
    expect(actualCoin).toBeCloseTo(72.956, 3);

    // 88 在这个粒度上根本落不到：相邻两档只有 72.96 与 97.28，
    // 所以输入框必须吸附到 72.956016，而不是留着 88 让两处显示不一致。
    const nextUp = coinNotionalUsd(contracts + 1, SIZE) / PRICE2;
    expect(nextUp).toBeCloseTo(97.275, 3);
    expect(88).toBeGreaterThan(actualCoin);
    expect(88).toBeLessThan(nextUp);

    // 一张的币量 = 粒度；88 不是它的整数倍，这就是对不上的全部原因
    const stepCoin = SIZE / PRICE2;
    expect(stepCoin).toBeCloseTo(24.319, 3);
    expect(actualCoin / stepCoin).toBeCloseTo(3, 9);
  });

  it('吸附后的值再走一遍换算必须不动——否则失焦会反复跳数', () => {
    const PRICE2 = 0.411207;
    const snapped = coinNotionalUsd(3, SIZE) / PRICE2;     // 72.956016
    const again = coinContractsExactFromUsdNotional(snapped * PRICE2, 'API3USD', SIZE);
    expect(again).toBe(3);
  });

  it('非法输入一律 0，不制造 1 张', () => {
    for (const v of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(coinContractsExact(v)).toBe(0);
    }
  });

  it('roundCoinContracts 保留下限，但只服务于「已存在的订单/仓位」', () => {
    // 一笔已成交的单子不该被读成 0 张（那会变成幽灵仓位），所以这里的
    // Math.max(1, …) 是对的——它只是绝不能用在换算用户输入的路径上。
    expect(roundCoinContracts(0.4)).toBe(1);
    expect(roundCoinContracts(0)).toBe(0);
  });

  it('两者只在「不足一张」与「取整方向」上分岔，整数张上必须一致', () => {
    // 整数张：两者必须给同一个数，否则显示与成交会再次分家
    for (const contracts of [1, 2, 10, 137]) {
      expect(coinContractsExact(contracts)).toBe(roundCoinContracts(contracts));
    }
    // 跨 0.5 边界：这才是两者真正分岔的窗口
    expect(coinContractsExact(0.4)).toBe(0);
    expect(roundCoinContracts(0.4)).toBe(1);
    expect(coinContractsExact(0.6)).toBe(0);
    expect(roundCoinContracts(0.6)).toBe(1);
    expect(coinContractsExact(1.6)).toBe(1);
    expect(roundCoinContracts(1.6)).toBe(2);
  });
});
