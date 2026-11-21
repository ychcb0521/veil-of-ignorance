import type {RecoveryProgress} from '../qualityRecoveryTransfer';

const listeners=new Set<()=>void>();
let current:{owner:string;at:number;message:string;phase:RecoveryProgress['phase']}|undefined;
export function qualityRecoveryProgress(owner:string|undefined){return owner===current?.owner?current?.message:undefined;}
export function observeQualityRecovery(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
export function showQualityRecovery(owner:string,progress:RecoveryProgress){
  const now=Date.now();
  if(current?.owner===owner&&current.phase===progress.phase&&now-current.at<500&&progress.done!==progress.total)return;
  const message=progress.phase==='download'?`正在恢复账号研究 · 已读取 ${progress.done}/${progress.total} 个分片`
    :progress.phase==='decode'?`正在解码账号研究 · 已处理 ${Math.floor(progress.done/1048576)} MiB`:'正在保存已恢复的研究记录…';
  current={owner,at:now,message,phase:progress.phase};
  listeners.forEach(l=>l());
}
export function resetQualityRecovery(owner:string|undefined){if(current&&current.owner===owner){current=undefined;listeners.forEach(l=>l());}}
