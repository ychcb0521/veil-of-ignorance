import {createContext,useContext} from 'react';
import {Database,Download,Upload} from 'lucide-react';
import type {LibraryScope} from '@/lib/fish/libraryTransfer';
export const FishLibraryTransferContext=createContext<((scope:LibraryScope,action?:'download'|'import')=>void)|null>(null);
export function FishLibraryDataActions({scope}:{scope:LibraryScope}){
 const open=useContext(FishLibraryTransferContext);if(!open)return null;
 const name=scope==='mining'?'挖掘库':scope==='filter'?'过滤库':scope==='monitor'?'监测库':'三库';
 return <span className="inline-flex items-center gap-1"><button type="button" className="inline-flex h-7 items-center gap-1 rounded px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`完整下载${name}`} onClick={()=>open(scope,'download')}><Download className="h-3 w-3"/>完整下载</button><button type="button" className="inline-flex h-7 items-center gap-1 rounded px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`导入${name}数据`} onClick={()=>open(scope,'import')}><Upload className="h-3 w-3"/>导入</button></span>;
}
export function FishLibraryDataButton(){const open=useContext(FishLibraryTransferContext);return open?<button type="button" className="inline-flex h-7 items-center gap-1 rounded px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground" onClick={()=>open('all')} aria-label="三库数据下载导入与汇总"><Database className="h-3 w-3"/>三库数据</button>:null;}
