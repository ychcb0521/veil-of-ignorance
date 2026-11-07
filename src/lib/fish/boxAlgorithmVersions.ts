/**
 * 【用户要求】2026-11-02 箱体算法要标明版本，并把每个版本都保留下来：某个版本效果好，改了之后变差，必须能回到原来那一版。
 * 已存模板里用过的版本尤其要保住。
 *
 * 规则（改箱体算法的人必须遵守）：
 *  1. 任何改变箱体 / 防守线计算结果的改动，都要新开版本号，并在这里加一条说明；旧版本的代码和说明不能删、不能改。
 *  2. 方案保存时把所用版本写进 structure.versions（freezeStructureVersions）。之后哪怕默认参数变了，已存方案仍按原版本、原参数运行。
 *  3. src/lib/__tests__/boxAlgorithmVersions.test.ts 用固定 K 线锁住每个版本的输出；那里的期望值不能改，只能为新版本另加。
 */
import type { StructureAdditionRule } from './qualityAdditionStructure';
import { DBL5_GUARD_DEFAULTS } from '@/lib/dbl5m';

export type BoxAlgorithm = StructureAdditionRule['algorithm'];
export interface BoxAlgorithmVersion {
  id: string; algorithm: BoxAlgorithm;
  /** box：箱体本身；guard：叠在 DBL-5 箱体上的防守线。 */
  layer: 'box' | 'guard';
  label: string; since: string;
  /** 一句话说明这一版的逻辑。 */
  summary: string;
  /** 这一版的要点，逐条。 */
  rules: string[];
}
export const BOX_ALGORITHM_VERSIONS: readonly BoxAlgorithmVersion[] = Object.freeze([
  { id: 'dbl-5-v2', algorithm: 'dbl5', layer: 'box', label: 'DBL-5 v2', since: '2026-11-02 之前（11-02 未改动）',
    summary: '达瓦斯箱体下轨：箱体完成才冻结，影线严格跌破下轨即破坏，不分上涨 / 震荡。',
    rules: ['已收盘 5 分钟线，默认 n=3、几何窗口 360 分钟', '局部新高后观察箱底，上下边界都完成才发布并冻结', '相邻箱体分为基准、完整上移、内部箱底抬高、同底新箱', '最低价严格低于下轨即破坏（影线也算），触及不算；缺口重置'] },
  { id: 'sbs-5m-v1', algorithm: 'sbs5m', layer: 'box', label: 'SBS-5M v1', since: '2026-11-02 之前（11-02 未改动）',
    summary: '台阶箱体支撑：横向箱体冻结后须独立测试确认，台阶抬升要新箱测试成功。',
    rules: ['5 分钟线 6 根形成横向箱体，冻结边界', '独立测试成功才确认；父箱两根突破后，更高新箱测试成功才抬升', '触及失效参考或连续 2 根收于箱底下方即断线', '确认后默认 6 小时过期，再次测试不续期'] },
  { id: 'dbl5-guard-v1', algorithm: 'dbl5', layer: 'guard', label: '防守线 v1', since: '2026-11-02（上线版本 478）',
    summary: '叠在 DBL-5 v2 上：分上涨 / 震荡留冗余，只认收盘跌破，影线不算。',
    rules: [`上涨期（新箱底抬高且与上一箱体重叠 ≤ 较小箱高 ${DBL5_GUARD_DEFAULTS.overlap * 100}%）：线＝箱底 − a×ATR，只升不降（a 默认 ${DBL5_GUARD_DEFAULTS.guard_trend_atr}）`,
      `震荡期：线＝震荡区最低箱底 − b×ATR，区间内小箱体不抬线（b 默认 ${DBL5_GUARD_DEFAULTS.guard_range_atr}）`,
      `跌破：上涨期 ${DBL5_GUARD_DEFAULTS.guard_trend_closes} 根、震荡期连续 ${DBL5_GUARD_DEFAULTS.guard_range_closes} 根 5 分钟收盘在线下；确认后清空，等下一个箱体重建`,
      `ATR 为 5 分钟 ATR(${DBL5_GUARD_DEFAULTS.atr_period})；首个箱体按震荡期`] },
]);
export const CURRENT_BOX_VERSION: Readonly<Record<BoxAlgorithm, string>> = Object.freeze({ dbl5: 'dbl-5-v2', sbs5m: 'sbs-5m-v1' });
export const CURRENT_GUARD_VERSION = 'dbl5-guard-v1';
export const boxAlgorithmVersion = (id?: string) => BOX_ALGORITHM_VERSIONS.find(v => v.id === id);

