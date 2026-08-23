import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AddSizingCalculator } from '@/components/AddSizingCalculator';
import { SessionModeControls } from '@/components/SessionModeControls';
import type { Position, TradeRecord } from '@/types/trading';

/**
 * 盘面：RAVEUSDT 币本位多头两腿（100 张 @100、100 张 @120，面值 10 USD），现价 140；
 * 本场有一笔止盈1 落袋（+150 USD / +1.2 RAVE）。
 *   X₁ = 1000/100 + 1000/120 = 18.3333 币；S̄ = 2000 ÷ 18.3333 = 109.0909（名义加权调和）
 */
const positions: Position[] = [
  { id: 'p1', side: 'LONG', entryPrice: 100, quantity: 10, leverage: 5, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'RAVE', contractSizeUsd: 10, contracts: 100, margin: 200, openTime: 1_000 },
  { id: 'p2', side: 'LONG', entryPrice: 120, quantity: 8.33, leverage: 5, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'RAVE', contractSizeUsd: 10, contracts: 100, margin: 200, openTime: 2_000 },
];
const tradeHistory: TradeRecord[] = [
  { id: 'tp', symbol: 'RAVEUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice: 100, exitPrice: 125, quantity: 1, leverage: 5, pnl: 150, pnlCoin: 1.2, fee: 0, slippage: 0, openTime: 1_000, closeTime: 3_000, exit_method: 'tp1', settlementMode: 'coin' } as TradeRecord,
  // 本场之前的止盈，不该被计入
  { id: 'old', symbol: 'RAVEUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice: 90, exitPrice: 95, quantity: 1, leverage: 5, pnl: 999, pnlCoin: 9, fee: 0, slippage: 0, openTime: 100, closeTime: 500, exit_method: 'tp1', settlementMode: 'coin' } as TradeRecord,
];

vi.mock('@/contexts/TradingContext', async () => {
  const actual = await vi.importActual<typeof import('@/contexts/TradingContext')>('@/contexts/TradingContext');
  return {
    ...actual,
    useTradingContext: () => ({
      tradingMode: 'direct',
      setTradingMode: vi.fn(),
      positionsMap: { RAVEUSDT: positions },
      // 刻意放一个陈旧价：priceMap 是持久化的行情缓存，计算器不该再读它
      priceMap: { RAVEUSDT: 0.6273595 },
      tradeHistory,
      getSymbolSettlementMode: () => 'coin',
    }),
  };
});

const num = (testId: string) => Number((screen.getByTestId(testId) as HTMLInputElement).value);
const type = (testId: string, v: string) => fireEvent.change(screen.getByTestId(testId), { target: { value: v } });

function renderCalc(currentPrice = 140) {
  return render(
    <MemoryRouter>
      <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={currentPrice} />
    </MemoryRouter>,
  );
}

describe('AddSizingCalculator', () => {
  it('X₁ 与 S̄ 从持仓读：按各腿开仓价折币再相加，不用卡片上按标记价折的那个数', () => {
    renderCalc();
    expect(num('add-sizing-x1')).toBeCloseTo(18.3333, 3);
    expect(num('add-sizing-sbar')).toBeCloseTo(109.0909, 3);
    // S₂ 取传入的实时价，而不是 mock 里那个陈旧的 priceMap 值
    expect(num('add-sizing-s2')).toBe(140);
    expect(num('add-sizing-s2')).not.toBe(0.6273595);
    expect((screen.getByTestId('add-sizing-s1') as HTMLInputElement).value).toBe(''); // S₁ 留给人
  });

  it('填入 S₁ 后给出锁死上限 X₂ 与对冲量 X₁+X₂', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    // 垫子距离 20.909，风险距离 10 → b = 0.4783，X₂ = 18.333/0.4783 = 38.33；对冲 56.67
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('38.33');
    expect(screen.getByTestId('add-sizing-hedge')).toHaveTextContent('56.67');
    // 币本位附带张数：38.33 币 × 140 ÷ 10 ≈ 537 张
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('张');
  });

  it('S₁ 没越过均价 → 说明没有浮盈垫，而不是算出一个数', () => {
    renderCalc();
    type('add-sizing-s1', '100');
    expect(screen.getByTestId('add-sizing-cushion-problem')).toHaveTextContent('没有浮盈垫');
  });

  it('B 本账默认关闭；填 G 后才开，且不改 A 本账的数', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    expect(screen.getByTestId('add-sizing-banked-off')).toBeInTheDocument();
    const x2Before = screen.getByTestId('add-sizing-x2').textContent;

    // 检测到本场落袋 1.2 RAVE（旧的 999 那笔在本场之前，不计）
    const fill = screen.getByTestId('add-sizing-fill-banked');
    expect(fill).toHaveTextContent('1.2');
    expect(fill).toHaveTextContent('1 笔');
    fireEvent.click(fill);

    expect(num('add-sizing-g')).toBeCloseTo(1.2, 6);
    // 默认 K_B = S₁：币本位 X₂ᴮ = G·K_B ÷ (S₂−K_B) = 1.2×130/10 = 15.6；在 S₁ 恰好花光
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('15.6');
    expect(screen.getByTestId('add-sizing-banked')).toHaveTextContent('敞口 100.0%');
    // A 本账一字不变
    expect(screen.getByTestId('add-sizing-x2').textContent).toBe(x2Before);
  });

  it('把 K_B 拖到 S₁ 之下：B 腿变小、只吃掉一部分落袋，界面标出「已越过 S₁」', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    type('add-sizing-kb', '120');
    // X₂ᴮ = 1.2×120/20 = 7.2；跌到 S₁ 吃掉 7.2×10/130 = 0.5538 币 → 敞口 46.2%
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('7.2');
    expect(screen.getByTestId('add-sizing-kb-out')).toHaveTextContent('已越过 S₁');
    expect(screen.getByTestId('add-sizing-banked')).toHaveTextContent('敞口 46.2%');
  });

  it('定仓旋钮反推 K_B', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    fireEvent.click(screen.getByTestId('add-sizing-knob-size'));
    type('add-sizing-x2b', '7.2');
    // 币本位多头：K_B = x2·s2/(x2+g) = 7.2×140/8.4 = 120
    expect(screen.getByTestId('add-sizing-kb-out')).toHaveTextContent('120.0000');
  });

  it('落袋垫与浮盈垫同式：X = 垫 ÷ 险，K_B 默认取 S₁ 即零风险档', () => {
    // 浮盈垫 Y₁ = 18.3333×(130−109.0909) = 383.33；险 = 10 → X₂ = 38.33
    // 落袋垫 G = 1.2 RAVE，币本位按 K_B=S₁ 估值 → X_G = 1.2×130/10 = 15.6
    renderCalc();
    type('add-sizing-s1', '130');
    expect(screen.getByTestId('add-sizing-cushion')).toHaveTextContent('383.33 USD ÷ 险 10.0000');
    type('add-sizing-g', '1.2');
    // K_B 留空 = 取 S₁ = 零风险档，标题应这么说
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('零风险');
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('15.6');
    // 两本账相加，且此时对冲要一并扛起 B 腿
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('53.93');
    expect(screen.getByTestId('add-sizing-total-hedge')).toHaveTextContent('72.27');
  });

  it('K_B 拖到 S₁ 之下则 B 腿自带敞口，合计对冲不再并入它', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    type('add-sizing-kb', '120');
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('带敞口');
    // B 腿单独在 K_B 处对冲，A 线只管 X₁ + X₂
    expect(screen.queryByTestId('add-sizing-total-hedge')).not.toBeInTheDocument();
  });

  it('方向默认收成一个小字，点开才露出两个选项', () => {
    // 方向由持仓推定，几乎不用改——常驻两个按钮是多余的视觉分量
    renderCalc();
    expect(screen.queryByTestId('add-sizing-side-LONG')).not.toBeInTheDocument();
    const toggle = screen.getByTestId('add-sizing-side-toggle');
    expect(toggle).toHaveTextContent('主多');   // 盘面是多头
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId('add-sizing-side-SHORT'));
    // 选完立刻收回去
    expect(screen.queryByTestId('add-sizing-side-LONG')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-sizing-side-toggle')).toHaveTextContent('主空');
  });

  it('使用说明入口近乎隐形，但点开有公式与链接', () => {
    renderCalc();
    const help = screen.getByTestId('add-sizing-help');
    expect(help.className).toContain('text-muted-foreground/25');
    expect(screen.queryByTestId('add-sizing-help-panel')).not.toBeInTheDocument();
    fireEvent.click(help);
    const panel = screen.getByTestId('add-sizing-help-panel');
    expect(panel).toHaveTextContent('加仓量 = 垫 ÷ 险');
    expect(panel).toHaveTextContent('X₂ = Y₁ ÷ 险');
    expect(panel).toHaveTextContent('X_G = Y_G ÷ 险');
    expect(within(panel).getByRole('link')).toHaveAttribute('href', '/guide#s3-1c');
  });
});

describe('顶栏「加仓」按钮', () => {
  it('在倒叙播放左边；没有标的时禁用，有标的时点开计算器', () => {
    const { unmount } = render(<MemoryRouter><SessionModeControls /></MemoryRouter>);
    expect(screen.getByTestId('add-sizing-open')).toBeDisabled();
    unmount();

    render(<MemoryRouter><SessionModeControls activeSymbol="RAVEUSDT" /></MemoryRouter>);
    const open = screen.getByTestId('add-sizing-open');
    const reverse = screen.getByTestId('time-direction-toggle');
    // DOM 顺序：加仓在倒叙播放之前
    expect(open.compareDocumentPosition(reverse) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(open);
    expect(screen.getByTestId('add-sizing-dialog')).toBeInTheDocument();
    // 标题与标的现在是两个元素（标题黑、标的灰等宽），分别断言
    const dialog = screen.getByTestId('add-sizing-dialog');
    expect(within(dialog).getByText('加仓计算器')).toBeInTheDocument();
    expect(within(dialog).getByText('RAVEUSDT')).toBeInTheDocument();
  });
});
