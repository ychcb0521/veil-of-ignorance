/**
 * 【用户要求】排序行与战役封面的共用列守卫。
 *
 * 涨幅、涨幅效率、盈亏比、加仓效率、几何期望五个排序按钮的左缘，要与每张卡片上同名五格的左缘落在同一条竖线上；
 * 之后的算术期望、镜像止盈也各自压在卡片同名格的竖线上（不能差十几像素「差一点对齐」）。
 * 做法与 Legs 表共用 LEGS_GRID 相同：两行只读一个列模板 CAMPAIGN_COLUMNS_GRID，排序行按 CAMPAIGN_SORT_COLUMNS 分组。
 * 【用户要求】「重要性」放在后面：排在杠杆倍数之后、字母之前，首列只剩「排序方式 / 操作时间」，首列随之收窄、整张表左移。
 * jsdom 没有布局，真实的左缘读数在浏览器里实测（1280 / 1440 / 1920 / 2560 七个同名列差值都是 0px）；
 * 这里守住会让对齐悄悄失效的几件事：常量只有一份、两行都引用它、分组与排序次序一致、列宽装得下实测最长内容。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = () => readFileSync(join(process.cwd(), 'src/pages/JournalCampaignsPage.tsx'), 'utf8');

/**
 * 浏览器实测（Chrome，JetBrains Mono + 苹方；卡片 10px 标签 / 11px 数字，排序按钮 10px）的最长内容宽度，
 * 卡片格含 1px 分隔线与 6px 内边距，排序按钮含 1px 边框与 6px 内边距：
 * 盈亏比「49628.76%（496.29）」、涨幅「+437.21%」、涨幅效率「+130.41」、加仓效率三位整数「+123.45」、
 * 几何期望「50.63」＋「仓位击穿」、算术期望「+247.65R」、镜像止盈最长「已实现·进行中」、首列预期回撤「12.34%」。
 * 排序行：首列「排序方式 / 操作时间 ↓」、几何期望列「几何期望 | 预期回撤」、
 * 末列「镜像止盈 DSI 贡献 USI 贡献 杠杆倍数 重要性 字母」（按钮间距 2px；杠杆 / 字母选中时多一个箭头）。
 */
const CARD = {
  expectedDrawdownPct: 87.2,
  mainPriceChange: 94,
  mainPriceEfficiency: 107.4,
  captureRate: 172.3,
  addEfficiency: 107.6,
  geometricExpectancy: 142.1,
  arithmeticExpectancy: 114,
  mirrorTpLongest: 136,
};
const SORT = {
  lead: 142,
  geometricColumn: 157,
  lastColumnWorst: 372.5,
  /** 末列换行时的两行：「镜像止盈 DSI 贡献 USI 贡献」与「杠杆倍数 重要性 字母」（其一选中时多一个箭头） */
  lastColumnWrappedLines: [206.5, 164],
};
/** 卡片数值之后至少留的空白，免得数字贴着下一列的分隔线。 */
const MIN_GUTTER = 8;
/** 首列放下两行里较宽的内容（排序行「排序方式 / 操作时间 ↓」）后再留的空白，与「涨幅」列隔开。 */
const LEAD_GAP = 12;
/** 排序按钮之间的间距：末列按钮之间、几何期望列末尾的「预期回撤」与「算术期望」之间都是 2px。 */
const BUTTON_GAP = 2;
/** 改版前排序行一行放下的最窄窗口（杠杆 / 字母选中时）；收窄首列之后不能比它更宽。 */
const PREVIOUS_ONE_LINE_VIEWPORT = 1421;
/** 视口 − main 左右各 24px − 1px 框 ×2 − 20px 内边距 ×2 */
const gridWidthAt = (viewport: number) => viewport - 48 - 2 - 40;

function gridColumns(s: string): string[] {
  const grid = /const CAMPAIGN_COLUMNS_GRID = '([^']+)'/.exec(s)?.[1] ?? '';
  const template = /xl:grid-cols-\[([^\]]+)\]/.exec(grid)?.[1] ?? '';
  // 模板里的逗号只出现在 minmax(...) 里，按下划线切即可
  return template.split('_');
}