export interface StructureVersions { box: string; guard?: string }
/** 方案实际用的版本：保存时冻结的优先；没冻结的旧方案按定义公式第一行（如「# dbl-5-v2」）认出。 */
export function structureVersions(rule: Pick<StructureAdditionRule, 'algorithm' | 'kSource' | 'definition'> & { versions?: StructureVersions }): StructureVersions {
  const fromFormula = /^#\s*([a-z0-9-]+)/i.exec(String(rule.definition?.formula ?? ''))?.[1];
  const box = rule.versions?.box ?? fromFormula ?? CURRENT_BOX_VERSION[rule.algorithm];
  const guard = rule.kSource === 'guard' ? rule.versions?.guard ?? CURRENT_GUARD_VERSION : undefined;
  return guard ? { box, guard } : { box };
}
/** 「DBL-5 v2」或「DBL-5 v2 · 防守线 v1」。 */
export function structureVersionLabel(rule: Parameters<typeof structureVersions>[0]): string {
  const v = structureVersions(rule);
  return [boxAlgorithmVersion(v.box)?.label ?? v.box, ...(v.guard ? [boxAlgorithmVersion(v.guard)?.label ?? v.guard] : [])].join(' · ');
}
/**
 * 保存方案 / 模板时调用：写下所用版本；用防守线时把当时生效的防守线参数也写成明确的值，
 * 以后默认值改了，已存方案也不跟着变。
 */
export function freezeStructureVersions<R extends StructureAdditionRule & { versions?: StructureVersions }>(rule: R): R {
  const versions = structureVersions(rule);
  if (rule.kSource !== 'guard' || rule.algorithm !== 'dbl5') return { ...rule, versions };
  const config = rule.definition.DBL5_config ?? {};
  return { ...rule, versions, definition: { ...rule.definition, DBL5_config: { ...config,
    guard_trend_atr: config.guard_trend_atr ?? DBL5_GUARD_DEFAULTS.guard_trend_atr,
    guard_range_atr: config.guard_range_atr ?? DBL5_GUARD_DEFAULTS.guard_range_atr,
    guard_range_closes: config.guard_range_closes ?? DBL5_GUARD_DEFAULTS.guard_range_closes } } };
}
/** 代码里仍保留实现的版本；方案冻结的版本不在其中时拒绝运行，免得悄悄换成另一版逻辑。 */
export function assertStructureVersionsAvailable(rule: Parameters<typeof structureVersions>[0]) {
  const v = structureVersions(rule), box = boxAlgorithmVersion(v.box);
  if (!box || box.algorithm !== rule.algorithm || box.layer !== 'box' || v.box !== CURRENT_BOX_VERSION[rule.algorithm]) throw Error(`方案冻结的箱体算法版本 ${v.box} 当前没有可运行的实现，请勿改用其它版本代替`);
  if (v.guard && v.guard !== CURRENT_GUARD_VERSION) throw Error(`方案冻结的防守线版本 ${v.guard} 当前没有可运行的实现，请勿改用其它版本代替`);
}

/** 新增执行层，不改变上方任何原生箱体 / 防守线输出和既有版本说明。 */
export const BOX_K_EXECUTION_VERSIONS = Object.freeze([
  {id:'addition-k-touch-v1',since:'2026-11-07',summary:'加仓卖出第一行的 K / K′ 改为盘中即时触碰全仓卖出，包含防守线与影线；跳空按开盘价。旧方案未选此版本仍按原规则执行，原加仓定量与 F 不变。'},
]);
