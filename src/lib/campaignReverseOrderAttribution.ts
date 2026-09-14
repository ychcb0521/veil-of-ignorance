import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';
import { pickPrimaryMainLeg } from '@/lib/campaignPrimaryMainLeg';
import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';

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

/**
 * 同一时刻有多笔主力开着时怎么裁决。
 *   size          —— 按名义金额（委托归属沿用此口径：残仓 vs 真主力靠金额分辨）
 *   nearest-open  —— 取开仓时刻最接近的那笔（镜像止盈与它的主力**同秒**开出，
 *                    这时「谁更近」是强信号，而金额不是）
 */
export type MainLegTieBreak = 'size' | 'nearest-open';

/**
 * 委托最终落在哪一行。
 *   main        —— 落在它保护的那笔主力上（风险口径用它：暴露、初始风险都以主力为锚）
 *   latest-add  —— 仅供**展示**：加仓之后挂出的委托落在「当时最新的那次加仓」那一行，
 *                  再加仓就接到更新的那一行后面。用户的原话是
 *                  「加仓之后，委托单就放在加仓那一行的后面」。
 *                  它只改变 Legs 表 / PNG 的行归属，**不得**被风险指标引用。
 */
export type ReverseOrderOwnerPolicy = 'main' | 'latest-add';

