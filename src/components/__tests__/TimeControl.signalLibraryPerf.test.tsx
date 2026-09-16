// @vitest-environment jsdom
/**
 * 信号库在**真实体量**（791 条）下的行为与代价。
 *
 * 五条要守的线：
 *   ① 点表头换排序只重排窗口内的十几行，而不是 791 行；
 *   ② 模拟时间每跳一格，列表一行都不重渲染、列表本身也不重渲染——回放期间时钟每秒跳好几次，
 *      列表跟着重渲染就是「点一下表头要等半秒」的真正来源；
 *   ③ 纯排序是只读操作：不写盘、不重跑跳转预检；
 *   ④ 筛选 / 月份的结果与直接调 sortSignalsBy + filter 一字不差；
 *   ⑤ 键盘打分让这一行被重排到窗口之外时，焦点仍留在那颗星上（与改造前一致）。
 */
import { createElement, type ComponentType, type ReactElement } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeControl } from '../TimeControl';
import {
  SIGNAL_LIBRARY_STORAGE_KEY, signalMonthKey, sortSignalsBy,
  type SignalSortKey, type TradeSignal,
} from '@/lib/signalLibrary';
import { makeBulkSignals, BULK_SIGNAL_COUNT } from '@/test/fixtures/signalLibraryBulk';
import { SIGNAL_ROW_OVERSCAN } from '../SignalLibraryList';

const counters = vi.hoisted(() => ({ rowRenders: 0, listPasses: 0, saves: 0, audits: 0 }));
/**
 * pending=true 时预检永远不结束，模拟真实环境里「逐个标的拉 K 线、要跑一阵子」的样子。
 * 立刻结束的桩会把「已完成」的键记下来，此后就算排序真的重启了预检效果，
 * 它也会在调用预检之前提前返回——计数纹丝不动，断言形同虚设。
 */
const preflightMode = vi.hoisted(() => ({ pending: false }));
const listProps = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u-bulk' } }) }));
// 成交与持仓的身份必须稳住：真的 TradingContext 里它们是 usePersistedState 的 state，
// 不会因为价格跳动而换身份。每次调用都造一个新数组的话，测的就不是组件而是这个 mock。
const ctxStub = vi.hoisted(() => ({ tradeHistory: [], positionsMap: {}, priceMap: {} }));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    tradeHistory: ctxStub.tradeHistory,
    positionsMap: ctxStub.positionsMap,
    priceMap: ctxStub.priceMap,
    getEffectiveTime: () => Date.parse('2026-04-29T10:27:00.000Z'),
    getTimelineId: () => null,
  }),
}));
vi.mock('@/lib/journalApi', () => ({ listAllCampaigns: vi.fn(async () => []) }));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({ PreTradeSnapshotDialog: () => null }));
vi.mock('@/lib/signalJumpDiagnostics', async (orig) => ({
  ...(await orig() as object),
  preflightSignalJumpIssues: vi.fn(() => {
    counters.audits += 1;
    if (preflightMode.pending) return new Promise(() => {});
    return Promise.resolve({ checkedSymbols: 0, totalSymbols: 0, retryableSymbols: 0 });
  }),
}));
// 列表函数体每跑一遍，就对铺出来的每一行各查一次「当日交易过没有」：
// 拿它当「列表本身重渲染了没有」的探针——行是 memo 的，行渲染次数看不出列表有没有白跑。
vi.mock('@/lib/signalCampaignIndex', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const real = actual.hasTradeOnSignalDay as (...args: unknown[]) => boolean;
  return {
    ...actual,
    hasTradeOnSignalDay: (...args: unknown[]) => { counters.listPasses += 1; return real(...args); },
  };
});
vi.mock('@/lib/signalLibrary', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const realSave = actual.saveSignals as (list: TradeSignal[]) => void;
  return {
    ...actual,
    saveSignals: (list: TradeSignal[]) => { counters.saves += 1; realSave(list); },
  };
});
// 每行一组星：拿它当「有多少行真的重渲染了」的探针。
vi.mock('@/components/SignalQualityStars', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const Inner = actual.SignalQualityStars as (props: Record<string, unknown>) => ReactElement;
  return {
    ...actual,
    SignalQualityStars: (props: Record<string, unknown>) => {
      counters.rowRenders += 1;
      return createElement(Inner, props);
    },
  };
});
// 记下每次交给列表的 props，用来验「时钟跳格时这些身份一个都没变」。
// 刻意不是 memo：包装层挡住重渲染的话，就测不到 TimeControl 真的给了恒定的 props。
vi.mock('@/components/SignalLibraryList', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const Real = actual.SignalLibraryList as ComponentType<Record<string, unknown>>;
  return {
    ...actual,
    SignalLibraryList: (props: Record<string, unknown>) => {
      listProps.calls.push(props);
      return createElement(Real, props);
    },
  };
});

