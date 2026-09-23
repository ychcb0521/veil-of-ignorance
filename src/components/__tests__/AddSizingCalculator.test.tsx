import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddSizingCalculator } from '@/components/AddSizingCalculator';
import { SessionModeControls } from '@/components/SessionModeControls';
import { computePlanBCoverageAtS1, evaluatePostFillAddSizing, sizeAddAtExpectedFill } from '@/lib/addSizing';
import { ADD_SIZING_PLAN_TTL_MS, __resetAddSizingPlanForTests, consumeAddSizingPrefill, getAddSizingPlan } from '@/lib/addSizingPlan';
import { calcSlippage, type Position, type TradeRecord } from '@/types/trading';

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
const panel = vi.hoisted(() => ({ mode: 'coin' as 'coin' | 'usdt', leverageMap: {} as Record<string, number> }));

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
      leverageMap: panel.leverageMap,
    }),
  };
});

/** R0 自检注入口：垫子式与成本线式在数学上恒等，走正门造不出分歧；要测「对不上就不说通过」只能从外面把结论改坏。 */
const r0Seam = vi.hoisted(() => ({ costLineMismatch: false }));
/** 按预计成交价定量的注入口：打开时 sizeAddAtExpectedFill 返回 null（没有 fillPlan，Plan A 退回自己的代数）。 */
const fillSeam = vi.hoisted(() => ({ none: false }));
vi.mock('@/lib/addSizing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/addSizing')>('@/lib/addSizing');
  return {
    ...actual,
    sizeAddAtExpectedFill: (input: Parameters<typeof actual.sizeAddAtExpectedFill>[0]) =>
      (fillSeam.none ? null : actual.sizeAddAtExpectedFill(input)),
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

/**
 * 分层余量注入口：上面这几十条钉的是 Plan A / Plan B 的代数，盘面（RAVEUSDT、BTC 1,000 万名义……）远超各自的币安分层，
 * 按真实分层一算可下单量全被卡成 0。默认关掉（addTierHeadroom 返回 null = 不另设限，与算不出分层时一致）；
 * 「分层上限封顶可下单量」那一组显式打开，走真实分层。
 */
const tierSeam = vi.hoisted(() => ({ real: false }));
vi.mock('@/lib/addTierHeadroom', async () => {
  const actual = await vi.importActual<typeof import('@/lib/addTierHeadroom')>('@/lib/addTierHeadroom');
  return {
    ...actual,
    addTierHeadroom: (input: Parameters<typeof actual.addTierHeadroom>[0]) => (tierSeam.real ? actual.addTierHeadroom(input) : null),
  };
});

/**
 * 计划仓库是模块级的，而计算器打开时会从仍在保鲜期的计划种回 S₁ / G：
 * 上一条测试发布的计划不清掉，下一条一打开就带着它的 S₁。每条测试从空仓库开始。
 */
beforeEach(() => { __resetAddSizingPlanForTests(); tierSeam.real = false; });

const num = (testId: string) => Number((screen.getByTestId(testId) as HTMLInputElement).value);
const type = (testId: string, v: string) => fireEvent.change(screen.getByTestId(testId), { target: { value: v } });

/**
 * 默认按**限价 @S₂** 渲染：下面这几十条测试钉的是 Plan A / Plan B 的代数（38.33、53.93……），
 * 而计算器默认档是市价——所有派生量按含滑点的预计成交价 S₂′ 算，同一批输入会给出 38.28 / 53.86。
 * 市价档的行为在「按预计成交价定量」那一组里单独钉；这里切到限价，让 S₂′ = S₂，代数测试原样成立。
 */
function renderCalc(currentPrice = 140, opts: { market?: boolean; fillBasePrice?: number; pricePrecision?: number } = {}) {
  const out = render(
    <MemoryRouter>
      <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={currentPrice} fillBasePrice={opts.fillBasePrice}
        pricePrecision={opts.pricePrecision} />
    </MemoryRouter>,
  );
  if (!opts.market) fireEvent.click(screen.getByTestId('add-sizing-order-kind-limit'));
  return out;
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

/**
 * COMMONUSDT 那一场：用户严格按计算器上限下单，Legs 校验仍判超限 1.57% / 3.70%。
 * 两边规则、G、S₁ 全部一致，只差 S₂——计算器读的是下单前的盘面价，
 * 市价单在引擎里按 calcSlippage（0.01% + 名义/50亿）成交，Legs 读的是成交价，
 * 上限对 S₂ 的弹性 S₁/(S₂−S₁) ≈ 十几倍。这里钉住：默认市价档按预计成交价 S₂′ 定量。
 */
describe('按预计成交价定量（市价 / 限价）', () => {
  afterEach(() => { scene.positions = null; scene.tradeHistory = null; });

  it('默认市价：两条价格线（现价 S₂ → 预计成交 S₂′ 含滑点 %），X₂ 与张数按 S₂′ 算、张数向下取整', () => {
    renderCalc(140, { market: true });
    const kind = screen.getByTestId('add-sizing-order-kind');
    expect(within(kind).getByTestId('add-sizing-order-kind-market')).toHaveAttribute('aria-pressed', 'true');
    type('add-sizing-s1', '130');
    // Y₁ = 18.3333 × (130 − 109.09091) = 383.33 USD → 无滑点上限 38.33 币、名义 5,367 USD →
    // 滑点率 0.0001 + 5,367/5e9 = 0.0101% → S₂′ = 140.0142 → 险 10.0142 → X₂ = 38.28（上限与 S₂′ 一起由二分解出）
    const line = screen.getByTestId('add-sizing-fill-price');
    expect(line).toHaveTextContent('现价 S₂ 140.0000');
    expect(line).toHaveTextContent('预计成交 S₂′ 140.0142');
    expect(line).toHaveTextContent('(+0.01%)');
    const x2 = screen.getByTestId('add-sizing-x2');
    expect(x2).toHaveTextContent('38.28');
    expect(x2).not.toHaveTextContent('38.33');
    // 38.279 × 140.0142 ÷ 10 = 535.96 张 → 向下取整 535，不进一（旧版四舍五入会给 537）
    expect(x2).toHaveTextContent('535 张');
    expect(x2).not.toHaveTextContent('536 张');
    expect(x2).not.toHaveTextContent('537 张');
    // 对冲量跟着 S₂′ 的上限走：18.33 + 38.28 = 56.61
    expect(screen.getByTestId('add-sizing-hedge')).toHaveTextContent('56.61');
    // 敏感度按 S₂″ = S₂′ × 1.001 精确重算：38.279 × (1 − 10.0142 ÷ 10.1542) = 0.528 币 ≈ 7 张
    // （一阶式 X · 0.001 · S₂′ ÷ 险 给 0.535，止损越近偏得越多）；倍数 130 ÷ 10.0142 ≈ 13.0×
    const sens = screen.getByTestId('add-sizing-sensitivity');
    expect(sens).toHaveTextContent('成交每不利 0.1%，上限少约 0.53 RAVE（7 张）');
    expect(sens).toHaveTextContent('13.0×');
    // 阶梯上的第三个刻度写成 S₂′，提醒这是成交价不是盘面价
    expect(screen.getByTestId('add-sizing-ladder')).toHaveTextContent('S₂′');
  });

  it('切到限价 @S₂：S₂′ = S₂、不计滑点，X₂ 回到无滑点代数 38.33，张数仍向下取整 536', () => {
    renderCalc(140, { market: true });
    type('add-sizing-s1', '130');
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-limit'));
    const line = screen.getByTestId('add-sizing-fill-price');
    expect(line).toHaveTextContent('预计成交 S₂′ 140.0000');
    expect(line).toHaveTextContent('限价 · 不计滑点');
    expect(line).not.toHaveTextContent('%');
    const x2 = screen.getByTestId('add-sizing-x2');
    expect(x2).toHaveTextContent('38.33');
    expect(x2).toHaveTextContent('536 张');
    expect(screen.getByTestId('add-sizing-ladder')).not.toHaveTextContent('S₂′');
    // 切回市价又按 S₂′ 算
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-market'));
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('38.28');
  });

  it('G ≠ 0 时 Plan B 上限、张数、合计对冲与 R0 复核全部按 S₂′：53.86 而不是 53.93', () => {
    renderCalc(140, { market: true });
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    // 可用垫 2.9487 + 1.2 = 4.1487 RAVE → 名义 ≈ 7,540 USD → S₂′ = 140.0142 → 4.1487 × 130 ÷ 10.0142 = 53.86
    const total = screen.getByTestId('add-sizing-total-add');
    expect(total).toHaveTextContent('53.86');
    expect(total).not.toHaveTextContent('53.93');
    expect(total).toHaveTextContent('754 张');   // 53.857 × 140.0142 ÷ 10 = 754.07 → 754
    expect(screen.getByTestId('add-sizing-total-hedge-hero')).toHaveTextContent('72.19');   // 18.33 + 53.86
    // 取满 S₂′ 上限的 R0 仍通过——上限与复核吃的是同一个 S₂′
    expect(screen.getByTestId('add-sizing-r0-pass')).toBeInTheDocument();
  });

  it('S₂ 从引擎成交基准价种下（不是显示价），弹窗开着时跟着走；市价档手填离基准价一格以上 → 自动切限价并锁住，复位回到市价并重新跟随', () => {
    const view = renderCalc(140, { market: true, fillBasePrice: 141 });
    expect(num('add-sizing-s2')).toBe(141);
    const rerender = (fillBasePrice: number) => view.rerender(
      <MemoryRouter>
        <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={140} fillBasePrice={fillBasePrice} />
      </MemoryRouter>,
    );
    const pressed = (k: 'market' | 'limit') => screen.getByTestId(`add-sizing-order-kind-${k}`).getAttribute('aria-pressed');
    rerender(142);
    expect(num('add-sizing-s2')).toBe(142);
    expect(screen.getByTestId('add-sizing-fill-price')).toHaveTextContent('现价 S₂ 142.0000');
    expect(screen.queryByTestId('add-sizing-s2-limit-note')).toBeNull();
    type('add-sizing-s2', '150');
    // 市价单只能在基准价上成交：手填的 150 只能是一张限价单
    expect(pressed('limit')).toBe('true');
    // 手填的价也可能是突破加仓的触发价：说明里两种都点到，并给一键改成条件单
    const note = screen.getByTestId('add-sizing-s2-limit-note');
    expect(note).toHaveTextContent('手填 S₂ 只能按限价或条件单成交，已切到限价 @S₂；点复位回到市价');
    expect(within(note).getByTestId('add-sizing-s2-to-conditional')).toHaveTextContent('突破加仓改按条件单');
    rerender(143);
    expect(num('add-sizing-s2')).toBe(150);
    // 手填的价不再叫「现价」
    expect(screen.getByTestId('add-sizing-fill-price')).toHaveTextContent('手填 S₂ 150.0000（已锁定，不跟盘面）');
    expect(screen.getByTestId('add-sizing-fill-price')).not.toHaveTextContent('现价 S₂ 150');
    fireEvent.click(screen.getByLabelText('S₂ 加仓价 复位'));
    expect(num('add-sizing-s2')).toBe(143);
    expect(pressed('market')).toBe('true');
    expect(screen.queryByTestId('add-sizing-s2-limit-note')).toBeNull();
    rerender(144);
    expect(num('add-sizing-s2')).toBe(144);
    expect(screen.getByTestId('add-sizing-fill-price')).toHaveTextContent('现价 S₂ 144.0000');
  });

  it('没有成交基准价（老调用方）才退到显示价种 S₂', () => {
    renderCalc(140, { market: true });
    expect(num('add-sizing-s2')).toBe(140);
  });

  it('【回归】COMMONUSDT 加仓1：按现价定量的上限 653,615 张在引擎滑点下超限 1.57%；按 S₂′ 定量给 +0.14% 的成交价与更小的上限', () => {
    // 主力 1,034,640 张 @0.006974（X₁ = 1,483,567,536.56 COMMON）；本场止盈1 落袋 55,994,538.5 COMMON（毛，pnlCoin）
    scene.positions = [{
      id: 'c1', side: 'LONG', entryPrice: 0.006974, quantity: 1_483_567_536.56, leverage: 5, marginMode: 'isolated',
      settlementMode: 'coin', settlementAsset: 'RAVE', contractSizeUsd: 10, contracts: 1_034_640, margin: 2_069_280, openTime: 1_000,
    }];
    scene.tradeHistory = [];
    const s1 = 0.007069;
    const fill = 0.0077123;
    const notional = 6_536_020;
    const ref = fill / (1 + 0.0001 + notional / 5e9);   // 引擎 calcSlippage 反解出的下单前基准价 0.00770146
    // 价格精度给到 10 位：框里的 S₂（8 位有效数字）原样就是挂单价，限价档才能复现那一场不取整的 653,615 张
    renderCalc(0, { market: true, fillBasePrice: ref, pricePrecision: 10 });
    type('add-sizing-s1', String(s1));
    type('add-sizing-g', '55994538.5');

    // 计算器把种下的价整理成 8 位有效数字、X₁ 四位小数——期望值按框里的数算，与界面同源
    const x1 = num('add-sizing-x1');
    const sBar = num('add-sizing-sbar');
    // 框里只留 8 位有效数字；市价档定量用的是基准价本身（市价单只能在它上面成交）
    expect(Math.abs(num('add-sizing-s2') / ref - 1)).toBeLessThan(1e-7);
    const s2Ref = ref;
    const coverage = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar, s1, s2: s2Ref, x1, g: 55_994_538.5 })!.available;
    const expected = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage, s1, s2Ref, orderKind: 'market', contractFaceUsd: 10 })!;
    expect(expected.converged).toBe(true);
    const line = screen.getByTestId('add-sizing-fill-price');
    expect(line).toHaveTextContent(`现价 S₂ ${s2Ref.toPrecision(6)}`);
    expect(line).toHaveTextContent(`预计成交 S₂′ ${expected.s2Fill.toPrecision(6)}`);
    expect(line).toHaveTextContent('(+0.14%)');
    const total = screen.getByTestId('add-sizing-total-add');
    expect(total).toHaveTextContent(expected.addCoinsMax.toLocaleString('en-US', { maximumFractionDigits: 2 }));
    expect(total).toHaveTextContent(`${expected.contracts!.toLocaleString('en-US')} 张`);
    // 那一场按现价算出的 653,615 张不再出现；S₂′ 上限比它小 ≈1.6%，正是 Legs 校验当时报的超限幅度
    expect(total).not.toHaveTextContent('653,615');
    expect(expected.contracts!).toBeLessThan(653_615 * (1 - 0.014));
    expect(expected.contracts!).toBeGreaterThan(653_615 * (1 - 0.018));
    const sens = screen.getByTestId('add-sizing-sensitivity');
    expect(sens).toHaveTextContent('11.0×');   // S₁/(S₂′−S₁) = 0.007069 ÷ 0.000643
    // 张数敏感度按张数自己的弹性 S₁/(S₂′−S₁) 折，≈ 7,0xx 张；不是把币数按 S₂′ 折出来的 7,718 张
    expect(sens).toHaveTextContent(`（${expected.sensitivityContractsPer0_1Pct!.toLocaleString('en-US')} 张）`);
    expect(expected.sensitivityContractsPer0_1Pct!).toBeGreaterThan(6_900);
    expect(expected.sensitivityContractsPer0_1Pct!).toBeLessThan(7_200);
    expect(sens).not.toHaveTextContent('7,718 张');
    expect(screen.getByTestId('add-sizing-r0-pass')).toBeInTheDocument();

    // 限价档给回那一场的数：653,615 张（张数向下取整）
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-limit'));
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('653,615 张');
  });

  it('【回归 · 复审】COMMONUSDT 加仓1 限价档、面板价格精度 6 位：挂单价 0.00770146 多头向下取到 0.007701 再定量；计划与预填的挂单价都是 0.007701', () => {
    __resetAddSizingPlanForTests();
    scene.positions = [{
      id: 'c1', side: 'LONG', entryPrice: 0.006974, quantity: 1_483_567_536.56, leverage: 5, marginMode: 'isolated',
      settlementMode: 'coin', settlementAsset: 'RAVE', contractSizeUsd: 10, contracts: 1_034_640, margin: 2_069_280, openTime: 1_000,
    }];
    scene.tradeHistory = [];
    const ref = 0.0077123 / (1 + 0.0001 + 6_536_020 / 5e9);
    renderCalc(0, { fillBasePrice: ref, pricePrecision: 6 });
    type('add-sizing-s1', '0.007069');
    type('add-sizing-g', '55994538.5');
    const line = screen.getByTestId('add-sizing-fill-price');
    expect(line).toHaveTextContent('预计成交 S₂′ 0.00770100');
    expect(line).toHaveTextContent('挂单价按 6 位小数向下取整');
    const x1 = num('add-sizing-x1');
    const sBar = num('add-sizing-sbar');
    const coverage = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar, s1: 0.007069, s2: 0.007701, x1, g: 55_994_538.5 })!;
    const atRounded = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage: coverage.available, s1: 0.007069, s2Ref: 0.007701, orderKind: 'limit', contractFaceUsd: 10 })!;
    // 取整后险距更大、上限更宽：不会再出现按未取整价算出、挂在更高价上的 653,615 张
    expect(atRounded.contracts!).toBeGreaterThan(653_615);
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent(`${atRounded.contracts!.toLocaleString('en-US')} 张`);
    const snap = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(snap).toMatchObject({ orderKind: 'limit', s2Fill: 0.007701, slippagePct: 0, contracts: atRounded.contracts });
    expect(Math.abs(snap.s2Ref / ref - 1)).toBeLessThan(1e-7);
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    expect(getAddSizingPlan('RAVEUSDT')!.prefill).toMatchObject({ orderType: 'LIMIT', limitPrice: 0.007701, contracts: atRounded.contracts });
    __resetAddSizingPlanForTests();
  });

  it('【回归 · 复审】市价档 S₂ 没越过 S₁（S₁ = S₂，或多头 S₁ 高于 S₂）：报「新腿没有风险距离」，不拿 0.01% 的固定滑点当险距算出巨额上限', () => {
    __resetAddSizingPlanForTests();
    renderCalc(140, { market: true, fillBasePrice: 140 });
    for (const s1 of ['140', '140.01']) {
      type('add-sizing-s1', s1);
      expect(screen.getByTestId('add-sizing-cushion-problem')).toHaveTextContent('新腿没有风险距离');
      expect(screen.queryByTestId('add-sizing-x2')).toBeNull();
      expect(screen.queryByTestId('add-sizing-place-at-limit')).toBeNull();
      expect(screen.queryByTestId('add-sizing-sensitivity')).toBeNull();
      expect(getAddSizingPlan()).toBeNull();
      // S₂′ 那一行照旧只作显示：零名义只含固定的 0.01%
      expect(screen.getByTestId('add-sizing-fill-price')).toHaveTextContent('预计成交 S₂′ 140.0140');
      expect(screen.getByTestId('add-sizing-dialog')).not.toHaveTextContent('40,476');
      expect(screen.getByTestId('add-sizing-dialog')).not.toHaveTextContent('141,712');
    }
    // 开着 G 时 Plan B 一栏同样报缺险距，不给上限
    type('add-sizing-g', '1.2');
    expect(screen.getByTestId('add-sizing-banked-problem')).toHaveTextContent('新腿没有风险距离');
    expect(screen.queryByTestId('add-sizing-total-add')).toBeNull();
    expect(screen.queryByTestId('add-sizing-r0-pass')).toBeNull();
    // 与限价档一致
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-limit'));
    expect(screen.getByTestId('add-sizing-banked-problem')).toHaveTextContent('新腿没有风险距离');
    __resetAddSizingPlanForTests();
  });

  it('【回归 · 复审】市价档 R0 按 S₂′ 复核：计划加仓 53.90 落在 S₂′ 上限 53.86 与 S₂ 上限 53.93 之间 → R0 非法', () => {
    renderCalc(140, { market: true });
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    fireEvent.click(screen.getByTestId('add-sizing-knob-size'));
    type('add-sizing-x2b', '15.62');
    // 计划加仓 = S₂′ 上的旧仓垫折算 38.28 + 15.62 = 53.90
    const planned = screen.getByTestId('add-sizing-planned-add');
    expect(planned).toHaveTextContent('53.9');
    expect(planned).toHaveTextContent('超出上限 0.04 RAVE');
    expect(screen.getByTestId('add-sizing-total-add')).toHaveTextContent('53.86');
    expect(screen.getByTestId('add-sizing-r0-violation')).toBeInTheDocument();
    expect(screen.queryByTestId('add-sizing-r0-pass')).toBeNull();
  });

  it('【回归 · 复审】市价档 X_G 按 S₂′ 折：G × S₁ ÷ (S₂′ − S₁) = 15.58，不是按 S₂ 的 15.6', () => {
    renderCalc(140, { market: true });
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    const xg = screen.getByTestId('add-sizing-x2b-out');
    expect(xg).toHaveTextContent('15.58');
    // 限价档回到无滑点的 15.6
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-limit'));
    expect(screen.getByTestId('add-sizing-x2b-out')).toHaveTextContent('15.6');
    expect(screen.getByTestId('add-sizing-x2b-out')).not.toHaveTextContent('15.58');
  });

  it('【回归 · 复审】市价档盘口线按 S₂′ 挑：挂在 S₂ 与 S₂′ 之间的反向单已在亏损侧，是离成交价最近的那条', () => {
    book.orders = {
      RAVEUSDT: [
        { id: 'far', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 130, quantity: 500, contracts: 500, contractSizeUsd: 10, settlementMode: 'coin', leverage: 5, marginMode: 'isolated', status: 'PENDING', createdAt: 1_500 },
        { id: 'near', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 140.01, quantity: 500, contracts: 500, contractSizeUsd: 10, settlementMode: 'coin', leverage: 5, marginMode: 'isolated', status: 'PENDING', createdAt: 1_500 },
      ],
    };
    try {
      renderCalc(140, { market: true });
      type('add-sizing-s1', '130');
      // S₂′ ≈ 140.014：140.01 在它的亏损侧且最近 → 与填的 130 不是同一条线
      expect(screen.getByTestId('add-sizing-s1-deviation')).toHaveTextContent('140.0100');
      // 限价档 S₂′ = S₂ = 140：140.01 在盈利侧，盘口线就是 130，与 S₁ 一致，不报偏差
      fireEvent.click(screen.getByTestId('add-sizing-order-kind-limit'));
      expect(screen.queryByTestId('add-sizing-s1-deviation')).toBeNull();
    } finally {
      book.orders = {};
    }
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

/**
 * 计划的发布与「按上限下单」：计算器算出可用上限就把计划发布出去（下单入口据此钉到单子上），
 * 「按上限下单」把整张的上限连同下单方式交给下单面板预填并关掉弹窗。
 */
describe('计划发布与「按上限下单」', () => {
  afterEach(() => { __resetAddSizingPlanForTests(); });

  it('S₁ 没填时没有计划、没有按钮；填了 S₁ 就发布一份带现价 / 预计成交价 / 上限 / 张数的计划（市价档）', () => {
    __resetAddSizingPlanForTests();
    renderCalc(140, { market: true, fillBasePrice: 140 });
    expect(getAddSizingPlan()).toBeNull();
    expect(screen.queryByTestId('add-sizing-place-at-limit')).toBeNull();
    type('add-sizing-s1', '130');
    const entry = getAddSizingPlan()!;
    expect(entry.symbol).toBe('RAVEUSDT');
    expect(entry.prefill).toBeNull();
    const snap = entry.snapshot;
    expect(snap).toMatchObject({ plan: 'A', side: 'LONG', settlement: 'coin', s1: 130, s2Ref: 140, orderKind: 'market', gUnit: 'RAVE', g: 0 });
    expect(snap.x1).toBeCloseTo(18.3333, 3);
    expect(snap.sBar).toBeCloseTo(109.0909, 3);
    // 与界面同一个数：上限 38.28 币 / 535 张，预计成交 S₂′ 略高于 140
    const plan = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar: 109.0909, s1: 130, s2: 140, x1: 18.3333, g: 0 })!;
    const fill = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage: plan.available, s1: 130, s2Ref: 140, orderKind: 'market', contractFaceUsd: 10 })!;
    expect(snap.s2Fill).toBeCloseTo(fill.s2Fill, 6);
    expect(snap.addCoinsMax).toBeCloseTo(fill.addCoinsMax, 3);
    expect(snap.contracts).toBe(fill.contracts);
    expect(snap.slippagePct).toBeCloseTo(fill.slippagePct, 6);
    const button = screen.getByTestId('add-sizing-place-at-limit');
    expect(button.textContent).toBe(`按上限下单 · ${fill.contracts!.toLocaleString('en-US')} 张`);
    // G 一开，计划变成 Plan B
    type('add-sizing-g', '1.2');
    expect(getAddSizingPlan()!.snapshot).toMatchObject({ plan: 'B', g: 1.2 });
    // S₁ 清空 → 计划清掉
    type('add-sizing-s1', '');
    expect(getAddSizingPlan()).toBeNull();
    expect(screen.queryByTestId('add-sizing-place-at-limit')).toBeNull();
  });

  it('「按上限下单」：带预填请求发布（市价 → MARKET；限价 → LIMIT + 挂单价 S₂）并关掉弹窗', () => {
    __resetAddSizingPlanForTests();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <AddSizingCalculator open onClose={onClose} symbol="RAVEUSDT" currentPrice={140} fillBasePrice={140} />
      </MemoryRouter>,
    );
    type('add-sizing-s1', '130');
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    const market = getAddSizingPlan()!;
    expect(market.prefill).toMatchObject({ orderType: 'MARKET', limitPrice: null, side: 'LONG', contracts: market.snapshot.contracts });
    expect(market.prefill!.coins).toBeCloseTo(market.snapshot.addCoinsMax, 6);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('add-sizing-order-kind-limit'));
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    const limit = getAddSizingPlan()!;
    expect(limit.snapshot.orderKind).toBe('limit');
    expect(limit.snapshot.s2Fill).toBe(140);
    expect(limit.prefill).toMatchObject({ orderType: 'LIMIT', limitPrice: 140, contracts: 536 });
    expect(limit.prefillSeq).toBeGreaterThan(market.prefillSeq);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('【回归 · 复审】弹窗开了 31 分钟、价一直没动（计划不重新发布）：关掉时续期，之后下的单仍钉得上', async () => {
    __resetAddSizingPlanForTests();
    const { peekAddSizingSnapshotForOrder } = await import('@/lib/addSizingPlan');
    const t0 = Date.parse('2026-09-15T00:00:00Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const ui = () => (
        <MemoryRouter>
          <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={140} fillBasePrice={140} />
        </MemoryRouter>
      );
      const view = render(ui());
      type('add-sizing-s1', '130');
      expect(getAddSizingPlan('RAVEUSDT')!.snapshot.at).toBe(t0);
      for (let m = 1; m <= 31; m += 1) {
        now.mockReturnValue(t0 + m * 60_000);
        view.rerender(ui());
      }
      // 内容没变：没有重新发布，发布时刻仍是 t0
      expect(getAddSizingPlan('RAVEUSDT')!.snapshot.at).toBe(t0);
      view.unmount();
      const closedAt = t0 + 31 * 60_000;
      expect(getAddSizingPlan('RAVEUSDT')!.snapshot.at).toBe(closedAt);
      const snap = peekAddSizingSnapshotForOrder({ symbol: 'RAVEUSDT', side: 'LONG', type: 'MARKET', settlement: 'coin', now: closedAt + 60_000 });
      expect(snap).toMatchObject({ s1: 130, s2Ref: 140, orderKind: 'market' });
    } finally {
      now.mockRestore();
      __resetAddSizingPlanForTests();
    }
  });
});

