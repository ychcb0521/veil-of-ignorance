import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import type { TradeJournal } from '@/types/journal';
import { calcSlippage, type AddSizingSnapshot, type CampaignReverseHedgeOrder, type TradeRecord } from '@/types/trading';

/**
 * 【用户要求】Legs 增加「加仓校验」列：合规用几乎隐形的对号，
 * 仓位过大用很明显的红色、放大的叉。
 */
/** 成本线式复核的注入口：两条路在数学上恒等，只能把成本线算坏才能看到「对不上」时格子长什么样。 */
const costLineSeam = vi.hoisted(() => ({ offset: 0 }));
vi.mock('@/lib/addSizing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/addSizing')>('@/lib/addSizing');
  return {
    ...actual,
    evaluatePostAddCostLine: (args: Parameters<typeof actual.evaluatePostAddCostLine>[0]) => {
      const post = actual.evaluatePostAddCostLine(args);
      return post && costLineSeam.offset ? { ...post, blendedCost: post.blendedCost + costLineSeam.offset } : post;
    },
  };
});

const legFor = (over: Partial<TradeJournal> & { id: string }): TradeJournal => ({
  user_id: 'u', trade_record_id: null, campaign_id: 'c', leg_role: 'main_open', leg_sequence: 1,
  source: 'retroactive_from_record', symbol: 'TUTUSDT', direction: 'long', leverage: 10, position_mode: 'isolated',
  order_kind: 'main', pre_simulated_time: '2026-08-07T19:41:00+08:00',
  created_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z',
  ...over,
} as TradeJournal);

// TUTUSDT 2026-08-08：主力 94,300 @0.0336792；镜像 00:36 落袋 15,117.55；加仓1 2,205 万 @0.0419705
const legs = (addNotional: number) => [
  legFor({
    id: 'main', leg_sequence: 1, pre_entry_price: 0.0336792, pre_position_size: 94_300,
    post_simulated_close_time: '2026-08-09T01:46:00+08:00', post_exit_price_snapshot: 0.0677819,
  }),
  legFor({
    id: 'mirror', leg_sequence: 2, leg_role: 'mirror_tp', pre_entry_price: 0.0336792,
    pre_position_size: 141_460, post_simulated_close_time: '2026-08-08T00:36:00+08:00', post_realized_pnl: 15_117.55,
  }),
  legFor({
    id: 'add1', leg_sequence: 3, leg_role: 'main_add_1', pre_simulated_time: '2026-08-08T12:02:00+08:00',
    pre_entry_price: 0.0419705, pre_position_size: addNotional,
  }),
];
const orders: CampaignReverseHedgeOrder[] = [{
  id: 'stop', side: 'SHORT', price: 0.034726, status: 'cancelled',
  createdAt: Date.parse('2026-08-08T12:01:00+08:00'), triggeredAt: null,
  cancelledAt: Date.parse('2026-08-08T15:18:00+08:00'),
}];

const renderList = (addNotional: number, reverseHedgeOrders = orders) => render(
  <MemoryRouter>
    <CampaignLegsList legs={legs(addNotional)} tradeRecords={[]} reverseHedgeOrders={reverseHedgeOrders} initialExpectedMaxLoss={1_000} />
  </MemoryRouter>,
);

