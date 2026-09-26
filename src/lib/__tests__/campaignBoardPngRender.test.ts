import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportCampaignBoardPng,
  renderCampaignBoardPng,
  type CampaignBoardExportInput,
  type CampaignBoardExportSections,
} from '@/lib/campaignLegsPngExport';
import type { TradeCampaign } from '@/types/journal';

const disabled: CampaignBoardExportSections = {
  metadata: false, overview: false, emotionDiary: false, chart: false, legs: false,
};

function fixture(): CampaignBoardExportInput {
  const chartElement = document.createElement('div');
  const canvas = document.createElement('canvas');
  chartElement.appendChild(canvas);
  const rect = { left: 0, top: 0, width: 512, height: 200, right: 512, bottom: 200 } as DOMRect;
  vi.spyOn(chartElement, 'getBoundingClientRect').mockReturnValue(rect);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(rect);
  return {
    campaign: {
      id: 'board-1', campaign_code: 'C-BOARD-1', symbol: 'BTCUSDT', direction: 'main_long',
      status: 'closed_profit', opened_at: '2026-09-19T01:00:00Z', closed_at: '2026-09-19T03:00:00Z',
      strategy_template: 'main_dual_hedge_mirror_tp',
    } as TradeCampaign,
    legs: [], tradeRecords: [], reverseHedgeOrders: [], chartElement, chartInterval: '15m',
    pnlOverview: { items: [{ key: 'pnl', label: '已实现 P&L', value: '123.45 USDT' }] },
    emotionDiary: {
      date: '2026-09-19', eventText: '完整记录事实。', anxiety: '0/21', depression: '0/21',
      pomsTotal: null, pomsDimensions: null, panasPositive: null, panasNegative: null,
      personalInitiativeTotal: null, personalInitiativeMean: null, legacyValence: null, legacyArousal: null,
    },
    exportedAt: '2026-09-20T12:34:00',
  };
}

type EncodedCanvas = { canvas: HTMLCanvasElement; width: number; height: number; texts: string[] };

