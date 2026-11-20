/**
 * 【用户要求】2026-11-02 箱体算法要标明版本，并把每个版本都保留下来：某个版本效果好，改了之后变差，必须能回到原来那一版。
 * 已存模板里用过的版本尤其要保住。
 *
 * 规则（改箱体算法的人必须遵守）：
 *  1. 任何改变箱体 / 防守线计算结果的改动，都要新开版本号，并在这里加一条说明；旧版本的代码和说明不能删、不能改。
 *  2. 方案保存时把所用版本写进 structure.versions（freezeStructureVersions）。之后哪怕默认参数变了，已存方案仍按原版本、原参数运行。
 *  3. src/lib/__tests__/boxAlgorithmVersions.test.ts 用固定 K 线锁住每个版本的输出；那里的期望值不能改，只能为新版本另加。
 */
import {IMPULSE_1115_CLASSIFICATION_VERSION,IMPULSE_1115_CLASSIFICATION_LABEL} from '@/lib/impulse1115Classification';
import type { StructureAdditionRule } from './qualityAdditionStructure';
import { DBL5_1115_POSITION_RACE_VERSION, DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION, DBL5_GUARD_PLUS_DISPLAY_NAME, DBL5_GUARD_PLUS_LABEL, DBL5_GUARD_PLUS_VERSION, IMPULSE_1115_CONFIGURABLE_K_VERSION, IMPULSE_1115_DISPLAY_NAME, IMPULSE_1115_POSITION_LABEL, IMPULSE_1115_POSITION_VERSION } from '@/lib/dbl5GuardPlus';
import { DBL5_GUARD_DEFAULTS, DBL5_GUARD_VERSION, DBL5_PROFILES, DBL5_VARIANT_TIMEFRAMES, dbl5ProfileForFeature, DBL5_RETEST_GUARD_VERSION, DBL5_GUARD_RETEST, dbl5GuardVersion, withDbl5GuardVersion, type Dbl5GuardVersion } from '@/lib/dbl5m';

export const structureDbl5Timeframe = (rule: Pick<StructureAdditionRule, 'algorithm' | 'definition'>) =>
  rule.algorithm === 'dbl5' ? dbl5ProfileForFeature(rule.definition?.id)?.timeframe ?? '5m' : '5m';
