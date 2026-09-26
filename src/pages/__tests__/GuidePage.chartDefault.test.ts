import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 指南里「交易战役」的盘面说明是用户照着读的：默认 2.1 倍、5 分钟线、倍数档、
 * 以及「周期只管盘面、读数不跟着变」都要与实现对得上，改了实现就得跟着改指南。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('指南：交易战役原始盘面默认 5 分钟线、2.1 倍', () => {
  const guide = read('pages/GuidePage.tsx');
  const hook = read('hooks/useCampaignKlines.ts');
  const span = read('lib/campaignChartContentSpan.ts');
  const detail = read('pages/JournalCampaignDetailPage.tsx');

  it('【用户要求】默认 2.1 倍、5 分钟线，倍数档 1.1 / 2.1 / 3.1 / 5 … 51', () => {
    expect(guide).toContain('<strong>K 线盘面默认 2.1 倍视窗、5 分钟线</strong>');
    expect(guide).toContain('<strong>1.1、2.1、3.1、5、11、21、31、41、51 倍</strong>');
    expect(guide).not.toContain('K 线默认按三段式窗口自适应');
    expect(guide).not.toContain('1.1、2、3、5、11');
    expect(hook).toContain('export const CAMPAIGN_VIEW_MULTIPLIERS = [2.1, 3.1, 5, 11, 21, 31, 41, 51] as const;');
    expect(hook).toContain('export const CAMPAIGN_DEFAULT_VIEW_MULTIPLIER: CampaignViewMultiplier = 2.1;');
    expect(detail).toContain(': CAMPAIGN_DEFAULT_VIEW_MULTIPLIER;');
  });

  it('默认 5 分钟线，放不下时自动放宽：写明可读下限与拉取预算', () => {
    expect(guide).toContain('<strong>周期默认 5 分钟线，放不下时自动放宽</strong>');
    expect(guide).toContain('超过约 1200 根');
    expect(guide).toContain('51 倍拉取超过 6000 根');
    expect(span).toContain("export const CAMPAIGN_DEFAULT_DISPLAY_INTERVAL: CampaignChartInterval = '5m';");
    expect(span).toContain('export const CAMPAIGN_VISIBLE_CANDLE_LIMIT = 1_200;');
    expect(span).toContain('export const CAMPAIGN_FETCH_CANDLE_BUDGET = 6_000;');
    // 工具栏悬停提示
    expect(detail).toContain("const DISPLAY_INTERVAL_HINT = '默认 5 分钟线，放不下时自动放宽。");
  });

  it('【用户已定】周期只管盘面，峰值浮盈、盈亏概览、反事实不随盘面周期变', () => {
    expect(guide).toContain('<strong>周期只管盘面，读数不跟着变</strong>');
    expect(guide).toContain('盘面周期与这份计算周期相同时只拉一份 K 线、两边共用');
    expect(guide).toContain('不随盘面周期、倍数或时间预设变');
    expect(guide).not.toContain('按主图当前的 K 线周期把调整后的 Legs 跑一遍');
    expect(detail).toContain('pickCampaignComputeInterval({ startMs: campaignKlineBaseWindow.fromTime, endMs: campaignKlineBaseWindow.toTime })');
    expect(detail).not.toContain('当前是绝对时间范围预设，请先切回倍率视图再运行 What-if');
  });

  it('反事实盘面按自己的视窗选周期，不随原始盘面的倍数变；手动周期两块盘面共用', () => {
    expect(guide).toContain('<strong>反事实盘面的周期按它自己的视窗选</strong>');
    expect(guide).toContain('原始盘面切到 51 倍不会把它也放宽');
    expect(guide).toContain('手动点过的周期两块盘面共用');
    expect(detail).toContain('buildCampaignKlineVisibleRange(campaignKlineBaseWindow, counterfactualViewMultiplier)');
    // 共用的条件写全：原始盘面在绝对预设下拉的是撑开后的窗口，同周期也不共用（key 里带窗口）
    expect(guide).toContain('与计算用那一份，或与倍率视图下的原始盘面那一份同周期时直接共用，不另拉（原始盘面在「1天 / 1周 / 1月」预设下拉的是更宽的窗口，不共用）');
    expect(guide).not.toContain('与计算用或原始盘面那份 K 线同周期时直接共用，不另拉');
    expect(detail).toContain('key: `${displayInterval}|${campaignKlineTimeWindow.fromTime}|${campaignKlineTimeWindow.toTime}`');
    expect(detail).toContain('key: `${counterfactualDisplayInterval}|${campaignKlineBaseWindow.fromTime}|${campaignKlineBaseWindow.toTime}`');
  });

  it('读数不随盘面变，唯一例外写明：选中的反事实分支越出 Legs 跨度会撑宽计算窗口（改版前就是这样）', () => {
    expect(guide).toContain('唯一的例外是选中的反事实分支越出 Legs 的时间跨度');
    // 计算窗口确实含选中的分支：指南这句例外与实现对得上
    expect(detail).toMatch(/buildCampaignChartContentTimeSpan\(\s*campaign, legs, tradeRecords, \[\.\.\.reverseHedgeOrders, \.\.\.foreignLiveOrders\], selectedCounterfactual,/);
  });

  it('悬停提示分清放宽原因：视窗放不下 5 分钟线 / 整段拉取超过 6000 根', () => {
    expect(detail).toContain('当前视窗放不下 5 分钟线，已自动放宽到');
    expect(detail).toContain('整段拉取范围按 5 分钟线超过 6000 根，已自动放宽到');
  });
});
