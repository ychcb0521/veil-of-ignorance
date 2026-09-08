import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHART_PALETTE_HEX,
  MARK_R,
  MARK_RING_W,
  MARK_FOOTPRINT,
  MIN_PITCH,
  PLOT_INSET,
} from '@/lib/chartTokens';

const ROOT = path.resolve(__dirname, '../../..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

describe('图表令牌契约', () => {
  it('锁定已通过 validate_palette.js 的色值，改一个就必须重新跑验证器', () => {
    expect(CHART_PALETTE_HEX.light).toEqual({
      surface: '#FCFDFE',
      profit: '#00875A',
      loss: '#DE350B',
      neutral: '#87919F',
      info: '#2B7FFF',
      importance: '#D99A00',
    });
    expect(CHART_PALETTE_HEX.dark).toEqual({
      surface: '#161A1E',
      profit: '#1FA97A',
      loss: '#EF5B3C',
      neutral: '#626C79',
      info: '#2B7FFF',
      importance: '#C98500',
    });
  });

  it('几何常量固定：8px 实心、2px 可见表面环、14px 步距', () => {
    expect(MARK_R).toBe(4);
    expect(MARK_R * 2).toBe(8);
    // SVG 描边以路径为中心线，线宽 4 → 画在实心之外的可见环恰好 2px。
    expect(MARK_RING_W / 2).toBe(2);
    expect(MARK_FOOTPRINT).toBe(12);
    // 12px 占地 + 2px 表面间隙 = 同 y 相邻两点的最小中心距。
    expect(MIN_PITCH).toBe(14);
    expect(PLOT_INSET.top).toBe(12);
    expect(PLOT_INSET.bottom).toBe(28);
  });

  it('index.css 里深浅两套 --chart-* 变量与锁定值一致', () => {
    const css = read('src/index.css');
    for (const [key, hex] of Object.entries(CHART_PALETTE_HEX.dark)) {
      expect(css).toContain(`--chart-${key}: ${hex};`);
    }
    for (const [key, hex] of Object.entries(CHART_PALETTE_HEX.light)) {
      expect(css).toContain(`--chart-${key}: ${hex};`);
    }
    // 阈值线与重要性同色但互斥使用，两个主题都要有。
    expect(css).toContain('--chart-threshold: #D99A00;');
    expect(css).toContain('--chart-threshold: #C98500;');
  });
});

describe('图表代码里不再出现裸十六进制', () => {
  const files = [
    'src/components/charts/ScatterPlot.tsx',
    'src/components/journal/CampaignOddsScatterPlot.tsx',
    'src/components/journal/JournalStatsSidebar.tsx',
  ];

  for (const file of files) {
    it(`${file} 只走 --chart-* 令牌`, () => {
      expect(read(file)).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    });
  }

  it('PatternClusterCard 的两张迷你图只走令牌（同文件的表格文字属页面外观，不在范围内）', () => {
    const source = read('src/components/journal/PatternClusterCard.tsx');
    const block = source.slice(source.indexOf('<MiniChart title="时段分布">'), source.indexOf('<MiniChart title="标的Top5">'));
    expect(block.length).toBeGreaterThan(400);
    expect(block).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it('战役指标图例的九组配色全部是令牌名而不是色值', () => {
    const source = read('src/pages/JournalCampaignsPage.tsx');
    const block = source.slice(
      source.indexOf('const CAMPAIGN_METRIC_CHART_CONFIGS'),
      source.indexOf('const SORT_FORMULA_BY_MODE'),
    );
    expect(block.length).toBeGreaterThan(1000);
    expect(block).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(block).toMatch(/token: '(profit|loss|neutral|info|importance)'/);
  });
});
