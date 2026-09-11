/**
 * 逐 K 线撮合的「哪几根算新」——这是撮合引擎唯一该看的输入。
 *
 * 事故：原来用的是**数组长度差**（prevVisibleLenRef 初值 0，取 visibleData.slice(prev)）。
 * 于是首批数据到位那一刻，prev 还是 0，整个已加载历史（上千根）被当成「刚刚收盘的新 K 线」
 * 一根根喂给撮合引擎。而挂单是从 localStorage 恢复的：
 *
 *   刷新一次页面 → 一张躺着的限价单立刻被**历史**行情撮合成交，
 *   成交价是它的委托价、成交时刻落在过去，用户从未下过这一手。
 *
 * 伪造出来的成交会写进 trade_history，进而进入战役、盈亏比 b、R 倍数、执行力资产——
 * 整套复盘统计都建立在这批记录上。切标的、切周期同样重建数据集，同样会回放。
 *
 * 长度差还有两个独立的坑：
 *   · 流式补给往**前面**追加更早的 K 线时（loadOlder），长度也会变长，
 *     slice(prev) 取到的却是末尾那几根——撮合的根本不是新露头的那几根；
 *   · 倒放时「新」同样不能用下标判断（前插会移动下标）。注意倒放的 visibleData
 *     走的是**镜像时间**（getReverseVisibleData 返回 mirrorTime(cap, t)），真实时间
 *     越早镜像时间越大——所以倒放传进来的 candles 依旧是时间递增的，direction 仍是 1；
 *     direction = -1 只留给「候选数组本身按时间递减」的调用方。
 *
 * 所以这里改用**时间水位**，并且对数据集身份（标的 | 周期 | 方向）敏感：
 * 身份一变就只重设水位、不撮合任何一根。宁可漏掉换标的那一瞬的一根，
 * 也不能凭空造出一笔成交。
 */

export interface MatchCursor {
  /** 数据集身份：标的 | 周期 | 方向。变了就说明整批数据被重建过。 */
  key: string;
  /** 已经撮合过的最新一根 K 线的开盘时刻（倒放时是最早的那一根）。 */
  lastCandleTime: number;
}

export interface MatchBatchPlan<T extends { time: number }> {
  /** 这一轮该喂给撮合引擎的 K 线，按时间推进方向排好。 */
  match: T[];
  /** 写回去的水位。数据尚未到位时原样回传（可能仍是 null，表示还没播种）。 */
  nextCursor: MatchCursor | null;
  /** 没有撮合而只是重设水位时给出原因，便于测试与排查。 */
  seededReason: 'first-load' | 'dataset-changed' | null;
}

/**
 * @param direction 1 = 正放（新 K 线时间更大）；-1 = 倒放（新 K 线时间更小）。
 */
export function planMatchBatch<T extends { time: number }>(input: {
  cursor: MatchCursor | null;
  key: string;
  candles: readonly T[];
  direction: 1 | -1;
}): MatchBatchPlan<T> {
  const { cursor, key, candles, direction } = input;
  // 一次循环求边界，不用 Math.max(...times)：loadOlder 可以一直往前拼，
  // 展开的参数个数撞到引擎上限（约 6.5 万）时会抛 RangeError，整个撮合 effect 挂掉。
  let edgeTime = Number.NaN;
  let finiteCount = 0;
  for (const candle of candles) {
    if (!Number.isFinite(candle.time)) continue;
    finiteCount += 1;
    if (finiteCount === 1) edgeTime = candle.time;
    else if (direction === 1) { if (candle.time > edgeTime) edgeTime = candle.time; }
    else if (candle.time < edgeTime) edgeTime = candle.time;
  }
  if (finiteCount === 0) {
    // 数据还没到位（挂载首帧、或数据集正在重建）：水位原样回传，尤其**不能**把还没
    // 播种的 null 写成一个 NaN 水位——key 并没有变，等真数据到位时就不会再走播种
    // 分支，而任何时刻都 `> NaN` 为假，撮合引擎会就此永久哑火（刷新恢复会话时
    // Index.tsx 的 restore 分支不重置 cursor，走的正是这条路：挂单再也不会成交）。
    return { match: [], nextCursor: cursor, seededReason: null };
  }
  // 正放的水位是最大时刻，倒放是最小时刻（上面那个循环已经按 direction 求好）。
  const edge = edgeTime;

  // 水位不是有限数（历史遗留的脏值）同样按「没播种」处理，否则比较恒为假。
  if (cursor == null || cursor.key !== key || !Number.isFinite(cursor.lastCandleTime)) {
    // 首批 / 换了数据集：只认水位，一根都不撮合。
    return {
      match: [],
      nextCursor: { key, lastCandleTime: edge },
      seededReason: cursor != null && cursor.key !== key ? 'dataset-changed' : 'first-load',
    };
  }

  const isNew = direction === 1
    ? (t: number) => t > cursor.lastCandleTime
    : (t: number) => t < cursor.lastCandleTime;

  const match = candles
    .filter(c => Number.isFinite(c.time) && isNew(c.time))
    .sort((a, b) => (a.time - b.time) * direction);

  return {
    match,
    // 没有新根时水位不动——避免把「数据集没变但边界回退」的异常写成前进。
    nextCursor: { key, lastCandleTime: match.length > 0 ? edge : cursor.lastCandleTime },
    seededReason: null,
  };
}

/** 数据集身份。任一项变化都意味着 visibleData 被整批重建，历史不得再次撮合。 */
export function matchDatasetKey(symbol: string, intervalMs: number, direction: 1 | -1): string {
  return `${symbol}|${intervalMs}|${direction}`;
}
