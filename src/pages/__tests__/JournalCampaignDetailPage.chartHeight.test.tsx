/**
 * 详情页接线：K 线盘面高度取自「可视区 − 吸顶页眉 − 面板上下占位」，窗口缩放时跟着变。
 * 纯计算与 hook 的细节见 src/hooks/__tests__/useViewportFitHeight.test.tsx；这里只钉住页面把
 * 页眉、面板、盘面三个元素接对了（页眉量错会让盘面底边被挤出屏幕，面板量错会多出内滚动），
 * 以及常驻图例（反事实一行）计入、用户点开的块（「管理」色块）不计入。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignCounterfactual } from '@/types/journal';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

const { listCounterfactualsMock } = vi.hoisted(() => ({
  listCounterfactualsMock: vi.fn(async (): Promise<CampaignCounterfactual[]> => []),
}));

vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return { ...actual, fetchLegExitPriceCorrections: vi.fn(async () => ({})) };
});
vi.mock('@/lib/campaignListCache', () => ({ waitForCampaignListHeal: vi.fn(async () => undefined) }));
vi.mock('@/lib/journalApi', async () => {
  const fixture = await import('@/test/fixtures/correctedLossCampaign');
  const loss = {
    campaign: fixture.correctedLossStoredCampaign(),
    legs: fixture.correctedLossLegs(),
    tradeRecords: fixture.correctedLossTradeRecords(),
    pendingOrders: [],
    reverseHedgeOrders: [],
  };
  return {
    readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
    getCampaignFullData: vi.fn(async () => ({ ...loss, legExitPriceCorrections: {} })),
    listAllCampaigns: vi.fn(async () => [loss.campaign]),
    listVisibleCampaigns: vi.fn(async () => [loss.campaign]),
    listCounterfactuals: listCounterfactualsMock,
    listCampaignComments: vi.fn(async () => []),
    hasMutualFollow: vi.fn(async () => true),
  };
});
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'desk@example.com' }, profile: { display_name: '主账户' } }),
}));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    getEffectiveTime: () => Date.parse('2026-01-01T01:00:00.000Z'),
    balance: 50_000,
    positionsMap: {},
    priceMap: {},
  }),
}));
vi.mock('@/hooks/useReplayKlines', () => ({
  useReplayKlines: () => ({
    klines: [{ time: Date.parse('2026-01-01T00:00:00.000Z'), open: 0.085, high: 0.0916, low: 0.0849, close: 0.09, volume: 1 }],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock('@/lib/emotionDiaryApi', () => ({ getDecisionEmotionDiaryByDate: vi.fn(async () => null) }));
vi.mock('@/components/journal/ReplayKlineChart', () => ({ ReplayKlineChart: () => <div data-testid="campaign-chart" /> }));
vi.mock('@/components/journal/CampaignLegsList', () => ({ CampaignLegsList: () => null }));
// 反事实编辑器只留一个探针：读它收到的盘面高度
vi.mock('@/components/journal/CampaignWhatIfEditor', () => ({
  CampaignWhatIfEditor: ({ chartHeight }: { chartHeight?: number }) => <div data-testid="counterfactual-editor-probe" data-chart-height={chartHeight} />,
}));
vi.mock('@/components/journal/EndCampaignDialog', () => ({ EndCampaignDialog: () => null }));

// 真机实测的排版：页眉 67px，面板贴在页眉下 8px，工具栏占 45px，盘面下方委托图例 + 内边距 36px；
// 已保存的反事实被自动选中时多一行图例（25px，含间距），点开「管理」多一行色块（25px + 间距 6px）。
const HEADER = 67;
const PANEL_TOP = HEADER + 8;
const ABOVE = 45;
const BELOW = 36;
const CF_LINE = 25;
const CHIP_ROW = 25 + 6;
const MIN_HEIGHT = 360;

function box(top: number, height: number): DOMRect {
  return { x: 0, y: top, left: 0, right: 1392, width: 1392, top, height, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

let viewportHeight = 900;
let frames: FrameRequestCallback[] = [];

function resizeViewport(height: number) {
  viewportHeight = height;
  act(() => {
    window.dispatchEvent(new Event('resize'));
    const queue = frames;
    frames = [];
    queue.forEach(callback => callback(0));
  });
}

function savedCounterfactual(): CampaignCounterfactual {
  return {
    id: 'cf-1',
    user_id: 'user-1',
    campaign_id: 'tut-1',
    label: '补齐 SOP',
    branch_kind: 'custom_what_if',
    source_deduction_id: null,
    params: {
      entry: { time: '2026-01-01T00:05:00.000Z', price: 0.086, size_usdt: 1_000, direction: 'long', leverage: 1 },
      hedge_a: { offset_pct: 2, size_pct: 50 },
      hedge_b: { offset_pct: 4, size_pct: 50 },
      mirror_tp: { offset_pct: 2, size_pct: 50 },
      rolling: { enabled: false, trigger_rise_pct: 0, min_interval_minutes: 5, new_hedge_offset_pct: 2, rolling_hedge_size_pct: 50 },
      exit_rule: 'manual_only',
    },
    result: {
      final_realized_pnl: 10,
      final_r_multiple: 1,
      peak_unrealized_pnl: 20,
      peak_drawdown: 5,
      profit_capture_ratio: 50,
      events: [{ timestamp: '2026-01-01T00:05:00.000Z', event_type: 'main_opened', leg_role: 'main_open', price: 0.086, size_usdt: 1_000, notes: '' }],
      legs_summary: [],
      state_segments: [],
      sop_score: 100,
    },
    created_at: '2026-01-01T02:00:00.000Z',
  };
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/journal/campaigns/tut-1']}>
      <Routes>
        <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  viewportHeight = 900;
  listCounterfactualsMock.mockReset();
  listCounterfactualsMock.mockResolvedValue([]);
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, get: () => viewportHeight });
  frames = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.push(callback);
    return frames.length;
  });
  // 按页面此刻的 DOM 还原排版：反事实图例行出现就多 25px，点开的块按自身高度撑高面板
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const frame = document.querySelector<HTMLElement>('[data-testid="campaign-chart-frame"]');
    const frameHeight = Number.parseFloat(frame?.style.height ?? '0') || 0;
    const panel = frame?.parentElement ?? null;
    const frameBottom = PANEL_TOP + ABOVE + frameHeight;
    if (this.tagName === 'HEADER') return box(0, HEADER);
    if (frame && this === frame) return box(PANEL_TOP + ABOVE, frameHeight);
    if (panel && this.hasAttribute('data-viewport-fit-exclude') && panel.contains(this)) return box(frameBottom + 30, CHIP_ROW);
    if (panel && this === panel) {
      const cfLine = panel.textContent?.includes('实际轨迹（标准色）') ? CF_LINE : 0;
      const opened = panel.querySelectorAll('[data-viewport-fit-exclude]').length * CHIP_ROW;
      return box(PANEL_TOP, ABOVE + frameHeight + BELOW + cfLine + opened);
    }
    return box(0, 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (document.documentElement as unknown as { clientHeight?: number }).clientHeight;
});

// 整页渲染较重：机器负载高时放宽超时，避免误报
const LOAD = { timeout: 10_000 };

describe('战役详情页 · K 线盘面按可视区撑满', { timeout: 30_000 }, () => {
  it('盘面高度 = 可视区 − 页眉 − 上下空隙 − 工具栏 − 图例；窗口变高后主图跟着变高', async () => {
    renderPage();

    const frame = await screen.findByTestId('campaign-chart-frame', {}, LOAD);
    expect(frame).toContainElement(screen.getByTestId('campaign-chart'));
    expect(frame.style.height).toBe(`${900 - HEADER - 16 - ABOVE - BELOW}px`);
    expect(frame.className).not.toContain('h-[480px]');

    // 【用户要求】反事实盘面与原始盘面同高，随窗口一起变
    const cfHeight = () => `${screen.getByTestId('counterfactual-editor-probe').getAttribute('data-chart-height')}px`;
    expect(cfHeight()).toBe(frame.style.height);

    resizeViewport(1440);
    expect(frame.style.height).toBe(`${1440 - HEADER - 16 - ABOVE - BELOW}px`);
    expect(cfHeight()).toBe(frame.style.height);

    // 矮屏守住最小高度
    resizeViewport(480);
    expect(frame.style.height).toBe(`${MIN_HEIGHT}px`);
    expect(cfHeight()).toBe(frame.style.height);
  });

  it('已保存的反事实自动选中、多一行图例：1280×600 仍整块放下（盘面 411px，底边留 8px）', async () => {
    listCounterfactualsMock.mockResolvedValue([savedCounterfactual()]);
    viewportHeight = 600;
    renderPage();

    await screen.findByRole('button', { name: '隐藏补齐 SOP' }, LOAD);
    const frame = screen.getByTestId('campaign-chart-frame');
    const below = BELOW + CF_LINE;
    await waitFor(() => expect(frame.style.height).toBe(`${600 - HEADER - 16 - ABOVE - below}px`), LOAD);
    const panelBottom = frame.parentElement!.getBoundingClientRect().bottom;
    expect(600 - panelBottom).toBe(8);

    // 点开「标记说明」：盘面高度不变，注释往下推；收起后同样不变
    const fitted = frame.style.height;
    fireEvent.click(screen.getByRole('button', { name: '标记说明' }));
    expect(await screen.findByText(/CF = 反事实「补齐」分支/, {}, LOAD)).toBeInTheDocument();
    resizeViewport(600);
    expect(frame.style.height).toBe(fitted);
    fireEvent.click(screen.getByRole('button', { name: '标记说明' }));
    resizeViewport(600);
    expect(frame.style.height).toBe(fitted);

    // 约 550px 仍能放下；再矮才落到最小值、改由页面滚动
    resizeViewport(550);
    expect(frame.style.height).toBe(`${550 - HEADER - 16 - ABOVE - below}px`);
    expect(550 - HEADER - 16 - ABOVE - below).toBeGreaterThanOrEqual(MIN_HEIGHT);
    resizeViewport(520);
    expect(frame.style.height).toBe(`${MIN_HEIGHT}px`);
  });

  it('点开「管理」色块：盘面高度不变，色块往下推；收起后同样不变', async () => {
    renderPage();

    const manage = await screen.findByRole('button', { name: '管理' }, LOAD);
    const frame = screen.getByTestId('campaign-chart-frame');
    const fitted = `${900 - HEADER - 16 - ABOVE - BELOW}px`;
    expect(frame.style.height).toBe(fitted);

    fireEvent.click(manage);
    expect(await screen.findByRole('button', { name: '收起' }, LOAD)).toBeInTheDocument();
    expect(frame.parentElement!.querySelectorAll('[data-viewport-fit-exclude]').length).toBeGreaterThan(0);
    // 点开后窗口再缩放一次，按收起时的排版量，仍是同一高度
    resizeViewport(900);
    expect(frame.style.height).toBe(fitted);

    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    resizeViewport(900);
    expect(frame.style.height).toBe(fitted);
  });
});
