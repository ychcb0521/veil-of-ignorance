import { useMemo } from 'react';
import { useReplayKlines } from '@/hooks/useReplayKlines';

/**
 * 视野阶梯的“上下文单位”下限。
 * 正常战役会用“战役跨度本身”作为默认前后上下文，使初始画面形成：
 * 开始前 1/3、战役过程 1/3、结束后 1/3；同时额外预载左右各 25 倍，
 * 供用户继续缩小或拖动查看。
 *
 * 事故：整条阶梯原本是战役自身时长的纯倍数，没有任何绝对下限。
 * QUICKUSDT 那种内容跨度只有 67 秒的战役，默认 3 倍只有 3.35 分钟——
 * 5m 周期下连一根 K 线都不到，51 倍顶格也才 57 分钟，用户投诉
 * “有的战役只能选取这么一小段时间”正是从这里长出来的。
 * 现在把单位下限抬到 30 分钟：3 倍默认 = 90 分钟 ≈ 18 根 5m，够读结构；
 * 1.1 倍 = 33 分钟也不再退化回“不足一根 K 线”；
 * 51 倍 = 25.5 小时 = 1530 根 1m，仍远小于详情页 6000 根的拉取预算，
 * 所以被抬高的短战役不会因为修这个 bug 反而被降级到 5m。
 * 退化区间（只有一个事件时间点）共用同一个常量：它就是短战役的极端版本，
 * 两个常量并存只会让人误以为语义不同。
 */
export const CAMPAIGN_MIN_CONTEXT_MS = 30 * 60_000;
export const CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER = 25;
export const CAMPAIGN_VIEW_MULTIPLIERS = [2, 3, 5, 11, 21, 31, 41, 51] as const;
export const CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS = [1.1, ...CAMPAIGN_VIEW_MULTIPLIERS] as const;
export type CampaignViewMultiplier = 1 | (typeof CAMPAIGN_ORIGINAL_VIEW_MULTIPLIERS)[number];

/**
 * 绝对时间预设：跨度与战役时长完全无关，用来兑现“尽可能长的 K 线”。
 * 「1月」按固定 30 天而不是日历月——同一个按钮在任何战役上跨度一致，截图才能互相对照。
 */
export const CAMPAIGN_ABSOLUTE_RANGE_PRESETS = [
  { key: '1d', label: '1天', spanMs: 24 * 60 * 60_000 },
  { key: '1w', label: '1周', spanMs: 7 * 24 * 60 * 60_000 },
  { key: '1M', label: '1月', spanMs: 30 * 24 * 60 * 60_000 },
] as const;
export type CampaignAbsoluteRangeKey = (typeof CAMPAIGN_ABSOLUTE_RANGE_PRESETS)[number]['key'];

/**
 * 倍率与绝对跨度是两种量纲：倍率要乘 contextMs，绝对值不能乘。
 * 用判别联合分开，免得 `visibleMs = multiplier * contextMs` 这行公式哪天也套到绝对值上。
 * nowMs 随选择一起冻结：它会进入 fromTime/toTime，而这两个是 useReplayKlines 的 effect 依赖，
 * 裸调 Date.now() 等于每次渲染都换一个窗口 —— 无限重取 + 图表反复重挂。
 */
export type CampaignChartRangeSelection =
  | { kind: 'multiplier'; multiplier: CampaignViewMultiplier }
  | { kind: 'absolute'; key: CampaignAbsoluteRangeKey; nowMs: number };

export function campaignAbsolutePresetSpanMs(key: CampaignAbsoluteRangeKey): number {
  return CAMPAIGN_ABSOLUTE_RANGE_PRESETS.find(preset => preset.key === key)?.spanMs
    ?? CAMPAIGN_ABSOLUTE_RANGE_PRESETS[0].spanMs;
}

export type CampaignKlineTimeWindow = {
  /** 实际请求并允许浏览的完整 51 倍时间范围。 */
  fromTime: number;
  toTime: number;
  /** 首次打开时显示的 3 倍时间范围。 */
  defaultFromTime: number;
  defaultToTime: number;
  contentStartMs: number | null;
  contentEndMs: number | null;
  /** 默认画面单侧上下文 = max(战役内容跨度, CAMPAIGN_MIN_CONTEXT_MS)。 */
  contextMs: number | null;
  /** 完整可浏览范围的单侧上下文，等于二十五段上下文单位。 */
  availableContextMs: number | null;
};

