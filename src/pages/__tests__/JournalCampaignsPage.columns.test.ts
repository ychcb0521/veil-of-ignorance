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

/** 【用户要求】封面十八项的次序（2026-10-15）：几何增长紧跟盈亏比；单位涨幅 / 单位利润 / 仓位利润接在算术期望后；几何期望接在涨幅未兑现后。 */
const CARD_MODES = ["expectedDrawdownPct","effectivePriceChangePct","addCount","positionGeometricMultiple","magicB","captureRate","executionWear","geometricExpectancy","positionAmplification","addEfficiency","arithmeticExpectancy","unitRise","unitProfit","positionProfit","mainPriceChange","mainPriceEfficiency","unrealizedPriceChangePct","mirrorTp"];
const METRIC_MODES = ["addCount","positionGeometricMultiple","effectivePriceChangeMultiple","magicB","geometricExpectancy","mirrorTp","expectedDrawdownPct","mainPriceChange","mainPriceEfficiency","effectivePriceChangePct","addEfficiency","positionAmplification","unrealizedPriceChangePct","arithmeticExpectancy"];

function constBlock(s: string, name: string): string {
  return new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\}`).exec(s)?.[1] ?? '';
}

function stripSource(s: string): string {
  const start = s.indexOf('data-testid="campaign-card-metrics"');
  const end = s.indexOf('{detailsExpanded && (', start);
  return s.slice(start, end);
}

describe('封面指标行左对齐、按读数定宽；排序行左对齐', () => {
  it('首仓指标在排序、封面及散点图中统一改名，逐腿涨跌幅不改名', () => {
    const s = src();
    for (const [mode, label] of [['mainPriceChange', '首仓涨跌幅'], ['mainPriceEfficiency', '首仓涨跌幅倍数']]) {
      expect(s).toContain(`{ value: '${mode}', label: '${label}' }`);
      expect(s).toContain(`${mode}: '${label}'`);
      expect(s).toContain(`chartLabel: '${label}图'`);
      expect(s).toContain(`seriesLabel: '${label}时序'`);
      expect(s).toContain(`label: '${label}分布'`);
    }
    expect(s).toContain('Legs 表「涨跌幅」列');
    expect(s).not.toContain("label: '涨跌幅'");
    expect(s).not.toContain("label: '涨跌幅倍数'");
    expect(readFileSync(join(process.cwd(), 'src/components/journal/CampaignLegsList.tsx'), 'utf8'))
      .toContain('title={PRICE_CHANGE_COLUMN_HINT}>涨跌幅</div>');
  });

  it('【用户要求】封面指标分成两排、靠左、每列按内容取宽：手机两列、640px 起每排六格、1280px 起每排九格（十八项正好两排）', () => {
    const s = src();
    expect(s).toContain("const CARD_METRIC_STRIP = 'grid grid-cols-2 gap-1 sm:[grid-template-columns:var(--cm-cols-6,repeat(6,max-content))] sm:gap-x-1 sm:gap-y-1 sm:pr-6 xl:[grid-template-columns:var(--cm-cols-9,repeat(9,max-content))]';");
    expect(s).toMatch(/data-testid="campaign-card-metrics"\s+className=\{CARD_METRIC_STRIP\}/);
    expect(s).not.toContain('xl:flex-nowrap');
    // 封面适当增高：格子上下内边距 py-2
    expect(s).toContain("const CARD_METRIC_CELL = 'flex min-w-0 flex-col gap-1 rounded-md px-2.5 py-2 sm:px-2 transition-[background-color,box-shadow] duration-150';");
  });

  it('排序行：左对齐 flex 换行，两条分隔线在「预期回撤」与「杠杆倍数」之前；行首与封面左缘对齐', () => {
    const s = src();
    expect(s).toContain("new Set<CampaignSortMode>(['expectedDrawdownPct', 'leverage'])");
    expect(s).toMatch(/data-testid="campaign-sort-controls"\s+className=\{`order-2 flex min-h-10 flex-wrap items-center gap-x-0\.5 gap-y-0\.5[^`]*\$\{CAMPAIGN_COLUMNS_FRAME\} \$\{CAMPAIGN_COLUMNS_INSET\}`\}/);
    expect(s).toContain("const CAMPAIGN_COLUMNS_FRAME = 'border-x border-transparent';");
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(s)?.[1] ?? '';
    const order = [...block.matchAll(/value: '([A-Za-z]+)'/g)].map(match => match[1]);
    // 【用户要求】操作时间、镜像止盈 ┆ 预期回撤 … 算术期望 ┆ 杠杆倍数 … 字母（「DSI 贡献」「USI 贡献」已删）
    expect(order).toEqual(["addCount","positionGeometricMultiple","effectivePriceChangeMultiple","magicB","geometricExpectancy","time","mirrorTp","expectedDrawdownPct","mainPriceChange","mainPriceEfficiency","effectivePriceChangePct","addEfficiency","positionAmplification","unrealizedPriceChangePct","arithmeticExpectancy","leverage","importance","alpha"]);
  });

  it('封面指标项与排序行同序，每项按它对应的排序项取宽度与高亮', () => {
    const s = src();
    const start = s.indexOf('data-testid="campaign-card-metrics"');
    const end = s.indexOf('{detailsExpanded && (', start);
    const strip = s.slice(start, end);
    const cells = [...strip.matchAll(/metricCell\('(\w+)'\)\}[\s\S]{0,40}?data-testid="(campaign-[a-z-]+)"|data-testid="(campaign-[a-z-]+)"\s+[^>]*?className=\{metricCell\('(\w+)'\)\}/g)]
      .map(match => [match[1] ?? match[4], match[2] ?? match[3]]);
    expect(cells).toEqual([["addCount","campaign-add-count"],["positionGeometricMultiple","campaign-position-geometric-multiple"],["effectivePriceChangeMultiple","campaign-effective-price-change-multiple"],["magicB","campaign-magic-b"],["geometricExpectancy","campaign-geometric-expectancy"],["mirrorTp","campaign-mirror-tp-status"],["expectedDrawdownPct","campaign-expected-drawdown-pct"],["mainPriceChange","campaign-main-price-change"],["mainPriceEfficiency","campaign-main-price-efficiency"],["effectivePriceChangePct","campaign-effective-price-change"],["addEfficiency","campaign-add-efficiency"],["positionAmplification","campaign-position-amplification"],["unrealizedPriceChangePct","campaign-unrealized-price-change"],["arithmeticExpectancy","campaign-arithmetic-expectancy"]]);
    // 排序行里这八项的先后与封面一致
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(s)?.[1] ?? '';
    const order = [...block.matchAll(/value: '([A-Za-z]+)'/g)].map(match => match[1]);
    expect(order.filter(mode => cells.some(([cellMode]) => cellMode === mode))).toEqual(cells.map(([mode]) => mode));
  });

  it('【用户要求】数值字号一致：不再按读数估宽、不再按格宽缩字号；十八项次序与排序行一致', () => {
    const s = src();
    for (const gone of ['fitMetricValue', 'cardMetricColumnWidths', 'cardMetricWidthStyle', '--cm-w-', 'CARD_METRIC_WIDTH_CLASS', 'CARD_METRIC_UNIFORM_WIDTH']) {
      expect(s, gone).not.toContain(gone);
    }
    expect(s).toContain("const CARD_METRIC_VALUE = 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] font-medium leading-4 tabular-nums';");
    expect(s).toContain('const metricCell = (mode: CardMetricMode) => `${CARD_METRIC_CELL} ${byLevel(mode, SORT_HIGHLIGHT_BOX, SORT_THEN_HIGHLIGHT_BOX, \'\')}`;');
    expect(s).toContain('<div data-testid="campaign-card-list" style={cardMetricGridStyle}>');
    const labels = [...constBlock(s, 'CARD_METRIC_LABEL').matchAll(/(\w+): '([^']+)'/g)].map(match => match[1]);
    expect(labels).toEqual(CARD_MODES);
    const strip = stripSource(s);
    for (const mode of CARD_MODES) {
      expect(strip, mode).toContain(`<dt className={metricName('${mode}')}>{CARD_METRIC_LABEL.${mode}}</dt>`);
    }
    // 卡片上的格子与 CARD_METRIC_LABEL 同序
    const cellOrder = [...strip.matchAll(/<dt className=\{metricName\('(\w+)'\)\}>/g)].map(match => match[1]);
    expect(cellOrder).toEqual(CARD_MODES);
  });

  it('【用户要求】盈亏比只写倍数 b；「仓位击穿」在标题行、紧跟杠杆标签，几何期望格里不再有徽标', () => {
    const s = src();
    const strip = stripSource(s);
    expect(s).toContain("magicB: rowMagicB(row) == null ? '—' : formatCampaignPayoffRatio(rowMagicB(row)! * 100)");
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
