import { shortFishHash } from './algorithm';
import type { QualityGroup } from './quality';
import { activeAdditionVetoes, validateAdditionVetoes, BOX_BREAK_VETO_VERSION, type QualityAdditionEntryVeto } from './qualityAdditionVeto';
import { activeHoldingVetoes, validateHoldingVeto, type QualityHoldingVeto } from './qualityVeto';
import { freezeBoxStop, isBoxSecondBreak } from './qualityBoxStop';
import { structureVersions } from './boxAlgorithmVersions';

export const PRE_ENTRY_CONDITIONS_VERSION = 'pre-entry-conditions-v4' as const;
/** Separate buy-before-entry settings. These never become holding sell rules. */
export interface PreEntryConditions {
  version: typeof PRE_ENTRY_CONDITIONS_VERSION;
  entryVetoes: QualityAdditionEntryVeto[];
  sellVetoes: QualityHoldingVeto[];
  hardVetoes: QualityHoldingVeto[];
}
export const emptyPreEntryConditions = (): PreEntryConditions => ({ version: PRE_ENTRY_CONDITIONS_VERSION, entryVetoes: [], sellVetoes: [], hardVetoes: [] });
export const preEntryPositionOnly = (kind: string) => kind === 'addition-geometric-profit' || kind === 'payoff-ratio';
export function validatePreEntryConditions(value?: PreEntryConditions) {
  if (!value) return;
  if (value.version !== PRE_ENTRY_CONDITIONS_VERSION) throw Error('动态筛选条件版本不可用，请保留旧方案');
  if(value.entryVetoes.some(v=>v.enabled&&v.kind==='double-drop'))throw Error('二次急跌目前用于新版加仓否决；动态筛选 v4 不支持，请保留原轮次');
  validateAdditionVetoes(value.entryVetoes);
  for (const veto of activeHoldingVetoes([...value.sellVetoes, ...value.hardVetoes])) {
    if(veto.boxStop&&isBoxSecondBreak(veto.boxStop))throw Error('首次断裂停加仓、二次断裂终止只适用于实际持仓，不能用于买前筛选');
    if (preEntryPositionOnly(veto.kind)) throw Error('买前筛选没有实际持仓，不能启用加仓仓位或盈亏比条件');
    validateHoldingVeto(veto);
  }
}
export const preEntryVetoes = (value?: PreEntryConditions) => value
  ? (['sellVetoes', 'hardVetoes'] as const).flatMap(section => activeHoldingVetoes(value[section]).map(v => ({ ...v, id: `${section}:${v.id}` }))) : [];
export const hasPreEntryVetoes = (value?: PreEntryConditions) => !!(activeAdditionVetoes(value?.entryVetoes).length || preEntryVetoes(value).length);
export function freezePreEntryConditions(value: PreEntryConditions): PreEntryConditions {
  validatePreEntryConditions(value);
  const freeze = (v: QualityHoldingVeto) => v.boxStop ? { ...v, boxStop: freezeBoxStop(v.boxStop) } : v;
  return { ...structuredClone(value), sellVetoes: value.sellVetoes.map(freeze), hardVetoes: value.hardVetoes.map(freeze) };
}
export function preEntryConditionsVersion(plan: QualityGroup, legacyBoxBreakOrder=false): string {
  const value = plan.preEntryConditions;
  validatePreEntryConditions(value);
  const boxes = preEntryVetoes(value).filter(v => v.boxStop).map(v => [v.boxStop!.version, structureVersions(v.boxStop!.structure)]);
  const boxBreak=value?.entryVetoes.some(v=>v.kind==='box-break')&&!legacyBoxBreakOrder;
  // Only the new opt-in condition uses this canonical format. Arrays and every
  // parameter remain intact; all earlier templates retain their exact serializer.
  const payload=[value,plan.buyFilters,boxes];
  const serialized=boxBreak?JSON.stringify(payload,(_k,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item):JSON.stringify(payload);
  return PRE_ENTRY_CONDITIONS_VERSION + (boxBreak?' · '+BOX_BREAK_VETO_VERSION:'') + ' · 参数 #' + shortFishHash(serialized);
}

export const preEntryConditionText = (text:string) => text.replace(/自由静态最大回撤/g,'筛选过程静态最大回撤').replace(/持仓/g,'筛选').replace(/不再加仓/g,'不入选').replace(/下一分钟开盘全仓卖出|触碰 K 立即卖出/g,'本分钟不入选');