export type CampaignKlineVisibleRange = {
  fromTime: number;
  toTime: number;
};

function hasCampaignContentRange(window: CampaignKlineTimeWindow): boolean {
  return window.contentStartMs != null
    && Number.isFinite(window.contentStartMs)
    && window.contentEndMs != null
    && Number.isFinite(window.contentEndMs)
    && window.contextMs != null
    && Number.isFinite(window.contextMs)
    && window.contextMs > 0;
}

/**
 * 「虚拟内容区间」：内容跨度不足一个上下文单位时，把差额平摊到内容两侧，
 * 使可见跨度真的等于「倍数 × 单位」。
 *
 * 差额必须按整数毫秒切分。事故：原来直接写 overflow / 2，内容跨度为奇数毫秒时
 * 两端各带 0.5ms，而 fromTime/toTime 会被 useReplayKlines 原样塞进
 * `startTime=…999.5`；实测 fapi 直接返回 400 / code -1102（malformed），
 * fetchRange 抛错，整张图退化成“该时间段暂无 K 线数据”——
 * 而奇数跨度的短战役正是这次改造要救的那一批。
 * 左侧向上取整、右侧拿余数：跨度仍严格等于单位，居中最多偏 0.5ms。
 */
function campaignVirtualContentInterval(
  contentStartMs: number,
  contentEndMs: number,
  contextMs: number,
): { viewStartMs: number; viewEndMs: number } {
  const overflowMs = Math.max(0, contextMs - (contentEndMs - contentStartMs));
  const leftOverflowMs = Math.ceil(overflowMs / 2);
  return {
    viewStartMs: contentStartMs - leftOverflowMs,
    viewEndMs: contentEndMs + (overflowMs - leftOverflowMs),
  };
}

/**
 * 把指定倍数的窗口放在战役内容正中。
 * 1 倍 = 一个上下文单位，不附加额外前后上下文；
 * 1.1 倍 = 左 0.05 倍 + 单位 1 倍 + 右 0.05 倍；
 * 例如 3 倍 = 左 1 倍 + 单位 1 倍 + 右 1 倍。
 *
 * 取景基准是「虚拟内容区间」而不是内容本身：内容跨度 >= 上下文单位时它逐毫秒等于内容区间，
 * 老战役的九个档位一个数都不会动；内容被 CAMPAIGN_MIN_CONTEXT_MS 抬高时，
 * 把抬高出来的那份平摊到内容两侧，可见跨度才真的等于「倍数 × 单位」——
 * 否则按旧公式 visibleMs = 内容跨度 + 单位 ×（倍数 − 1），67 秒的战役 3 倍只有 61 分钟，
 * 按钮上写的倍数与画面对不上，1.1 倍更会掉回“不足一根 5m”的失败态。
 * contentStartMs/contentEndMs 本身绝不被撑开：战役 marker 与竖线靠它们定位。
 */
export function buildCampaignKlineVisibleRange(
  window: CampaignKlineTimeWindow,
  multiplier: CampaignViewMultiplier,
): CampaignKlineVisibleRange {
  if (hasCampaignContentRange(window)) {
    // 必须与 buildCampaignKlineBaseWindow 用同一个切分，否则 3 倍可见区不再等于 defaultFrom/To。
    const { viewStartMs, viewEndMs } = campaignVirtualContentInterval(
      window.contentStartMs,
      window.contentEndMs,
      window.contextMs,
    );
    const edgeContextMs = window.contextMs * (multiplier - 1) / 2;
    return {
      fromTime: Math.max(window.fromTime, viewStartMs - edgeContextMs),
      toTime: Math.min(window.toTime, viewEndMs + edgeContextMs),
    };
  }

  // 极少数缺少内容边界的旧记录：以原默认窗口为 3 倍基准，并限制在已拉取范围内。
  const centerTime = (window.defaultFromTime + window.defaultToTime) / 2;
  const defaultSpanMs = Math.max(0, window.defaultToTime - window.defaultFromTime);
  const requestedHalfSpanMs = defaultSpanMs * multiplier / 6;
  return {
    fromTime: Math.max(window.fromTime, centerTime - requestedHalfSpanMs),
    toTime: Math.min(window.toTime, centerTime + requestedHalfSpanMs),
  };
}