const SIGNALS = makeBulkSignals();
const BASE_TIME = Date.parse('2026-04-29T10:27:41.000Z');
/** 可视区 9 行；停在顶部时只有下方能 overscan。 */
const TOP_WINDOW = 9 + SIGNAL_ROW_OVERSCAN;
/** 停在顶部时 DOM 里的行：窗口 + 始终留着的末行。 */
const TOP_RENDERED = TOP_WINDOW + 1;
/** 连点多次表头的用例：jsdom 里每次都要重渲染整个 TimeControl，全量并行跑时给足余量。 */
const MULTI_CLICK_TIMEOUT = 20_000;
/** 一串排好的行停在顶部时，DOM 里应当依次出现哪些。 */
const topRendered = <T,>(ordered: T[]) => (ordered.length <= TOP_RENDERED
  ? ordered
  : [...ordered.slice(0, TOP_WINDOW), ordered[ordered.length - 1]]);

const control = (time: number) => (
  <TimeControl
    status="playing" currentSimulatedTime={time} speed={60}
    onStart={() => {}} onPause={() => {}} onResume={() => {}} onStop={() => {}} onSetSpeed={() => {}}
    activeSymbol="BTCUSDT"
  />
);

async function renderControl() {
  const view = render(control(BASE_TIME));
  await act(async () => {});
  return view;
}

/** 展开信号库，并等「当日战役」索引那一次异步加载落定——否则它会在断言之后、act 之外改状态。 */
const openLibrary = async () => {
  fireEvent.click(screen.getByTitle(/信号库：上传/));
  await act(async () => {});
};
const libraryRoot = () => screen.getByTestId('signal-library-panel');
const scroller = () => screen.getByTestId('signal-library-scroller');
const renderedSymbols = () =>
  within(scroller()).getAllByText(/USDT$/).map(node => node.textContent);
const renderedRowCount = () => within(scroller()).getAllByTitle('删除该信号').length;
/** 最近一次交给列表的完整行序（不止窗口里那一段）。 */
const listedIds = () => (listProps.calls[listProps.calls.length - 1].rows as TradeSignal[]).map(s => s.id);
// 不用 getAllByRole：它在 jsdom 里要对每个节点算可见性，几百个节点就是几百毫秒。
const renderedIds = () => Array.from(scroller().querySelectorAll('[role="radiogroup"]'))
  .map(group => (group.getAttribute('data-testid') ?? '').slice('signal-quality-'.length));

beforeEach(() => {
  counters.rowRenders = 0;
  counters.listPasses = 0;
  counters.saves = 0;
  counters.audits = 0;
  preflightMode.pending = false;
  listProps.calls.length = 0;
  localStorage.clear();
  localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY, JSON.stringify(SIGNALS));
});