/**
 * 二审（流程）：市价单只能在引擎基准价上成交。市价档里手填的 S₂ 离基准价超过一格，计算器以前照样按它给市价计划，
 * 「按上限下单」预填一张市价单——实测按 105.5 定的 97.7 ETH 在 110 成交，超上限 9.8 倍。
 * 现在手填离基准价一格以上就切到限价 @S₂；复位 / 点「市价」回到基准价。两个方向都钉住。
 */
describe('【回归 · 二审】手填 S₂ 与市价单', () => {
  afterEach(() => { __resetAddSizingPlanForTests(); });
  const pressed = (k: 'market' | 'limit') => screen.getByTestId(`add-sizing-order-kind-${k}`).getAttribute('aria-pressed');
  const limitAt = (s2: number, kind: 'market' | 'limit') => {
    const coverage = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar: num('add-sizing-sbar'), s1: 130, s2, x1: num('add-sizing-x1'), g: 0 })!.available;
    return sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage, s1: 130, s2Ref: s2, orderKind: kind, contractFaceUsd: 10 })!;
  };

  it('市价档手填 135（基准价 140）：切到限价 @135，计划与「按上限下单」都是 LIMIT @135——不会给出一张按 135 定量、在 140 成交的市价单', () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <AddSizingCalculator open onClose={onClose} symbol="RAVEUSDT" currentPrice={139} fillBasePrice={140} pricePrecision={4} />
      </MemoryRouter>,
    );
    type('add-sizing-s1', '130');
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'market', s2Ref: 140 });
    type('add-sizing-s2', '135');
    expect(pressed('limit')).toBe('true');
    expect(screen.getByTestId('add-sizing-s2-limit-note')).toBeInTheDocument();
    const at135 = limitAt(135, 'limit');
    const snap = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(snap).toMatchObject({ orderKind: 'limit', s2Ref: 135, s2Fill: 135, slippagePct: 0, contracts: at135.contracts });
    const button = screen.getByTestId('add-sizing-place-at-limit');
    expect(button).toHaveAttribute('title', expect.stringContaining('限价单 @ 135.0000'));
    fireEvent.click(button);
    const prefill = getAddSizingPlan('RAVEUSDT')!.prefill!;
    expect(prefill).toMatchObject({ orderType: 'LIMIT', limitPrice: 135, contracts: at135.contracts });
    expect(onClose).toHaveBeenCalledTimes(1);
    // 同一个量若是市价单，会在 140 附近成交：那里的上限只有它的一小半
    const atBase = limitAt(140, 'market');
    expect(at135.contracts!).toBeGreaterThan(atBase.contracts! * 1.4);
  });

  it('反方向：复位 → 回到市价、S₂ 重新种在基准价上；点「市价」同样回到基准价；计划与预填都是基准价上的市价计划', () => {
    const view = render(
      <MemoryRouter>
        <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={139} fillBasePrice={140} pricePrecision={4} />
      </MemoryRouter>,
    );
    type('add-sizing-s1', '130');
    type('add-sizing-s2', '135');
    expect(pressed('limit')).toBe('true');
    fireEvent.click(screen.getByLabelText('S₂ 加仓价 复位'));
    expect(pressed('market')).toBe('true');
    expect(num('add-sizing-s2')).toBe(140);
    expect(screen.queryByTestId('add-sizing-s2-limit-note')).toBeNull();
    const atBase = limitAt(140, 'market');
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'market', s2Ref: 140, contracts: atBase.contracts });
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    expect(getAddSizingPlan('RAVEUSDT')!.prefill).toMatchObject({ orderType: 'MARKET', limitPrice: null, contracts: atBase.contracts });
    // 跟随已恢复：基准价走到 141，S₂ 跟上
    view.rerender(
      <MemoryRouter>
        <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={139} fillBasePrice={141} pricePrecision={4} />
      </MemoryRouter>,
    );
    expect(num('add-sizing-s2')).toBe(141);
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'market', s2Ref: 141 });

    // 手动切到限价再手填（不是自动切的，不出说明）；点「市价」：S₂ 回到基准价、解锁
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-limit'));
    type('add-sizing-s2', '136');
    expect(screen.queryByTestId('add-sizing-s2-limit-note')).toBeNull();
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'limit', s2Ref: 136 });
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-market'));
    expect(num('add-sizing-s2')).toBe(141);
    expect(screen.getByTestId('add-sizing-fill-price')).toHaveTextContent('现价 S₂ 141.0000');
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'market', s2Ref: 141 });
  });

  it('市价档手填的价与基准价差不到一格：仍是市价，不上锁、不出说明，定量用基准价本身', () => {
    render(
      <MemoryRouter>
        <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={139} fillBasePrice={140} pricePrecision={2} />
      </MemoryRouter>,
    );
    type('add-sizing-s1', '130');
    type('add-sizing-s2', '140.004');
    expect(pressed('market')).toBe('true');
    expect(screen.queryByTestId('add-sizing-s2-limit-note')).toBeNull();
    expect(screen.getByTestId('add-sizing-fill-price')).toHaveTextContent('现价 S₂ 140.0000');
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'market', s2Ref: 140 });
    // 一格之外（0.02）就切
    type('add-sizing-s2', '140.02');
    expect(pressed('limit')).toBe('true');
  });
});