/**
 * 绝对预设：以战役内容中点为中心的定长窗口，右沿夹到「现在」后整体左移保持定长。
 * 不夹 now 的话会向未来请求根本不存在的 K 线，CandlestickChart 只数到真实存在的根数，
 * barSpace 反被放大、居中校正又对一个没有 K 线的时间戳取像素，战役会整体偏离画面中心。
 * 夹完再用 to − spanMs 反推 from：点了「1月」就是足额 30 天，不会被截短。
 */
export function buildCampaignAbsoluteVisibleRange(
  window: CampaignKlineTimeWindow,
  spanMs: number,
  nowMs: number,
): CampaignKlineVisibleRange {
  const hasContent = hasCampaignContentRange(window);
  const centerMs = hasContent
    ? (window.contentStartMs + window.contentEndMs) / 2
    : (window.defaultFromTime + window.defaultToTime) / 2;
  // 预设的语义是「至少这么长」。比战役本身还短的预设照字面居中，会把战役头尾各切掉一截——
  // 反事实能把内容右端推到 10 天开外，那时点「1周」看到的画面里连开仓与平仓都不在了。
  // 工具栏虽然把这类被支配的预设置灰了，但几何不变量不能只靠 UI 守。
  const contentSpanMs = hasContent ? Math.max(0, window.contentEndMs - window.contentStartMs) : 0;
  const effectiveSpanMs = Math.max(spanMs, contentSpanMs);
  // 右沿不越过「现在」（向未来要 K 线只会拿到空区间），但战役自身的右端优先：
  // nowMs 在点击那一刻就冻结了，开放中的战役随后会把 contentEnd 推过它，
  // 这时夹到 now 等于把战役尾巴连同 marker 一起切掉。
  const rightLimitMs = hasContent ? Math.max(nowMs, window.contentEndMs) : nowMs;
  // 取整：端点会原样进 Binance 请求的 startTime/endTime，小数会被判 malformed。
  const toTime = Math.round(Math.min(centerMs + effectiveSpanMs / 2, rightLimitMs));
  return { fromTime: toTime - effectiveSpanMs, toTime };
}

/** 详情页唯一的可见区入口：倍率与绝对预设分派到各自的几何，避免两条路径各自漂移。 */
export function buildCampaignChartVisibleRange(
  window: CampaignKlineTimeWindow,
  selection: CampaignChartRangeSelection,
): CampaignKlineVisibleRange {
  if (selection.kind === 'multiplier') {
    return buildCampaignKlineVisibleRange(window, selection.multiplier);
  }
  const range = buildCampaignAbsoluteVisibleRange(
    window,
    campaignAbsolutePresetSpanMs(selection.key),
    selection.nowMs,
  );
  // 按构造窗口已经被撑开覆盖它，这次夹逼是恒等的；保留只为让「可见区 ⊆ 已拉取区」显式成立。
  return {
    fromTime: Math.max(window.fromTime, range.fromTime),
    toTime: Math.min(window.toTime, range.toTime),
  };
}

/**
 * selection 只允许「放宽」fromTime/toTime，绝不收窄，也绝不触碰
 * contextMs / default* / content* —— 所以撑开拉取窗口不会改变任何倍率档位的可见区，
 * 倍率阶梯与绝对预设彼此正交。不撑开的话，buildCampaignKlineVisibleRange 的夹逼
 * 会把预设直接夹回 51 倍边界，按钮点了等于没点。
 */