describe('Legs 列表的「加仓校验」列', () => {
  it('表头紧跟在「币量 / 仓位」及其「占比」之后', () => {
    renderList(22_057_330);
    const header = screen.getByText('加仓校验');
    const coins = screen.getByText('币量 / 仓位');
    const fees = screen.getByText('手续费');
    expect(coins.nextElementSibling).toBe(screen.getByText('占比'));
    expect(coins.nextElementSibling!.nextElementSibling).toBe(header);
    expect(header.nextElementSibling).toBe(fees);
    expect(header.getAttribute('title')).toContain('X₂(S₂ − S₁)');
  });

  it('【回归】TUTUSDT 加仓1 仓位过大：红色放大的叉 + 正确币量上限 + U 折算额', () => {
    renderList(22_057_330);
    const mark = screen.getByTestId('add-sizing-check-fail-add1');
    expect(mark.className).toContain('text-[#F6465D]');
    const cross = mark.firstElementChild!;
    expect(cross.textContent).toBe('✗');
    expect(cross.className).toContain('text-[18px]');
    expect(cross.className).toContain('font-bold');
    expect(mark.textContent).toMatch(/上限 [\d,.]+ 币/);
    expect(mark.textContent).toMatch(/≈ [\d,.]+ U/);
    expect(mark.textContent).toContain('点击看计算');
    expect(mark.getAttribute('title')).toBeNull();
    expect(mark.getAttribute('aria-label')).toContain('仓位过大');
    expect(mark.getAttribute('aria-label')).toContain('U 名义仓位');
    expect(screen.queryByTestId('add-sizing-check-ok-add1')).toBeNull();
  });

  it('点击红叉：弹窗说清正确数是币量，同时给出 U 名义仓位与完整 Plan B 过程', () => {
    renderList(22_057_330);
    fireEvent.click(screen.getByTestId('add-sizing-check-fail-add1'));

    const dialog = screen.getByTestId('add-sizing-detail-dialog');
    expect(dialog.textContent).toContain('“正确加仓”指 Plan B 允许的最大币量');
    expect(screen.getByTestId('add-sizing-correct-coins').textContent).toMatch(/[\d,.]+ 币/);
    expect(screen.getByTestId('add-sizing-correct-notional').textContent).toMatch(/[\d,.]+ U 名义仓位/);
    expect(dialog.textContent).toContain('① 旧仓浮盈垫 Y₁');
    expect(dialog.textContent).toContain('② 已落袋 G');
    expect(dialog.textContent).toContain('④ 每币风险');
    expect(dialog.textContent).toContain('⑤ 正确币量上限');
    expect(dialog.textContent).toContain('实际新仓最大预期亏损');
  });

  it('仓位合规：几乎隐形的小对号，不带红色', () => {
    // 浮盈垫 ≈ 2,931 + 落袋 15,117.55 ≈ 18,049；每币退回 S₁ 亏 0.0072445 → 两百万币以内都兜得住
    renderList(2_000_000 * 0.0419705);
    const mark = screen.getByTestId('add-sizing-check-ok-add1');
    expect(mark.textContent).toBe('✓');
    expect(mark.className).toContain('text-muted-foreground/30');
    expect(mark.className).not.toContain('#F6465D');
    expect(mark.getAttribute('title')).toBeNull();
    expect(screen.queryByTestId('add-sizing-check-fail-add1')).toBeNull();
  });

  it('读不到止损线：淡灰「—」', () => {
    renderList(22_057_330, []);
    const mark = screen.getByTestId('add-sizing-check-unknown-add1');
    expect(mark.textContent).toBe('—');
    expect(mark.className).toContain('text-muted-foreground/30');
  });

  it('非加仓行不打任何标记', () => {
    renderList(22_057_330);
    for (const id of ['main', 'mirror']) {
      expect(screen.queryByTestId(`add-sizing-check-ok-${id}`)).toBeNull();
      expect(screen.queryByTestId(`add-sizing-check-fail-${id}`)).toBeNull();
      expect(screen.queryByTestId(`add-sizing-check-unknown-${id}`)).toBeNull();
    }
  });

  it('每一行的格子数与表头一致：加列没有让合计行错位', () => {
    renderList(22_057_330);
    const headerCells = screen.getByText('加仓校验').parentElement!.children.length;
    expect(headerCells).toBe(14);
    expect(screen.getByTestId('legs-total-row').children.length).toBe(headerCells);
    const addRow = screen.getByTestId('add-sizing-check-fail-add1').parentElement!;
    expect(addRow.children.length).toBe(headerCells);
  });

  it('读屏读得到明细：红叉是可操作按钮，aria-label 包含上限与口径', () => {
    renderList(22_057_330);
    const fail = screen.getByRole('button', { name: /加仓校验：仓位过大/ });
    expect(fail).toBe(screen.getByTestId('add-sizing-check-fail-add1'));
    expect(fail.getAttribute('aria-label')).toContain('浮盈垫');
    expect(fail.getAttribute('aria-label')).toContain('已落袋');
    expect(fail.getAttribute('aria-label')).toContain('加仓上限');
  });

  it('合规与无法判断的记号同样带 role="img"', () => {
    const { unmount } = renderList(2_000_000 * 0.0419705);
    expect(screen.getByRole('img', { name: /加仓校验：仓位合规/ })).toBe(screen.getByTestId('add-sizing-check-ok-add1'));
    unmount();
    renderList(22_057_330, []);
    expect(screen.getByRole('img', { name: /加仓校验：无法判断/ })).toBe(screen.getByTestId('add-sizing-check-unknown-add1'));
  });

  it('主力阶段子行也补了这一格：每个阶段子行与表头格子数一致', () => {
    const at = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;
    const phaseLegs = [
      legFor({
        id: 'main', leg_sequence: 1, pre_simulated_time: at('01:00'), pre_entry_price: 0.0336792, pre_position_size: 94_300,
        post_exit_price_snapshot: 0.0677819, post_simulated_close_time: at('09:00'), post_realized_pnl: 95_439.77,
      }),
      // 主力持仓期间开出又平掉的滚动对冲：把主力切成两段
      legFor({
        id: 'hedge-roll', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
        pre_simulated_time: at('03:00'), pre_entry_price: 0.05, pre_position_size: 50_000,
        post_exit_price_snapshot: 0.052, post_simulated_close_time: at('05:00'), post_realized_pnl: -2_000,
      }),
    ];
    render(
      <MemoryRouter>
        <CampaignLegsList legs={phaseLegs} tradeRecords={[]} initialExpectedMaxLoss={20_000} />
      </MemoryRouter>,
    );
    const headerCells = screen.getByText('加仓校验').parentElement!.children.length;
    const phaseRows = Array.from(screen.getByTestId('leg-phases-main').children);
    expect(phaseRows.length).toBeGreaterThanOrEqual(2);
    for (const row of phaseRows) expect(row.children.length).toBe(headerCells);
  });
});

