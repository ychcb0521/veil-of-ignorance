/**
 * 结构闭环判读 · 单笔平仓时的「看见 + 迭代」。
 *
 * 你押的从来不是一个期望值，是一个「结构闭环」：
 *   正 —— 最大概率的正向走势预期；
 *   反 —— 与正向预期不相符的判断准则（什么情况说明我错了）；
 *   止 —— 什么具体信号一出，就意味预期开始失效（死法）。
 * 期望值只是「正 / 胜率」这一片的标量投影。
 *
 * 平仓评价已经逐条核验过这三条腿的事实（premortem 复核 / 证伪状态 / 结构破坏复核 / Brier）。
 * 这一层不收集新数据，只把已核验的事实「收口」成一句裁决，并在死法走「后门」（不在预案内）时
 * 给出迭代指令 —— 把这次的死法前置成下次的「止」。
 *
 * 这是 structureMaturity（聚合层）在单笔尺度的镜像：同一套死法门口径（前门 / 晚门 / 后门）。
 * 纯函数、无副作用，便于测试。
 */
import type { ExitFalsificationStatus, TradeOutcome } from '@/types/journal';
import type { StructureResultQuadrant } from '@/lib/structureResult';
import type { OddsStructureReview } from '@/lib/oddsStructure';

/**
 * 死法门：这单「怎么死的」，只在亏损上判（赢时止损本不必触发）。
 *   front 前门 = 按预案触发并执行（triggered_reacted）—— 干净的死法；
 *   late  晚门 = 看见了却晚动（triggered_late）—— 执行差，不是结构差；
 *   back  后门 = 死法不在预案内（not_triggered）—— 没建模的失败模式，最危险的尾部。
 */
export type DeathDoor = 'front' | 'late' | 'back';

/**
 * 闭环裁决：
 *   intact  完整 —— 赢，或亏但从前门走（真死时是按预案死的）；
 *   lagged  迟滞 —— 晚门死法：信号在预案内，但反应晚了（执行差）；
 *   gap     有缺口 —— 后门死法：死法不在预案内，必须迭代把它前置成「止」；
 *   pending 待判读 —— 亏损但「止」还没核验 / 本笔没有预设止损信号。
 */
export type LoopVerdict = 'intact' | 'lagged' | 'gap' | 'pending';

/** 单条腿的呈现色调（视图层映射到品牌色，库本身不关心具体色值）。 */
export type LegTone = 'good' | 'warn' | 'bad' | 'muted';

export interface LoopLeg {
  /** 这条腿平仓后的状态短语（可直接渲染）。 */
  status: string;
  tone: LegTone;
}

export interface LoopReadout {
  verdict: LoopVerdict;
  deathDoor: DeathDoor | null;
  /** 正 —— 正向预期是否兑现。 */
  zheng: LoopLeg;
  /** 反 —— 失败准则是否成立。 */
  fan: LoopLeg;
  /** 止 —— 死法门。 */
  zhi: LoopLeg;
}

/**
 * 把（结果, 证伪状态）映射到死法门。赢 / 保本 / 未评价证伪状态 → null（不下结论）。
 * 与 structureMaturity 共用同一口径，避免两处各写一遍 switch。
 */
export function classifyDeathDoor(
  outcome: TradeOutcome | null | undefined,
  status: ExitFalsificationStatus | null | undefined,
): DeathDoor | null {
  if (outcome !== 'loss') return null;
  switch (status) {
    case 'triggered_reacted':
      return 'front';
    case 'triggered_late':
      return 'late';
    case 'not_triggered':
      return 'back';
    default:
      return null;
  }
}

export interface LoopReadoutInput {
  outcome: TradeOutcome | null | undefined;
  /** 结构 × 结果四象限（决定「正」在亏损时是『结构对·属方差』还是『真错了』）。 */
  quadrant: StructureResultQuadrant | null;
  /** 结构破坏复核（赔率结构那条腿，作「反」是否成立的结构化代理）。 */
  oddsReview: OddsStructureReview | null;
  /** premortem 复核是否已填（无结构化代理时退回「已核验 / 待核验」）。 */
  premortemReviewFilled: boolean;
  /** 证伪状态（前门 / 晚门 / 后门的原始来源）。 */
  falsificationStatus: ExitFalsificationStatus | null | undefined;
  /** 开仓时是否写下了预设止损 / 证伪信号。无 → 后门由构造而来，无法判门。 */
  hasFalsificationPlan: boolean;
}

/** 把已核验的三条腿事实收口成一份单笔闭环判读。纯函数。 */
export function deriveLoopReadout(input: LoopReadoutInput): LoopReadout {
  const {
    outcome,
    quadrant,
    oddsReview,
    premortemReviewFilled,
    falsificationStatus,
    hasFalsificationPlan,
  } = input;

  const deathDoor = classifyDeathDoor(outcome, falsificationStatus);

  const verdict: LoopVerdict =
    outcome === 'win'
      ? 'intact'
      : deathDoor === 'front'
        ? 'intact'
        : deathDoor === 'late'
          ? 'lagged'
          : deathDoor === 'back'
            ? 'gap'
            : 'pending';

  // 正 —— 正向预期是否兑现。亏损时区分「结构对·属方差」与「真错了」。
  const zheng: LoopLeg =
    outcome === 'win'
      ? { status: '兑现', tone: 'good' }
      : quadrant === 'correct_loss'
        ? { status: '未兑现 · 结构对', tone: 'warn' }
        : { status: '未兑现', tone: 'bad' };

  // 反 —— 失败准则是否成立。优先用结构破坏复核（结构化），否则退回是否已核验。
  const fan: LoopLeg =
    oddsReview === 'wrong'
      ? { status: '成立 · 结构破了', tone: 'bad' }
      : oddsReview === 'mixed'
        ? { status: '部分成立', tone: 'warn' }
        : oddsReview === 'right'
          ? { status: '未成立 · 结构守住', tone: 'good' }
          : { status: premortemReviewFilled ? '已核验' : '待核验', tone: 'muted' };

  // 止 —— 死法门。
  const zhi: LoopLeg =
    outcome === 'win'
      ? { status: '未触发 · 盈利离场', tone: 'good' }
      : deathDoor === 'front'
        ? { status: '前门 · 按预案止损', tone: 'good' }
        : deathDoor === 'late'
          ? { status: '晚门 · 看见了却晚动', tone: 'warn' }
          : deathDoor === 'back'
            ? { status: '后门 · 死法不在预案内', tone: 'bad' }
            : { status: hasFalsificationPlan ? '待核验' : '本笔未设止', tone: 'muted' };

  return { verdict, deathDoor, zheng, fan, zhi };
}
