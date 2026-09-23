// @vitest-environment jsdom
/**
 * 信号库列表的窗口化与行级 memo。
 *
 * 保的是这几件事：
 *   ① 791 条信号只铺出「可视区 + 上下各 6 行」（外加首末两行），而滚动条的长度与位置仍然对应 791 行；
 *   ② 邻行变了，这一行不重渲染；窗口没变，列表本身也不重渲染；
 *   ③ 键盘用户的体验与改造前一致：焦点所在的行不因滚出窗口而被卸掉，Tab 进出列表落在同一行；
 *   ④ 行距是从 DOM 上量出来的：根字号不是 16px、页面缩放时，滚动条照样对得上。
 * ① 是「点表头很卡」的直接病根，② 决定了改一条评分要不要连累其余 790 条。
 */
import { createElement, type ComponentProps, type ReactElement } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as listModule from '../SignalLibraryList';
import {
  SignalLibraryList,
  SIGNAL_LIST_VIEWPORT_HEIGHT,
  SIGNAL_ROW_HEIGHT,
  SIGNAL_ROW_OVERSCAN,
  computeSignalRowWindow,
  signalListHeight,
  signalRowOffset,
} from '../SignalLibraryList';
import { makeBulkSignals, BULK_SIGNAL_COUNT } from '@/test/fixtures/signalLibraryBulk';
import { buildCampaignDayIndex, buildTradedDayIndex } from '@/lib/signalCampaignIndex';
import type { TradeSignal } from '@/lib/signalLibrary';

// 每行一组星，拿它当「这一行重渲染了没有」的探针。
const rowRenders = vi.hoisted(() => ({ byId: new Map<string, number>(), total: 0 }));
vi.mock('@/components/SignalQualityStars', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const Inner = actual.SignalQualityStars as (props: Record<string, unknown>) => ReactElement;
  return {
    ...actual,
    SignalQualityStars: (props: Record<string, unknown>) => {
      const id = String(props.signalId);
      rowRenders.byId.set(id, (rowRenders.byId.get(id) ?? 0) + 1);
      rowRenders.total += 1;
      return createElement(Inner, props);
    },
  };
});
// 每画一颗星记一次：行重渲染时，行传给评分组件的回调若换了身份，五颗星就会跟着重画。
const starRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('lucide-react', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const RealStar = actual.Star as Parameters<typeof createElement>[0];
  return {
    ...actual,
    Star: (props: Record<string, unknown>) => {
      starRenders.count += 1;
      return createElement(RealStar, props);
    },
  };
});
// 列表每跑一遍函数体，就对窗口里的每一行各查一次「当日交易过没有」——
// 拿它当「列表本身重渲染了没有」的探针：行是 memo 的，行渲染次数看不出列表有没有白跑。
const listPasses = vi.hoisted(() => ({ rows: 0 }));
vi.mock('@/lib/signalCampaignIndex', async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  const real = actual.hasTradeOnSignalDay as (...args: unknown[]) => boolean;
  return {
    ...actual,
    hasTradeOnSignalDay: (...args: unknown[]) => { listPasses.rows += 1; return real(...args); },
  };
});

const SIGNALS = makeBulkSignals();
const LAST = BULK_SIGNAL_COUNT - 1;
const EMPTY_INDEX = new Set<string>();

/** 可视区能完整放下几行：224 = 24 + 8×25，正好 9 行。 */
const VISIBLE_ROWS = 9;
/** 停在顶部时的窗口：可视区 + 下方 overscan（上方没有行可 overscan）。 */
const TOP_WINDOW = VISIBLE_ROWS + SIGNAL_ROW_OVERSCAN;
/** 停在顶部时实际在 DOM 里的行：窗口 + 始终留着的末行。 */
const TOP_RENDERED = TOP_WINDOW + 1;

interface Handles {
  onJump: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onRate: ReturnType<typeof vi.fn>;
}

type ListProps = ComponentProps<typeof SignalLibraryList>;

function renderList(overrides: Partial<{
  rows: TradeSignal[];
  tradedDayIndex: Set<string>;
  campaignDayIndex: Set<string>;
  jumpingSignalId: string | null;
  resetKey: string;
}> = {}, handles?: Handles, withOutsideButton = false) {
  const h = handles ?? { onJump: vi.fn(), onDelete: vi.fn(), onRate: vi.fn() };
  const props = {
    rows: SIGNALS,
    tradedDayIndex: EMPTY_INDEX,
    campaignDayIndex: EMPTY_INDEX,
    jumpingSignalId: null,
    resetKey: 'symbol|asc||',
    ...overrides,
    ...h,
  } as ListProps;
  const ui = (p: ListProps) => (withOutsideButton
    ? <div><SignalLibraryList {...p} /><button type="button">列表外</button></div>
    : <SignalLibraryList {...p} />);
  const view = render(ui(props));
  return { ...view, props, handles: h, rerenderWith: (p: ListProps) => view.rerender(ui(p)) };
}