export function buildCampaignKlineTimeWindow(
  openedAtMs: number,
  closedAtMs: number,
  spanStartMs: number | null = null,
  spanEndMs: number | null = null,
  selection: CampaignChartRangeSelection | null = null,
): CampaignKlineTimeWindow {
  const base = buildCampaignKlineBaseWindow(openedAtMs, closedAtMs, spanStartMs, spanEndMs);
  if (!selection || selection.kind !== 'absolute') return base;
  const absolute = buildCampaignAbsoluteVisibleRange(
    base,
    campaignAbsolutePresetSpanMs(selection.key),
    selection.nowMs,
  );
  return {
    ...base,
    fromTime: Math.min(base.fromTime, absolute.fromTime),
    toTime: Math.max(base.toTime, absolute.toTime),
  };
}

function buildCampaignKlineBaseWindow(
  openedAtMs: number,
  closedAtMs: number,
  spanStartMs: number | null,
  spanEndMs: number | null,
): CampaignKlineTimeWindow {
  const hasStart = spanStartMs != null && Number.isFinite(spanStartMs);
  const hasEnd = spanEndMs != null && Number.isFinite(spanEndMs);
  if (hasStart && hasEnd) {
    // max() 而不是分支：内容跨度 > 下限时 contextMs 与改造前逐毫秒相同，
    // 长战役的兼容性由数学恒等保证，不靠条件判断。
    // 单点/倒挂区间也走同一条路（跨度 <= 0 一定被下限接住），
    // 原来那个只给单点用的 15 分钟缓冲就是这里的极端情形，没必要另立常量。
    const contextMs = Math.max(spanEndMs - spanStartMs, CAMPAIGN_MIN_CONTEXT_MS);
    const availableContextMs = contextMs * CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER;
    // 取景基准是「虚拟内容区间」：被下限抬高出来的那份平摊到两侧，
    // 于是 defaultFrom/To 永远是 3 倍窗口、fromTime/toTime 永远是 51 倍窗口。
    const { viewStartMs, viewEndMs } = campaignVirtualContentInterval(spanStartMs, spanEndMs, contextMs);
    return {
      fromTime: viewStartMs - availableContextMs,
      toTime: viewEndMs + availableContextMs,
      defaultFromTime: viewStartMs - contextMs,
      defaultToTime: viewEndMs + contextMs,
      contentStartMs: spanStartMs,
      contentEndMs: spanEndMs,
      contextMs,
      availableContextMs,
    };
  }

  // 空战役或历史数据异常时，保留原来的宽松兜底，避免旧数据突然没有上下文。
  const fromTime = openedAtMs - 6 * 60 * 60_000;
  const toTime = closedAtMs + 2 * 60 * 60_000;
  return {
    fromTime,
    toTime,
    defaultFromTime: fromTime,
    defaultToTime: toTime,
    contentStartMs: null,
    contentEndMs: null,
    contextMs: null,
    availableContextMs: null,
  };
}

export function useCampaignKlines(
  symbol: string,
  openedAt: string,
  closedAt: string | null,
  interval: string = '5m',
  // Legs 列表的最早/最晚时间：确保 K 线前后区间把所有腿的开/平时间囊括进去。
  spanStartMs: number | null = null,
  spanEndMs: number | null = null,
  // 详情页当前选中的显示范围：绝对预设要把实际拉取窗口一起撑开。
  selection: CampaignChartRangeSelection | null = null,
) {
  const openedAtMs = useMemo(() => new Date(openedAt).getTime(), [openedAt]);
  const closedAtMs = useMemo(() => new Date(closedAt ?? Date.now()).getTime(), [closedAt]);
  // 有 Legs/委托/反事实内容区间时，初始可见窗口仍是三段各占 1/3；
  // 数据层预载左右各二十五段上下文，用户可一键切换并查看完整 51 倍范围。
  // 页面与本 hook 各算一次窗口，必须吃同一份 (spanStart, spanEnd, selection)；
  // 只喂其中一个的症状是「预设无效」或「画面两侧空白」。
  const window = useMemo(
    () => buildCampaignKlineTimeWindow(openedAtMs, closedAtMs, spanStartMs, spanEndMs, selection),
    [closedAtMs, openedAtMs, selection, spanEndMs, spanStartMs],
  );

  return {
    ...useReplayKlines(symbol, window.fromTime, window.toTime, interval),
    openedAtMs,
    closedAtMs,
    ...window,
  };
}
