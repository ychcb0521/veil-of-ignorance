import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** 盘口挂单：模块级可变量，默认空——这样现有 13 条测试里 bookLine 恒为 null，
 *  「S₁ 留给人」那条契约原样成立；只有显式塞单子的测试才看得到盘口线。 */
const book = vi.hoisted(() => ({ orders: {} as Record<string, unknown[]> }));
/** 盘面覆写：默认 null 即沿用上面那套老持仓（没有真实开仓时刻）；只有重放那组测试会塞。 */
const scene = vi.hoisted(() => ({ positions: null as unknown[] | null, tradeHistory: null as unknown[] | null }));
/** 下单面板当前的结算方式：默认币本位；只有「口径跟仓位不跟面板」那组测试会拨它。 */
const panel = vi.hoisted(() => ({ mode: 'coin' as 'coin' | 'usdt' }));

vi.mock('@/contexts/TradingContext', async () => {
  const actual = await vi.importActual<typeof import('@/contexts/TradingContext')>('@/contexts/TradingContext');
  return {
    ...actual,
    useTradingContext: () => ({
      tradingMode: 'direct',
      setTradingMode: vi.fn(),
      positionsMap: { RAVEUSDT: scene.positions ?? positions },
      ordersMap: book.orders,
      // 刻意放一个陈旧价：priceMap 是持久化的行情缓存，计算器不该再读它
      priceMap: { RAVEUSDT: 0.6273595 },
      tradeHistory: scene.tradeHistory ?? tradeHistory,
      getSymbolSettlementMode: () => panel.mode,
    }),
  };
});