/**
 * 二审（数值）：大字、张数、R0、快照、「按上限下单」必须是同一个数，而且是在它自己的成交价上不超的那个数。
 * 旧的 10 步不动点收不住时，大字按一个迭代值的成交价重算、按钮按另一个迭代值折张，两边差 74%。
 */
describe('【回归 · 二审】紧止损：界面上的上限只有一个，且在自己的成交价上不超', () => {
  afterEach(() => { scene.positions = null; scene.tradeHistory = null; __resetAddSizingPlanForTests(); });
  const usdtLong = (entry: number, qty: number, side: 'LONG' | 'SHORT' = 'LONG') => [{
    id: 'u1', side, entryPrice: entry, quantity: qty, leverage: 5, marginMode: 'isolated',
    settlementMode: 'usdt', settlementAsset: 'USDT', margin: (entry * qty) / 5, openTime: 1_000,
  }];

  it('BTC 险距 0.2%（100 @98,800，基准价 100,000，S₁ 99,800，U 本位）：大字 = 按钮 = 快照 = 177.19，不是 179；取满在自己的成交价上 Legs 判据通过', () => {
    scene.positions = usdtLong(98_800, 100);
    scene.tradeHistory = [];
    render(
      <MemoryRouter>
        <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={100_000} fillBasePrice={100_000} pricePrecision={2}
          quantityPrecision={3} />
      </MemoryRouter>,
    );
    type('add-sizing-s1', '99800');
    const plan = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage: 100_000, s1: 99_800, s2Ref: 100_000, orderKind: 'market' })!;
    expect(plan.addCoinsMax).toBeCloseTo(177.19, 2);
    const hero = screen.getByTestId('add-sizing-x2');
    expect(hero).toHaveTextContent('177.19');
    expect(hero).not.toHaveTextContent('179');
    expect(screen.getByTestId('add-sizing-hedge')).toHaveTextContent('277.19');
    // 按钮上的币数按面板的数量精度（3 位）向下取整——正是落进面板的那个数，不比上限多
    const qty = Math.floor(plan.addCoinsMax * 1_000 + 1e-7) / 1_000;
    expect(qty).toBeLessThanOrEqual(plan.addCoinsMax);
    expect(screen.getByTestId('add-sizing-place-at-limit').textContent)
      .toBe(`按上限下单 · ${qty.toLocaleString('en-US', { maximumFractionDigits: 3 })} RAVE`);
    const snap = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(snap.addCoinsMax).toBe(plan.addCoinsMax);
    expect(snap.s2Fill).toBe(plan.s2Fill);
    expect(screen.getByTestId('add-sizing-r0-pass')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    expect(getAddSizingPlan('RAVEUSDT')!.prefill!.coins).toBe(plan.addCoinsMax);
    const verdict = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'usdt', sBar: 98_800, s1: 99_800, x1: 100, g: 0,
      s2Ref: 100_000, s2Fill: calcSlippage(100_000, qty * 100_000, 'LONG'), addCoins: qty,
    })!;
    expect(verdict.overLimit).toBe(false);
  });

  it('ETH 险距 10（2,000 @3,400，基准价 3,500，S₁ 3,490，U 本位）：大字与按钮同一个数，比旧版的 6,768.06 小', () => {
    scene.positions = usdtLong(3_400, 2_000);
    scene.tradeHistory = [];
    render(
      <MemoryRouter>
        <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={3_500} fillBasePrice={3_500} pricePrecision={2} />
      </MemoryRouter>,
    );
    type('add-sizing-s1', '3490');
    const plan = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage: 180_000, s1: 3_490, s2Ref: 3_500, orderKind: 'market' })!;
    const text = plan.addCoinsMax.toLocaleString('en-US', { maximumFractionDigits: 2 });
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent(text);
    // 【回归 · 三审】没给数量精度：按钮按两位**向下**取整（6,715.6），不是大字的四舍五入 6,715.61——那比上限多
    const floored = Math.floor(plan.addCoinsMax * 100 + 1e-7) / 100;
    expect(Number(text.replace(/,/g, ''))).toBeGreaterThan(plan.addCoinsMax);
    expect(floored).toBeLessThanOrEqual(plan.addCoinsMax);
    expect(screen.getByTestId('add-sizing-place-at-limit').textContent)
      .toBe(`按上限下单 · ${floored.toLocaleString('en-US', { maximumFractionDigits: 2 })} RAVE`);
    expect(plan.addCoinsMax).toBeLessThan(6_768.06 * 0.995);
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot.addCoinsMax).toBe(plan.addCoinsMax);
  });

  it('COMMONUSDT S₁ 0.00768（基准价 0.0077015，币本位，G 开）：大字、张数、按钮、快照同一个上限，整张在自己的成交价上不超', () => {
    scene.positions = [{
      id: 'c1', side: 'LONG', entryPrice: 0.006974, quantity: 1_483_567_536.56, leverage: 5, marginMode: 'isolated',
      settlementMode: 'coin', settlementAsset: 'RAVE', contractSizeUsd: 10, contracts: 1_034_640, margin: 2_069_280, openTime: 1_000,
    }];
    scene.tradeHistory = [];
    render(
      <MemoryRouter>
        <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={0.0077015} fillBasePrice={0.0077015} pricePrecision={10} />
      </MemoryRouter>,
    );
    type('add-sizing-s1', '0.00768');
    type('add-sizing-g', '55994538.5');
    const x1 = num('add-sizing-x1');
    const sBar = num('add-sizing-sbar');
    const coverage = computePlanBCoverageAtS1({ side: 'LONG', settlement: 'coin', sBar, s1: 0.00768, s2: 0.0077015, x1, g: 55_994_538.5 })!.available;
    const plan = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage, s1: 0.00768, s2Ref: 0.0077015, orderKind: 'market', contractFaceUsd: 10 })!;
    expect(plan.addCoinsMax).toBeGreaterThan(1.018e10);
    expect(plan.addCoinsMax).toBeLessThan(1.019e10);
    const total = screen.getByTestId('add-sizing-total-add');
    expect(total).toHaveTextContent(plan.addCoinsMax.toLocaleString('en-US', { maximumFractionDigits: 2 }));
    expect(total).toHaveTextContent(`${plan.contracts!.toLocaleString('en-US')} 张`);
    // 旧版：大字 13.05e9、按钮 5,840,578 张
    expect(total).not.toHaveTextContent('13,051,387');
    expect(screen.getByTestId('add-sizing-place-at-limit').textContent).toBe(`按上限下单 · ${plan.contracts!.toLocaleString('en-US')} 张`);
    const snap = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(snap).toMatchObject({ addCoinsMax: plan.addCoinsMax, contracts: plan.contracts, s2Fill: plan.s2Fill });
    expect(screen.getByTestId('add-sizing-r0-pass')).toBeInTheDocument();
    const notional = plan.contracts! * 10;
    const fill = calcSlippage(0.0077015, notional, 'LONG');
    const verdict = evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar, s1: 0.00768, x1, g: 55_994_538.5,
      s2Ref: 0.0077015, s2Fill: fill, addCoins: notional / fill, contractFaceUsd: 10,
    })!;
    expect(verdict.overLimit).toBe(false);
  });

  it('空头险距 0.0001（1000 @110，基准价 100，S₁ 100.0001，U 本位）：市价档照样给出含滑点的上限 ≈ 68,230，不退回无滑点的 9,999.9 万', () => {
    scene.positions = usdtLong(110, 1_000, 'SHORT');
    scene.tradeHistory = [];
    render(
      <MemoryRouter>
        <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={100} fillBasePrice={100} pricePrecision={4} />
      </MemoryRouter>,
    );
    type('add-sizing-s1', '100.0001');
    const hero = screen.getByTestId('add-sizing-x2');
    expect(hero).toHaveTextContent(/68,2\d\d\.\d+/);
    expect(hero).not.toHaveTextContent('99,999');
    const snap = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(snap.side).toBe('SHORT');
    expect(snap.addCoinsMax).toBeGreaterThan(68_200);
    expect(snap.addCoinsMax).toBeLessThan(68_300);
    expect(snap.s2Fill).toBeLessThan(100);
    expect(screen.getByTestId('add-sizing-place-at-limit')).toBeInTheDocument();
  });
});

