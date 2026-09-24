/**
 * 战役封面指标行的等宽统计格守卫，与排序行左对齐的守卫。
 *
 * 封面：【用户要求】「交易战役封面的指标排布要美观，现在太零散了，不整齐」——八项指标排成等宽的统计格
 * （上指标名、下数值），每张卡读同一个常量 CAMPAIGN_COLUMNS_GRID；格宽只由卡片宽度决定，上下各张卡的同名格落在同一条竖线上。
 * 宽屏一行八格、平板一行四格、手机一行两格，断点按浏览器实测的最长读数定。
 * 排序行：【用户要求】「排序方式这里不美观。这里还是用左对齐吧」——不读封面的格子模板，按钮按 SORT_OPTIONS 依次左对齐排开，
 * 两条短分隔线分出「操作时间 · 镜像止盈 ┆ 预期回撤…算术期望 ┆ 其余」三组；行首与封面左缘对齐（同一套内边距 + 透明 1px 边框）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = () => readFileSync(join(process.cwd(), 'src/pages/JournalCampaignsPage.tsx'), 'utf8');

/**
 * 浏览器实测（Chrome，macOS；卡片数值 11px 等宽 font-mono、font-medium）的最长真实读数：
 * 盈亏比「49628.76%（496.29）」121.3px。其余各格的最长读数都窄得多：几何期望「50.63」＋ 6px ＋「仓位击穿」徽标 83.1px、
 * 镜像止盈「已实现·进行中」72.6px、涨幅「+437.21%」53px、算术期望「+247.65R」53px、涨幅效率 / 加仓效率「+130.41」46.4px。
 */
const WIDEST_VALUE = 121.3;
/** 起用一档格数时，最长读数之后至少还留的空白。 */
const MIN_SPARE = 4;
/** 格子左右各 12px 内边距（px-3）。 */
const CELL_PADDING_X = 24;
/**
 * 指标行（dl）的宽度：视口 − main 左右内边距（< 640px 为 16px，否则 24px）− 卡片 1px 边框 ×2
 * − 指标行外框左右内边距（< 640px 为 4px，否则 8px）。
 */
const gridWidthAt = (viewport: number) => viewport - (viewport < 640 ? 32 : 48) - 2 - (viewport < 640 ? 8 : 16);
const contentWidthAt = (viewport: number, cols: number) => gridWidthAt(viewport) / cols - CELL_PADDING_X;

const SCREEN_PX: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };

/** 从常量里读出「从多宽起一行几格」：[[0, 2], [672, 4], [1280, 8]]。 */
function breakpoints(s: string): Array<[number, number]> {
  const grid = /const CAMPAIGN_COLUMNS_GRID = '([^']+)'/.exec(s)?.[1] ?? '';
  const steps: Array<[number, number]> = [];
  for (const token of grid.split(/\s+/)) {
    const match = /^(?:(sm|md|lg|xl|2xl|min-\[(\d+)px\]):)?grid-cols-(\d+)$/.exec(token);
    if (!match) continue;
    const from = match[1] == null ? 0 : match[2] != null ? Number(match[2]) : SCREEN_PX[match[1]];
    steps.push([from, Number(match[3])]);
  }
  return steps.sort((a, b) => a[0] - b[0]);
}

