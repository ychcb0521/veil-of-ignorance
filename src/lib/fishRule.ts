/**
 * 「渔」规则文字与定义核对。
 * 【用户要求】2026-10-19「同样的标准（CBI-2 的 24 小时均值、阈值 > 0.07）现在捕捉不到 RAVEUSDT 了」：
 * 2026-10-19 又要求「公式要统一…不能重复 avg」「你要保证内在统一」：渔、K 线图、Deep dig 读同一份定义，
 * 被平均的是核心值 X（规则见 featureSource）；不再有「改用内置公式」与提醒。
 */
import { compileFeatureFormula, RESULT_VAR, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { featureCoreName } from '@/lib/featureSource';

/** 被平均的量的名字：核心值 X（末尾的纯均值行不算）；最后一句没起名时用简称。 */
export function fishResultName(def: Pick<DeepDigFeatureDef, 'formula' | 'short'>): string {
  try {
    const core = featureCoreName(compileFeatureFormula(def.formula).program);
    return core ?? (def.short || RESULT_VAR);
  } catch { return def.short || RESULT_VAR; }
}

/** 规则文字：avg(<核心值名>, Hh) > 阈值 单位 [且 n 条约束]。 */
export function fishRuleText(def: Pick<DeepDigFeatureDef, 'formula' | 'short' | 'unit'> | undefined, H: string | number, direction: string, threshold: string | number, constraints = 0): string {
  const name = def ? fishResultName(def) : RESULT_VAR;
  const h = String(H).trim() || '—';
  const t = String(threshold).trim() || '—';
  return `avg(${name}, ${h}h) ${direction} ${t}${def?.unit ? ` ${def.unit}` : ''}${constraints ? ` 且 ${constraints} 条约束` : ''}`;
}
