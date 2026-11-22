import type {QualityMirrorFill} from './qualityMirror';

/** Opt-in deadline; existing mirror and hard-stop engines retain their semantics. */
export const MIRROR_DEADLINE_KIND='mirror-deadline' as const;
export const MIRROR_DEADLINE_VERSION='holding-mirror-deadline-v1' as const;
export const MIRROR_DEADLINE_LABEL='未实现镜像平衡减仓' as const;
export const MIRROR_DEADLINE_DEFAULT_HOURS=1;
export const mirrorDeadlineAt=(entry:number,hours:number)=>Math.ceil((entry+hours*3_600_000)/60_000)*60_000;
/** A saved intraminute execution is observable at that minute's close, never in advance. */
export function mirrorCompletedBy(fill:QualityMirrorFill|undefined,entry:number,deadline:number):boolean {
 const completedAt=fill?.executedAt??(fill?fill.at+(fill.atOpen?0:60_000):NaN);
 return !!fill&&Number.isFinite(fill.at)&&fill.at>=entry&&Number.isFinite(fill.price)&&fill.price>0
  &&Number.isFinite(fill.fraction)&&fill.fraction>0&&fill.fraction<=1
  &&Number.isFinite(completedAt)&&completedAt>=entry&&completedAt<=deadline;
}