/**
 * 二审（流程）：重新打开计算器不能清掉仍在用的计划。
 * 以前打开那一帧 S₁ 是空的，算出「没有计划」就发布出去，下单面板里预填好的那张单于是不带计划下出去。
 */
describe('【回归 · 二审】重新打开计算器：从仍在保鲜期的计划种回，不清掉它', () => {
  afterEach(() => { __resetAddSizingPlanForTests(); vi.useRealTimers(); });
  const ui = (fillBasePrice = 140, onClose = () => {}) => (
    <MemoryRouter>
      <AddSizingCalculator open onClose={onClose} symbol="RAVEUSDT" currentPrice={139} fillBasePrice={fillBasePrice} pricePrecision={4} />
    </MemoryRouter>
  );

  it('市价计划：「按上限下单」→ 面板取走预填 → 再打开：S₁ / G / 市价种回，计划仍是同一份（不重发、不清掉）；关掉后仍在', () => {
    const first = render(ui());
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    const placed = getAddSizingPlan('RAVEUSDT')!;
    consumeAddSizingPrefill(placed.prefillSeq, 'RAVEUSDT');
    first.unmount();
    const beforeReopen = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(beforeReopen).toMatchObject({ orderKind: 'market', s1: 130, g: 1.2, plan: 'B' });

    const second = render(ui());
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toBe(beforeReopen);
    expect((screen.getByTestId('add-sizing-s1') as HTMLInputElement).value).toBe('130');
    expect((screen.getByTestId('add-sizing-g') as HTMLInputElement).value).toBe('1.2');
    expect(screen.getByTestId('add-sizing-order-kind-market')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('add-sizing-place-at-limit').textContent).toBe(`按上限下单 · ${beforeReopen.contracts!.toLocaleString('en-US')} 张`);
    second.unmount();
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'market', s1: 130, g: 1.2, addCoinsMax: beforeReopen.addCoinsMax });
  });

  it('限价计划（手填 135 自动切的）：再打开时基准价已到 141——挂单价 135 原样锁回、仍是限价，计划不变', () => {
    const first = render(ui());
    type('add-sizing-s1', '130');
    type('add-sizing-s2', '135');
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    first.unmount();
    const before = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(before).toMatchObject({ orderKind: 'limit', s2Ref: 135, s2Fill: 135 });

    render(ui(141));
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toBe(before);
    expect(num('add-sizing-s2')).toBe(135);
    expect(screen.getByTestId('add-sizing-order-kind-limit')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('add-sizing-fill-price')).toHaveTextContent('手填 S₂ 135.0000');
  });

  it('市价计划、再打开时基准价变了：按新基准价重算并发布（替换，不清空）', () => {
    const first = render(ui());
    type('add-sizing-s1', '130');
    first.unmount();
    render(ui(141));
    const snap = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(snap).toMatchObject({ orderKind: 'market', s1: 130, s2Ref: 141 });
  });

  it('过了保鲜期的计划不种回：S₁ 留空，旧计划被清掉（不会因为关弹窗又续上）', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-09-16T00:00:00Z');
    vi.setSystemTime(t0);
    const first = render(ui());
    type('add-sizing-s1', '130');
    first.unmount();
    expect(getAddSizingPlan('RAVEUSDT')).not.toBeNull();
    vi.setSystemTime(t0 + ADD_SIZING_PLAN_TTL_MS + 60_000);
    const second = render(ui());
    expect((screen.getByTestId('add-sizing-s1') as HTMLInputElement).value).toBe('');
    expect(getAddSizingPlan('RAVEUSDT')).toBeNull();
    second.unmount();
    expect(getAddSizingPlan('RAVEUSDT')).toBeNull();
  });
});