describe('封面等宽统计格、排序行左对齐', () => {
  it('格子模板只有一份常量，只给封面指标行用；排序行不读它；没有按读数定宽的列', () => {
    const s = src();
    expect(s).toContain('const CAMPAIGN_COLUMNS_GRID =');
    expect((s.match(/\$\{CAMPAIGN_COLUMNS_GRID\}/g) ?? []).length).toBe(1);
    expect(s).toMatch(/data-testid="campaign-card-metrics"[\s\S]{0,120}\$\{CAMPAIGN_COLUMNS_GRID\} overflow-hidden/);
    expect(s).not.toMatch(/data-testid="campaign-sort-controls"[\s\S]{0,400}\$\{CAMPAIGN_COLUMNS_GRID\}/);
    // 等宽：不再有逐列写死像素宽度的模板，也不再有给首格另开的特例
    expect(s).not.toMatch(/grid-cols-\[/);
    expect(s).not.toContain('CARD_METRIC_LEAD_CELL');
    expect(s).not.toContain('CAMPAIGN_COLUMN_TEXT_INSET');
    expect(s).not.toContain('CAMPAIGN_SORT_COLUMNS');
  });

  it('排序行：左对齐 flex 换行，两条分隔线在「预期回撤」与「DSI 贡献」之前；行首与封面左缘对齐', () => {
    const s = src();
    expect(s).toContain("new Set<CampaignSortMode>(['expectedDrawdownPct', 'dsiContribution'])");
    expect(s).toMatch(/data-testid="campaign-sort-controls"\s+className=\{`order-2 flex min-h-11 flex-wrap items-center gap-x-1 gap-y-1[^`]*\$\{CAMPAIGN_COLUMNS_FRAME\} \$\{CAMPAIGN_COLUMNS_INSET\}`\}/);
    expect(s).toContain("const CAMPAIGN_COLUMNS_FRAME = 'border-x border-transparent';");
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(s)?.[1] ?? '';
    const order = [...block.matchAll(/value: '([A-Za-z]+)'/g)].map(match => match[1]);
    // 【用户要求】操作时间、镜像止盈 ┆ 预期回撤 … 算术期望 ┆ DSI 贡献 … 字母
    expect(order).toEqual([
      'time', 'mirrorTp',
      'expectedDrawdownPct', 'mainPriceChange', 'mainPriceEfficiency', 'captureRate', 'addEfficiency',
      'geometricExpectancy', 'arithmeticExpectancy',
      'dsiContribution', 'usiContribution', 'leverage', 'importance', 'alpha',
    ]);
  });

  it('封面指标格与排序行同序（操作时间留在标题行）', () => {
    const s = src();
    const start = s.indexOf('data-testid="campaign-card-metrics"');
    const end = s.indexOf('{detailsExpanded && (', start);
    const strip = s.slice(start, end);
    const cells = [...strip.matchAll(/data-testid="(campaign-[a-z-]+)"/g)]
      .map(match => match[1])
      .filter(id => id !== 'campaign-card-metrics' && !id.endsWith('-value'));
    expect(cells).toEqual([
      'campaign-mirror-tp-status',
      'campaign-expected-drawdown-pct',
      'campaign-main-price-change',
      'campaign-main-price-efficiency',
      'campaign-payoff-ratio',
      'campaign-add-efficiency',
      'campaign-geometric-expectancy',
      'campaign-arithmetic-expectancy',
    ]);
    // 每格都读同一个格子类名
    expect((strip.match(/className=\{CARD_METRIC_CELL\}/g) ?? []).length).toBe(8);
  });

  it('手机两格、平板四格、宽屏八格；每一档起用时最长读数都装得下，1280px 起一行八格', () => {
    const s = src();
    const steps = breakpoints(s);
    expect(steps.map(([, cols]) => cols)).toEqual([2, 4, 8]);
    const [[, phoneCols], [tabletFrom], [wideFrom]] = steps;
    expect(wideFrom).toBeLessThanOrEqual(1280);
    // 每一档在它起用的那个宽度上：最长读数之后还留 ≥ 4px
    for (const [from, cols] of steps) {
      const viewport = from === 0 ? 360 : from;
      expect(contentWidthAt(viewport, cols) - WIDEST_VALUE, `${cols} 格 @ ${viewport}px`).toBeGreaterThanOrEqual(MIN_SPARE);
    }
    // 手机（390px）两格、平板起点之前一像素仍是两格：各格都装得下
    expect(contentWidthAt(390, phoneCols)).toBeGreaterThanOrEqual(WIDEST_VALUE + MIN_SPARE);
    expect(contentWidthAt(tabletFrom - 1, phoneCols)).toBeGreaterThanOrEqual(WIDEST_VALUE + MIN_SPARE);
    // 首格文字与标题行同一起点：外框内边距 + 格子 12px = 标题行 px-4 / sm:px-5
    expect(s).toContain("const CARD_METRIC_STRIP_INSET = 'px-1 sm:px-2';");
    expect(s).toContain("const CAMPAIGN_COLUMNS_INSET = 'px-4 sm:px-5';");
    expect(s).toMatch(/const CARD_METRIC_CELL = '[^']*\bpx-3\b[^']*'/);
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
