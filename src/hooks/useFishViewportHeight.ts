import {useLayoutEffect,useState,type RefObject} from 'react';

/** Fill only the space below the existing Time Machine controls; keep the chart mounted below. */
export function useFishViewportHeight(open:boolean,host:RefObject<HTMLElement>){
 const [height,setHeight]=useState<number>();
 useLayoutEffect(()=>{
  if(!open){setHeight(undefined);return;}
  const fit=()=>{const node=host.current;if(!node)return;const viewport=window.visualViewport;
   const bottom=(viewport?.height??window.innerHeight)+(viewport?.offsetTop??0),padding=parseFloat(getComputedStyle(node.parentElement!).paddingBottom)||0;
   const next=Math.max(0,Math.floor(bottom-node.getBoundingClientRect().top-padding));setHeight(old=>old===next?old:next);
  };
  fit();const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(fit);
  if(host.current?.parentElement)observer?.observe(host.current.parentElement);
  window.addEventListener('resize',fit);window.visualViewport?.addEventListener('resize',fit);
  window.visualViewport?.addEventListener('scroll',fit);
  return()=>{observer?.disconnect();window.removeEventListener('resize',fit);window.visualViewport?.removeEventListener('resize',fit);window.visualViewport?.removeEventListener('scroll',fit);};
 },[open,host]);
 return open?height:undefined;
}