describe('【回归 · 二审】没有基准价时手填的 S₂', () => {
  afterEach(() => { __resetAddSizingPlanForTests(); });
  const ui = (fillBasePrice: number) => (
    <MemoryRouter>
      <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={0} fillBasePrice={fillBasePrice} pricePrecision={4} />
    </MemoryRouter>
  );

  it('基准价到了之后：离基准价一格以上 → 切限价并出说明；差不到一格 → 解锁跟随，仍是市价', () => {
    const view = render(ui(0));
    type('add-sizing-s1', '130');
    type('add-sizing-s2', '135');
    // 没有基准价可比：先留在市价档（锁住手填值）
    expect(screen.getByTestId('add-sizing-order-kind-market')).toHaveAttribute('aria-pressed', 'true');
    view.rerender(ui(140));
    expect(screen.getByTestId('add-sizing-order-kind-limit')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('add-sizing-s2-limit-note')).toBeInTheDocument();
    expect(num('add-sizing-s2')).toBe(135);
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'limit', s2Ref: 135 });
    view.unmount();
    __resetAddSizingPlanForTests();

    const second = render(ui(0));
    type('add-sizing-s1', '130');
    type('add-sizing-s2', '140');
    second.rerender(ui(140.00004));
    expect(screen.getByTestId('add-sizing-order-kind-market')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('add-sizing-s2-limit-note')).toBeNull();
    // 解锁后跟上基准价
    second.rerender(ui(141));
    expect(num('add-sizing-s2')).toBe(141);
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'market', s2Ref: 141 });
  });
});

/**
 * 三审（数值）：条件委托是 Taker——触发后在**触发价**上按同一个 calcSlippage 成交（Index 的条件单触发与后台撮合都传 isMaker = false）。
 * 以前手填 S₂ 只能落到「限价」档（不计滑点），按它定的量挂成突破条件单，COMMONUSDT 的超限原样重演：
 * 触发价 0.0077015 上限价档给 653,579 张，成交在 0.0077123（+0.14%），超 +1.57%。
 * 现在有第三档「条件单 @S₂」，按触发价上的滑点定量；「按上限下单」预填的也是以 S₂ 为触发价的条件委托。
 */