/** 焦点钉行这几条要反复滚动、查 DOM，满载时容易越过默认的 5 秒。 */
const FOCUS_TEST_TIMEOUT = 20_000;

const scroller = () => screen.getByTestId('signal-library-scroller');
const renderedSymbols = () =>
  within(scroller()).getAllByText(/USDT$/).map(node => node.textContent);
const renderedRowCount = () => within(scroller()).getAllByTitle('删除该信号').length;
/** DOM 里按顺序排着的行，各是哪条信号。 */
const renderedIds = () => Array.from(scroller().children)
  .map(child => child.querySelector('[role="radiogroup"]')?.getAttribute('data-testid'))
  .filter((testId): testId is string => Boolean(testId))
  .map(testId => testId.slice('signal-quality-'.length));
const rowElement = (id: string) =>
  screen.getByTestId(`signal-quality-${id}`).closest('.group') as HTMLElement;

/** [start, end) 的窗口，外加若干零散行，去重后升序。 */
function indicesOf(start: number, end: number, ...extra: number[]) {
  const set = new Set<number>(extra.filter(i => i >= 0 && i <= LAST));
  for (let i = start; i < end; i += 1) set.add(i);
  return [...set].sort((a, b) => a - b);
}
const idsAt = (rows: TradeSignal[], indices: number[]) => indices.map(i => rows[i].id);

/**
 * 按真实浏览器的排版规则把子节点从上往下铺一遍，核对两件事：
 * 每一行落在它下标对应的位置上；全部铺完正好是 count 行的总高度。
 * 规则：首个子节点没有 divide-y 的上边线；垫片是 border-box，内联高度已含边线。
 */
function expectLayoutConsistent(rows: TradeSignal[], pitch = SIGNAL_ROW_HEIGHT, border = 1) {
  const el = scroller();
  const kids = Array.from(el.children) as HTMLElement[];
  const metrics = { pitch, border };
  let y = 0;
  let previousWasSpacer = false;
  kids.forEach((kid, k) => {
    const testId = kid.querySelector('[role="radiogroup"]')?.getAttribute('data-testid');
    if (testId) {
      const index = rows.findIndex(r => r.id === testId.slice('signal-quality-'.length));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(y).toBeCloseTo(signalRowOffset(index, metrics), 3);
      y += k === 0 ? pitch - border : pitch;
      previousWasSpacer = false;
    } else {
      // 垫片：不能是首个子节点（首行必须没有上边线），不能为空，也不能两个挨着
      expect(k).toBeGreaterThan(0);
      expect(previousWasSpacer).toBe(false);
      const height = Number.parseFloat(kid.style.height);
      expect(height).toBeGreaterThan(0);
      y += height;
      previousWasSpacer = true;
    }
  });
  expect(y).toBeCloseTo(signalListHeight(rows.length, metrics), 3);
}

/**
 * jsdom 不做布局：clientHeight 恒为 0、scrollTop 写不进去。
 * 把这两个属性换成真实浏览器里的读数（max-h-56 = 224px），窗口计算才有东西可算。
 */
function stubLayout(el: HTMLElement, viewport = SIGNAL_LIST_VIEWPORT_HEIGHT) {
  let top = 0;
  let height = viewport;
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (next: number) => { top = next; },
  });
  return { setViewport: (next: number) => { height = next; } };
}

/**
 * 更进一步：给列表里的每个子节点一个真实的位置（offsetTop / getBoundingClientRect），
 * 模拟行内容高 content、分隔线 border 的排版。rectScale ≠ 1 模拟祖先带 transform 缩放——
 * 那时 getBoundingClientRect 缩了、offsetTop 没缩。
 */
function stubRowGeometry(
  el: HTMLElement,
  { content, border, viewport, rectScale = 1 }: {
    content: number; border: number; viewport: number; rectScale?: number;
  },
) {
  stubLayout(el, viewport);
  const heightOf = (kid: Element, first: boolean) => (kid.childElementCount === 0
    ? Number.parseFloat((kid as HTMLElement).style.height)
    : content + (first ? 0 : border));
  const topOf = (node: Element) => {
    let y = 0;
    for (const kid of Array.from(el.children)) {
      if (kid === node) return y;
      y += heightOf(kid, kid === el.firstElementChild);
    }
    return 0;
  };
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
    return this.parentElement === el ? Math.round(topOf(this)) : 0;
  });
  // 这版 jsdom 没有 DOMRect 构造器，拼一个同形的对象。
  const rect = (x: number, y: number, width: number, height: number) => ({
    x, y, width, height, top: y, left: x, right: x + width, bottom: y + height, toJSON: () => ({}),
  }) as DOMRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.parentElement !== el) return rect(0, 0, 0, 0);
    const y = (topOf(this) - el.scrollTop) * rectScale + 40;
    return rect(0, y, 500 * rectScale, heightOf(this, this === el.firstElementChild) * rectScale);
  });
}

