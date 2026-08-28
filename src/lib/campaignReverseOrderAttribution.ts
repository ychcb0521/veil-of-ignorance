import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder } from '@/types/trading';
import { pickPrimaryMainLeg } from '@/lib/campaignPrimaryMainLeg';

/**
 * 反向委托该挂在哪条腿名下。
 *
 * 事故：一场战役有两笔主力时，**所有**未触发的委托都被塞给了同一笔——
 * `pickPrimaryMainLeg` 选的是名义金额最大的那笔，时间根本没参与。
 * 实盘那张卡：主力1 开于 04-29 19:48（399,868），主力2 开于 **04-30 04:23**（799,862）；
 * 两张「委 04-29 19:49 / 撤 04-29 20:27」的撤单全被记到主力2 名下——
 * 它们下单时距主力1 开仓才 1 分钟，撤销时距主力2 出生还有约 8 小时。
 *
 * 修法：**先按时间筛出「当时活着的主力」，再在其中按金额定**。
 * 两条规则不冲突，是互补的：时间决定资格，金额决定同一时刻里谁是主力
 * （实盘见过 1769 的残仓与 17,775,439 的真主力相隔 30 秒开出，窗口重叠，
 * 那时只能靠金额分辨）。
 *
 * 时基是安全的：委托的 createdAt 与 leg 的开/平都走 getEffectiveTime（模拟时间）。
 */

/** 主力持仓窗口。closeMs 为 null 表示尚未平仓——窗口开口朝右，不是「没有窗口」。 */
export interface MainLegWindow {
  openMs: number | null;
  closeMs: number | null;
}

export interface ReverseOrderAttributionOptions {
  /**
   * 取一条腿的持仓窗口。**必须与界面上那两行「开 / 平」同源**
   * （resolveLegExecution），否则会出现「委 01:00 挂在一行标着 平 23:53 的腿上」
   * 这种新的错配——那是同一类投诉换个位置再来一次。
   */
  legWindow?: (leg: TradeJournal) => MainLegWindow;
}

/**
 * 开主力之前先挂好的反向对冲空单，属于紧随其后的那笔主力。
 * 与 journalApi 里战役级委托窗口用的是同一个缓冲（journalApi.ts:2335）。
 */
export const PRE_MAIN_LOOKBACK_MS = 5 * 60_000;

/** 已触发委托与对冲腿开仓时刻的最大容差；与 campaignReverseOrderLines 同量级。 */
const TRIGGER_MATCH_TOLERANCE_MS = 60_000;

function sequence(leg: TradeJournal): number {
  return leg.leg_sequence ?? Number.MAX_SAFE_INTEGER;
}

function isMainLeg(leg: TradeJournal): boolean {
  return (
    leg.leg_role === 'main_open'
    || leg.leg_role === 'reentry_main'
    || Boolean(leg.leg_role?.startsWith('main_add_'))
    || (leg.order_kind === 'main' && leg.leg_role !== 'mirror_tp')
  );
}

function isHedgeLeg(leg: TradeJournal): boolean {
  return (
    leg.leg_role === 'hedge_initial_a'
    || leg.leg_role === 'hedge_initial_b'
    || leg.leg_role === 'hedge_rolling'
    || leg.leg_role === 'reentry_hedge'
    || (leg.order_kind === 'hedge' && leg.leg_role !== 'mirror_tp')
  );
}

/**
 * 时间戳。**必须 > 0**：TradeRecord 里 `openTime: pos.openTime || 0` 会写出 0，
 * 而 `??` 不会在 0 上兜底。放它过去，窗口就变成 [1970, 平仓时刻]，
 * 整场战役的委托全被它吃掉——界面上还看不出来，因为 0 会被格式化成「—」。
 */
function timeMs(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const result = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(result) && result > 0 ? result : null;
}

function defaultWindow(leg: TradeJournal): MainLegWindow {
  return {
    openMs: timeMs(leg.pre_simulated_time),
    // 没有记录可查时只能开口朝右。宁可宽，也不要凭空造一个平仓时刻。
    closeMs: timeMs((leg as { post_simulated_close_time?: string | null }).post_simulated_close_time),
  };
}

/** 窗口是**半开**的 [开, 平)：两腿首尾相接时，交界那一刻只属于后一腿。 */
function windowContains(w: MainLegWindow, t: number): boolean {
  if (w.openMs == null) return false;
  if (t < w.openMs - PRE_MAIN_LOOKBACK_MS) return false;
  return w.closeMs == null || t < w.closeMs;
}

function triggeredHedgeMatchScore(
  leg: TradeJournal,
  order: CampaignReverseHedgeOrder,
): number {
  const legTime = timeMs(leg.pre_simulated_time);
  const orderTime = timeMs(order.triggeredAt);
  const timeScore = legTime != null && orderTime != null
    ? Math.abs(legTime - orderTime)
    : Number.MAX_SAFE_INTEGER / 2;
  const legPrice = leg.pre_entry_price;
  const orderPrice = order.fillPrice ?? order.price;
  const priceScore = legPrice != null && Number.isFinite(legPrice) && Number.isFinite(orderPrice)
    ? Math.abs(legPrice - orderPrice) / Math.max(Math.abs(orderPrice), 1e-12)
    : 1;
  return timeScore + priceScore * 60_000;
}