describe('【回归 · 三审】条件单 @S₂：触发后按市价成交，定量计入触发价上的滑点', () => {
  afterEach(() => { scene.positions = null; scene.tradeHistory = null; __resetAddSizingPlanForTests(); });
  const TRIGGER = 0.0077015;
  const S1 = 0.007069;
  const G = 55_994_538.5;
  const commonMain = () => [{
    id: 'c1', side: 'LONG', entryPrice: 0.006974, quantity: 1_483_567_536.56, leverage: 5, marginMode: 'isolated',
    settlementMode: 'coin', settlementAsset: 'RAVE', contractSizeUsd: 10, contracts: 1_034_640, margin: 2_069_280, openTime: 1_000,
  }];
  const pressed = (k: 'market' | 'limit' | 'conditional') => screen.getByTestId(`add-sizing-order-kind-${k}`).getAttribute('aria-pressed');
  const commonUi = (fillBasePrice = 0.0077, onClose = () => {}) => (
    <MemoryRouter>
      <AddSizingCalculator open onClose={onClose} symbol="RAVEUSDT" currentPrice={fillBasePrice} fillBasePrice={fillBasePrice} pricePrecision={7} />
    </MemoryRouter>
  );
  const sizedAt = (kind: 'limit' | 'conditional') => {
    const coverage = computePlanBCoverageAtS1({
      side: 'LONG', settlement: 'coin', sBar: num('add-sizing-sbar'), s1: S1, s2: TRIGGER, x1: num('add-sizing-x1'), g: G,
    })!.available;
    return sizeAddAtExpectedFill({ side: 'LONG', settlement: 'coin', coverage, s1: S1, s2Ref: TRIGGER, orderKind: kind, contractFaceUsd: 10 })!;
  };
  /** 这么多张挂成条件单触发：引擎在触发价上加滑点成交，Legs 按成交价判。 */
  const legsAtTrigger = (contracts: number) => {
    const fill = calcSlippage(TRIGGER, contracts * 10, 'LONG');
    return evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'coin', sBar: num('add-sizing-sbar'), s1: S1, x1: num('add-sizing-x1'), g: G,
      s2Ref: TRIGGER, s2Fill: fill, addCoins: (contracts * 10) / fill, contractFaceUsd: 10,
    })!;
  };

  it('COMMONUSDT：手填触发价 0.0077015 先落到限价（653,579 张，挂成条件单会超 +1.57%）；一键改成条件单 → 643,61x 张、+0.14%，触发后在自己的成交价上不超；预填 CONDITIONAL @触发价', () => {
    scene.positions = commonMain();
    scene.tradeHistory = [];
    const onClose = vi.fn();
    render(commonUi(0.0077, onClose));
    type('add-sizing-s1', String(S1));
    type('add-sizing-g', String(G));
    type('add-sizing-s2', String(TRIGGER));
    expect(pressed('limit')).toBe('true');
    const limit = sizedAt('limit');
    expect(Math.abs(limit.contracts! - 653_579)).toBeLessThanOrEqual(3);
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'limit', contracts: limit.contracts, s2Fill: TRIGGER });
    // 限价档的量挂成条件单：触发后 +0.14% 成交，超限 ≈ 1.57%——那一场原样重演
    const replay = legsAtTrigger(limit.contracts!);
    expect(replay.overLimit).toBe(true);
    expect(replay.overshootPct).toBeCloseTo(1.57, 1);

    fireEvent.click(screen.getByTestId('add-sizing-s2-to-conditional'));
    expect(pressed('conditional')).toBe('true');
    expect(screen.queryByTestId('add-sizing-s2-limit-note')).toBeNull();
    // 触发价原样锁着，不跟基准价走
    expect(num('add-sizing-s2')).toBe(TRIGGER);
    const cond = sizedAt('conditional');
    expect(Math.abs(cond.contracts! - 643_614)).toBeLessThanOrEqual(3);
    expect(cond.slippagePct).toBeCloseTo(0.14, 2);
    const line = screen.getByTestId('add-sizing-fill-price');
    expect(line).toHaveTextContent('触发价 S₂ 0.00770150');
    expect(line).toHaveTextContent(`预计成交 S₂′ ${cond.s2Fill.toPrecision(6)}`);
    expect(line).toHaveTextContent('(+0.14% · 触发后市价)');
    const total = screen.getByTestId('add-sizing-total-add');
    expect(total).toHaveTextContent(`${cond.contracts!.toLocaleString('en-US')} 张`);
    const snap = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(snap).toMatchObject({ orderKind: 'conditional', s2Ref: TRIGGER, s2Fill: cond.s2Fill, contracts: cond.contracts, addCoinsMax: cond.addCoinsMax });
    expect(snap.slippagePct).toBeCloseTo(cond.slippagePct, 9);
    expect(legsAtTrigger(cond.contracts!).overLimit).toBe(false);

    const button = screen.getByTestId('add-sizing-place-at-limit');
    expect(button).toHaveAttribute('title', expect.stringContaining('条件委托 · 触发价 0.00770150（触发后市价） · 开多'));
    expect(button.textContent).toBe(`按上限下单 · ${cond.contracts!.toLocaleString('en-US')} 张`);
    fireEvent.click(button);
    expect(getAddSizingPlan('RAVEUSDT')!.prefill).toMatchObject({
      orderType: 'CONDITIONAL', triggerPrice: TRIGGER, limitPrice: null, contracts: cond.contracts, side: 'LONG', settlement: 'coin',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('市价档直接点「条件单」：触发价还是基准价（会被当成立即成交的单拒掉）→ 说明、不给计划；填了触发价才给', () => {
    scene.positions = commonMain();
    scene.tradeHistory = [];
    render(commonUi());
    type('add-sizing-s1', String(S1));
    type('add-sizing-g', String(G));
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot.orderKind).toBe('market');
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-conditional'));
    expect(screen.getByTestId('add-sizing-conditional-at-base')).toHaveTextContent('条件单的触发价要离现价至少一格');
    expect(getAddSizingPlan('RAVEUSDT')).toBeNull();
    expect(screen.queryByTestId('add-sizing-place-at-limit')).toBeNull();
    type('add-sizing-s2', String(TRIGGER));
    expect(screen.queryByTestId('add-sizing-conditional-at-base')).toBeNull();
    expect(pressed('conditional')).toBe('true');
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'conditional', s2Ref: TRIGGER, contracts: sizedAt('conditional').contracts });
    // 复位回到市价：S₂ 回到基准价、按市价定量
    fireEvent.click(screen.getByLabelText('S₂ 加仓价 复位'));
    expect(pressed('market')).toBe('true');
    expect(num('add-sizing-s2')).toBe(0.0077);
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ orderKind: 'market', s2Ref: 0.0077 });
  });

  it('再打开：条件单计划连同锁住的触发价种回（基准价已经变了也不跟），计划仍是同一份', () => {
    scene.positions = commonMain();
    scene.tradeHistory = [];
    const first = render(commonUi());
    type('add-sizing-s1', String(S1));
    type('add-sizing-g', String(G));
    fireEvent.click(screen.getByTestId('add-sizing-order-kind-conditional'));
    type('add-sizing-s2', String(TRIGGER));
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    const placed = getAddSizingPlan('RAVEUSDT')!;
    consumeAddSizingPrefill(placed.prefillSeq, 'RAVEUSDT');
    first.unmount();
    const before = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(before.orderKind).toBe('conditional');

    render(commonUi(0.00769));
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toBe(before);
    expect(pressed('conditional')).toBe('true');
    expect(num('add-sizing-s2')).toBe(TRIGGER);
    expect(screen.getByTestId('add-sizing-fill-price')).toHaveTextContent('触发价 S₂ 0.00770150');
  });

  it('BTC U 本位突破加仓（100 @98,800，S₁ 99,800，触发价 100,000）：限价档 500 个挂成条件单成交在 101,010、超 +505%；条件单档给 177.19，按钮按数量精度向下取整', () => {
    scene.positions = [{
      id: 'u1', side: 'LONG', entryPrice: 98_800, quantity: 100, leverage: 5, marginMode: 'isolated',
      settlementMode: 'usdt', settlementAsset: 'USDT', margin: 98_800 * 20, openTime: 1_000,
    }];
    scene.tradeHistory = [];
    render(
      <MemoryRouter>
        <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={99_900} fillBasePrice={99_900} pricePrecision={2}
          quantityPrecision={3} />
      </MemoryRouter>,
    );
    type('add-sizing-s1', '99800');
    type('add-sizing-s2', '100000');
    expect(pressed('limit')).toBe('true');
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot.addCoinsMax).toBeCloseTo(500, 6);
    const fillOf = (coins: number) => calcSlippage(100_000, coins * 100_000, 'LONG');
    expect(fillOf(500)).toBeCloseTo(101_010, 6);
    const legs = (coins: number) => evaluatePostFillAddSizing({
      side: 'LONG', settlement: 'usdt', sBar: 98_800, s1: 99_800, x1: 100, g: 0, s2Ref: 100_000, s2Fill: fillOf(coins), addCoins: coins,
    })!;
    expect(legs(500).overshootPct).toBeGreaterThan(500);

    fireEvent.click(screen.getByTestId('add-sizing-s2-to-conditional'));
    const cond = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage: 100_000, s1: 99_800, s2Ref: 100_000, orderKind: 'conditional' })!;
    expect(cond.addCoinsMax).toBeCloseTo(177.19, 2);
    const snap = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(snap).toMatchObject({ orderKind: 'conditional', s2Ref: 100_000, addCoinsMax: cond.addCoinsMax, contracts: null });
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('177.19');
    const qty = Math.floor(cond.addCoinsMax * 1_000 + 1e-7) / 1_000;
    expect(screen.getByTestId('add-sizing-place-at-limit').textContent)
      .toBe(`按上限下单 · ${qty.toLocaleString('en-US', { maximumFractionDigits: 3 })} RAVE`);
    expect(legs(qty).overLimit).toBe(false);
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    expect(getAddSizingPlan('RAVEUSDT')!.prefill).toMatchObject({ orderType: 'CONDITIONAL', triggerPrice: 100_000, contracts: null, settlement: 'usdt' });
  });
});

/**
 * 三审（流程）：再打开时从计划种回，但计划只记得它算出来那一刻。
 *   · G：计划之后又实现了一笔同向亏损，旧 G 会把上限抬高一倍多——打开时本来就会自动带入本场 G 的情形，按本场的重填；
 *   · X₁ / S̄：主空战役带着多头对冲腿，pickHeldSide 先看多头——要按计划那一侧的持仓读；
 *   · 计划早于当前持仓的真实开仓（停止回放后同一段历史又放了一遍）：不是这一场的计划，整个不认。
 */
describe('【回归 · 三审】重新打开：计划只记得它算出来那一刻', () => {
  const R0 = Date.parse('2026-09-16T08:00:00Z');
  const MIN = 60_000;
  afterEach(() => { scene.positions = null; scene.tradeHistory = null; __resetAddSizingPlanForTests(); vi.useRealTimers(); });
  const ui = () => (
    <MemoryRouter>
      <AddSizingCalculator open onClose={() => {}} symbol="RAVEUSDT" currentPrice={139} fillBasePrice={140} pricePrecision={4} />
    </MemoryRouter>
  );
  const stamped = (at: number): Position[] => positions.map((p, i) => ({ ...p, openedRealAt: at + i * 1_000 }));
  const tp = { ...tradeHistory[0], closedRealAt: R0 + 5 * MIN } as TradeRecord;
  const loss = { ...tradeHistory[0], id: 'loss', exit_method: 'sl', pnl: -300, pnlCoin: -2.4, closeTime: 3_500, closedRealAt: R0 + 20 * MIN } as TradeRecord;
  const g = () => (screen.getByTestId('add-sizing-g') as HTMLInputElement).value;

  it('计划之后又实现了一笔同向亏损：再打开时 G 换成本场的 −1.2 并说明，上限与计划跟着本场走（不是旧 G 的 2.37 倍）', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    scene.positions = stamped(R0);

    // 对照：没有旧计划时打开——本场 G −1.2，S₁ 130 的上限
    vi.setSystemTime(R0 + 25 * MIN);
    scene.tradeHistory = [tp, loss];
    const control = render(ui());
    expect(Number(g())).toBeCloseTo(-1.2, 6);
    type('add-sizing-s1', '130');
    const truth = getAddSizingPlan('RAVEUSDT')!.snapshot;
    const truthHero = screen.getByTestId('add-sizing-total-add').textContent;
    expect(truth.g).toBeCloseTo(-1.2, 6);
    expect(truthHero).toContain('22.7');
    control.unmount();
    __resetAddSizingPlanForTests();

    // 计划在亏损之前算出：G 自动带入 +1.2
    vi.setSystemTime(R0 + 10 * MIN);
    scene.tradeHistory = [tp];
    const first = render(ui());
    expect(Number(g())).toBeCloseTo(1.2, 6);
    type('add-sizing-s1', '130');
    const stale = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(stale.g).toBeCloseTo(1.2, 6);
    expect(stale.addCoinsMax / truth.addCoinsMax).toBeGreaterThan(2.3);
    first.unmount();

    // 20 分钟时止损实现 −2.4；25 分钟时再打开
    vi.setSystemTime(R0 + 25 * MIN);
    scene.tradeHistory = [tp, loss];
    const second = render(ui());
    expect((screen.getByTestId('add-sizing-s1') as HTMLInputElement).value).toBe('130');
    expect(Number(g())).toBeCloseTo(-1.2, 6);
    expect(screen.getByTestId('add-sizing-g-refreshed')).toHaveTextContent('G 已按本场落袋重填为 -1.2（上次计划里是 1.2），上限随之重算');
    expect(screen.getByTestId('add-sizing-fill-banked')).toHaveTextContent('本场可用 G −1.2');
    expect(screen.getByTestId('add-sizing-total-add').textContent).toBe(truthHero);
    const replaced = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(replaced).not.toBe(stale);
    expect(replaced.g).toBeCloseTo(-1.2, 6);
    expect(replaced.addCoinsMax).toBe(truth.addCoinsMax);
    expect(replaced.contracts).toBe(truth.contracts);
    // 手改 G：说明随之消失
    type('add-sizing-g', '-1');
    expect(screen.queryByTestId('add-sizing-g-refreshed')).toBeNull();
    second.unmount();
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot.g).toBe(-1);
  });

  it('本场落袋没变：再打开时 G 与计划一致，计划仍是同一份、不出说明', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(R0 + 10 * MIN);
    scene.positions = stamped(R0);
    scene.tradeHistory = [tp];
    const first = render(ui());
    type('add-sizing-s1', '130');
    first.unmount();
    const before = getAddSizingPlan('RAVEUSDT')!.snapshot;
    vi.setSystemTime(R0 + 12 * MIN);
    render(ui());
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toBe(before);
    expect(Number(g())).toBeCloseTo(1.2, 6);
    expect(screen.queryByTestId('add-sizing-g-refreshed')).toBeNull();
  });

  it('主空战役带多头对冲腿：再打开时 X₁ / S̄ 按计划那一侧（空头）读，计划原样留着——不被多头腿的数清掉或替换（含 G 5、对冲 @160 两种）', () => {
    for (const [hedgeEntry, gText] of [[100, ''], [100, '5'], [160, '']] as const) {
      __resetAddSizingPlanForTests();
      scene.positions = [
        { ...positions[0], id: 'hedge', entryPrice: hedgeEntry, quantity: 1_000 / hedgeEntry },
        { ...positions[0], id: 'main', side: 'SHORT', entryPrice: 150, quantity: 6.67, openTime: 3_000 },
      ];
      scene.tradeHistory = [];
      const label = `hedge @${hedgeEntry} G ${gText || 0}`;
      const first = render(ui());
      fireEvent.click(screen.getByTestId('add-sizing-side-toggle'));
      fireEvent.click(screen.getByTestId('add-sizing-side-SHORT'));
      type('add-sizing-sbar', '150');
      type('add-sizing-x1', '6.6667');
      type('add-sizing-s1', '145');
      if (gText) type('add-sizing-g', gText);
      expect(getAddSizingPlan('RAVEUSDT')!.snapshot, label).toMatchObject({ side: 'SHORT', x1: 6.6667, sBar: 150, s1: 145, g: Number(gText || 0) });
      fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
      consumeAddSizingPrefill(getAddSizingPlan('RAVEUSDT')!.prefillSeq, 'RAVEUSDT');
      first.unmount();
      const before = getAddSizingPlan('RAVEUSDT')!.snapshot;

      const second = render(ui());
      expect(getAddSizingPlan('RAVEUSDT')!.snapshot, label).toBe(before);
      expect(screen.getByTestId('add-sizing-side-toggle'), label).toHaveTextContent('主空');
      expect(num('add-sizing-sbar'), label).toBe(150);
      expect(num('add-sizing-x1'), label).toBe(6.6667);
      expect(g(), label).toBe(gText);
      expect(screen.getByTestId('add-sizing-place-at-limit').textContent, label).toBe(`按上限下单 · ${before.contracts!.toLocaleString('en-US')} 张`);
      second.unmount();
      expect(getAddSizingPlan('RAVEUSDT')!.snapshot, label).toMatchObject({
        side: 'SHORT', x1: 6.6667, sBar: 150, g: before.g, addCoinsMax: before.addCoinsMax, contracts: before.contracts,
      });
    }
  });

  it('上一场的计划（早于当前持仓的真实开仓，停止回放后又放了一遍）：不认——S₁ 留空、G 按这一场自动带入、旧计划清掉', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(R0 + 10 * MIN);
    scene.positions = stamped(R0);
    scene.tradeHistory = [tp];
    const first = render(ui());
    type('add-sizing-s1', '130');
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot).toMatchObject({ s1: 130, g: 1.2 });
    first.unmount();

    // 第二遍：主力在 R1 重新开出，这一遍的止盈 +0.8 与上一遍模拟时刻撞车，只有真实时钟分得开
    const R1 = R0 + 15 * MIN;
    vi.setSystemTime(R1 + 5 * MIN);
    scene.positions = stamped(R1);
    scene.tradeHistory = [tp, { ...tp, id: 'tp-second-pass', pnl: 100, pnlCoin: 0.8, closedRealAt: R1 + 2 * MIN } as TradeRecord];
    render(ui());
    expect((screen.getByTestId('add-sizing-s1') as HTMLInputElement).value).toBe('');
    expect(Number(g())).toBeCloseTo(0.8, 6);
    expect(screen.queryByTestId('add-sizing-g-refreshed')).toBeNull();
    expect(screen.getByTestId('add-sizing-order-kind-market')).toHaveAttribute('aria-pressed', 'true');
    expect(getAddSizingPlan('RAVEUSDT')).toBeNull();
    expect(screen.queryByTestId('add-sizing-place-at-limit')).toBeNull();
  });
});