async function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  await act(async () => { fireEvent.scroll(el); });
}

beforeEach(() => {
  rowRenders.byId.clear();
  rowRenders.total = 0;
  listPasses.rows = 0;
  // rAF 默认同步执行，窗口当场算完；合帧本身在「rAF 合帧」那条里单独断言。
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('信号库列表的窗口化', () => {
  it('791 条只渲染窗口内的行（外加末行），且是正确的那一段', () => {
    renderList();
    expect(SIGNALS).toHaveLength(BULK_SIGNAL_COUNT);
    expect(renderedRowCount()).toBe(TOP_RENDERED);
    expect(renderedIds()).toEqual(idsAt(SIGNALS, indicesOf(0, TOP_WINDOW, LAST)));
    expect(renderedSymbols().slice(0, TOP_WINDOW)).toEqual(SIGNALS.slice(0, TOP_WINDOW).map(s => s.symbol));
    // 行渲染次数 = DOM 里的行数，不是 791
    expect(rowRenders.total).toBe(TOP_RENDERED);
  });

  it('滚动条长度对应 791 行：垫片补齐窗口之外的高度', () => {
    renderList();
    const total = signalListHeight(BULK_SIGNAL_COUNT);
    expect(total).toBe(24 + (BULK_SIGNAL_COUNT - 1) * SIGNAL_ROW_HEIGHT);
    // 停在顶部：首行就是首个子节点（前面没有垫片，否则它会被 divide-y 平白加一条上边线，和表头叠成双线）
    expect(renderedIds()[0]).toBe(SIGNALS[0].id);
    expect(scroller().firstElementChild?.querySelector('[role="radiogroup"]')).not.toBeNull();
    expectLayoutConsistent(SIGNALS);
  });

  it('滚到底看得到最后一条，且每一行的位置与滚动位置对得上', async () => {
    renderList();
    const el = scroller();
    stubLayout(el);
    const maxScrollTop = signalListHeight(BULK_SIGNAL_COUNT) - SIGNAL_LIST_VIEWPORT_HEIGHT;
    await scrollTo(el, maxScrollTop);

    const symbols = renderedSymbols();
    expect(symbols[symbols.length - 1]).toBe(SIGNALS[LAST].symbol);
    // 底部同样只有一侧能 overscan；首行始终留着
    expect(renderedIds()).toEqual(idsAt(SIGNALS, indicesOf(BULK_SIGNAL_COUNT - TOP_WINDOW, BULK_SIGNAL_COUNT, 0)));
    expectLayoutConsistent(SIGNALS);
  });

  it('滚到中段：窗口是可视区上下各 6 行，首末两行另外留着', async () => {
    renderList();
    const el = scroller();
    stubLayout(el);
    await scrollTo(el, 5000);
    // 5000px 处第一整行是第 200 行
    const first = Math.floor((5000 + 1) / SIGNAL_ROW_HEIGHT);
    const start = first - SIGNAL_ROW_OVERSCAN;
    const end = first + VISIBLE_ROWS + SIGNAL_ROW_OVERSCAN;
    expect(renderedIds()).toEqual(idsAt(SIGNALS, indicesOf(start, end, 0, LAST)));
    expect(renderedRowCount()).toBe(VISIBLE_ROWS + SIGNAL_ROW_OVERSCAN * 2 + 2);
    expectLayoutConsistent(SIGNALS);
  });

  it('窗口没变，列表本身也不重渲染——哪怕上一帧刚翻过页', async () => {
    renderList();
    const el = scroller();
    stubLayout(el);
    // 窗口的两条边各自只在 25px 的整数倍附近翻页：上边界落在 …24、49、74…，
    // 下边界（scrollTop + 224）落在 25 的整数倍上。5001~5023 之间两条边都不翻页。
    await scrollTo(el, 5001);          // 从顶部翻到中段：真的换了窗口
    expect(listPasses.rows).toBeGreaterThan(0);
    listPasses.rows = 0;
    rowRenders.total = 0;
    // 紧接着的几帧窗口都没变：不许再 setState，列表函数体一次都不该跑
    for (const top of [5005, 5010, 5023]) await scrollTo(el, top);
    expect(listPasses.rows).toBe(0);
    expect(rowRenders.total).toBe(0);

    await scrollTo(el, 5030);   // 下边界越过 5025，窗口下移一行
    expect(listPasses.rows).toBeGreaterThan(0);
    expect(rowRenders.total).toBe(1);   // 只有新露出来的那一行
    listPasses.rows = 0;
    await scrollTo(el, 5031);
    expect(listPasses.rows).toBe(0);
  });

  it('换排序 / 筛选口径把滚动条拨回顶部，而且只按新顺序铺一遍', async () => {
    const { rerenderWith, props } = renderList();
    const el = scroller();
    stubLayout(el);
    await scrollTo(el, 5000);
    expect(renderedSymbols()[1]).not.toBe(SIGNALS[1].symbol);
    listPasses.rows = 0;

    // 行没换，只是口径换了（比如同一批行按另一个键重排）——照样回到顶部
    const reordered = [...SIGNALS].reverse();
    rerenderWith({ ...props, rows: reordered, resetKey: 'time|desc||' });
    expect(el.scrollTop).toBe(0);
    expect(renderedIds()).toEqual(idsAt(reordered, indicesOf(0, TOP_WINDOW, LAST)));
    expectLayoutConsistent(reordered);
    // 列表只跑了一遍，而且就是顶部那一段：没有先在旧位置按新顺序铺一遍、再回顶部重铺
    expect(listPasses.rows).toBe(TOP_RENDERED);
  });

  it('打分 / 删除不把人弹回顶部——resetKey 没变就不动滚动位置', async () => {
    const { rerenderWith, props } = renderList();
    const el = scroller();
    stubLayout(el);
    await scrollTo(el, 5000);
    const before = renderedSymbols();

    const rated = SIGNALS.map((s, i) => (i === 300 ? { ...s, quality: 5 } : s));
    rerenderWith({ ...props, rows: rated });
    expect(el.scrollTop).toBe(5000);
    expect(renderedSymbols()).toEqual(before);
  });

  describe('【复核遗留】同一口径下行变了：首个可见行钉在原位', () => {
    // 5000px 处第一整行是第 200 行，行内零头 = 5000 − (200×25 − 1) = 1px
    const FIRST = 200;
    const within = 5000 - signalRowOffset(FIRST);
    const newSignals = (n: number) => SIGNALS.slice(0, n).map((s, i) => ({ ...s, id: `imported-${i}` }));

    it('导入 20 条排在可见区上方的新信号：仍停在原来那一行，行内零头不变', async () => {
      const { rerenderWith, props } = renderList();
      const el = scroller();
      stubLayout(el);
      await scrollTo(el, 5000);
      const imported = [...newSignals(20), ...SIGNALS];
      rerenderWith({ ...props, rows: imported });
      expect(el.scrollTop).toBe(signalRowOffset(FIRST + 20) + within);
      // 窗口按补回的滚动位置取：原来第 200 行（现在第 220 行）仍是首个可见行
      const start = FIRST + 20 - SIGNAL_ROW_OVERSCAN;
      // indicesOf 只认原 791 行以内的附加下标：导入后的末行（第 810 行）另外补上
      expect(renderedIds()).toEqual([
        ...idsAt(imported, indicesOf(start, start + VISIBLE_ROWS + SIGNAL_ROW_OVERSCAN * 2, 0)),
        imported[imported.length - 1].id,
      ]);
      expectLayoutConsistent(imported);
    });

    it('删掉上方一行：滚动位置跟着上移一行', async () => {
      const { rerenderWith, props } = renderList();
      const el = scroller();
      stubLayout(el);
      await scrollTo(el, 5000);
      const firstId = SIGNALS[FIRST].id;
      rerenderWith({ ...props, rows: SIGNALS.filter((_, i) => i !== 10) });
      expect(el.scrollTop).toBe(signalRowOffset(FIRST - 1) + within);
      expect(renderedIds()).toContain(firstId);
    });

    it('停在顶部时不锚：新导入的信号就出现在最上面', () => {
      const { rerenderWith, props } = renderList();
      const el = scroller();
      stubLayout(el);
      const imported = [...newSignals(5), ...SIGNALS];
      rerenderWith({ ...props, rows: imported });
      expect(el.scrollTop).toBe(0);
      expect(renderedIds()[0]).toBe('imported-0');
    });

    it('钉住的那一行被删掉了：不锚，滚动位置不动', async () => {
      const { rerenderWith, props } = renderList();
      const el = scroller();
      stubLayout(el);
      await scrollTo(el, 5000);
      rerenderWith({ ...props, rows: SIGNALS.filter((_, i) => i !== FIRST) });
      expect(el.scrollTop).toBe(5000);
    });

    it('浏览器自带的滚动锚定关掉，只留这一套', () => {
      renderList();
      expect(scroller().className).toContain('[overflow-anchor:none]');
    });
  });

  it('量不到容器高度时退回 224px 的名义窗口，而不是什么都不渲染', () => {
    // 这一条就是 jsdom 的处境（clientHeight 恒为 0），也是真浏览器首帧的处境
    renderList();
    expect(scroller().clientHeight).toBe(0);
    expect(renderedRowCount()).toBe(TOP_RENDERED);
  });

  it('滚动监听是被动的', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'addEventListener');
    renderList();
    // React 自己也在根节点上挂了一个捕获阶段的 scroll 监听，挑出带选项对象的那个。
    const options = spy.mock.calls.filter(c => c[0] === 'scroll').map(c => c[2]);
    expect(options).toContainEqual({ passive: true });
  });

  it('行数缩到窗口以内时全部渲染，且没有垫片', () => {
    renderList({ rows: SIGNALS.slice(0, 4) });
    expect(renderedRowCount()).toBe(4);
    expect(scroller().children).toHaveLength(4);
  });

  it('rAF 合帧：一帧里的多次 scroll 只算一次窗口；卸载时取消还没跑的那一帧', async () => {
    const frames: FrameRequestCallback[] = [];
    let frameSeq = 0;
    // 帧 id 按排期次数递增（与浏览器一致），不能拿队列长度充当——跑掉一帧之后长度会回落。
    const request = vi.fn((cb: FrameRequestCallback) => { frames.push(cb); frameSeq += 1; return frameSeq; });
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);

    const { unmount } = renderList();
    const el = scroller();
    stubLayout(el);
    listPasses.rows = 0;
    for (const top of [1000, 3000, 5000]) {
      el.scrollTop = top;
      fireEvent.scroll(el);
    }
    // 三次 scroll 只排了一帧；帧还没跑，窗口没动
    expect(request).toHaveBeenCalledTimes(1);
    expect(listPasses.rows).toBe(0);
    expect(renderedIds()[1]).toBe(SIGNALS[1].id);

    // 帧跑起来：按最后的位置算一次
    await act(async () => { frames.shift()?.(0); });
    const first = Math.floor((5000 + 1) / SIGNAL_ROW_HEIGHT);
    expect(renderedIds()[1]).toBe(SIGNALS[first - SIGNAL_ROW_OVERSCAN].id);
    expect(listPasses.rows).toBe(VISIBLE_ROWS + SIGNAL_ROW_OVERSCAN * 2 + 2);

    // 帧跑完之后可以再排下一帧
    el.scrollTop = 6000;
    fireEvent.scroll(el);
    expect(request).toHaveBeenCalledTimes(2);
    unmount();
    expect(cancel).toHaveBeenCalledWith(2);
  });

  it('ResizeObserver：容器变高后窗口跟着变大；卸载时断开', () => {
    const observers: { cb: ResizeObserverCallback; observed: Element[]; disconnect: ReturnType<typeof vi.fn> }[] = [];
    class FakeResizeObserver {
      cb: ResizeObserverCallback;
      observed: Element[] = [];
      disconnect = vi.fn();
      constructor(cb: ResizeObserverCallback) { this.cb = cb; observers.push(this); }
      observe(target: Element) { this.observed.push(target); }
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);

    const { unmount } = renderList();
    const el = scroller();
    const layout = stubLayout(el);
    expect(observers).toHaveLength(1);
    expect(observers[0].observed).toEqual([el]);
    expect(renderedRowCount()).toBe(TOP_RENDERED);

    // 容器从 224px 变成 474px：可视区从 9 行变成 19 行
    layout.setViewport(474);
    act(() => { observers[0].cb([], observers[0] as unknown as ResizeObserver); });
    expect(renderedIds()).toEqual(idsAt(SIGNALS, indicesOf(0, 19 + SIGNAL_ROW_OVERSCAN, LAST)));

    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });
});

