import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPanel } from '@/components/OrderPanel';
import { LeverageModal } from '@/components/LeverageModal';
import { resetLeverageClampNotices } from '@/lib/leverageClampNotice';
import type { PositionLimitMode } from '@/lib/positionLimitMode';
import type { PendingOrder, Position } from '@/types/trading';

/**
 * 用户截图里的 ORDI：ORDIUSD（币安无 ORDI 币本位，按 ORDIUSDT 分层折 USD 面值）20x，
 * 已挂一张 13,370 USD 的条件单，再下 13,990 USD——
 *   币安标准：红框「持仓和当前委托价值超过当前杠杆倍数最高可持有头寸：20x 最高 25,000 USD…」、按钮置灰；
 *   无限制：没有红框、按钮可点，底部换成一行「无限制模式」说明；杠杆对话框的滑块到 150x。
 */
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver ??= RO;

// 整面板渲染较重，机器负载高时单个用例会越过默认的 5 秒（与 OrderPanel.positionLimit 同一个理由）
vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({
  mode: 'unlimited' as PositionLimitMode,
  balance: 2_000_000,
  settlement: 'coin' as 'coin' | 'usdt',
  leverage: 20,
  ordersMap: {} as Record<string, unknown[]>,
  positionsMap: {} as Record<string, unknown[]>,
}));

vi.mock('@/hooks/usePersistedState', () => ({
  usePersistedState: <T,>(_key: string, d: T) => useState<T>(d),
}));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({
  PreTradeSnapshotDialog: () => null,
}));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradingMode: 'direct',
    positionLimitMode: state.mode,
    setPositionLimitMode: vi.fn(),
    balance: state.balance,
    positionsMap: state.positionsMap,
    ordersMap: state.ordersMap,
    priceMap: {},
    leverageMap: {},
    getSymbolSettlementMode: () => state.settlement,
    setSymbolSettlementMode: vi.fn(),
    getSymbolLeverage: () => state.leverage,
    setSymbolLeverage: vi.fn(),
    getSymbolMarginMode: () => 'isolated',
    setSymbolMarginMode: vi.fn(),
    getEffectiveTime: () => 1_000,
    applySymbolLeverage: vi.fn(),
  }),
}));

const PRICE = 30;
/** 已挂的 13,370 USD 条件单（1,337 张 × 10 USD，20x，本次更新之后下的，带分层戳）。 */
const conditional: PendingOrder = {
  id: 'ordi-cond', side: 'LONG', type: 'CONDITIONAL', price: 0, stopPrice: 33, quantity: 1_337, contracts: 1_337,
  contractSizeUsd: 10, settlementMode: 'coin', settlementAsset: 'ORDI', leverage: 20, marginMode: 'isolated',
  status: 'PENDING', createdAt: 0, riskModel: 'binance-tiers-v1', lotSizeRule: 'binance-lot-size-v1',
} as PendingOrder;

function renderPanel() {
  const onPlaceOrder = vi.fn();
  render(
    <OrderPanel currentPrice={PRICE} onPlaceOrder={onPlaceOrder} disabled={false}
      symbol="ORDIUSD" pricePrecision={3} quantityPrecision={1} />,
  );
  return { onPlaceOrder };
}

const qtyInput = () => screen.getByTestId('order-qty-input') as HTMLInputElement;
const warning = () => screen.queryByTestId('position-limit-warning');
const longButton = () => screen.getByRole('button', { name: '开多' }) as HTMLButtonElement;

/** 市价单，按张填 1,399 张 = 13,990 USD。 */
async function enterNewOrder() {
  fireEvent.click(screen.getByRole('button', { name: '市价' }));
  fireEvent.click(screen.getByTestId('unit-preference-trigger'));
  fireEvent.click(await screen.findByTestId('unit-card-CONTRACTS'));
  fireEvent.change(qtyInput(), { target: { value: '1399' } });
}

