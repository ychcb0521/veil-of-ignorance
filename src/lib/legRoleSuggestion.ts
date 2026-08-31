import { MAIN_ADD_ROLES } from '@/lib/strategyTemplates';
import type { LegRole, SuggestedLegRole, TradeJournal } from '@/types/journal';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

function timeMs(journal: TradeJournal): number {
  return new Date(journal.pre_simulated_time).getTime();
}

function isTriggeredHedge(journal: TradeJournal): boolean {
  return journal.order_kind === 'hedge' && journal.trade_record_id != null;
}

function finitePrice(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 两个价是不是同一个价。用相对误差：这套系统里价格从 0.000012 到 120000 都有，
 * 固定的绝对容差在任一端都会失效。
 */
function samePrice(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(1e-9, scale * 1e-6);
}

/**
 * 这张对冲单是不是压在主力开仓价上。
 *   on_line  委托价与触发价都落在主力开仓价 → 初始对冲（A / B）
 *   off_line 两个价都记了，但没落在开仓价上 → 不是初始对冲
 *   unknown  价没记全（老快照），判据用不上，交给时间窗口兜底
 */
type HedgePriceVerdict = 'on_line' | 'off_line' | 'unknown';

function hedgePriceVerdict(journal: TradeJournal, mainEntryPrices: number[]): HedgePriceVerdict {
  if (mainEntryPrices.length === 0) return 'unknown';
  const orderPrice = finitePrice(journal.pre_entry_price);
  const triggerPrice = finitePrice(journal.hedge_boundary_price);
  if (orderPrice == null || triggerPrice == null) return 'unknown';
  const onMainEntry = (price: number) => mainEntryPrices.some(main => samePrice(price, main));
  return onMainEntry(orderPrice) && onMainEntry(triggerPrice) ? 'on_line' : 'off_line';
}

export interface SuggestLegRolesOptions {
  /**
   * 该腿的真实成交价（有成交记录时）。主力的计划价与实际成交价常差一个滑点，
   * 而对冲单是照着**实际**成本线挂的——两个价都认，免得判据被一个 tick 打偏。
   */
  filledEntryPrice?: (journal: TradeJournal) => number | null | undefined;
}

/**
 * 初始对冲（对冲单 A / B）认的是**价格**，不是时间。
 *
 * 这套打法里 A、B 两张挂在主力开仓价上：委托价与触发价都压在成本线，
 * 价格跌回成本线就翻成反向仓，把这一段的风险抹平——所以它们的定义就是
 * 「挂在主力开仓价上的那两张」。此前用「主仓开仓后 30 分钟内」当代理，
 * 那只是时间上的巧合：半小时内挂在别的价位的滚动对冲会被误判成 A/B，
 * 半小时后才补挂到成本线上的 A/B 又会被漏掉。
 *
 * 价格判据只在委托价与触发价都记了的时候成立；老快照没记边界价的，
 * 仍然退回 30 分钟窗口，并在 reason 里写明是哪条判据出的结论。
 */
export function suggestLegRoles(
  journals: TradeJournal[],
  options?: SuggestLegRolesOptions,
): SuggestedLegRole[] {
  const sorted = [...journals].sort((a, b) => timeMs(a) - timeMs(b));
  const suggestions: SuggestedLegRole[] = [];

  const firstMain = sorted.find(journal => journal.order_kind === 'main') ?? null;
  const firstMainTime = firstMain ? timeMs(firstMain) : null;
  const firstMirrorTpTime = sorted.find(journal => journal.leg_role === 'mirror_tp') ? timeMs(sorted.find(journal => journal.leg_role === 'mirror_tp') as TradeJournal) : null;

  // 主力开仓价的两个说法：快照里的计划价，和真正成交的价。
  const mainEntryPrices = firstMain
    ? ([
      finitePrice(firstMain.pre_entry_price),
      finitePrice(options?.filledEntryPrice?.(firstMain)),
    ].filter((price): price is number => price != null))
    : [];

  let initialHedgeCount = 0;
  let mainAssigned = false;
  let mainAddCount = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const journal = sorted[index];
    const previous = sorted[index - 1] ?? null;

    let suggestedRole: LegRole = 'standalone';
    let confidence: SuggestedLegRole['confidence'] = 'low';
    let reason = '无法自动推断，请手动选择';

    if (journal.order_kind === 'main') {
      if (!mainAssigned) {
        suggestedRole = 'main_open';
        confidence = 'high';
        reason = '时间最早的主力订单';
        mainAssigned = true;
      } else {
        // 不夹逼索引：越过最后一个加仓槽时让下标越界，?? 的溢出兜底才有机会触发。
        // 夹逼会把第 7、8、9…笔全部标成同一个「加仓6」——一个对八行都相同的「建议」
        // 不含任何信息，还把「我不知道」伪装成了一个具体且笃定的答案。
        suggestedRole = MAIN_ADD_ROLES[mainAddCount] ?? 'reentry_main';
        mainAddCount += 1;
        if (previous && isTriggeredHedge(previous)) {
          confidence = 'medium';
          reason = '前一笔为已触发的对冲订单，推测为对冲后重入主仓';
        } else {
          confidence = 'medium';
          reason = `main_open 之后出现的同向主力订单，建议作为 ${suggestedRole}`;
        }
      }
    } else if (journal.order_kind === 'hedge') {
      const currentTime = timeMs(journal);
      const inInitialWindow = firstMainTime != null && currentTime - firstMainTime >= 0 && currentTime - firstMainTime <= THIRTY_MINUTES_MS;

      const verdict = hedgePriceVerdict(journal, mainEntryPrices);
      const takeInitialSlot = (): LegRole => {
        const role: LegRole = initialHedgeCount === 0 ? 'hedge_initial_a' : 'hedge_initial_b';
        initialHedgeCount += 1;
        return role;
      };

      if (verdict === 'on_line' && initialHedgeCount < 2) {
        suggestedRole = takeInitialSlot();
        confidence = 'high';
        reason = '委托价与触发价都在主力开仓价上 = 初始对冲';
      } else if (verdict === 'unknown' && inInitialWindow && initialHedgeCount < 2) {
        // 老快照没记委托价 / 触发价，只能退回时间代理——并且把这件事说出来。
        suggestedRole = takeInitialSlot();
        confidence = 'medium';
        reason = '缺委托价 / 触发价，按时间判：主仓开仓后 30 分钟内的对冲挂单';
      } else {
        suggestedRole = 'hedge_rolling';
        if (verdict === 'on_line') {
          confidence = 'low';
          reason = '同样挂在主力开仓价上，但 A、B 两个槽已占满，请手动确认';
        } else if (verdict === 'off_line') {
          confidence = 'medium';
          reason = '委托价 / 触发价不在主力开仓价上，不是初始对冲';
        } else if (firstMirrorTpTime != null && currentTime >= firstMirrorTpTime) {
          confidence = 'medium';
          reason = '镜像止盈之后出现的新对冲订单';
        } else if (firstMainTime != null && currentTime - firstMainTime > THIRTY_MINUTES_MS) {
          confidence = 'low';
          reason = '主仓开仓 30 分钟之后的对冲订单';
        } else {
          confidence = 'low';
          reason = '无法区分是滚动对冲还是独立对冲，请手动确认';
        }
      }
    }

    suggestions.push({
      journalId: journal.id,
      suggestedRole,
      confidence,
      reason,
    });
  }

  return suggestions;
}