describe('键盘焦点：与改造前一致', () => {
  it('焦点所在的行滚出窗口后仍留在原位，焦点不丢；它上下各一行也留着，Tab / Shift+Tab 才落得到', async () => {
    renderList();
    const el = scroller();
    stubLayout(el);
    const button = within(rowElement(SIGNALS[3].id)).getByTitle('删除该信号');
    act(() => { button.focus(); });
    expect(document.activeElement).toBe(button);

    // 5000px：窗口在 194~215，焦点行（第 3 行）早已在窗口之外
    await scrollTo(el, 5000);
    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(renderedIds()).toEqual(idsAt(SIGNALS, indicesOf(194, 215, 0, 2, 3, 4, LAST)));
    expectLayoutConsistent(SIGNALS);

    // 一路滚到底也一样
    await scrollTo(el, signalListHeight(BULK_SIGNAL_COUNT) - SIGNAL_LIST_VIEWPORT_HEIGHT);
    expect(document.activeElement).toBe(button);
    expectLayoutConsistent(SIGNALS);
  }, FOCUS_TEST_TIMEOUT);

  it('焦点落在窗口下方的行（比如被重排挪到下面）也一样钉住', async () => {
    const { rerenderWith, props } = renderList();
    const button = within(rowElement(SIGNALS[1].id)).getByTestId(`signal-quality-${SIGNALS[1].id}-1`);
    act(() => { button.focus(); });

    // 同一口径下（resetKey 不变）这一行被挪到第 500 位——按评分排序时给它改个分就是这种情况
    const moved = [...SIGNALS];
    const [target] = moved.splice(1, 1);
    moved.splice(500, 0, target);
    rerenderWith({ ...props, rows: moved });

    expect(button.isConnected).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(renderedIds()).toEqual(idsAt(moved, indicesOf(0, TOP_WINDOW, 499, 500, 501, LAST)));
    expectLayoutConsistent(moved);
  }, FOCUS_TEST_TIMEOUT);

  it('焦点离开列表，钉住的行随即卸掉；在列表内换行，则由新行接替', async () => {
    renderList({}, undefined, true);
    const el = scroller();
    stubLayout(el);
    act(() => { within(rowElement(SIGNALS[3].id)).getByTitle('删除该信号').focus(); });
    await scrollTo(el, 5000);
    expect(renderedIds()).toContain(SIGNALS[3].id);

    // 焦点换到窗口里的第 200 行：第 2~4 行不必再留
    const inWindow = within(rowElement(SIGNALS[200].id)).getByTitle('删除该信号');
    act(() => { inWindow.focus(); });
    expect(document.activeElement).toBe(inWindow);
    expect(renderedIds()).toEqual(idsAt(SIGNALS, indicesOf(194, 215, 0, LAST)));

    // 滚回顶部再把焦点移出列表：第 199~201 行先被钉住，焦点一走就卸掉
    await scrollTo(el, 0);
    expect(renderedIds()).toEqual(idsAt(SIGNALS, indicesOf(0, TOP_WINDOW, 199, 200, 201, LAST)));
    act(() => { (screen.getByText('列表外') as HTMLButtonElement).focus(); });
    expect(renderedIds()).toEqual(idsAt(SIGNALS, indicesOf(0, TOP_WINDOW, LAST)));
  }, FOCUS_TEST_TIMEOUT);

  it('焦点只是暂时离开整个页面（activeElement 没变）时不卸行', async () => {
    renderList();
    const el = scroller();
    stubLayout(el);
    const button = within(rowElement(SIGNALS[3].id)).getByTitle('删除该信号');
    act(() => { button.focus(); });
    await scrollTo(el, 5000);
    // 切到别的窗口：浏览器派发 blur / focusout，但 activeElement 仍是这个按钮
    act(() => { fireEvent.focusOut(button, { relatedTarget: null }); });
    expect(renderedIds()).toContain(SIGNALS[3].id);
    expect(document.activeElement).toBe(button);
  }, FOCUS_TEST_TIMEOUT);

  it('首行和末行始终在 DOM 里：从列表外 Tab / Shift+Tab 进来，落在与改造前相同的行上', async () => {
    renderList();
    const el = scroller();
    stubLayout(el);
    await scrollTo(el, 9000);
    const ids = renderedIds();
    expect(ids[0]).toBe(SIGNALS[0].id);
    expect(ids[ids.length - 1]).toBe(SIGNALS[LAST].id);
    const buttons = el.querySelectorAll('button');
    expect(buttons[0]).toBe(within(rowElement(SIGNALS[0].id)).getAllByRole('button')[0]);
    expect(buttons[buttons.length - 1]).toBe(within(rowElement(SIGNALS[LAST].id)).getByTitle('删除该信号'));
  }, FOCUS_TEST_TIMEOUT);
});

