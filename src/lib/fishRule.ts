/**
 * 「渔」规则文字与定义核对。
 * 【用户要求】2026-10-19「同样的标准（CBI-2 的 24 小时均值、阈值 > 0.07）现在捕捉不到 RAVEUSDT 了」：
 * 新版渔按 Deep dig 里保存的定义算（公式最后一句 = 被平均的量），旧版用的是内置公式。Deep dig 里给公式末尾加了
 * 一行（如 avg_CBI2 = avg(CBI2, 24)）后，渔实际算的是 avg(avg_CBI2, 24h)——规则文字要写出真实的变量名，
 * 内置特征值的定义被改过时提醒一句，免得「看起来同一个标准、其实算的不是同一个量」。
 */
import { avgHoursOf, BUILTIN_FEATURES, formulaParamUse, formulaVariables, halfLifeOf, intervalOf, RESULT_VAR, type DeepDigFeatureDef } from '@/lib/deepDig/features';

/** 被平均的量的名字：公式最后一句起的名；没起名时用简称。 */
export function fishResultName(def: Pick<DeepDigFeatureDef, 'formula' | 'short'>): string {
  const r = formulaVariables(def.formula).result;
  return r === RESULT_VAR ? (def.short || RESULT_VAR) : r;
}

/** 规则文字：avg(<真实变量名>, Hh) > 阈值 单位 [且 n 条约束]。 */
export function fishRuleText(def: Pick<DeepDigFeatureDef, 'formula' | 'short' | 'unit'> | undefined, H: string | number, direction: string, threshold: string | number, constraints = 0): string {
  const name = def ? fishResultName(def) : RESULT_VAR;
  const h = String(H).trim() || '—';
  const t = String(threshold).trim() || '—';
  return `avg(${name}, ${h}h) ${direction} ${t}${def?.unit ? ` ${def.unit}` : ''}${constraints ? ` 且 ${constraints} 条约束` : ''}`;
}

/** 公式去掉注释与多余空白后再比，只改注释不算改过。 */
const normalizeFormula = (f: string) => f.split('\n').map(l => l.replace(/#.*$/, '').trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n');

export interface FishDefinitionDrift {
  /** 改过的项：公式 / 周期 / 半衰期 / 平均时长（后两项只在公式用到时才算）。 */
  changed: string[];
  /** 被平均的量：现在的与内置的。 */
  resultName: string;
  builtinResultName: string;
}

/** 内置特征值在 Deep dig 里被改过 → 返回改了什么；没改过、或是自己新增的特征值 → null。 */
export function fishDefinitionDrift(def: DeepDigFeatureDef): FishDefinitionDrift | null {
  const builtin = BUILTIN_FEATURES.find(b => b.id === def.id);
  if (!builtin) return null;
  const changed: string[] = [];
  if (normalizeFormula(def.formula) !== normalizeFormula(builtin.formula)) changed.push('公式');
  if (intervalOf(def) !== intervalOf(builtin)) changed.push('周期');
  const use = formulaParamUse(def.formula);
  if (use?.hl && halfLifeOf(def) !== halfLifeOf(builtin)) changed.push('半衰期');
  if (use?.avgh && avgHoursOf(def) !== avgHoursOf(builtin)) changed.push('平均时长');
  return changed.length ? { changed, resultName: fishResultName(def), builtinResultName: fishResultName(builtin) } : null;
}

/**
 * 「改用内置公式」：内置特征值在 Deep dig 里被改过时，渔可以不跟随、直接按内置定义捕捞（记在本账号本机，按特征值）。
 * 【用户要求】2026-10-19 RAVEUSDT 那一类信号很重要，最初版 CBI-2 能捕到、改过定义后捕不到——给一个一键回到最初版的开关。
 */
const BUILTIN_PREF_KEY = (prefix: string) => `${prefix}fish-use-builtin.v1`;
export function readUseBuiltin(prefix: string, read: (key: string) => string | null): string[] {
  try { const v = JSON.parse(read(BUILTIN_PREF_KEY(prefix)) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
export function writeUseBuiltin(prefix: string, ids: readonly string[], write: (key: string, raw: string) => unknown): void {
  write(BUILTIN_PREF_KEY(prefix), JSON.stringify([...new Set(ids)]));
}
/** 实际用来捕捞的定义：选了「改用内置公式」且确实有内置版本时用内置的，否则用 Deep dig 里保存的。 */
export function fishCalcDef(def: DeepDigFeatureDef | undefined, useBuiltinIds: readonly string[]): DeepDigFeatureDef | undefined {
  if (!def || !useBuiltinIds.includes(def.id)) return def;
  const builtin = BUILTIN_FEATURES.find(b => b.id === def.id);
  return builtin ? { ...builtin, builtin: true } : def;
}