describe(`信号库（${BULK_SIGNAL_COUNT} 条）`, () => {
  it('展开后只铺出窗口内的十几行', async () => {
    await renderControl();
    await openLibrary();
    expect(screen.getByTitle(/信号库：上传/)).toHaveTextContent(String(BULK_SIGNAL_COUNT));
    expect(renderedRowCount()).toBe(TOP_RENDERED);
    // 791 行时的节点量级：改造前这里是两万多个元素、五千多个 SVG
    expect(scroller().querySelectorAll('*').length).toBeLessThan(1200);
  });

  describe('点表头换排序', () => {
    const expectTop = (key: SignalSortKey, dir: 'asc' | 'desc') => {
      const expected = topRendered(sortSignalsBy(SIGNALS, key, dir));
      expect(renderedRowCount()).toBe(TOP_RENDERED);
      expect(renderedSymbols()).toEqual(expected.map(s => s.symbol));
      expect(renderedIds()).toEqual(expected.map(s => s.id));
    };

    it('三个键 × 两个方向，窗口内的首行与末行都对得上 sortSignalsBy', async () => {
      await renderControl();
      await openLibrary();
      const lib = libraryRoot();
      const click = (label: string) => fireEvent.click(within(lib).getByTestId(`signal-sort-${label}`));

      expectTop('symbol', 'asc');                 // 初始：标的 A→Z
      click('标的'); expectTop('symbol', 'desc');
      click('信号时间'); expectTop('time', 'desc');
      click('信号时间'); expectTop('time', 'asc');
      click('评分'); expectTop('quality', 'desc');
      click('评分'); expectTop('quality', 'asc');
      click('标的'); expectTop('symbol', 'asc');
    }, MULTI_CLICK_TIMEOUT);

    it('一次排序只重渲染窗口内的行，列表本身只跑一遍', async () => {
      await renderControl();
      await openLibrary();
      const lib = libraryRoot();
      for (const label of ['评分', '评分', '标的', '信号时间', '标的']) {
        const before = new Set(renderedIds());
        counters.rowRenders = 0;
        counters.listPasses = 0;
        fireEvent.click(within(lib).getByTestId(`signal-sort-${label}`));
        // 只有新进窗口的行要渲染；原本就在 DOM 里、props 没变的行（比如始终留着的首末行）不动。
        // 改造前这里是 791
        const mounted = renderedIds().filter(id => !before.has(id)).length;
        expect(counters.rowRenders).toBe(mounted);
        expect(counters.rowRenders).toBeLessThanOrEqual(TOP_RENDERED);
        expect(counters.listPasses).toBe(TOP_RENDERED);
      }
    }, MULTI_CLICK_TIMEOUT);

    it('纯排序不写盘、不重跑跳转预检', async () => {
      preflightMode.pending = true;
      await renderControl();
      await openLibrary();
      await act(async () => {});
      const auditsAfterMount = counters.audits;
      // 预检确实在跑、而且还没跑完——否则「没重跑」只是因为它早就记成已完成了
      expect(auditsAfterMount).toBe(1);
      expect(within(libraryRoot()).getByTitle(/正在后台预检/)).toBeInTheDocument();
      counters.saves = 0;

      const lib = libraryRoot();
      for (const label of ['评分', '评分', '标的', '信号时间']) {
        fireEvent.click(within(lib).getByTestId(`signal-sort-${label}`));
      }
      await act(async () => {});
      expect(counters.saves).toBe(0);
      expect(counters.audits).toBe(auditsAfterMount);
    }, MULTI_CLICK_TIMEOUT);
  });

  describe('筛选与月份', () => {
    it('按标的筛选的结果与 sortSignalsBy + filter 一致', async () => {
      await renderControl();
      await openLibrary();
      const lib = libraryRoot();
      fireEvent.change(within(lib).getByPlaceholderText(/筛选标的/), { target: { value: 'sol' } });

      const expected = sortSignalsBy(SIGNALS, 'symbol', 'asc')
        .filter(s => s.symbol.includes('SOL'));
      expect(expected.length).toBeGreaterThan(TOP_WINDOW);
      expect(listedIds()).toEqual(expected.map(s => s.id));
      expect(renderedSymbols()).toEqual(topRendered(expected).map(s => s.symbol));
    });

    it('按月份筛选的结果与直接过滤一致（且自动切成时间旧→新）', async () => {
      await renderControl();
      await openLibrary();
      const lib = libraryRoot();
      const month = '2025-06';
      fireEvent.change(within(lib).getByTitle(/按月份定位信号/), { target: { value: month } });

      const expected = sortSignalsBy(SIGNALS, 'time', 'asc')
        .filter(s => signalMonthKey(s.timeMs) === month);
      expect(expected.length).toBeGreaterThan(TOP_WINDOW);
      expect(listedIds()).toEqual(expected.map(s => s.id));
      expect(renderedSymbols()).toEqual(topRendered(expected).map(s => s.symbol));
    });

    it('筛到没有匹配时给的是空态文案，不是空列表', async () => {
      await renderControl();
      await openLibrary();
      const lib = libraryRoot();
      fireEvent.change(within(lib).getByPlaceholderText(/筛选标的/), { target: { value: '不存在' } });
      expect(within(lib).getByText('没有匹配的标的。')).toBeInTheDocument();
    });
  });

  describe('模拟时间跳格', () => {
    it('列表一行都不重渲染，列表本身也不重渲染', async () => {
      const { rerender } = await renderControl();
      await openLibrary();
      await act(async () => {});
      counters.rowRenders = 0;
      counters.listPasses = 0;
      const tcRendersBefore = listProps.calls.length;

      for (let i = 1; i <= 5; i += 1) {
        act(() => { rerender(control(BASE_TIME + i * 1000)); });
      }
      // TimeControl 确实跟着时钟重渲染了 5 次……
      expect(listProps.calls.length - tcRendersBefore).toBe(5);
      // ……但 memo 把列表整块挡住：函数体一次没跑，行也一行没动。改造前：每跳一格重渲染 791 行
      expect(counters.listPasses).toBe(0);
      expect(counters.rowRenders).toBe(0);
      // 时钟本身仍在走——不是整个组件被冻住了
      expect(screen.getByText(/2026-04-29/)).toBeInTheDocument();
    });

    it('交给列表的每一个 prop 在跳格前后都是同一个身份', async () => {
      const { rerender } = await renderControl();
      await openLibrary();
      await act(async () => {});
      const before = listProps.calls[listProps.calls.length - 1];

      act(() => { rerender(control(BASE_TIME + 60_000)); });
      const after = listProps.calls[listProps.calls.length - 1];

      expect(after).not.toBe(before);   // TimeControl 确实重渲染了
      for (const key of [
        'rows', 'tradedDayIndex', 'campaignDayIndex', 'jumpingSignalId',
        'resetKey', 'onJump', 'onDelete', 'onRate',
      ]) {
        expect(after[key]).toBe(before[key]);
      }
    });

    it('列表与星星都是 memo 组件', async () => {
      const list = await vi.importActual<Record<string, unknown>>('@/components/SignalLibraryList');
      const stars = await vi.importActual<Record<string, unknown>>('@/components/SignalQualityStars');
      const memoTag = Symbol.for('react.memo');
      expect((list.SignalLibraryList as { $$typeof?: symbol }).$$typeof).toBe(memoTag);
      expect((list.SignalLibraryRow as { $$typeof?: symbol }).$$typeof).toBe(memoTag);
      expect((stars.SignalQualityStars as { $$typeof?: symbol }).$$typeof).toBe(memoTag);
    });
  });

  describe('逐行操作在这个体量下照旧', () => {
    it('打分只改那一行，并落进 localStorage', async () => {
      await renderControl();
      await openLibrary();
      const target = sortSignalsBy(SIGNALS, 'symbol', 'asc')[2];
      counters.rowRenders = 0;
      fireEvent.click(screen.getByTestId(`signal-quality-${target.id}-4`));

      const saved = JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY) ?? '[]');
      expect(saved.find((x: TradeSignal) => x.id === target.id).quality).toBe(4);
      const others = SIGNALS.filter(s => s.id !== target.id);
      for (const s of others.slice(0, 20)) {
        expect(saved.find((x: TradeSignal) => x.id === s.id).quality).toBe(s.quality);
      }
      // 排序键是标的，打分不改顺序 —— 只有那一行需要重画
      expect(counters.rowRenders).toBe(1);
    });

    it('删除把那一条从列表里拿掉，并补上窗口下方的一行', async () => {
      await renderControl();
      await openLibrary();
      const ordered = sortSignalsBy(SIGNALS, 'symbol', 'asc');
      const target = ordered[0];
      const row = screen.getByTestId(`signal-quality-${target.id}`).closest('.group') as HTMLElement;
      fireEvent.click(within(row).getByTitle('删除该信号'));
      // 库变了，跳转预检会按新库重跑一次；等它落定，免得它在断言之后、act 之外改状态
      await act(async () => {});

      expect(screen.queryByTestId(`signal-quality-${target.id}`)).toBeNull();
      expect(renderedRowCount()).toBe(TOP_RENDERED);
      expect(renderedSymbols()).toEqual(topRendered(ordered.slice(1)).map(s => s.symbol));
      const saved = JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY) ?? '[]');
      expect(saved).toHaveLength(BULK_SIGNAL_COUNT - 1);
    });

    it('跳转仍然把标的与时间递出去，成功后收起面板', async () => {
      const onJumpToSignal = vi.fn(async () => ({ ok: true as const }));
      const onSymbolChange = vi.fn();
      const view = render(
        <TimeControl
          status="playing" currentSimulatedTime={BASE_TIME} speed={60}
          onStart={() => {}} onPause={() => {}} onResume={() => {}} onStop={() => {}} onSetSpeed={() => {}}
          activeSymbol="BTCUSDT"
          onJumpToSignal={onJumpToSignal}
          onSymbolChange={onSymbolChange}
        />,
      );
      await act(async () => {});
      await openLibrary();
      const target = sortSignalsBy(SIGNALS, 'symbol', 'asc')[1];
      const row = screen.getByTestId(`signal-quality-${target.id}`).closest('.group') as HTMLElement;
      await act(async () => { fireEvent.click(within(row).getByTitle('跳转盘面')); });

      expect(onJumpToSignal).toHaveBeenCalledWith(target.symbol, target.timeMs);
      expect(screen.queryByTestId('signal-library-panel')).toBeNull();
      view.unmount();
    });

    it('不可跳转徽标只出现在带标记的那些行上', async () => {
      await renderControl();
      await openLibrary();
      const visible = topRendered(sortSignalsBy(SIGNALS, 'symbol', 'asc'));
      const expected = visible.filter(s => s.jumpIssue).length;
      const badges = within(scroller()).queryAllByTestId('signal-jump-issue');
      expect(badges).toHaveLength(expected);
    });

    it('按评分排序时用键盘给首行改分：行被挪出窗口，焦点仍在那颗星上，下一行也在', async () => {
      await renderControl();
      await openLibrary();
      const lib = libraryRoot();
      fireEvent.click(within(lib).getByTestId('signal-sort-评分'));   // 评分 高→低
      const [target] = sortSignalsBy(SIGNALS, 'quality', 'desc');
      expect(target.quality).toBe(5);
      const star = screen.getByTestId(`signal-quality-${target.id}-1`);
      act(() => { star.focus(); });
      // 键盘空格 / 回车在按钮上派发的就是 click
      fireEvent.click(star);

      const after = sortSignalsBy(
        SIGNALS.map(s => (s.id === target.id ? { ...s, quality: 1 } : s)),
        'quality',
        'desc',
      );
      const moved = after.findIndex(s => s.id === target.id);
      expect(moved).toBeGreaterThan(TOP_RENDERED);
      // 同一个节点仍在文档里、仍是焦点（改造前 React 会在重排后把焦点还给它）
      expect(star.isConnected).toBe(true);
      expect(document.activeElement).toBe(star);
      expect(star).toHaveAttribute('aria-checked', 'true');
      // DOM 顺序与新顺序一致；Tab / Shift+Tab 的落点（上下邻行）都在
      const ids = renderedIds();
      const at = ids.indexOf(target.id);
      expect(ids.slice(at - 1, at + 2)).toEqual(after.slice(moved - 1, moved + 2).map(s => s.id));
      const order = ids.map(id => after.findIndex(s => s.id === id));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      const saved = JSON.parse(localStorage.getItem(SIGNAL_LIBRARY_STORAGE_KEY) ?? '[]');
      expect(saved.find((x: TradeSignal) => x.id === target.id).quality).toBe(1);
    });
  });
});
