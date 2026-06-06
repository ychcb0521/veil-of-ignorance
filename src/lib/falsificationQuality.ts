/**
 * 证伪质量 · 开仓那一刻就能定的「病根」。
 *
 * 录音稿的第一性原理：顺势 / 逆势的不对称，不在胜率，而在「证伪结构」——
 *   顺势回调买 = 证伪富集：证伪点近、清晰、便宜，灵敏度高 → 错了很快看见、退得起；
 *   逆势抄底   = 证伪贫瘠：没有明确证伪点，容错率低，把主动权交了出去，
 *                只能不停把止损往下挪 —— 这正是「后门死法」的制造机。
 *
 * 所以「怎么死的」（死法门）不是平仓时才有的运气，开仓快照里就已经埋好：
 *   后门死法（死法不在预案内）是「开仓时没有明确证伪点」的必然产物。
 * 这个库把快照里的几个字段，收口成一个 ex-ante 的证伪质量评级，
 * 并预报它是否「注定走后门」。纯函数、无副作用，便于测试。
 *
 * 与 structureLoop / structureMaturity 的死法门口径同源：
 *   富集 ↔ 前门（顺势天命）；贫瘠 ↔ 后门（逆势宿命）。
 */
import type { LegTone } from '@/lib/structureLoop';
import type { StopQuality } from '@/types/journal';

/**
 * 证伪质量评级：
 *   rich 富集 —— 有结构性失效位，且有可证伪的信号 / 时限：错了近、清晰、便宜；
 *   thin 稀薄 —— 只有一半（要么结构止损、要么信号），不齐：能证伪，但不锋利；
 *   poor 贫瘠 —— 没有明确证伪点：只能靠移动止损续命，注定把主动权交出去。
 */
export type FalsificationGrade = 'rich' | 'thin' | 'poor';

export interface FalsificationQualityInput {
  /** 止损质量：结构失效位（structural）才是真证伪点；按百分比拍的（arbitrary）不算。 */
  stopQuality: StopQuality | null;
  /** 是否写下了可证伪的信号（pre_falsification_signal：什么信号一出就说明我错了）。 */
  hasFalsificationSignal: boolean;
  /** 是否写下了证伪时限（多久内不兑现就算错）。快照暂无此字段时留空。 */
  hasFalsificationDeadline?: boolean;
  /** 是否写下了预设止损价位（pre_planned_stop_loss）。 */
  hasPlannedStop: boolean;
  /** 是否逆势（在下跌结构里做多 / 上涨结构里做空）。逆势让证伪点天然贫瘠，降一级。 */
  counterTrend?: boolean | null;
}

export interface FalsificationQualityReadout {
  grade: FalsificationGrade;
  tone: LegTone;
  /** 这份证伪质量是否预报「注定走后门」（死法不在预案内）。 */
  predictsBackDoor: boolean;
  /** 评级理由（可直接渲染）。 */
  reasons: string[];
}

const TONE_BY_GRADE: Record<FalsificationGrade, LegTone> = {
  rich: 'good',
  thin: 'warn',
  poor: 'bad',
};

/** 逆势降一级：富集→稀薄→贫瘠，贫瘠到底。 */
function demote(grade: FalsificationGrade): FalsificationGrade {
  if (grade === 'rich') return 'thin';
  return 'poor';
}

/** 把开仓快照里的证伪相关字段，收口成一份 ex-ante 证伪质量评级。纯函数。 */
export function deriveFalsificationQuality(
  input: FalsificationQualityInput,
): FalsificationQualityReadout {
  const {
    stopQuality,
    hasFalsificationSignal,
    hasFalsificationDeadline = false,
    hasPlannedStop,
    counterTrend = null,
  } = input;

  const structural = stopQuality === 'structural';
  const hasFalsifier = hasFalsificationSignal || hasFalsificationDeadline;

  // 贫瘠：没有结构止损，也没有任何可证伪信号 / 时限，
  // 唯一的「证伪点」要么没有、要么是按百分比拍的 —— 注定靠移动止损续命。
  const onlyFalsifierIsWeak =
    !structural &&
    !hasFalsificationSignal &&
    !hasFalsificationDeadline &&
    (!hasPlannedStop || stopQuality === 'arbitrary');

  let grade: FalsificationGrade;
  if (onlyFalsifierIsWeak) {
    grade = 'poor';
  } else if (structural && hasFalsifier) {
    grade = 'rich';
  } else {
    grade = 'thin';
  }

  const reasons: string[] = [];
  if (structural) reasons.push('止损在结构失效位');
  else if (stopQuality === 'arbitrary') reasons.push('止损按百分比 / 资金量拍的');
  else if (hasPlannedStop) reasons.push('有止损价但未标结构性');
  else reasons.push('没有预设止损价');

  if (hasFalsificationSignal) reasons.push('有可证伪信号');
  if (hasFalsificationDeadline) reasons.push('有证伪时限');
  if (!hasFalsifier) reasons.push('没有可证伪信号 / 时限');

  if (counterTrend) {
    const before = grade;
    grade = demote(grade);
    reasons.push(grade !== before ? '逆势：证伪点天然贫瘠，降一级' : '逆势：证伪点已贫瘠');
  }

  return {
    grade,
    tone: TONE_BY_GRADE[grade],
    predictsBackDoor: grade === 'poor',
    reasons,
  };
}
