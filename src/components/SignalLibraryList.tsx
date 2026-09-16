/**
 * 信号库列表（虚拟滚动 + 行级 memo）
 * ------------------------------------------------------------------
 * 从 TimeControl 里拆出来的一块，只干一件事：把已经排好序、筛好的信号渲染成行。
 *
 * 拆出来是为了两件此前做不到的事：
 *   ① **不跟着时钟走**。TimeControl 每跳一格模拟时间就重渲染一次（时钟、倍速、状态都在它身上），
 *      而列表和这些东西毫无关系。整块 memo 之后，回放期间列表一次也不重渲染——
 *      改造前实测每跳一格要重渲染 791 行、约 450ms，全部花在协调上（DOM 只改 4 个节点）。
 *   ② **只渲染看得见的那些行**。791 条信号铺开是 2.8 万个 DOM 节点、5700 个 SVG；
 *      点一次表头换排序要把它们全部重渲染一遍。窗口化之后只剩「可视区 + 上下各 6 行」。
 *
 * 窗口之外还额外留几行，为的是**键盘操作与改造前一致**：
 *   · 首行与末行始终在 DOM 里——从列表外 Tab / Shift+Tab 进来，落点与铺满全表时相同；
 *   · 焦点所在的行（及其上下各一行）滚出窗口也不卸载——卸掉它焦点就掉回 <body>，
 *     PageDown / 方向键随即不再滚这个列表，Tab 也会从头开始；上下邻行在，Tab / Shift+Tab 才有落点。
 * 这些行都铺在各自真实的位置上，中间的缺口由垫片补齐。
 *
 * 行距：默认 25px（行内容盒 24px = h-5 + py-0.5，`divide-y` 给除首行外的每一行加 1px 上边线，
 * 首行 24px；容器 `max-h-56` = 224px = 24 + 8×25，正好 9 行）。但行高是 rem 算出来的，
 * 根字号不是 16px 时行距就不是 25；页面缩放时分隔线又会被吸附到设备像素上（0.91px 之类）。
 * 所以真正用的行距**每次测量都从 DOM 上量**，只有量不到（首帧之前、jsdom）才退回 25。
 * 注意：用 `offsetTop[1] - offsetTop[0]` 算行距会得到 24 而不是 25——首行没有分隔线。
 */
