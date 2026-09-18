import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import type { TradeJournal } from '@/types/journal';

/**
 * 【用户要求】交易战役 Legs 的「币量 / 仓位」后面再加一列：币量 / 仓位占总币量 / 仓位的百分比。
 * 上行币量占比、下行名义仓位占比；分母取「币量 / 仓位」格显示的同一组数，状态为「挂单中」的腿不计入。
 *
 * 【用户要求 · 续】「对冲的要单独算，因为对冲的单是空单。空单放在一起计算，多单放在一起计算。而且要有区分度能明显看出来」：
 * 按腿实际的持仓方向分成多单、空单两组，各自 100%；合计行分别给出两个分母。
 *
 * 【用户要求 · 再续】「仓位占比分成两列呈现，多和空分成两列。并且还要做成能够点击之后排序的」：
 * 占比列头挂「多 / 空」彩色标签，点击排序（见 CampaignLegsList.shareSort.test.tsx）。
 *
 * 【用户要求 · 三续】「空单仓位的占比也不需要，没必要存在」：只留「多单占比」一列。
 * 空单的行这一列留空，空单也不进多单的分母；合计行「币量 / 仓位」格照旧写出多、空两组 Σ——
 * 多单那组是「多单占比」的分母，空单那组只是空单各腿的合计（对冲一共开了多大）。
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

const headerCells = () => Array.from(screen.getByTestId('legs-header-row').children);
/** 表头一格的列名：「多单占比」是按钮，列名在读屏名里（「按多单占比排序：…」）；其余列就是格里的字。 */
const columnTitle = (el: Element) => /^按(.+?)排序：/.exec(el.getAttribute('aria-label') ?? '')?.[1] ?? el.textContent;
const titlesOf = () => headerCells().map(columnTitle);
const colOf = (title: string) => titlesOf().indexOf(title);
const LONG = '多单占比';
/** 已经去掉的那一列：表头里不许再出现。 */
const SHORT = '空单占比';
/** 一条腿所在的那一行（冻结的角色格的父元素）。 */
const rowOf = (id: string) => screen.getByTestId(`leg-frozen-role-${id}`).parentElement!;
/** 这条腿在某一列占比里的格子。 */
const shareCellOf = (id: string, title: string) => rowOf(id).children[colOf(title)];
/** 腿行占比格的两行字：上行币量占比、下行名义仓位占比；空格为 []。 */
const cellLines = (cell: Element) => Array.from(cell.children).map(line => line.textContent);
/** 一行的文字：带标签的上行读成「多 34.9%」（标签与数字之间补一个空格），其余原样。 */
const lineText = (line: Element) => (
  line.children.length > 0 ? Array.from(line.children).map(el => el.textContent).join(' ') : line.textContent
);
/** 合计行一格里的各组，每组 [上行, 下行]；为对齐而占位的隐形组读作「(占位)」（现在不该再有）。 */
const blocks = (testId: string) => Array.from(screen.getByTestId(testId).children)
  .map(block => (block.getAttribute('aria-hidden') === 'true' ? '(占位)' : Array.from(block.children).map(lineText)));
const lines = (testId: string) => blocks(testId).flat();
const tagsIn = (el: Element) => Array.from(el.querySelectorAll('[data-testid="position-side-tag"]'));
const coinCell = (id: string) => rowOf(id).children[colOf('币量 / 仓位')];
/** 这条腿没有占比格：「多单占比」那一格整格留空（连「—」都不写），也没有 leg-position-share-<id>。 */
const expectNoShareCell = (id: string) => {
  const cell = shareCellOf(id, LONG);
  expect(cell.textContent).toBe('');
  expect(cell.children).toHaveLength(0);
  expect(cell.getAttribute('title')).toBeNull();
  expect(screen.queryByTestId(`leg-position-share-${id}`)).toBeNull();
};
/** 两个方向都列出时合计行「币量 / 仓位」格的 tooltip。 */
const BOTH_TOTALS_TITLE = '多单一组是「多单占比」的分母，空单一组是空单各腿的合计（只看总量，不算占比）；上行 Σ币量、下行 Σ名义仓位（挂单中的腿不计入）';