export interface ReverseOrderAttributionOptions {
  tieBreak?: MainLegTieBreak;
  /** 只被 buildCampaignReverseOrderLegMap 读取；createMainLegOwnerResolver 忽略它。 */
  ownerPolicy?: ReverseOrderOwnerPolicy;
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

/** 主力腿的时间归属器。风险口径与委托列表共用它——两处若各写一遍，迟早分叉。 */
export function createMainLegOwnerResolver(
  legs: TradeJournal[],
  options: ReverseOrderAttributionOptions = {},
): (createdAtMs: number | null | undefined) => TradeJournal | null {
  const windowFor = options.legWindow ?? defaultWindow;
  const tieBreak = options.tieBreak ?? 'size';
  const orderedMainLegs = legs.filter(isMainLeg).sort((a, b) => sequence(a) - sequence(b));
  const windows = new Map(orderedMainLegs.map(leg => [leg.id, windowFor(leg)] as const));
  // 兜底所有者：一条时间线索都用不上时才轮到它（沿用旧行为）。
  const fallbackOwner = pickPrimaryMainLeg(orderedMainLegs) ?? orderedMainLegs[0] ?? null;

  return (createdAtMs) => {
    const t = timeMs(createdAtMs);
    if (t == null) return fallbackOwner;

    // A：委托挂出那一刻**正开着**的主力。同一刻有多笔时按 tieBreak 裁决。
    const containing = orderedMainLegs.filter(leg => windowContains(windows.get(leg.id)!, t));
    if (containing.length > 0) {
      if (tieBreak === 'nearest-open') {
        return [...containing].sort((a, b) => {
          const da = Math.abs((windows.get(a.id)!.openMs ?? Number.MAX_SAFE_INTEGER) - t);
          const db = Math.abs((windows.get(b.id)!.openMs ?? Number.MAX_SAFE_INTEGER) - t);
          if (da !== db) return da - db;
          return sequence(a) - sequence(b);
        })[0];
      }
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
}

function isAddLeg(leg: TradeJournal): boolean {
  return Boolean(leg.leg_role?.startsWith('main_add_'));
}

/**
 * 委托在某一刻是否还挂着：撤单、触发都算结束；两者都没有就一直挂着。
 * 已触发的委托**以触发时刻为准**：journalApi 给触发单写的 cancelledAt 是它开出那条对冲的平仓时刻
 * （journalApi.ts:2606、2721），拿它当结束，会把「加仓前两分钟就已触发」的单子当成加仓时还挂着。
 */
function isLiveAt(order: CampaignReverseHedgeOrder, at: number): boolean {
  const endedAt = order.status === 'triggered'
    ? timeMs(order.triggeredAt) ?? timeMs(order.cancelledAt) ?? Number.POSITIVE_INFINITY
    : timeMs(order.cancelledAt) ?? timeMs(order.triggeredAt) ?? Number.POSITIVE_INFINITY;
  return endedAt > at;
}

/**
 * 「最新加仓」展示口径的归属器。
 *
 * 先照旧求出主力归属 B0（时间定资格、金额定主次，一步不改），再把它**往后挪**：
 * 加仓之后挂出的委托接到「这笔主力名下、当时还开着、开仓最晚」的那次加仓后面。
 *
 * 几条边界都来自实盘（TUTUSDT 2026-08-07）：
 *   - 加仓 2 开于 18:34，委托 18:34 挂、18:35 撤——同一分钟，属于加仓 2；
 *   - 委托 12:01 挂、15:18 撤，加仓 1 开于 12:02——为加仓预挂、加仓时还挂着，属于加仓 1；
 *   - 委托 19:42 挂、12:01 撤——加仓 1 出生前一分钟已撤，仍属主力。
 *
 * 顺序按**开仓时刻**排，从不读 main_add_N 里的 N：回填、改角色之后 N 与时间并不同序。
 */
function createLatestAddOwnerResolver(
  legs: TradeJournal[],
  options: ReverseOrderAttributionOptions,
  mainOwnerFor: (createdAtMs: number | null | undefined) => TradeJournal | null,
): (order: CampaignReverseHedgeOrder) => TradeJournal | null {
  const rawWindowFor = options.legWindow ?? defaultWindow;
  // 窗口同样走 timeMs 的「> 0」规则：成交记录 `openTime: pos.openTime || 0` 会写出 0，
  // resolveLegExecution 的 `??` 放它过去。不拦的话，这次加仓的窗口从 1970 开始，
  // 主力开出之后的委托全被它吃掉——而这一行的「开」列只显示「—」。
  const windowFor = (leg: TradeJournal): MainLegWindow => {
    const w = rawWindowFor(leg);
    return { openMs: timeMs(w.openMs), closeMs: timeMs(w.closeMs) };
  };
  const mainLegs = legs.filter(isMainLeg).sort((a, b) => sequence(a) - sequence(b));
  const windows = new Map(mainLegs.map(leg => [leg.id, windowFor(leg)] as const));
  const addLegs = mainLegs.filter(isAddLeg);
  // 腿上没有「加在哪笔主力上」的字段：取加仓开出那一刻开着的主力（不含加仓本身）。
  // 顺序开出的两笔主力各自的加仓因此互不串门。
  const anchorOwnerFor = createMainLegOwnerResolver(
    mainLegs.filter(leg => !isAddLeg(leg)),
    { legWindow: windowFor, tieBreak: 'size' },
  );
  const parentOf = new Map(addLegs.map(leg => [leg.id, anchorOwnerFor(windows.get(leg.id)!.openMs)] as const));

  const openOf = (leg: TradeJournal) => windows.get(leg.id)?.openMs ?? Number.NEGATIVE_INFINITY;
  // 开仓最晚者优先；同一刻开出的按 leg_sequence 大者、再按 id，保证结果可复现。
  const newestOpenFirst = (a: TradeJournal, b: TradeJournal) => {
    if (openOf(a) !== openOf(b)) return openOf(b) - openOf(a);
    const sa = a.leg_sequence ?? Number.NEGATIVE_INFINITY;
    const sb = b.leg_sequence ?? Number.NEGATIVE_INFINITY;
    if (sa !== sb) return sb > sa ? 1 : -1;
    return b.id.localeCompare(a.id);
  };
  // 与 createMainLegOwnerResolver 的 C 支同一判据：此刻没有主力开着、之后也不再开，且至少有一笔已平。
  const isAfterEverythingClosed = (t: number) => (
    !mainLegs.some(leg => windowContains(windows.get(leg.id)!, t))
    && !mainLegs.some(leg => {
      const open = windows.get(leg.id)!.openMs;
      return open != null && open > t;
    })
    && mainLegs.some(leg => {
      const close = windows.get(leg.id)!.closeMs;
      return close != null && close <= t;
    })
  );

  /** 以 t 为挂出时刻求这张委托落在哪一行。t 必须是有效时间戳。 */
  const resolveAt = (order: CampaignReverseHedgeOrder, t: number): TradeJournal | null => {
    const base = mainOwnerFor(t);
    if (base == null) return base;
    const parent = isAddLeg(base) ? parentOf.get(base.id) ?? null : base;
    if (parent == null) return base;

    // 主力开出之前预挂的，仍归主力——那时还谈不上加仓。
    const parentOpen = windows.get(parent.id)?.openMs ?? null;
    if (parentOpen == null || t < parentOpen) return parent;

    const candidates = addLegs.filter(add => {
      const addParent = parentOf.get(add.id) ?? null;
      const { openMs, closeMs } = windows.get(add.id)!;
      if (openMs == null || addParent == null) return false;
      if (addParent.id !== parent.id) {
        // 加仓挂靠的那笔主力已经平了、加仓还开着：它仍是「最新加上去的那一行」，
        // 接到此刻开着的主力名下——否则两笔主力并存时，大的一平，委托就从加仓行跳回小的那笔。
        // 但只接比这笔主力**开得晚**的：先后两笔主力时，主力 1 的加仓不抢主力 2 的委托。
        const addParentClose = windows.get(addParent.id)?.closeMs ?? null;
        if (addParentClose == null || addParentClose > t || openMs < parentOpen) return false;
      }
      if (t < openMs - PRE_MAIN_LOOKBACK_MS) return false;
      // 为这次加仓预挂的单子：必须在加仓开出那一刻还挂着，否则它从未与这次加仓共存。
      if (t < openMs && !isLiveAt(order, openMs)) return false;
      return closeMs == null || t < closeMs;
    });
    return candidates.sort(newestOpenFirst)[0] ?? parent;
  };

  return (order) => {
    const t = timeMs(order.createdAt);
    if (t == null) return mainOwnerFor(order.createdAt);

    // 全部平完之后才挂出的：当作「最后收尾前一刻」挂出的来归。
    // 主力与加仓常常同一刻一起平（TUTUSDT 四条腿都在 01:46），收尾前一分钟挂的落在哪一行，
    // 收尾后挂的就接在同一行——不许因为收尾那一刻的并列靠 leg_sequence 裁决而跳到另一行。
    if (isAfterEverythingClosed(t)) {
      const closes = mainLegs
        .map(leg => windows.get(leg.id)!.closeMs)
        .filter((close): close is number => close != null && close <= t);
      return resolveAt(order, Math.max(...closes) - 1);
    }
    return resolveAt(order, t);
  };
}

export function buildCampaignReverseOrderLegMap(
  legs: TradeJournal[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[],
  options: ReverseOrderAttributionOptions = {},
): Map<string, string> {
  const ownerFor = createMainLegOwnerResolver(legs, options);
  const latestAddOwnerFor = options.ownerPolicy === 'latest-add'
    ? createLatestAddOwnerResolver(legs, options, ownerFor)
    : null;
  const hedgeLegs = legs.filter(isHedgeLeg).sort((a, b) => sequence(a) - sequence(b));
  const result = new Map<string, string>();
  const claimedHedgeLegs = new Set<string>();

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
    const owner = latestAddOwnerFor ? latestAddOwnerFor(order) : ownerFor(order.createdAt);
    if (owner) result.set(order.id, owner.id);
  }

  return result;
}

/**
 * Legs 表与导出 PNG 的委托归属——两处**只调这一个函数**。
 *
 * 此前两边各抄了一份 legWindow，逻辑再加一条「最新加仓」就得改两处，
 * 改一处漏一处，导出图就成了又一套口径。收成一个函数后物理上不可能再分叉。
 * 持仓窗口与这一行渲染的「开 / 平」严格同源（resolveLegExecution，含平仓价校正）。
 */
export function buildDisplayReverseOrderLegMap(
  legs: TradeJournal[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[],
  recordMap: Map<string, TradeRecord>,
  legExitPriceCorrections: LegExitPriceCorrections = {},
): Map<string, string> {
  return buildCampaignReverseOrderLegMap(legs, reverseHedgeOrders, {
    legWindow: (leg) => {
      const rec = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
      const exec = resolveLegExecution(leg, rec, legExitPriceCorrections);
      return { openMs: exec.openTime ?? null, closeMs: exec.closeTime ?? null };
    },
    ownerPolicy: 'latest-add',
  });
}
