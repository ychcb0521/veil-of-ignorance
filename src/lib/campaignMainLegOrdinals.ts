import type { TradeJournal } from '@/types/journal';

/**
 * 一场战役里有两笔及以上主力时，按**开仓先后**给它们编号：主力1、主力2、主力3……
 *
 * 不只是好看：反向委托是按「挂出那一刻哪笔主力开着」归类的，
 * 而界面上两行如果都写「主力开仓」，用户就没法一眼验证它归对没有。
 * 编号让归类可核对——这正是这次报错被发现的方式（用户从截图看出来的）。
 *
 * 只给**同一档主力角色**编号（main_open；一笔都没有时退回 reentry_main），
 * 与 pickPrimaryMainLeg 的角色分档一致。加仓自己有 加仓1/加仓2 的标签，不参与。
 */
const PRIMARY_ROLES = ['main_open', 'reentry_main'] as const;

function toMs(value: string | null | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : Number.MAX_SAFE_INTEGER;
}

/**
 * 返回 legId → 序号（1 起）。只有一笔主力时返回空表——
 * 单笔不该被叫作「主力1」，那会暗示还有个主力2。
 */
export function buildMainLegOrdinals(legs: TradeJournal[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const role of PRIMARY_ROLES) {
    const tier = legs.filter(leg => leg.leg_role === role);
    if (tier.length === 0) continue;
    if (tier.length < 2) return out;
    const ordered = [...tier].sort((a, b) => {
      const ta = toMs(a.pre_simulated_time);
      const tb = toMs(b.pre_simulated_time);
      if (ta !== tb) return ta - tb;
      // 时间并列时用 leg_sequence 兜底，保证结果稳定可复现
      return (a.leg_sequence ?? Number.MAX_SAFE_INTEGER) - (b.leg_sequence ?? Number.MAX_SAFE_INTEGER);
    });
    ordered.forEach((leg, i) => out.set(leg.id, i + 1));
    return out;
  }
  return out;
}