/** R0 自检注入口：垫子式与成本线式在数学上恒等，走正门造不出分歧；要测「对不上就不说通过」只能从外面把结论改坏。 */
const r0Seam = vi.hoisted(() => ({ costLineMismatch: false }));
vi.mock('@/lib/addSizing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/addSizing')>('@/lib/addSizing');
  return {
    ...actual,
    crossCheckPostAddR0: (input: Parameters<typeof actual.crossCheckPostAddR0>[0]) => {
      const check = actual.crossCheckPostAddR0(input);
      if (!check || !r0Seam.costLineMismatch) return check;
      return {
        ...check,
        verdict: 'mismatch' as const,
        disagrees: [...check.disagrees, 'cost_line' as const],
        costLine: { ...check.costLine, gap: check.costLine.gap + 1, shortfall: check.costLine.shortfall + 1 },
      };
    },
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
    // 只锁 X₂ᴬ 这个**数值**：G 一开，A 段降为「仅 A」的中性芯片（不再给 USD / 张数的大字——
    // 那不是该照着下的量），但 X₂ᴬ 本身必须一字不变。
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('38.33');

    // 检测到本场落袋 1.2 RAVE（旧的 999 那笔在本场之前，不计）
    const fill = screen.getByTestId('add-sizing-fill-banked');
    expect(fill).toHaveTextContent('1.2');
    expect(fill).toHaveTextContent('1 笔');
    fireEvent.click(fill);

    expect(num('add-sizing-g')).toBeCloseTo(1.2, 6);
    // 默认 K_B = S₁：币本位 X₂ᴮ = G·K_B ÷ (S₂−K_B) = 1.2×130/10 = 15.6；在 S₁ 恰好花光
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('15.6');
    expect(screen.getByTestId('add-sizing-banked')).toHaveTextContent('敞口 100.0%');
    // A 本账一字不变，只是降级为拆解
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('38.33');
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('仅 A');
    expect(screen.getByTestId('add-sizing-x2')).not.toHaveTextContent('张');
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
    // K_B 留空 = 取 S₁：在 S₁ 恰好花完 G。X_G 只是拆解——不叫「零风险」、不给张数，免得被单独拿去下单
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('仅拆解');
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('不可单独下单');
    expect(screen.getByTestId('add-sizing-x2b-out')).not.toHaveTextContent('零风险');
    expect(screen.getByTestId('add-sizing-x2b-out')).not.toHaveTextContent('张');
    expect(screen.getByTestId('add-sizing-kb-out')).toHaveTextContent('恰好花完 G');
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('15.6');
    // 两本账相加，且此时对冲要一并扛起 B 腿
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('53.93');
    expect(screen.getByTestId('add-sizing-total-hedge')).toHaveTextContent('72.27');
  });

  it('镜像已落袋后，头条是 Plan B 的统一加仓上限，不是单独的 X_G', () => {
    // X_G 单独看没有下单意义：真正提交的是当前旧仓垫与落袋垫的合计。
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');

    const total = screen.getByTestId('add-sizing-total-add');
    expect(total).toHaveTextContent('Plan B 加仓上限');
    expect(total).toHaveTextContent('53.93');            // 38.33 + 15.6
    expect(total).toHaveTextContent('38.33');            // 拆解仍在，A
    expect(total).toHaveTextContent('15.6');             // 拆解仍在，B

    // 头条排在 X_G 之前——总量先入眼
    const xg = screen.getByTestId('add-sizing-x2b-out');
    expect(total.compareDocumentPosition(xg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /**
   * A 单独无解不等于 Plan B 必然无解：旧仓在 S₁ 的垫子可以为负，只要落袋 G 足以先补掉
   * 这块缺口、再覆盖新腿即可。事故来自把 X_G 单独拿去下单，没有扣回旧仓负垫。
   */
  it('【回归】A 单独无解时，Plan B 先扣旧仓负垫；不足则阻断，足够才给量', () => {
    renderCalc();
    type('add-sizing-s1', '100');
    type('add-sizing-g', '1.2');
    // 落袋垫 3 币，小于旧仓负垫折算的 4.17 币：Plan B 没额度，且不能把 3 币单独下掉。
    expect(screen.getByTestId('add-sizing-banked-no-room')).toBeInTheDocument();
    expect(screen.queryByTestId('add-sizing-x2b-out')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-sizing-total-add')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-sizing-g')).toBeInTheDocument();
    expect(screen.getByTestId('add-sizing-fill-banked')).toBeInTheDocument();

    // G 增大后先补旧仓缺口，剩下的才成为本次可加量：25 − 4.17 = 20.83 币。
    type('add-sizing-g', '10');
    expect(screen.queryByTestId('add-sizing-banked-no-room')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('20.83');

    // G 总额虽够，但把 K_B 拉得过远会让本次分配给 B 腿的量太小：计划加仓为 0。
    // 上限只由规则决定，旋钮不改它——仍是 20.83。
    type('add-sizing-kb', '20');
    expect(screen.getByTestId('add-sizing-planned-no-room')).toHaveTextContent('当前 K_B / 定仓值折出的 B 腿太小');
    expect(screen.queryByTestId('add-sizing-banked-no-room')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('20.83');
    expect(screen.queryByTestId('add-sizing-r0')).toBeNull();
  });

  /** 【复核】G > 0 时 Plan A 段不再报红：旧仓垫为负只是如实写成负数，由 Plan B 去扣。 */
  it('【复核】S₁ 在成本线亏损侧、G 足够：Plan A 只显示带符号的 Y₁，不出红色违规与大字', () => {
    renderCalc();
    type('add-sizing-s1', '100');
    type('add-sizing-g', '10');
    expect(screen.queryByTestId('add-sizing-cushion-problem')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-sizing-hedge')).not.toBeInTheDocument();
    // Y₁ = 18.3333 × (100 − 109.0909) ÷ 100 = −1.6667 RAVE（−166.67 USD），与 G 同单位
    expect(screen.getByTestId('add-sizing-cushion-y1')).toHaveTextContent('−1.6667 RAVE');
    expect(screen.getByTestId('add-sizing-cushion-y1')).toHaveTextContent('−166.67 USD');
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('-4.17');
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('20.83');
  });

  it('旧仓垫为正时，Plan B 照常把两部分合并', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    expect(screen.queryByTestId('add-sizing-banked-no-room')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-sizing-x2b-out')).toBeInTheDocument();
  });

  it('【回归】K_B 拖到 S₁ 之下：上限不变，旋钮推出的是「计划加仓」，对冲照常 = X₁ + 计划加仓', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    type('add-sizing-kb', '120');
    // 规则上限 max(0, Y₁ + G) ÷ 每币风险 = 53.93，不随 K_B 变
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('53.93');
    // 计划加仓 = 38.33 + 7.2 = 45.53
    expect(screen.getByTestId('add-sizing-planned-add')).toHaveTextContent('45.53');
    // 对冲必须扛起全部实际仓位：18.33 + 45.53 = 63.87，不能藏起来只剩 A 的 56.67
    expect(screen.getByTestId('add-sizing-total-hedge-hero')).toHaveTextContent('63.87');
    expect(screen.getByTestId('add-sizing-total-hedge')).toHaveTextContent('63.87');
    expect(screen.getByTestId('add-sizing-r0-pass')).toHaveTextContent('仍剩 0.6462 RAVE');
  });

  it('【回归】K_B 落在 S₁ 与 S₂ 之间：在 S₁ 超支落袋，标签按敞口说「超支」，不说零风险', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    type('add-sizing-kb', '135');
    expect(screen.getByTestId('add-sizing-kb-out')).toHaveTextContent('超支');
    expect(screen.getByTestId('add-sizing-kb-out')).not.toHaveTextContent('不低于 S₁');
    expect(screen.getByTestId('add-sizing-x2b-out')).not.toHaveTextContent('零风险');
    // 上限照旧 53.93；计划加仓 38.33 + 1.2×135/5 = 70.73，红字标出超出
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('53.93');
    expect(screen.getByTestId('add-sizing-planned-add')).toHaveTextContent('70.73');
    expect(screen.getByTestId('add-sizing-planned-add')).toHaveTextContent('超出上限');
    expect(screen.getByTestId('add-sizing-r0-violation')).toBeInTheDocument();
  });

  it('【回归】G 自动带入而 S₁ 还空着：提示缺 S₁，而不是让人去填可选的 K_B', () => {
    renderCalc();
    type('add-sizing-g', '1.2');
    expect(screen.getByTestId('add-sizing-banked-problem')).toHaveTextContent('填入 S₁ 后计算');
    expect(screen.getByTestId('add-sizing-banked-problem')).not.toHaveTextContent('K_B');
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
    expect(panel).toHaveTextContent('Plan B 加仓上限 X_add,max = max(0, Y₁ + G) ÷ 每币风险');
    expect(panel).toHaveTextContent('X₂ᴬ = Y₁ ÷ 险');
    // 币本位不照抄 U 本位：G 以币计，按 S₁ 折算
    expect(panel).toHaveTextContent('币本位 G·S₁ ÷ 险');
    expect(panel).toHaveTextContent('每币风险 = 险 ÷ S₁');
    expect(panel).toHaveTextContent('对冲 @ S₁ = X₁ + X_add');
    expect(panel).not.toHaveTextContent('X₁ + X₂ + X_G');
    expect(within(panel).getByRole('link')).toHaveAttribute('href', '/guide#s3-1c');
  });
});

describe('R0 复核 —— AIOTUSDT 学费单要求的那一块', () => {
  /**
   * AIOTUSDT 2025-05-03:合法上限 4.26M 币,实际加 20.07M(4.71×),亏 25.4 万。
   * 数学层没错;错在 evaluatePostAddCostLine 一直是死代码,界面从不喊「越界」。
   * 这里钉住:合规时给通过语,超量时给红色横幅 + 缺口金额。
   */
  it('Plan B 按上限走 → R0 通过', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    // K_B 默认 = S₁,B 在 S₁ 恰好花光 → 无缺口
    expect(screen.getByTestId('add-sizing-r0-pass')).toBeInTheDocument();
    expect(screen.queryByTestId('add-sizing-r0-violation')).toBeNull();
    expect(screen.getByTestId('add-sizing-r0')).toHaveTextContent('R0 复核');
  });

  it('【回归】定仓旋钮输入超量 → 红色横幅 + 缺口 + 超出倍数', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    // 切到定仓,输入 3 倍于上限(上限 15.6):46.8 币
    fireEvent.click(screen.getByTestId('add-sizing-knob-size'));
    type('add-sizing-x2b', '46.8');
    const banner = screen.getByTestId('add-sizing-r0-violation');
    expect(banner).toHaveTextContent('R0 非法');
    expect(banner).toHaveTextContent('由本金支付');
    // 预算是 Y₁ + G，不是 G 一家：亏损 85.13×10/130 = 6.5487 币 vs 可用 2.9487 + 1.2 = 4.1487 币
    expect(banner).toHaveTextContent('旧仓净垫 Y₁ + 落袋 G');
    expect(banner).toHaveTextContent('2.4 RAVE');       // 缺口 = 6.5487 − 4.1487
    expect(banner).toHaveTextContent('158%');           // 亏损 ÷ 可用垫，而不是 B 腿敞口的 300%
    expect(banner).toHaveTextContent('多 31.2 RAVE');   // 计划 85.13 − 上限 53.93
    expect(banner).not.toHaveTextContent('300%');
    // 表头不许一边说「由落袋覆盖」一边报非法
    expect(screen.getByTestId('add-sizing-r0')).not.toHaveTextContent('覆盖');
    // 头条「上限」不跟着定仓值跑
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('53.93');
    expect(screen.getByTestId('add-sizing-planned-add')).toHaveTextContent('85.13');
    // B 腿 X_G 46.8 不许再贴「零风险」和张数
    expect(screen.getByTestId('add-sizing-x2b-out')).not.toHaveTextContent('零风险');
    expect(screen.getByTestId('add-sizing-x2b-out')).not.toHaveTextContent('张');
    expect(screen.queryByTestId('add-sizing-r0-pass')).toBeNull();
  });

  it('【回归】G > 0 且 R0 通过时，成本线越过 S₁ 才注明「由已落袋 G 覆盖」', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    expect(screen.getByTestId('add-sizing-r0')).toHaveTextContent('由已落袋 G 覆盖');
  });

  it('B 关闭时(纯 A)恒为通过——A 的定义就是在 S₁ 打平', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    expect(screen.getByTestId('add-sizing-r0-pass')).toBeInTheDocument();
    expect(screen.getByTestId('add-sizing-r0-pass')).toHaveTextContent('旧仓浮盈垫覆盖本次加仓');
  });

  it('S₁ 未填时不出 R0 块——没有可复核的对象', () => {
    renderCalc();
    expect(screen.queryByTestId('add-sizing-r0')).toBeNull();
  });
});

