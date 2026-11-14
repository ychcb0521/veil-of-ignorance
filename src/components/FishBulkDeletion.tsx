import {createContext, useContext, useState, useEffect, useRef, type ReactNode} from 'react';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from './ui/dialog';
import {clearMiningLibrary, deleteMiningRecords, miningRecordDeleteTargets, miningRecordSavedAt, sourceDeletionMatcher, deletionKey, type DeleteTarget} from '@/lib/fish/libraryDeletion';
import {syncMiningLibraryChange, updateMiningLibrary} from '@/lib/fish/miningLibraryStore';
import type {FishQualityState} from '@/hooks/useFishQuality';
import {qualityOrigins} from '@/lib/fish/qualitySources';
import {toast} from 'sonner';

type Request={kind:'hold'|'mining';ids:string[];targets:DeleteTarget[];clearAll?:boolean};
export const FishBulkDeleteContext=createContext<((r:Request)=>void)|null>(null);
export const useFishBulkDelete=()=>useContext(FishBulkDeleteContext);

export function FishBulkDeletionProvider({state, removeFish, children}:{
  state:FishQualityState; removeFish:(ids:readonly string[])=>void; children:ReactNode;
}){
  const [request,setRequest]=useState<Request>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const account=useRef(state.account);account.current=state.account;
  useEffect(()=>{setRequest(undefined);setError('');},[state.account]);
  const targets=(request?.targets??[]).flatMap<DeleteTarget>(t=>{
    const origin=request!.kind==='mining'?'mined':'fish';
    const samples=origin==='fish'?state.study.samples.filter(s=>request!.ids.includes(s.source.id)&&s.source.id===(t.source as {id?:string}).id&&qualityOrigins(s).includes('fish')):[];
    return samples.length?samples.map(s=>({source:s.source,entry:s.enteredAt,origin})):[{...t,origin}];
  });
  const gone=sourceDeletionMatcher(Object.fromEntries(targets.map(t=>[deletionKey(t),1])));
  const filters=state.study.filterLibrary?.records.filter(r=>gone(r.source,r.enteredAt)).length??0;
  const monitors=state.study.monitorLibrary?.records.filter(r=>gone(r.source,r.enteredAt)).length??0;

  const confirm=async()=>{
    if(!request||!state.deleteSources)return;
    const owner=state.account, at=Date.now();
    setBusy(true);setError('');
    try{
      if(targets.length)await state.deleteSources(targets);
      if(account.current!==owner)throw Error('账号已切换，请返回原账号继续');
      if(request.kind==='mining'){
        let extra:DeleteTarget[]=[];
        const saved=await updateMiningLibrary(owner,l=>{
          if(!request.clearAll)return deleteMiningRecords(l,request.ids,at);
          const known=new Set(targets.map(deletionKey));
          const ids=l.records.filter(r=>miningRecordSavedAt(r)<=at).map(r=>r.id);
          extra=miningRecordDeleteTargets(l.records,new Set(ids)).filter(t=>!known.has(deletionKey(t)));
          return clearMiningLibrary(l,at);
        });
        if(!saved)throw Error('捕捞库删除未保存，请重试');
        if(extra.length&&account.current===owner)await state.deleteSources(extra);
        setRequest(undefined);
        void syncMiningLibraryChange(owner,true).then(ok=>{
          if(account.current!==owner)return;
          if(ok)toast.success('捕捞库删除已保存');
          else toast.error('捕捞库已在本机删除，云端尚未确认同步');
        },()=>{if(account.current===owner)toast.error('捕捞库已在本机删除，云端尚未确认同步');});
      }else{
        removeFish(request.ids);
        setRequest(undefined);
      }
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  };

  return <FishBulkDeleteContext.Provider value={state.deleteSources?r=>{setError('');setRequest(r);}:null}>
    {children}
    <Dialog open={!!request} onOpenChange={v=>{if(!v&&!busy)setRequest(undefined);}}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{request?.clearAll?'清空捕捞库':`批量删除${request?.kind==='mining'?'捕捞库':'鱼舱'}数据`}</DialogTitle>
          <DialogDescription>
            {request?.clearAll?'清空捕捞库的历史记录和扫描档位。之后重新捕捞或手动导入的记录仍会入库。':'过滤库、监测库同步移除所选来源的关联。同一信号与入场时刻还有其他来源或挖掘记录时，保留共用结果。'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p>所选记录 {request?.ids.length??0} 条；关联过滤库 {filters} 条；监测库 {monitors} 条。</p>
          <p className="text-xs text-muted-foreground">交易战役、账户交易记录和另一来源库保留。</p>
          {error&&<p role="alert" className="text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={()=>setRequest(undefined)}>取消</button>
            <button type="button" className="rounded bg-destructive px-3 py-2 text-destructive-foreground disabled:opacity-50" disabled={busy||!state.ready} onClick={()=>void confirm()}>{busy?'正在删除…':'确认删除及关联结果'}</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </FishBulkDeleteContext.Provider>;
}