function nativeGuardVersion(timeframe: ReturnType<typeof structureDbl5Timeframe>, version: Dbl5GuardVersion) {
  if(timeframe==='5m')return version;
  return version===DBL5_RETEST_GUARD_VERSION?`dbl5-${timeframe}-guard-retest-v1`:`dbl5-${timeframe}-guard-v1`;
}

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
  { id: DBL5_RETEST_GUARD_VERSION, algorithm: 'dbl5', layer: 'guard', label: '防守线-20261112', since: '2026-11-12',
    summary: '最终箱底首次出现在局部新高后的第一根 5 分钟线上时，等待独立回踩确认后启用防守线。',
    rules: [
      '只在箱体完整确认后开始观察；已有防守线按自身规则继续有效。',
      `用箱体确认时的 ATR 冻结观察区：箱底至箱底＋${DBL5_GUARD_RETEST.nearAtr} ATR。先有一根最低价在观察区之上、收盘至少离箱底 ${DBL5_GUARD_RETEST.departureAtr} ATR 的 5 分钟线。`,
      '随后一根回到观察区，最低价未跌穿箱底且收盘回到观察区上方，才按当时的防守线公式生效。箱体破坏、到期、换箱或数据不连续会结束这次等待。',
    ] },
  { id: DBL5_GUARD_PLUS_VERSION, algorithm: 'dbl5', layer: 'guard', label: DBL5_GUARD_PLUS_LABEL, since: '2026-11-15',
    summary: '独立无 BTC 依赖实验版本，合并原版防守线与仅凭已收盘 5m 确认的急拉起点参考。',
    rules: [
      '两根紧凑整理后观察 1–3 根。参考起点之前的 ATR、加权常态、最近三根最高价，最早合格窗口优先。',
      '急拉首次确认冻结最低价减 0.5 倍前置 ATR，向下取至报价步长；不等新箱体。',
      '急拉一根收盘严格跌破或起点满 360 分钟时失效，保留与基线独立的事件。',
      '急拉起点参考，尚不代表回踩验证。量能仅作为辅助证据。'
    ] },
  { id: IMPULSE_1115_POSITION_VERSION, algorithm: 'dbl5', layer: 'guard', label: IMPULSE_1115_POSITION_LABEL, since: '2026-11-15',
    summary: '1115 的独立加仓位置。只有首次急拉可以触发，K 取当时有效的急拉参考。',
    rules: ['沿用 1115 的阶段、过伸、失效和收盘确认规则。', '以急拉参考单独评估加仓，与同轮其他位置共用方向、否决和仓位计算。'] },
  { id: IMPULSE_1115_CONFIGURABLE_K_VERSION, algorithm: 'dbl5', layer: 'guard', label: IMPULSE_1115_DISPLAY_NAME, since: '2026-11-15',
    summary: '沿用 1115 首次急拉确认，以起涨低点和可调的前置 ATR 冗余计算 K。',
    rules: ['收盘确认急拉后，冻结急拉前的 5 分钟 ATR(14)，按所设倍数从起涨低点扣减，向下取至报价步长。', 'K 最小距离、方向、否决、定量和一根 5 分钟收盘跌破 K 的规则照常生效。'] },
  { id: DBL5_1115_POSITION_RACE_VERSION, algorithm: 'dbl5', layer: 'guard', label: '组合版与独立急拉并选', since: '2026-11-16',
    summary: '无 BTC 依赖。组合版和独立急拉分别按各自已冻结的规则评估加仓。',
    rules: ['同一轮只成交一次，较早达标者优先，同分钟先评估组合版。', '使用成交位置对应的 K、最小距离与止损执行规则。'] },
  { id: DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION, algorithm: 'dbl5', layer: 'guard', label: `${DBL5_GUARD_PLUS_DISPLAY_NAME} · 可调急拉 ATR`, since: '2026-11-16',
    summary: '无 BTC 依赖。原组合版的首次急拉判定和防守线不变，急拉参考使用自定的前置 ATR 冗余。',
    rules: ['急拉参考＝起涨低点 − 所设倍数 × 急拉前的 5 分钟 ATR(14)，按报价步长向下取整。', '与防守线按原组合规则选取有效参考，使用该参考的 K 和收盘确认方式。'] },
  {id:IMPULSE_1115_CLASSIFICATION_VERSION,algorithm:'dbl5',layer:'guard',label:IMPULSE_1115_CLASSIFICATION_LABEL,since:'2026-11-19',
    summary:'原急拉识别和参考价格不变，新增独立、因果的持仓状态分类。',
    rules:['第1、2种固定映射一类；第3至6种固定映射二类。过渡状态说明等待条件，不另增主分类。',
      '每条急拉线独立冻结价格与ATR，逐根已收盘5m更新；刺穿、有效跌破与修复保留各自证据。',
      '原线断裂、到期后仍可按冻结价格观察；缺口暂停该线。历史不回填，检查点须与原生证据成对恢复。',
      '只输出分类与展示；原防守线、急拉线、模板版本和交易动作不变。']},
  ...DBL5_VARIANT_TIMEFRAMES.flatMap((timeframe): BoxAlgorithmVersion[] => {
    const {version,label,periodLabel,minutes}=DBL5_PROFILES[timeframe];
    return [
      { id: version, algorithm: 'dbl5', layer: 'box', label, since: '2026-11-16',
        summary: `DBL-5 v2 的独立 ${periodLabel}版本，箱体识别、选择和失效沿用原规则。`,
        rules: [`仅使用已收盘的 ${periodLabel} K 线，n=3，几何窗口默认 72 根（${72*minutes/60} 小时）`, '初始预热至少 288 根；新鲜度半衰期 12 根'] },
      { id: nativeGuardVersion(timeframe,DBL5_GUARD_VERSION), algorithm: 'dbl5', layer: 'guard', label: `${timeframe} 防守线 v1`, since: '2026-11-16',
        summary: `沿用原防守线的实线、虚线、冗余及断裂规则，使用 ${periodLabel} ATR(14) 与收盘确认。`,
        rules: ['上涨期默认 1 根，震荡期默认连续 2 根收盘严格在线下后确认；ATR 倍数及震荡期确认根数可按原规则设置'] },
      { id: nativeGuardVersion(timeframe,DBL5_RETEST_GUARD_VERSION), algorithm: 'dbl5', layer: 'guard', label: `${timeframe} 防守线-20261112`, since: '2026-11-16',
        summary: `沿用防守线-20261112 的独立回踩条件。等待离开和回踩使用已收盘的 ${periodLabel} K 线。`,
        rules: ['观察区与离开距离的 ATR 倍数沿用原版；独立回踩确认前继续检查已有防守线'] },
    ];
  }),
]);
export const CURRENT_BOX_VERSION: Readonly<Record<BoxAlgorithm, string>> = Object.freeze({ dbl5: 'dbl-5-v2', sbs5m: 'sbs-5m-v1' });
export const CURRENT_GUARD_VERSION = 'dbl5-guard-v1';
export const boxAlgorithmVersion = (id?: string) => BOX_ALGORITHM_VERSIONS.find(v => v.id === id);

