import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { CampaignCardData } from '@/lib/campaignListCache';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignExportTarget } from '@/lib/campaignBatchSelection';
import JournalCampaignsPage from '../JournalCampaignsPage';

const fixture = vi.hoisted(() => ({
  rows: [] as CampaignCardData[], complete: true, refreshing: false, loaded: 4, total: 4,
  error: null, failedCount: 0, retry: vi.fn(), setRows: vi.fn(), beginMutation: () => () => {},
}));
vi.mock('@/hooks/useCampaignList', () => ({ useCampaignList: () => fixture }));
const auth = vi.hoisted(() => ({ userId: 'user-batch' }));
const dialogState = vi.hoisted(() => ({ fail: false }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/notificationCenter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/notificationCenter')>();
  const toast = Object.assign((...args: Parameters<typeof actual.toast>) => actual.toast(...args), actual.toast, { error: toastError });
  return { ...actual, toast };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: auth.userId, email: 'batch@example.com' }, profile: { display_name: '批量测试' } }) }));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => ({
  balance: 12345, positionsMap: {}, priceMap: {}, tradeHistory: [], ordersMap: {}, filledOrders: [],
  getEffectiveTime: () => Date.parse('2026-09-20T00:00:00Z'),
}) }));
vi.mock('@/lib/journalApi', () => ({
  appendCampaignEvent: vi.fn(), closeCampaign: vi.fn(), deleteCampaign: vi.fn(),
  listDeletedCampaigns: vi.fn(async () => []), permanentlyDeleteCampaign: vi.fn(),
  restoreCampaign: vi.fn(), updateCampaignImportance: vi.fn(),
}));
// 走真实的列表与散点图，但不挂工人、不发起下载：弹窗换成只展示队列的替身。
// 替身与 Radix 一样在卸载后的下一轮（setTimeout 0）调 onReturnFocus（真弹窗的关闭路径见弹窗自己的测试）。
vi.mock('@/components/journal/CampaignBatchExportDialog', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    CampaignBatchExportDialog: ({ campaigns, userId, currentAccountEquity, onClose, onReturnFocus }: {
      campaigns: readonly CampaignExportTarget[]; userId: string; currentAccountEquity: number | null;
      onClose: (outcome: { allDownloaded: boolean }) => void; onReturnFocus?: () => void;
    }) => {
      if (dialogState.fail) throw new Error('分块加载失败（测试）');
      const returnFocus = useRef(onReturnFocus);
      returnFocus.current = onReturnFocus;
      useEffect(() => () => { window.setTimeout(() => returnFocus.current?.(), 0); }, []);
      return <div role="dialog" aria-label="导出队列预览" data-testid="export-preview"
        data-user-id={userId} data-account-equity={currentAccountEquity}>
        <ol>{campaigns.map(campaign => <li key={campaign.id} data-campaign-id={campaign.id}>{campaign.title}</li>)}</ol>
        <button type="button" onClick={() => onClose({ allDownloaded: false })}>关闭预览</button>
        <button type="button" onClick={() => onClose({ allDownloaded: true })}>全部下载后关闭</button>
      </div>;
    },
  };
});

function row(id: string, title: string, date: string, importance: number, ratio: number | null, mainPriceChangePct: number | null = null): CampaignCardData {
  const campaign: TradeCampaign = {
    id, title, user_id: 'user-batch', campaign_code: `C-${id}`, symbol: 'BTCUSDT', direction: 'main_long',
    status: ratio != null && ratio < 0 ? 'closed_loss' : 'closed_profit', strategy_template: 'custom',
    opened_at: '2025-01-01T00:00:00Z', closed_at: '2025-01-01T01:00:00Z',
    initial_main_size_usdt: 1000, initial_leverage: 10, final_realized_pnl: ratio, final_r_multiple: null,
    peak_unrealized_pnl: null, peak_drawdown: null, importance_weight: importance, notes: null,
    actual_evolution: [], deviation_notes: {}, deleted_at: null, created_at: date, updated_at: date,
  };
  const leg = {
    id: `${id}-leg`, user_id: 'user-batch', campaign_id: id, trade_record_id: null, leg_role: 'main_open',
    source: 'post_review', symbol: 'BTCUSDT', direction: 'long', order_kind: 'main', leverage: 10,
    pre_simulated_time: campaign.opened_at, pre_entry_price: 100, pre_position_size: 1000,
    pre_account_equity_usdt: 10000, post_real_close_time: date, post_simulated_close_time: campaign.closed_at,
    post_realized_pnl: ratio,
  } as unknown as TradeJournal;
  // 做过加仓的战役（有一条已了结的加仓腿）才有「加仓效用」
  const legs = mainPriceChangePct != null && mainPriceChangePct > 0
    ? [leg, { ...leg, id: `${id}-add`, leg_role: 'main_add', post_realized_pnl: 10 } as unknown as TradeJournal]
    : [leg];
  return { campaign, legs, tradeRecords: [], settlement: computeCampaignRealizedPnl(campaign, legs, []),
    profitCaptureRatio: ratio, initialExpectedMaxLoss: 100, initialExpectedMaxDrawdownPct: 10,
    opportunityQuality: ratio == null ? null : Math.max(ratio / 100, 1) / 10, mainPriceChangePct };
}