describe('行距从 DOM 上量', () => {
  it('根字号 20px（行内容 30px + 1px 分隔线）：窗口与滚动条都按 31px 算', async () => {
    renderList();
    const el = scroller();
    // 先装好几何再触发一次测量：真浏览器里首帧的布局效果就是这个时机
    stubRowGeometry(el, { content: 30, border: 1, viewport: 280 });
    await scrollTo(el, 0);
    // 280px 的可视区放得下 ceil((280+1)/31) = 10 行
    expect(renderedIds()).toEqual(idsAt(SIGNALS, indicesOf(0, 10 + SIGNAL_ROW_OVERSCAN, LAST)));
    expectLayoutConsistent(SIGNALS, 31, 1);

    await scrollTo(el, 10000);
    const first = Math.floor((10000 + 1) / 31);
    expect(renderedIds()[1]).toBe(SIGNALS[first - SIGNAL_ROW_OVERSCAN].id);
    expectLayoutConsistent(SIGNALS, 31, 1);

    // 滚到底：最后一行正好贴着底边
    await scrollTo(el, 791 * 31 - 1 - 280);
    expect(renderedIds().slice(-2)).toEqual([SIGNALS[LAST - 1].id, SIGNALS[LAST].id]);
    expectLayoutConsistent(SIGNALS, 31, 1);
  });

  it('页面缩放让分隔线变成 0.91px：行距按量到的小数算，不按 25 取整', async () => {
    renderList();
    const el = scroller();
    const border = 10 / 11;
    stubRowGeometry(el, { content: 24, border, viewport: 224 });
    await scrollTo(el, 0);
    const pitch = 24 + border;
    const kids = Array.from(el.children) as HTMLElement[];
    const spacer = kids.find(kid => kid.childElementCount === 0) as HTMLElement;
    // 窗口末行之后到末行之前的缺口：按 24.91px 一行算
    const lastInWindow = renderedIds().length - 2;
    expect(Number.parseFloat(spacer.style.height)).toBeCloseTo((LAST - (lastInWindow + 1)) * pitch, 2);
  });

  it('祖先带 transform 缩放时不被 getBoundingClientRect 骗：按 offsetTop 还原出未缩放的行距', async () => {
    renderList();
    const el = scroller();
    stubRowGeometry(el, { content: 30, border: 1, viewport: 280, rectScale: 0.5 });
    await scrollTo(el, 0);
    expectLayoutConsistent(SIGNALS, 31, 1);
  });

  it('缩放比不是整数、行距又带小数（CSS zoom 1.1 + 0.91px 分隔线）：还原出的行距误差整表不到 1px', async () => {
    renderList();
    const el = scroller();
    const border = 10 / 11;
    stubRowGeometry(el, { content: 24, border, viewport: 224, rectScale: 1.1 });
    await scrollTo(el, 0);
    await scrollTo(el, 9000);
    const pitch = 24 + border;
    // 按量到的行距把子节点从上往下铺：末行的顶边与真实位置相差不到 1px
    const kids = Array.from(el.children) as HTMLElement[];
    const spacers = kids.filter(kid => kid.childElementCount === 0);
    const rowsBefore = kids.length - spacers.length - 1;
    const laidOut = (24 + (rowsBefore - 1) * pitch)
      + spacers.reduce((sum, kid) => sum + Number.parseFloat(kid.style.height), 0);
    expect(Math.abs(laidOut - (LAST * pitch - border))).toBeLessThan(1);
    // 窗口也按真实行距落在 9000px 处
    const first = Math.floor((9000 + border) / pitch);
    expect(renderedIds()[1]).toBe(SIGNALS[first - SIGNAL_ROW_OVERSCAN].id);
  });

  it('rect 量不出东西、offsetTop 有值时，用 offsetTop 的整数行距', async () => {
    renderList();
    const el = scroller();
    stubRowGeometry(el, { content: 30, border: 1, viewport: 280, rectScale: 0 });
    await scrollTo(el, 0);
    expectLayoutConsistent(SIGNALS, 31, 1);
  });

  it('量不到行距（布局还没出来、jsdom）时退回 25px', async () => {
    renderList();
    const el = scroller();
    stubLayout(el);
    await scrollTo(el, 5000);
    expectLayoutConsistent(SIGNALS, 25, 1);
  });
});

