import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 指南里「交易战役：批量下载图片」一节是用户照着操作的说明书：入口位置、配色、分包阈值、超时、
 * 无 K 线战役的处理与 ZIP 命名都要与实现对得上，改了实现就得跟着改这一节。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('指南：批量下载图片', () => {
  const guide = read('pages/GuidePage.tsx');
  const at = guide.indexOf('<SubTitle>交易战役：批量下载图片</SubTitle>');
  const section = guide.slice(at, guide.indexOf('<SubTitle>', at + 10));
  const dialog = read('components/journal/CampaignBatchExportDialog.tsx');
  const page = read('pages/JournalCampaignsPage.tsx');
  const detail = read('pages/JournalCampaignDetailPage.tsx');
  const selection = read('lib/campaignBatchSelection.ts');

  it('【用户要求】盘面视窗倍数可选、默认 1.1 倍，与详情页倍数按钮同一组', () => {
    expect(section).toContain('<strong>盘面视窗</strong>可选 1.1x、2.1x、3.1x、5x、11x、21x、31x、41x、51x');
    expect(section).toContain('<strong>默认 1.1 倍</strong>');
    expect(section).not.toContain('盘面取完整战役及前后上下文');
    expect(section).not.toContain('三倍视窗');
    expect(dialog).toContain('CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS.map');
    // 旧档 2 / 3 读成 2.1 / 3.1
    expect(detail).toContain('normalizeCampaignViewMultiplier(batchExport.options.viewMultiplier) ?? BATCH_EXPORT_DEFAULT_VIEW_MULTIPLIER');
  });

  it('这一节存在，入口写的是排序行最右端的「批量下载」', () => {
    expect(at).toBeGreaterThan(-1);
    expect(section).toContain('「排序方式」一行最右端');
    expect(page).toContain("{selectionMode ? '退出选择' : '批量下载'}");
    expect(page).toContain('ml-auto inline-flex h-7 shrink-0');
  });

  it('选择的配色与说明一致：卡片琥珀描边，散点蓝色外圈（琥珀留给破产风险）', () => {
    expect(section).toContain('琥珀色边');
    expect(section).toContain('蓝色外圈');
    expect(page).toContain("'border-[#F0B90B]/60 bg-card bg-[linear-gradient(rgba(240,185,11,0.05),rgba(240,185,11,0.05))]");
    expect(read('components/charts/ScatterPlot.tsx')).toContain("stroke: seriesTokenVar('info')");
  });

  it('选择条滚出视野时底部浮出精简条', () => {
    expect(section).toContain('屏幕底部会浮出一条「已选 N 场 · 退出选择 · 下载选中」');
    expect(page).toContain('data-testid="campaign-batch-dock"');
  });

  it('Esc 退出、全部下载后自动退出选择模式', () => {
    expect(section).toContain('Esc');
    expect(section).toContain('自动退回普通浏览');
    expect(page).toContain("event.key !== 'Escape'");
    expect(page).toContain('if (allDownloaded) setSelectionMode(false)');
  });

  it('分包阈值、单场超时与 ZIP 命名与实现相同', () => {
    expect(dialog).toContain('const MAX_READY_BYTES = 256 * 1024 * 1024;');
    expect(section).toContain('256 MB');
    expect(dialog).toContain('const CAMPAIGN_TIMEOUT_MS = 150_000;');
    expect(section).toContain('150 秒');
    expect(selection).toContain('`交易战役_${stamp}${split ? `_第${part}包` : \'\'}_${count}张.zip`');
    expect(section).toContain('交易战役_日期-时间_N张.zip');
    expect(section).toContain('第 N 包');
  });

  it('选择的去留规则写明：排序保留、时间段移除范围外、换账号清空', () => {
    expect(section).toContain('切换排序、切换散点图或视图都保留');
    expect(section).toContain('只移除范围外的那几场');
    expect(section).toContain('换登录账号时清空并退出选择模式');
    expect(page).toContain('setSelectionMode(false); setSelectedCampaignIds(new Set()); setExportTargets(null);');
    expect(page).toContain('retainCampaignSelection(current, new Set(scopedRows.map(row => row.campaign.id)))');
  });

  it('请求失败才算失败；本机缺成交记录照常出图；离开本页的时间不计入超时', () => {
    expect(section).toContain('本机查不到成交记录');
    expect(detail).toContain('!result.complete && result.fetchFailed !== false');
    expect(section).toContain('离开的时间不计入 150 秒');
    expect(dialog).toContain("document.addEventListener('visibilitychange', onVisibilityChange)");
  });

  it('指定周期是下限，按盘面可见根数放宽，并写明上限', () => {
    expect(section).toContain('指定周期是下限');
    expect(section).toContain('超过 1000 根');
    expect(read('lib/campaignChartContentSpan.ts')).toContain('export const BATCH_EXPORT_VISIBLE_CANDLE_LIMIT = 1_000;');
    expect(detail).toContain('pickBatchExportInterval(batchInterval');
    expect(dialog).toContain('场盘面放不下，已放宽周期');
  });

  it('账户样本缺场不拖垮整批：按其余场次汇总并在图里注明', () => {
    expect(section).toContain('重读一次仍失败');
    expect(section).toContain('「盈亏概览」下注明缺了哪几场');
    expect(detail).toContain('账户战役样本一场都没读出来');
    expect(detail).toContain('...(batchOverviewNote ? { note: batchOverviewNote } : {})');
    expect(detail).toContain('const sampleNote = overviewSelected ? batchSampleNote : undefined;');
  });

  it('Esc 在刚勾完的勾选框上也能退出', () => {
    expect(section).toContain('刚勾完勾选框');
    expect(page).toContain('input:not([type="checkbox"]):not([type="radio"])');
  });

  it('分包后每次下载只装新图、包号顺延；窄屏选择条不吸顶；盘面固定浅色；焦点回到打开弹窗的按钮', () => {
    expect(section).toContain('只装还没下载过的图片、包号顺延');
    expect(dialog).toContain("const split = mode === 'part' || run.packed.size > 0;");
    expect(section).toContain('窄屏上选择条不吸顶');
    expect(page).toContain('selectionMode && narrowViewport && renderBatchSelectionBar(true)');
    expect(section).toContain('固定按浅色主题画');
    expect(detail).toContain('<ThemeOverride theme="light">');
    expect(section).toContain('键盘焦点回到打开它的「下载选中」');
    expect(dialog).toContain('onCloseAutoFocus');
    expect(section).toContain('不写 K 线周期');
    expect(read('lib/campaignLegsPngExport.ts')).toContain('function boardUsesChartInterval');
  });

  it('选择条被盖住一点浮条就接手；退出选择后焦点不掉；周期不起作用时停用；日记只读；重试补回的那场单独重取样本', () => {
    expect(section).toContain('哪怕只被吸顶区盖住一点');
    expect(page).toContain('entry.isIntersecting && entry.intersectionRatio >= 0.99');
    expect(section).toContain('退出后键盘焦点回到「批量下载」');
    expect(page).toContain('onClick={exitSelectionMode}');
    expect(section).toContain('这一组调暗停用');
    expect(dialog).toContain('boardUsesChartInterval(sections)');
    expect(section).toContain('情绪日记一批只读一次');
    expect(detail).toContain('listDecisionEmotionDiaries(userId, { mirror: false })');
    expect(section).toContain('单独重取一次样本');
    expect(detail).toContain('result.missingSampleIds?.includes(batchExport.campaignId)');
  });

  it('交易所没有 K 线的战役照常出图、写明原因，而不是记为失败', () => {
    expect(section).toContain('不算失败');
    expect(section).toContain('无 K 线');
    expect(detail).toContain('交易所没有这段时间的');
    // 只画盈亏概览、没画盘面时，峰值浮盈兜底写在盈亏概览下，队列同样标「无 K 线」；
    // 盘面读显示用 K 线、概览读计算用 K 线，两份各判各的「没有」
    expect(section).toContain('这句写在「盈亏概览」下面');
    expect(detail).toContain('const peakFallback = computeKlinesAbsent && !chartKlinesAbsent');
    expect(dialog).toContain('峰值浮盈按已实现盈亏兜底');
  });

  it('「自动」周期的说明写明不计入详情页里已保存的反事实分支（批量盘面只画战役本身）', () => {
    expect(dialog).toContain('详情页里已保存的反事实分支撑宽的视窗不计入');
    expect(section).toContain('不计入分支');
    expect(detail).not.toContain('该战役时间段暂无 K 线数据，无法保证完整导出');
  });

  it('【用户已定】周期只管盘面：盈亏概览按与详情页同一份自动周期的 K 线算，没画盘面时周期停用', () => {
    expect(section).toContain('<strong>周期只管盘面</strong>');
    expect(section).toContain('读数与详情页逐位一致');
    // 例外写明：详情页选中的反事实分支越出 Legs 跨度时会撑宽详情页算读数的那份 K 线，批量不读分支
    expect(section).toContain('详情页选中的反事实分支越出 Legs 的时间跨度时除外');
    expect(section).toContain('在详情页取消选中该分支后两边一致');
    expect(section).toContain('没画 K 线盘面时周期不起作用');
    // 放宽既可能是视窗放不下，也可能是 51 倍拉取超过 6000 根：两种原因都要说到
    expect(section).toContain('默认 5 分钟线，某场的视窗或拉取量放不下时自动放宽');
    expect(dialog).toContain("hint: '默认 5 分钟线，视窗或拉取量放不下时自动放宽");
    expect(section).not.toContain('某场的盘面放不下时自动放宽');
    expect(read('lib/campaignLegsPngExport.ts')).toContain('return sections?.chart !== false;');
    expect(dialog).toContain('未画 K 线盘面，不用周期');
    // 批量里盈亏概览读计算用 K 线，只在画概览时才拉
    expect(detail).toContain("const computeKlinesNeeded = !batchExport || batchExport.options.sections.overview !== false;");
  });
});