describe('两套算法对不上时的「加仓校验」格', () => {
  afterEach(() => { costLineSeam.offset = 0; });

  it('【回归】不给 ✓ 也不给 ✗，只留淡灰「—」，读屏说明两种算法结果不一致', () => {
    // 本来合规的两百万币；成本线抬高 0.001 → 近 480 万币 × 0.001 ≈ 4,800 U 的分歧
    costLineSeam.offset = 0.001;
    renderList(2_000_000 * 0.0419705);
    expect(screen.queryByTestId('add-sizing-check-ok-add1')).toBeNull();
    expect(screen.queryByTestId('add-sizing-check-fail-add1')).toBeNull();
    const mark = screen.getByTestId('add-sizing-check-unknown-add1');
    expect(mark.textContent).toBe('—');
    expect(mark.getAttribute('aria-label')).toContain('两种算法结果不一致');
    expect(mark.getAttribute('aria-label')).toContain('垫子式缺口');
    expect(mark.getAttribute('aria-label')).toContain('成本线式缺口');
  });
});

/**
 * 成交记录带着加仓计算器当时的计划：点开红叉的计算框并排写出「计算时 / 实际成交」，
 * 再说超出从哪来——真是滑点才点名滑点。判定本身仍按成交价。
 * COMMONUSDT 加仓 1：主力 10,346,400 @0.006974，镜像落袋 55,994,538.5 COMMON，S₁ 0.007069，
 * 计算时现价 0.00770146、成交 0.0077123（+0.14%）、实际 653,602 张。
 *   · 那一场的计划按现价、不计滑点（限价档，上限 848,689,579 币）→ 超出全部来自滑点；
 *   · 市价档计划已含 +0.14%（上限 834,590,798 币），同一笔就是量超了计划。
 */
