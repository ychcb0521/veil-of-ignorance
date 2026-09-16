import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import type { TradeJournal } from '@/types/journal';

/**
 * 【用户要求】交易战役 Legs 的「币量 / 仓位」后面再加一列：币量 / 仓位占总币量 / 仓位的百分比。
 * 上行币量占比、下行名义仓位占比；分母取「币量 / 仓位」格显示的同一组数，状态为「挂单中」的腿不计入。
 */
const legFor = (over: Partial<TradeJournal> & { id: string }): TradeJournal => ({
  user_id: 'u', trade_record_id: null, campaign_id: 'c', leg_role: 'main_open', leg_sequence: 1,
  source: 'retroactive_from_record', symbol: 'XUSDT', direction: 'long', leverage: 10, position_mode: 'isolated',
  order_kind: 'main', pre_simulated_time: '2026-08-07T01:00:00.000Z',
  created_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z',
  ...over,
} as TradeJournal);

const renderList = (legs: TradeJournal[]) => render(
  <MemoryRouter>
    <CampaignLegsList legs={legs} tradeRecords={[]} initialExpectedMaxLoss={20_000} />
  </MemoryRouter>,
);

const at = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;

/** 用户截图里的四条腿（币量 / 名义仓位）。开仓价按「名义 ÷ 币量」反推，页面折回来的币量就是截图上的数。 */
const SCREENSHOT = [
  { id: 'main', role: 'main_open', coins: 27_603_119.02, notional: 3_015_630 },
  { id: 'add1', role: 'main_add_1', coins: 10_128_701.13, notional: 1_164_280 },
  { id: 'add2', role: 'main_add_2', coins: 6_374_254.98, notional: 751_560 },
  { id: 'add3', role: 'main_add_3', coins: 34_936_760.27, notional: 4_049_570 },
] as const;

const screenshotLegs = () => SCREENSHOT.map((row, index) => legFor({
  id: row.id,
  leg_sequence: index + 1,
  leg_role: row.role,
  pre_simulated_time: at(`0${index + 1}:00`),
  pre_entry_price: row.notional / row.coins,
  pre_position_size: row.notional,
  post_exit_price_snapshot: (row.notional / row.coins) * 1.1,
  post_simulated_close_time: at('09:00'),
}));

/** 挂单中：对冲还没成交、没有平仓信息——不是仓位。 */
const pendingHedge = legFor({
  id: 'pending-hedge', leg_sequence: 9, leg_role: 'hedge_initial_a', order_kind: 'hedge', direction: 'short',
  pre_simulated_time: at('05:00'), pre_entry_price: 0.1, pre_position_size: 5_000_000,
});

const headerCells = () => Array.from(screen.getByText('占比').parentElement!.children);
const lines = (testId: string) => Array.from(screen.getByTestId(testId).children).map(el => el.textContent);
const coinCell = (id: string) => screen.getByTestId(`leg-position-share-${id}`).previousElementSibling!;