/**
 * 已触发委托的**可行**对冲腿。
 *
 * 此前只排序、不筛选：一条比委托本身还早开的对冲腿也能被选中，
 * 时间差再大也照选（唯一候选时必中）。排序不等于筛选——
 * 这与主力那边是同一类缺陷。
 */
function feasibleHedgeLegs(
  hedgeLegs: TradeJournal[],
  order: CampaignReverseHedgeOrder,
): TradeJournal[] {
  const created = timeMs(order.createdAt);
  const fired = timeMs(order.triggeredAt) ?? created;
  const feasible = hedgeLegs.filter(leg => {
    const open = timeMs(leg.pre_simulated_time);
    if (open == null) return false;
    // 对冲腿不可能在委托挂出之前就由这张委托开出来
    if (created != null && open < created - TRIGGER_MATCH_TOLERANCE_MS) return false;
    if (fired != null && Math.abs(open - fired) > TRIGGER_MATCH_TOLERANCE_MS) return false;
    return true;
  });
  return feasible;
}

export function buildCampaignReverseOrderLegMap(
  legs: TradeJournal[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[],
  options: ReverseOrderAttributionOptions = {},
): Map<string, string> {
  const windowFor = options.legWindow ?? defaultWindow;
  const orderedMainLegs = legs.filter(isMainLeg).sort((a, b) => sequence(a) - sequence(b));
  const windows = new Map(orderedMainLegs.map(leg => [leg.id, windowFor(leg)] as const));
  // 兜底所有者：一条时间线索都用不上时才轮到它（沿用旧行为）。
  const fallbackOwner = pickPrimaryMainLeg(orderedMainLegs) ?? orderedMainLegs[0] ?? null;
  const hedgeLegs = legs.filter(isHedgeLeg).sort((a, b) => sequence(a) - sequence(b));
  const result = new Map<string, string>();
  const claimedHedgeLegs = new Set<string>();

  const ownerByTime = (order: CampaignReverseHedgeOrder): TradeJournal | null => {
    const t = timeMs(order.createdAt);
    if (t == null) return fallbackOwner;

    // A：委托挂出那一刻**正开着**的主力。同一刻有多笔时按金额定（残仓 vs 真主力）。
    const containing = orderedMainLegs.filter(leg => windowContains(windows.get(leg.id)!, t));
    if (containing.length > 0) {
      return pickPrimaryMainLeg(containing) ?? containing[0];
    }

    // B：当时空仓——归给**紧随其后**开出的那笔主力。挂在空仓期的单子是朝前看的，
    //    不可能是上一笔的遗留。开仓前预挂的反向空单也走这一支。
    const forward = orderedMainLegs
      .map(leg => ({ leg, open: windows.get(leg.id)!.openMs }))
      .filter((x): x is { leg: TradeJournal; open: number } => x.open != null && x.open > t)
      .sort((a, b) => a.open - b.open)[0];
    if (forward) return forward.leg;

    // C：所有主力都平完之后才挂出的——归给最后收尾的那笔。
    const backward = orderedMainLegs
      .map(leg => ({ leg, close: windows.get(leg.id)!.closeMs }))
      .filter((x): x is { leg: TradeJournal; close: number } => x.close != null && x.close <= t)
      .sort((a, b) => b.close - a.close)[0];
    if (backward) return backward.leg;

    // D：连开仓时刻都取不到的病态情形。
    return fallbackOwner;
  };

  for (const order of reverseHedgeOrders) {
    if (order.status === 'triggered' && hedgeLegs.length > 0) {
      const exactHedge = order.tradeRecordId
        ? hedgeLegs.find(leg => leg.trade_record_id === order.tradeRecordId)
        : null;
      const candidates = feasibleHedgeLegs(hedgeLegs, order)
        // 一条对冲腿只认领一张委托：否则一腿囤满、另一腿空着,
        // 正是主力那边被报上来的那个症状换到对冲侧重演。
        .filter(leg => !claimedHedgeLegs.has(leg.id));
      const matchedHedge = exactHedge ?? [...candidates].sort(
        (a, b) => triggeredHedgeMatchScore(a, order) - triggeredHedgeMatchScore(b, order),
      )[0];
      if (matchedHedge) {
        claimedHedgeLegs.add(matchedHedge.id);
        result.set(order.id, matchedHedge.id);
        continue;
      }
      // 没有可行的对冲腿时，按它**挂出**时保护的那笔主力归类——
      // 而不是无条件塞给金额最大的那笔。
    }
    const owner = ownerByTime(order);
    if (owner) result.set(order.id, owner.id);
  }

  return result;
}