export interface StructureVersions { box: string; guard?: string }
/** 方案实际用的版本：保存时冻结的优先；没冻结的旧方案按定义公式第一行（如「# dbl-5-v2」）认出。 */
export function structureVersions(rule: Pick<StructureAdditionRule, 'algorithm' | 'kSource' | 'definition'> & { versions?: StructureVersions }): StructureVersions {
  const fromFormula = /^#\s*([a-z0-9-]+)/i.exec(String(rule.definition?.formula ?? ''))?.[1];
  const box = rule.versions?.box ?? fromFormula ?? (rule.algorithm==='dbl5'?DBL5_PROFILES[structureDbl5Timeframe(rule)].version:CURRENT_BOX_VERSION[rule.algorithm]);
  const guard = rule.kSource === 'guard' ? rule.versions?.guard ?? nativeGuardVersion(structureDbl5Timeframe(rule), dbl5GuardVersion(rule.definition?.DBL5_config)) : undefined;
  return guard ? { box, guard } : { box };
}
/** 「DBL-5 v2」或「DBL-5 v2 · 防守线 v1」。 */
export function structureVersionLabel(rule: Parameters<typeof structureVersions>[0]): string {
  const v = structureVersions(rule);
  return [boxAlgorithmVersion(v.box)?.label ?? v.box, ...(v.guard ? [boxAlgorithmVersion(v.guard)?.label ?? v.guard] : [])].join(' · ');
}
export function selectStructureGuardVersion(rule: StructureAdditionRule, version: Dbl5GuardVersion): StructureAdditionRule {
  return {
    ...rule,
    versions: { ...structureVersions(rule), guard: nativeGuardVersion(structureDbl5Timeframe(rule), version) },
    definition: { ...rule.definition, DBL5_config: withDbl5GuardVersion(rule.definition.DBL5_config, version) },
  };
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
  const expectedBox = rule.algorithm==='dbl5'?DBL5_PROFILES[structureDbl5Timeframe(rule)].version:CURRENT_BOX_VERSION[rule.algorithm];
  if (!box || box.algorithm !== rule.algorithm || box.layer !== 'box' || v.box !== expectedBox) throw Error(`方案冻结的箱体算法版本 ${v.box} 当前没有可运行的实现，请勿改用其它版本代替`);
  if (v.guard && v.guard !== nativeGuardVersion(structureDbl5Timeframe(rule), DBL5_GUARD_VERSION) && v.guard !== nativeGuardVersion(structureDbl5Timeframe(rule), DBL5_RETEST_GUARD_VERSION)) throw Error(`方案冻结的防守线版本 ${v.guard} 当前没有可运行的实现，请勿改用其它版本代替`);
  if (v.guard && v.guard !== nativeGuardVersion(structureDbl5Timeframe(rule), dbl5GuardVersion(rule.definition.DBL5_config))) throw Error('方案冻结的防守线版本与实际参数不一致');
}