// ===== 裸仓位历史记录的角色建议（归类历史交易用） =====

export interface OrphanRecordRoleInput {
  id: string;
  direction: 'long' | 'short';
  openTimeMs: number;
  /** 平仓时间（毫秒）；0 / null 视为仍持有。 */
  closeTimeMs: number | null;
  exitMethod?: string | null;
  /** 这一片属于哪一笔成交；合并仓位的一次平仓会拆成多片。缺省时按 id 自成一组。 */
  fillId?: string | null;
  /** 开仓价。镜像与主力**同价**开出，加仓必然不同价——这是两者的分水岭。 */
  entryPrice?: number | null;
  /** 名义或数量（同一战役内单位一致即可）。只用来看 60/40 分割，不参与金额计算。 */
  size?: number | null;
}

export interface OrphanRecordRoleSuggestion {
  id: string;
  suggestedRole: LegRole;
  confidence: SuggestedLegRole['confidence'];
  reason: string;
}

/**
 * 裸 record 归类的角色语义（与实盘策略对齐）：
 *   ① 交易记录里「止盈1」平仓的那笔就是镜像止盈——镜像多单挂止盈先落袋；
 *   ② 同向仓位里【留到最后平掉】的那笔才是主力 main_open——主力按定义
 *      比镜像活得久，仍持有的记录视为最晚平掉；
 *   ③ 其余同向记录按开仓先后排为主力加仓；反向记录仍建议滚动对冲。
 * 若最后平掉的那笔恰好也是止盈1（例如全部记录都走了止盈1），主力判定优先——
 * 战役必须有 main_open，镜像身份让位。
 */