describe('Legs 列表的「多单占比」列', () => {
  it('只有「多单占比」一列，紧跟在「币量 / 仓位」之后、「加仓校验」之前；列头是按钮：「多」标签 +「占比」+ 排序图标，右对齐', () => {
    renderList(screenshotLegs());
    const col = colOf(LONG);
    expect(titlesOf().slice(col - 1, col + 2)).toEqual(['币量 / 仓位', LONG, '加仓校验']);
    expect(titlesOf()).toEqual(['角色', '时间', '贡献 / 盈亏', 'Δb', '开仓价', '平仓价', '涨跌幅', '币量 / 仓位', LONG, '加仓校验', '手续费', '委托', '操作']);
    // 【用户要求】「空单占比」一列不再存在：表头里没有它，也没有第二个排序按钮、第二枚标签
    expect(titlesOf()).not.toContain(SHORT);
    expect(headerCells().filter(cell => cell.tagName === 'BUTTON')).toHaveLength(1);
    expect(screen.queryByTestId('legs-share-sort-short')).toBeNull();
    expect(tagsIn(screen.getByTestId('legs-header-row')).map(tag => tag.getAttribute('data-side'))).toEqual(['long']);
    const header = headerCells()[col];
    expect(header).toBe(screen.getByTestId('legs-share-sort-long'));
    expect(header.tagName).toBe('BUTTON');
    expect(header.getAttribute('type')).toBe('button');
    expect(header.className).toContain('justify-end');
    // 看得见的是「多 占比」：标签就是那枚绿色小胶囊
    const tags = tagsIn(header);
    expect(tags).toHaveLength(1);
    expect(tags[0].getAttribute('data-side')).toBe('long');
    expect(tags[0].className).toContain('text-[#0ECB81]');
    expect(header.textContent).toBe('多占比');
    // 读屏读到的是完整列名
    expect(screen.getByRole('button', { name: /^按多单占比排序/ })).toBe(header);
    expect(header.querySelector('svg')).not.toBeNull();
  });

  it('列头的读屏说明：这条多单占全部计入多单的百分比，上行币量、下行名义仓位，挂单中不计入，空单留空、不进分母，点击按本列排序；不弹悬停黑框', () => {
    renderList(screenshotLegs());
    // 【用户要求】「这个黑块的部分不需要，多余了」：列头没有 title
    expect(headerCells()[colOf(LONG)].hasAttribute('title')).toBe(false);
    expect(headerCells()[colOf(LONG)].getAttribute('aria-description')).toBe(
      '这条多单占全部计入的多单的百分比：上行币量、下行名义仓位；状态为「挂单中」的对冲 / 镜像腿不计入。'
      + '空单的行这一列留空，空单也不进分母；合计行写多单各腿合计的 100.0%（多单没有计入的腿时不写；某一行没有分母时那一行写「—」），与「币量 / 仓位」里多单那组 Σ 对齐。'
      + '点击列头按本列排序：降序 → 升序 → 默认顺序。',
    );
  });

  it('截图里的四条腿（全是多单）：两行数在「多单占比」列，与「币量 / 仓位」格逐腿对应；每行仍是 13 格', () => {
    renderList(screenshotLegs());
    // 左边一格就是截图上的数
    expect(cellLines(coinCell('main'))).toEqual(['27,603,119.02', '3015630.00']);
    expect(cellLines(coinCell('add3'))).toEqual(['34,936,760.27', '4049570.00']);

    expect(cellLines(shareCellOf('main', LONG))).toEqual(['34.9%', '33.6%']);
    expect(cellLines(shareCellOf('add1', LONG))).toEqual(['12.8%', '13.0%']);
    expect(cellLines(shareCellOf('add2', LONG))).toEqual(['8.1%', '8.4%']);
    expect(cellLines(shareCellOf('add3', LONG))).toEqual(['44.2%', '45.1%']);
    for (const row of SCREENSHOT) {
      // 有数的那一格就是 leg-position-share-<id>
      expect(shareCellOf(row.id, LONG)).toBe(screen.getByTestId(`leg-position-share-${row.id}`));
      expect(rowOf(row.id).children).toHaveLength(13);
    }

    const sum = (index: 0 | 1) => SCREENSHOT
      .map(row => Number.parseFloat(cellLines(shareCellOf(row.id, LONG))[index]!))
      .reduce((total, pct) => total + pct, 0);
    expect(sum(0)).toBeCloseTo(100.0, 6);
    // 各行分别取一位小数：33.578 + 12.964 + 8.368 + 45.090 = 100，印出来是 100.1（舍入误差，未平摊）
    expect(sum(1)).toBeCloseTo(100.1, 6);

    // 合计行：「币量 / 仓位」只有多单一组；「多单占比」写 100.0% / 100.0%
    expect(blocks('legs-total-position')).toEqual([['多 79,042,835.4', '8981040.00']]);
    expect(blocks('legs-total-position-share-long')).toEqual([['100.0%', '100.0%']]);
    expect(screen.getByTestId('legs-total-position-share-long').getAttribute('title')).toBe('多单各腿合计为 100%');
    expect(screen.queryByTestId('legs-total-position-short')).toBeNull();
    expect(screen.queryByTestId('legs-total-position-share-short')).toBeNull();
    // Σ 格的 tooltip 只说列出来的那一组，不提并不存在的空单组
    expect(screen.getByTestId('legs-total-position').getAttribute('title'))
      .toBe('多单一组是「多单占比」的分母；上行 Σ币量、下行 Σ名义仓位（挂单中的腿不计入）');
    const total = screen.getByTestId('legs-total-row');
    expect(total.children).toHaveLength(13);
    expect(total.children[colOf(LONG)]).toBe(screen.getByTestId('legs-total-position-share-long'));
    // 合计行「多单占比」右边就是加仓校验那一格（留空）
    expect(total.children[colOf(LONG) + 1].textContent).toBe('');
  });

  it('百分数本身中性色，与「币量 / 仓位」格同一套两行排版；腿行里不再挂「多 / 空」标签（列头已经说了方向）', () => {
    renderList(screenshotLegs());
    const cell = screen.getByTestId('leg-position-share-main');
    const coins = coinCell('main');
    expect(cell.className).toContain('text-right');
    expect(cell.className).toContain('tabular-nums');
    expect(cell.className).toContain('leading-snug');
    expect(cell.className).not.toMatch(/#0ECB81|#F6465D/);
    expect(cell.getAttribute('data-side')).toBe('long');
    const [top, bottom] = Array.from(cell.children);
    expect(top.textContent).toBe('34.9%');
    expect(top.className).toBe(coins.children[0].className);
    expect(bottom.className).toBe(coins.children[1].className);
    expect(bottom.className).toContain('text-muted-foreground');
    for (const line of [top, bottom]) expect(line.className).not.toMatch(/#0ECB81|#F6465D/);
    // 腿行一枚标签都没有
    for (const row of SCREENSHOT) {
      expect(tagsIn(rowOf(row.id))).toHaveLength(0);
    }
    // 行本身是等宽字：与左边的币量一样是 mono
    expect(cell.parentElement!.className).toContain('font-mono');
  });

  it('状态为「挂单中」的空单：「多单占比」整格留空，也不进空单那组 Σ——空单那一方向只有它，合计行就不列空单那组', () => {
    renderList([...screenshotLegs(), pendingHedge]);
    expect(screen.getByText('挂单中')).toBeTruthy();
    // 「币量 / 仓位」格照常显示它的币量与名义
    expect(cellLines(coinCell('pending-hedge'))).toEqual(['50,000,000', '5000000.00']);
    expectNoShareCell('pending-hedge');
    expect(tagsIn(rowOf('pending-hedge'))).toHaveLength(0);
    expect(cellLines(shareCellOf('main', LONG))).toEqual(['34.9%', '33.6%']);
    expect(cellLines(shareCellOf('add3', LONG))).toEqual(['44.2%', '45.1%']);
    expect(blocks('legs-total-position')).toEqual([['多 79,042,835.4', '8981040.00']]);
    expect(blocks('legs-total-position-share-long')).toEqual([['100.0%', '100.0%']]);
    expect(screen.queryByTestId('legs-total-position-short')).toBeNull();
    // 合计行的标签只剩「币量 / 仓位」格里的那一枚：「多单占比」的合计格不挂标签
    expect(tagsIn(screen.getByTestId('legs-total-row')).map(tag => tag.textContent)).toEqual(['多']);
  });

  it('状态为「挂单中」的多单（镜像止盈还没触发）：「多单占比」两行「—」、带说明、不挂标签，也不进多单的分母', () => {
    renderList([
      ...screenshotLegs(),
      legFor({
        id: 'pending-mirror', leg_sequence: 10, leg_role: 'mirror_tp', pre_simulated_time: at('05:30'),
        pre_entry_price: 0.1, pre_position_size: 5_000_000,
      }),
    ]);
    const pendingCell = shareCellOf('pending-mirror', LONG);
    expect(pendingCell).toBe(screen.getByTestId('leg-position-share-pending-mirror'));
    expect(cellLines(pendingCell)).toEqual(['—', '—']);
    expect(tagsIn(pendingCell)).toHaveLength(0);
    expect(pendingCell.getAttribute('title')).toBe('状态为「挂单中」（还没有成交或平仓记录），不计入多单 / 空单合计');
    // 分母里没有它：其余四条腿的占比与 Σ 都不变
    expect(cellLines(shareCellOf('main', LONG))).toEqual(['34.9%', '33.6%']);
    expect(blocks('legs-total-position')).toEqual([['多 79,042,835.4', '8981040.00']]);
    expect(blocks('legs-total-position-share-long')).toEqual([['100.0%', '100.0%']]);
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
    expect(cellLines(coinCell('no-price'))).toEqual(['—', '400.00']);
    expect(cellLines(shareCellOf('no-price', LONG))).toEqual(['—', '40.0%']);
    expect(shareCellOf('no-price', LONG).getAttribute('title')).toBe('多单合计里的占比：币量 —，名义仓位 40.0%');
    expect(cellLines(shareCellOf('priced', LONG))).toEqual(['100.0%', '60.0%']);
    expect(blocks('legs-total-position')).toEqual([['多 300', '1000.00']]);
    expect(blocks('legs-total-position-share-long')).toEqual([['100.0%', '100.0%']]);
  });

  it('一条都不计入：合计行两格都是「—」，不印 100.0%，也不挂任何标签、不给 tooltip', () => {
    renderList([pendingHedge]);
    expectNoShareCell('pending-hedge');
    expect(lines('legs-total-position')).toEqual(['—', '—']);
    expect(lines('legs-total-position-share-long')).toEqual(['—', '—']);
    expect(screen.queryByTestId('legs-total-position-share-short')).toBeNull();
    expect(tagsIn(screen.getByTestId('legs-total-row'))).toHaveLength(0);
    for (const id of ['legs-total-position', 'legs-total-position-share-long']) {
      expect(screen.getByTestId(id).getAttribute('title')).toBeNull();
    }
  });

  it('指南的 Legs 列表条目写明「多单占比」一列：只算多单、空单留空也不进分母、列头标签、点击排序、合计行的两组 Σ、挂单中的排除', () => {
    const guide = readFileSync(join(process.cwd(), 'src/pages/GuidePage.tsx'), 'utf8');
    const bullet = guide.slice(guide.indexOf('<li><strong>Legs 列表每条腿都标明'));
    const clause = bullet.slice(bullet.indexOf('「币量 / 仓位」右侧是<strong>「多单占比」</strong>一列'), bullet.indexOf('「委托」列按真实业务归属呈现'));
    expect(clause.length).toBeGreaterThan(0);
    // 【用户要求 · 三续】「空单仓位的占比也不需要」：只有「多单占比」一列，空单的行留空、也不进它的分母
    expect(clause).toContain('<strong>只算多单</strong>');
    expect(clause).toContain('<strong>空单的行这一列留空</strong>，空单也不进它的分母');
    expect(clause).toContain('空单不单独算占比');
    expect(clause).not.toContain('空单占比');
    expect(clause).not.toContain('两列');
    expect(clause).not.toContain('各自 100%');
    // 【用户要求 · 续】分组跟方向走：对冲通常是空单，主空战役里的对冲是多单
    expect(clause).toContain('对冲通常是空单');
    expect(clause).toContain('跟方向走、不跟角色走');
    // 列头挂标签
    expect(clause).toContain('列头挂一枚<strong>「多」（绿）标签</strong>');
    // 【用户要求】点击列头排序
    expect(clause).toContain('<strong>点击列头排序</strong>');
    expect(clause).toContain('降序 → 升序 → 默认顺序');
    expect(clause).toContain('这一列没有数的行（空单、挂单中的腿、没有仓位数据的腿）不论升降序都留在最下面');
    expect(clause).toContain('阶段子行跟着所属腿走');
    expect(clause).toContain('合计行始终在最后');
    expect(clause).toContain('PNG 导出不跟着排序');
    // 合计行：两组 Σ 各是什么，多单那组与「多单占比」的 100.0% 同一行
    expect(clause).toContain('合计行的「币量 / 仓位」格按方向各写一组 Σ');
    expect(clause).toContain('<strong>「多」那组是「多单占比」的分母</strong>');
    expect(clause).toContain('<strong>「空」那组是空单各腿的合计</strong>');
    expect(clause).toContain('不作任何占比的分母');
    expect(clause).toContain('与这组落在同一行');
    expect(clause).toContain('没有计入腿的方向不列');
    expect(clause).toContain('PNG 导出同样只有「多单占比」一列');
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
    // 合计行的 100.0% 不是无条件的：分母没有可加的腿时这几格都是「—」
    expect(clause).toContain('一条腿都不计入时');
    expect(clause).toMatch(/一条腿都不计入时[^；。]*「—」/);
    // 分母按未舍入的原值相加，各行与合计行各自取两位小数：手工把印出来的数加起来，末位可能对不上
    expect(clause).not.toContain('加的就是「币量 / 仓位」列显示的那些数');
    expect(clause).toContain('未舍入');
    // 旧的单列写法不再出现
    expect(clause).not.toContain('每格上行的数字前挂一枚');
    // 整篇指南都不再提「空单占比」
    expect(guide).not.toContain('空单占比');
  });

  it('指南写明多单阶段子行默认折叠，点所属角色标签右边的开关展开', () => {
    const guide = readFileSync(join(process.cwd(), 'src/pages/GuidePage.tsx'), 'utf8');
    const start = guide.indexOf('<li><strong>「Δb」列与持仓阶段拆解。</strong>');
    expect(start).toBeGreaterThan(-1);
    const bullet = guide.slice(start, guide.indexOf('</li>', start));
    expect(bullet).toContain('<strong>默认折叠</strong>');
    expect(bullet).toContain('对应角色标签右边有一个小开关');
    expect(bullet).toContain('其他多单（包括加仓）');
    expect(bullet).toContain('「收尾」阶段一律不呈现');
    expect(bullet).toContain('「展开 5 个阶段」');
    expect(bullet).not.toContain('角色标签下面');
    expect(bullet).not.toContain('「N 个阶段」');
    expect(bullet).toContain('只有一段时不显示子行，角色标签旁也没有阶段开关');
    expect(bullet).toContain('刷新后回到折叠');
    expect(bullet).toContain('PNG 导出不跟着折叠');
  });

  it('【用户要求】指南写明第一列只有「角色」：没有序号与「回填」，挂单中 / 进行中画在角色标签上，PNG 同样', () => {
    const guide = readFileSync(join(process.cwd(), 'src/pages/GuidePage.tsx'), 'utf8');
    const start = guide.indexOf('<li><strong>Legs 列表每条腿都标明');
    const bullet = guide.slice(start, guide.indexOf('</li>', start));
    expect(bullet).toContain('<strong>第一列只有「角色」</strong>');
    expect(bullet).toContain('不印腿的序号，也不挂「回填」标签');
    expect(bullet).toContain('横向滚动时这一列冻结在左缘');
    expect(bullet).toContain('同色虚线的空心标签');
    expect(bullet).toContain('同色实心小圆点');
    expect(bullet).toContain('PNG 导出的第一列同样只有角色标签');
    // 没有角色的腿也是一枚标签，状态画法相同
    expect(bullet).toContain('没有角色的腿是一枚写着「—」的灰色标签');
    // 换了排序就回到表格顶端
    expect(bullet).toContain('排序后表格回到最上面');
    // 镜像止盈没触发时：标签画成虚线空心，不再有「挂单中」字样可找
    const mirror = guide.slice(guide.indexOf('<li><strong>镜像止盈即使没有触发'));
    const mirrorBullet = mirror.slice(0, mirror.indexOf('</li>'));
    expect(mirrorBullet).toContain('（角色标签画成虚线空心，悬停显示「挂单中」）');
    expect(mirrorBullet).not.toContain('状态显示「挂单中」');
  });

  it('指南的「加仓校验」条目说它紧跟「币量 / 仓位」与「多单占比」之后，与页面表头顺序一致', () => {
    const guide = readFileSync(join(process.cwd(), 'src/pages/GuidePage.tsx'), 'utf8');
    const start = guide.indexOf('<li><strong>「加仓校验」列</strong>');
    expect(start).toBeGreaterThan(-1);
    const bullet = guide.slice(start, guide.indexOf('</li>', start));
    expect(bullet).not.toContain('（紧跟「币量 / 仓位」）');
    expect(bullet).not.toContain('（紧跟「币量 / 仓位」与「占比」之后）');
    expect(bullet).not.toContain('「空单占比」');
    expect(bullet).toContain('（紧跟「币量 / 仓位」与「多单占比」之后）');
    // 与页面表头顺序一致：币量 / 仓位 → 多单占比 → 加仓校验
    renderList(screenshotLegs());
    const titles = titlesOf();
    expect(titles.indexOf(LONG)).toBe(titles.indexOf('币量 / 仓位') + 1);
    expect(titles.indexOf('加仓校验')).toBe(titles.indexOf(LONG) + 1);
    expect(titles).not.toContain(SHORT);
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
      expect(cellLines(shareCellOf(`eq${index}`, LONG))).toEqual(['16.7%', '16.7%']);
    }
    expect(blocks('legs-total-position')).toEqual([['多 3,000', '6000.00']]);
    expect(blocks('legs-total-position-share-long')).toEqual([['100.0%', '100.0%']]);
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
    /** 阶段子行默认折叠：点主力角色格里的「N 个阶段」展开。 */
    const expandPhases = (id: string) => fireEvent.click(screen.getByTestId(`leg-phases-toggle-${id}`));

    it('阶段子行这一列留空；多单主力独占多单的 100%，空单对冲整格留空、不进分母；合计行写多单的 100.0%，与多单那组 Σ 对齐', () => {
      renderList(phaseLegs);
      expandPhases('main');
      const coinsCol = colOf('币量 / 仓位');
      const longCol = colOf(LONG);
      expect(longCol).toBe(coinsCol + 1);
      expect(colOf('加仓校验')).toBe(longCol + 1);

      // 已平仓的对冲是仓位，但它是空单，不进多单的分母：94,300 ÷ 0.0336792 = 2,799,947.74 币（多）；50,000 ÷ 0.05 = 1,000,000 币（空）
      // （一个分母时曾印成 73.7% / 26.3%）
      expect(cellLines(shareCellOf('main', LONG))).toEqual(['100.0%', '100.0%']);
      expectNoShareCell('hedge-roll');

      const phaseRows = Array.from(screen.getByTestId('leg-phases-main').children);
      expect(phaseRows.length).toBeGreaterThanOrEqual(1);
      for (const row of phaseRows) {
        for (const col of [longCol, coinsCol]) {
          expect(row.children[col].textContent).toBe('');
          expect(row.children[col].children).toHaveLength(0);
        }
      }

      const total = screen.getByTestId('legs-total-row');
      expect(total.children[coinsCol]).toBe(screen.getByTestId('legs-total-position'));
      expect(total.children[longCol]).toBe(screen.getByTestId('legs-total-position-share-long'));
      expect(screen.queryByTestId('legs-total-position-share-short')).toBeNull();
      // 空单那组 Σ 照旧列出（对冲一共开了多大）
      expect(blocks('legs-total-position')).toEqual([
        ['多 2,799,947.74', '94300.00'],
        ['空 1,000,000', '50000.00'],
      ]);
      // 多单那组在第一组：「多单占比」合计只有这一组，不用垫占位
      expect(blocks('legs-total-position-share-long')).toEqual([['100.0%', '100.0%']]);
      // 合计行这两格是淡色、数字不上红绿；下行照旧更淡
      for (const id of ['legs-total-position', 'legs-total-position-share-long']) {
        const cell = screen.getByTestId(id);
        expect(cell.className).toContain('text-foreground/55');
        expect(cell.className).not.toMatch(/#0ECB81|#F6465D/);
        for (const block of Array.from(cell.children)) {
          expect(block.children[0].lastElementChild!.className).not.toMatch(/#0ECB81|#F6465D/);
          expect(block.children[1].className).toContain('text-muted-foreground');
        }
      }
      // 加仓校验那一格仍留空
      expect(total.children[longCol + 1].textContent).toBe('');
    });

    it('表头、腿行、阶段子行、合计行的格子数一致，「多单占比」落在同一列；空单的行在那一列是空格子', () => {
      renderList([...phaseLegs, pendingHedge]);
      expandPhases('main');
      const count = headerCells().length;
      expect(count).toBe(13);
      const longCol = colOf(LONG);
      const cell = screen.getByTestId('leg-position-share-main');
      expect(cell.parentElement!.children).toHaveLength(count);
      expect(cell.parentElement!.children[longCol]).toBe(cell);
      for (const id of ['hedge-roll', 'pending-hedge']) {
        expect(rowOf(id).children).toHaveLength(count);
        expectNoShareCell(id);
      }
      expect(screen.getAllByTestId(/^leg-position-share-/)).toEqual([cell]);
      for (const row of Array.from(screen.getByTestId('leg-phases-main').children)) {
        expect(row.children).toHaveLength(count);
      }
      expect(screen.getByTestId('legs-total-row').children).toHaveLength(count);
    });
  });

  describe('【用户要求 · 续】多单与空单分开算：空单不进多单的分母，只在合计行给出 Σ', () => {
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

    it('用户截图的形状：三条多单在「多单占比」列加起来 100.0%，空单对冲那一格留空；合计行照旧列出空单那组 Σ', () => {
      renderList(userShape());
      const longs = ['main', 'mirror', 'add'];
      expect(longs.map(id => cellLines(shareCellOf(id, LONG)))).toEqual([
        ['41.4%', '40.0%'],
        ['41.4%', '40.0%'],
        ['17.2%', '20.0%'],
      ]);
      for (const index of [0, 1] as const) {
        expect(longs.map(id => Number.parseFloat(cellLines(shareCellOf(id, LONG))[index]!)).reduce((sum, value) => sum + value, 0))
          .toBeCloseTo(100, 6);
      }
      // 空单对冲：整格留空（连「—」都不写），也不进多单的分母（三条多单照样加起来 100%）
      expectNoShareCell('hedge');
      // 合计行：先多后空，各一组 Σ；「多单占比」只写多单那组
      expect(blocks('legs-total-position')).toEqual([
        ['多 7,250', '7500.00'],
        ['空 1,818.18', '2000.00'],
      ]);
      expect(blocks('legs-total-position-share-long')).toEqual([['100.0%', '100.0%']]);
      expect(screen.getByTestId('legs-total-position').getAttribute('title')).toBe(BOTH_TOTALS_TITLE);
      // tooltip 逐格说明是哪一组里的占比
      expect(screen.getByTestId('leg-position-share-main').getAttribute('title'))
        .toBe('多单合计里的占比：币量 41.4%，名义仓位 40.0%');
      expect(screen.getAllByTestId(/^leg-position-share-/).map(cell => cell.getAttribute('data-side'))).toEqual(['long', 'long', 'long']);
    });

    it('主空战役里的多单对冲：分组跟方向走、不跟角色走——对冲进「多单占比」列，空单主力与加仓那一格留空、只进空单那组 Σ', () => {
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
      expect(cellLines(shareCellOf('hedge-long', LONG))).toEqual(['100.0%', '100.0%']);
      expectNoShareCell('main-short');
      expectNoShareCell('add-short');
      expect(blocks('legs-total-position')).toEqual([
        ['多 1,000', '2000.00'],
        ['空 4,000', '8000.00'],
      ]);
      expect(blocks('legs-total-position-share-long')).toEqual([['100.0%', '100.0%']]);
    });

    it('两条空单对冲：各自那一格留空，合计行的空单 Σ 是两条相加（对冲一共开了多大）；多单主力照旧 100.0%', () => {
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
      expectNoShareCell('hedge-a');
      expectNoShareCell('hedge-b');
      expect(cellLines(shareCellOf('main', LONG))).toEqual(['100.0%', '100.0%']);
      expect(blocks('legs-total-position')).toEqual([['多 1,000', '1000.00'], ['空 1,200', '1200.00']]);
      expect(blocks('legs-total-position-share-long')).toEqual([['100.0%', '100.0%']]);
    });

    it('主空战役里唯一的多单对冲还挂单中：多单那组不列，「多单占比」合计格留空；「币量 / 仓位」只剩空单那组', () => {
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
      expect(cellLines(shareCellOf('pending-long-hedge', LONG))).toEqual(['—', '—']);
      expectNoShareCell('main-short');
      expect(blocks('legs-total-position')).toEqual([['空 2,500', '5000.00']]);
      expect(screen.getByTestId('legs-total-position').getAttribute('title'))
        .toBe('空单一组是空单各腿的合计（只看总量，不算占比）；上行 Σ币量、下行 Σ名义仓位（挂单中的腿不计入）');
      expect(blocks('legs-total-position-share-long')).toEqual([]);
      expect(screen.getByTestId('legs-total-position-share-long').getAttribute('title')).toBeNull();
      expect(screen.queryByTestId('legs-total-position-long')).toBeNull();
      expect(screen.getByTestId('legs-total-position-short')).toBeTruthy();
      expect(screen.queryByTestId('legs-total-position-share-short')).toBeNull();
    });

    it('标签：只在列头与「币量 / 仓位」合计格里——「多」绿 #0ECB81、「空」红 #F6465D 的描边小胶囊', () => {
      renderList(userShape());
      const longTag = tagsIn(headerCells()[colOf(LONG)]);
      expect(longTag).toHaveLength(1);
      expect(longTag[0].textContent).toBe('多');
      expect(longTag[0].getAttribute('data-side')).toBe('long');
      expect(longTag[0].className).toContain('text-[#0ECB81]');
      expect(longTag[0].className).toContain('border-[#0ECB81]/40');
      expect(longTag[0].className).not.toContain('#F6465D');
      expect(longTag[0].className).toContain('border');
      expect(longTag[0].className).toContain('rounded-sm');
      // 标签是列头按钮里的第一个元素：读作「多 占比」
      expect(longTag[0].parentElement!.firstElementChild).toBe(longTag[0]);
      // 表头里只有这一枚：没有「空」列头
      expect(tagsIn(screen.getByTestId('legs-header-row'))).toEqual(longTag);
      // 腿行一枚都没有
      for (const id of ['main', 'mirror', 'hedge', 'add']) expect(tagsIn(rowOf(id))).toHaveLength(0);
      // 合计行：只有「币量 / 仓位」格每组一枚，顺序先多后空；「多单占比」的合计格不挂
      const totalTags = tagsIn(screen.getByTestId('legs-total-position'));
      expect(totalTags.map(tag => tag.textContent)).toEqual(['多', '空']);
      expect(tagsIn(screen.getByTestId('legs-total-row'))).toEqual(totalTags);
      const shortTag = totalTags[1];
      expect(shortTag.getAttribute('data-side')).toBe('short');
      expect(shortTag.className).toContain('text-[#F6465D]');
      expect(shortTag.className).toContain('border-[#F6465D]/40');
      expect(shortTag.className).not.toContain('#0ECB81');
      // 标签比所在那一行矮（9px 字、11px 行高，加上下边框 13px < 11px 字 × leading-snug 的 15.125px），不带上下内边距：
      // 「币量 / 仓位」合计格里带标签的一组与「多单占比」里不带标签的一组才一样高，「100.0%」与多单那组对齐
      const allTags = [...longTag, ...totalTags];
      expect(allTags).toHaveLength(3);
      for (const tag of allTags) {
        expect(tag.className).toContain('text-[9px]');
        expect(tag.className).toContain('leading-[11px]');
        expect(tag.className).not.toMatch(/\bpy-/);
        expect(tag.className).not.toMatch(/\b(h|min-h)-/);
      }
      // 合计格里标签所在的那一行与不带标签的行同一套排版（行高取自外层的 leading-snug，不被标签改写）
      const coinLines = screen.getByTestId('legs-total-position').children;
      const shareLine = screen.getByTestId('legs-total-position-share-long').children[0].children[0];
      expect(coinLines[0].children[0].className).toBe(shareLine.className);
      expect(coinLines[0].children[0].className).not.toMatch(/\b(leading|h|py)-/);
      expect(tagsIn(screen.getByTestId('legs-total-position-share-long'))).toHaveLength(0);
    });

    it('腿行不变高：占比格里仍只有两行，与左边「币量 / 仓位」同构；空单的行那一格是空的', () => {
      renderList(userShape());
      expectNoShareCell('hedge');
      expect(coinCell('hedge').children).toHaveLength(2);
      for (const id of ['main', 'mirror', 'add']) {
        const cell = screen.getByTestId(`leg-position-share-${id}`);
        expect(cell.className).toContain('leading-snug');
        expect(cell.className).toBe(coinCell(id).className);
        expect(cell.children).toHaveLength(2);
        expect(coinCell(id).children).toHaveLength(2);
        Array.from(cell.children).forEach((line, index) => {
          expect(line.className).toBe(coinCell(id).children[index].className);
        });
      }
    });

    it('合计行：两格同一套排版——「多单占比」唯一的一组与「币量 / 仓位」的第一组（多单）对齐，不再有隐形占位', () => {
      renderList(userShape());
      const coins = screen.getByTestId('legs-total-position');
      const long = screen.getByTestId('legs-total-position-share-long');
      expect(long.className).toBe(coins.className);
      expect(coins.className).toContain('space-y-1');
      // 两格都贴着合计行顶边排（只有一组的「多单占比」不在行里居中），多单那组才落在同一条水平线上
      expect(coins.className).toContain('self-start');
      expect(coins.children).toHaveLength(2);
      expect(long.children).toHaveLength(1);
      const [coinLong, coinShort] = Array.from(coins.children);
      const [longBlock] = Array.from(long.children);
      expect(coinLong.children).toHaveLength(2);
      expect(longBlock.children).toHaveLength(2);
      expect(coinLong.children[0].className).toBe(longBlock.children[0].className);
      expect(coinLong.children[1].className).toBe(longBlock.children[1].className);
      expect(coinLong.getAttribute('data-side')).toBe('long');
      expect(coinShort.getAttribute('data-side')).toBe('short');
      expect(longBlock.getAttribute('data-side')).toBe('long');
      // 没有为「空单占比」垫的隐形占位
      const total = screen.getByTestId('legs-total-row');
      expect(total.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
      expect(total.querySelectorAll('.invisible')).toHaveLength(0);
      // 四行字都在合计行「币量 / 仓位」格里：两组 × 两行；「多单占比」两行
      expect(lines('legs-total-position')).toHaveLength(4);
      expect(lines('legs-total-position-share-long')).toEqual(['100.0%', '100.0%']);
      expect(coins.getAttribute('title')).toBe(BOTH_TOTALS_TITLE);
      expect(long.getAttribute('title')).toBe('多单各腿合计为 100%');
      // 格子数不变
      const count = headerCells().length;
      expect(count).toBe(13);
      expect(total.children).toHaveLength(count);
      for (const id of ['main', 'mirror', 'hedge', 'add']) {
        expect(rowOf(id).children).toHaveLength(count);
      }
    });

    it('空单计入的腿都缺开仓价：合计行空单那组 Σ 上行「—」、下行照常；「多单占比」合计不受影响', () => {
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
      expect(blocks('legs-total-position')).toEqual([['多 3,000', '3000.00'], ['空 —', '2000.00']]);
      expect(blocks('legs-total-position-share-long')).toEqual([['100.0%', '100.0%']]);
      expect(screen.getByTestId('legs-total-position-share-long').getAttribute('title')).toBe('多单各腿合计为 100%');
      expect(cellLines(shareCellOf('main', LONG))).toEqual(['100.0%', '100.0%']);
      expectNoShareCell('hedge-no-price');
    });

    it('合计行「多单占比」格的 tooltip 只说有分母的那一行：多单计入的腿都缺开仓价时，不说「多单各腿合计为 100%」', () => {
      renderList([
        legFor({
          id: 'main-no-price', pre_entry_price: null, pre_position_size: 3_000,
          post_simulated_close_time: at('09:00'),
        }),
        legFor({
          id: 'hedge', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
          pre_simulated_time: at('03:00'), pre_entry_price: 1.1, pre_position_size: 2_000,
          post_exit_price_snapshot: 1.05, post_simulated_close_time: at('05:00'),
        }),
      ]);
      // 多单那组：上行没有分母（「—」），下行照常 100.0%
      expect(blocks('legs-total-position')).toEqual([['多 —', '3000.00'], ['空 1,818.18', '2000.00']]);
      expect(blocks('legs-total-position-share-long')).toEqual([['—', '100.0%']]);
      expect(screen.getByTestId('legs-total-position-share-long').getAttribute('title'))
        .toBe('多单各腿的名义仓位合计为 100%（币量缺开仓价，没有分母）');
      expect(cellLines(shareCellOf('main-no-price', LONG))).toEqual(['—', '100.0%']);
      expectNoShareCell('hedge');
    });
  });

  describe('Legs 纵向完整展开，合计不冻结', () => {
    it('全部腿行与两组分母自然排列，合计始终位于最后', () => {
      renderList([...screenshotLegs(), legFor({
        id: 'short-hedge', leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
        pre_entry_price: 1.1, pre_position_size: 2_000,
        post_exit_price_snapshot: 1.05, post_simulated_close_time: at('05:00'),
      })]);
      const area = screen.getByTestId('legs-scroll');
      expect(area.className).toContain('overflow-x-auto');
      expect(area.className).not.toMatch(/(?:^|\s)(?:max-h-|h-)/);
      expect(blocks('legs-total-position')).toHaveLength(2);
      const total = screen.getByTestId('legs-total-row');
      expect(area.contains(total)).toBe(true);
      const all = Array.from(area.querySelectorAll('*'));
      expect(all.slice(all.indexOf(total) + 1).every(el => total.contains(el))).toBe(true);
      expect(total.children).toHaveLength(headerCells().length);
    });

    it('合计不再贴底，容器也不再为冻结合计预留滚动空白', () => {
      renderList(screenshotLegs());
      const total = screen.getByTestId('legs-total-row');
      expect(total.className.split(/\s+/)).not.toContain('sticky');
      expect(total.className.split(/\s+/)).not.toContain('bottom-0');
      expect(screen.getByTestId('legs-scroll').className).not.toMatch(/scroll-pb-/);
    });
  });
});
