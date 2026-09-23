import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 指南里「战役列表」几段话要与页面对得上：排序行的新次序、排序行与封面五列对齐、
 * 涨幅 / 涨幅效率 / 加仓效率的公式浮层与散点图。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('指南：战役列表的排序次序、对齐列与新增散点图', () => {
  const guide = read('pages/GuidePage.tsx');
  const page = read('pages/JournalCampaignsPage.tsx');

  it('排序行的次序与页面 SORT_OPTIONS 一致', () => {
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(page)?.[1] ?? '';
    const labels = [...block.matchAll(/label: '([^']+)'/g)].map(match => match[1]);
    // 【用户要求】重要性放在后面：杠杆倍数之后、字母之前
    expect(labels).toEqual([
      '操作时间', '涨幅', '涨幅效率', '盈亏比', '加仓效率', '几何期望',
      '预期回撤', '算术期望', '镜像止盈', 'DSI 贡献', 'USI 贡献', '杠杆倍数', '重要性', '字母',
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

  it('写明五列与卡片对齐、窄屏退回换行，以及新增三项的公式浮层', () => {
    expect(guide).toContain('涨幅、涨幅效率、盈亏比、加仓效率、几何期望五格与上方排序行的同名按钮共用同一套列');
    expect(guide).toContain('1280px');
    expect(guide).toContain('自然换行');
    // 算术期望、镜像止盈也压在同名按钮的竖线上；窄的宽屏上末尾一串在最后一列里换行
    expect(guide).toContain('五格之后的算术期望、镜像止盈也各占一列，同样压在排序行同名按钮的竖线上');
    expect(guide).toContain('会在最后一列里换到第二行，列线照旧对齐');
    expect(guide).toContain('排序行末尾的杠杆倍数、重要性、字母放不下');
    expect(guide).toContain('重要性放在后面，排在字母之前');
    expect(guide).not.toContain('排序行依次是重要性');
    expect(guide).toContain('涨幅、涨幅效率、加仓效率与其他公式指标一样，<strong>双击或右键</strong>打开公式浮层');
  });

  it('散点图清单与颜色说明包含涨幅、涨幅效率、加仓效率', () => {
    expect(guide).toContain('盈亏比、预期回撤、涨幅、涨幅效率、加仓效率、算术期望、几何期望、重要性、镜像止盈、DSI 贡献、USI 贡献都各自配有一张散点图');
    expect(guide).toContain('本身带盈亏方向的指标（盈亏比、涨幅、涨幅效率、加仓效率、算术期望、几何期望）按数值正负着色');
    expect(guide).toContain('没有加仓的战役不进加仓效率图');
    // 页面上确实给三项注册了散点图
    for (const key of ['mainPriceChange', 'mainPriceEfficiency', 'addEfficiency']) {
      expect(page).toContain(`key: '${key}',`);
      expect(page).toMatch(new RegExp(`${key}: '${key}Sort'`));
      expect(page).toMatch(new RegExp(`${key}: '${key}',`));
    }
  });
});