describe('计算框里的计算器快照', () => {
  const T0 = Date.parse('2026-09-01T10:00:00+08:00');
  const MIN = 60_000;
  const T_ADD1 = T0 + 61 * MIN;
  const iso = (ms: number) => new Date(ms).toISOString();
  const FILL = 0.0077123;
  const REF = FILL / (1 + 0.0001 + 6_536_020 / 5e9);
  const common = {
    at: T_ADD1, plan: 'B', side: 'LONG', settlement: 'coin', s1: 0.007069, s2Ref: REF, s2AtOrder: REF,
    x1: 1_483_567_536.56, sBar: 0.006974, g: 55_994_538.5, gUnit: 'COMMON',
  } as const;
  const limitPlan: AddSizingSnapshot = { ...common, s2Fill: REF, slippagePct: 0, addCoinsMax: 848_689_579.33, contracts: 653_615, orderKind: 'limit' };
  const marketPlan: AddSizingSnapshot = { ...common, s2Fill: 0.0077121467, slippagePct: 0.1388, addCoinsMax: 834_590_798, contracts: 643_648, orderKind: 'market' };
  const commonLegs = (addNotional: number, fill = FILL) => [
    legFor({ id: 'main', symbol: 'COMMONUSDT', leg_sequence: 1, pre_simulated_time: iso(T0), pre_entry_price: 0.006974, pre_position_size: 10_346_400 }),
    legFor({
      id: 'mirror', symbol: 'COMMONUSDT', leg_sequence: 2, leg_role: 'mirror_tp', pre_simulated_time: iso(T0), pre_entry_price: 0.006974,
      pre_position_size: 15_519_600, post_simulated_close_time: iso(T0 + 12 * MIN), post_realized_pnl: 55_994_538.5 * 0.007069,
    }),
    legFor({
      id: 'add1', symbol: 'COMMONUSDT', leg_sequence: 3, leg_role: 'main_add_1', trade_record_id: 'rec-add1',
      pre_simulated_time: iso(T_ADD1), pre_entry_price: fill, pre_position_size: addNotional,
    }),
  ];
  const recordFor = (addNotional: number, snap: AddSizingSnapshot | undefined, fill = FILL): TradeRecord => ({
    id: 'rec-add1', symbol: 'COMMONUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice: fill, exitPrice: 0.00742559,
    quantity: addNotional / 10, contracts: addNotional / 10, leverage: 5, pnl: -246_249, fee: 0, slippage: 0,
    openTime: T_ADD1, closeTime: T_ADD1 + 47 * MIN, settlementMode: 'coin', contractSizeUsd: 10,
    ...(snap ? { addSizingSnapshot: snap } : {}),
  });
  const commonOrders: CampaignReverseHedgeOrder[] = [{
    id: 'stop', side: 'SHORT', price: 0.007069, status: 'cancelled', createdAt: T_ADD1 - MIN, triggeredAt: null, cancelledAt: T_ADD1 + 24 * MIN,
  }];
  const renderCommon = (addNotional: number, snap: AddSizingSnapshot | undefined, fill = FILL) => render(
    <MemoryRouter>
      <CampaignLegsList legs={commonLegs(addNotional, fill)} tradeRecords={[recordFor(addNotional, snap, fill)]} reverseHedgeOrders={commonOrders} initialExpectedMaxLoss={1_000} />
    </MemoryRouter>,
  );

  it('【回归】COMMONUSDT 加仓 1（按现价、不计滑点定的量）：红叉照打；计算框写出计算时 / 实际成交两行，并点名超出全部来自成交滑点 +0.14%', () => {
    renderCommon(6_536_020, limitPlan);
    const mark = screen.getByTestId('add-sizing-check-fail-add1');
    // 限价计划的 s2Ref 是手填的限价，不叫「现价」（三审）
    expect(mark.getAttribute('aria-label')).toContain('计算时 限价 0.00770146');
    expect(mark.getAttribute('aria-label')).not.toContain('现价');
    expect(mark.getAttribute('aria-label')).toContain('超出部分全部来自成交滑点 +0.14%');
    fireEvent.click(mark);
    const dialog = screen.getByTestId('add-sizing-detail-dialog');
    const line = screen.getByTestId('add-sizing-snapshot-line');
    expect(line.textContent).toContain('加仓计算器当时的计划（限价 @S₂）');
    expect(line.textContent).toContain('计算时 限价 0.00770146，挂单价 0.00770146（限价），上限 848,689,579.33 币；');
    expect(line.textContent).not.toContain('现价');
    expect(line.textContent).toMatch(/实际成交 0\.00771230（\+0\.14%），上限 834,391,89\d(\.\d+)? 币。/);
    expect(screen.getByTestId('add-sizing-slippage-line').textContent).toBe('超出部分全部来自成交滑点 +0.14%（计划按限价、不计滑点，这张却是吃单成交）。');
    expect(screen.queryByTestId('add-sizing-cause-line')).toBeNull();
    expect(screen.queryByTestId('add-sizing-order-line')).toBeNull();
    // 判定本身没变：上限仍是成交价上的那个数
    expect(screen.getByTestId('add-sizing-correct-coins').textContent).toMatch(/^834,391,89\d(\.\d+)? 币$/);
    expect(dialog.textContent).toContain('⑤ 正确币量上限');
  });

  it('【回归 · 复审】市价计划（已含滑点）却下了 653,602 张：计算框说量超了计划 +1.55%，不点名滑点', () => {
    renderCommon(6_536_020, marketPlan);
    const mark = screen.getByTestId('add-sizing-check-fail-add1');
    expect(mark.getAttribute('aria-label')).not.toContain('全部来自成交滑点');
    expect(mark.getAttribute('aria-label')).toContain('实际加仓比计算时的上限多 +1.55%');
    fireEvent.click(mark);
    const line = screen.getByTestId('add-sizing-snapshot-line');
    expect(line.textContent).toContain('加仓计算器当时的计划（市价 · 含滑点）');
    expect(line.textContent).toContain('计算时 现价 0.00770146，预计成交 0.00771215（+0.14%），上限 834,590,798 币；');
    expect(screen.queryByTestId('add-sizing-slippage-line')).toBeNull();
    expect(screen.getByTestId('add-sizing-cause-line').textContent).toBe('实际加仓比计算时的上限多 +1.55%——超出来自仓位本身，不是滑点。');
  });

  it('下单时价格已经变了：多出一行「下单时 参考价」，原因写计算后价格变动', () => {
    // 按计划的整张（643,648）下，引擎在已涨 0.2% 的基准价上成交
    renderCommon(6_436_480, { ...marketPlan, s2AtOrder: REF * 1.002 }, calcSlippage(REF * 1.002, 6_436_480, 'LONG'));
    fireEvent.click(screen.getByTestId('add-sizing-check-fail-add1'));
    expect(screen.getByTestId('add-sizing-order-line').textContent).toBe('下单时 参考价 0.00771687（计算后价格变动 +0.20%）；');
    expect(screen.getByTestId('add-sizing-cause-line').textContent).toMatch(/^超出来自计算后的价格变动 \+0\.20%：/);
    expect(screen.queryByTestId('add-sizing-slippage-line')).toBeNull();
  });

  it('【回归 · 三审】条件委托计划（突破加仓）的触发价挂高了 0.2%：抬头写「条件委托 @S₂ · 触发后市价」，计算时写触发价，原因写触发价偏离', () => {
    const TRIG = 0.0077015;
    const conditionalPlan: AddSizingSnapshot = {
      ...common, s2Ref: TRIG, s2AtOrder: TRIG * 1.002, s2Fill: 0.0077121837, slippagePct: 0.1387,
      addCoinsMax: 834_542_712.37, contracts: 643_614, orderKind: 'conditional',
    };
    renderCommon(6_436_140, conditionalPlan, calcSlippage(TRIG * 1.002, 6_436_140, 'LONG'));
    fireEvent.click(screen.getByTestId('add-sizing-check-fail-add1'));
    const line = screen.getByTestId('add-sizing-snapshot-line');
    expect(line.textContent).toContain('加仓计算器当时的计划（条件委托 @S₂ · 触发后市价，含滑点）');
    expect(line.textContent).toContain('计算时 触发价 0.00770150，预计成交 0.00771218（+0.14%），上限 834,542,712.37 币；');
    expect(line.textContent).not.toContain('现价');
    expect(screen.getByTestId('add-sizing-order-line').textContent).toBe('下单时 参考价 0.00771690（触发价偏离计划触发价 +0.20%）；');
    expect(screen.getByTestId('add-sizing-cause-line').textContent).toMatch(/^超出来自触发价偏离计划触发价 \+0\.20%：.*改了触发价就按新触发价重算。$/);
    expect(screen.queryByTestId('add-sizing-slippage-line')).toBeNull();
  });

  it('实际量连参考价的上限都超了：两行照写，不说「全部来自滑点」', () => {
    renderCommon(6_536_020 * 1.05, limitPlan);
    fireEvent.click(screen.getByTestId('add-sizing-check-fail-add1'));
    expect(screen.getByTestId('add-sizing-snapshot-line').textContent).toContain('计算时 限价 0.00770146');
    expect(screen.queryByTestId('add-sizing-slippage-line')).toBeNull();
    expect(screen.getByTestId('add-sizing-cause-line').textContent).toContain('超出来自仓位本身，不是滑点');
  });

  it('没有快照的记录：计算框与之前一样，不多说一个字', () => {
    renderCommon(6_536_020, undefined);
    const mark = screen.getByTestId('add-sizing-check-fail-add1');
    expect(mark.getAttribute('aria-label')).not.toContain('计算时');
    fireEvent.click(mark);
    expect(screen.getByTestId('add-sizing-detail-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('add-sizing-snapshot-line')).toBeNull();
    expect(screen.queryByTestId('add-sizing-slippage-line')).toBeNull();
    expect(screen.queryByTestId('add-sizing-cause-line')).toBeNull();
  });
});
