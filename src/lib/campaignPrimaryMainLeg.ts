/**
 * 主力 leg 的选取 —— 当一场战役里有两个及以上主仓时，以「名义金额最多」的那个为准。
 *
 * 为什么不能沿用「排序后的第一个」：Mag Space 的主力本就由 M 底仓 + 镜像多单
 * 两笔构成，再加上回填、残仓、试单，main_open 出现多笔是常态。按 leg_sequence
 * 或时间取首个，很容易选中一笔金额极小的残仓（实盘见过 1769 USDT 的 leg 排在
 * 17775439 USDT 的真正主力之前），从而让开仓价、杠杆、反向委托归属整体挂错。
 * 名义金额才是「谁是主力」的实质判据。
 */
import type { TradeJournal } from '@/types/journal';

/** 主仓角色：main_open 优先；没有时退回 reentry_main（重入后的主仓）。 */
const PRIMARY_ROLES = ['main_open', 'reentry_main'] as const;

function toMs(value: string | null | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/**
 * leg 的名义金额。pre_position_size 就是 legs 列表「仓位」列展示的那个数，
 * 以它为准可保证「界面看到的最大那笔」与「系统认定的主力」始终一致。
 */
export function legNotionalUsd(leg: TradeJournal): number | null {
  const size = leg.pre_position_size;
  return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : null;
}

/**
 * 选出代表这场战役的那一笔主力。
 *
 * 规则：先取 main_open；一个都没有才退回 reentry_main。在同一档角色内比名义金额，
 * 取最大；金额并列（或全部缺失）时退回最早开仓的那笔，保持结果稳定可复现。
 */
export function pickPrimaryMainLeg(legs: TradeJournal[]): TradeJournal | null {
  for (const role of PRIMARY_ROLES) {
    const candidates = legs.filter(leg => leg.leg_role === role);
    if (candidates.length === 0) continue;
    return [...candidates].sort((a, b) => {
      const na = legNotionalUsd(a);
      const nb = legNotionalUsd(b);
      // 有金额的排在无金额的前面；都有则大者优先
      if (na != null && nb != null && na !== nb) return nb - na;
      if (na != null && nb == null) return -1;
      if (na == null && nb != null) return 1;
      return toMs(a.pre_simulated_time) - toMs(b.pre_simulated_time);
    })[0] ?? null;
  }
  return null;
}
