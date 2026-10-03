import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 源码守卫：真实战役与反事实结果都保持左右双栏。 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('真实战役与反事实结果双栏（源码守卫）', () => {
  const page = read('pages/JournalCampaignDetailPage.tsx');
  const row = read('components/journal/CounterfactualOverviewRow.tsx');

  it('战役元数据在左、盈亏概览在右；反事实行仍为双栏', () => {
    const originalAt = page.indexOf('<div className="font-medium">战役元数据</div>');
    expect(originalAt).toBeGreaterThan(-1);
    const originalOpen = page.lastIndexOf('<section className="', originalAt);
    const originalClass = page.slice(originalOpen, page.indexOf('">', originalOpen));
    expect(originalClass).toContain('grid-cols-1');
    expect(originalClass).toContain('md:grid-cols-2');
    expect(page.slice(originalAt, page.indexOf('</section>', originalAt))).toContain('title="盈亏概览"');

    // 反事实战役卡片：整张卡片只有均匀的 p-N 与 1px 边框
    const cfTitleAt = page.indexOf('            反事实战役\n');
    expect(cfTitleAt).toBeGreaterThan(-1);
    const cfOpen = page.lastIndexOf('<section className="', cfTitleAt);
    const cfClass = page.slice(cfOpen, page.indexOf('">', cfOpen));
    expect(cfClass.split(/[\s"]+/)).toContain('border');
    expect(cfClass).not.toMatch(/\b(px|pl|pr)-\d|\bborder-(\d|x|l|r)/);
    // 两处反事实结果都在这张卡片里，用同一个组件
    const cfBody = page.slice(cfOpen, page.indexOf('\n        </section>', cfOpen));
    expect(cfBody.match(/<CounterfactualOverviewRow\b/g)).toHaveLength(2);
    expect(page).not.toMatch(/testId="counterfactual-(draft|saved)-panel"/);

    expect(row).toContain('md:grid-cols-[minmax(0,1fr)_calc(50%_+_17px)]');
    expect(row).toMatch(/COUNTERFACTUAL_OVERVIEW_ROW_GRID_CLASS =\s*'grid grid-cols-1 gap-4 md:grid-cols-\[minmax\(0,1fr\)_calc\(50%_\+_17px\)\]'/);
    expect(row).toContain('className={COUNTERFACTUAL_OVERVIEW_ROW_GRID_CLASS}');
  });

  it('右栏不被左栏拉高，面板只拿标题与指标（【用户要求】脚注删掉）', () => {
    expect(row).toContain('<div className="min-w-0 md:self-start">');
    const panelAt = row.indexOf('<CampaignPnlOverviewPanel');
    const panelProps = row.slice(panelAt, row.indexOf('/>', panelAt));
    expect(panelProps.match(/\b(\w+)=/g)).toEqual(['testId=', 'title=', 'items=']);
  });
});