import {
  memo, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type FocusEvent, type ReactNode,
} from 'react';
import { X, ArrowRightCircle, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

import type { TradeSignal } from '@/lib/signalLibrary';
import { normalizeSignalQuality } from '@/lib/signalLibrary';
import { SignalQualityStars } from '@/components/SignalQualityStars';
import { signalJumpIssueLabel, type SignalJumpIssue } from '@/lib/signalJumpDiagnostics';
import { hasCampaignOnSignalDay, hasTradeOnSignalDay } from '@/lib/signalCampaignIndex';

/** 默认行距：24px 内容 + 1px 分隔线。量不到真实行距时用它。 */
export const SIGNAL_ROW_HEIGHT = 25;
/** `max-h-56` = 14rem。量不到容器高度时（首帧、jsdom）退回这个值，而不是什么都不渲染。 */
export const SIGNAL_LIST_VIEWPORT_HEIGHT = 224;
/** 可视区上下各多渲染几行，滚动时才不会露出空白。 */
export const SIGNAL_ROW_OVERSCAN = 6;

/** 行距与分隔线粗细（px，可带小数）。行距 = 行内容高 + 分隔线；首行没有分隔线。 */
export interface SignalRowMetrics {
  pitch: number;
  border: number;
}

export const DEFAULT_SIGNAL_ROW_METRICS: SignalRowMetrics = { pitch: SIGNAL_ROW_HEIGHT, border: 1 };

/** 小数行距反复量出来会有 1e-12 级的抖动；差不到这个数就当没变，免得每帧都 setState。 */
const METRIC_EPSILON = 1e-3;
/** 行距是小数时，除出来的行号要容忍浮点误差，否则正好压线的那一行会被算到隔壁去。 */
const INDEX_EPSILON = 1e-6;

/**
 * 第 index 行的顶边（px）。首行没有上分隔线，所以不是整齐的 index×行距，
 * 而是比它少一条分隔线；这一条的错位一次性发生在第 0 行与第 1 行之间，之后不再累积。
 */
export function signalRowOffset(
  index: number,
  metrics: SignalRowMetrics = DEFAULT_SIGNAL_ROW_METRICS,
): number {
  return index <= 0 ? 0 : index * metrics.pitch - metrics.border;
}

/** count 行铺满的总高度 = 首行内容 + (count-1)×行距。 */
export function signalListHeight(
  count: number,
  metrics: SignalRowMetrics = DEFAULT_SIGNAL_ROW_METRICS,
): number {
  return count <= 0 ? 0 : signalRowOffset(count, metrics);
}

export interface SignalRowWindow {
  /** 起始行下标（含）。 */
  start: number;
  /** 结束行下标（**不含**）。 */
  end: number;
}

/**
 * 由滚动位置算出要渲染哪一段。
 * 可视区 = 满足 `offset(i) < scrollTop + 视口高` 且 `offset(i+1) > scrollTop` 的那些行，
 * 再上下各放宽 overscan 行。
 */
export function computeSignalRowWindow(
  scrollTop: number,
  viewportHeight: number,
  count: number,
  overscan: number = SIGNAL_ROW_OVERSCAN,
  metrics: SignalRowMetrics = DEFAULT_SIGNAL_ROW_METRICS,
): SignalRowWindow {
  if (count <= 0) return { start: 0, end: 0 };
  const { pitch, border } = metrics;
  const top = Math.max(0, scrollTop);
  const height = viewportHeight > 0 ? viewportHeight : SIGNAL_LIST_VIEWPORT_HEIGHT;
  const first = Math.max(0, Math.min(count - 1, Math.floor((top + border) / pitch + INDEX_EPSILON)));
  const last = Math.max(
    first,
    Math.min(count - 1, Math.ceil((top + height + border) / pitch - INDEX_EPSILON) - 1),
  );
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, last + 1 + overscan),
  };
}

/**
 * 实际要铺进 DOM 的行下标：窗口 ∪ 首末两行 ∪ 焦点行及其上下邻行，升序、不重复。
 * focusedIndex < 0 表示焦点不在列表里。
 */
export function signalRowIndicesToRender(
  range: SignalRowWindow,
  count: number,
  focusedIndex: number,
): number[] {
  if (count <= 0) return [];
  const start = Math.max(0, range.start);
  const end = Math.min(count, range.end);
  const extras = [0, count - 1];
  if (focusedIndex >= 0 && focusedIndex < count) {
    extras.push(focusedIndex - 1, focusedIndex, focusedIndex + 1);
  }
  const outside = extras
    .filter(i => i >= 0 && i < count && (i < start || i >= end))
    .sort((a, b) => a - b);
  const out: number[] = [];
  const push = (i: number) => { if (out.length === 0 || out[out.length - 1] < i) out.push(i); };
  let e = 0;
  for (let i = start; i < end; i += 1) {
    while (e < outside.length && outside[e] < i) push(outside[e++]);
    push(i);
  }
  while (e < outside.length) push(outside[e++]);
  return out;
}

const isSpacer = (node: Element) => node.childElementCount === 0;

/**
 * 从已经铺好的 DOM 上量行距。量不到（还没布局、行太少）返回 null，由调用方沿用旧值。
 *
 * 首个子节点必是第 0 行（它始终渲染、且没有分隔线），第二个子节点的顶边就是第 0 行的底边——
 * 不论那是第 1 行还是垫片；任意一行（非首个）顶边到它下一个兄弟的顶边，就是一个完整行距。
 *
 * 用 getBoundingClientRect 量：它带小数，页面缩放后 0.91px 的分隔线也量得准。
 * 但祖先带 transform / CSS zoom 时 rect 是缩放过的，而 scrollTop 与内联高度用的是未缩放的尺寸——
 * 这时拿首末两个子节点之间的距离对一下 offsetTop（不受缩放影响，但取整）：
 * 对得上（差 ≤ 1px，只是取整误差）就原样用；对不上就用两者之比还原出未缩放的行距。
 * 首末两个子节点之间隔着几乎整张表的高度，这个比值因此精确到万分之一以内。
 * rect 量不到（全是 0）时退回 offsetTop 本身的整数行距。
 */