/** 新增执行层，不改变上方任何原生箱体 / 防守线输出和既有版本说明。 */
export const BOX_K_EXECUTION_VERSIONS = Object.freeze([
  {id:'holding-impulse-1115-classified-origin-k-v3',since:'2026-11-20',summary:'一类／二类新设置统一以该急拉的起涨点（起涨低点）计算 K＝起涨点−N×急拉开始前冻结的5m ATR(14)，与原1115位置同一基准，只扣一次N倍；分类仍独立决定触发时机。K按报价步长向下取整，继续应用最小距离，定量与退出共用K；原v1、v2及已存方案、模板不自动转换。'},
  {id:'holding-limited-static-drawdown-v1',since:'2026-11-19',summary:'硬性终止独立新增限制静态最大回撤，按首仓买入价×（1−所设百分比）触价全仓退出，跳空按开盘价；可选镜像前／后阶段。起始有效的限制阈值可冻结为初始风险，镜像后及加仓后新设阈值不回写首仓风险。原自由静态回撤、普通卖出算法及已存模板不转换。'},
  {id:'holding-impulse-1115-classified-line-k-v2',since:'2026-11-19',summary:'一类／二类加仓位置新增 K＝原生急拉线价格−N×该线冻结 ATR，N 可手动设置并按轮次、分类和分支独立保存。按报价步长向下取整，定量和退出共用所选 K；保留原起涨低点基准的 v1 实现与指纹，已存方案不自动转换。'},
  {id:'holding-mirror-hard-stop-stages-v1',since:'2026-11-19',summary:'新增镜像平衡减仓前／后硬性终止阶段。减仓实际成交后前段退出判断停止，后段独立开始计数；盘中成交以收盘可确认时点切换指标，价格保护从下一分钟开始。全程条件、旧版减仓后条件、原生箱体与防守线计算均保留，不自动迁移已存模板。'},
  {id:'holding-post-mirror-protection-v1',since:'2026-11-19',summary:'新增独立的镜像平衡减仓后启动约束：仅凭本次持仓减仓成交记录启用 DBL-5 防守线或 CDA 硬性终止。开盘减仓后当分钟可检查，盘中减仓后防守线从下一分钟、CDA 从首个后续读数检查；不追补启动前断裂和计数。原防守线计算、原终止选项及已存模板保持不变。'},
  {id:'holding-support-second-exit-v1',since:'2026-11-19',summary:'新增独立选项“持仓期间二次断裂终止”：按冻结周期与防守线参数累计本次持仓后的独立原生红叉。首次只计数，不因本条件停止加仓；第二次确认后按下一分钟开盘价卖出全部持仓。预热与持续在线下不重复计数，防守线重建及暂停续算不清零，其他加仓否决和退出仍独立生效。保留原“首次断裂停加仓，二次断裂终止”版本及模板语义。'},
  {id:'holding-impulse-1115-classified-position-v1',since:'2026-11-19',summary:'加仓位置保留原急拉线，新增1115一类与二类；只在原生5分钟收盘确认新分类状态时生成机会，过渡状态、预热及持续同状态不补单。逐轮及备选独立冻结分类参数与K，沿用原方向、否决、定量及退出。'},
  {id:'holding-box-stop-independent-channels-v1',since:'2026-11-19',summary:'硬性终止可同时启用非急拉与急拉两路。每路独立冻结原生参考、ATR冗余、K更新及确认方式，独立保存K与收盘计数，任一路先触发即退出；停用保留参数。共用所选启动阶段，旧单路方案不自动转换，原生箱体、防守线与急拉识别算法不变。'},
  {id:'holding-box-stop-reference-v1',since:'2026-11-19',summary:'硬性终止的 K 基准独立新增急拉线-0、急拉线-1115及防守线＋急拉线-1115。使用同版原生已收盘 5 分钟参考，再扣此处额外冗余并按报价步长向下取整；按所选固定／只升／跟随与触价／收盘执行。无有效线时等待，已有 K 在线失效或到期后继续保护。旧模板与原箱体、防守线输出不变。'},
  {id:'addition-holding-box-break-v1',since:'2026-11-19',summary:'新增共用一票否决：持仓期间首次原生防守线红叉确认后，启用该条件的加仓轮次及分支不再加仓；筛选按本轮起点后的断裂持续排除。买入／筛选前预热不计、重建不解除。按冻结周期与参数重建历史，缺数据暂不放行。独立开关，不触发卖出，不改变旧箱体、加仓否决和模板。'},
  {id:'holding-support-second-break-v1',since:'2026-11-19',summary:'独立选用：从本次持仓开始按冻结周期与防守线参数累计原生红叉。第一次断裂锁定本笔全部后续加仓，第二次独立断裂确认后按下一分钟开盘价全仓卖出；预热事件和持续在线下不重复计数。锁定跨暂停续算及加仓分支切换保留，其他保护与卖出仍可更早触发。'},
  {id:'binance-manual-monitor-v1',since:'2026-11-15',summary:'币安 U 本位手动首仓按真实成交数量和价格初始化，冻结所选买后模板；每笔托管动作先核对实际持仓，随后按实际成交续算。'},
  {id:'holding-dbl5-binance-trade-grid-v1',since:'2026-11-13',summary:'持仓监测遇到可核验的币安 AKEUSDT / RAVEUSDT 报价格点错误时，从入场前按交易所公布的精确成交格点重放。保留原始成交价格、箱体、防守线及卖出参数，成功结果单独标记数据修复版本；真实缺口继续报错。'},
  {id:'holding-dbl5-binance-trade-grid-v2',since:'2026-11-17',summary:'持仓箱体止损支持币安 BULLAUSDT 新旧挂单混合成交。仅在原报价校验失败时按 0.000001 精确校验原始价格，适用于已保存的 5 分钟和 1 小时 DBL-5 箱体规则。真实行情缺口继续报错。'},
  {id:'holding-box-stop-guard-regime-v2',since:'2026-11-13',summary:'DBL-5 防守线可按上涨期实线或震荡期虚线建立与更新硬止损 K。其他线型出现时沿用已有 K，尚无 K 时等待。沿用冻结的防守线算法、冗余、K 更新与成交确认设置。'},
  {id:'breakeven-floor-v2',since:'2026-11-15',summary:'保本底线跟随实际触发加仓的位置 K，按 F 定量；逐笔冻结卖出 K 与 F。防守线按配置收盘或触价，其他位置按触价。'},
  {id:'breakeven-floor-v3',since:'2026-11-19',summary:'保本底线独立按盘中触价执行，覆盖实际成交的防守线、原急拉线及一类／二类急拉线。F＝K−N×ATR；N＝0、F 与 K 重合时也不等待 K 收盘确认。跳空越过 F 按开盘价。定量仍按 F，旧版执行与已保存方案保持原样。'},
  {id:'addition-position-race-v1',since:'2026-11-15',summary:'5 分钟急拉线与原位置可并行或独立启用。同分钟只执行一次，按成功成交共用轮次与持仓账。急拉按已收盘 5 分钟量价确认，无 BTC 依赖。'},
  {id:'addition-k-touch-v1',since:'2026-11-07',summary:'加仓卖出第一行的 K / K′ 改为盘中即时触碰全仓卖出，包含防守线与影线；跳空按开盘价。旧方案未选此版本仍按原规则执行，原加仓定量与 F 不变。'},
]);
