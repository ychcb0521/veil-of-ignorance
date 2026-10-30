import {createContext,useContext,useState,useEffect,useRef,type ReactNode} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from './ui/dialog';
import {deleteMiningRecords,sourceDeletionMatcher,deletionKey,type DeleteTarget} from '@/lib/fish/libraryDeletion';
import {updateMiningLibrary} from '@/lib/fish/miningLibraryStore';
import type {FishQualityState} from '@/hooks/useFishQuality';
type Request={kind:'hold'|'mining';ids:string[];targets:DeleteTarget[]};
export const FishBulkDeleteContext=createContext<((r:Request)=>void)|null>(null);
export const useFishBulkDelete=()=>useContext(FishBulkDeleteContext);
export function FishBulkDeletionProvider({state,removeFish,children}:{state:FishQualityState;removeFish:(ids:readonly string[])=>void;children:ReactNode}){
 const [request,setRequest]=useState<Request>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const account=useRef(state.account);account.current=state.account;useEffect(()=>{setRequest(undefined);setError('');},[state.account]);
 const gone=sourceDeletionMatcher(Object.fromEntries((request?.targets??[]).map(t=>[deletionKey(t),1]))),filters=state.study.filterLibrary?.records.filter(r=>gone(r.source,r.enteredAt)).length??0,monitors=state.study.monitorLibrary?.records.filter(r=>gone(r.source,r.enteredAt)).length??0;
 const confirm=async()=>{if(!request||!state.deleteSources)return;const owner=state.account;setBusy(true);setError('');try{await state.deleteSources(request.targets);if(account.current!==owner)throw Error('账号已切换，请返回原账号继续');if(request.kind==='mining'){if(!await updateMiningLibrary(owner,l=>deleteMiningRecords(l,request.ids)))throw Error('关联结果已删除，挖掘库删除未保存，请重试');}else removeFish(request.ids);setRequest(undefined);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <FishBulkDeleteContext.Provider value={state.deleteSources?r=>{setError('');setRequest(r);}:null}>{children}<Dialog open={!!request} onOpenChange={v=>{if(!v&&!busy)setRequest(undefined);}}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>批量删除{request?.kind==='mining'?'挖掘库':'鱼舱'}数据</DialogTitle><DialogDescription>按交易所、市场、标的、信号时间与入场时刻关联。相同信号入场记录在过滤库、监测库中的各算法和阈值结果一并删除；其他入场时刻保留；所选数据未记录入场时刻时，按同一信号清理。</DialogDescription></DialogHeader><div className="space-y-2 text-sm"><p>所选记录 {request?.ids.length??0} 条；关联过滤库 {filters} 条；监测库 {monitors} 条。</p><p className="text-xs text-muted-foreground">本操作清理研究数据和轮次引用，并同步删除标记；不影响交易战役或账户交易记录。另一来源库保持独立。</p>{error&&<p role="alert" className="text-destructive">{error}</p>}<div className="flex justify-end gap-2"><button type="button" className="rounded border px-3 py-2" disabled={busy} onClick={()=>setRequest(undefined)}>取消</button><button type="button" className="rounded bg-destructive px-3 py-2 text-destructive-foreground disabled:opacity-50" disabled={busy||!state.ready} onClick={()=>void confirm()}>{busy?'正在删除…':'确认删除及关联结果'}</button></div></div></DialogContent></Dialog></FishBulkDeleteContext.Provider>;
}
