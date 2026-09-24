/**
 * 战役封面指标行的守卫，与排序行左对齐的守卫。
 *
 * 封面：【用户要求】「交易战役的封面上的指标做成左对齐，要美观，不需要均匀分布。美观是第一位的」——八项指标从左往右紧凑排开
 * （上指标名、下数值），每项宽度按它自己的最长真实读数定（CARD_METRIC_WIDTH），不再均分整行；每张卡读同一套宽度，
 * 上下各张卡的同名项落在同一条竖线上。手机退回两列网格。
 * 【用户要求】「选中排序功能的时候，交易战役封面上对应的模块高亮显示」：高亮只换底色与描边，不改内边距。
 * 排序行：【用户要求】「排序方式这里不美观。这里还是用左对齐吧」——按钮按 SORT_OPTIONS 依次左对齐排开，
 * 两条短分隔线分出「操作时间 · 镜像止盈 ┆ 预期回撤…算术期望 ┆ 其余」三组；行首与封面左缘对齐（同一套内边距 + 透明 1px 边框）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = () => readFileSync(join(process.cwd(), 'src/pages/JournalCampaignsPage.tsx'), 'utf8');

/**
 * 浏览器实测（Chrome，macOS；卡片数值 11px 等宽 font-mono、font-medium）的各项最长真实读数（px），指标名 10px 四个字约 40px：
 * 镜像止盈「已实现·进行中」72.6；预期回撤「100.00%」、涨跌幅倍数 / 加仓效用「+130.41」46.4；涨跌幅「+437.21%」、算术期望「+383.20R」53；
 * 盈亏比「76740.80%（767.41）」121.3；几何期望「50.63」＋ 6px ＋「仓位击穿」徽标 83.1。
 */
const WIDEST: Record<string, number> = {
  mirrorTp: 72.6,
  expectedDrawdownPct: 46.4,
  mainPriceChange: 53,
  mainPriceEfficiency: 46.4,
  captureRate: 121.3,
  addEfficiency: 46.4,
  geometricExpectancy: 83.1,
  arithmeticExpectancy: 53,
};
/** 每项左右各 10px 内边距（px-2.5）。 */
const CELL_PADDING_X = 20;

function metricWidths(s: string): Record<string, number> {
  const block = /const CARD_METRIC_WIDTH = \{([\s\S]*?)\n\}/.exec(s)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(\w+): 'sm:w-\[(\d+)px\]'/g)].map(match => [match[1], Number(match[2])]));
}

describe('封面指标行左对齐、按读数定宽；排序行左对齐', () => {
  it('指标行读一份常量：手机两列网格，≥ 640px 左对齐依次排开；不再均分整行', () => {
    const s = src();
    expect(s).toContain("const CARD_METRIC_STRIP = 'grid grid-cols-2 gap-1 sm:flex sm:flex-wrap sm:gap-x-2 sm:gap-y-1';");
    expect(s).toMatch(/data-testid="campaign-card-metrics"\s+className=\{CARD_METRIC_STRIP\}/);
    // 旧的等宽网格（一行八格均分）不再出现
    expect(s).not.toContain('CAMPAIGN_COLUMNS_GRID');
    expect(s).not.toMatch(/xl:grid-cols-8/);
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

  it('封面指标项与排序行同序，每项按它对应的排序项取宽度与高亮', () => {
    const s = src();
    const start = s.indexOf('data-testid="campaign-card-metrics"');
    const end = s.indexOf('{detailsExpanded && (', start);
    const strip = s.slice(start, end);
    const cells = [...strip.matchAll(/metricCell\('(\w+)'\)\}[\s\S]{0,40}?data-testid="(campaign-[a-z-]+)"|data-testid="(campaign-[a-z-]+)"\s+[^>]*?className=\{metricCell\('(\w+)'\)\}/g)]
      .map(match => [match[1] ?? match[4], match[2] ?? match[3]]);
    expect(cells).toEqual([
      ['mirrorTp', 'campaign-mirror-tp-status'],
      ['expectedDrawdownPct', 'campaign-expected-drawdown-pct'],
      ['mainPriceChange', 'campaign-main-price-change'],
      ['mainPriceEfficiency', 'campaign-main-price-efficiency'],
      ['captureRate', 'campaign-payoff-ratio'],
      ['addEfficiency', 'campaign-add-efficiency'],
      ['geometricExpectancy', 'campaign-geometric-expectancy'],
      ['arithmeticExpectancy', 'campaign-arithmetic-expectancy'],
    ]);
    // 排序行里这八项的先后与封面一致
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(s)?.[1] ?? '';
    const order = [...block.matchAll(/value: '([A-Za-z]+)'/g)].map(match => match[1]);
    expect(order.filter(mode => cells.some(([cellMode]) => cellMode === mode))).toEqual(cells.map(([mode]) => mode));
  });

  it('每项宽度装得下它的最长读数；一行八项的总宽在 1024px 的屏幕上放得下；首项文字与标题行同一起点', () => {
    const s = src();
    const widths = metricWidths(s);
    expect(Object.keys(widths).sort()).toEqual(Object.keys(WIDEST).sort());
    for (const [mode, width] of Object.entries(widths)) {
      expect(width - CELL_PADDING_X - WIDEST[mode], mode).toBeGreaterThanOrEqual(3);
    }
    // 1024px：视口 − main 左右 24px ×2 − 卡片边框 2 − 指标行外框 10px ×2；项与项之间 8px（sm:gap-x-2）
    const total = Object.values(widths).reduce((sum, width) => sum + width, 0) + 7 * 8;
    expect(total).toBeLessThanOrEqual(1024 - 48 - 2 - 20);
    // 外框内边距 + 每项 10px = 标题行 px-4 / sm:px-5
    expect(s).toContain("const CARD_METRIC_STRIP_INSET = 'px-1.5 py-1 sm:px-2.5';");
    expect(s).toContain("const CAMPAIGN_COLUMNS_INSET = 'px-4 sm:px-5';");
    expect(s).toMatch(/const CARD_METRIC_CELL = '[^']*\bpx-2\.5\b[^']*'/);
  });

  it('【用户要求】当前排序项高亮：只换底色与描边，不改内边距、不挪文字', () => {
    const s = src();
    const box = /const SORT_HIGHLIGHT_BOX = '([^']+)'/.exec(s)?.[1] ?? '';
    expect(box).toContain('ring-1');
    expect(box).toMatch(/bg-\[#F0B90B\]/);
    // 没有任何会改尺寸的类
    expect(box).not.toMatch(/(^|\s)(dark:)?(p[xytblr]?|m[xytblr]?|w|h|border)-/);
    // 封面上其它对应模块也接同一套高亮：操作时间、杠杆、重要性、字母（标题）
    for (const mode of ['time', 'leverage', 'importance', 'alpha']) {
      expect(s, mode).toContain(`data-sort-highlight={litAttr('${mode}')}`);
    }
    expect(s).toContain('sortHighlight={sortState.mode}');
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
