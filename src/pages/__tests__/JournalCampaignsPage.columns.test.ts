/**
 * 战役封面指标行的守卫，与排序行左对齐的守卫。
 *
 * 封面：【用户要求】「交易战役的封面上的指标做成左对齐，要美观，不需要均匀分布。美观是第一位的」——八项指标从左往右紧凑排开
 * （上指标名、下数值），不均分整行；上下各张卡的同名项落在同一条竖线上。手机退回两列网格。
 * 【用户要求】「封面上的指标的分布还不是很均匀，要做的非常均匀，美观，不要有没必要的空隙」——每项宽度不再是按理论最长读数
 * 写死的静态表，而是按当前列表里实际出现的读数估算（cardMetricColumnWidths），以 CSS 变量挂在列表容器上；
 * 「仓位击穿」徽标从几何期望格挪到标题行、紧跟杠杆标签。
 * 【用户要求】「选中排序功能的时候，交易战役封面上对应的模块高亮显示」：高亮只换底色与描边，不改内边距。
 * 排序行：【用户要求】「排序方式这里不美观。这里还是用左对齐吧」——按钮按 SORT_OPTIONS 依次左对齐排开，
 * 两条短分隔线分出「操作时间 · 镜像止盈 ┆ 预期回撤…算术期望 ┆ 其余」三组；行首与封面左缘对齐（同一套内边距 + 透明 1px 边框）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = () => readFileSync(join(process.cwd(), 'src/pages/JournalCampaignsPage.tsx'), 'utf8');

const METRIC_MODES = [
  'mirrorTp', 'expectedDrawdownPct', 'mainPriceChange', 'mainPriceEfficiency',
  'captureRate', 'addEfficiency', 'geometricExpectancy', 'arithmeticExpectancy',
];

function constBlock(s: string, name: string): string {
  return new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\}`).exec(s)?.[1] ?? '';
}

function stripSource(s: string): string {
  const start = s.indexOf('data-testid="campaign-card-metrics"');
  const end = s.indexOf('{detailsExpanded && (', start);
  return s.slice(start, end);
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

  it('【用户要求】列宽按当前列表的读数定：静态宽度表删掉，每项读列表容器上的 CSS 变量；首项文字与标题行同一起点', () => {
    const s = src();
    // 按理论最长读数写死的静态宽度表不再出现
    expect(s).not.toContain('CARD_METRIC_WIDTH =');
    expect(s).not.toMatch(/sm:w-\[\d+px\]/);
    // 八项指标名一份常量（dt 与宽度估算共用），次序与排序行一致
    const labels = [...constBlock(s, 'CARD_METRIC_LABEL').matchAll(/(\w+): '([^']+)'/g)].map(match => [match[1], match[2]]);
    expect(labels).toEqual([
      ['mirrorTp', '镜像止盈'], ['expectedDrawdownPct', '预期回撤'], ['mainPriceChange', '涨跌幅'], ['mainPriceEfficiency', '涨跌幅倍数'],
      ['captureRate', '盈亏比'], ['addEfficiency', '加仓效用'], ['geometricExpectancy', '几何期望'], ['arithmeticExpectancy', '算术期望'],
    ]);
    // 每项的宽度类读 --cm-w-<项>（Tailwind 要完整类名，逐个写出）
    const widthClasses = [...constBlock(s, 'CARD_METRIC_WIDTH_CLASS').matchAll(/(\w+): '([^']+)'/g)].map(match => [match[1], match[2]]);
    expect(widthClasses).toEqual(METRIC_MODES.map(mode => [mode, `sm:w-[var(--cm-w-${mode})]`]));
    expect(s).toContain('const metricCell = (mode: CardMetricMode) => `${CARD_METRIC_CELL} ${CARD_METRIC_WIDTH_CLASS[mode]} ');
    // 变量由当前时间段里的全部战役（displayRows）的读数算出，不随排序变——排序会筛掉算不出这一项的战役，
    // 按筛完的列表算，切换排序时后面各格会整体左右挪；挂在包住全部卡片的列表容器上
    expect(s).toContain("import { cardMetricColumnWidths } from '@/lib/campaignCardMetricWidths';");
    expect(s).toContain('const widths = cardMetricColumnWidths(CARD_METRIC_LABEL, rows.map(cardMetricReadings));');
    expect(s).toContain('for (const mode of CARD_METRIC_MODES) style[`--cm-w-${mode}`] = `${widths[mode]}px`;');
    expect(s).toContain('const cardMetricWidths = useMemo(() => cardMetricWidthStyle(displayRows), [displayRows]);');
    expect(s).not.toContain('cardMetricWidthStyle(sortedRows)');
    expect(s).toMatch(/<div data-testid="campaign-card-list" style=\{cardMetricWidths\}>\s*\{sortedRows\.map\(row => \(\s*<CampaignCard/);
    // 卡片上显示的字就是估算用的那一份：每格的 dt 读 CARD_METRIC_LABEL，数值读 cardMetricReadings
    const strip = stripSource(s);
    expect(s).toContain('const readings = cardMetricReadings(row);');
    for (const mode of METRIC_MODES) {
      expect(strip, mode).toContain(`<dt className={metricName('${mode}')}>{CARD_METRIC_LABEL.${mode}}</dt>`);
    }
    expect(strip).toContain('{mirrorTpStatus}');
    expect(s).toContain('const mirrorTpStatus = readings.mirrorTp;');
    for (const mode of METRIC_MODES.filter(mode => mode !== 'mirrorTp')) {
      expect(strip, mode).toContain(`{readings.${mode}}`);
    }
    // 外框内边距 + 每项 10px = 标题行 px-4 / sm:px-5；每项左右内边距之和 20px 与估算里的 CARD_METRIC_CELL_PADDING_X 一致
    expect(s).toContain("const CARD_METRIC_STRIP_INSET = 'px-1.5 py-1 sm:px-2.5';");
    expect(s).toContain("const CAMPAIGN_COLUMNS_INSET = 'px-4 sm:px-5';");
    expect(s).toMatch(/const CARD_METRIC_CELL = '[^']*\bpx-2\.5\b[^']*'/);
    const widthsModule = readFileSync(join(process.cwd(), 'src/lib/campaignCardMetricWidths.ts'), 'utf8');
    expect(widthsModule).toContain('export const CARD_METRIC_CELL_PADDING_X = 20;');
    expect(widthsModule).toContain('export const CARD_METRIC_VALUE_FONT_PX = 11;');
    expect(widthsModule).toContain('export const CARD_METRIC_LABEL_FONT_PX = 10;');
    // 估算用的字号与封面上的字号一致：数值 11px 等宽、指标名 10px
    expect(s).toMatch(/const CARD_METRIC_VALUE = '[^']*\bfont-mono text-\[11px\] font-medium\b[^']*'/);
    expect(s).toMatch(/const CARD_METRIC_NAME = '[^']*\btext-\[10px\][^']*'/);
  });

  it('【用户要求】盈亏比只写倍数 b；「仓位击穿」在标题行、紧跟杠杆标签，几何期望格里不再有徽标', () => {
    const s = src();
    const strip = stripSource(s);
    expect(s).toContain("captureRate: profitCaptureRatio == null ? '—' : formatCampaignPayoffRatio(profitCaptureRatio),");
    // 红绿按读数上的 b（两位小数取整后）定：读作「0.00」的用中性色
    expect(s).toContain("const payoffRatioTone = signTone(campaignPayoffRatioMultiple(profitCaptureRatio), 'text-foreground/85');");
    // 几何期望格里不再渲染徽标（悬停说明里提到标题行的「仓位击穿」可以）
    expect(strip).not.toMatch(/>\s*仓位击穿\s*</);
    // 几何期望格保留 data-ruinous-sizing 与原来的说明
    expect(strip).toContain("data-ruinous-sizing={ruinousSizing ? 'true' : undefined}");
    // 标题行：杠杆标签 → 仓位击穿 → 战役编号
    const leverage = s.indexOf('data-testid="campaign-leverage"');
    const ruin = s.indexOf('data-testid="campaign-ruinous-sizing"');
    const code = s.indexOf('title={`战役编号 ${campaignDisplayCode}`}');
    expect(leverage).toBeGreaterThan(-1);
    expect(ruin).toBeGreaterThan(leverage);
    expect(code).toBeGreaterThan(ruin);
    const chip = s.slice(ruin, s.indexOf('</span>', ruin));
    // 与标题行其它小标签同高同圆角（CARD_CHIP）、红色
    expect(chip).toContain('className={`${CARD_CHIP} bg-[#F6465D]/15 text-[10px] font-medium ${TONE_DOWN}`}');
    // 悬停说明的算式分子分母都代入（最大预期亏损 L ÷ 账户总资产），几何期望格的说明读同一份算式
    expect(chip).toContain('title={`仓位击穿：本场下注比例 = ${riskFractionFormula} ≥ 100%，`');
    expect(s).toContain('const riskFractionFormula = `最大预期亏损 ÷ 账户总资产 = ${row.initialExpectedMaxLoss.toFixed(2)} ÷ ${riskAccountEquity?.toFixed(2) ?? \'—\'}`');
    expect(strip).toContain('? `。另：本场真实下注比例 = ${riskFractionFormula} ≥ 100%，`');
    expect(chip).toContain('这一注押上了全部本金');
    expect(chip).toContain('不进几何期望公式');
    expect(s).toContain("const CARD_CHIP = 'inline-flex h-[18px] items-center rounded-[3px] px-1.5 leading-none';");
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
    // 【用户要求】多级排序：排序链上每一级对应的模块都亮，第一级用上面那一套，之后各级轻一档的同色系（同样只换底色与描边）
    expect(s).toContain('sortHighlight={sortHighlight}');
    expect(s).toContain('const sortHighlight = useMemo(() => sortChain.map(level => level.mode), [sortChain]);');
    const thenBox = /const SORT_THEN_HIGHLIGHT_BOX = '([^']+)'/.exec(s)?.[1] ?? '';
    expect(thenBox).toContain('ring-1');
    expect(thenBox).toMatch(/bg-\[#F0B90B\]/);
    expect(thenBox).not.toMatch(/(^|\s)(dark:)?(p[xytblr]?|m[xytblr]?|w|h|border)-/);
    expect(s).toContain("byLevel(mode, SORT_HIGHLIGHT_BOX, SORT_THEN_HIGHLIGHT_BOX, '')");
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