describe('computeSignalRowWindow 的算术', () => {
  it('224px 的可视区正好放得下 9 行', () => {
    expect(computeSignalRowWindow(0, SIGNAL_LIST_VIEWPORT_HEIGHT, 791, 0))
      .toEqual({ start: 0, end: VISIBLE_ROWS });
  });

  it('首行比其余行矮 1px（它没有上分隔线），窗口的分界要跟着偏', () => {
    expect(signalRowOffset(0)).toBe(0);
    expect(signalRowOffset(1)).toBe(24);
    expect(signalRowOffset(2)).toBe(49);
    // 停在第 1 行顶边上，第 1 行就该是首个可视行
    expect(computeSignalRowWindow(24, SIGNAL_LIST_VIEWPORT_HEIGHT, 791, 0).start).toBe(1);
    expect(computeSignalRowWindow(23, SIGNAL_LIST_VIEWPORT_HEIGHT, 791, 0).start).toBe(0);
  });

  it('行距不是 25 时按传入的行距算', () => {
    const metrics = { pitch: 31, border: 1 };
    expect(signalRowOffset(2, metrics)).toBe(61);
    expect(signalListHeight(791, metrics)).toBe(791 * 31 - 1);
    expect(computeSignalRowWindow(0, 280, 791, 0, metrics)).toEqual({ start: 0, end: 10 });
    expect(computeSignalRowWindow(30, 280, 791, 0, metrics).start).toBe(1);
    expect(computeSignalRowWindow(29, 280, 791, 0, metrics).start).toBe(0);
  });

  it('滚到最底时窗口一定含最后一行', () => {
    const total = signalListHeight(791);
    const win = computeSignalRowWindow(total - SIGNAL_LIST_VIEWPORT_HEIGHT, SIGNAL_LIST_VIEWPORT_HEIGHT, 791);
    expect(win.end).toBe(791);
  });

  it('空列表给出空窗口', () => {
    expect(computeSignalRowWindow(0, SIGNAL_LIST_VIEWPORT_HEIGHT, 0)).toEqual({ start: 0, end: 0 });
  });

  it('要渲染的行 = 窗口 ∪ 首末行 ∪ 焦点行及其上下邻行，升序、不重复', () => {
    const pick = listModule.signalRowIndicesToRender;
    expect(typeof pick).toBe('function');
    expect(pick({ start: 0, end: 4 }, 10, -1)).toEqual([0, 1, 2, 3, 9]);
    expect(pick({ start: 4, end: 6 }, 10, 2)).toEqual([0, 1, 2, 3, 4, 5, 9]);
    expect(pick({ start: 4, end: 6 }, 10, 8)).toEqual([0, 4, 5, 7, 8, 9]);
    expect(pick({ start: 0, end: 3 }, 3, 1)).toEqual([0, 1, 2]);
    expect(pick({ start: 0, end: 1 }, 1, 0)).toEqual([0]);
    expect(pick({ start: 0, end: 0 }, 0, -1)).toEqual([]);
  });
});