export function measureSignalRowMetrics(el: HTMLElement): SignalRowMetrics | null {
  const first = el.firstElementChild as HTMLElement | null;
  const second = first?.nextElementSibling as HTMLElement | null | undefined;
  const last = el.lastElementChild as HTMLElement | null;
  if (!first || !second || !last) return null;
  let probe = second as HTMLElement | null;
  while (probe && (isSpacer(probe) || !probe.nextElementSibling)) {
    probe = probe.nextElementSibling as HTMLElement | null;
  }
  if (!probe) return null;
  const after = probe.nextElementSibling as HTMLElement;

  const offsetSpan = last.offsetTop - first.offsetTop;
  if (!(offsetSpan > 0)) return null;

  const rectTop = (node: Element) => node.getBoundingClientRect().top;
  const rectSpan = rectTop(last) - rectTop(first);
  let pitch: number;
  let content: number;
  if (rectSpan > 0) {
    const scale = Math.abs(rectSpan - offsetSpan) <= 1 ? 1 : rectSpan / offsetSpan;
    pitch = (rectTop(after) - rectTop(probe)) / scale;
    content = (rectTop(second) - rectTop(first)) / scale;
  } else {
    pitch = after.offsetTop - probe.offsetTop;
    content = second.offsetTop - first.offsetTop;
  }
  const border = pitch - content;
  if (!(pitch > 0) || !(content > 0) || border < 0) return null;
  return { pitch, border };
}

interface RowProps {
  id: string;
  symbol: string;
  timeLabel: string;
  fallbackZone: string;
  /** 已归一化的评分；undefined = 未评分。 */
  quality: number | undefined;
  jumpIssue: SignalJumpIssue | undefined;
  /** 信号当日该标的动过手没有。 */
  traded: boolean;
  /** 信号当日该标的有没有开过战役。 */
  hasDayCampaign: boolean;
  /** 正在跳转的是不是这一行。 */
  jumping: boolean;
  /** 任意一行正在跳转时，所有行的按钮都禁用。 */
  disabled: boolean;
  onJump: (id: string) => void;
  onDelete: (id: string) => void;
  onRate: (id: string, next: number) => void;
  /** 行内任一控件拿到焦点时报上自己的 id，列表据此把这一行钉在 DOM 里。 */
  onFocusRow: (id: string) => void;
}

/**
 * 单行。props 全是原始值 + 恒定回调，所以邻行变了这一行不会跟着重渲染。
 * 三个 handler 都只吃 id：真正要用到的整条信号由 TimeControl 那边按 id 取，
 * 这样回调本身可以恒定，不必每行每次渲染各造一个闭包。
 */