describe('B 本账建议值按操作时间框定本场', () => {
  afterEach(() => { scene.positions = null; scene.tradeHistory = null; });

  /**
   * 同一段历史重放了两遍：上一遍在模拟时刻 3_000 落袋 +0.8 RAVE，这一遍同一模拟时刻落袋 +1.2 RAVE。
   * 模拟时间完全撞车，只有真实时钟分得开——上一遍的止盈操作时间早于这一遍主力开仓。
   */
  const R0 = Date.parse('2026-09-10T08:00:00Z');
  const stampedPositions: Position[] = positions.map((p, i) => ({ ...p, openedRealAt: R0 + i * 60_000 }));
  const replayHistory: TradeRecord[] = [
    { ...tradeHistory[0], closedRealAt: R0 + 10 * 60_000 },
    { ...tradeHistory[0], id: 'other-replay', pnl: 100, pnlCoin: 0.8, closedRealAt: R0 - 86_400_000 },
    tradeHistory[1],
  ];

  it('【回归】另一次重放的止盈不进一键填入，按钮旁小字注明排除了几笔', () => {
    scene.positions = stampedPositions;
    scene.tradeHistory = replayHistory;
    renderCalc();
    const fill = screen.getByTestId('add-sizing-fill-banked');
    expect(fill).toHaveTextContent('+1.2');
    expect(fill).toHaveTextContent('（1 笔止盈）');
    // 操作时间完整且已确认属于当前持仓周期：打开即默认进入 Plan B，不再要求额外点一次。
    expect(num('add-sizing-g')).toBeCloseTo(1.2, 6);
    expect(screen.getByTestId('add-sizing-banked-excluded'))
      .toHaveTextContent('1 笔止盈的操作时间早于当前持仓开仓（或缺失），未计入');
    fireEvent.click(fill);
    expect(num('add-sizing-g')).toBeCloseTo(1.2, 6);
  });

  it('老持仓没有真实开仓时刻：照旧只看模拟时间，不出排除小字', () => {
    renderCalc();
    expect(screen.getByTestId('add-sizing-fill-banked')).toHaveTextContent('1 笔');
    // 旧数据无法用操作时间消歧，只给建议，不自动代入。
    expect(num('add-sizing-g')).toBe(0);
    expect(screen.queryByTestId('add-sizing-banked-excluded')).not.toBeInTheDocument();
  });

  it('【回归】老腿没有真实时刻、新加那腿有：起点未知，本场止盈照填、不误报排除，加仓提醒照出', () => {
    // p1 是 9-07 之前开的老腿；止盈在 R0 前一小时落袋；p2 在 R0 加仓。
    // 只取有时间戳的最小值会把起点定在 R0，本场这笔止盈反被当成别的重放排除。
    scene.positions = [positions[0], { ...positions[1], openedRealAt: R0 }];
    scene.tradeHistory = [{ ...tradeHistory[0], closedRealAt: R0 - 3_600_000 }, tradeHistory[1]];
    renderCalc();
    type('add-sizing-s1', '130');
    const fill = screen.getByTestId('add-sizing-fill-banked');
    expect(fill).toHaveTextContent('+1.2');
    expect(fill).toHaveTextContent('（1 笔止盈）');
    expect(screen.queryByTestId('add-sizing-banked-excluded')).not.toBeInTheDocument();
    fireEvent.click(fill);
    expect(num('add-sizing-g')).toBeCloseTo(1.2, 6);
    expect(screen.getByTestId('add-sizing-banked-spent')).toHaveTextContent('1');
  });

  it('【回归】本轮亏损多于止盈：负净额照样带入并照扣，不退回 Plan A（与 Legs 校验同值）', () => {
    // 止盈 +1.2 RAVE 之后，同一轮又止损实现 −2.4 RAVE：G = −1.2
    scene.positions = stampedPositions;
    scene.tradeHistory = [
      { ...tradeHistory[0], closedRealAt: R0 + 10 * 60_000 },
      { ...tradeHistory[0], id: 'loss', exit_method: 'sl', pnl: -300, pnlCoin: -2.4, closeTime: 3_500, closedRealAt: R0 + 20 * 60_000 } as TradeRecord,
    ];
    renderCalc();
    const fill = screen.getByTestId('add-sizing-fill-banked');
    expect(fill).toHaveTextContent('−1.2');
    expect(fill).toHaveTextContent('（1 笔止盈）');
    expect(num('add-sizing-g')).toBeCloseTo(-1.2, 6);
    type('add-sizing-s1', '130');
    expect(screen.queryByTestId('add-sizing-banked-off')).not.toBeInTheDocument();
    // (2.9487 − 1.2) × 130 ÷ 10 = 22.73，而不是 Plan A 的 38.33
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('22.73');
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('落袋垫 -15.6');
    expect(screen.getByTestId('add-sizing-total-hedge-hero')).toHaveTextContent('41.07');   // 18.33 + 22.73
    // Plan A 降为拆解，不再以 38.33 的大字当上限
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('仅 A');
    // 负 G 没有 B 腿可拧
    expect(screen.queryByTestId('add-sizing-knob-line')).not.toBeInTheDocument();
    expect(screen.queryByTestId('add-sizing-x2b-out')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-sizing-r0-pass')).toBeInTheDocument();
  });

  it('【回归】只有亏损、还没有止盈：G 为负照样提示，手填同值结果一致', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '-1.2');
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('22.73');
    expect(screen.queryByTestId('add-sizing-banked-off')).not.toBeInTheDocument();
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


describe('盘口对冲线与 S₁ 偏差', () => {
  afterEach(() => { book.orders = {}; });

  const hedgeOrder = (over: Record<string, unknown> = {}) => ({
    id: 'h1', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 130,
    quantity: 500, contracts: 500, contractSizeUsd: 10, settlementMode: 'coin',
    leverage: 5, marginMode: 'isolated', status: 'PENDING', createdAt: 1_500,
    ...over,
  });

  it('盘口没有对冲单时，S₁ 仍然留给人——不预填、不出现盘口区块', () => {
    renderCalc();
    expect((screen.getByTestId('add-sizing-s1') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('add-sizing-book-lines')).not.toBeInTheDocument();
  });

  it('盘口有对冲单时只摆候选芯片，绝不自动填进 S₁', () => {
    book.orders = { RAVEUSDT: [hedgeOrder()] };
    renderCalc();
    expect(screen.getByTestId('add-sizing-book-line')).toHaveTextContent('130');
    // 关键：仍然留空。系统分不出「对冲单」与「试单」，不许替用户做决定。
    expect((screen.getByTestId('add-sizing-s1') as HTMLInputElement).value).toBe('');
  });

  it('点候选芯片才把线填进 S₁', () => {
    book.orders = { RAVEUSDT: [hedgeOrder()] };
    renderCalc();
    fireEvent.click(screen.getByTestId('add-sizing-book-line'));
    expect(num('add-sizing-s1')).toBe(130);
    expect(screen.queryByTestId('add-sizing-s1-deviation')).not.toBeInTheDocument();
  });

  it('【回归】S₁ 与盘口线不一致 → 按 USDT 明码标出代价，并给一键改正', () => {
    // 这正是 SCRTUSDT 那场的形状：填的线与盘口挂着的线不是同一条。
    book.orders = { RAVEUSDT: [hedgeOrder({ stopPrice: 128 })] };
    renderCalc();
    type('add-sizing-s1', '130');            // 填 130，盘口挂的是 128
    const warn = screen.getByTestId('add-sizing-s1-deviation');
    expect(warn).toHaveTextContent('不是同一条线');
    expect(warn).toHaveTextContent('128');
    expect(warn).toHaveTextContent('锁死本应是 0');

    fireEvent.click(screen.getByTestId('add-sizing-use-book-line'));
    expect(num('add-sizing-s1')).toBe(128);
    expect(screen.queryByTestId('add-sizing-s1-deviation')).not.toBeInTheDocument();
  });

  it('B 开着时「合计对冲」升为 Hero，A 段降为「仅 A」芯片，但仍以芯片给出 A 自己的合计对冲', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    expect(screen.queryByTestId('add-sizing-total-hedge-hero')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('加仓上限 X₂');

    type('add-sizing-g', '1.2');
    // 真正该挂的量必须和合计加仓一样醒目，而不是躺在底部小字里
    expect(screen.getByTestId('add-sizing-total-hedge-hero')).toHaveTextContent('72.27');
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('仅 A');
    // 大字只许有一个对冲量——A 的 56.67 不再以 Hero 出现……
    expect(screen.queryByTestId('add-sizing-hedge')).not.toBeInTheDocument();
    // ……但【用户要求】A 也要有合计：X₁ + X₂ᴬ = 18.33 + 38.33 = 56.67，带张数，标明「仅 A」，供与 Plan B 并排比较
    const hedgeA = screen.getByTestId('add-sizing-hedge-a');
    expect(hedgeA).toHaveTextContent('56.67');
    expect(hedgeA).toHaveTextContent('仅 A');
    expect(hedgeA).toHaveTextContent('X₁ + X₂ᴬ');
    expect(hedgeA).toHaveTextContent('张');
  });

  it('【回归】多条盘口线：偏差按亏损侧离 S₂ 最近的那条比对——与 Legs 校验读 S₁ 同一规则', () => {
    book.orders = { RAVEUSDT: [hedgeOrder({ id: 'far', stopPrice: 125 }), hedgeOrder({ id: 'near', stopPrice: 130 })] };
    renderCalc();
    // 候选芯片也按「先被打到」排：130 在前
    expect(screen.getAllByTestId('add-sizing-book-line')[0]).toHaveTextContent('130');
    type('add-sizing-s1', '130');
    expect(screen.queryByTestId('add-sizing-s1-deviation')).not.toBeInTheDocument();
    type('add-sizing-s1', '125');
    expect(screen.getByTestId('add-sizing-s1-deviation')).toHaveTextContent('130');
  });

  it('【回归】盘口线上连 Y₁ + G 都 ≤ 0：「应 0」，并说明没有加仓额度，而不是「锁死本应是 0」', () => {
    book.orders = { RAVEUSDT: [hedgeOrder({ stopPrice: 98 })] };
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    const warn = screen.getByTestId('add-sizing-s1-deviation');
    expect(warn).toHaveTextContent('（应 0）');
    expect(warn).toHaveTextContent('多下 53.93 RAVE');
    expect(warn).toHaveTextContent('没有加仓额度');
    expect(warn).toHaveTextContent('-85.73 USD');
    expect(warn).not.toHaveTextContent('锁死本应是 0');
    expect(warn).not.toHaveTextContent('应 -');
  });

  it('S₁ 还没填时不算「A 拒绝」——B 段照常在，别把「没填」和「填了但不成立」混为一谈', () => {
    // S₁ 默认留空（那一格刻意留给人判断）。若把 invalid_input 也当成拒绝，
    // 一进对话框 B 段就整个消失，用户连 G 都没处填。
    renderCalc();
    expect(screen.queryByTestId('add-sizing-banked-blocked')).not.toBeInTheDocument();
    expect(screen.getByTestId('add-sizing-g')).toBeInTheDocument();
  });
});

describe('R0 复核 · 两套算法对账', () => {
  afterEach(() => { r0Seam.costLineMismatch = false; scene.positions = null; });

  it('通过时并排给出三条路线的读数，并注明两种算法一致', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    const routes = screen.getByTestId('add-sizing-r0-routes');
    expect(routes).toHaveTextContent('垫子式 缺口 0 RAVE');
    expect(routes).toHaveTextContent('成本线式 缺口 0 RAVE');
    // 逐笔重算：X₁′ 就是两腿相加的 18.3333，Y₁′ 与手填算得的 Y₁ 一致
    expect(routes).toHaveTextContent('逐笔 X₁′ 18.3333');
    expect(routes).toHaveTextContent('一致');
    expect(routes).not.toHaveTextContent('不符');
    expect(screen.getByTestId('add-sizing-r0-pass')).toHaveTextContent('两种算法一致');
    expect(screen.queryByTestId('add-sizing-r0-mismatch')).toBeNull();
  });

  it('【回归】手填的 X₁ 不是当前这批腿的（SCRT 那类错误）：逐笔重算不符 → 自检不一致，绝不说通过', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-x1', '30');
    const banner = screen.getByTestId('add-sizing-r0-mismatch');
    expect(banner).toHaveTextContent('自检不一致');
    expect(banner).toHaveTextContent('手填 X₁ 30');
    expect(banner).toHaveTextContent('X₁′ 18.3333');
    // X₁ 差了六成：像是取错了腿集，才把这个原因说出口
    expect(banner).toHaveTextContent('与当前持仓逐笔重算不符');
    expect(banner).toHaveTextContent('可能取自别的腿集');
    expect(screen.getByTestId('add-sizing-r0-routes')).toHaveTextContent('不符');
    expect(screen.queryByTestId('add-sizing-r0-pass')).toBeNull();
    expect(screen.queryByTestId('add-sizing-r0-violation')).toBeNull();
    expect(screen.getByTestId('add-sizing-r0')).not.toHaveTextContent('通过');
    // 表头也不许说「由已落袋 G 覆盖」
    expect(screen.getByTestId('add-sizing-r0')).not.toHaveTextContent('覆盖');
  });

  it('S̄ 只取了头仓那一笔的价：X₁ 对得上、Y₁ 对不上，同样是不一致', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-sbar', '100');
    const banner = screen.getByTestId('add-sizing-r0-mismatch');
    expect(banner).toHaveTextContent('Y₁′ +2.9487 RAVE');
    expect(screen.queryByTestId('add-sizing-r0-pass')).toBeNull();
  });

  it('X₁ 只差千分之几（手误 18.334）：照样不一致、不说通过，但只说「不符」，不断言是别的腿集', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-x1', '18.334');
    const banner = screen.getByTestId('add-sizing-r0-mismatch');
    expect(banner).toHaveTextContent('与当前持仓逐笔重算不符');
    expect(banner).not.toHaveTextContent('别的腿集');
    expect(screen.queryByTestId('add-sizing-r0-pass')).toBeNull();
    expect(screen.getByTestId('add-sizing-r0')).not.toHaveTextContent('通过');
  });

  it('【回归】主空战役带多头对冲腿：切到主空后逐笔式拿空头那批腿比，多头种下的 X₁ / S̄ 必须被抓出来', () => {
    // 多头 100 张 @100（10 币）是对冲腿；空头 100 张 @150（6.6667 币）才是主空这一侧的持仓
    scene.positions = [positions[0], { ...positions[0], id: 'p3', side: 'SHORT', entryPrice: 150, quantity: 6.67, openTime: 3_000 }];
    renderCalc();
    // 打开时 pickHeldSide 先看多头：X₁ = 10 / S̄ = 100 从对冲腿种下；切到主空后仍留在框里
    fireEvent.click(screen.getByTestId('add-sizing-side-toggle'));
    fireEvent.click(screen.getByTestId('add-sizing-side-SHORT'));
    type('add-sizing-s1', '90');
    type('add-sizing-s2', '80');
    expect(num('add-sizing-x1')).toBe(10);
    const routes = screen.getByTestId('add-sizing-r0-routes');
    expect(routes).toHaveTextContent('X₁′ 6.6667');
    expect(routes).toHaveTextContent('不符');
    expect(screen.getByTestId('add-sizing-r0-mismatch')).toHaveTextContent('自检不一致');
    expect(screen.queryByTestId('add-sizing-r0-pass')).toBeNull();
    expect(screen.getByTestId('add-sizing-r0')).not.toHaveTextContent('通过');
  });

  it('切到没有持仓腿的那一侧：逐笔式没有对象，通过语明说未做逐笔核对', () => {
    renderCalc();
    fireEvent.click(screen.getByTestId('add-sizing-side-toggle'));
    fireEvent.click(screen.getByTestId('add-sizing-side-SHORT'));
    type('add-sizing-s1', '105');
    type('add-sizing-s2', '95');
    expect(screen.getByTestId('add-sizing-r0-routes')).toHaveTextContent('逐笔 —');
    const pass = screen.getByTestId('add-sizing-r0-pass');
    expect(pass).toHaveTextContent('两种算法一致');
    expect(pass).toHaveTextContent('未做逐笔核对');
    expect(screen.queryByTestId('add-sizing-r0-mismatch')).toBeNull();
  });

  it('两种算法对不上时同样只报不一致，把两个缺口都摆出来', () => {
    r0Seam.costLineMismatch = true;
    renderCalc();
    type('add-sizing-s1', '130');
    const banner = screen.getByTestId('add-sizing-r0-mismatch');
    expect(banner).toHaveTextContent('垫子式缺口 0 RAVE 与成本线式缺口 1 RAVE 对不上');
    expect(screen.queryByTestId('add-sizing-r0-pass')).toBeNull();
    expect(screen.queryByTestId('add-sizing-r0-violation')).toBeNull();
    expect(screen.getByTestId('add-sizing-r0')).not.toHaveTextContent('通过');
  });

  it('超量仍是红色「R0 非法」，两条路线各自算出同一个缺口，不会被自检替代', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    fireEvent.click(screen.getByTestId('add-sizing-knob-size'));
    type('add-sizing-x2b', '46.8');
    expect(screen.getByTestId('add-sizing-r0-violation')).toHaveTextContent('R0 非法');
    expect(screen.queryByTestId('add-sizing-r0-mismatch')).toBeNull();
    expect(screen.getByTestId('add-sizing-r0-routes')).toHaveTextContent('垫子式 缺口 2.4 RAVE · 成本线式 缺口 2.4 RAVE');
  });

  it('G 为负时同样对账：两条路都在 S₁ 安全侧扣掉负 G，通过', () => {
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '-1.2');
    expect(screen.getByTestId('add-sizing-r0-pass')).toHaveTextContent('两种算法一致');
    expect(screen.getByTestId('add-sizing-r0-routes')).toHaveTextContent('成本线式 缺口 0 RAVE');
    expect(screen.getByTestId('add-sizing-r0')).toHaveTextContent('落在 S₁ 安全侧');
  });
});