beforeEach(() => {
  state.mode = 'unlimited';
  state.balance = 2_000_000;
  state.settlement = 'coin';
  state.leverage = 20;
  state.ordersMap = { ORDIUSD: [conditional] };
  state.positionsMap = {};
  resetLeverageClampNotices();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('下单面板：ORDI 20x、已挂 13,370 USD 条件单、再下 13,990 USD', () => {
  it('币安标准：13,370 + 13,990 超过 20x 最高 25,000 USD——红框、按钮置灰、底部是杠杆分层', async () => {
    state.mode = 'binance';
    const { onPlaceOrder } = renderPanel();
    await enterNewOrder();
    expect(warning()).toHaveTextContent('持仓和当前委托价值超过当前杠杆倍数最高可持有头寸：20x 最高 25,000 USD');
    expect(screen.getByTestId('position-limit-note')).toHaveTextContent('币安无 ORDI 币本位合约，按 U 本位 ORDIUSDT 分层折算');
    expect(longButton().disabled).toBe(true);
    fireEvent.click(longButton());
    expect(onPlaceOrder).not.toHaveBeenCalled();
    expect(screen.getByTestId('leverage-tier-link')).toHaveTextContent(/杠杆分层\s*· 20x 最高 25,000 USD/);
    expect(screen.queryByTestId('position-limit-mode-note')).toBeNull();
  });

  it('无限制：没有红框、按钮可点，下出去的就是 1,399 张 20x；底部换成一行无限制说明，没有杠杆分层与单笔上限小字', async () => {
    const { onPlaceOrder } = renderPanel();
    await enterNewOrder();
    expect(warning()).toBeNull();
    expect(screen.queryByTestId('trigger-risk-warning')).toBeNull();
    expect(screen.queryByTestId('lot-size-hint')).toBeNull();
    expect(screen.queryByTestId('lot-size-warning')).toBeNull();
    expect(screen.queryByTestId('leverage-tier-link')).toBeNull();
    expect(screen.getByTestId('position-limit-mode-note')).toHaveTextContent('无限制模式 · 杠杆 1–150x，不设持仓与单笔上限');
    expect(longButton().disabled).toBe(false);
    fireEvent.click(longButton());
    expect(onPlaceOrder).toHaveBeenCalledTimes(1);
    expect(onPlaceOrder.mock.calls[0][0]).toMatchObject({ contracts: 1_399, quantity: 1_399, leverage: 20 });
  });

  it('无限制：「可开」只受可用余额 × 杠杆约束（2,000,000 × 20 = 40,000,000 USD），不再是分层余量', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    fireEvent.click(screen.getByTestId('unit-preference-trigger'));
    fireEvent.click(await screen.findByTestId('unit-card-CONTRACTS'));
    // 4,000,000 张 = 40,000,000 USD：只受余额约束
    expect(screen.getByTestId('max-open-LONG-main').textContent).toContain('4,000,000');
  });

  it('币安标准下同样的「可开」卡在分层余量上（25,000 − 13,370 附近）', async () => {
    state.mode = 'binance';
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    fireEvent.click(screen.getByTestId('unit-preference-trigger'));
    fireEvent.click(await screen.findByTestId('unit-card-CONTRACTS'));
    const text = screen.getByTestId('max-open-LONG-main').textContent ?? '';
    const contracts = Number(text.replace(/[^\d.]/g, ''));
    expect(contracts).toBeGreaterThan(0);
    expect(contracts).toBeLessThanOrEqual(1_163);
  });
});

describe('杠杆对话框：滑块上限随模式', () => {
  const heldPos = (leverage: number): Position => ({
    id: 'h1', side: 'LONG', quantity: 1_000, contracts: 1_000, contractSizeUsd: 10, settlementMode: 'coin',
    settlementAsset: 'ORDI', entryPrice: 30, leverage, marginMode: 'isolated',
    margin: 10_000 / leverage, isolatedMargin: 10_000 / leverage, marginCoin: 10_000 / leverage / 30, openTime: 1,
  } as Position);

  const renderModal = (limitMode: PositionLimitMode | undefined, positions: Position[] = [], availableBalance = 1_000_000) => render(
    <LeverageModal symbol="ORDIUSD" currentLeverage={20} settlementMode="coin" positions={positions}
      orders={[conditional]} markPrice={PRICE} availableBalance={availableBalance} limitMode={limitMode}
      onClose={vi.fn()} onConfirm={vi.fn()} />,
  );

  it('币安标准（缺省）：滑块到 ORDI 的 50x，显示「当前杠杆倍数最高可持有头寸」', () => {
    renderModal(undefined);
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '50');
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('50x');
    expect(screen.getByTestId('leverage-max-position')).toHaveTextContent('25,000 USD');
    expect(screen.queryByTestId('leverage-unlimited-note')).toBeNull();
  });

  it('无限制：滑块到 150x，没有分层上限那一块，换成一行说明；150x 可以确认', () => {
    renderModal('unlimited');
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '150');
    expect(screen.getByTestId('leverage-max-label')).toHaveTextContent('150x');
    expect(screen.queryByTestId('leverage-max-position')).toBeNull();
    expect(screen.getByTestId('leverage-unlimited-note')).toHaveTextContent('无限制模式：任何币种 1–150x，不设持仓上限');
    const input = screen.getByTestId('leverage-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.blur(input);
    const confirm = screen.getByTestId('leverage-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(confirm).toHaveTextContent('确认 — 150x');
  });

  it('无限制：有持仓也能降杠杆（滑块下限 1x），预览写追加的保证金；余额不够就拒', () => {
    renderModal('unlimited', [heldPos(20)]);
    expect(screen.getByTestId('leverage-min-label')).toHaveTextContent('1x');
    const input = screen.getByTestId('leverage-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.blur(input);
    // 10,000 × (1/20 − 1/10) = −500
    expect(screen.getByTestId('leverage-margin-topup')).toHaveTextContent('500');
    expect((screen.getByTestId('leverage-confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  it('无限制：追加的保证金超过可用余额 → 拒绝并说清楚', () => {
    renderModal('unlimited', [heldPos(20)], 100);
    const input = screen.getByTestId('leverage-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('leverage-refusal')).toHaveTextContent('降到 10x 要追加保证金 500.00 USD，可用余额只有 100.00 USD');
    // 不投影一个负的「可用」：照实写可用多少、不足；金额写法与拒绝理由一致（千分位、单位、同一个减号）
    const topup = screen.getByTestId('leverage-margin-topup');
    expect(topup).toHaveTextContent('−500.00 USD · 可用只有 100.00 USD（不足）');
    expect(topup.textContent).not.toMatch(/可用\s*-/);
    expect((screen.getByTestId('leverage-confirm') as HTMLButtonElement).disabled).toBe(true);
  });

  it('币安标准：同一个持仓下滑块下限卡在 20x（只能升不能降）', () => {
    renderModal('binance', [heldPos(20)]);
    expect(screen.getByTestId('leverage-min-label')).toHaveTextContent('20x');
  });
});

/**
 * 【复核】下单面板的「可用」、「可开」与它打开的杠杆对话框，与引擎（handlePlaceOrder / applySymbolLeverage）读同一个数：
 * 余额 − Σ全仓保证金（lib/availableBalance）。逐仓保证金开仓时已经从余额扣掉——此前面板再减一次，
 * 无限制模式下同一步降杠杆在下单面板被「可用余额只有…」拒掉、在持仓卡与引擎却放行。
 */
describe('下单面板：可用余额与引擎同一个口径', () => {
  /** 已持有 ORDIUSD 多仓 1,000 张（10,000 USD）20x，逐仓保证金 500，钱包余额（已扣掉这 500）800。 */
  const seedHeld = () => {
    state.balance = 800;
    state.ordersMap = {};
    state.positionsMap = {
      ORDIUSD: [{
        id: 'held', side: 'LONG', quantity: 1_000, contracts: 1_000, contractSizeUsd: 10, settlementMode: 'coin',
        settlementAsset: 'ORDI', entryPrice: 30, leverage: 20, marginMode: 'isolated', margin: 500, isolatedMargin: 500,
        marginCoin: 500 / 30, openTime: 1, riskModel: 'unlimited-v1', riskSymbol: 'ORDIUSD',
      }],
    };
  };

  it('无限制：从下单面板把 20x 降到 10x（要追加 500）——可用 800 补得上，不拒；「可用」写 800 而不是 300', async () => {
    seedHeld();
    renderPanel();
    expect(screen.getByText(/可用/).closest('div')?.textContent).toContain('800.00');
    fireEvent.click(screen.getByTestId('order-leverage'));
    const input = await screen.findByTestId('leverage-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.blur(input);
    expect(screen.queryByTestId('leverage-refusal')).toBeNull();
    expect(screen.getByTestId('leverage-margin-topup')).toHaveTextContent('−500.00 → 可用 300.00 USD');
    expect((screen.getByTestId('leverage-confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  it('无限制：「可开」= 可用 × 杠杆（800 × 20 = 16,000 USD = 1,600 张），不再少算那 500 的逐仓保证金', async () => {
    seedHeld();
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    fireEvent.click(screen.getByTestId('unit-preference-trigger'));
    fireEvent.click(await screen.findByTestId('unit-card-CONTRACTS'));
    expect(screen.getByTestId('max-open-LONG-main').textContent).toContain('1,600');
  });
});

/**
 * 【复核】无限制模式不设上限，但滑点照常：150x 按 0.4% 维持保证金时强平价离开仓价只有约 0.27%，
 * 名义上千万的市价单成交价就被滑点推到了强平价外面——按钮前标红提醒（不拦）。
 */
describe('下单面板：一成交就会被强平的单标红提醒（不拦）', () => {
  const enterMarket = async (contracts: string) => {
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    fireEvent.click(screen.getByTestId('unit-preference-trigger'));
    fireEvent.click(await screen.findByTestId('unit-card-CONTRACTS'));
    fireEvent.change(qtyInput(), { target: { value: contracts } });
  };

  it('ORDIUSD 150x 市价 1,500,000 张（15,000,000 USD）：滑点 0.31% 越过 0.27% 的强平距离——标红，按钮照常可点', async () => {
    state.leverage = 150;
    state.ordersMap = {};
    const { onPlaceOrder } = renderPanel();
    await enterMarket('1500000');
    const warn = screen.getByTestId('opening-liquidation-warning');
    expect(warn).toHaveTextContent('开多：按滑点估算这一单成交价约');
    expect(warn).toHaveTextContent('一成交就会被强平');
    expect(longButton().disabled).toBe(false);
    fireEvent.click(longButton());
    expect(onPlaceOrder).toHaveBeenCalledTimes(1);
  });

  it('同样 150x、100,000 张（1,000,000 USD）：滑点只有 0.03%，不提醒', async () => {
    state.leverage = 150;
    state.ordersMap = {};
    renderPanel();
    await enterMarket('100000');
    expect(screen.queryByTestId('opening-liquidation-warning')).toBeNull();
  });
});

/**
 * 【复核】无限制模式下往币安标准下开的（分层）仓位上加仓：并进去、整仓仍按分层（设计第 3 条：加仓并进现有仓位的模型）。
 * 这个模式不显示分层，所以按钮前说清「整仓按分层」与合并前后的强平价。
 */
describe('下单面板：无限制模式下加仓并进分层仓位', () => {
  it('ORDIUSD 已有分层多仓 1,000 张 20x：再开多 100 张——说会并进币安标准下开的仓位、整仓仍按分层，写出强平价前后', async () => {
    state.ordersMap = {};
    state.positionsMap = {
      ORDIUSD: [{
        id: 'tiered', side: 'LONG', quantity: 1_000, contracts: 1_000, contractSizeUsd: 10, settlementMode: 'coin',
        settlementAsset: 'ORDI', entryPrice: 30, leverage: 20, marginMode: 'isolated', margin: 500, isolatedMargin: 500,
        marginCoin: 500 / 30, openTime: 1, riskModel: 'binance-tiers-v1', riskSymbol: 'ORDIUSD',
      }],
    };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    fireEvent.click(screen.getByTestId('unit-preference-trigger'));
    fireEvent.click(await screen.findByTestId('unit-card-CONTRACTS'));
    fireEvent.change(qtyInput(), { target: { value: '100' } });
    const note = screen.getByTestId('merge-model-note');
    expect(note).toHaveTextContent('开多：这一单会并进币安标准下开的同方向仓位——那个仓位按币安分层计维持保证金');
    expect(note).toHaveTextContent('整仓强平价');
    expect(note).not.toHaveTextContent('不会并进');
  });
});

/**
 * 【复核】币安标准下，对冲豁免的底是无限制模式下开的仓位：红框与它下面那行灰字用同一个称呼，
 * 不再一边说「无限制模式下开的仓位」、一边说「对冲更新前的仓位」。
 */
describe('下单面板：对冲无限制模式下开的仓位', () => {
  it('ORDIUSD 20x 的 unlimited-v1 多仓 5,000 张：开空 1,000 张——灰字说「对冲无限制模式下开的仓位」', async () => {
    state.mode = 'binance';
    state.ordersMap = {};
    state.positionsMap = {
      ORDIUSD: [{
        id: 'u-long', side: 'LONG', quantity: 5_000, contracts: 5_000, contractSizeUsd: 10, settlementMode: 'coin',
        settlementAsset: 'ORDI', entryPrice: 30, leverage: 20, marginMode: 'isolated', margin: 2_500, isolatedMargin: 2_500,
        marginCoin: 2_500 / 30, openTime: 1, riskModel: 'unlimited-v1', riskSymbol: 'ORDIUSD',
      }],
    };
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '市价' }));
    fireEvent.click(screen.getByTestId('unit-preference-trigger'));
    fireEvent.click(await screen.findByTestId('unit-card-CONTRACTS'));
    fireEvent.change(qtyInput(), { target: { value: '1000' } });
    expect(warning()).toHaveTextContent('反向开仓对冲无限制模式下开的仓位不受此限');
    const note = screen.getByTestId('legacy-hedge-note');
    expect(note).toHaveTextContent('开空：这一单是对冲无限制模式下开的仓位，不受分层上限约束');
    expect(note).toHaveTextContent('但它不算无限制模式下开的仓位');
    expect(note).not.toHaveTextContent('更新前');
  });
});
