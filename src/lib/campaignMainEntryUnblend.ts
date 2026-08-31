import { unblendMainEntryPriceByNotional } from '@/lib/unblendMainEntry';

/**
 * 历史战役的自动补救：主力那条平仓记录如果是**合并出来的**，把主力自己的开仓价解回来。
 *
 * 背景：同向成交在持仓期合并成一个仓位（爆仓必须按整仓算），而在本次改动之前，
 * 一次平仓只写一条记录、带的是合并后的加权价。这个应用没有开仓记录，
 * 历史与战役全靠平仓记录回填，于是主力顶着一个它从未成交过的价格。
 * 预期最大亏损 L = 跌幅 × 敞口 的两个因子都从这条记录取，误差是相乘的。
 *
 * 本次改动之后成交的仓位不走这里——它们的分片各带自己的开仓价，`fillId` 就是标记。
 * 这条路径只为**改动之前**的老数据存在。
 *
 * 判据必须是**正面证据**，不能只因为战役里标了加仓腿就去减：
 * 合并的定义是「记录的名义 = 主力的名义 + 各笔加仓的名义」，对不上就说明
 * 这笔加仓当初根本没并进这个仓位（它自己单独开着），减了反而把主力算错。
 * 验不了就不动——「先只做能自动认的」。
 */

export type UnblendSkipReason =
  | 'already-per-fill'    // 新数据，分片各带自己的价，不需要补救
  | 'no-adds'             // 没有可用的加仓腿
  | 'main-size-unknown'   // 主力自己的名义不可知，无法验证「合并」这件事
  | 'not-a-merge'         // 名义对不上：这笔加仓当初没并进这个仓位
  | 'unsolvable'          // 代数上解不出正数
  ;

export interface UnblendAddCandidate {
  entryPrice: number;
  notionalUsd: number;
}

export type CampaignUnblendResult =
  | { ok: true; entryPrice: number; mainNotionalUsd: number }
  | { ok: false; reason: UnblendSkipReason };

/**
 * 名义对账的容差。滑点、手续费、张数取整都会让「主力 + 加仓」与记录差一点点，
 * 但差不到 2%——2% 已经远大于这些噪声，又远小于「多算/少算一整笔加仓」。
 */
const MERGE_TOLERANCE = 0.02;

const positive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

export function resolveUnblendedMainEntry(input: {
  /** 主力那条平仓记录里的开仓价（可能是合并后的加权价）。 */
  blendedEntryPrice: number;
  /** 那条记录的开仓名义（USD）。 */
  totalNotionalUsd: number;
  /** 记录的 fillId：有值说明是本次改动之后的分片，天然已经是主力自己的价。 */
  recordFillId?: string | null;
  /** 主力**自己**的名义（腿的 pre_position_size，或战役的 initial_main_size_usdt）。 */
  mainNotionalUsd: number | null | undefined;
  /**
   * 已确认并进同一个仓位的**兄弟腿**——不只是加仓。
   *
   * 镜像止盈与主力同标的、同方向、同杠杆,按合并键它**也会并进同一个仓位**,
   * 所以要从混合价里剔除的是「主力之外的一切」。只减加仓的话名义对账会差一大截,
   * 守卫会拒绝出数——安全,但等于这个功能对真实数据永远不生效。
   *
   * 这不改变敞口口径:镜像本来就计入 ex-ante 敞口,被剔除的只是**开仓价的混合**。
   */
  mergedSiblings: UnblendAddCandidate[];
}): CampaignUnblendResult {
  if (input.recordFillId) return { ok: false, reason: 'already-per-fill' };

  const adds = (input.mergedSiblings ?? []).filter(a => positive(a.entryPrice) && positive(a.notionalUsd));
  if (adds.length === 0) return { ok: false, reason: 'no-adds' };
  if (!positive(input.mainNotionalUsd)) return { ok: false, reason: 'main-size-unknown' };
  if (!positive(input.blendedEntryPrice) || !positive(input.totalNotionalUsd)) {
    return { ok: false, reason: 'not-a-merge' };
  }

  /**
   * 正面证据：记录的名义必须等于「主力 + 各笔加仓」。
   * 这就是合并的定义式；对不上就不是这个仓位合并出来的。
   */
  const addNotional = adds.reduce((s, a) => s + a.notionalUsd, 0);
  const expected = input.mainNotionalUsd + addNotional;
  const drift = Math.abs(input.totalNotionalUsd - expected) / input.totalNotionalUsd;
  if (!(drift <= MERGE_TOLERANCE)) return { ok: false, reason: 'not-a-merge' };

  const solved = unblendMainEntryPriceByNotional({
    blendedEntryPrice: input.blendedEntryPrice,
    totalNotionalUsd: input.totalNotionalUsd,
    adds: adds.map(a => ({ entryPrice: a.entryPrice, notionalUsd: a.notionalUsd })),
  });
  if (!solved.ok) return { ok: false, reason: 'unsolvable' };

  /**
   * 解出来的价必须落在「主力与各笔加仓的价」张成的区间之内——
   * 加权平均永远介于被平均的那些数之间,反解自然也该如此。
   * 落到区间外说明输入自相矛盾,宁可不动。
   */
  const prices = [input.blendedEntryPrice, ...adds.map(a => a.entryPrice)];
  const lo = Math.min(...prices) * 0.5;
  const hi = Math.max(...prices) * 2;
  if (!(solved.entryPrice >= lo && solved.entryPrice <= hi)) {
    return { ok: false, reason: 'unsolvable' };
  }

  return { ok: true, entryPrice: solved.entryPrice, mainNotionalUsd: input.totalNotionalUsd - addNotional };
}
