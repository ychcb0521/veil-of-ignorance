/**
 * 【用户要求】2026-11-03「原来的模版数据非常珍贵，一定要能够复原出来」：持仓监测的旧引擎。
 *
 * 2026-11-01 加仓改成箱体位置（DBL / SBS）、删掉入场距离、涨幅门槛改为相对成本线 S。在那之前算出的战役（例如 10-31
 * 「卖出算法组合2」RAVE +10027.38），用当前引擎重跑会得到完全不同的结果——不是参数丢了，是算法换了。
 * 这里把 10-31 的引擎原样冻结成 legacy/qualityEngine20261031.js，标了 engine 的方案一律交给它算：15 笔与原结果逐位一致。
 *
 * 规则：
 *  - 只有方案带 engine＝quality-engine-2026-10-31 才走旧引擎；普通方案照旧走当前引擎，不受影响。
 *  - 旧引擎方案的版本清单＝「引擎」＋「全部参数指纹」：参数被任何代码或界面改动，都按版本不符拦下，不会悄悄换算法。
 *  - 不跟随账号公式（10-31 冻结的公式全文原样使用），在条件设置里只读（除名称外不能改）。
 */
import { shortFishHash } from './algorithm';
import type { QualityGroup, QualityResult, QualitySample } from './quality';
import type { QualityAdditionRule } from './qualityAddition';
import type { PlanVersionEntry } from './qualityPlanVersions';
import type { FishReconstructionLoader } from './reconstruction';

export const LEGACY_QUALITY_ENGINE = 'quality-engine-2026-10-31' as const;
export type QualityEngineId = typeof LEGACY_QUALITY_ENGINE;
/** 冻结文件的来源提交与正文 SHA-256（文件头里同样写着；测试核对两者一致）。 */
export const LEGACY_ENGINE_COMMIT = 'bb003e0c';
export const LEGACY_ENGINE_SHA256 = 'bd6bbf7363d7d59a0e8419f428dd7a292b740978762b5c42a01c35ede1500f3f';
export const LEGACY_ENGINE_LABEL = '2026-10-31 旧引擎';

export const isLegacyQualityPlan = (plan?: Pick<QualityGroup, 'engine'> | null) => plan?.engine === LEGACY_QUALITY_ENGINE;

/**
 * 11-01 之前的加仓形态：设置里还带着 entryBufferAtr（入场距离 T ≥ S＋n×ATR，11-01 应用户要求删除）。
 * 11-01 之后的编辑器保存时不再写这个字段，所以带着它的方案只可能是旧引擎算的。
 */
export function hasPreBoxAdditionShape(plan: Pick<QualityGroup, 'addition'>): boolean {
  const a = plan.addition;
  if (!a?.enabled) return false;
  return [a, ...(a.rounds ?? [])].some(r => r.entryBufferAtr != null);
}

/** 键按字母排序后再序列化：同一方案经过存储、同步、复制后指纹不变。 */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => (value as Record<string, unknown>)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
/** 全部参数的指纹（不含编号、名称与版本清单本身）。 */
export function legacyParamsFingerprint(plan: QualityGroup): string {
  const { id: _id, label: _label, frozenVersions: _frozen, ...params } = plan;
  return '参数 #' + shortFishHash(stable(params));
}
export function legacyPlanVersions(plan: QualityGroup): PlanVersionEntry[] {
  return [
    { key: 'engine', part: '计算引擎', name: LEGACY_ENGINE_LABEL, version: `${LEGACY_QUALITY_ENGINE} · ${LEGACY_ENGINE_COMMIT}`,
      summary: '冻结的 10-31 引擎：加仓按自选指标＋入场距离 T ≥ S＋n×ATR、K＝T−m×ATR，涨幅门槛相对持仓均价' },
    { key: 'legacy-params', part: '全部参数', name: '方案参数', version: legacyParamsFingerprint(plan), summary: '旧引擎方案只读：任何参数变动都会被拦下' },
  ];
}
/** 给方案标上旧引擎并冻结对应的版本清单（替换掉按当前代码误记的清单）。 */
export function withLegacyEngine(plan: QualityGroup): QualityGroup {
  const { frozenVersions: _frozen, ...rest } = plan;
  const tagged: QualityGroup = { ...rest, engine: LEGACY_QUALITY_ENGINE };
  return { ...tagged, frozenVersions: legacyPlanVersions(tagged) };
}

/**
 * 用冻结的 10-31 引擎评估一笔（K 线由调用方的加载器提供）。旧引擎文件只在真正用到时才下载。
 * 旧引擎按 10-31 的规则给结果编号，这里换成调用方按当前规则算好的 key，结果才能在表格、监测库里对上号。
 * 不把上一次的半成品结果交给旧引擎：每次从头算，保证与原结果逐位一致。
 */
export async function evaluateLegacyQualitySample(sample: QualitySample, group: QualityGroup, observeHours: number, now: number,
  load: FishReconstructionLoader, signal: AbortSignal, key: string): Promise<QualityResult> {
  const engine = await import('./legacy/qualityEngine20261031.js');
  const result = await engine.evaluateQualitySample(sample, group, observeHours, now, load, signal);
  return { ...result, key };
}

/** 条件设置与战役里显示旧加仓设置：逐次列出旧引擎的原始参数（不经过新版编辑器换算）。 */
export interface LegacyAdditionRow { round: number; trigger: string; entryBufferAtr: number; supportOffsetAtr: number; minGainPct?: number }
export function legacyAdditionRows(rule?: QualityAdditionRule): LegacyAdditionRow[] {
  if (!rule?.enabled) return [];
  const rounds = rule.rounds?.length ? rule.rounds : [rule];
  return rounds.map((r, i) => {
    const conditions = r.conditions?.length ? r.conditions : r.condition ? [r.condition] : [];
    const trigger = r.source === 'detector' ? `原探测算法再次命中（门槛严格 ${r.stricterPct}%）`
      : conditions.filter(c => c.enabled !== false).map(c => `${c.label} ${c.direction} ${c.threshold}`).join(' 且 ') || '—';
    return { round: i + 1, trigger, entryBufferAtr: r.entryBufferAtr ?? 2, supportOffsetAtr: r.supportOffsetAtr ?? 1.5, ...(r.minGainPct != null ? { minGainPct: r.minGainPct } : {}) };
  });
}
