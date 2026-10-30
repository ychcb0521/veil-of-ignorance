import {cloneElement,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactElement,type ReactNode} from 'react';

const OVERSCAN=8,VIEWPORT=400;
/** The first row whose bottom is below y. Variable-height rows keep one continuous scroll range. */
function rowAt(offsets:readonly number[],y:number){let lo=0,hi=offsets.length-1;while(lo<hi){const mid=(lo+hi)>>>1;if(offsets[mid+1]<=y)lo=mid+1;else hi=mid;}return Math.min(lo,Math.max(0,offsets.length-2));}
function windowAt(offsets:readonly number[],top:number,height:number){const count=offsets.length-1;return {start:Math.max(0,rowAt(offsets,top)-OVERSCAN),end:Math.min(count,rowAt(offsets,top+height)+OVERSCAN+1)};}
interface View {top:number;height:number;revision:number}
interface Props<T>{
 items:readonly T[];getKey:(item:T)=>string;row:(item:T)=>ReactElement;header:ReactNode;columns:number;
 resetKey:string;label:string;testId:string;className?:string;tableClassName?:string;headClassName?:string;estimate?:number;empty?:ReactNode;
}
/** Shared by mining, filter, monitoring and imported collections. All selection/export still operates on the full input. */
export function FishContinuousTable<T>({items,getKey,row,header,columns,resetKey,label,testId,className='',tableClassName='',headClassName='',estimate=72,empty}:Props<T>){
 const host=useRef<HTMLDivElement>(null),nodes=useRef(new Map<string,HTMLTableRowElement>()),heights=useRef(new Map<string,number>());
 const keys=useMemo(()=>items.map(getKey),[items,getKey]),[view,setView]=useState<View>({top:0,height:VIEWPORT,revision:0});
 const [focused,setFocused]=useState<string>(),[expanded,setExpanded]=useState<Set<string>>(()=>new Set());
 // Measured heights live in a ref; revision invalidates the cached offsets.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const layout=useMemo(()=>{const offsets=[0],indices=new Map<string,number>();keys.forEach((key,i)=>{indices.set(key,i);offsets.push(offsets[i]+(heights.current.get(key)??estimate));});return {keys,offsets,indices};},[keys,estimate,view.revision]);
 const live=useRef({layout,view,resetKey});live.current={layout,view,resetKey};
 const refresh=useCallback(()=>{
  const el=host.current;if(!el)return;const current=live.current,{layout:l,view:v}=current,top=el.scrollTop;
  let changed=false,adjustment=0;
  for(const [key,node]of nodes.current){const height=node.getBoundingClientRect().height,index=l.indices.get(key);if(!(height>0)||index===undefined)continue;const old=heights.current.get(key)??l.offsets[index+1]-l.offsets[index];if(Math.abs(height-old)<.5)continue;
   heights.current.set(key,height);changed=true;if(l.offsets[index+1]<=top)adjustment+=height-old;
  }
  if(adjustment)el.scrollTop=Math.max(0,top+adjustment);
  const next={top:el.scrollTop,height:el.clientHeight||VIEWPORT,revision:v.revision+(changed?1:0)},a=windowAt(l.offsets,v.top,v.height),b=windowAt(l.offsets,next.top,next.height);
  if(changed||a.start!==b.start||a.end!==b.end||v.height!==next.height){live.current={...current,view:next};setView(next);}
 },[]);
 const scheduled=useRef(false),frame=useRef(0);
 const schedule=useCallback(()=>{if(scheduled.current)return;if(typeof requestAnimationFrame!=='function'){refresh();return;}scheduled.current=true;frame.current=requestAnimationFrame(()=>{scheduled.current=false;refresh();});},[refresh]);
 const observer=useRef<ResizeObserver>();
 const attach=useCallback((key:string,node:HTMLTableRowElement|null)=>{const prior=nodes.current.get(key);if(prior)observer.current?.unobserve(prior);if(node){nodes.current.set(key,node);observer.current?.observe(node);}else nodes.current.delete(key);},[]);
 useLayoutEffect(()=>{const el=host.current;if(!el)return;el.scrollTop=0;setFocused(undefined);const next={...live.current.view,top:0};live.current={...live.current,view:next};setView(next);refresh();},[resetKey,refresh]);
 // Keep the same visible record in place when new results arrive or an earlier record is deleted.
 const previous=useRef({layout,resetKey});
 useLayoutEffect(()=>{const prior=previous.current,el=host.current;previous.current={layout,resetKey};if(!el||prior.resetKey!==resetKey||prior.layout.keys===layout.keys||el.scrollTop<=0)return;
  const i=rowAt(prior.layout.offsets,el.scrollTop),key=prior.layout.keys[i],next=layout.indices.get(key);if(next!==undefined)el.scrollTop=Math.max(0,layout.offsets[next]+el.scrollTop-prior.layout.offsets[i]);refresh();
 },[layout,resetKey,refresh]);
 useLayoutEffect(()=>{refresh();},[layout,refresh]);
 useEffect(()=>{const el=host.current;if(!el)return;el.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
  const toggle=(event:Event)=>{const tr=(event.target as HTMLElement).closest('tr[data-continuous-row]'),key=tr?.getAttribute('data-continuous-row');if(key==null)return;const open=!!tr?.querySelector('details[open]');setExpanded(old=>{if(old.has(key)===open)return old;const next=new Set(old);if(open)next.add(key);else next.delete(key);return next;});schedule();};el.addEventListener('toggle',toggle,true);
  if(typeof ResizeObserver!=='undefined'){observer.current=new ResizeObserver(schedule);observer.current.observe(el);for(const node of nodes.current.values())observer.current.observe(node);}
  return()=>{el.removeEventListener('toggle',toggle,true);el.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);observer.current?.disconnect();observer.current=undefined;if(scheduled.current&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(frame.current);scheduled.current=false;};
 },[schedule]);
 const range=windowAt(layout.offsets,view.top,view.height),indices=new Set<number>();for(let i=range.start;i<range.end;i++)indices.add(i);
 if(items.length){indices.add(0);indices.add(items.length-1);}for(const key of expanded){const i=layout.indices.get(key);if(i!==undefined)indices.add(i);}
 const focus=focused===undefined?undefined:layout.indices.get(focused);if(focus!==undefined)for(let i=Math.max(0,focus-1);i<=Math.min(items.length-1,focus+1);i++)indices.add(i);
 const rows:ReactNode[]=[];let cursor=0;
 const spacer=(from:number,to:number)=>{if(to>from)rows.push(<tr key={`gap:${from}`} aria-hidden="true" data-continuous-spacer><td colSpan={columns} style={{height:layout.offsets[to]-layout.offsets[from],padding:0,border:0}}/></tr>);};
 for(const i of [...indices].sort((a,b)=>a-b)){spacer(cursor,i);const key=keys[i];rows.push(<MeasuredRow key={key} id={key} index={i} attach={attach}>{row(items[i])}</MeasuredRow>);cursor=i+1;}spacer(cursor,items.length);
 return <div ref={host} role="region" tabIndex={0} aria-label={label} data-testid={testId} className={`overflow-auto [overflow-anchor:none] ${className}`}
  onFocusCapture={e=>{const key=(e.target as HTMLElement).closest('tr[data-continuous-row]')?.getAttribute('data-continuous-row');setFocused(key??undefined);}}
  onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setFocused(undefined);}}>
  <table className={`w-full border-separate border-spacing-0 ${tableClassName}`} aria-rowcount={items.length+1}><thead className={`sticky top-0 z-20 bg-background ${headClassName}`}>{header}</thead><tbody>{rows}</tbody></table>
  {!items.length&&empty}
 </div>;
}
function MeasuredRow({id,index,attach,children}:{id:string;index:number;attach:(id:string,node:HTMLTableRowElement|null)=>void;children:ReactElement}){
 const ref=useCallback((node:HTMLTableRowElement|null)=>attach(id,node),[id,attach]);
 return cloneElement(children as ReactElement<Record<string,unknown>>,{ref,'data-continuous-row':id,'aria-rowindex':index+2});
}
