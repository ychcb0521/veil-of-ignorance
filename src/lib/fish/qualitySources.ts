import type {TradeSignal} from '@/lib/signalLibrary';
import {librarySignalIdentity} from './libraryRounds';

export type QualityOrigin='fish'|'mined'|'library';
export interface QualityProvenance {origins?:QualityOrigin[];origin?:QualityOrigin;source?:Pick<TradeSignal,'mined'>}
/** A merged row can belong to several independent upstream libraries. */
export function qualityOrigins(value:QualityProvenance):QualityOrigin[]{
 return value.origins?.length?[...new Set(value.origins)]:[value.origin??(value.source?.mined?'mined':'fish')];
}
export const qualitySourceLabel=(value:QualityProvenance)=>qualityOrigins(value).map(o=>({fish:'鱼舱',mined:'挖掘库',library:'信号库'})[o]).join('、');
export type LegacySourceResolutions=Record<string,QualityOrigin[]>;
export function mergeLegacySourceResolutions(...maps:(LegacySourceResolutions|undefined)[]):LegacySourceResolutions{const out:LegacySourceResolutions={};for(const map of maps)for(const [k,v]of Object.entries(map??{}))out[k]=[...new Set([...(out[k]??[]),...v])];return out;}
/** Before source-specific deletes existed, an unscoped mark could hide a different, still-existing library. Only actual upstream inputs can resolve it. */
export function resolveLegacySourceMemberships<T extends {deletedSources?:Record<string,number>;resolvedLegacySources?:LegacySourceResolutions}>(study:T,signals:readonly TradeSignal[],origin:QualityOrigin):T{
 const live=new Set(signals.map(s=>JSON.stringify(librarySignalIdentity(s))));let resolved=study.resolvedLegacySources;
 for(const key of Object.keys(study.deletedSources??{})){try{const [source,_entry,scope]=JSON.parse(key);if(scope!==undefined||!live.has(JSON.stringify(source))||resolved?.[key]?.includes(origin))continue;resolved={...resolved,[key]:[...(resolved?.[key]??[]),origin]};}catch{/* Invalid legacy markers stay inert. */}}
 return resolved===study.resolvedLegacySources?study:{...study,resolvedLegacySources:resolved};
}