describe('renderCampaignBoardPng', () => {
  const encoded: EncodedCanvas[] = [];
  const texts: string[] = [];
  const positions: Array<{ text: string; x: number; y: number; maxWidth?: number }> = [];
  const draws: unknown[][] = [];

  beforeEach(() => {
    encoded.length = 0;
    texts.length = 0;
    positions.length = 0;
    draws.length = 0;
    const context = new Proxy({
      drawImage: (...args: unknown[]) => { draws.push(args); },
      measureText: (text: string) => ({ width: text.length * 7 }),
      fillText: (text: string, x: number, y: number, maxWidth?: number) => {
        texts.push(text);
        positions.push({ text, x, y, maxWidth });
      },
    }, {
      get(target, key) { return key in target ? target[key as keyof typeof target] : vi.fn(); },
    }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback) {
      encoded.push({ canvas: this, width: this.width, height: this.height, texts: [...texts] });
      callback(new Blob(['png-bytes'], { type: 'image/png' }));
    });
  });

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('renders the existing full board without triggering downloads, then releases generated pixel buffers', async () => {
    const input = fixture();
    const source = input.chartElement!.querySelector('canvas')!;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const result = await renderCampaignBoardPng(input);
    expect(result.blob.type).toBe('image/png');
    expect(result.fileName).toMatch(/^BTCUSDT 2026-09-19 profit 编号 .+\.png$/);
    expect(texts).toContain('战役原数据');
    expect(texts).toContain('盈亏概览');
    expect(texts).toContain('操作日情绪日记 · 2026-09-19');
    expect(texts).toContain('K 线盘面（15分钟线 · 当前视图）');
    expect(texts).toContain('Legs 列表（完整展开 0/0 条）');
    expect(texts).toContain('导出时间 2026-09-20 12:34');
    expect(click).not.toHaveBeenCalled();
    expect(encoded[0].width).toBeGreaterThan(2000);
    expect(encoded[0].height).toBeGreaterThan(1000);
    expect(encoded[0].canvas.width).toBe(0);
    expect(encoded[0].canvas.height).toBe(0);
    expect(source.width).toBe(300);
  });

  it.each(['metadata', 'overview', 'emotionDiary', 'legs'] as const)('renders only %s without a chart or unused module gaps', async section => {
    await renderCampaignBoardPng({ ...fixture(), chartElement: undefined, sections: { ...disabled, [section]: true } });
    const header = texts.find(text => text.startsWith('编号 '))!;
    expect(header).not.toContain('K 线盘面');
    expect(header.includes('战役原数据')).toBe(section === 'metadata');
    expect(header.includes('盈亏概览')).toBe(section === 'overview');
    expect(header.includes('操作日情绪日记')).toBe(section === 'emotionDiary');
    expect(header.includes('Legs 列表')).toBe(section === 'legs');
    expect(encoded[0].height).toBeLessThan(1000);
    const firstTitle = positions.find(position => position.text === ({
      metadata: '战役原数据', overview: '盈亏概览', emotionDiary: '操作日情绪日记 · 2026-09-19',
      legs: 'Legs 列表（完整展开 0/0 条）',
    })[section])!;
    expect(firstTitle.y).toBeGreaterThanOrEqual(92);
    expect(firstTitle.y).toBeLessThan(130);
  });

  it('uses full width for the remaining summary and includes only the chosen chart view label', async () => {
    await renderCampaignBoardPng({ ...fixture(), sections: { ...disabled, overview: true, chart: true }, chartViewLabel: '完整战役' });
    const panelTitle = positions.find(position => position.text === '盈亏概览')!;
    expect(panelTitle.x).toBe(56);
    expect(panelTitle.maxWidth).toBeGreaterThan(2000);
    expect(texts).toContain('K 线盘面（15分钟线 · 完整战役）');
    expect(texts.join('\n')).not.toContain('当前视图');
  });

  it('writes the K-line interval only when the board draws the chart', async () => {
    // 只画原数据与 Legs：标题行与「战役原数据」都不写周期
    await renderCampaignBoardPng({ ...fixture(), chartElement: undefined, sections: { ...disabled, metadata: true, legs: true } });
    const header = texts.find(text => text.startsWith('编号 '))!;
    expect(header).not.toContain('周期');
    expect(texts).not.toContain('K 线周期');
    expect(texts).toContain('战役原数据');
    // 【用户已定】计算与显示分开：画了盈亏概览、没画盘面——概览按自动周期的计算用 K 线算，不随盘面周期变，不写
    texts.length = 0;
    await renderCampaignBoardPng({ ...fixture(), chartElement: undefined, sections: { ...disabled, metadata: true, overview: true } });
    expect(texts.find(text => text.startsWith('编号 '))).not.toContain('周期');
    expect(texts).not.toContain('K 线周期');
    // 只画 K 线盘面：照旧写
    texts.length = 0;
    await renderCampaignBoardPng({ ...fixture(), sections: { ...disabled, metadata: true, chart: true } });
    expect(texts.find(text => text.startsWith('编号 '))).toContain('· 周期 15分钟线 ·');
    expect(texts).toContain('K 线周期');
  });

  it('partial section overrides leave unspecified sections enabled', async () => {
    await renderCampaignBoardPng({ ...fixture(), chartElement: null, sections: { chart: false } });
    expect(texts).toContain('战役原数据');
    expect(texts).toContain('盈亏概览');
    expect(texts).toContain('操作日情绪日记 · 2026-09-19');
    expect(texts).toContain('Legs 列表（完整展开 0/0 条）');
  });

  it('omits unavailable diaries without reserving their height', async () => {
    const input = fixture();
    await renderCampaignBoardPng({ ...input, sections: { chart: false } });
    const fullHeight = encoded[0].height;
    await renderCampaignBoardPng({ ...input, emotionDiary: null, sections: { chart: false } });
    expect(encoded[1].height).toBeLessThan(fullHeight);
  });

  it('rejects an empty selection before rendering', async () => {
    await expect(renderCampaignBoardPng({ ...fixture(), sections: disabled })).rejects.toThrow('至少选择一个');
    expect(encoded).toHaveLength(0);
  });

  it('does not silently omit a selected chart when it is missing', async () => {
    await expect(renderCampaignBoardPng({ ...fixture(), chartElement: null })).rejects.toThrow('尚未渲染');
    expect(encoded).toHaveLength(0);
  });

  it('draws an explanation in place of the chart when the exchange has no K-lines, keeping every other module', async () => {
    const note = '交易所没有这段时间的 BTCUSDT K 线，盘面从略；「峰值浮盈」缺少 K 线路径，按已实现盈亏兜底。';
    await renderCampaignBoardPng({ ...fixture(), chartElement: null, chartUnavailableNote: note, chartViewLabel: '完整战役 · 前后上下文' });
    const header = texts.find(text => text.startsWith('编号 '))!;
    expect(header).toContain('K 线盘面（无 K 线）');
    expect(header).not.toContain('完整战役');
    expect(texts).toContain('K 线盘面（15分钟线 · 无 K 线）');
    expect(texts.join('')).toContain('交易所没有这段时间的 BTCUSDT K 线');
    expect(texts).toContain('Legs 列表（完整展开 0/0 条）');
    const withNote = encoded[0].height;
    await renderCampaignBoardPng({ ...fixture(), sections: { chart: false } });
    const withoutChart = encoded[1].height;
    await renderCampaignBoardPng(fixture());
    const withChart = encoded[2].height;
    // 说明块只占一小条（按导出倍率约 108px），不按盘面的高度留白
    expect(withNote).toBeGreaterThan(withoutChart);
    expect((withNote - withoutChart) * 4).toBeLessThan(withChart - withoutChart);
  });

  it('crops the Legs canvas to the table so it sits inside its frame instead of overflowing the board edge', async () => {
    await renderCampaignBoardPng({ ...fixture(), sections: { chart: false } });
    const legsDraw = draws.find(args => args.length === 9)!;
    expect(legsDraw).toBeDefined();
    const [, sx, , sw, , dx, , dw] = legsDraw as number[];
    const ratio = sw / dw;
    expect(dx).toBe(40);
    expect(sx / ratio).toBeCloseTo(40);
    const boardWidth = encoded[0].width / ratio;
    // 表格右缘离整图右缘仍留 40px 页边，与左边对称
    expect(boardWidth - (dx + dw)).toBeCloseTo(40);
  });

  it('keeps section titles clear of the white frame below them', async () => {
    await renderCampaignBoardPng({ ...fixture(), sections: { ...disabled, legs: true } });
    const title = positions.find(position => position.text.startsWith('Legs 列表'))!;
    const legsDraw = draws.find(args => args.length === 9)! as number[];
    // 白框从表格顶上 10px 起画：标题基线要比白框顶边再高出几像素
    expect(legsDraw[6] - 10 - title.y).toBeGreaterThanOrEqual(6);
  });

  it('releases the board if PNG encoding fails', async () => {
    const failedCanvases: HTMLCanvasElement[] = [];
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(function (this: HTMLCanvasElement, callback) {
      failedCanvases.push(this);
      callback(null);
    });
    await expect(renderCampaignBoardPng({ ...fixture(), sections: { ...disabled, metadata: true } })).rejects.toThrow('PNG 生成失败');
    expect(failedCanvases[0].width).toBe(0);
    expect(failedCanvases[0].height).toBe(0);
  });

  it('single-board export still downloads exactly one compatible filename', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:board');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download); });
    const fileName = await exportCampaignBoardPng({ ...fixture(), sections: { chart: false } });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clicks).toEqual([fileName]);
    expect(document.querySelector('a[download]')).toBeNull();
    vi.runAllTimers();
  });
});
