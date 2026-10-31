import {useState} from 'react';
import type {DeepDigData} from '@/lib/deepDig/analysis';
import type {DeepDigSeries} from '@/lib/deepDig/series';
import {SBS5M_DEFAULTS,type SbsRow} from '@/lib/sbs5m';
import {sbsStepPath} from '@/lib/sbs5mChart';
import {formatUTC8} from '@/lib/timeFormat';
const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Number(v.toPrecision(7)).toString():'—';
const labels:Record<string,string>={NO_STRUCTURE:'等待结构',ACTIVE:'支撑有效',INVALID:'结构失效',STALE:'日内期限已过',DATA_UNAVAILABLE:'数据不可验证',FROZEN:'候选已冻结',TESTING:'测试中',CONFIRMED:'已确认',FAILED:'测试失败',EXPIRED:'候选过期',PARENT_TERMINATED:'父结构已终止',NONE:'无',ARMED:'等待独立触碰',WAITING_FOR_DEPARTURE:'等待重新离开',SUCCEEDED:'测试成功',BASELINE_CONFIRMED:'建立基准',STEP_CONFIRMED:'支撑抬升',TEST_STARTED:'首次测试',TEST_SUCCEEDED:'测试恢复',BREAKOUT_CONFIRMED:'箱顶突破',RETEST_STARTED:'再次测试',RETEST_SUCCEEDED:'再次测试恢复',RETEST_FAILED:'再次测试超时',REPLACED:'更高箱体替换'};
export function SbsPriceChart({rows,prices=[]}:{rows:readonly SbsRow[];prices?:readonly {time:number;close:number}[]}){
 const W=960,H=270,P=42,map=new Map(prices.map(p=>[p.time,p.close]));
 const fields=['support_price','box_top','invalidation_price','candidate_support_price'] as const,colors=['#0b9f78','#94a3b8','#d37c72','#bd952f'];
 const values=rows.flatMap(r=>[map.get(r.at??0),...fields.map(f=>r[f])]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
 const low=values.length?Math.min(...values):0,high=values.length?Math.max(...values):1,range=high-low||1;
 const x=(i:number)=>P+i/Math.max(1,rows.length-1)*(W-2*P),y=(v:number)=>H-P-(v-low)/range*(H-2*P);
 const events=rows.flatMap((r,i)=>r.events.map(e=>({...e,i})));
 return <div className="space-y-1.5"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="SBS-5M 价格轴：固定支撑、候选与失效参考" className="w-full rounded-lg border border-border/50 bg-background">
  {[0,.5,1].map(f=><g key={f}><line x1={P} x2={W-P} y1={y(low+f*range)} y2={y(low+f*range)} stroke="currentColor" opacity=".07"/><text x="3" y={y(low+f*range)-3} fontSize="10" fill="currentColor" opacity=".5">{n(low+f*range)}</text></g>)}
  <path fill="none" stroke="#8b96a5" strokeWidth="1" opacity=".65" d={prices.length?rows.map((r,i)=>{const v=map.get(r.at??0);return v===undefined?'':`${i&&map.has(rows[i-1]?.at??0)?'L':'M'}${x(i)},${y(v)}`;}).join(' '):''}/>
  {fields.map((field,k)=><path key={field} data-sbs-line={field} fill="none" stroke={colors[k]} strokeWidth={k===0?2.3:1.1} strokeDasharray={k===3?'4 4':k===2?'6 4':undefined} d={sbsStepPath(rows.map((r,i)=>({x:x(i),y:r[field]===null?null:y(r[field]!),episode:k===3?r.candidate_box_id:r.episode_id})))}/>)}
  {fields.flatMap((field,k)=>rows.flatMap((r,i)=>{const id=k===3?r.candidate_box_id:r.episode_id,v=r[field],before=rows[i-1],after=rows[i+1];return v!==null&&id&&(!before||before[field]===null)&&(!after||after[field]===null)?[<circle key={field+i} cx={x(i)} cy={y(v)} r={k===3?2.5:1.6} fill={colors[k]}/>]:[];}))}
  {events.filter(e=>['FROZEN','BASELINE_CONFIRMED','STEP_CONFIRMED','INVALID','STALE','BREAKOUT_CONFIRMED','TEST_STARTED','RETEST_STARTED'].includes(e.type)).map(e=><circle key={e.id} cx={x(e.i)} cy={P-14} r="2.5" fill={e.type==='INVALID'?'#d37c72':'#bd952f'}><title>{labels[e.type]??e.type} · {formatUTC8(e.at)} · {e.reason_codes.join(' / ')}</title></circle>)}
 </svg><div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-muted-foreground"><span>收盘价</span>{['有效支撑（实线台阶）','固定箱顶','固定失效参考','冻结候选（虚线，尚未确认）'].map((l,i)=><span key={l} style={{color:colors[i]}}>━ {l}</span>)}</div></div>;
}
export function Sbs5mEvidenceView({data,series}:{data:DeepDigData;series?:DeepDigSeries|null}){
 const [id,setId]=useState(''),[at,setAt]=useState<number|null>(null),event=data.rows.find(r=>r.id===id)??data.rows.find(r=>r.SBS5M_details);
 if(!event)return <p className="text-xs text-muted-foreground">SBS-5M 尚无结构明细，请运行描述统计。支撑价请按单一品种研究。</p>;
 const window=series?.SBS5M_windows?.[event.id],rows=window?.rows??[event.SBS5M_details!],index=Math.max(0,Math.min(at??rows.length-1,rows.length-1)),row=rows[index];if(!row)return null;
 const download=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify({definition:data.definition,symbol:event.symbol,rows,checkpoint:window?.checkpoint??event.SBS5M_checkpoint,evaluation:data.SBS5M_evaluation},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=`SBS-5M-${event.symbol}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
 return <section data-testid="sbs5m-evidence" className="space-y-3 rounded-xl border border-border/60 p-3 sm:p-4">
  <div className="flex flex-wrap items-center gap-3 text-xs"><strong>SBS-5M · 台阶箱体支撑</strong><select aria-label="SBS5M 样本" value={event.id} onChange={e=>{setId(e.target.value);setAt(null);}} className="max-w-full rounded border border-border bg-background px-2 py-1">{data.rows.filter(r=>r.SBS5M_details).map(r=><option key={r.id} value={r.id}>{r.symbol} · {formatUTC8(r.anchorMs)}</option>)}</select><button onClick={download} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">导出结构与检查点</button></div>
  <SbsPriceChart rows={rows} prices={window?.prices}/>
  {rows.length>1&&<input aria-label="SBS5M 已收盘时点" type="range" min="0" max={rows.length-1} value={index} onChange={e=>setAt(Number(e.target.value))} className="w-full accent-emerald-600"/>}
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>{formatUTC8(row.at)}</span><strong className={row.support_status==='ACTIVE'?'text-emerald-600':'text-foreground'}>{labels[row.support_status]}</strong><span>候选 · {labels[row.candidate_status]}</span><span>再次测试 · {labels[row.retest_status]}</span></div>
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{[['固定支撑',row.support_price],['失效参考',row.invalidation_price],['证据分 / 100',row.support_quality],['距离 / 事前尺度',row.distance_to_support],['台阶幅度 / 新尺度',row.step_height_atr],['事件抬升幅度',row.step_event_height]].map(([l,v])=><div key={String(l)} className="rounded-lg bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground"><span>{l}</span><div className="mt-1 font-mono text-sm text-foreground">{n(v)}</div></div>)}</div>
  <p className="text-[11px] text-muted-foreground">{row.data_valid?'已收盘数据可验证':'数据无法验证，主线断开'} · {row.calculation_status} · {row.volume_mode==='quote'?'报价币成交额':'基础币量 × 收盘价（独立近似模式）'}{row.reason_codes.length?' · '+row.reason_codes.join(' / '):''}</p>
  <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">结构事件与识别时点</summary><div className="mt-2 max-h-52 space-y-1 overflow-auto">{rows.flatMap(r=>r.events).map(e=><p key={e.id}>{formatUTC8(e.at)} · {labels[e.type]??e.type} {e.reason_codes.join(' / ')}</p>)}</div><p className="mt-2">形成区间不代表已知支撑：冻结后才显示候选，确认后才显示有效实线。再次测试超时会单独记录，未触发价格失效时保持支撑。</p></details>
  <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">参数、证据分项与研究诊断</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify({feature_version:row.feature_version,config_hash:row.config_hash,initialization_id:row.initialization_id,data_checksum:row.data_checksum,box_id:row.box_id,parent_box_id:row.parent_box_id,episode_id:row.episode_id,parameters:{...SBS5M_DEFAULTS,...data.definition.SBS5M_config},h:row.hold_fraction,d:row.penetration_component,f:row.test_freshness,evaluation:data.SBS5M_evaluation},null,2)}</pre></details>
  <p className="text-[10px] text-muted-foreground">参数为研究初值；证据分不是概率或胜率，失效参考不自动修改实际止损。主线有价格单位，跨品种请使用证据分、标准化距离或台阶幅度。6小时是有效期限；回放结果还取决于明确的初始化位置或检查点。</p>
 </section>;
}