function SignalLibraryRowImpl({
  id, symbol, timeLabel, fallbackZone, quality, jumpIssue,
  traded, hasDayCampaign, jumping, disabled,
  onJump, onDelete, onRate, onFocusRow,
}: RowProps) {
  const handleJump = useCallback(() => onJump(id), [onJump, id]);
  const handleDelete = useCallback(() => onDelete(id), [onDelete, id]);
  const handleRate = useCallback((next: number) => onRate(id, next), [onRate, id]);
  // React 的 onFocus 走 focusin，会冒泡：行内哪个按钮拿到焦点都算这一行。
  const handleFocus = useCallback(() => onFocusRow(id), [onFocusRow, id]);

  return (
    <div
      className="group flex items-stretch gap-1.5 px-2 py-0.5 transition-colors hover:bg-accent/60"
      onFocus={handleFocus}
    >
      <button
        onClick={handleJump}
        disabled={disabled}
        className="grid shrink-0 grid-cols-[minmax(108px,148px)_128px_minmax(0,160px)] items-center gap-2 overflow-hidden text-left disabled:cursor-wait disabled:opacity-70"
        title={jumpIssue?.reason ?? `跳转到 ${symbol} @ ${timeLabel}`}
      >
        {/* 标的：勾号在前，名称可截断但列宽足够放下常见长度 */}
        {/* 勾号占一条固定的 12px 列，没勾时留空位而不是让标的左移——
            条件渲染会让带勾与不带勾的行首字母错开，勾号本身也没有固定的一列可扫。 */}
        <span
          className="grid min-w-0 grid-cols-[12px_minmax(0,1fr)] items-center gap-1 font-mono text-[11px] font-medium leading-4 text-foreground"
          title={traded ? `${timeLabel.slice(0, 10)} 当日交易过 ${symbol}` : undefined}
        >
          {traded
            ? <CheckCircle2 className="h-3 w-3 text-[#0ecb81]" aria-label="信号当日已交易" />
            : <span aria-hidden />}
          <span className="truncate">{symbol}</span>
        </span>
        {/* 时间：定宽等宽字体，纵向严格成列 */}
        <span className="flex items-center gap-1">
          <span className="font-mono text-[10px] leading-4 tabular-nums text-muted-foreground">{timeLabel}</span>
          {hasDayCampaign && (
            // 低调标注：当日该标的已有战役。小圆点而非文字/勾号，
            // 扫视时不抢注意力，需要时 hover 才给出说明。
            <span
              data-testid="signal-day-campaign"
              title="当日该标的已有交易战役"
              aria-label="当日已有战役"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#0ecb81]/50"
            />
          )}
        </span>
        {/* 兜底区：占据剩余宽度，长文本截断而不挤压他列 */}
        <span className="truncate text-[10px] leading-4 text-[#F0B90B]/90">
          {fallbackZone ? `兜底 ${fallbackZone}` : ''}
        </span>
      </button>
      {/* 评分列：与表头的 74px 对齐。必须在跳转按钮之外——
          整行本身是 <button>，嵌套按钮既是非法 HTML，点星星也会把盘面跳走。 */}
      <span className="flex w-[74px] shrink-0 items-center justify-start">
        <SignalQualityStars
          signalId={id}
          value={quality}
          onChange={handleRate}
        />
      </span>
      {/* 余量放在评分之后，评分才会紧贴兜底区 */}
      <span className="min-w-0 flex-1" aria-hidden />
      {/* 不可跳转：一枚图标，原因进 tooltip。放在最右、紧贴跳转箭头——
          它说的就是「这个箭头点不动」，挨着它才读得出因果；
          夹在兜底区与评分之间只会把两列的对齐撑开。
          用深灰而非红色：它只在少数行出现，红色会在扫视时抢走注意力，
          而这不是一个需要立刻处置的错误，只是「这条跳不过去」。 */}
      {jumpIssue && (
        <span
          data-testid="signal-jump-issue"
          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground"
          title={`不可跳转 · ${signalJumpIssueLabel(jumpIssue.code)}｜${jumpIssue.reason}`}
          aria-label={`不可跳转：${signalJumpIssueLabel(jumpIssue.code)}`}
        >
          <AlertCircle className="h-3.5 w-3.5" />
        </span>
      )}
      <button
        onClick={handleJump}
        disabled={disabled}
        className="flex h-5 w-5 shrink-0 items-center justify-center text-primary transition-colors hover:text-primary/70 disabled:cursor-wait disabled:opacity-60"
        title={jumpIssue?.reason ?? '跳转盘面'}
      >
        {jumping
          ? <Loader2 className="h-4 w-4 animate-spin" />
          : <ArrowRightCircle className="h-4 w-4" />}
      </button>
      <button
        onClick={handleDelete}
        className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
        title="删除该信号"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export const SignalLibraryRow = memo(SignalLibraryRowImpl);

interface Props {
  /** 已排好序、筛好的行。 */
  rows: TradeSignal[];
  tradedDayIndex: Set<string>;
  campaignDayIndex: Set<string>;
  jumpingSignalId: string | null;
  /**
   * 排序键 / 方向 / 月份 / 筛选词的组合键。一变就把滚动条拨回顶部：
   * 重排之后原来那个滚动位置指向的已经是另一批行，停在半空毫无意义。
   * 刻意不看 `rows` 的身份——打分、删除也会换掉 rows，那时不该把人弹回顶部。
   */
  resetKey: string;
  onJump: (id: string) => void;
  onDelete: (id: string) => void;
  onRate: (id: string, next: number) => void;
}

/** 当前铺出来的是哪一段、按什么尺寸算的，以及这是哪个口径（resetKey）下的结果。 */
interface ListView extends SignalRowWindow, SignalRowMetrics {
  key: string;
  viewport: number;
}

const sameView = (a: ListView, b: ListView) => (
  a.key === b.key
  && a.start === b.start
  && a.end === b.end
  && a.viewport === b.viewport
  && a.pitch === b.pitch
  && a.border === b.border
);

function SignalLibraryListImpl({
  rows, tradedDayIndex, campaignDayIndex, jumpingSignalId, resetKey,
  onJump, onDelete, onRate,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const countRef = useRef(rows.length);
  countRef.current = rows.length;

  const [view, setView] = useState<ListView>(() => ({
    key: resetKey,
    viewport: SIGNAL_LIST_VIEWPORT_HEIGHT,
    ...DEFAULT_SIGNAL_ROW_METRICS,
    ...computeSignalRowWindow(0, SIGNAL_LIST_VIEWPORT_HEIGHT, rows.length),
  }));
  /**
   * 最近一次交给 setView 的值（提交之后即为已提交的值）。
   * 滚动时拿它比较，窗口没变就**根本不调 setView**——
   * 用 `setView(prev => 同值 ? prev : next)` 挡不住：刚真正更新过一次之后，
   * React 18 没法提前跳过，列表函数体会在下一帧白跑一遍，每翻一页就多一次渲染。
   */
  const viewRef = useRef(view);
  // 必须排在所有会调 measure 的布局效果之前：先把已提交的值同步进来，再比较。
  useLayoutEffect(() => { viewRef.current = view; }, [view]);

  // 焦点所在的行：它滚出窗口也照样渲染（见文件头）。
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const handleRowFocus = useCallback((id: string) => setFocusedId(id), []);
  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const el = scrollerRef.current;
    const next = event.relatedTarget as Node | null;
    // 焦点换到列表里的另一行：那一行的 onFocus 会接替，这里不必多渲染一次。
    if (el && next && el.contains(next)) return;
    // 切到别的窗口 / 标签页时浏览器也会派发 focusout，但 activeElement 仍是这个按钮，
    // 回来时焦点还在原处——这时卸掉它就等于把焦点弄丢了。
    if (el && el.contains(document.activeElement)) return;
    setFocusedId(null);
  }, []);

  /**
   * 量一次容器与行距、算一次窗口。什么都没变就直接返回，不 setState——
   * 滚动一个像素就 setState 会让滚动变成一串重渲染，这正是要避开的。
   */
  const measure = useCallback(() => {
    const el = scrollerRef.current;
    const cur = viewRef.current;
    const measured = el ? measureSignalRowMetrics(el) : null;
    const metrics = measured
      && (Math.abs(measured.pitch - cur.pitch) > METRIC_EPSILON
        || Math.abs(measured.border - cur.border) > METRIC_EPSILON)
      ? measured
      : cur;
    // clientHeight 在首帧 / jsdom 里是 0，沿用上一次的（起始为 max-h-56 的名义高度）。
    const viewport = el && el.clientHeight > 0 ? el.clientHeight : cur.viewport;
    const next: ListView = {
      key: cur.key,
      viewport,
      pitch: metrics.pitch,
      border: metrics.border,
      ...computeSignalRowWindow(el ? el.scrollTop : 0, viewport, countRef.current, SIGNAL_ROW_OVERSCAN, metrics),
    };
    if (sameView(next, cur)) return;
    viewRef.current = next;
    setView(next);
  }, []);

  // 滚动：被动监听 + rAF 合帧，一帧最多算一次窗口。
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const canFrame = typeof requestAnimationFrame === 'function';
    // 「排期中」用独立的标志位而不是帧 id：帧 id 要等 requestAnimationFrame 返回才写得进去，
    // 而回调若是同步跑的（测试里的桩），那次赋值会把已经清掉的标志重新写上，此后再也不排期。
    let pending = false;
    let frame = 0;
    const run = () => { pending = false; measure(); };
    const onScroll = () => {
      if (!canFrame) { measure(); return; }
      if (pending) return;
      pending = true;
      frame = requestAnimationFrame(run);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (pending && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      pending = false;
    };
  }, [measure]);

  // 容器高度会变（窗口缩放、面板布局变化、根字号变化）。没有 ResizeObserver 就沿用旧高度，不报错。
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // 换排序 / 筛选 / 月份：回到顶部。窗口在渲染时已经按顶部算好（见下方），这里只校准一次尺寸。
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = 0;
    measure();
  }, [resetKey, measure]);

  // 行数变了（删掉一条、打分改变了筛选结果）要重算，否则窗口可能越界。
  useLayoutEffect(() => { measure(); }, [rows.length, measure]);

  /**
   * 口径刚换：这一次渲染直接按「滚动条在顶部」来铺，而不是先按旧的滚动位置、
   * 用新顺序铺一遍，等布局效果把滚动条拨回顶部后再铺第二遍。
   * 渲染中 setState 是 React 认可的「由上一次渲染派生状态」写法：本次输出作废、立即重跑，
   * 提前 return 让作废的这一遍连行都不去算。
   */
  if (view.key !== resetKey) {
    const next: ListView = {
      ...view,
      key: resetKey,
      ...computeSignalRowWindow(0, view.viewport, rows.length, SIGNAL_ROW_OVERSCAN, view),
    };
    setView(next);
    return null;
  }

  const metrics: SignalRowMetrics = { pitch: view.pitch, border: view.border };
  const focusedIndex = focusedId == null ? -1 : rows.findIndex(sig => sig.id === focusedId);
  const indices = signalRowIndicesToRender(view, rows.length, focusedIndex);
  const anyJumping = jumpingSignalId != null;

  const children: ReactNode[] = [];
  let previous = -1;
  for (const index of indices) {
    if (previous >= 0 && index > previous + 1) {
      // 垫片补齐 (previous, index) 之间没铺的行。它前面总有一行（首行始终渲染），
      // 所以它也会被 divide-y 加上 1px 上边线；Tailwind 的 box-sizing: border-box
      // 已经把那条线算进内联高度里了，缺口正好是「行数 × 行距」，**不要**再减分隔线——
      // 减了滚动条会短（真浏览器实测 19773 而非 19774）。
      // key 按「前一行的下标」取：同一个 key 的垫片顶边永远在同一个位置，
      // 浏览器的滚动锚定就算挑中它，也不会因为它被挪到别处而把滚动条带跑。
      children.push(
        <div
          key={`spacer:after:${previous}`}
          aria-hidden
          style={{ height: signalRowOffset(index, metrics) - signalRowOffset(previous + 1, metrics) }}
        />,
      );
    }
    const sig = rows[index];
    children.push(
      <SignalLibraryRow
        key={sig.id}
        id={sig.id}
        symbol={sig.symbol}
        timeLabel={sig.timeLabel}
        fallbackZone={sig.fallbackZone}
        quality={normalizeSignalQuality(sig.quality)}
        jumpIssue={sig.jumpIssue}
        traded={hasTradeOnSignalDay(tradedDayIndex, sig)}
        hasDayCampaign={hasCampaignOnSignalDay(campaignDayIndex, sig)}
        jumping={jumpingSignalId === sig.id}
        disabled={anyJumping}
        onJump={onJump}
        onDelete={onDelete}
        onRate={onRate}
        onFocusRow={handleRowFocus}
      />,
    );
    previous = index;
  }

  return (
    <div
      ref={scrollerRef}
      data-testid="signal-library-scroller"
      className="max-h-56 divide-y divide-border/30 overflow-y-auto overscroll-contain"
      onBlur={handleBlur}
    >
      {/* 首行始终是第一个子节点：前面不放垫片，它才不会被 divide-y 平白加上一条上边线
          （那会和表头的下边线叠成双线）；末行始终是最后一个，底部也就不需要垫片。 */}
      {children}
    </div>
  );
}

export const SignalLibraryList = memo(SignalLibraryListImpl);
