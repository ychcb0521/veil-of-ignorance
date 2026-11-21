import {useSyncExternalStore} from 'react';
import {observeQualityRecovery,qualityRecoveryProgress} from '@/lib/fish/qualityRecoveryProgress';

export function FishStudyRecoveryStatus({owner,error,retry}:{owner?:string;error?:string;retry?:()=>void}){
  const status=useSyncExternalStore(observeQualityRecovery,()=>qualityRecoveryProgress(owner));
  if(error)return retry?<button type="button" className="text-[11px] text-primary hover:underline" onClick={retry}>重试恢复账号研究</button>:null;
  return <p role="status" className="text-[10.5px] text-muted-foreground">{status??'正在核对账号与本机研究记录…'}</p>;
}