describe('【回归 · 三审】顶栏把面板的精度交给计算器', () => {
  afterEach(() => { scene.positions = null; scene.tradeHistory = null; __resetAddSizingPlanForTests(); });

  it('基准价、价格精度、数量精度都从 SessionModeControls 传进来：S₂ 种在基准价上，U 本位按钮按数量精度向下取整', () => {
    scene.positions = [{
      id: 'u1', side: 'LONG', entryPrice: 3_400, quantity: 2_000, leverage: 5, marginMode: 'isolated',
      settlementMode: 'usdt', settlementAsset: 'USDT', margin: 3_400 * 400, openTime: 1_000,
    }];
    scene.tradeHistory = [];
    render(
      <MemoryRouter>
        <SessionModeControls activeSymbol="RAVEUSDT" activePrice={3_499} activeFillBasePrice={3_500}
          activePricePrecision={2} activeQuantityPrecision={1} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId('add-sizing-open'));
    expect(num('add-sizing-s2')).toBe(3_500);
    type('add-sizing-s1', '3490');
    const plan = sizeAddAtExpectedFill({ side: 'LONG', settlement: 'usdt', coverage: 180_000, s1: 3_490, s2Ref: 3_500, orderKind: 'market' })!;
    const qty = Math.floor(plan.addCoinsMax * 10 + 1e-7) / 10;
    expect(screen.getByTestId('add-sizing-place-at-limit').textContent)
      .toBe(`按上限下单 · ${qty.toLocaleString('en-US', { maximumFractionDigits: 1 })} RAVE`);
    // 价格精度 2 位：手填 3,500.004 与基准价差不到一格，仍是市价
    type('add-sizing-s2', '3500.004');
    expect(screen.getByTestId('add-sizing-order-kind-market')).toHaveAttribute('aria-pressed', 'true');
  });
});

/**
 * 可下单量还要过币安分层：按这个合约当前的杠杆，这一侧还能再开多少（持仓多空相加 + 非只减仓挂单），
 * 而且计划自己的对冲（S₁ 上合计 X₁ + X₂ 的反向条件单）也占同一个上限——加仓与要补挂的对冲都得放得下。
 * 大字、张数、合计对冲、「按上限下单」取 min(Plan B 上限, 分层余量)，一行字说清卡住的是哪一个、给对冲留了位置；
 * 计划快照仍记 Plan B 上限（成交后复判与 Legs 校验只判 Plan B）。
 *
 * 盘面沿用上面的 RAVE 币本位两腿（200 张 = 2,000 USD，X₁ = 18.3333 币）。币安没有 RAVE 币本位合约，借 U 本位 RAVEUSDT 的分层：
 * 20x 最高 5,000 USD，5x 最高 50,000 USD，最高 20x；合成币本位按 USD 面值计，不留 0.2% 余量。
 * S₁ = 130 上的对冲按 130 折张、向上取整：X₁ 就要 ⌈238.33⌉ 张。
 */