/**
 * 按**成交**定角色,而不是按记录。
 *
 * 合并仓位的一次平仓会拆成多片记录,同一笔成交可能出现在很多次平仓里。
 * 若按记录逐条定角色:
 *   · 一次止盈平掉 3 笔成交,会冒出**两条**「镜像止盈」——
 *     而 mirror_tp 是计入开仓敞口的,加仓的名义会从这扇错门重新混进风险口径;
 *   · N 笔成交 × S 次平仓会在分类界面里炸出 N·S 行。
 * 每笔成交只出一个角色,代表片取它最早的那次平仓。
 */
export function suggestOrphanRecordRoles(
  records: OrphanRecordRoleInput[],
  mainDirection: 'long' | 'short',
): OrphanRecordRoleSuggestion[] {
  const groups = new Map<string, OrphanRecordRoleInput[]>();
  for (const r of records) {
    const key = r.fillId ?? r.id;
    const list = groups.get(key);
    if (list) list.push(r); else groups.set(key, [r]);
  }
  if (groups.size !== records.length) {
    /**
     * 每组选一个代表片:该笔成交**最晚**平掉的那一次,不是最早那次。
     *
     * 部分平仓是按比例缩每一笔成交的,所以每一刀都会给**所有**成交各写一条记录——
     * 各组的平仓时刻集合完全相同,取最早等于没取。真正的差别在 exit_method:
     * 最早那一片带的是第一刀的退出方式(镜像止盈分批减仓时就是 'tp1'),
     * 于是加仓会继承主力第一刀的止盈方式、被判成 mirror_tp 而不是加仓。
     * 最晚那一片才是这笔成交**自己**真正的结束方式。
     */
    const repIdByGroup = new Map<string, string>();
    const reps: OrphanRecordRoleInput[] = [];
    for (const [key, list] of groups) {
      const rep = [...list].sort(
        (a, b) => (b.closeTimeMs ?? Infinity) - (a.closeTimeMs ?? Infinity),
      )[0];
      repIdByGroup.set(key, rep.id);
      reps.push(rep);
    }
    // 只对代表片跑一遍原算法,再把结论发回组内每一片(调用方按记录 id 查)。
    const byRepId = new Map(suggestOrphanRecordRoles(reps, mainDirection).map(x => [x.id, x]));
    return records.flatMap(r => {
      const repId = repIdByGroup.get(r.fillId ?? r.id);
      const suggestion = repId != null ? byRepId.get(repId) : undefined;
      return suggestion ? [{ ...suggestion, id: r.id }] : [];
    });
  }

  const effectiveClose = (record: OrphanRecordRoleInput): number =>
    record.closeTimeMs != null && record.closeTimeMs > 0 ? record.closeTimeMs : Number.POSITIVE_INFINITY;

  /**
   * 结构性地认出镜像止盈——**不依赖 exit_method**。
   *
   * 从币安导入的裸 record 没有 exit_method，原来只认 `exitMethod === 'tp1'`，
   * 于是镜像整批掉进兜底分支被当成加仓。而加仓一旦被当成 mirror_tp（或反过来），
   * mirror_tp 是计入 ex-ante 开仓敞口的，加仓的名义会从这扇错门混进风险口径。
   *
   * 真正的分水岭是**什么时候开的**，不是怎么平的：
   *   · 镜像：与主力**同一刻、同一价**开出（策略模板写的就是「开主力单时同时挂」），然后**先平**
   *   · 加仓：**后来**才开，价格**必然不同**（同价就没有加仓的理由）
   *
   * 实盘 TURBOUSDT 2025-04-23：两笔同为 11:31:07 开、同为 0.0034，
   * 一笔 12:19 平（822,920）、一笔 15:08 平（548,620）——822920/1371540 = 60.0%，
   * 正是策略写死的 60% 镜像 / 40% 主力。加仓不会长成这个形状。
   */
  const OPEN_TOLERANCE_MS = 120_000;   // 同一批委托挂出的时间窗
  const PRICE_TOLERANCE = 0.01;        // 同价（留出滑点）
  const MIRROR_SHARE = 0.6;            // 策略写死的镜像占比

  const samePrice = (a: number | null | undefined, b: number | null | undefined): boolean => {
    if (!(typeof a === 'number' && Number.isFinite(a) && a > 0)) return false;
    if (!(typeof b === 'number' && Number.isFinite(b) && b > 0)) return false;
    return Math.abs(a - b) <= Math.max(a, b) * PRICE_TOLERANCE;
  };

  /**
   * 找出「这一笔是谁的镜像」：同向、同刻、同价，而对方**活得更久**。
   * 用「存在这样的兄弟」而不是「等于那个 mainId」，多笔主力各带镜像时也成立。
   */
  const mirrorHostOf = (record: OrphanRecordRoleInput): OrphanRecordRoleInput | null =>
    records.find(other => other.id !== record.id
      && other.direction === record.direction
      && effectiveClose(other) > effectiveClose(record)
      && Math.abs(other.openTimeMs - record.openTimeMs) <= OPEN_TOLERANCE_MS
      && samePrice(other.entryPrice, record.entryPrice)) ?? null;

  /** 60/40 分割对上了就给高置信度，对不上仍然判镜像但降一档。 */
  const splitMatches = (record: OrphanRecordRoleInput, host: OrphanRecordRoleInput): boolean => {
    const a = Number(record.size), b = Number(host.size);
    if (!(Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0)) return false;
    return Math.abs(a / (a + b) - MIRROR_SHARE) <= 0.05;
  };

  const sameDirection = records.filter(record => record.direction === mainDirection);
  let mainId: string | null = null;
  for (const record of sameDirection) {
    if (mainId == null) {
      mainId = record.id;
      continue;
    }
    const current = sameDirection.find(candidate => candidate.id === mainId)!;
    if (
      effectiveClose(record) > effectiveClose(current)
      || (effectiveClose(record) === effectiveClose(current) && record.openTimeMs < current.openTimeMs)
    ) {
      mainId = record.id;
    }
  }

  const byOpenTime = [...records].sort((a, b) => a.openTimeMs - b.openTimeMs);
  let addCount = 0;
  const out: OrphanRecordRoleSuggestion[] = [];
  for (const record of byOpenTime) {
    if (record.direction !== mainDirection) {
      out.push({
        id: record.id,
        suggestedRole: 'hedge_rolling',
        confidence: 'low',
        reason: '反向历史成交更像滚动对冲或独立单，请按实际意图确认',
      });
      continue;
    }
    if (record.id === mainId) {
      out.push({
        id: record.id,
        suggestedRole: 'main_open',
        confidence: 'high',
        reason: '同向仓位中留到最后平掉的一笔，即主力',
      });
      continue;
    }
    if (record.exitMethod === 'tp1') {
      out.push({
        id: record.id,
        suggestedRole: 'mirror_tp',
        confidence: 'high',
        reason: '以「止盈1」平仓 = 镜像止盈落袋',
      });
      continue;
    }
    // 裸 record 没有 exit_method，改用结构判据：与主力同刻同价开出、且先平。
    const host = mirrorHostOf(record);
    if (host != null) {
      const split = splitMatches(record, host);
      out.push({
        id: record.id,
        suggestedRole: 'mirror_tp',
        confidence: split ? 'high' : 'medium',
        reason: split
          ? '与主力同刻同价开出、先行平仓，且占比 ≈ 60% = 镜像止盈'
          : '与主力同刻同价开出并先行平仓 = 镜像止盈（占比未落在 60% 附近，请确认）',
      });
      continue;
    }
    // 同上：加仓槽用尽后退到 reentry_main，而不是把所有溢出的都叫「加仓6」。
    const addRole = MAIN_ADD_ROLES[addCount] ?? 'reentry_main';
    addCount += 1;
    out.push({
      id: record.id,
      suggestedRole: addRole,
      confidence: 'medium',
      reason: '同向后续仓位，建议作为主力加仓 leg',
    });
  }
  return out;
}
