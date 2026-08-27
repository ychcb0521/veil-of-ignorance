import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrderPanel } from '@/components/OrderPanel';

/**
 * 条件委托的折算价必须是**触发价**，不是下单那一刻的市价。
 *
 * 截图钉死的那一单：NOM/USD 币本位，触发价 0.010344，下单时市价 0.011199，
 * 面板与「当前委托」都写 892.960966 NOM —— 反解出来正是市价 0.0111987。
 * 而这单成交在 0.010344 上，真正拿到的是 966.744006 NOM，差 8.27%，
 * 且永远不收敛：它是拿一个**永不发生的价**算出来的。
 */
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: <T,>(_k: string, d: T) => useState(d),
}));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({
  PreTradeSnapshotDialog: () => null,
}));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradingMode: 'direct',
    balance: 2_000_000,
    positionsMap: {}, ordersMap: {}, priceMap: {}, leverageMap: {},
    getSymbolSettlementMode: () => 'coin',
    setSymbolSettlementMode: vi.fn(),
    getSymbolLeverage: () => 3,
    setSymbolLeverage: vi.fn(),
    getSymbolMarginMode: () => 'isolated',
    setSymbolMarginMode: vi.fn(),
    getEffectiveTime: () => 1_000,
  }),
}));

const MARKET = 0.011199;   // 下单那一刻的市价
const TRIGGER = 0.010344;  // 触发价 —— 这单真正会成交的地方
const FACE = 10;           // 非 BTC 标的一张面值 10 USD

function renderPanel(price = MARKET) {
  const onPlaceOrder = vi.fn();
  const view = render(
    <OrderPanel currentPrice={price} onPlaceOrder={onPlaceOrder} disabled={false}
      symbol="NOMUSD" pricePrecision={6} quantityPrecision={6} />,
  );
  const rerenderAt = (p: number) => view.rerender(
    <OrderPanel currentPrice={p} onPlaceOrder={onPlaceOrder} disabled={false}
      symbol="NOMUSD" pricePrecision={6} quantityPrecision={6} />,
  );
  return { ...view, rerenderAt, onPlaceOrder };
}

const qtyInput = () => screen.getByTestId('order-qty-input') as HTMLInputElement;
const hint = () => screen.getByTestId('coin-effective-qty-hint');
const trigger = () => screen.getByTestId('order-trigger-price') as HTMLInputElement;

/** 切到「条件委托」高级槽。 */
function pickConditional() {
  // 高级槽的按钮文字默认就是「条件委托」，所以必须在下拉菜单**内部**取，
  // 否则 getByText 会同时命中槽位本身。
  fireEvent.click(screen.getByTestId('advanced-type-slot'));
  const menu = screen.getByTestId('advanced-type-menu');
  fireEvent.click(within(menu).getByText('条件委托'));
}