describe('行级 memo', () => {
  it('改一条信号的评分，只有那一行重渲染', () => {
    const { rerenderWith, props } = renderList();
    rowRenders.byId.clear();
    rowRenders.total = 0;

    const target = SIGNALS[3];
    const next = SIGNALS.map(s => (s.id === target.id ? { ...s, quality: 5 } : s));
    rerenderWith({ ...props, rows: next });

    expect(rowRenders.total).toBe(1);
    expect(rowRenders.byId.get(target.id)).toBe(1);
  });

  it('行因跳转状态重渲染时，五颗星不跟着重画：行传给评分组件的回调身份恒定', () => {
    const { rerenderWith, props } = renderList();
    rowRenders.total = 0;
    starRenders.count = 0;
    // 开始跳转：每一行的跳转按钮都要变成禁用，所以窗口里的行都会重渲染……
    rerenderWith({ ...props, jumpingSignalId: SIGNALS[2].id });
    expect(rowRenders.total).toBeGreaterThan(0);
    // ……但评分值没变、回调身份没变，评分组件的 memo 应当拦住，一颗星都不重画
    expect(starRenders.count).toBe(0);
  });

  it('props 原样不动地再渲染一次，列表与行都不重渲染', () => {
    const { rerenderWith, props } = renderList();
    rowRenders.total = 0;
    listPasses.rows = 0;
    rerenderWith({ ...props });
    expect(rowRenders.total).toBe(0);
    expect(listPasses.rows).toBe(0);
  });
});