describe('【分层】可下单量 = min(Plan B 上限, 币安分层余量)，分层余量给计划的对冲留出位置', () => {
  beforeEach(() => { tierSeam.real = true; });
  afterEach(() => {
    tierSeam.real = false;
    fillSeam.none = false;
    panel.leverageMap = {};
    book.orders = {};
    scene.positions = null;
    __resetAddSizingPlanForTests();
  });

  it('20x：单看加仓还剩 300 张，但 S₁ 上的对冲也要放下 → 31 张（2,000 + 310 + 268 张对冲 2,680 ≤ 5,000）；计划仍记 Plan B 的 38.33 / 536 张', () => {
    panel.leverageMap = { RAVEUSDT: 20 };
    renderCalc();                                        // 限价 @140
    type('add-sizing-s1', '130');
    const coins = (31 * 10) / 140;                       // 2.2143
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('2.21');
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('31 张');
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('分层封顶');
    expect(screen.getByTestId('add-sizing-hedge')).toHaveTextContent('20.55');   // 18.3333 + 2.2143
    const line = screen.getByTestId('add-sizing-tier-cap');
    expect(line.dataset.binds).toBe('tier');
    expect(line.dataset.hedge).toBe('binds');
    expect(line).toHaveTextContent('分层上限：当前 20x 最多再开 2.2143 RAVE（31 张）');
    expect(line).toHaveTextContent('（已给 S₁ 130.0000 上的合计对冲留出位置，加仓与对冲谁先成交都放得下；不算对冲，单看加仓还能开 21.4286 RAVE）');
    expect(line).toHaveTextContent('持仓和当前委托 2,000 USD / 最高 5,000 USD');
    expect(line).toHaveTextContent('比 Plan B 上限 38.33 RAVE 小，可下单量按分层');
    // R0 按实际要下的量复核：比上限小，跌到 S₁ 还剩垫子
    expect(screen.getByTestId('add-sizing-r0-pass')).toBeInTheDocument();

    const snap = getAddSizingPlan('RAVEUSDT')!.snapshot;
    expect(snap.addCoinsMax).toBeCloseTo(38.333, 2);
    expect(snap.contracts).toBe(536);
    const button = screen.getByTestId('add-sizing-place-at-limit');
    expect(button.textContent).toBe('按上限下单 · 31 张');
    fireEvent.click(button);
    const entry = getAddSizingPlan('RAVEUSDT')!;
    expect(entry.prefill).toMatchObject({ orderType: 'LIMIT', limitPrice: 140, contracts: 31 });
    expect(entry.prefill!.coins).toBeCloseTo(coins, 9);
    expect(entry.snapshot.contracts).toBe(536);
    expect(entry.snapshot.addCoinsMax).toBeCloseTo(38.333, 2);
  });

  it('5x：给对冲留位后分层还能开 2,365 张，Plan B 的 536 张更小——数照旧，一行字说按 Plan B', () => {
    panel.leverageMap = { RAVEUSDT: 5 };
    renderCalc();
    type('add-sizing-s1', '130');
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('38.33');
    expect(screen.getByTestId('add-sizing-x2')).not.toHaveTextContent('分层封顶');
    const line = screen.getByTestId('add-sizing-tier-cap');
    expect(line.dataset.binds).toBe('plan-b');
    // 2,000 + 23,650 + 2,435 张对冲 24,350 = 50,000
    expect(line).toHaveTextContent('当前 5x 最多再开 168.9286 RAVE（2,365 张）');
    expect(line).toHaveTextContent('单看加仓还能开 342.8571 RAVE');
    expect(line).toHaveTextContent('Plan B 上限更小，按 Plan B');
    expect(screen.getByTestId('add-sizing-place-at-limit').textContent).toBe('按上限下单 · 536 张');
  });

  describe('双向持仓相加、非只减仓挂单计入、只减仓单不计：2,000 + 空仓 500 + 空头条件单 @125 1,000 = 3,500', () => {
    const setup = () => {
      panel.leverageMap = { RAVEUSDT: 20 };
      scene.positions = [
        ...positions,
        { id: 's1', side: 'SHORT', entryPrice: 150, quantity: 3.33, leverage: 20, marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'RAVE', contractSizeUsd: 10, contracts: 50, margin: 25, openTime: 2_500 },
      ];
      book.orders = {
        RAVEUSDT: [
          { id: 'hedge', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 125, quantity: 100, contracts: 100, contractSizeUsd: 10, settlementMode: 'coin', leverage: 20, marginMode: 'isolated', status: 'PENDING', createdAt: 5_000 },
          { id: 'tp', side: 'SHORT', type: 'CONDITIONAL', price: 0, stopPrice: 160, quantity: 200, contracts: 200, contractSizeUsd: 10, settlementMode: 'coin', leverage: 20, marginMode: 'isolated', status: 'PENDING', createdAt: 5_000, reduceOnly: true },
        ],
      };
      renderCalc();
      fireEvent.click(screen.getByTestId('add-sizing-side-toggle'));
      fireEvent.click(screen.getByTestId('add-sizing-side-LONG'));
    };

    it('S₁ = 130（盘口的对冲挂在 125，不是这条线）：已成交的空仓 3.33 币算已有，还要补挂 15 币 = 195 张 → 放不下，可下单量 0，不给按钮', () => {
      setup();
      type('add-sizing-s1', '130');
      const line = screen.getByTestId('add-sizing-tier-cap');
      expect(line.dataset.hedge).toBe('blocked');
      expect(line).toHaveTextContent('持仓和当前委托 3,500 USD / 最高 5,000 USD');
      expect(line).toHaveTextContent('最多再开 0 RAVE（0 张）');
      // 对冲这一侧：5,000 − 3,500 = 1,500 USD = 150 张 → 150 × 10 ÷ 130
      expect(line).toHaveTextContent('S₁ 130.0000 上还要补挂的对冲 15 RAVE / 195 张 已经放不下（对冲这一侧最多还能挂 11.5385 RAVE），先减仓或撤单，再谈加仓');
      expect(screen.queryByTestId('add-sizing-place-at-limit')).toBeNull();
      expect(getAddSizingPlan('RAVEUSDT')!.snapshot.contracts).toBeGreaterThan(0);
    });

    it('S₁ = 125（就是盘口那张对冲的线）：已挂 8 币 + 已成交 3.33 币都算已有 → 33 张（3,500 + 330 + 117 张 1,170 = 5,000）', () => {
      setup();
      type('add-sizing-s1', '125');
      const line = screen.getByTestId('add-sizing-tier-cap');
      expect(line.dataset.hedge).toBe('binds');
      expect(line).toHaveTextContent('最多再开 2.3571 RAVE（33 张）');
      expect(line).toHaveTextContent('单看加仓还能开 10.7143 RAVE');
      expect(screen.getByTestId('add-sizing-place-at-limit').textContent).toBe('按上限下单 · 33 张');
    });
  });

  it('U 本位市价：按引擎成交基准价估值、已有持仓时留 0.2% 余量；给 S₁ 上的对冲留位 → 84.81 币（14,000 + 140X + 130(100 + X) ≤ 49,900）', () => {
    scene.positions = [
      { id: 'u1', side: 'LONG', entryPrice: 100, quantity: 100, leverage: 5, marginMode: 'isolated', settlementMode: 'usdt', margin: 2_000, openTime: 1_000 },
    ];
    panel.leverageMap = { RAVEUSDT: 5 };
    renderCalc(140, { market: true, fillBasePrice: 140 });
    type('add-sizing-s1', '130');
    const line = screen.getByTestId('add-sizing-tier-cap');
    expect(line.dataset.binds).toBe('tier');
    expect(line).toHaveTextContent('最多再开 84.8148 RAVE');
    // 单看加仓：(50,000 − 14,000 − 100) ÷ 140
    expect(line).toHaveTextContent('单看加仓还能开 256.4286 RAVE');
    expect(line).toHaveTextContent('持仓和当前委托 14,000 USDT / 最高 50,000 USDT');
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('84.81');
    expect(screen.getByTestId('add-sizing-place-at-limit').textContent).toBe('按上限下单 · 84.81 RAVE');
    fireEvent.click(screen.getByTestId('add-sizing-place-at-limit'));
    const entry = getAddSizingPlan('RAVEUSDT')!;
    expect(entry.prefill!.coins).toBeCloseTo(22_900 / 270, 6);
    // 计划仍是 Plan B：Y₁ = 100 × 30 = 3,000 USD ÷ 险（含滑点）≈ 299 币
    expect(entry.snapshot.addCoinsMax).toBeGreaterThan(290);
  });

  it('分层已经没有余量（20x 最高 5,000，持仓 14,000）：可下单量为 0，不给按钮、不谈对冲；计划照样发布', () => {
    scene.positions = [
      { id: 'u1', side: 'LONG', entryPrice: 100, quantity: 100, leverage: 5, marginMode: 'isolated', settlementMode: 'usdt', margin: 2_000, openTime: 1_000 },
    ];
    panel.leverageMap = { RAVEUSDT: 20 };
    renderCalc(140, { market: true, fillBasePrice: 140 });
    type('add-sizing-s1', '130');
    const line = screen.getByTestId('add-sizing-tier-cap');
    expect(line).toHaveTextContent('当前 20x 最多再开 0 RAVE');
    expect(line.dataset.hedge).toBe('none');
    expect(line).not.toHaveTextContent('对冲');
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent(/^加仓上限 X₂ · 分层封顶0/);
    expect(screen.queryByTestId('add-sizing-place-at-limit')).toBeNull();
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot.addCoinsMax).toBeGreaterThan(290);
  });

  /**
   * 【复核 r7】分层余量被**计划的对冲**卡到 0 时，二分只收敛到判定用的相对容差
   * （豁免的底 3,000 币 × 1e-9 = 3e-6 币），于是「按上限下单 · 0 RAVE」的按钮照旧渲染，
   * 点下去预填 0.000003 币——面板取整之后是一张空数量的单，按钮是纯噪声。
   * 现在 U 本位也按下单面板的数量精度取整之后再判能不能下单（与币本位「≥ 1 张」同一条判据）。
   *
   * 盘面就是发布日最常见的那一张：更新前的 U 本位多仓 3,000 @0.8、现价 1、20x
   * （20x 上限 5,000 放得下加仓，但 S₁ 上的合计对冲 X₁ + X₂ 一过豁免的底 3,000 就放不下）。
   */
  it('对冲把分层余量卡到 0（只剩二分的容差）：不给按钮，不会预填一张 0 币的单；计划照样发布', () => {
    scene.positions = [
      { id: 'u1', side: 'LONG', entryPrice: 0.8, quantity: 3_000, leverage: 20, marginMode: 'isolated', settlementMode: 'usdt', margin: 120, isolatedMargin: 120, openTime: 1_000 },
    ];
    panel.leverageMap = { RAVEUSDT: 20 };
    renderCalc(1, { market: true, fillBasePrice: 1 });
    type('add-sizing-s1', '0.9');
    expect(screen.getByTestId('add-sizing-tier-cap')).toHaveTextContent('最多再开 0 RAVE');
    expect(screen.getByTestId('add-sizing-x2')).toHaveTextContent('分层封顶');
    expect(screen.queryByTestId('add-sizing-place-at-limit')).toBeNull();
    // 计划本身照旧发布（Plan B 的上限不受分层影响）
    expect(getAddSizingPlan('RAVEUSDT')!.snapshot.addCoinsMax).toBeGreaterThan(0);
  });

  it('保存的 125x（RAVE 最高 20x）按 20x 算：不会因为超过最高杠杆算出 0、藏掉按钮', () => {
    panel.leverageMap = { RAVEUSDT: 125 };
    renderCalc();
    type('add-sizing-s1', '130');
    const line = screen.getByTestId('add-sizing-tier-cap');
    expect(line).toHaveTextContent('分层上限：当前 20x 最多再开 2.2143 RAVE（31 张）');
    expect(screen.getByTestId('add-sizing-place-at-limit').textContent).toBe('按上限下单 · 31 张');
  });

  it('旋钮推出的计划加仓同样按分层封顶（定仓 X₂ᴮ = 7.2 → 38.33 + 7.2 = 45.53，封到 2.21）', () => {
    panel.leverageMap = { RAVEUSDT: 20 };
    renderCalc();
    type('add-sizing-s1', '130');
    type('add-sizing-g', '1.2');
    fireEvent.click(screen.getByTestId('add-sizing-knob-size'));
    type('add-sizing-x2b', '7.2');
    const planned = screen.getByTestId('add-sizing-planned-add');
    expect(planned).toHaveTextContent('2.21');
    expect(planned).not.toHaveTextContent('45.53');
    expect(planned).toHaveTextContent('已按分层封顶');
    // 对冲扛起的是实际要下的量：18.33 + 2.21
    expect(screen.getByTestId('add-sizing-total-hedge-hero')).toHaveTextContent('20.55');
  });

  it('没有按成交价定量的结果（fillPlan 为空）时，Plan A 的大字与对冲同样按分层封顶', () => {
    fillSeam.none = true;
    panel.leverageMap = { RAVEUSDT: 20 };
    renderCalc();
    type('add-sizing-s1', '130');
    const x2 = screen.getByTestId('add-sizing-x2');
    expect(x2).toHaveTextContent('分层封顶');
    expect(x2).toHaveTextContent('2.21');
    expect(x2).not.toHaveTextContent('38.33');
    expect(x2).toHaveTextContent('31 张');
    expect(screen.getByTestId('add-sizing-hedge')).toHaveTextContent('20.55');
    // 没有计划：不发布、不给按钮
    expect(screen.queryByTestId('add-sizing-place-at-limit')).toBeNull();
  });
});