describe('条件委托按触发价折算', () => {
  it('【回归】填 1000 币：提示写 966.744006，不是市价折出来的 892.94', () => {
    renderPanel();
    pickConditional();
    fireEvent.change(trigger(), { target: { value: String(TRIGGER) } });
    fireEvent.change(qtyInput(), { target: { value: '1000' } });

    expect(hint()).toHaveTextContent('实际下单 1 张');
    expect(hint()).toHaveTextContent('966.744006 NOM');
    expect(hint()).not.toHaveTextContent('892.9');   // 市价折出来的数
    expect(hint()).toHaveTextContent('按触发价折算');
  });

  it('【回归】张数按触发价定：3600 币是 3 张，不是市价折出来的 4 张', () => {
    // 市价折：3600×0.0111987/10 = 4.03 → 4 张。那 4 张到触发价上是 3866.98 个币,
    // 比用户填的 3600 多 267 个 —— 他从没批准过那 267 个。
    // 触发价折：3600×0.010344/10 = 3.72 → 3 张 = 到手恰好 3600 个币。
    renderPanel();
    pickConditional();
    fireEvent.change(trigger(), { target: { value: String(TRIGGER) } });
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    expect(hint()).toHaveTextContent('实际下单 3 张');
    expect(hint()).toHaveTextContent('2900.232019 NOM');   // 3 张到手正好 ≈ 填的 3600？不——
    // 3 张 = 2900.23 个币，比填的 3600 少；而市价档那 4 张到触发价上是 3866.98 个，比填的多。
    // 规则是「填的数是授权上限」：宁可少下，绝不多下（见 coinMargined.ts 的 coinContractsExact）。
  });

  it('触发价高于市价（买入止损）方向同样成立：3300 币是 4 张而不是 3 张', () => {
    renderPanel();
    pickConditional();
    fireEvent.change(trigger(), { target: { value: '0.0125' } });
    fireEvent.change(qtyInput(), { target: { value: '3300' } });
    expect(hint()).toHaveTextContent('实际下单 4 张');   // 3300×0.0125/10 = 4.125
  });

  it('先填量后改触发价：按新触发价重折，不是沿用旧价', () => {
    // 重折闸门原本只认限价框（prevFoldDeps 里根本没有 stopPrice），
    // 漏一个卡点就是静默不重折 —— 症状与最初那次 4→3 一模一样。
    renderPanel();
    pickConditional();
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    expect(hint()).toHaveTextContent('实际下单 4 张');   // 触发价还空着 → 退回市价
    fireEvent.change(trigger(), { target: { value: String(TRIGGER) } });
    expect(hint()).toHaveTextContent('实际下单 3 张');
  });

  it('行情跳动不得改动条件单的折算——折算价是触发价，它不随行情走', () => {
    const { rerenderAt } = renderPanel();
    pickConditional();
    fireEvent.change(trigger(), { target: { value: String(TRIGGER) } });
    fireEvent.change(qtyInput(), { target: { value: '1000' } });
    fireEvent.blur(qtyInput());
    const snapped = qtyInput().value;
    expect(parseFloat(snapped)).toBeCloseTo(FACE / TRIGGER, 4);

    rerenderAt(0.009);          // 行情大跳
    expect(qtyInput().value).toBe(snapped);            // 框不动
    expect(hint()).toHaveTextContent('966.744006 NOM'); // 提示也不动
    expect(hint()).toHaveTextContent('实际下单 1 张');
  });

  it('框、提示、以及提交出去的量，是同一个数', () => {
    // 用户已经为「同屏两个数」报过四次错。折算价换了，这条不变量必须跟着换。
    const { onPlaceOrder } = renderPanel();
    pickConditional();
    fireEvent.change(trigger(), { target: { value: String(TRIGGER) } });
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    fireEvent.blur(qtyInput());

    const boxed = parseFloat(qtyInput().value);
    expect(boxed).toBeCloseTo(3 * FACE / TRIGGER, 4);        // 3 张在触发价下的币量
    expect(hint()).toHaveTextContent(String(boxed.toFixed(4).slice(0, 7)));

    fireEvent.click(screen.getByText('开多'));
    const params = onPlaceOrder.mock.calls[0][0];
    expect(params.contracts).toBe(3);
  });

  it('【回归】在限价档填过价再切条件委托，不得把那个残值当委托价发出去', () => {
    // priceSelection 此前对高级类型完全没有映射，于是限价框的残值会随单发出，
    // 变成一张没有任何引擎会认的「委托价」，还会被折算价优先读到。
    const { onPlaceOrder } = renderPanel();
    fireEvent.change(screen.getByTestId('order-limit-price'), { target: { value: '0.0113' } });
    pickConditional();
    fireEvent.change(trigger(), { target: { value: String(TRIGGER) } });
    fireEvent.change(qtyInput(), { target: { value: '1000' } });
    expect(hint()).toHaveTextContent('按触发价折算');

    fireEvent.click(screen.getByText('开多'));
    const params = onPlaceOrder.mock.calls[0][0];
    expect(params.price).toBe(0);
    expect(params.stopPrice).toBeCloseTo(TRIGGER, 9);
  });

  it('最小下单量提示与拦截用同一个价——否则会出现「请至少填 892.96」却拒收 900', () => {
    renderPanel();
    pickConditional();
    fireEvent.change(trigger(), { target: { value: String(TRIGGER) } });
    fireEvent.change(qtyInput(), { target: { value: '900' } });   // 900×0.010344 = 9.31 USD < 一张
    const min = screen.getByTestId('coin-min-order-hint');
    expect(min).toHaveTextContent('966.744006');   // 按触发价报，与拦截同源
    expect(min).not.toHaveTextContent('892.9');
    expect(min).toHaveTextContent('按触发价');
  });

  /**
   * 【回归】切换订单类型标签不得改动已经填好的量。
   *
   * 折算源一度被「失焦吸附」写成了整张数的边界值（40 USD ÷ 0.0113 = 3539.823009），
   * 于是每一次往低价的重折都必掉一张，而且是单向棘轮：
   * 点开条件委托瞄一眼再点回限价，40 USD 的单子变 30 USD，再切两次只剩 10 USD，
   * 屏幕上没有任何一处说过数量变了。
   */
  it('【回归】反复切换订单类型标签，张数必须原地不动', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('order-limit-price'), { target: { value: '0.0113' } });
    fireEvent.change(qtyInput(), { target: { value: '3600' } });
    expect(hint()).toHaveTextContent('实际下单 4 张');

    for (let i = 0; i < 3; i++) {
      pickConditional();
      expect(hint()).toHaveTextContent('实际下单 4 张');
      fireEvent.click(screen.getByText('限价'));
      expect(hint()).toHaveTextContent('实际下单 4 张');
    }
  });

  /**
   * 【回归】折算基准变化的那一帧，别把「旧锁 × 新价」写进输入框。
   *
   * 曾经的末态：框里躺着 892.936869，提示写「请至少填 892.936869 NOM」，按钮却是灰的——
   * 提示要的数一字不差地就在框里。而且因为 quantity 已等于那个串，
   * 照着重敲一遍会被 React 吞掉，用户唯一的出路是先清空。
   */
  it('【回归】切走后不得出现「框里正是提示要的数、按钮却是灰的」', () => {
    renderPanel();
    pickConditional();
    fireEvent.change(trigger(), { target: { value: '0.0125' } });
    fireEvent.change(qtyInput(), { target: { value: '800' } });
    expect(hint()).toHaveTextContent('实际下单 1 张');

    fireEvent.click(screen.getByTestId('advanced-type-slot'));
    fireEvent.click(within(screen.getByTestId('advanced-type-menu')).getByText('跟踪委托'));

    // 800 个币在现价 0.011199 下确实不足一张（8.96 USD < 10 USD），拦下来是对的；
    // 错的是把框改成「刚好够一张」的那个数再拦。
    const min = screen.getByTestId('coin-min-order-hint');
    expect(min).toHaveTextContent('892.936869');
    // 框里仍是用户填的 800（吸附成 800.000000），不是提示要的那个数
    expect(parseFloat(qtyInput().value)).toBeCloseTo(800, 6);
    expect(parseFloat(qtyInput().value)).not.toBeCloseTo(892.936869, 4);
  });

  it('保证金折币与「可用」折币同分母——否则同屏出现「要的比有的多」却还能下单', () => {
    // 保证金按折算价、可用按现价，两者差 8.27%：
    // 屏幕上会写「保证金 1.979 亿 NOM」压在「可用 1.828 亿 NOM」上面，而 USD 口径分毫不差。
    renderPanel();
    pickConditional();
    fireEvent.change(trigger(), { target: { value: String(TRIGGER) } });
    fireEvent.change(qtyInput(), { target: { value: '3600' } });

    // 「可用」与「保证金」两行都渲染成 `<数字> NOM ≈ <数字> USD`，取第一段数字比。
    const coinOf = (el: Element) => parseFloat(el.textContent!.replace(/,/g, '').match(/([\d.]+)\s*NOM/)![1]);
    const avail = coinOf(screen.getByText(/可用/).closest('div')!);
    const margins = screen.getAllByText(/NOM ≈ .* USD/).map(coinOf);
    // 3 张 = 30 USD 名义、3x 杠杆 → 10 USD 保证金 → 按**现价**折币，与可用同分母
    expect(margins).toContainEqual(expect.closeTo(10 / MARKET, 2));
    expect(avail).toBeCloseTo(2_000_000 / MARKET, -3);   // fixture 里的余额是 200 万
    // 按折算价折会得到 10/0.010344 = 966.74，比同分母的 892.94 大 8.27%
    expect(margins).not.toContainEqual(expect.closeTo(10 / TRIGGER, 2));
  });
});
