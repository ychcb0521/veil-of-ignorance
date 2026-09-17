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
 *
 * 【用户要求 · 续】「对冲的要单独算，因为对冲的单是空单。空单放在一起计算，多单放在一起计算。而且要有区分度能明显看出来」：
 * 按腿实际的持仓方向分成多单、空单两组，各自 100%；每格上行前挂「多 / 空」彩色标签，合计行分别给出两个分母。
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
/** 一行的文字：带标签的上行读成「多 34.9%」（标签与数字之间补一个空格），其余原样。 */
const lineText = (line: Element) => (
  line.children.length > 0 ? Array.from(line.children).map(el => el.textContent).join(' ') : line.textContent
);
/** 一格里的各组，每组 [上行, 下行]：腿行只有一组，合计行多、空各一组。 */
const blocks = (testId: string) => Array.from(screen.getByTestId(testId).children)
  .map(block => Array.from(block.children).map(lineText));
const lines = (testId: string) => blocks(testId).flat();
const tagsIn = (el: Element) => Array.from(el.querySelectorAll('[data-testid="position-side-tag"]'));
const coinCell = (id: string) => screen.getByTestId(`leg-position-share-${id}`).previousElementSibling!;

describe('Legs 列表的「占比」列', () => {
  it('表头紧跟在「币量 / 仓位」之后、「加仓校验」之前，右对齐，tooltip 说明多空分开算、两个分母与挂单中的排除', () => {
    renderList(screenshotLegs());
    const titles = headerCells().map(el => el.textContent);
    const col = titles.indexOf('占比');
    expect(titles.slice(col - 1, col + 2)).toEqual(['币量 / 仓位', '占比', '加仓校验']);
    const header = screen.getByText('占比');
    expect(header.className).toContain('text-right');
    expect(header.getAttribute('title')).toBe(
      '多单与空单分开算：多单各腿占多单合计的百分比，空单各腿占空单合计的百分比（对冲通常是空单）；'
      + '上行币量、下行名义仓位；状态为「挂单中」的对冲 / 镜像腿不计入。合计行分别给出多、空两个分母。',
    );
  });

  it('截图里的四条腿（全是多单）：上行币量占比、下行名义仓位占比，与「币量 / 仓位」格逐腿对应', () => {
    renderList(screenshotLegs());
    // 左边一格就是截图上的数
    expect(Array.from(coinCell('main').children).map(el => el.textContent)).toEqual(['27,603,119.02', '3015630.00']);
    expect(Array.from(coinCell('add3').children).map(el => el.textContent)).toEqual(['34,936,760.27', '4049570.00']);

    expect(lines('leg-position-share-main')).toEqual(['多 34.9%', '33.6%']);
    expect(lines('leg-position-share-add1')).toEqual(['多 12.8%', '13.0%']);
    expect(lines('leg-position-share-add2')).toEqual(['多 8.1%', '8.4%']);
    expect(lines('leg-position-share-add3')).toEqual(['多 44.2%', '45.1%']);

    const sum = (index: 0 | 1) => SCREENSHOT
      .map(row => Number.parseFloat(lines(`leg-position-share-${row.id}`)[index]!.replace(/^多 /, '')))
      .reduce((total, pct) => total + pct, 0);
    expect(sum(0)).toBeCloseTo(100.0, 6);
    // 各行分别取一位小数：33.578 + 12.964 + 8.368 + 45.090 = 100，印出来是 100.1（舍入误差，未平摊）
    expect(sum(1)).toBeCloseTo(100.1, 6);

    // 合计行：只有多单一组——Σ币量 / Σ名义仓位，占比 多 100.0% / 100.0%；没有空单就不列空单那组
    expect(blocks('legs-total-position')).toEqual([['多 79,042,835.4', '8981040.00']]);
    expect(blocks('legs-total-position-share')).toEqual([['多 100.0%', '100.0%']]);
    expect(screen.queryByTestId('legs-total-position-short')).toBeNull();
    expect(screen.queryByTestId('legs-total-position-share-short')).toBeNull();
    // 分母格的 tooltip 只说列出来的那一组，不提并不存在的空单组
    expect(screen.getByTestId('legs-total-position').getAttribute('title'))
      .toBe('占比的分母：多单一组，上行 Σ币量、下行 Σ名义仓位（挂单中的腿不计入）');
  });

  it('百分数本身中性色：上行数字与币量同色（前景），下行与名义仓位同样淡；只有「多 / 空」标签上色', () => {
    renderList(screenshotLegs());
    const cell = screen.getByTestId('leg-position-share-main');
    const coins = coinCell('main');
    expect(cell.className).toContain('text-right');
    expect(cell.className).toContain('tabular-nums');
    expect(cell.className).not.toMatch(/#0ECB81|#F6465D/);
    const [top, bottom] = Array.from(cell.children[0].children);
    const value = top.lastElementChild!;
    expect(value.textContent).toBe('34.9%');
    expect(value.className).toBe(coins.children[0].className);
    expect(value.className).not.toMatch(/#0ECB81|#F6465D/);
    expect(bottom.className).toBe(coins.children[1].className);
    expect(bottom.className).toContain('text-muted-foreground');
    expect(bottom.className).not.toMatch(/#0ECB81|#F6465D/);
    // 上色的只有标签
    expect(tagsIn(cell)).toHaveLength(1);
    expect(tagsIn(cell)[0].className).toContain('text-[#0ECB81]');
    // 行本身是等宽字：上行与左边的币量一样是 mono
    expect(cell.parentElement!.className).toContain('font-mono');
  });

  it('状态为「挂单中」的腿：两行都是「—」、不挂标签，不进分母——空单那一方向只有它，合计行就不列空单那组', () => {
    renderList([...screenshotLegs(), pendingHedge]);
    expect(screen.getByText('挂单中')).toBeTruthy();
    // 「币量 / 仓位」格照常显示它的币量与名义
    expect(Array.from(coinCell('pending-hedge').children).map(el => el.textContent)).toEqual(['50,000,000', '5000000.00']);
    const pendingCell = screen.getByTestId('leg-position-share-pending-hedge');
    expect(lines('leg-position-share-pending-hedge')).toEqual(['—', '—']);
    expect(tagsIn(pendingCell)).toHaveLength(0);
    expect(pendingCell.getAttribute('title')).toBe('状态为「挂单中」（还没有成交或平仓记录），不计入多单 / 空单合计');
    expect(lines('leg-position-share-main')).toEqual(['多 34.9%', '33.6%']);
    expect(lines('leg-position-share-add3')).toEqual(['多 44.2%', '45.1%']);
    expect(blocks('legs-total-position')).toEqual([['多 79,042,835.4', '8981040.00']]);
    expect(blocks('legs-total-position-share')).toEqual([['多 100.0%', '100.0%']]);
    expect(tagsIn(screen.getByTestId('legs-total-row')).map(tag => tag.textContent)).toEqual(['多', '多']);
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
    // 下行有数，这一行仍挂标签；上行的「—」在标签右边
    expect(lines('leg-position-share-no-price')).toEqual(['多 —', '40.0%']);
    expect(lines('leg-position-share-priced')).toEqual(['多 100.0%', '60.0%']);
    expect(blocks('legs-total-position')).toEqual([['多 300', '1000.00']]);
    expect(blocks('legs-total-position-share')).toEqual([['多 100.0%', '100.0%']]);
  });

  it('一条都不计入：合计行两格都是「—」，不印 100.0%，也不挂任何标签', () => {
    renderList([pendingHedge]);
    expect(lines('leg-position-share-pending-hedge')).toEqual(['—', '—']);
    expect(lines('legs-total-position')).toEqual(['—', '—']);
    expect(lines('legs-total-position-share')).toEqual(['—', '—']);
    expect(tagsIn(screen.getByTestId('legs-total-row'))).toHaveLength(0);
    expect(screen.getByTestId('legs-total-position-share').getAttribute('title')).toBeNull();
    expect(screen.getByTestId('legs-total-position').getAttribute('title')).toBeNull();
  });

  it('指南的 Legs 列表条目写明「占比」多空分开、两个分母、挂单中的排除与合计行', () => {
    const guide = readFileSync(join(process.cwd(), 'src/pages/GuidePage.tsx'), 'utf8');
    const bullet = guide.slice(guide.indexOf('<li><strong>Legs 列表每条腿都标明'));
    const clause = bullet.slice(bullet.indexOf('<strong>「占比」</strong>'), bullet.indexOf('「委托」列按真实业务归属呈现'));
    expect(clause.length).toBeGreaterThan(0);
    // 【用户要求 · 续】多单、空单分开各自 100%，对冲通常是空单，用多 / 空标签区分，合计行分别给出两个分母
    expect(clause).toContain('多单、空单分开算、各自 100%');
    expect(clause).toContain('对冲通常是空单');
    expect(clause).toContain('跟方向走、不跟角色走');
    expect(clause).toContain('「多」（绿）/「空」（红）标签');
    expect(clause).toContain('合计行分别给出多、空两个分母');
    expect(clause).toContain('没有计入腿的方向不列');
    expect(clause).not.toContain('本场各腿币量合计');
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
      expect(lines(`leg-position-share-eq${index}`)).toEqual(['多 16.7%', '16.7%']);
    }
    expect(blocks('legs-total-position')).toEqual([['多 3,000', '6000.00']]);
    expect(blocks('legs-total-position-share')).toEqual([['多 100.0%', '100.0%']]);
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

    it('阶段子行这一格留空；多单主力与空单对冲各自 100%；合计行分别写多、空两组分母与「多 / 空 100.0%」', () => {
      renderList(phaseLegs);
      const titles = headerCells().map(el => el.textContent);
      const coinsCol = titles.indexOf('币量 / 仓位');
      const shareCol = titles.indexOf('占比');
      expect(shareCol).toBe(coinsCol + 1);

      // 已平仓的对冲是仓位，计入——但它是空单，进空单那组：94,300 ÷ 0.0336792 = 2,799,947.74 币（多）；50,000 ÷ 0.05 = 1,000,000 币（空）
      // （一个分母时曾印成 73.7% / 26.3%）
      expect(lines('leg-position-share-main')).toEqual(['多 100.0%', '100.0%']);
      expect(lines('leg-position-share-hedge-roll')).toEqual(['空 100.0%', '100.0%']);

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
      expect(blocks('legs-total-position')).toEqual([
        ['多 2,799,947.74', '94300.00'],
        ['空 1,000,000', '50000.00'],
      ]);
      expect(blocks('legs-total-position-share')).toEqual([
        ['多 100.0%', '100.0%'],
        ['空 100.0%', '100.0%'],
      ]);
      // 合计行这两格是淡色、数字不上红绿；下行照旧更淡
      for (const id of ['legs-total-position', 'legs-total-position-share']) {
        const cell = screen.getByTestId(id);
        expect(cell.className).toContain('text-foreground/55');
        expect(cell.className).not.toMatch(/#0ECB81|#F6465D/);
        for (const block of Array.from(cell.children)) {
          expect(block.children[0].lastElementChild!.className).not.toMatch(/#0ECB81|#F6465D/);
          expect(block.children[1].className).toContain('text-muted-foreground');
        }
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

  describe('【用户要求 · 续】多单与空单分开算、标签一眼可辨', () => {
    /** 用户截图的形状（KAITOUSDT，主多）：主力多单、镜像止盈多单、滚动对冲空单、加仓多单，全部已平仓。 */
    const userShape = () => [
      legFor({
        id: 'main', leg_sequence: 1, pre_simulated_time: at('01:00'), pre_entry_price: 1, pre_position_size: 3_000,
        post_exit_price_snapshot: 1.2, post_simulated_close_time: at('09:00'),
      }),
      legFor({
        id: 'mirror', leg_sequence: 2, leg_role: 'mirror_tp', order_kind: 'main', pre_simulated_time: at('01:00'),
        pre_entry_price: 1, pre_position_size: 3_000, post_exit_price_snapshot: 1.1, post_simulated_close_time: at('04:00'),
      }),
      legFor({
        id: 'hedge', leg_sequence: 3, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
        pre_simulated_time: at('03:00'), pre_entry_price: 1.1, pre_position_size: 2_000,
        post_exit_price_snapshot: 1.05, post_simulated_close_time: at('05:00'),
      }),
      legFor({
        id: 'add', leg_sequence: 4, leg_role: 'main_add_1', pre_simulated_time: at('06:00'),
        pre_entry_price: 1.2, pre_position_size: 1_500, post_exit_price_snapshot: 1.3, post_simulated_close_time: at('09:00'),
      }),
    ];
    const pct = (text: string) => Number.parseFloat(text.replace(/^[多空] /, ''));

    it('用户截图的形状：三条多单在多单里加起来 100.0%，唯一的空单对冲独占空单的 100.0%', () => {
      renderList(userShape());
      const longs = ['main', 'mirror', 'add'];
      expect(longs.map(id => lines(`leg-position-share-${id}`))).toEqual([
        ['多 41.4%', '40.0%'],
        ['多 41.4%', '40.0%'],
        ['多 17.2%', '20.0%'],
      ]);
      for (const index of [0, 1] as const) {
        expect(longs.map(id => pct(lines(`leg-position-share-${id}`)[index]!)).reduce((sum, value) => sum + value, 0))
          .toBeCloseTo(100, 6);
      }
      expect(lines('leg-position-share-hedge')).toEqual(['空 100.0%', '100.0%']);
      // 合计行：先多后空，各一组分母
      expect(blocks('legs-total-position')).toEqual([
        ['多 7,250', '7500.00'],
        ['空 1,818.18', '2000.00'],
      ]);
      expect(blocks('legs-total-position-share')).toEqual([
        ['多 100.0%', '100.0%'],
        ['空 100.0%', '100.0%'],
      ]);
      // tooltip 逐格说明是哪一组里的占比
      expect(screen.getByTestId('leg-position-share-hedge').getAttribute('title'))
        .toBe('空单合计里的占比：币量 100.0%，名义仓位 100.0%');
      expect(screen.getByTestId('leg-position-share-main').getAttribute('title'))
        .toBe('多单合计里的占比：币量 41.4%，名义仓位 40.0%');
    });

    it('主空战役里的多单对冲：分组跟方向走、不跟角色走——对冲进多单那组，主力与加仓分空单', () => {
      renderList([
        legFor({
          id: 'main-short', direction: 'short', pre_entry_price: 2, pre_position_size: 5_000,
          post_exit_price_snapshot: 1.5, post_simulated_close_time: at('09:00'),
        }),
        legFor({
          id: 'hedge-long', leg_sequence: 2, leg_role: 'hedge_initial_a', order_kind: 'hedge', direction: 'long',
          pre_simulated_time: at('02:00'), pre_entry_price: 2, pre_position_size: 2_000,
          post_exit_price_snapshot: 2.1, post_simulated_close_time: at('03:00'),
        }),
        legFor({
          id: 'add-short', leg_sequence: 3, leg_role: 'main_add_1', direction: 'short',
          pre_simulated_time: at('04:00'), pre_entry_price: 2, pre_position_size: 3_000,
          post_exit_price_snapshot: 1.5, post_simulated_close_time: at('09:00'),
        }),
      ]);
      expect(lines('leg-position-share-main-short')).toEqual(['空 62.5%', '62.5%']);
      expect(lines('leg-position-share-add-short')).toEqual(['空 37.5%', '37.5%']);
      expect(lines('leg-position-share-hedge-long')).toEqual(['多 100.0%', '100.0%']);
      expect(blocks('legs-total-position')).toEqual([
        ['多 1,000', '2000.00'],
        ['空 4,000', '8000.00'],
      ]);
      expect(blocks('legs-total-position-share')).toEqual([['多 100.0%', '100.0%'], ['空 100.0%', '100.0%']]);
    });

    it('两条空单对冲平分空单那一组，多单主力照旧 100.0%', () => {
      renderList([
        legFor({
          id: 'main', pre_entry_price: 1, pre_position_size: 1_000,
          post_exit_price_snapshot: 1.2, post_simulated_close_time: at('09:00'),
        }),
        legFor({
          id: 'hedge-a', leg_sequence: 2, leg_role: 'hedge_initial_a', order_kind: 'hedge', direction: 'short',
          pre_simulated_time: at('02:00'), pre_entry_price: 1, pre_position_size: 300,
          post_exit_price_snapshot: 0.9, post_simulated_close_time: at('03:00'),
        }),
        legFor({
          id: 'hedge-b', leg_sequence: 3, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
          pre_simulated_time: at('04:00'), pre_entry_price: 1, pre_position_size: 900,
          post_exit_price_snapshot: 0.95, post_simulated_close_time: at('05:00'),
        }),
      ]);
      expect(lines('leg-position-share-hedge-a')).toEqual(['空 25.0%', '25.0%']);
      expect(lines('leg-position-share-hedge-b')).toEqual(['空 75.0%', '75.0%']);
      expect(lines('leg-position-share-main')).toEqual(['多 100.0%', '100.0%']);
      expect(blocks('legs-total-position')).toEqual([['多 1,000', '1000.00'], ['空 1,200', '1200.00']]);
    });

    it('主空战役里唯一的多单对冲还挂单中：多单那组不列，合计行只剩空单一组', () => {
      renderList([
        legFor({
          id: 'main-short', direction: 'short', pre_entry_price: 2, pre_position_size: 5_000,
          post_exit_price_snapshot: 1.5, post_simulated_close_time: at('09:00'),
        }),
        legFor({
          id: 'pending-long-hedge', leg_sequence: 2, leg_role: 'hedge_initial_a', order_kind: 'hedge', direction: 'long',
          pre_simulated_time: at('02:00'), pre_entry_price: 2.2, pre_position_size: 2_000,
        }),
      ]);
      expect(screen.getByText('挂单中')).toBeTruthy();
      expect(lines('leg-position-share-pending-long-hedge')).toEqual(['—', '—']);
      expect(lines('leg-position-share-main-short')).toEqual(['空 100.0%', '100.0%']);
      expect(blocks('legs-total-position')).toEqual([['空 2,500', '5000.00']]);
      expect(blocks('legs-total-position-share')).toEqual([['空 100.0%', '100.0%']]);
      expect(screen.queryByTestId('legs-total-position-long')).toBeNull();
      expect(screen.getByTestId('legs-total-position-short')).toBeTruthy();
    });

    it('标签：「多」绿 #0ECB81、「空」红 #F6465D 的描边小胶囊，只挂在上行；数字本身不上色', () => {
      renderList(userShape());
      const longTag = tagsIn(screen.getByTestId('leg-position-share-main'));
      const shortTag = tagsIn(screen.getByTestId('leg-position-share-hedge'));
      expect(longTag).toHaveLength(1);
      expect(shortTag).toHaveLength(1);
      expect(longTag[0].textContent).toBe('多');
      expect(longTag[0].getAttribute('data-side')).toBe('long');
      expect(longTag[0].className).toContain('text-[#0ECB81]');
      expect(longTag[0].className).toContain('border-[#0ECB81]/40');
      expect(longTag[0].className).not.toContain('#F6465D');
      expect(shortTag[0].textContent).toBe('空');
      expect(shortTag[0].getAttribute('data-side')).toBe('short');
      expect(shortTag[0].className).toContain('text-[#F6465D]');
      expect(shortTag[0].className).toContain('border-[#F6465D]/40');
      expect(shortTag[0].className).not.toContain('#0ECB81');
      for (const tag of [...longTag, ...shortTag]) {
        expect(tag.className).toContain('border');
        expect(tag.className).toContain('rounded-sm');
        // 标签在上行里：上行的第一个子元素
        expect(tag.parentElement!.firstElementChild).toBe(tag);
      }
      // 下行没有标签
      for (const id of ['main', 'hedge']) {
        const [, bottom] = Array.from(screen.getByTestId(`leg-position-share-${id}`).children[0].children);
        expect(tagsIn(bottom)).toHaveLength(0);
        expect(bottom.className).not.toMatch(/#0ECB81|#F6465D/);
      }
      // 合计行两格：每组一枚，顺序先多后空
      expect(tagsIn(screen.getByTestId('legs-total-position')).map(tag => tag.textContent)).toEqual(['多', '空']);
      expect(tagsIn(screen.getByTestId('legs-total-position-share')).map(tag => tag.textContent)).toEqual(['多', '空']);
    });

    it('腿行不变高：上行是「标签 + 数字」一行（标签 9px 字、11px 行高，矮于 11px 字的行高），格里仍只有两行', () => {
      renderList(userShape());
      for (const id of ['main', 'mirror', 'hedge', 'add']) {
        const cell = screen.getByTestId(`leg-position-share-${id}`);
        expect(cell.className).toContain('leading-snug');
        expect(cell.children).toHaveLength(1);
        const rows = Array.from(cell.children[0].children);
        expect(rows).toHaveLength(2);
        expect(rows[0].className).toBe('flex items-center justify-end gap-1');
        const tag = tagsIn(rows[0])[0];
        expect(tag.className).toContain('text-[9px]');
        expect(tag.className).toContain('leading-[11px]');
        expect(tag.className).not.toMatch(/\bpy-/);
        // 行格子里仍是两行，与左边「币量 / 仓位」同高
        expect(coinCell(id).children).toHaveLength(2);
      }
    });

    it('合计行：两格逐组对齐——组数、方向顺序、每组两行的排版完全一致；合计行可以变高', () => {
      renderList(userShape());
      const coins = screen.getByTestId('legs-total-position');
      const share = screen.getByTestId('legs-total-position-share');
      expect(coins.className).toBe(share.className);
      expect(coins.className).toContain('space-y-1');
      expect(coins.children).toHaveLength(2);
      expect(share.children).toHaveLength(2);
      Array.from(coins.children).forEach((block, index) => {
        const twin = share.children[index];
        expect(block.getAttribute('data-side')).toBe(twin.getAttribute('data-side'));
        expect(block.children).toHaveLength(2);
        expect(twin.children).toHaveLength(2);
        expect(block.children[0].className).toBe(twin.children[0].className);
        expect(block.children[1].className).toBe(twin.children[1].className);
      });
      expect(Array.from(coins.children).map(block => block.getAttribute('data-testid')))
        .toEqual(['legs-total-position-long', 'legs-total-position-short']);
      expect(Array.from(share.children).map(block => block.getAttribute('data-testid')))
        .toEqual(['legs-total-position-share-long', 'legs-total-position-share-short']);
      // 四行字都在合计行里：两组 × 两行
      expect(lines('legs-total-position')).toHaveLength(4);
      expect(coins.getAttribute('title')).toBe('占比的分母：多单一组、空单一组，上行 Σ币量、下行 Σ名义仓位（挂单中的腿不计入）');
      expect(share.getAttribute('title')).toBe('多单各腿合计为 100%；空单各腿合计为 100%');
      // 格子数不变
      const count = headerCells().length;
      expect(screen.getByTestId('legs-total-row').children).toHaveLength(count);
      for (const id of ['main', 'mirror', 'hedge', 'add']) {
        expect(screen.getByTestId(`leg-position-share-${id}`).parentElement!.children).toHaveLength(count);
      }
    });

    it('合计行「占比」格的 tooltip 只说有分母的那一行：空单计入的腿都缺开仓价时，不说「空单各腿合计为 100%」', () => {
      renderList([
        legFor({
          id: 'main', pre_entry_price: 1, pre_position_size: 3_000,
          post_exit_price_snapshot: 1.2, post_simulated_close_time: at('09:00'),
        }),
        legFor({
          id: 'hedge-no-price', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
          pre_simulated_time: at('03:00'), pre_entry_price: null, pre_position_size: 2_000,
          post_simulated_close_time: at('05:00'),
        }),
      ]);
      // 空单那组：上行没有分母（「—」），下行照常 100.0%
      expect(blocks('legs-total-position')).toEqual([['多 3,000', '3000.00'], ['空 —', '2000.00']]);
      expect(blocks('legs-total-position-share')).toEqual([['多 100.0%', '100.0%'], ['空 —', '100.0%']]);
      expect(screen.getByTestId('legs-total-position-share').getAttribute('title'))
        .toBe('多单各腿合计为 100%；空单各腿的名义仓位合计为 100%（币量缺开仓价，没有分母）');
    });
  });

  describe('【评审 · 第 1 轮】合计行变高后不被表体滚动区截掉', () => {
    /**
     * 用户截图的形状（主多被滚动对冲切成两段阶段子行、对冲带类型说明行）在无头 Chrome 里量过：
     * 改动前内容 373px、滚动区上限 380px，一眼看全；多、空两组分母让合计行从 46.88px 长到 79.75px，
     * 内容变成 406px，空单那组分母被滚动区截掉，得在表里再滚一下才看得见——而它正是这次要给用户看的数。
     * jsdom 不排版，这里钉住两件事：上限跟着合计行一起加高，合计行贴在滚动区底边。
     */
    const scrollArea = () => screen.getByTestId('legs-total-row').parentElement!;
    const maxHeightPx = (el: Element) => {
      const match = el.className.match(/(?:^|\s)max-h-\[(\d+)px\](?:\s|$)/);
      return match ? Number(match[1]) : null;
    };
    // 多出的一组 = 上行 11px 字 × leading-snug 1.375 + 下行 10px 字 × 1.375 + 组间 space-y-1 的 4px
    const EXTRA_BLOCK_PX = 11 * 1.375 + 10 * 1.375 + 4;

    it('合计行是表体滚动区的最后一格；滚动区上限在原来的 380px 之上至少加出多出来的那一组，原来不用滚动的战役现在照样不用滚', () => {
      renderList([
        legFor({
          id: 'main', pre_entry_price: 1, pre_position_size: 3_000,
          post_exit_price_snapshot: 1.2, post_simulated_close_time: at('09:00'),
        }),
        legFor({
          id: 'hedge', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
          pre_simulated_time: at('03:00'), pre_entry_price: 1.1, pre_position_size: 2_000,
          post_exit_price_snapshot: 1.05, post_simulated_close_time: at('05:00'),
        }),
      ]);
      expect(blocks('legs-total-position')).toHaveLength(2);
      const area = scrollArea();
      expect(area.className).toContain('overflow-y-auto');
      expect(area.lastElementChild).toBe(screen.getByTestId('legs-total-row'));
      const cap = maxHeightPx(area);
      expect(cap).not.toBeNull();
      expect(cap!).toBeGreaterThanOrEqual(Math.ceil(380 + EXTRA_BLOCK_PX));
    });

    it('腿再多、表体要滚动时，合计行贴在滚动区底边（sticky），背景不透明、压在腿行之上，分母始终看得见', () => {
      renderList(screenshotLegs());
      const total = screen.getByTestId('legs-total-row');
      const classes = total.className.split(/\s+/);
      expect(classes).toEqual(expect.arrayContaining(['sticky', 'bottom-0', 'bg-card']));
      expect(classes.some(name => /^z-/.test(name))).toBe(true);
      // 贴底的是合计行本身，不是某个包着它的外层；腿行不跟着贴
      expect(scrollArea().className).toContain('overflow-y-auto');
      for (const row of SCREENSHOT) {
        const legRow = screen.getByTestId(`leg-position-share-${row.id}`).parentElement!;
        expect(legRow.className.split(/\s+/)).not.toContain('sticky');
      }
      // 格子数不变
      expect(total.children).toHaveLength(headerCells().length);
    });

    it('【评审 · 第 2 轮】滚动区留出不少于合计行高度的底部滚动留白：键盘聚焦腿行按钮时不会停在合计行下面', () => {
      renderList(screenshotLegs());
      const classes = scrollArea().className.split(/\s+/);
      // scroll-pb-20 = 80px ≥ 两组分母时合计行的 79.75px
      const padding = classes.map(name => /^scroll-pb-(\d+)$/.exec(name)).find(Boolean);
      expect(padding).toBeTruthy();
      expect(Number(padding![1]) * 4).toBeGreaterThanOrEqual(80);
      expect(screen.getByTestId('legs-total-row').className).toContain('sticky');
    });
  });
});
