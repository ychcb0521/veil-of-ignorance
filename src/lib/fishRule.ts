/**
 * 「渔」规则文字。
 * 【用户要求】2026-10-19「公式要统一…不能重复 avg」：渔、K 线图、Deep dig 读同一份定义。
 * 2026-10-19 又要求「把渔这里的最外层的 avg 算法去除」：所选序列直接与阈值比较，规则写成「序列名 > 阈值」。
 */
import { compileFeatureFormula, RESULT_VAR, type DeepDigFeatureDef } from '@/lib/deepDig/features';

/** 「结果」指的量：公式最后一句的名字（与 Deep dig 的结果相同）；没起名时用简称。 */
export function fishResultName(def: Pick<DeepDigFeatureDef, 'formula' | 'short'>): string {
  try {
    const last = compileFeatureFormula(def.formula).program.statements.at(-1)?.name;
    return last && last !== RESULT_VAR ? last : (def.short || RESULT_VAR);
  } catch { return def.short || RESULT_VAR; }
}

/** 所选序列的显示名：「结果」写成最后一句的名字，其余照写。 */
export function fishStatisticName(def: Pick<DeepDigFeatureDef, 'formula' | 'short'> | undefined, statistic = RESULT_VAR): string {
  return statistic === RESULT_VAR ? (def ? fishResultName(def) : RESULT_VAR) : statistic;
}

/** 规则文字：<序列名> > 阈值 单位 [且 n 条约束]。 */
export function fishRuleText(def: Pick<DeepDigFeatureDef, 'formula' | 'short' | 'unit'> | undefined, direction: string, threshold: string | number, constraints = 0, statistic = RESULT_VAR): string {
  const unit = statistic === RESULT_VAR ? def?.unit : '原值';
  const t = String(threshold).trim() || '—';
  return `${fishStatisticName(def, statistic)} ${direction} ${t}${unit ? ` ${unit}` : ''}${constraints ? ` 且 ${constraints} 条约束` : ''}`;
}