beforeEach(() => {
  fixture.rows = [
    row('alpha', 'Alpha', '2026-01-15T01:00:00Z', 2, -200, -4),
    row('bravo', 'Bravo', '2026-02-15T01:00:00Z', 5, 300, 12),
    row('charlie', 'Charlie', '2026-03-15T01:00:00Z', 3, 100, 6),
    row('no-metric', 'No Metric', '2026-04-15T01:00:00Z', 1, null),
  ];
  fixture.complete = true;
  auth.userId = 'user-batch';
  dialogState.fail = false;
  toastError.mockClear();
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}{location.search}</div>;
}
function pageTree(search: string) {
  return <MemoryRouter initialEntries={[`/journal/campaigns${search}`]}><Routes>
    <Route path="/journal/campaigns" element={<><JournalCampaignsPage /><LocationProbe /></>} />
    <Route path="/journal/campaigns/:id" element={<LocationProbe />} />
  </Routes></MemoryRouter>;
}
function renderPage(search = '?sort=time&direction=desc&chart=importance') {
  const view = render(pageTree(search));
  return { ...view, rerenderPage: () => view.rerender(pageTree(search)) };
}
const selectMode = () => fireEvent.click(screen.getByTestId('campaign-batch-select-toggle'));
/** 假 IntersectionObserver：记下观察目标与参数，测试里手动回报可见比例。 */
function stubIntersectionObserver() {
  const observers: Array<{ callback: IntersectionObserverCallback; options?: IntersectionObserverInit; target?: Element }> = [];
  class FakeObserver {
    target?: Element;
    constructor(public callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) { observers.push(this); }
    observe(target: Element) { this.target = target; }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  /** 选择条（当前挂着的那条）露出的比例：1 整条可见，0 完全看不见。 */
  const report = (ratio: number) => {
    const bar = screen.getByTestId('campaign-batch-selection-bar');
    const observer = observers.filter(item => item.target === bar).at(-1)!;
    act(() => observer.callback(
      [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    ));
    return observer;
  };
  return { observers, report };
}
const check = (title: string) => screen.getByRole('checkbox', { name: `选择战役：${title}` });
const scatter = (id: string, metric = 'importance') => screen.getByTestId(`campaign-metric-point-${metric}-${id}`);
const queueIds = () => [...screen.getByTestId('export-preview').querySelectorAll('li[data-campaign-id]')].map(item => item.getAttribute('data-campaign-id'));
async function openPreview() {
  fireEvent.click(screen.getByTestId('campaign-batch-export-open'));
  return screen.findByTestId('export-preview');
}

describe('JournalCampaignsPage batch export wiring', () => {
  it('shares selection between actual scatter points and list checkboxes without navigation', async () => {
    renderPage();
    await screen.findAllByTestId('campaign-card');
    selectMode();
    fireEvent.click(check('Alpha'));
    expect(check('Alpha')).toBeChecked();
    expect(scatter('alpha')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(scatter('bravo'));
    expect(check('Bravo')).toBeChecked();
    expect(screen.getByTestId('campaign-batch-selected-count')).toHaveTextContent('2');
    fireEvent.click(scatter('alpha'));
    expect(check('Alpha')).not.toBeChecked();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/journal/campaigns?');
    const preview = await openPreview();
    expect(queueIds()).toEqual(['bravo']);
    expect(preview).toHaveAttribute('data-user-id', 'user-batch');
    expect(preview).toHaveAttribute('data-account-equity', '12345');
  }, 15_000);

  it('selects the first N after sorting and passes that exact order to the export preview', async () => {
    renderPage();
    selectMode();
    fireEvent.change(screen.getByRole('spinbutton', { name: '选择前几场' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '按当前排序选择' }));
    await openPreview();
    expect(queueIds()).toEqual(['no-metric', 'charlie']);
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    fireEvent.click(screen.getByTestId('campaign-sort-time'));
    expect(check('No Metric')).toBeChecked();
    expect(check('Charlie')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '按当前排序选择' }));
    expect(check('No Metric')).not.toBeChecked();
    expect(check('Charlie')).not.toBeChecked();
    await openPreview();
    expect(queueIds()).toEqual(['alpha', 'bravo']);
  }, 15_000);

  it('treats N larger than the list as the whole list instead of tripping the browser’s own validation', () => {
    renderPage();
    selectMode();
    const input = screen.getByRole('spinbutton', { name: '选择前几场' });
    expect(input.closest('form')).toHaveAttribute('novalidate');
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: '按当前排序选择' }));
    expect(screen.getByTestId('campaign-batch-selected-count')).toHaveTextContent('4');
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: '按当前排序选择' })).toBeDisabled();
  }, 15_000);

  it('a dialog that fails to load only closes itself with a notice; the list and the selection stay', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dialogState.fail = true;
    renderPage();
    selectMode();
    fireEvent.click(check('Alpha'));
    fireEvent.click(screen.getByTestId('campaign-batch-export-open'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('批量下载没能打开，请刷新页面后重试', expect.anything()));
    expect(screen.getAllByTestId('campaign-card')).toHaveLength(4);
    expect(check('Alpha')).toBeChecked();
    dialogState.fail = false;
    await openPreview();
    expect(queueIds()).toEqual(['alpha']);
    consoleError.mockRestore();
  }, 15_000);

  it('floats a compact dock with the count and 下载选中 once the selection bar scrolls out of view', async () => {
    const { report } = stubIntersectionObserver();
    try {
      renderPage();
      // 平时不留底部空白；选择模式下给浮条留出高度，列表最末一张卡片不被压住
      expect(screen.getByRole('main')).not.toHaveClass('pb-20');
      selectMode();
      expect(screen.getByRole('main')).toHaveClass('pb-20');
      fireEvent.click(check('Alpha'));
      expect(screen.queryByTestId('campaign-batch-dock')).not.toBeInTheDocument();
      report(0);
      const dock = screen.getByTestId('campaign-batch-dock');
      expect(dock).toHaveTextContent('已选1场');
      fireEvent.click(within(dock).getByTestId('campaign-batch-dock-export'));
      await screen.findByTestId('export-preview');
      expect(queueIds()).toEqual(['alpha']);
      // 弹窗开着时不叠一条浮条
      expect(screen.queryByTestId('campaign-batch-dock')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
      fireEvent.click(within(screen.getByTestId('campaign-batch-dock')).getByRole('button', { name: /退出选择/ }));
      expect(screen.queryByTestId('campaign-batch-dock')).not.toBeInTheDocument();
      expect(screen.queryByTestId('campaign-batch-selection-bar')).not.toBeInTheDocument();
      expect(screen.getByRole('main')).not.toHaveClass('pb-20');
      // 选择条回到视野里时浮条收起
      selectMode();
      report(0);
      expect(screen.getByTestId('campaign-batch-dock')).toBeInTheDocument();
      report(1);
      expect(screen.queryByTestId('campaign-batch-dock')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 15_000);

  it('switching the login account clears the selection and leaves selection mode', () => {
    const view = renderPage();
    selectMode();
    fireEvent.click(check('Alpha'));
    fireEvent.click(check('Bravo'));
    expect(screen.getByTestId('campaign-batch-selected-count')).toHaveTextContent('2');
    auth.userId = 'user-other';
    view.rerenderPage();
    expect(screen.queryByTestId('campaign-batch-selection-bar')).not.toBeInTheDocument();
    selectMode();
    expect(screen.getByTestId('campaign-batch-selected-count')).toHaveTextContent('0');
    expect(check('Alpha')).not.toBeChecked();
  }, 15_000);

  it('preserves metric-excluded selections, shows them clearly and appends them after the current sorted list', async () => {
    renderPage();
    selectMode();
    fireEvent.click(check('No Metric'));
    fireEvent.click(check('Alpha'));
    fireEvent.click(screen.getByTestId('campaign-sort-captureRate'));
    expect(screen.queryByRole('checkbox', { name: '选择战役：No Metric' })).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-batch-outside-note')).toHaveTextContent('另有 1 场因当前排序口径未显示');
    await openPreview();
    expect(queueIds()).toEqual(['alpha', 'no-metric']);
  }, 15_000);

  it('clears out-of-date selections when the operation date scope changes, without resurrecting them on reset', async () => {
    renderPage();
    selectMode();
    fireEvent.click(screen.getByRole('button', { name: '全选列表（4）' }));
    fireEvent.click(screen.getByTestId('campaign-operation-range'));
    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2026-02-01' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-03-31' } });
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(2));
    expect(check('Bravo')).toBeChecked();
    expect(check('Charlie')).toBeChecked();
    expect(screen.getByTestId('campaign-batch-selected-count')).toHaveTextContent('2');
    fireEvent.click(screen.getByTestId('campaign-range-clear'));
    await waitFor(() => expect(screen.getAllByTestId('campaign-card')).toHaveLength(4));
    expect(check('Alpha')).not.toBeChecked();
    expect(check('No Metric')).not.toBeChecked();
    await openPreview();
    expect(queueIds()).toEqual(['charlie', 'bravo']);
  }, 15_000);

  it('retains selection when exiting and re-entering selection mode, then restores ordinary scatter navigation', () => {
    renderPage();
    selectMode();
    fireEvent.click(check('Alpha'));
    selectMode();
    expect(screen.queryByTestId('campaign-batch-selection-bar')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: '选择战役：Alpha' })).not.toBeInTheDocument();
    selectMode();
    expect(check('Alpha')).toBeChecked();
    expect(scatter('alpha')).toHaveAttribute('aria-pressed', 'true');
    selectMode();
    fireEvent.click(scatter('alpha'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/journal/campaigns/alpha');
  }, 15_000);

  it('disables entry before the complete dataset is ready, and disables download for an empty selection', async () => {
    fixture.complete = false;
    const { unmount } = renderPage();
    expect(screen.getByTestId('campaign-batch-select-toggle')).toBeDisabled();
    unmount();
    fixture.complete = true;
    renderPage();
    selectMode();
    expect(screen.getByTestId('campaign-batch-export-open')).toBeDisabled();
    fireEvent.click(check('Alpha'));
    expect(screen.getByTestId('campaign-batch-export-open')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(screen.getByTestId('campaign-batch-export-open')).toBeDisabled();
    await act(async () => {});
  }, 15_000);

  it('opens the detail page on a plain card click, and only toggles selection in selection mode', () => {
    renderPage();
    const card = () => screen.getAllByTestId('campaign-card').find(item => item.textContent?.includes('Bravo'))!;
    selectMode();
    fireEvent.click(card());
    expect(check('Bravo')).toBeChecked();
    expect(card()).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/journal/campaigns?');
    selectMode();
    expect(card()).not.toHaveAttribute('data-selected');
    fireEvent.click(card());
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/journal/campaigns/bravo');
  }, 15_000);

  it('leaves selection mode on Escape (keeping the selection), but not while typing in the first-N box', () => {
    renderPage();
    selectMode();
    fireEvent.click(check('Alpha'));
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: '选择前几场' }), { key: 'Escape' });
    expect(screen.getByTestId('campaign-batch-selection-bar')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByTestId('campaign-batch-selection-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-batch-select-toggle')).toHaveAttribute('aria-pressed', 'false');
    selectMode();
    expect(check('Alpha')).toBeChecked();
  }, 15_000);

  it('leaves selection mode on Escape right after ticking a card checkbox (focus stays on the checkbox)', () => {
    renderPage();
    selectMode();
    const box = check('Alpha');
    box.focus();
    fireEvent.click(box);
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByTestId('campaign-batch-selection-bar')).not.toBeInTheDocument();
    // 已选保留
    selectMode();
    expect(check('Alpha')).toBeChecked();
    expect(screen.getByTestId('campaign-batch-selected-count')).toHaveTextContent('1');
  }, 15_000);

  it('stays in selection mode after an incomplete export, and returns to browsing once everything was downloaded', async () => {
    renderPage();
    selectMode();
    fireEvent.click(check('Alpha'));
    await openPreview();
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(screen.queryByTestId('export-preview')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-batch-selection-bar')).toBeInTheDocument();
    await openPreview();
    fireEvent.click(screen.getByRole('button', { name: '全部下载后关闭' }));
    expect(screen.queryByTestId('export-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-batch-selection-bar')).not.toBeInTheDocument();
    // 普通浏览恢复：点卡片进详情
    fireEvent.click(screen.getAllByTestId('campaign-card').find(item => item.textContent?.includes('Alpha'))!);
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/journal/campaigns/alpha');
  }, 15_000);

  it('closing the dialog returns keyboard focus to the 下载选中 that opened it (selection bar or dock), or to the toggle once everything was downloaded', async () => {
    const { report } = stubIntersectionObserver();
    try {
      renderPage();
      selectMode();
      fireEvent.click(check('Alpha'));
      // 从选择条上的「下载选中」打开 → 关掉后焦点回到它
      await openPreview();
      fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
      await waitFor(() => expect(screen.getByTestId('campaign-batch-export-open')).toHaveFocus());
      // 从底部浮条打开 → 焦点回到浮条上的那个
      report(0);
      fireEvent.click(screen.getByTestId('campaign-batch-dock-export'));
      await screen.findByTestId('export-preview');
      fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
      await waitFor(() => expect(screen.getByTestId('campaign-batch-dock-export')).toHaveFocus());
      // 全部下载完、退出选择模式 → 焦点交给「批量下载」开关
      fireEvent.click(screen.getByTestId('campaign-batch-dock-export'));
      await screen.findByTestId('export-preview');
      fireEvent.click(screen.getByRole('button', { name: '全部下载后关闭' }));
      expect(screen.queryByTestId('campaign-batch-selection-bar')).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('campaign-batch-select-toggle')).toHaveFocus());
      expect(screen.getByTestId('campaign-batch-select-toggle')).toHaveTextContent('批量下载');
    } finally {
      vi.unstubAllGlobals();
    }
  }, 15_000);

  it('hands over to the dock as soon as the selection bar is partly covered, not only once it is fully out of view', () => {
    const { report } = stubIntersectionObserver();
    try {
      renderPage();
      selectMode();
      fireEvent.click(check('Alpha'));
      // 窄屏上选择条滑到吸顶区底下、「下载选中」被盖掉一截时：只算「相交」会一直当它看得见，浮条不出来
      const observer = report(0.5);
      expect(observer.options?.threshold).toEqual(expect.arrayContaining([0.99]));
      expect(observer.options?.rootMargin).toMatch(/^-57px /);
      expect(screen.getByTestId('campaign-batch-dock')).toBeInTheDocument();
      report(0.98);
      expect(screen.getByTestId('campaign-batch-dock')).toBeInTheDocument();
      report(0.995);
      expect(screen.queryByTestId('campaign-batch-dock')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 15_000);

  it('leaving selection mode from the bar or the dock returns focus to 批量下载; from a card checkbox, to that card’s details toggle', async () => {
    const { report } = stubIntersectionObserver();
    try {
      renderPage();
      selectMode();
      fireEvent.click(check('Alpha'));
      const toggle = screen.getByTestId('campaign-batch-select-toggle');
      // 焦点在选择条的「下载选中」上按 Esc：选择条卸载，焦点交给「批量下载」开关
      screen.getByTestId('campaign-batch-export-open').focus();
      fireEvent.keyDown(screen.getByTestId('campaign-batch-export-open'), { key: 'Escape' });
      expect(screen.queryByTestId('campaign-batch-selection-bar')).not.toBeInTheDocument();
      await waitFor(() => expect(toggle).toHaveFocus());
      expect(toggle).toHaveTextContent('批量下载');
      // 底部浮条上的「退出选择」：同样交给开关
      selectMode();
      report(0);
      const exit = within(screen.getByTestId('campaign-batch-dock')).getByRole('button', { name: /退出选择/ });
      exit.focus();
      fireEvent.click(exit);
      expect(screen.queryByTestId('campaign-batch-dock')).not.toBeInTheDocument();
      await waitFor(() => expect(toggle).toHaveFocus());
      // 焦点在卡片勾选框上按 Esc：勾选框随选择模式卸载，焦点交给同一张卡片的「展开详情」，键盘位置不跳走
      selectMode();
      const box = check('Bravo');
      box.focus();
      fireEvent.keyDown(box, { key: 'Escape' });
      const card = screen.getAllByTestId('campaign-card').find(item => item.textContent?.includes('Bravo'))!;
      await waitFor(() => expect(within(card).getByTestId('campaign-details-toggle')).toHaveFocus());
      expect(document.body).not.toHaveFocus();
    } finally {
      vi.unstubAllGlobals();
    }
  }, 15_000);

  it('a selected card keeps its card background and adds the faint amber on top (in dark theme it must not look sunken)', () => {
    renderPage();
    selectMode();
    fireEvent.click(check('Alpha'));
    const card = (title: string) => screen.getAllByTestId('campaign-card').find(item => item.textContent?.includes(title))!;
    expect(card('Alpha')).toHaveAttribute('data-selected', 'true');
    expect(card('Alpha')).toHaveClass('bg-card', 'border-[#F0B90B]/60');
    expect(card('Alpha').className).toMatch(/bg-\[linear-gradient\(rgba\(240,185,11,0\.05\)/);
    expect(card('Bravo')).toHaveClass('bg-card');
  }, 15_000);

  it('on a narrow screen the selection bar sits below the sticky block and scrolls with the page instead of making it taller', () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 390 });
    try {
      renderPage();
      selectMode();
      const bar = screen.getByTestId('campaign-batch-selection-bar');
      expect(bar).toHaveAttribute('data-placement', 'flow');
      expect(screen.getByTestId('campaign-sticky-controls')).not.toContainElement(bar);
      // 紧跟在吸顶区后面，仍在统计与散点图这一节里
      expect(bar.previousElementSibling).toBe(screen.getByTestId('campaign-sticky-controls'));
      expect(bar).toHaveClass('order-2');
      // 选择条上的功能照旧
      fireEvent.click(screen.getByRole('button', { name: '全选列表（4）' }));
      expect(screen.getByTestId('campaign-batch-selected-count')).toHaveTextContent('4');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    }
  }, 15_000);

  it('on a wide screen the selection bar stays inside the sticky block, under the sort row', () => {
    renderPage();
    selectMode();
    const bar = screen.getByTestId('campaign-batch-selection-bar');
    expect(bar).toHaveAttribute('data-placement', 'sticky');
    expect(screen.getByTestId('campaign-sticky-controls')).toContainElement(bar);
    expect(bar).toHaveClass('order-3');
  }, 15_000);

  it('the scatter panel is its own stacking context, so a point tooltip scrolled under the sticky block never paints over it', async () => {
    renderPage('?sort=time&direction=desc&chart=odds');
    await screen.findAllByTestId('campaign-card');
    selectMode();
    // 提示框（z-20）与合并三角（z-10）只在面板内部比层级；吸顶区（sticky z-10）始终压在整块面板上面
    expect(screen.getByTestId('campaign-odds-scatter-panel')).toHaveClass('isolate');
  }, 15_000);

  // 每一张指标图、每一种看法（时序 / 分布 / 柱状）都能点选，包括后加的涨跌幅 / 涨跌幅倍数 / 加仓效用 / 算术期望分布图。
  it.each([
    ['odds', 'campaign-odds-point-'],
    ...[
      'oddsDistribution', 'expectedDrawdownPct',
      'arithmeticExpectancy', 'arithmeticExpectancyDistribution',
      'geometricExpectancy', 'geometricExpectancyDistribution',
      'mirrorTp', 'mirrorTpBars', 'dsiContribution', 'usiContribution',
      'mainPriceChange', 'mainPriceChangeDistribution',
      'mainPriceEfficiency', 'mainPriceEfficiencyDistribution',
      'addEfficiency', 'addEfficiencyDistribution',
    ].map(chart => [chart, `campaign-metric-point-${chart}-`]),
  ])('selects by clicking points on the %s chart (time, distribution and bar views alike)', async (chart, prefix) => {
    renderPage(`?sort=time&direction=desc&chart=${chart}`);
    await screen.findAllByTestId('campaign-card');
    selectMode();
    const points = document.querySelectorAll<HTMLButtonElement>(`[data-testid^="${prefix}"]`);
    expect(points.length).toBeGreaterThan(0);
    const point = points[0];
    const id = point.dataset.testid!.slice(prefix.length);
    const title = fixture.rows.find(item => item.campaign.id === id)!.campaign.title;
    fireEvent.click(point);
    expect(point).toHaveAttribute('aria-pressed', 'true');
    expect(check(title)).toBeChecked();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/journal/campaigns?');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^全选当前图（${points.length}）$`) }));
    expect(screen.getByTestId('campaign-batch-selected-count')).toHaveTextContent(String(points.length));
  }, 15_000);
});
