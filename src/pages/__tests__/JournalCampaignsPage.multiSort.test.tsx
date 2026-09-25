import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeSortRow } from '@/test/fixtures/campaignSortRows';
import JournalCampaignsPage from '../JournalCampaignsPage';

/**
 * 【用户要求】多级排序：「先让镜像止盈的排序固定下来，然后在此基础上再排序『加仓效用』」。
 * 单击排序项 = 只按这一项排（与原来一样）；排序项右侧的「+」= 追加为下一级；排序行下方的排序链逐级切方向 / 移除 / 清除。
 * 战役列表直接用排好的行（替掉 useCampaignList），读数可控：镜像止盈三档各有多场，同一档里有的算得出加仓效用、有的算不出。
 */
const state = vi.hoisted(() => ({ list: null as unknown }));

vi.mock('@/hooks/useCampaignList', () => ({ useCampaignList: () => state.list }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'desk@example.com' }, profile: { display_name: '主账户' } }),
}));
const trading = vi.hoisted(() => ({
  balance: 100_000, positionsMap: {}, priceMap: {}, tradeHistory: [], ordersMap: {}, filledOrders: [],
  getEffectiveTime: () => Date.parse('2026-09-20T12:00:00.000Z'),
}));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => trading }));
vi.mock('@/lib/journalApi', () => ({
  appendCampaignEvent: vi.fn(), closeCampaign: vi.fn(), deleteCampaign: vi.fn(), getCampaignFullData: vi.fn(),
  listDeletedCampaigns: vi.fn(async () => []), permanentlyDeleteCampaign: vi.fn(), restoreCampaign: vi.fn(),
  updateCampaignImportance: vi.fn(),
  createUserLocalSnapshotReader: () => ({ read: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [], positionsMap: {} }) }),
  fetchCampaignSourceRows: vi.fn(async () => ({ campaigns: [], journals: [] })),
  assembleCampaignsWithLegs: () => [],
}));
vi.mock('@/lib/campaignLegExecution', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/campaignLegExecution')>()),
  fetchLegExitPriceCorrections: vi.fn(async () => ({})),
  fetchLegExitPriceCorrectionsResult: vi.fn(async () => ({ corrections: {}, complete: true })),
}));

const ROWS = [
  // 已实现·盈利：盈亏 BTC > SOL > ETH > BNB；加仓效用 ETH 2.50 > BTC 1.50 > SOL 1.40 > BNB —
  makeSortRow({ id: 'sol', title: 'SOL 趋势回踩', pnl: 420, time: '2026-09-03T08:00:00.000Z', tp: true, add: true, pcr: 420, dd: 2, mpc: 6 }),
  makeSortRow({ id: 'eth', title: 'ETH 突破加仓', pnl: 250, time: '2026-09-09T08:00:00.000Z', tp: true, add: true, pcr: 250, dd: 2.5, mpc: 2.5 }),
  makeSortRow({ id: 'bnb', title: 'BNB 镜像止盈', pnl: 180, time: '2026-09-12T08:00:00.000Z', tp: true, pcr: 180, dd: 2, mpc: 3.6 }),
  makeSortRow({ id: 'btc', title: 'BTC 周线共振', pnl: 600, time: '2026-09-05T08:00:00.000Z', tp: true, add: true, pcr: 600, dd: 1.5, mpc: 6 }),
  // 已实现·亏损
  makeSortRow({ id: 'doge', title: 'DOGE 假突破', pnl: -60, time: '2026-09-07T08:00:00.000Z', tp: true, add: true, pcr: -60, dd: 2, mpc: 1 }),
  makeSortRow({ id: 'avax', title: 'AVAX 反抽', pnl: -90, time: '2026-09-14T08:00:00.000Z', tp: true, pcr: -90, dd: 3, mpc: -0.4 }),
  // 未实现·盈利：盈亏 TIA > LINK > ARB；加仓效用 LINK 1.80 > TIA 1.05 > ARB —
  makeSortRow({ id: 'link', title: 'LINK 区间', pnl: 120, time: '2026-09-11T08:00:00.000Z', add: true, pcr: 120, dd: 3, mpc: 2 }),
  makeSortRow({ id: 'arb', title: 'ARB 回踩', pnl: 80, time: '2026-09-02T08:00:00.000Z', pcr: 80, dd: 2.5, mpc: 2 }),
  makeSortRow({ id: 'tia', title: 'TIA 二次加仓', pnl: 210, time: '2026-09-08T08:00:00.000Z', add: true, pcr: 210, dd: 1.4, mpc: 2.8 }),
  // 未实现·亏损：都算不出加仓效用
  makeSortRow({ id: 'op', title: 'OP 追高', pnl: -100, time: '2026-09-06T08:00:00.000Z', pcr: -100, dd: 2, mpc: -2 }),
  makeSortRow({ id: 'apt', title: 'APT 抄底', pnl: -130, time: '2026-09-10T08:00:00.000Z', add: true, pcr: -130, dd: 2.5, mpc: -1.5 }),
];
state.list = {
  rows: ROWS, setRows: vi.fn(), complete: true, refreshing: false, loaded: ROWS.length, total: ROWS.length,
  error: null, failedCount: 0, retry: vi.fn(), beginMutation: () => () => undefined,
};

