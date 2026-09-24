/**
 * 战役封面指标行的列守卫，与排序行左对齐的守卫。
 *
 * 封面：每张卡的指标行读同一张列模板 CAMPAIGN_COLUMNS_GRID，上下各张卡的同名格落在同一条竖线上；列宽装得下实测最长内容。
 * 排序行：【用户要求】「排序方式这里不美观。这里还是用左对齐吧」——不再读封面的列模板，按钮按 SORT_OPTIONS 依次左对齐排开，
 * 两条短分隔线分出「操作时间 ┆ 涨幅…几何期望 ┆ 其余」三组；行首与封面左缘对齐（同一套内边距 + 透明 1px 边框）。
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
/** 卡片数值之后至少留的空白，免得数字贴着下一列的分隔线。 */
const MIN_GUTTER = 8;
/** 首列（预期回撤）之后与「涨幅」列隔开的空白。 */
const LEAD_GAP = 12;
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

describe('封面按列、排序行左对齐', () => {
  it('列模板只有一份常量，只给封面指标行用；排序行不读它', () => {
    const s = src();
    expect(s).toContain('const CAMPAIGN_COLUMNS_GRID =');
    expect((s.match(/grid-cols-\[/g) ?? []).length).toBe(1);
    expect((s.match(/\$\{CAMPAIGN_COLUMNS_GRID\}/g) ?? []).length).toBe(1);
    expect(s).toMatch(/data-testid="campaign-card-metrics"[\s\S]{0,300}\$\{CAMPAIGN_COLUMNS_GRID\}/);
    expect(s).not.toMatch(/data-testid="campaign-sort-controls"[\s\S]{0,400}\$\{CAMPAIGN_COLUMNS_GRID\}/);
    expect(s).not.toContain('CAMPAIGN_SORT_COLUMNS');
  });

  it('排序行：左对齐 flex 换行，两条分隔线在「涨幅」与「预期回撤」之前；行首与封面左缘对齐', () => {
    const s = src();
    expect(s).toContain("new Set<CampaignSortMode>(['mainPriceChange', 'expectedDrawdownPct'])");
    expect(s).toMatch(/data-testid="campaign-sort-controls"\s+className=\{`order-2 flex min-h-11 flex-wrap items-center gap-x-1 gap-y-1[^`]*\$\{CAMPAIGN_COLUMNS_FRAME\} \$\{CAMPAIGN_COLUMNS_INSET\}`\}/);
    expect(s).toContain("const CAMPAIGN_COLUMNS_FRAME = 'border-x border-transparent';");
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(s)?.[1] ?? '';
    const order = [...block.matchAll(/value: '([A-Za-z]+)'/g)].map(match => match[1]);
    expect(order).toEqual([
      'time', 'mainPriceChange', 'mainPriceEfficiency', 'captureRate', 'addEfficiency', 'geometricExpectancy',
      'expectedDrawdownPct', 'arithmeticExpectancy', 'mirrorTp', 'dsiContribution', 'usiContribution', 'leverage', 'importance', 'alpha',
    ]);
  });

  it('封面八列、末列 1fr；每列装得下实测最长内容；1280px 时一行放得下', () => {
    const s = src();
    const cols = gridColumns(s);
    expect(cols).toHaveLength(8);
    expect(cols[7]).toBe('minmax(0,1fr)');
    const px = fixedWidths(s);
    expect(px.every(Number.isFinite)).toBe(true);
    const [lead, change, efficiency, payoff, add, geometric, arithmetic] = px;
    expect(lead - CARD.expectedDrawdownPct).toBeGreaterThanOrEqual(LEAD_GAP);
    expect(change - CARD.mainPriceChange).toBeGreaterThanOrEqual(MIN_GUTTER);
    expect(efficiency - CARD.mainPriceEfficiency).toBeGreaterThanOrEqual(MIN_GUTTER);
    expect(payoff - CARD.captureRate).toBeGreaterThanOrEqual(MIN_GUTTER);
    expect(add - CARD.addEfficiency).toBeGreaterThanOrEqual(MIN_GUTTER);
    expect(geometric - CARD.geometricExpectancy).toBeGreaterThanOrEqual(MIN_GUTTER);
    expect(arithmetic - CARD.arithmeticExpectancy).toBeGreaterThanOrEqual(MIN_GUTTER);
    const fixed = px.reduce((sum, value) => sum + value, 0);
    expect(fixed + CARD.mirrorTpLongest).toBeLessThanOrEqual(gridWidthAt(1280));
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
