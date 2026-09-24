import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 指南里「战役列表」几段话要与页面对得上：排序行的新次序与左对齐、封面的等宽统计格与断点、
 * 涨幅 / 涨幅效率 / 加仓效率的公式浮层与散点图。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('指南：战役列表的排序次序、封面统计格与新增散点图', () => {
  const guide = read('pages/GuidePage.tsx');
  const page = read('pages/JournalCampaignsPage.tsx');

  it('排序行的次序与页面 SORT_OPTIONS 一致', () => {
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(page)?.[1] ?? '';
    const labels = [...block.matchAll(/label: '([^']+)'/g)].map(match => match[1]);
    // 【用户要求】操作时间、镜像止盈 ┆ 预期回撤 … 算术期望 ┆ DSI 贡献 … 字母（重要性在杠杆倍数之后、字母之前）
    expect(labels).toEqual([
      '操作时间', '镜像止盈', '预期回撤', '涨幅', '涨幅效率', '盈亏比', '加仓效率', '几何期望',
      '算术期望', 'DSI 贡献', 'USI 贡献', '杠杆倍数', '重要性', '字母',
    ]);
    const at = guide.indexOf('排序行依次是');
    expect(at).toBeGreaterThan(-1);
    const sentence = guide.slice(at, at + 260);
    let cursor = 0;
    for (const label of labels) {
      const next = sentence.indexOf(label, cursor);
      expect(next, `指南里「${label}」的位置`).toBeGreaterThanOrEqual(cursor);
      cursor = next + label.length;
    }
  });

  it('写明排序行左对齐、封面等宽统计格与三档断点，以及新增三项的公式浮层', () => {
    // 【用户要求】「排序方式这里不美观。这里还是用左对齐吧」
    expect(guide).toContain('排序行<strong>左对齐</strong>、按钮依次排开、间距均匀');
    expect(guide).not.toContain('与上方排序行的同名按钮共用同一套列');
    // 【用户要求】「交易战役封面的指标排布要美观，现在太零散了，不整齐」：等宽统计格，顺序与排序行一致
    expect(guide).toContain('<strong>等宽的统计格</strong>');
    expect(guide).toContain('<strong>顺序与排序行一致</strong>：镜像止盈状态、预期回撤、涨幅、涨幅效率、盈亏比、加仓效率、单场几何期望、单场算术期望');
    expect(guide).toContain('<strong>每一格在所有卡片上都落在同一条竖线上</strong>');
    expect(guide).toContain('≥ 1280px 时八格排成一行，≥ 672px（平板）时每行四格、排两行，手机上每行两格');
    // 旧的按读数定宽、窄屏自然换行的说法不再出现
    expect(guide).not.toContain('列宽按真实最长的读数定');
    expect(guide).not.toContain('卡片按原顺序自然换行');
    // 断点与页面常量一致
    expect(page).toContain("const CAMPAIGN_COLUMNS_GRID = 'grid grid-cols-2 min-[672px]:grid-cols-4 xl:grid-cols-8';");
    expect(guide).toContain('重要性放在后面，排在字母之前');
    expect(guide).not.toContain('排序行依次是重要性');
    expect(guide).toContain('涨幅、涨幅效率、加仓效率与其他公式指标一样，<strong>双击或右键</strong>打开公式浮层');
  });

  it('散点图清单与颜色说明包含涨幅、涨幅效率、加仓效率', () => {
    expect(guide).toContain('盈亏比、预期回撤、涨幅、涨幅效率、加仓效率、算术期望、几何期望、重要性、镜像止盈、DSI 贡献、USI 贡献都各自配有一张散点图');
    expect(guide).toContain('本身带盈亏方向的指标（盈亏比、涨幅、涨幅效率、加仓效率、算术期望、几何期望）按数值正负着色');
    expect(guide).toContain('没有加仓、或涨幅效率不为正的战役不进加仓效率图');
    // 页面上确实给三项注册了散点图
    for (const key of ['mainPriceChange', 'mainPriceEfficiency', 'addEfficiency']) {
      expect(page).toContain(`key: '${key}',`);
      expect(page).toMatch(new RegExp(`${key}: '${key}Sort'`));
      expect(page).toMatch(new RegExp(`${key}: '${key}',`));
    }
  });
  it('【用户要求】涨幅、涨幅效率、加仓效率、算术期望默认看分布，可切回时序；加仓效率另有 1.00 参照线', () => {
    expect(guide).toContain('<strong>盈亏比、涨幅、涨幅效率、加仓效率、算术期望与几何期望默认展开的是分布图、镜像止盈默认展开的是柱状图</strong>');
    expect(guide).toContain('<strong>涨幅、涨幅效率、加仓效率、算术期望默认看分布</strong>');
    expect(guide).toContain('<strong>琥珀色 1.00 虚线</strong>「加仓没有额外放大」');
    expect(guide).toContain('用面板右上角的「时序 | 分布」切回时序');
    for (const source of ['mainPriceChange', 'mainPriceEfficiency', 'addEfficiency', 'arithmeticExpectancy']) {
      expect(page).toContain(`${source}: '${source}Distribution'`);
    }
  });
});
