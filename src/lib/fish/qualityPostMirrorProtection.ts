import {CDA_HOURLY_ID} from '@/lib/cdaPeriods';
import type {QualityHoldingVeto} from './qualityVeto';
import type {QualityMirrorFill} from './qualityMirror';

/** Opt-in execution gate. The native DBL-5 and CDA algorithms remain unchanged. */
export const POST_MIRROR_PROTECTION_VERSION='holding-post-mirror-protection-v1';
export const POST_MIRROR_PROTECTION_LABEL='仅在镜像平衡减仓成交后启动';
export const isCdaProtection=(featureId?:string)=>featureId==='cda'||featureId===CDA_HOURLY_ID;
export function canGateAfterMirror(v:Pick<QualityHoldingVeto,'kind'|'boxStop'|'snapshot'>){
  return v.kind==='box-stop'&&v.boxStop?.version==='holding-box-stop-independent-channels-v1'
    ||v.kind==='box-stop'&&v.boxStop?.structure.algorithm==='dbl5'&&v.boxStop.structure.kSource==='guard'&&!v.boxStop.reference
    ||v.kind==='indicator'&&isCdaProtection(v.snapshot?.featureId);
}
/** An intraminute fill has no reliable high/low ordering: arm price stops next minute. */
export function postMirrorProtectionAt(fill?:QualityMirrorFill):number|undefined{
  return fill&&Number.isFinite(fill.at)&&Number.isFinite(fill.price)&&fill.price>0&&fill.fraction>0&&fill.fraction<=1
    ?fill.at+(fill.atOpen?0:60_000):undefined;
}