const MIRROR_ONLY = ['BTC 周线共振', 'SOL 趋势回踩', 'ETH 突破加仓', 'BNB 镜像止盈', 'DOGE 假突破', 'AVAX 反抽', 'TIA 二次加仓', 'LINK 区间', 'ARB 回踩', 'OP 追高', 'APT 抄底'];
const MIRROR_THEN_ADD = ['ETH 突破加仓', 'BTC 周线共振', 'SOL 趋势回踩', 'BNB 镜像止盈', 'DOGE 假突破', 'AVAX 反抽', 'LINK 区间', 'TIA 二次加仓', 'ARB 回踩', 'OP 追高', 'APT 抄底'];

function SearchProbe() {
  return <div data-testid="search-probe">{useLocation().search}</div>;
}
function DetailReturn() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>返回列表</button>;
}

function renderPage(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/journal/campaigns${search}`]}>
      <Routes>
        <Route path="/journal/campaigns" element={<><JournalCampaignsPage /><SearchProbe /></>} />
        <Route path="/journal/campaigns/:id" element={<DetailReturn />} />
      </Routes>
    </MemoryRouter>,
  );
}

const order = () => screen.getAllByTestId('campaign-card').map(card => card.querySelector('h2')?.textContent);
const search = () => screen.getByTestId('search-probe').textContent;
const highlights = (card: HTMLElement) => [...card.querySelectorAll('[data-sort-highlight]')]
  .map(node => `${node.getAttribute('data-testid') ?? node.tagName}:${node.getAttribute('data-sort-highlight')}`);

/** jsdom 没有 PointerEvent：用 MouseEvent 补上 pointerType。 */
const pointer = (type: string, pointerType: string) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  return event;
};
/** 键盘（回车 / 空格）触发的单击：detail = 0；鼠标、手指点出来的单击 detail ≥ 1。 */
const keyboardClick = (element: HTMLElement) => {
  element.focus();
  fireEvent.click(element, { detail: 0 });
};
const CAPTURE_FORMULA_TITLE = '单场盈亏比计算公式';

afterEach(() => {
  vi.useRealTimers();
});

describe('战役列表：多级排序', () => {
  it('只有一级时界面与原来一样：没有排序链、没有级数角标，「+」只挂在没选中的项上且平时隐藏', async () => {
    renderPage('?sort=mirrorTp&direction=desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_ONLY));
    expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="sort-chain-rank-"]')).toHaveLength(0);
    // 第一级自己没有「+」；其余十三项各一个，平时透明、只在能悬停的设备上显示（触屏改用长按）
    expect(screen.queryByTestId('sort-chain-add-mirrorTp')).not.toBeInTheDocument();
    const adds = [...document.querySelectorAll('[data-testid^="sort-chain-add-"]')];
    expect(adds).toHaveLength(13);
    for (const add of adds) {
      // 「+」挂在右上角（与多级时的级数角标同一个位置），不再叠在 Σ 那一格上；没显形时不接收指针
      expect(add).toHaveClass(
        'absolute', '-right-1', '-top-1', 'hidden', 'opacity-0', 'pointer-events-none',
        'group-hover/sort:opacity-100', 'group-hover/sort:pointer-events-auto',
        'focus-visible:opacity-100', 'focus-visible:pointer-events-auto', '[@media(hover:hover)]:inline-flex',
      );
      expect(add).not.toHaveClass('inset-y-0');
    }
    // Σ 不再在悬停时让位：图标位与原来一样
    for (const icon of document.querySelectorAll('[data-testid$="-icon"][data-testid^="campaign-sort-"]')) {
      expect(icon.className).not.toMatch(/group-hover/);
    }
    // 封面：每张卡只有镜像止盈一项亮，没有轻一档的高亮
    for (const card of screen.getAllByTestId('campaign-card')) {
      expect(highlights(card)).toEqual(['campaign-mirror-tp-status:true']);
    }
    expect(screen.getByTestId('campaign-sort-mirrorTp')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('campaign-sort-mirrorTp')).toHaveAttribute('data-sort-direction', 'desc');
  }, 15_000);

  it('【用户要求】点「+」把加仓效用加为第二级：镜像止盈同档内按加仓效用从大到小，算不出的留在档尾', async () => {
    renderPage('?sort=mirrorTp&direction=desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_ONLY));
    fireEvent.click(screen.getByTestId('sort-chain-add-addEfficiency'));

    await waitFor(() => expect(order()).toEqual(MIRROR_THEN_ADD));
    expect(search()).toBe('?sort=mirrorTp&direction=desc&then=addEfficiency.desc');
    // 排序链：① 镜像止盈 ↓ › ② 加仓效用 ↓
    const chain = screen.getByTestId('sort-chain');
    expect(within(chain).getByTestId('sort-chain-level-1')).toHaveAttribute('data-sort-mode', 'mirrorTp');
    expect(within(chain).getByTestId('sort-chain-level-1')).toHaveTextContent('1镜像止盈');
    expect(within(chain).getByTestId('sort-chain-level-2')).toHaveAttribute('data-sort-mode', 'addEfficiency');
    expect(within(chain).getByTestId('sort-chain-level-2')).toHaveAttribute('data-sort-direction', 'desc');
    expect(within(chain).getByTestId('sort-chain-clear')).toHaveTextContent('清除');
    // 折行时成组：「›」跟着它后面那一级走，ⓘ 与「清除」不分开；折下去的行在标签右边那块里（与 ① 对齐）
    const levels = within(chain).getByTestId('sort-chain-levels');
    const secondGroup = within(chain).getByTestId('sort-chain-level-2').parentElement!;
    expect(secondGroup.parentElement).toBe(levels);
    expect(secondGroup.firstElementChild).toHaveTextContent('›');
    expect(within(chain).getByTestId('sort-chain-info').parentElement).toBe(within(chain).getByTestId('sort-chain-clear').parentElement);
    expect(within(chain).getByTestId('sort-chain-label')).not.toContainElement(levels);
    expect(levels).toHaveClass('flex-1', 'flex-wrap');
    // 排序行：链上两项都标出级数，已在链上的项不再有「+」；只有第一级是「按下」态
    expect(screen.getByTestId('sort-chain-rank-mirrorTp')).toHaveTextContent('1');
    expect(screen.getByTestId('sort-chain-rank-addEfficiency')).toHaveTextContent('2');
    expect(screen.queryByTestId('sort-chain-add-addEfficiency')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-sort-addEfficiency')).toHaveAttribute('data-sort-level', '2');
    expect(screen.getByTestId('campaign-sort-addEfficiency')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('campaign-sort-mirrorTp')).toHaveAttribute('aria-pressed', 'true');
    // 下一个「+」说的是第 3 级
    expect(screen.getByTestId('sort-chain-add-captureRate')).toHaveAccessibleName('把「盈亏比」加为第 3 级排序');
    // 封面：第一级原样高亮，第二级轻一档
    const first = screen.getAllByTestId('campaign-card')[0];
    expect(highlights(first)).toEqual(['campaign-mirror-tp-status:true', 'campaign-add-efficiency:then']);
    const addCell = within(first).getByTestId('campaign-add-efficiency');
    expect(addCell).toHaveClass('ring-1', 'ring-[#F0B90B]/20');
    expect(addCell).not.toHaveClass('ring-[#F0B90B]/40');
    expect(addCell.querySelector('dt')).not.toHaveClass('font-medium');
  }, 15_000);

  it('排序链上：点名称切方向、× 移除一级、「清除」只留第一级；三级链的第三级只在前两级打平时起作用', async () => {
    renderPage('?sort=mirrorTp&direction=desc&then=addEfficiency.desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_THEN_ADD));

    // 第 2 级切升序：同档内加仓效用从小到大，算不出的仍在档尾
    fireEvent.click(screen.getByTestId('sort-chain-toggle-2'));
    await waitFor(() => expect(search()).toBe('?sort=mirrorTp&direction=desc&then=addEfficiency.asc'));
    expect(order().slice(0, 4)).toEqual(['SOL 趋势回踩', 'BTC 周线共振', 'ETH 突破加仓', 'BNB 镜像止盈']);
    expect(screen.getByTestId('campaign-sort-addEfficiency')).toHaveAttribute('data-sort-direction', 'asc');

    // 第三级：盈亏比升序——只有未实现·亏损那一档（两场都算不出加仓效用）被它重排
    fireEvent.click(screen.getByTestId('sort-chain-add-captureRate'));
    await waitFor(() => expect(search()).toBe('?sort=mirrorTp&direction=desc&then=addEfficiency.asc&then=captureRate.desc'));
    expect(order().slice(-2)).toEqual(['OP 追高', 'APT 抄底']);
    fireEvent.click(screen.getByTestId('sort-chain-toggle-3'));
    await waitFor(() => expect(order().slice(-2)).toEqual(['APT 抄底', 'OP 追高']));
    expect(order().slice(0, 4)).toEqual(['SOL 趋势回踩', 'BTC 周线共振', 'ETH 突破加仓', 'BNB 镜像止盈']);
    expect(screen.getByTestId('sort-chain-rank-captureRate')).toHaveTextContent('3');

    // 移除第 2 级：盈亏比升为第 2 级
    fireEvent.click(screen.getByTestId('sort-chain-remove-2'));
    await waitFor(() => expect(search()).toBe('?sort=mirrorTp&direction=desc&then=captureRate.asc'));
    expect(screen.getByTestId('sort-chain-level-2')).toHaveAttribute('data-sort-mode', 'captureRate');
    expect(screen.getByTestId('sort-chain-add-addEfficiency')).toBeInTheDocument();

    // 清除：只留第一级（连同方向），排序链消失，回到与只按镜像止盈时完全一样
    fireEvent.click(screen.getByTestId('sort-chain-clear'));
    await waitFor(() => expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument());
    expect(search()).toBe('?sort=mirrorTp&direction=desc');
    expect(order()).toEqual(MIRROR_ONLY);
    expect(document.querySelectorAll('[data-testid^="sort-chain-rank-"]')).toHaveLength(0);
  }, 15_000);

  it('移除第 1 级时第 2 级升为第一级，进不进列表改由它决定', async () => {
    renderPage('?sort=mirrorTp&direction=desc&then=addEfficiency.desc');
    await waitFor(() => expect(order()).toHaveLength(11));
    fireEvent.click(screen.getByTestId('sort-chain-remove-1'));
    await waitFor(() => expect(search()).toBe('?sort=addEfficiency&direction=desc'));
    expect(order()).toEqual(['ETH 突破加仓', 'LINK 区间', 'BTC 周线共振', 'SOL 趋势回踩', 'TIA 二次加仓', 'DOGE 假突破']);
    expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument();
  }, 15_000);

  it('单击排序项仍是只按这一项排：单击链上的项收成单级并保留方向，再单击才切方向', async () => {
    renderPage('?sort=mirrorTp&direction=desc&then=addEfficiency.asc');
    await waitFor(() => expect(screen.getByTestId('sort-chain')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('campaign-sort-addEfficiency'));
    await waitFor(() => expect(search()).toBe('?sort=addEfficiency&direction=asc'));
    expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('campaign-sort-addEfficiency'));
    await waitFor(() => expect(search()).toBe('?sort=addEfficiency&direction=desc'));
    // 单击不在链上的项：换成它
    fireEvent.click(screen.getByTestId('sort-chain-add-mirrorTp'));
    await waitFor(() => expect(screen.getByTestId('sort-chain')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('campaign-sort-captureRate'));
    await waitFor(() => expect(search()).toBe('?sort=captureRate&direction=desc'));
  }, 15_000);

  it('URL 往返：带 then 的链接直接还原排序链；进详情再返回，排序链原样回来', async () => {
    renderPage('?sort=mirrorTp&direction=desc&then=addEfficiency.desc&then=captureRate.asc');
    await waitFor(() => expect(screen.getByTestId('sort-chain-level-3')).toHaveAttribute('data-sort-mode', 'captureRate'));
    expect(screen.getByTestId('sort-chain-level-3')).toHaveAttribute('data-sort-direction', 'asc');
    expect(order().slice(-2)).toEqual(['APT 抄底', 'OP 追高']);
    fireEvent.click(screen.getAllByTestId('campaign-card')[0]);
    await waitFor(() => expect(screen.getByRole('button', { name: '返回列表' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '返回列表' }));
    await waitFor(() => expect(screen.getByTestId('sort-chain-level-3')).toHaveAttribute('data-sort-mode', 'captureRate'));
    expect(search()).toBe('?sort=mirrorTp&direction=desc&then=addEfficiency.desc&then=captureRate.asc');
    expect(order().slice(0, 4)).toEqual(['ETH 突破加仓', 'BTC 周线共振', 'SOL 趋势回踩', 'BNB 镜像止盈']);
  }, 15_000);

  it('空列表提示按第一级说；排序链照常显示，可以直接改', async () => {
    // 这批战役都没记杠杆：以杠杆倍数为第一级时一场都进不了列表
    renderPage('?sort=leverage&direction=desc&then=addEfficiency.desc');
    await waitFor(() => expect(screen.getByText('暂无记录了杠杆倍数的战役')).toBeInTheDocument());
    expect(screen.getByText('没有记录杠杆倍数、各腿也没有杠杆的战役不会进入当前排序')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sort-chain-remove-1'));
    await waitFor(() => expect(order()).toHaveLength(6));
  }, 15_000);

  it('打开的散点图按被点的那一项：「+」加层不切图，单击排序项照旧切图', async () => {
    renderPage('?sort=mirrorTp&direction=desc&chart=mirrorTpBars');
    await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'mirrorTpBars'));
    fireEvent.click(screen.getByTestId('sort-chain-add-addEfficiency'));
    await waitFor(() => expect(screen.getByTestId('sort-chain')).toBeInTheDocument());
    expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'mirrorTpBars');
    expect(search()).toBe('?sort=mirrorTp&direction=desc&chart=mirrorTpBars&then=addEfficiency.desc');
    fireEvent.click(screen.getByTestId('campaign-sort-captureRate'));
    await waitFor(() => expect(screen.getByTestId('campaign-metric-scatter-plot')).toHaveAttribute('data-metric-key', 'oddsDistribution'));
  }, 15_000);

  it('批量下载：「前 N 场按当前排序」按排序链选；被第一级筛掉的已选仍说明「因当前排序口径未显示」', async () => {
    renderPage('?sort=mirrorTp&direction=desc&then=addEfficiency.desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_THEN_ADD));
    fireEvent.click(screen.getByTestId('campaign-batch-select-toggle'));
    fireEvent.change(screen.getByLabelText('选择前几场'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('按当前排序选择'));
    const selected = () => screen.getAllByTestId('campaign-card')
      .filter(card => card.getAttribute('data-selected') === 'true')
      .map(card => card.querySelector('h2')?.textContent);
    await waitFor(() => expect(selected()).toEqual(['ETH 突破加仓', 'BTC 周线共振', 'SOL 趋势回踩']));
    // 全选后把第一级换成加仓效用（算不出的五场不进列表）
    fireEvent.click(screen.getByLabelText(/^全选列表/));
    fireEvent.click(screen.getByTestId('sort-chain-remove-1'));
    await waitFor(() => expect(screen.getByTestId('campaign-batch-outside-note')).toHaveTextContent('另有 5 场因当前排序口径未显示'));
  }, 15_000);

  it('触屏长按排序项 = 加为下一级；松手的那次单击与安卓顺带的 contextmenu 都不算数', async () => {
    renderPage('?sort=mirrorTp&direction=desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_ONLY));
    vi.useFakeTimers();
    try {
      const button = screen.getByTestId('campaign-sort-addEfficiency');
      fireEvent(button, pointer('pointerdown', 'touch'));
      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(200); });
      expect(screen.getByTestId('sort-chain-level-2')).toHaveAttribute('data-sort-mode', 'addEfficiency');
      const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      fireEvent(button, contextMenu);
      expect(contextMenu.defaultPrevented).toBe(true);
      expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeNull();
      fireEvent(button, pointer('pointerup', 'touch'));
      fireEvent.click(button, { detail: 1 });
      expect(screen.getByTestId('sort-chain-level-2')).toHaveAttribute('data-sort-mode', 'addEfficiency');
      expect(search()).toBe('?sort=mirrorTp&direction=desc&then=addEfficiency.desc');

      // 短按（没到 450ms 就松手）仍是只按这一项排
      const capture = screen.getByTestId('campaign-sort-captureRate');
      fireEvent(capture, pointer('pointerdown', 'touch'));
      act(() => { vi.advanceTimersByTime(200); });
      fireEvent(capture, pointer('pointerup', 'touch'));
      fireEvent.click(capture, { detail: 1 });
      act(() => { vi.advanceTimersByTime(600); });
      expect(search()).toBe('?sort=captureRate&direction=desc');
      expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument();

      // 鼠标长按不算（桌面用「+」）
      const alpha = screen.getByTestId('campaign-sort-alpha');
      fireEvent(alpha, pointer('pointerdown', 'mouse'));
      act(() => { vi.advanceTimersByTime(800); });
      expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  }, 15_000);

  it('长按加层后手指滑走（pointercancel）：之后的键盘操作照常，不被当成长按松手吞掉', async () => {
    renderPage('?sort=mirrorTp&direction=desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_ONLY));
    vi.useFakeTimers();
    try {
      const button = screen.getByTestId('campaign-sort-addEfficiency');
      fireEvent(button, pointer('pointerdown', 'touch'));
      act(() => { vi.advanceTimersByTime(500); });
      expect(screen.getByTestId('sort-chain-level-2')).toHaveAttribute('data-sort-mode', 'addEfficiency');
      // 手指滑动去滚页面：浏览器发 pointercancel，不发 pointerup
      fireEvent(button, pointer('pointercancel', 'touch'));
      act(() => { vi.advanceTimersByTime(500); });
      // 键盘的菜单键（contextmenu）：照常看说明
      const capture = screen.getByTestId('campaign-sort-captureRate');
      fireEvent(capture, createEvent.contextMenu(capture));
      expect(screen.getByText(CAPTURE_FORMULA_TITLE)).toBeInTheDocument();
      // 键盘回车：照常只按盈亏比排
      fireEvent.click(capture, { detail: 0 });
      expect(search()).toBe('?sort=captureRate&direction=desc');
    } finally {
      vi.useRealTimers();
    }
  }, 15_000);

  it('键盘回车触发的单击不会被长按吞掉（长按标记还没复位也一样）', async () => {
    renderPage('?sort=mirrorTp&direction=desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_ONLY));
    vi.useFakeTimers();
    try {
      const button = screen.getByTestId('campaign-sort-addEfficiency');
      fireEvent(button, pointer('pointerdown', 'touch'));
      act(() => { vi.advanceTimersByTime(500); });
      fireEvent(button, pointer('pointercancel', 'touch'));
      // 复位前（400ms 内）用键盘单击另一项
      fireEvent.click(screen.getByTestId('campaign-sort-captureRate'), { detail: 0 });
      expect(search()).toBe('?sort=captureRate&direction=desc');
    } finally {
      vi.useRealTimers();
    }
  }, 15_000);

  it('「+」不挡 Σ：右键 / 双击 Σ 与原来一样；右键「+」同样看说明、不加层', async () => {
    renderPage('?sort=mirrorTp&direction=desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_ONLY));
    const sortButton = screen.getByTestId('campaign-sort-captureRate');
    const sigma = screen.getByTestId('campaign-sort-captureRate-icon');
    const add = screen.getByTestId('sort-chain-add-captureRate');
    // Σ 在排序按钮里；「+」在按钮外那一层、挂在右上角
    expect(sortButton).toContainElement(sigma);
    expect(sortButton).not.toContainElement(add);

    // 右键 Σ：看说明，不改排序
    const menuOnSigma = createEvent.contextMenu(sigma);
    fireEvent(sigma, menuOnSigma);
    expect(menuOnSigma.defaultPrevented).toBe(true);
    expect(await screen.findByText(CAPTURE_FORMULA_TITLE)).toBeInTheDocument();
    expect(search()).toBe('?sort=mirrorTp&direction=desc');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(CAPTURE_FORMULA_TITLE)).not.toBeInTheDocument());

    // 右键「+」（悬停时它显形在右上角）：同样看说明，不加层、不弹浏览器菜单
    const menuOnAdd = createEvent.contextMenu(add);
    fireEvent(add, menuOnAdd);
    expect(menuOnAdd.defaultPrevented).toBe(true);
    expect(await screen.findByText(CAPTURE_FORMULA_TITLE)).toBeInTheDocument();
    expect(search()).toBe('?sort=mirrorTp&direction=desc');
    expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText(CAPTURE_FORMULA_TITLE)).not.toBeInTheDocument());

    // 双击 Σ：第一击只按盈亏比排，第二击不算，dblclick 打开说明——不会悄悄多出一级
    fireEvent.click(sigma, { detail: 1 });
    fireEvent.click(sigma, { detail: 2 });
    fireEvent.dblClick(sigma);
    await waitFor(() => expect(search()).toBe('?sort=captureRate&direction=desc'));
    expect(await screen.findByText(CAPTURE_FORMULA_TITLE)).toBeInTheDocument();
    expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument();
  }, 15_000);

  it('双击「+」只加一级：第一击加层后「+」卸载，第二击落到排序按钮上，不改排序、也不顺带弹说明', async () => {
    renderPage('?sort=mirrorTp&direction=desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_ONLY));
    fireEvent.click(screen.getByTestId('sort-chain-add-captureRate'), { detail: 1 });
    await waitFor(() => expect(screen.queryByTestId('sort-chain-add-captureRate')).not.toBeInTheDocument());
    const sortButton = screen.getByTestId('campaign-sort-captureRate');
    fireEvent.click(sortButton, { detail: 2 });
    fireEvent.dblClick(sortButton);
    expect(search()).toBe('?sort=mirrorTp&direction=desc&then=captureRate.desc');
    expect(screen.queryByText(CAPTURE_FORMULA_TITLE)).not.toBeInTheDocument();
    // 过了双击间隔再双击排序按钮：照常看说明
    await new Promise(resolve => setTimeout(resolve, 850));
    fireEvent.click(sortButton, { detail: 2 });
    fireEvent.dblClick(sortButton);
    expect(await screen.findByText(CAPTURE_FORMULA_TITLE)).toBeInTheDocument();
    expect(search()).toBe('?sort=mirrorTp&direction=desc&then=captureRate.desc');
  }, 15_000);

  it('多级时双击排序项看说明：第一击收成的单级在双击时还原，排序链不变', async () => {
    renderPage('?sort=mirrorTp&direction=desc&then=addEfficiency.desc');
    await waitFor(() => expect(screen.getByTestId('sort-chain-level-2')).toBeInTheDocument());
    const sortButton = screen.getByTestId('campaign-sort-captureRate');
    fireEvent.click(sortButton, { detail: 1 });
    await waitFor(() => expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument());
    fireEvent.click(sortButton, { detail: 2 });
    fireEvent.dblClick(sortButton);
    await waitFor(() => expect(search()).toBe('?sort=mirrorTp&direction=desc&then=addEfficiency.desc'));
    expect(screen.getByTestId('sort-chain-level-2')).toBeInTheDocument();
    expect(await screen.findByText(CAPTURE_FORMULA_TITLE)).toBeInTheDocument();
  }, 15_000);

  it('键盘在「+」上连按两下：第二下不把刚建好的链收成单级；过了间隔再按才是只按这一项排', async () => {
    renderPage('?sort=mirrorTp&direction=desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_ONLY));
    keyboardClick(screen.getByTestId('sort-chain-add-captureRate'));
    await waitFor(() => expect(screen.getByTestId('campaign-sort-captureRate')).toHaveFocus());
    keyboardClick(screen.getByTestId('campaign-sort-captureRate'));
    expect(search()).toBe('?sort=mirrorTp&direction=desc&then=captureRate.desc');
    await new Promise(resolve => setTimeout(resolve, 850));
    keyboardClick(screen.getByTestId('campaign-sort-captureRate'));
    await waitFor(() => expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument());
  }, 15_000);

  it('链上的名称、×、清除忽略连击的第二下；× / 清除之后紧跟的连击不会落到挪过来的东西上', async () => {
    renderPage('?sort=mirrorTp&direction=desc&then=addEfficiency.desc&then=captureRate.desc');
    await waitFor(() => expect(screen.getByTestId('sort-chain-level-3')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('sort-chain-toggle-2'), { detail: 2 });
    expect(search()).toBe('?sort=mirrorTp&direction=desc&then=addEfficiency.desc&then=captureRate.desc');
    fireEvent.click(screen.getByTestId('sort-chain-remove-3'), { detail: 1 });
    await waitFor(() => expect(screen.queryByTestId('sort-chain-level-3')).not.toBeInTheDocument());
    // 双击的第二下落到挪过来的下一级 × 上（detail 2）：忽略
    fireEvent.click(screen.getByTestId('sort-chain-remove-2'), { detail: 2 });
    expect(screen.getByTestId('sort-chain-level-2')).toBeInTheDocument();
    expect(search()).toBe('?sort=mirrorTp&direction=desc&then=addEfficiency.desc');
    // 清除之后第二下落到挪上来的第一张卡片上：被吞掉，不进详情页
    fireEvent.click(screen.getByTestId('sort-chain-clear'), { detail: 1 });
    await waitFor(() => expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument());
    fireEvent.click(screen.getAllByTestId('campaign-card')[0], { detail: 2 });
    expect(screen.queryByText('返回列表')).not.toBeInTheDocument();
    expect(search()).toBe('?sort=mirrorTp&direction=desc');
  }, 15_000);

  it('键盘操作「+」、×、清除之后，焦点留在排序区（不掉回页面开头）；鼠标点不挪焦点', async () => {
    renderPage('?sort=mirrorTp&direction=desc');
    await waitFor(() => expect(order()).toEqual(MIRROR_ONLY));

    // 「+」：焦点落到同一项的排序按钮上（「+」随即换成级数角标），接着 Tab 仍从这一项往后走
    keyboardClick(screen.getByTestId('sort-chain-add-addEfficiency'));
    await waitFor(() => expect(screen.getByTestId('campaign-sort-addEfficiency')).toHaveFocus());
    keyboardClick(screen.getByTestId('sort-chain-add-captureRate'));
    await waitFor(() => expect(screen.getByTestId('campaign-sort-captureRate')).toHaveFocus());
    expect(search()).toBe('?sort=mirrorTp&direction=desc&then=addEfficiency.desc&then=captureRate.desc');

    // ×：还剩多级时落到前一级的名称上
    keyboardClick(screen.getByTestId('sort-chain-remove-3'));
    await waitFor(() => expect(screen.getByTestId('sort-chain-toggle-2')).toHaveFocus());
    expect(search()).toBe('?sort=mirrorTp&direction=desc&then=addEfficiency.desc');
    keyboardClick(screen.getByTestId('sort-chain-add-captureRate'));
    await waitFor(() => expect(screen.getByTestId('sort-chain-level-3')).toBeInTheDocument());
    // 移除第 1 级：落到新的第 1 级上
    keyboardClick(screen.getByTestId('sort-chain-remove-1'));
    await waitFor(() => expect(search()).toBe('?sort=addEfficiency&direction=desc&then=captureRate.desc'));
    expect(screen.getByTestId('sort-chain-toggle-1')).toHaveFocus();

    // 清除：排序链消失，落到第一级的排序按钮上
    keyboardClick(screen.getByTestId('sort-chain-clear'));
    await waitFor(() => expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument());
    expect(screen.getByTestId('campaign-sort-addEfficiency')).toHaveFocus();

    // × 移到只剩一级：排序链消失，落到剩下那一级的排序按钮上
    keyboardClick(screen.getByTestId('sort-chain-add-mirrorTp'));
    await waitFor(() => expect(screen.getByTestId('sort-chain-remove-2')).toBeInTheDocument());
    keyboardClick(screen.getByTestId('sort-chain-remove-2'));
    await waitFor(() => expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument());
    expect(screen.getByTestId('campaign-sort-addEfficiency')).toHaveFocus();

    // 鼠标点（detail ≥ 1）不挪焦点
    fireEvent.click(screen.getByTestId('sort-chain-add-mirrorTp'), { detail: 1 });
    await waitFor(() => expect(screen.getByTestId('sort-chain')).toBeInTheDocument());
    expect(screen.getByTestId('campaign-sort-mirrorTp')).not.toHaveFocus();
    expect(screen.getByTestId('campaign-sort-addEfficiency')).toHaveFocus();
  }, 15_000);

  it('多级时排序行上的提示说清单击的效果：收成只按这一项排、方向不变（第 1 级同样标出级数）', async () => {
    renderPage('?sort=mirrorTp&direction=desc&then=addEfficiency.desc');
    await waitFor(() => expect(screen.getByTestId('sort-chain')).toBeInTheDocument());
    const first = screen.getByTestId('campaign-sort-mirrorTp');
    expect(first.getAttribute('title')).toContain('第 1 级：按镜像止盈');
    expect(first.getAttribute('title')).toContain('单击改为只按这一项排（方向不变）');
    expect(first.getAttribute('title')).not.toContain('再次单击切换方向');
    expect(first.getAttribute('aria-label')).toContain('（第 1 级）');
    const second = screen.getByTestId('campaign-sort-addEfficiency');
    expect(second.getAttribute('title')).toContain('第 2 级：按加仓效用');
    expect(second.getAttribute('title')).toContain('单击改为只按这一项排（方向不变）');
    expect(second.getAttribute('aria-label')).toContain('（第 2 级）');

    // 只有一级时与原来一样
    fireEvent.click(screen.getByTestId('sort-chain-clear'));
    await waitFor(() => expect(screen.queryByTestId('sort-chain')).not.toBeInTheDocument());
    expect(first.getAttribute('title')).toContain('再次单击切换方向');
    expect(first.getAttribute('title')).not.toContain('第 1 级');
    expect(first.getAttribute('aria-label')).not.toContain('第 1 级');
  }, 15_000);

  it('ⓘ 写明规则：第一级决定进不进列表、缺值排本档末尾、清除保留第一级、手机长按', async () => {
    renderPage('?sort=mirrorTp&direction=desc&then=addEfficiency.desc');
    await waitFor(() => expect(screen.getByTestId('sort-chain')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('sort-chain-info'));
    const rules = await screen.findByTestId('sort-chain-rules');
    expect(rules).toHaveTextContent('第一级决定哪些战役进列表');
    expect(rules).toHaveTextContent('第二级起算不出的战役留在本档、排到本档末尾（不论升序还是降序）');
    expect(rules).toHaveTextContent('「清除」只保留第一级');
    expect(rules).toHaveTextContent('手机上长按排序项');
  }, 15_000);
});
