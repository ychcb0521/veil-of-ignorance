import {useCallback,useEffect,useState} from 'react';
import {readRecentMonitorDirectory} from '@/lib/fish/qualityRecentLibraryStore';
import type {RecentMonitorDirectory} from '@/lib/fish/qualityRecentLibrary';
export function useRecentMonitorDirectory(owner:string|undefined,enabled:boolean){
 const [attempt,retry]=useState(0),[state,setState]=useState<{owner?:string;directory?:RecentMonitorDirectory;loading:boolean;error?:string}>({loading:false});
 useEffect(()=>{
  if(!enabled||!owner)return;
  let active=true;
  setState(previous=>({owner,loading:true,...(previous.owner===owner?{directory:previous.directory}:{}),error:undefined}));
  void readRecentMonitorDirectory(owner).then(directory=>{if(active)setState({owner,directory,loading:false});},()=>{if(active)setState({owner,loading:false,error:'近期目录读取失败，可重试读取'});});
  return()=>{active=false;};
 },[owner,enabled,attempt]);
 return {...(state.owner===owner?state:{loading:enabled}),retry:useCallback(()=>retry(n=>n+1),[])};
}
