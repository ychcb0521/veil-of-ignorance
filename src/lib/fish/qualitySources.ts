import type {TradeSignal} from '@/lib/signalLibrary';
import { isTuringCupSymbol } from '@/lib/turingCupSymbol';
import {librarySignalIdentity} from './libraryRounds';

export const QUALITY_SOURCE_NAMES = { fish: '鱼舱', mined: '挖掘库', library: '信号库', turing: '图灵杯', 'pre-entry': '入选库' } as const;
export type QualityOrigin = keyof typeof QUALITY_SOURCE_NAMES;
export const isSignalLibraryOrigin = (origin?: string): origin is 'library' | 'turing' | 'pre-entry' => origin === 'library' || origin === 'turing' || origin === 'pre-entry';
export interface QualityProvenance {origins?:QualityOrigin[];origin?:QualityOrigin;source?:Pick<TradeSignal,'mined'> & Partial<Pick<TradeSignal, 'symbol'>>}
/** A merged row can belong to several independent upstream libraries. */
export function qualityOrigins(value:QualityProvenance):QualityOrigin[]{
 return value.origins?.length ? [...new Set(value.origins)] : [
   value.origin ?? (isTuringCupSymbol(value.source?.symbol ?? '') ? 'turing' : value.source?.mined ? 'mined' : 'fish'),
 ];
}
export const qualitySourceLabel=(value:QualityProvenance)=>qualityOrigins(value).map(o=>QUALITY_SOURCE_NAMES[o]).join('、');
export type LegacySourceResolutions=Record<string,QualityOrigin[]>;
export function mergeLegacySourceResolutions(...maps:(LegacySourceResolutions|undefined)[]):LegacySourceResolutions{const out:LegacySourceResolutions={};for(const map of maps)for(const [k,v]of Object.entries(map??{}))out[k]=[...new Set([...(out[k]??[]),...v])];return out;}
/** Before source-specific deletes existed, an unscoped mark could hide a different, still-existing library. Only actual upstream inputs can resolve it. */
export function resolveLegacySourceMemberships<T extends {deletedSources?:Record<string,number>;resolvedLegacySources?:LegacySourceResolutions}>(study:T,signals:readonly TradeSignal[],origin:QualityOrigin):T{
 const live=new Set(signals.map(s=>JSON.stringify(librarySignalIdentity(s))));let resolved=study.resolvedLegacySources;
 for(const key of Object.keys(study.deletedSources??{})){try{const [source,_entry,scope]=JSON.parse(key);if(scope!==undefined||!live.has(JSON.stringify(source))||resolved?.[key]?.includes(origin))continue;resolved={...resolved,[key]:[...(resolved?.[key]??[]),origin]};}catch{/* Invalid legacy markers stay inert. */}}
 return resolved===study.resolvedLegacySources?study:{...study,resolvedLegacySources:resolved};
}


/** Wall-clock capture time. A historical scan anchor is never a capture time. */
export function miningCaptureTime(signal: TradeSignal): number | null {
  if (!signal.mined) return null;
  const archive = signal.fishArchive;
  const at = signal.caughtAt ?? (archive?.id.startsWith('mine-') ? archive.at : undefined);
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;
}
