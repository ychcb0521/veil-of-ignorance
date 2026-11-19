import {postMirrorProtectionAt} from './qualityPostMirrorProtection';
import type {QualityMirrorFill} from './qualityMirror';
import type {QualityHoldingVeto} from './qualityVeto';

export const MIRROR_HARD_STOP_STAGES_VERSION='holding-mirror-hard-stop-stages-v1';
export type MirrorHardStopStage={version:typeof MIRROR_HARD_STOP_STAGES_VERSION;stage:'before'|'after'};
export const mirrorHardStopStage=(stage:'before'|'after'):MirrorHardStopStage=>({version:MIRROR_HARD_STOP_STAGES_VERSION,stage});
export const mirrorHardStopStageLabel=(stage?:MirrorHardStopStage)=>stage?stage.stage==='before'?'仅在镜像平衡减仓前生效':'仅在镜像平衡减仓后生效':'';
export function validateMirrorHardStopStage(v:Pick<QualityHoldingVeto,'mirrorStage'|'activation'|'kind'|'boxStop'>){
 const s=v.mirrorStage;if(!s)return;
 if(s.version!==MIRROR_HARD_STOP_STAGES_VERSION||!['before','after'].includes(s.stage)||v.activation)throw Error('镜像前后硬性终止的阶段版本或启动范围不符，请保留原方案核查');
 // These existing rules promise a holding-wide addition lock / require a reduced position.
 if(s.stage==='before'&&(v.boxStop?.version==='holding-support-second-break-v1'||['addition-geometric-profit','payoff-ratio'].includes(v.kind)))throw Error('首次断裂停加仓及加仓／盈亏比止盈请放在镜像后或原全程区域；镜像前可选防守线断裂即退出');
}
export function mirrorHardStopActive(v:{mirrorStage?:MirrorHardStopStage;activation?:string},fill:QualityMirrorFill|undefined,at:number){
 const boundary=postMirrorProtectionAt(fill);
 if(v.mirrorStage)return v.mirrorStage.stage==='before'?boundary==null||at<boundary:boundary!=null&&at>=boundary;
 return !v.activation||boundary!=null&&at>=boundary;
}
export function mirrorHardStopRange(v:{mirrorStage?:MirrorHardStopStage},fill:QualityMirrorFill|undefined,from:number){
 const boundary=postMirrorProtectionAt(fill);
 return v.mirrorStage?.stage==='after'?boundary==null?Infinity:Math.max(from,boundary):from;
}