describe('行内标注与回调', () => {
  it('勾号、战役圆点、不可跳转徽标各自只出现在该出现的行上', () => {
    const rows = SIGNALS.slice(0, TOP_WINDOW);
    // 第 0 行当日交易过；第 1 行当日有战役
    const traded = buildTradedDayIndex(
      [{ symbol: rows[0].symbol, action: 'CLOSE', openTime: rows[0].timeMs }] as never,
      {},
    );
    const campaigns = buildCampaignDayIndex(
      [{ symbol: rows[1].symbol, opened_at: new Date(rows[1].timeMs).toISOString() }] as never,
    );
    renderList({ rows, tradedDayIndex: traded, campaignDayIndex: campaigns });

    const lib = scroller();
    const checks = within(lib).getAllByLabelText('信号当日已交易');
    expect(checks).toHaveLength(1);
    expect(checks[0].closest('span')).toHaveTextContent(rows[0].symbol);

    const dots = within(lib).getAllByTestId('signal-day-campaign');
    expect(dots).toHaveLength(1);
    expect(rowElement(rows[1].id)).toContainElement(dots[0]);

    // 夹具里每 11 条一个不可跳转标记：前 15 行里是第 0 和第 11 条
    const badges = within(lib).getAllByTestId('signal-jump-issue');
    expect(badges).toHaveLength(rows.filter(s => s.jumpIssue).length);
    expect(rowElement(rows[0].id)).toContainElement(badges[0]);
    expect(rowElement(rows[11].id)).toContainElement(badges[1]);
    expect(badges[0].className).toContain('text-muted-foreground');
  });

  it('跳转 / 删除 / 打分都带着自己那一行的 id 回去', () => {
    const { handles } = renderList();
    // 取一条没有不可跳转标记的：有标记时行按钮的 title 换成了问题原因
    const sig = SIGNALS[1];
    const row = rowElement(sig.id);

    fireEvent.click(within(row).getByTitle('删除该信号'));
    expect(handles.onDelete).toHaveBeenCalledWith(sig.id);

    fireEvent.click(within(row).getByTitle('跳转盘面'));
    expect(handles.onJump).toHaveBeenCalledWith(sig.id);

    fireEvent.click(within(row).getByTestId(`signal-quality-${sig.id}-4`));
    expect(handles.onRate).toHaveBeenCalledWith(sig.id, 4);
    // 点星星不连带跳转
    expect(handles.onJump).toHaveBeenCalledTimes(1);
  });

  it('有一行在跳转时，所有行的按钮都禁用，转圈只出现在那一行', () => {
    const target = SIGNALS[2];
    renderList({ jumpingSignalId: target.id });
    const lib = scroller();
    // 每行两个跳转入口（整行 + 右侧箭头）都该禁用
    expect(lib.querySelectorAll('button[disabled]')).toHaveLength(TOP_RENDERED * 2);
    // 删除键不在禁用之列
    for (const btn of within(lib).getAllByTitle('删除该信号')) expect(btn).not.toBeDisabled();
    // 转圈只在正在跳的那一行
    expect(lib.querySelectorAll('.animate-spin')).toHaveLength(1);
    expect(rowElement(target.id).querySelector('.animate-spin')).not.toBeNull();
  });
});
