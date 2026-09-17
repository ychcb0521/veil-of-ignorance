import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 源码守卫：反事实结果那一行的右栏必须与上方「盈亏概览」一样宽。
 * 上方右栏 = (W − gap) / 2；反事实行在「反事实战役」卡片里，内容宽少了卡片两侧的内边距 + 边框，
 * 所以右栏写成 calc(50% + k)，k = (两侧内缩 − 上方 gap) / 2。三处任何一处改了数，这里都要跟着失败。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

const TW_PX = 4;

describe('反事实盈亏概览与上方盈亏概览同宽（源码守卫）', () => {
  const page = read('pages/JournalCampaignDetailPage.tsx');
  const row = read('components/journal/CounterfactualOverviewRow.tsx');

  it('右栏宽度公式 = 50% + (卡片两侧内缩 − 上方 gap) / 2', () => {
    // 上方：战役元数据 | 盈亏概览
    const originalAt = page.indexOf('<div className="font-medium">战役元数据</div>');
    expect(originalAt).toBeGreaterThan(-1);
    const originalOpen = page.lastIndexOf('<section className="', originalAt);
    const originalClass = page.slice(originalOpen, page.indexOf('">', originalOpen));
    expect(originalClass).toContain('grid grid-cols-1 md:grid-cols-2');
    const outerGap = Number(/\bgap-(\d+)\b/.exec(originalClass)?.[1]) * TW_PX;
    expect(page.slice(originalAt, page.indexOf('</section>', originalAt))).toContain('title="盈亏概览"');

    // 反事实战役卡片：整张卡片只有均匀的 p-N 与 1px 边框
    const cfTitleAt = page.indexOf('              反事实战役\n');
    expect(cfTitleAt).toBeGreaterThan(-1);
    const cfOpen = page.lastIndexOf('<section className="', cfTitleAt);
    const cfClass = page.slice(cfOpen, page.indexOf('">', cfOpen));
    expect(cfClass.split(/[\s"]+/)).toContain('border');
    expect(cfClass).not.toMatch(/\b(px|pl|pr)-\d|\bborder-(\d|x|l|r)/);
    const cfPadding = Number(/\bp-(\d+)\b/.exec(cfClass)?.[1]) * TW_PX;
    const inset = 2 * (cfPadding + 1);

    // 两处反事实结果都在这张卡片里，用同一个组件
    const cfBody = page.slice(cfOpen, page.indexOf('\n        </section>', cfOpen));
    expect(cfBody.match(/<CounterfactualOverviewRow\b/g)).toHaveLength(2);
    expect(page).not.toMatch(/testId="counterfactual-(draft|saved)-panel"/);

    const k = (inset - outerGap) / 2;
    expect(k).toBe(17);
    expect(row).toContain(`md:grid-cols-[minmax(0,1fr)_calc(50%_+_${k}px)]`);
    expect(row).toMatch(/COUNTERFACTUAL_OVERVIEW_ROW_GRID_CLASS =\s*'grid grid-cols-1 gap-4 md:grid-cols-\[minmax\(0,1fr\)_calc\(50%_\+_17px\)\]'/);
    expect(row).toContain('className={COUNTERFACTUAL_OVERVIEW_ROW_GRID_CLASS}');
  });

  it('右栏不被左栏拉高，面板只拿标题 / 12 项 / 脚注', () => {
    expect(row).toContain('<div className="min-w-0 md:self-start">');
    const panelAt = row.indexOf('<CampaignPnlOverviewPanel');
    const panelProps = row.slice(panelAt, row.indexOf('/>', panelAt));
    expect(panelProps.match(/\b(\w+)=/g)).toEqual(['testId=', 'title=', 'items=', 'note=']);
  });
});
