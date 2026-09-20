import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 指南「反事实推演」一段写的布局要与战役页一致：右栏面板与上方「盈亏概览」同样大小、同一套排布，
 * 左栏「相对原始的变化情况」放相对实际、逐腿改动、运行信息与操作按钮。
 */
const guide = readFileSync(join(process.cwd(), 'src', 'pages/GuidePage.tsx'), 'utf8');
const row = readFileSync(join(process.cwd(), 'src', 'components/journal/CounterfactualOverviewRow.tsx'), 'utf8');

describe('指南：反事实盈亏概览的分栏', () => {
  it('不再说「标题下另附」，改写成左右两栏', () => {
    expect(guide).not.toContain('标题下另附「相对实际 ±… USDT」与逐腿改动说明');
    const at = guide.indexOf('右栏的面板与上方「盈亏概览」同样大小、内部排布逐项相同');
    expect(at).toBeGreaterThan(-1);
    const clause = guide.slice(at, at + 400);
    expect(clause).toContain('左栏是<strong>「相对原始的变化情况」</strong>');
    expect(clause).toContain('「相对实际 ±… USDT」');
    expect(clause).toContain('逐腿改动说明');
    expect(clause).toContain('运行时刻');
    expect(clause).toContain('「保存」「丢弃」');
    expect(clause).toContain('「载入到 Legs 副本」「删除」');
  });

  it('已保存分支的按钮写在左栏；卡片标题与页面同一个字', () => {
    expect(guide).not.toContain('面板上可以「删除」');
    const savedBranchClause = guide.match(/<li>已保存分支逐行列出[\s\S]*?<\/li>/)?.[0] ?? '';
    expect(savedBranchClause).toContain('左栏「相对原始的变化情况」另写分支类型（推演分支带 SOP 分数）与保存时刻');
    expect(savedBranchClause).toContain('可以在那里「删除」，也可以「载入到 Legs 副本」');
    expect(row).toContain("COUNTERFACTUAL_CHANGES_TITLE = '相对原始的变化情况'");
    // 全篇只用这一种叫法
    expect(guide).not.toMatch(/相对原始的变化(?!情况)/);
  });
});