describe('结算口径跟被加仓的仓位走，不跟下单面板', () => {
  afterEach(() => { scene.positions = null; scene.tradeHistory = null; panel.mode = 'coin'; });

  /** U 本位多头一腿：20 币 @100（X₁ = 20，S̄ = 100）；本场止盈1 落袋 +150 USD。 */
  const usdtPositions: Position[] = [
    { id: 'u1', side: 'LONG', entryPrice: 100, quantity: 20, leverage: 5, marginMode: 'isolated', settlementMode: 'usdt', margin: 400, openTime: 1_000 },
  ];
  const usdtHistory: TradeRecord[] = [{ ...tradeHistory[0], settlementMode: 'usdt', pnlCoin: undefined } as TradeRecord];

  it('【回归】刷新后面板回到币本位，持有的却是 U 本位仓位：G 以 USD 计、X₂ᴮ 按 U 本位算、不给张数', () => {
    // 面板每次打开都回到币本位；仓位自己带的 settlementMode 才是它所在的合约
    scene.positions = usdtPositions;
    scene.tradeHistory = usdtHistory;
    panel.mode = 'coin';
    renderCalc();
    expect(num('add-sizing-x1')).toBe(20);
    expect(screen.getByText('G 落袋净额 USD')).toBeInTheDocument();
    type('add-sizing-s1', '130');
    // 垫 20 × 30 = 600 USD，险 10 → X₂ = 60；U 本位不附带张数
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('60');
    expect(screen.getByTestId('add-sizing-x2')).not.toHaveTextContent('张');
    // 本场落袋按 USD 建议：150，不是折成币的 1.2
    const fill = screen.getByTestId('add-sizing-fill-banked');
    expect(fill).toHaveTextContent('150');
    fireEvent.click(fill);
    expect(num('add-sizing-g')).toBe(150);
    // K_B = S₁：U 本位 X₂ᴮ = G ÷ (S₂ − K_B) = 150 ÷ 10 = 15；误按币本位会是 G·K_B ÷ 险 = 1,950
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('15');
    expect(screen.getByTestId('add-sizing-x2b-out')).not.toHaveTextContent('1,950');
  });

  it('会话内把面板切到 U 本位，持有的仍是币本位仓位：口径照旧是币', () => {
    panel.mode = 'usdt';
    renderCalc();
    expect(screen.getByText('G 落袋净额 RAVE')).toBeInTheDocument();
    type('add-sizing-s1', '130');
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('张');
  });

  it('缺 settlementMode 的老仓位按 U 本位解读——与引擎折币和历史记录同一口径', () => {
    scene.positions = [{ ...usdtPositions[0], settlementMode: undefined }];
    renderCalc();
    expect(screen.getByText('G 落袋净额 USD')).toBeInTheDocument();
  });

  it('空仓预演没有仓位可依，才退回面板当前的结算方式', () => {
    scene.positions = [];
    const { unmount } = renderCalc();
    expect(screen.getByText('G 落袋净额 RAVE')).toBeInTheDocument();
    unmount();
    panel.mode = 'usdt';
    renderCalc();
    expect(screen.getByText('G 落袋净额 USD')).toBeInTheDocument();
  });
});