function fixedWidths(s: string): number[] {
  return gridColumns(s).slice(0, 7).map(col => Number(/^(\d+)px$/.exec(col)?.[1]));
}

function sortColumns(s: string): string[][] {
  const block = /const CAMPAIGN_SORT_COLUMNS[^=]*= \[([\s\S]*?)\n\];/.exec(s)?.[1] ?? '';
  return [...block.matchAll(/\[([^\]]*)\]/g)].map(match => [...match[1].matchAll(/'([A-Za-z]+)'/g)].map(m => m[1]));
}

describe('排序行与战役封面的共用列', () => {
  it('列模板只有一份常量，排序行与卡片指标行各引用一次', () => {
    const s = src();
    expect(s).toContain('const CAMPAIGN_COLUMNS_GRID =');
    // 除常量本身外，页面里不再有别的 grid-cols-[...]
    expect((s.match(/grid-cols-\[/g) ?? []).length).toBe(1);
    expect((s.match(/\$\{CAMPAIGN_COLUMNS_GRID\}/g) ?? []).length).toBe(2);
    // 列间距归零：列与列之间只由模板决定
    expect(/const CAMPAIGN_COLUMNS_GRID = '([^']+)'/.exec(s)?.[1]).toContain('xl:gap-x-0');
  });

  it('两行的网格从同一个 x 起步：同一套内边距，排序行补一条透明 1px 边框抵掉卡片外框', () => {
    const s = src();
    expect(s).toContain("const CAMPAIGN_COLUMNS_FRAME = 'border-x border-transparent';");
    expect((s.match(/\$\{CAMPAIGN_COLUMNS_FRAME\}/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((s.match(/\$\{CAMPAIGN_COLUMNS_INSET\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // 卡片外框就是那 1px
    expect(s).toMatch(/data-testid="campaign-card"[\s\S]{0,400}rounded-md border\b/);
    // 文字缩进：卡片格 1px 分隔线 + pl-1.5，排序按钮 1px 边框 + px-1.5
    expect(s).toContain("const CAMPAIGN_COLUMN_TEXT_INSET = 'xl:pl-1.5';");
    expect(s).toMatch(/const CARD_METRIC_CELL = `[^`]*xl:border-l[^`]*\$\{CAMPAIGN_COLUMN_TEXT_INSET\}`/);
    expect(s).toMatch(/rounded border px-1\.5 transition-/);
  });

  it('排序行按列分组：摊平就是排序次序；第 2–6 列是用户要的五项，第 7、8 列是算术期望与镜像止盈', () => {
    const s = src();
    const columns = sortColumns(s);
    expect(columns).toHaveLength(gridColumns(s).length);
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(s)?.[1] ?? '';
    const order = [...block.matchAll(/value: '([A-Za-z]+)'/g)].map(match => match[1]);
    expect(columns.flat()).toEqual(order);
    // 【用户要求】重要性放到后面：首列只剩操作时间，重要性排在杠杆倍数之后、字母之前
    expect(columns[0]).toEqual(['time']);
    expect(columns.slice(1, 6).map(column => column[0]))
      .toEqual(['mainPriceChange', 'mainPriceEfficiency', 'captureRate', 'addEfficiency', 'geometricExpectancy']);
    expect(columns[6][0]).toBe('arithmeticExpectancy');
    expect(columns[7]).toEqual(['mirrorTp', 'dsiContribution', 'usiContribution', 'leverage', 'importance', 'alpha']);
    // 预期回撤跟在几何期望后面，前面画一条短分隔线（它的卡片格在第 1 列）
    expect(columns[5]).toEqual(['geometricExpectancy', 'expectedDrawdownPct']);
    expect(s).toContain("const SORT_DIVIDER_BEFORE: CampaignSortMode = 'expectedDrawdownPct';");
  });

  it('列数 = 八列、末列 1fr；首列 = 两行里较宽的内容 + 12px，其余每列装得下两行里更宽的那个实测内容', () => {
    const s = src();
    const cols = gridColumns(s);
    expect(cols).toHaveLength(8);
    expect(cols[7]).toBe('minmax(0,1fr)');
    const px = fixedWidths(s);
    expect(px.every(Number.isFinite)).toBe(true);
    const [lead, change, efficiency, payoff, add, geometric, arithmetic] = px;
    // 首列只容「排序方式 / 操作时间」与卡片的预期回撤：取较大者再留 LEAD_GAP，不多占
    expect(lead).toBe(Math.ceil(Math.max(SORT.lead, CARD.expectedDrawdownPct)) + LEAD_GAP);
    expect(change - CARD.mainPriceChange).toBeGreaterThanOrEqual(MIN_GUTTER);
    expect(efficiency - CARD.mainPriceEfficiency).toBeGreaterThanOrEqual(MIN_GUTTER);
    expect(payoff - CARD.captureRate).toBeGreaterThanOrEqual(MIN_GUTTER);
    expect(add - CARD.addEfficiency).toBeGreaterThanOrEqual(MIN_GUTTER);
    expect(geometric - CARD.geometricExpectancy).toBeGreaterThanOrEqual(MIN_GUTTER);
    expect(geometric - SORT.geometricColumn).toBeGreaterThanOrEqual(BUTTON_GAP);
    expect(arithmetic - CARD.arithmeticExpectancy).toBeGreaterThanOrEqual(MIN_GUTTER);
  });

  it('1414px 起排序行一行放得下（比改版前的 1421px 更早）；1280px 时卡片一行放得下，排序行末列换成两行也不越界', () => {
    const fixed = fixedWidths(src()).reduce((sum, value) => sum + value, 0);
    expect(fixed + SORT.lastColumnWorst).toBeLessThanOrEqual(gridWidthAt(1414));
    expect(gridWidthAt(1414)).toBeLessThan(gridWidthAt(PREVIOUS_ONE_LINE_VIEWPORT));
    expect(fixed + SORT.lastColumnWorst).toBeLessThanOrEqual(gridWidthAt(1440));
    expect(fixed + CARD.mirrorTpLongest).toBeLessThanOrEqual(gridWidthAt(1280));
    // 末列在 1280px 时恰好两行：每一行都装得下，前两段合起来装不下
    const lastAt1280 = gridWidthAt(1280) - fixed;
    for (const line of SORT.lastColumnWrappedLines) expect(lastAt1280).toBeGreaterThanOrEqual(line);
    expect(SORT.lastColumnWrappedLines.reduce((sum, line) => sum + line, 0) + BUTTON_GAP).toBeGreaterThan(lastAt1280);
  });

  it('末列按钮间距 2px（统计概览同一节奏）、其余列照常 4px；末列放不下时在本列内换行', () => {
    const s = src();
    expect(s).toContain("column === lastColumn ? 'xl:flex-wrap xl:gap-x-0.5 xl:gap-y-1' : 'xl:gap-1'");
  });
});

describe('公式 / 统计浮层', () => {
  it('每个浮层离视口边缘至少 12px，窄屏上宽度也让出两侧这 12px', () => {
    const s = src();
    expect(s).toContain('const POPOVER_COLLISION_PADDING = 12;');
    expect(s).toContain("const POPOVER_VIEWPORT_MAX_W = 'max-w-[calc(100vw_-_24px)]';");
    const tags = s.match(/<PopoverContent\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(9);
    for (const tag of tags) {
      expect(tag).toContain('collisionPadding={POPOVER_COLLISION_PADDING}');
      expect(tag).toContain('${POPOVER_VIEWPORT_MAX_W}');
    }
  });

  it('react 只 import 一次', () => {
    expect((src().match(/from 'react';/g) ?? []).length).toBe(1);
  });
});