describe('Legs 列表的「占比」列', () => {
  it('表头紧跟在「币量 / 仓位」之后、「加仓校验」之前，右对齐，tooltip 说明两个分母与挂单中的排除', () => {
    renderList(screenshotLegs());
    const titles = headerCells().map(el => el.textContent);
    const col = titles.indexOf('占比');
    expect(titles.slice(col - 1, col + 2)).toEqual(['币量 / 仓位', '占比', '加仓校验']);
    const header = screen.getByText('占比');
    expect(header.className).toContain('text-right');
    expect(header.getAttribute('title')).toBe(
      '上行：本腿币量占本场各腿币量合计的百分比；下行：本腿名义仓位占本场各腿名义仓位合计的百分比。'
      + '状态为「挂单中」的对冲 / 镜像腿（还没有成交或平仓记录）不计入合计，显示「—」。合计行给出两个分母。',
    );
  });

  it('截图里的四条腿：上行币量占比、下行名义仓位占比，与「币量 / 仓位」格逐腿对应', () => {
    renderList(screenshotLegs());
    // 左边一格就是截图上的数
    expect(Array.from(coinCell('main').children).map(el => el.textContent)).toEqual(['27,603,119.02', '3015630.00']);
    expect(Array.from(coinCell('add3').children).map(el => el.textContent)).toEqual(['34,936,760.27', '4049570.00']);

    expect(lines('leg-position-share-main')).toEqual(['34.9%', '33.6%']);
    expect(lines('leg-position-share-add1')).toEqual(['12.8%', '13.0%']);
    expect(lines('leg-position-share-add2')).toEqual(['8.1%', '8.4%']);
    expect(lines('leg-position-share-add3')).toEqual(['44.2%', '45.1%']);

    const sum = (index: 0 | 1) => SCREENSHOT
      .map(row => Number.parseFloat(lines(`leg-position-share-${row.id}`)[index]!))
      .reduce((total, pct) => total + pct, 0);
    expect(sum(0)).toBeCloseTo(100.0, 6);
    // 各行分别取一位小数：33.578 + 12.964 + 8.368 + 45.090 = 100，印出来是 100.1（舍入误差，未平摊）
    expect(sum(1)).toBeCloseTo(100.1, 6);

    // 合计行：Σ币量 / Σ名义仓位，占比 100.0% / 100.0%
    expect(lines('legs-total-position')).toEqual(['79,042,835.4', '8981040.00']);
    expect(lines('legs-total-position-share')).toEqual(['100.0%', '100.0%']);
  });

  it('中性色：上行与币量同色（前景），下行与名义仓位同样淡；不上红绿', () => {
    renderList(screenshotLegs());
    const cell = screen.getByTestId('leg-position-share-main');
    const coins = coinCell('main');
    expect(cell.className).toContain('text-right');
    expect(cell.className).toContain('tabular-nums');
    expect(cell.className).not.toMatch(/#0ECB81|#F6465D/);
    expect(cell.children[0].className).toBe(coins.children[0].className);
    expect(cell.children[1].className).toBe(coins.children[1].className);
    expect(cell.children[1].className).toContain('text-muted-foreground');
    // 行本身是等宽字：上行与左边的币量一样是 mono
    expect(cell.parentElement!.className).toContain('font-mono');
  });

  it('状态为「挂单中」的腿：两行都是「—」，不进分母——其余四条的占比与合计一个不变', () => {
    renderList([...screenshotLegs(), pendingHedge]);
    expect(screen.getByText('挂单中')).toBeTruthy();
    // 「币量 / 仓位」格照常显示它的币量与名义
    expect(Array.from(coinCell('pending-hedge').children).map(el => el.textContent)).toEqual(['50,000,000', '5000000.00']);
    expect(lines('leg-position-share-pending-hedge')).toEqual(['—', '—']);
    expect(lines('leg-position-share-main')).toEqual(['34.9%', '33.6%']);
    expect(lines('leg-position-share-add3')).toEqual(['44.2%', '45.1%']);
    expect(lines('legs-total-position')).toEqual(['79,042,835.4', '8981040.00']);
    expect(lines('legs-total-position-share')).toEqual(['100.0%', '100.0%']);
  });

  it('缺开仓价的腿：上行「—」、不进币量合计；名义仓位照样进下行的分母', () => {
    const legs = [
      legFor({
        id: 'priced', pre_entry_price: 2, pre_position_size: 600,
        post_exit_price_snapshot: 2.2, post_simulated_close_time: at('09:00'),
      }),
      legFor({
        id: 'no-price', leg_sequence: 2, leg_role: 'main_add_1', pre_simulated_time: at('02:00'),
        pre_entry_price: null, pre_position_size: 400, post_simulated_close_time: at('09:00'),
      }),
    ];
    renderList(legs);
    expect(Array.from(coinCell('no-price').children).map(el => el.textContent)).toEqual(['—', '400.00']);
    expect(lines('leg-position-share-no-price')).toEqual(['—', '40.0%']);
    expect(lines('leg-position-share-priced')).toEqual(['100.0%', '60.0%']);
    expect(lines('legs-total-position')).toEqual(['300', '1000.00']);
    expect(lines('legs-total-position-share')).toEqual(['100.0%', '100.0%']);
  });

  it('一条都不计入：合计行两格都是「—」，不印 100.0%', () => {
    renderList([pendingHedge]);
    expect(lines('leg-position-share-pending-hedge')).toEqual(['—', '—']);
    expect(lines('legs-total-position')).toEqual(['—', '—']);
    expect(lines('legs-total-position-share')).toEqual(['—', '—']);
  });

  it('指南的 Legs 列表条目写明「占比」的两个分母、挂单中的排除与合计行', () => {
    const guide = readFileSync(join(process.cwd(), 'src/pages/GuidePage.tsx'), 'utf8');
    const bullet = guide.slice(guide.indexOf('<li><strong>Legs 列表每条腿都标明'));
    const clause = bullet.slice(bullet.indexOf('<strong>「占比」</strong>'), bullet.indexOf('「委托」列按真实业务归属呈现'));
    expect(clause.length).toBeGreaterThan(0);
    expect(clause).toContain('币量合计');
    expect(clause).toContain('名义仓位合计');
    expect(clause).toContain('状态为「挂单中」的对冲 / 镜像腿（还没有成交或平仓记录）不计入合计');
    expect(clause).not.toContain('未成交');
    expect(clause).toContain('合计行');
    expect(clause).toContain('100.0%');
    // 逐行舍入的误差没有固定上限：六条等额腿就印成 6 × 16.7% = 100.2%，不能写成「最多差 0.1」
    expect(clause).not.toContain('差 0.1');
    expect(clause).toContain('逐行相加不一定恰好是 100.0%');
    expect(clause).toContain('16.7%');
    // 合计行的 100.0% 不是无条件的：分母没有可加的腿时两格都是「—」
    expect(clause).toContain('一条腿都不计入时');
    expect(clause).toMatch(/一条腿都不计入时[^；。]*「—」/);
    // 分母按未舍入的原值相加，各行与合计行各自取两位小数：手工把印出来的数加起来，末位可能对不上
    expect(clause).not.toContain('加的就是「币量 / 仓位」列显示的那些数');
    expect(clause).toContain('未舍入');
  });

  it('指南的「加仓校验」条目不再说它紧跟「币量 / 仓位」：两者之间隔着「占比」', () => {
    const guide = readFileSync(join(process.cwd(), 'src/pages/GuidePage.tsx'), 'utf8');
    const start = guide.indexOf('<li><strong>「加仓校验」列</strong>');
    expect(start).toBeGreaterThan(-1);
    const bullet = guide.slice(start, guide.indexOf('</li>', start));
    expect(bullet).not.toContain('（紧跟「币量 / 仓位」）');
    expect(bullet).toContain('「占比」');
    // 与页面表头顺序一致：币量 / 仓位 → 占比 → 加仓校验
    renderList(screenshotLegs());
    const titles = headerCells().map(el => el.textContent);
    expect(titles.indexOf('占比')).toBe(titles.indexOf('币量 / 仓位') + 1);
    expect(titles.indexOf('加仓校验')).toBe(titles.indexOf('占比') + 1);
  });

  it('六条等额的腿各印 16.7%：逐行相加是 100.2%，合计行照样写 100.0%（各行分别取一位小数，不平摊）', () => {
    const roles = ['main_open', 'main_add_1', 'main_add_2', 'main_add_3', 'main_add_4', 'main_add_5'] as const;
    renderList(roles.map((role, index) => legFor({
      id: `eq${index}`,
      leg_sequence: index + 1,
      leg_role: role,
      pre_simulated_time: at(`0${index + 1}:00`),
      pre_entry_price: 2,
      pre_position_size: 1_000,
      post_exit_price_snapshot: 2.2,
      post_simulated_close_time: at('09:00'),
    })));
    for (let index = 0; index < 6; index += 1) {
      expect(lines(`leg-position-share-eq${index}`)).toEqual(['16.7%', '16.7%']);
    }
    expect(lines('legs-total-position')).toEqual(['3,000', '6000.00']);
    expect(lines('legs-total-position-share')).toEqual(['100.0%', '100.0%']);
  });

  describe('主力阶段子行与合计行', () => {
    const phaseLegs = [
      legFor({
        id: 'main', leg_sequence: 1, pre_simulated_time: at('01:00'), pre_entry_price: 0.0336792, pre_position_size: 94_300,
        post_exit_price_snapshot: 0.0677819, post_simulated_close_time: at('09:00'), post_realized_pnl: 95_439.77,
      }),
      // 主力持仓期间开出又平掉的滚动对冲：在 0.052 把主力切成两段
      legFor({
        id: 'hedge-roll', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
        pre_simulated_time: at('03:00'), pre_entry_price: 0.05, pre_position_size: 50_000,
        post_exit_price_snapshot: 0.052, post_simulated_close_time: at('05:00'), post_realized_pnl: -2_000,
      }),
    ];

    it('阶段子行这一格留空；合计行在「币量 / 仓位」写两个分母、在「占比」写 100.0%', () => {
      renderList(phaseLegs);
      const titles = headerCells().map(el => el.textContent);
      const coinsCol = titles.indexOf('币量 / 仓位');
      const shareCol = titles.indexOf('占比');
      expect(shareCol).toBe(coinsCol + 1);

      // 已平仓的对冲是仓位，计入：94,300 ÷ 0.0336792 = 2,799,947.74 币；50,000 ÷ 0.05 = 1,000,000 币
      expect(lines('leg-position-share-main')).toEqual(['73.7%', '65.3%']);
      expect(lines('leg-position-share-hedge-roll')).toEqual(['26.3%', '34.7%']);

      const phaseRows = Array.from(screen.getByTestId('leg-phases-main').children);
      expect(phaseRows.length).toBeGreaterThanOrEqual(2);
      for (const row of phaseRows) {
        expect(row.children[shareCol].textContent).toBe('');
        expect(row.children[shareCol].children).toHaveLength(0);
        expect(row.children[coinsCol].textContent).toBe('');
      }

      const total = screen.getByTestId('legs-total-row');
      expect(total.children[coinsCol]).toBe(screen.getByTestId('legs-total-position'));
      expect(total.children[shareCol]).toBe(screen.getByTestId('legs-total-position-share'));
      expect(lines('legs-total-position')).toEqual(['3,799,947.74', '144300.00']);
      expect(lines('legs-total-position-share')).toEqual(['100.0%', '100.0%']);
      // 合计行这两格是淡色、不上红绿
      for (const id of ['legs-total-position', 'legs-total-position-share']) {
        const cell = screen.getByTestId(id);
        expect(cell.className).toContain('text-foreground/55');
        expect(cell.className).not.toMatch(/#0ECB81|#F6465D/);
        expect(cell.children[1].className).toContain('text-muted-foreground');
      }
      // 加仓校验那一格仍留空
      expect(total.children[shareCol + 1].textContent).toBe('');
    });

    it('表头、腿行、阶段子行、合计行的格子数一致，「占比」格都落在同一列', () => {
      renderList([...phaseLegs, pendingHedge]);
      const count = headerCells().length;
      expect(count).toBe(14);
      const shareCol = headerCells().map(el => el.textContent).indexOf('占比');
      for (const id of ['main', 'hedge-roll', 'pending-hedge']) {
        const cell = screen.getByTestId(`leg-position-share-${id}`);
        expect(cell.parentElement!.children).toHaveLength(count);
        expect(cell.parentElement!.children[shareCol]).toBe(cell);
      }
      for (const row of Array.from(screen.getByTestId('leg-phases-main').children)) {
        expect(row.children).toHaveLength(count);
      }
      expect(screen.getByTestId('legs-total-row').children).toHaveLength(count);
    });
  });
});
