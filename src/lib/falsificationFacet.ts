/**
 * 证伪质量切面 · ex-ante 病根。
 *
 * 和错题集同一份已复盘交易，换一个切面：不按「错误种类」切，按「开仓那刻的证伪质量」切。
 * 每笔在下单瞬间就被 falsificationQuality 折算成富集 / 稀薄 / 贫瘠，
 * 这一层把它们归档成三档，看每一档后来「怎么死的」——
 *   贫瘠档（开仓即无明确证伪点）的亏损，是否果然过度集中在「后门」（死法不在预案内）。
 * 这正是录音稿的因果：后门死法不是平仓时的运气，是开仓时证伪贫瘠的必然产物。
 *
 * 全部由现有快照字段派生，纯函数、无副作用，便于测试。
 */
import type { TradeJournal } from '@/types/journal';
import {
  deriveFalsificationQuality,
  type FalsificationGrade,
} from '@/lib/falsificationQuality';
import type { LegTone } from '@/lib/structureLoop';
import { isReviewedMainTrade } from '@/lib/errorTypes';

const GRADE_ORDER: FalsificationGrade[] = ['rich', 'thin', 'poor'];

const GRADE_META: Record<FalsificationGrade, { label: string; tone: LegTone; hint: string }> = {
  rich: { label: '富集', tone: 'good', hint: '结构止损 + 可证伪信号：错了近、清晰、便宜' },
  thin: { label: '稀薄', tone: 'warn', hint: '只占一半：能证伪，但不锋利' },
  poor: { label: '贫瘠', tone: 'bad', hint: '没有明确证伪点：注定靠移动止损续命、走后门' },
};

export interface FalsificationGradeBucket {
  grade: FalsificationGrade;
  label: string;
  tone: LegTone;
  hint: string;
  count: number;
  winCount: number;
  lossCount: number;
  breakevenCount: number;
  /** 亏损里「死法不在预案内」(后门) 的笔数。 */
  backDoorLossCount: number;
  /** 后门占该档亏损的比例 0–1；该档无亏损为 null。 */
  backDoorRate: number | null;
  /** 平均 R（有 post_r_multiple 的样本）；无样本为 null。 */
  avgR: number | null;
  /** 该档交易，最近在前。 */
  journals: TradeJournal[];
}

export interface FalsificationFacet {
  /** 富集 → 稀薄 → 贫瘠 固定顺序。 */
  buckets: FalsificationGradeBucket[];
  totalReviewed: number;
  /** 贫瘠档的后门率（验证 ex-ante 病根 → 后门死法）。 */
  poorBackDoorRate: number | null;
  /** 富集档的后门率（作对照）。 */
  richBackDoorRate: number | null;
}

/** 把开仓快照折算成证伪质量评级（与 errorTypes「无证伪点开仓」同口径）。 */
function gradeOf(j: TradeJournal): FalsificationGrade {
  return deriveFalsificationQuality({
    stopQuality: j.pre_stop_quality ?? null,
    hasFalsificationSignal: !!(j.pre_falsification_signal && j.pre_falsification_signal.trim()),
    hasFalsificationDeadline: false,
    hasPlannedStop: j.pre_planned_stop_loss != null,
    counterTrend: j.pre_edge_source === 'mean_reversion' && j.pre_market_regime === 'trending',
  }).grade;
}

function tsOf(j: TradeJournal): number {
  const s = j.post_reviewed_at ?? j.pre_real_time ?? j.created_at;
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function buildBucket(grade: FalsificationGrade, journals: TradeJournal[]): FalsificationGradeBucket {
  const meta = GRADE_META[grade];
  const sorted = [...journals].sort((a, b) => tsOf(b) - tsOf(a));

  let winCount = 0;
  let lossCount = 0;
  let breakevenCount = 0;
  let backDoorLossCount = 0;
  const rs: number[] = [];

  for (const j of sorted) {
    if (j.post_outcome === 'win') winCount += 1;
    else if (j.post_outcome === 'loss') {
      lossCount += 1;
      if (j.exit_falsification_status === 'not_triggered') backDoorLossCount += 1;
    } else if (j.post_outcome === 'breakeven') breakevenCount += 1;
    if (typeof j.post_r_multiple === 'number') rs.push(j.post_r_multiple);
  }

  return {
    grade,
    label: meta.label,
    tone: meta.tone,
    hint: meta.hint,
    count: sorted.length,
    winCount,
    lossCount,
    breakevenCount,
    backDoorLossCount,
    backDoorRate: lossCount > 0 ? backDoorLossCount / lossCount : null,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    journals: sorted,
  };
}

/** 把已复盘主力单按证伪质量切成富集 / 稀薄 / 贫瘠三档。纯函数。 */
export function aggregateFalsificationFacet(journals: TradeJournal[]): FalsificationFacet {
  const base = journals.filter(isReviewedMainTrade);
  const byGrade = new Map<FalsificationGrade, TradeJournal[]>(GRADE_ORDER.map(g => [g, []]));
  for (const j of base) byGrade.get(gradeOf(j))!.push(j);

  const buckets = GRADE_ORDER.map(grade => buildBucket(grade, byGrade.get(grade)!));
  const rateOf = (grade: FalsificationGrade) => buckets.find(b => b.grade === grade)?.backDoorRate ?? null;

  return {
    buckets,
    totalReviewed: base.length,
    poorBackDoorRate: rateOf('poor'),
    richBackDoorRate: rateOf('rich'),
  };
}
