import {useState} from 'react';
import type {DeepDigData} from '@/lib/deepDig/analysis';
import type {DeepDigSeries} from '@/lib/deepDig/series';
import {DBL5_DEFAULTS,type Dbl5Row,type Dbl5EventType} from '@/lib/dbl5m';
import {dbl5StepPath} from '@/lib/dbl5mChart';
import {formatUTC8} from '@/lib/timeFormat';
export const DBL5_LABELS:Record<Dbl5EventType,string>={NONE:'无新事件',BASELINE:'基准箱',UP_STEP:'完整上移',NESTED_HIGHER_FLOOR:'内部箱底抬高（非完整上移）',SAME_FLOOR:'同底新箱',SUPPORT_BROKEN:'支撑破坏',SUPPORT_EXPIRED:'证据到期',DATA_GAP:'行情缺口',DATA_INVALID:'数据无效',BOX_CONFIRMED:'箱体完成确认',CANDIDATE_EXPIRED:'候选到期',CANDIDATE_CANCELLED:'候选被更高价格取消'};
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Number(v.toPrecision(12)).toString():'—';
export function Dbl5PriceChart({rows,prices=[]}:{rows:readonly Dbl5Row[];prices?:readonly {time:number;close:number}[]}){
 const W=960,H=260,P=42,close=new Map(prices.map(p=>[p.time,p.close]));
 const values=rows.flatMap(r=>[close.get(r.at),r.darvas_5m_lower,r.darvas_5m_upper]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
 const low=values.length?Math.min(...values):0,high=values.length?Math.max(...values):1,range=high-low||1,first=rows[0]?.at??0,last=rows.at(-1)?.at??first+1;
 const x=(at:number)=>P+(at-first)/(last-first||1)*(W-2*P),y=(v:number)=>H-P-(v-low)/range*(H-2*P);
 const events=rows.flatMap(r=>r.events);
 return <div className="space-y-2"><svg role="img" aria-label="DBL-5 已确认箱体上下轨价格图" viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg border border-border/50 bg-background">
  {[0,.5,1].map(f=><g key={f}><line x1={P} x2={W-P} y1={y(low+f*range)} y2={y(low+f*range)} stroke="currentColor" opacity=".07"/><text x="3" y={y(low+f*range)-3} fill="currentColor" opacity=".55" fontSize="10">{number(low+f*range)}</text></g>)}
  <path d={rows.map((r,i)=>{const v=close.get(r.at);return v===undefined?'':`${i&&close.has(rows[i-1].at)?'L':'M'}${x(r.at)},${y(v)}`;}).join(' ')} fill="none" stroke="#8995a4" opacity=".6" strokeWidth="1"/>
  <path data-dbl-line="upper" d={dbl5StepPath(rows.map(r=>({x:x(r.at),y:r.darvas_5m_upper===null?null:y(r.darvas_5m_upper),episode:r.box_id})))} fill="none" stroke="#8895a5" strokeWidth="1.1"/>
  <path data-dbl-line="lower" d={dbl5StepPath(rows.map(r=>({x:x(r.at),y:r.darvas_5m_lower===null?null:y(r.darvas_5m_lower),episode:r.episode_id})))} fill="none" stroke="#0b9f78" strokeWidth="2.3"/>
  {rows.flatMap(r=>r.darvas_5m_event==='NESTED_HIGHER_FLOOR'&&r.darvas_5m_lower!==null?[<circle key={r.at} cx={x(r.at)} cy={y(r.darvas_5m_lower)} r="4" fill="#bd952f"><title>内部箱底抬高，不代表完整上移</title></circle>]:[])}
  {events.filter(e=>!['CANDIDATE_EXPIRED','CANDIDATE_CANCELLED','BOX_CONFIRMED'].includes(e.type)).map(e=><circle key={e.id} cx={x(e.at)} cy={P-14} r="2.7" fill={e.type==='SUPPORT_BROKEN'?'#d37c72':e.type==='NESTED_HIGHER_FLOOR'?'#bd952f':'#0b9f78'}><title>{DBL5_LABELS[e.type]} · {formatUTC8(e.at)}</title></circle>)}
  <text x={P} y={H-10} fill="currentColor" opacity=".5" fontSize="10">{rows.length?formatUTC8(first):''}</text><text x={W-P} y={H-10} textAnchor="end" fill="currentColor" opacity=".5" fontSize="10">{rows.length?formatUTC8(last):''}</text>
 </svg><div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-muted-foreground"><span>收盘价</span><span className="text-emerald-600">━ 已确认下轨</span><span>━ 固定上轨</span><span className="text-amber-600">● 内部抬高单独标记</span><span>确认前与终止后留空；不同结构段不连线</span></div></div>;
}
export function Dbl5EvidenceView({data,series}:{data:DeepDigData;series?:DeepDigSeries|null}){
 const [sample,setSample]=useState(''),[at,setAt]=useState<number|null>(null),[filter,setFilter]=useState('');
 const event=data.rows.find(r=>r.id===sample)??data.rows.find(r=>r.DBL5_details||series?.DBL5_windows?.[r.id]?.rows.length);
 if(!event)return <p className="text-xs text-muted-foreground">DBL-5 尚无已计算记录。价格研究先选择单一标的，再运行描述统计。</p>;
 const window=series?.DBL5_windows?.[event.id],rows=window?.rows??(event.DBL5_details?[event.DBL5_details]:[]),index=Math.max(0,Math.min(at??rows.length-1,rows.length-1)),row=rows[index];if(!row)return null;
 const events=[...new Map(rows.flatMap(r=>r.events).map(e=>[e.id,e])).values()],available=rows.filter(r=>r.darvas_5m_available).length;
 const download=()=>{const u=URL.createObjectURL(new Blob([JSON.stringify({definition:data.definition,symbol:event.symbol,rows,checkpoint:window?.checkpoint??event.DBL5_checkpoint,diagnostics:data.DBL5_diagnostics},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=`DBL-5-${event.symbol}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
 const status={ACTIVE:'有效箱体',SEARCHING:'等待箱体',WARMUP:'连续行情预热中',DATA_UNAVAILABLE:'数据不可验证'};
 return <section data-testid="dbl5-evidence" className="space-y-3 rounded-xl border border-border/60 p-3 sm:p-4">
  <div className="flex flex-wrap items-center gap-3 text-xs"><strong>DBL-5 · 已确认箱体下轨</strong><select aria-label="DBL5 样本" value={event.id} onChange={e=>{setSample(e.target.value);setAt(null);}} className="max-w-full rounded border border-border bg-background px-2 py-1">{data.rows.filter(r=>r.DBL5_details).map(r=><option key={r.id} value={r.id}>{r.symbol} · {formatUTC8(r.anchorMs)}</option>)}</select><button type="button" onClick={download} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground">导出结构与检查点</button></div>
  {!event.DBL5_details&&<p className="text-[11px] text-amber-600">查询时点缺少最近已收盘的5m行情，主值为空；以下仅显示此前实际发布的历史证据。</p>}
  <Dbl5PriceChart rows={rows} prices={window?.prices}/>
  {rows.length>1&&<input aria-label="DBL5 已收盘时点" type="range" min="0" max={rows.length-1} value={index} onChange={e=>setAt(Number(e.target.value))} className="w-full accent-emerald-600"/>}
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>{formatUTC8(row.at)}</span><strong className="text-foreground">{status[row.darvas_5m_status]}</strong><span>{row.formation_type?DBL5_LABELS[row.formation_type]:'尚无有效结构'}</span><span>本根 · {DBL5_LABELS[row.darvas_5m_event]}</span></div>
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{[['已确认下轨',row.darvas_5m_lower],['固定上轨',row.darvas_5m_upper],['距离 / bp',row.darvas_5m_distance_bps],['箱宽 / bp',row.darvas_5m_width_bps],['确认年龄 / 分钟',row.darvas_5m_age_minutes]].map(([label,value])=><div key={String(label)} className="rounded-lg bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground"><span>{label}</span><div className="mt-1 font-mono text-sm text-foreground">{number(value)}</div></div>)}</div>
  {row.double_breach&&<p className="text-[11px] text-amber-600">同根上下双破：支撑已破坏，OHLC 无法判断盘中先后顺序。</p>}
  <p className="text-[11px] text-muted-foreground">本窗口有效 {available} 根 · 空值 {rows.length-available} 根 · tick {row.tick_size??'缺失'} · {row.data_valid?'本根数据有效':'本根数据无效'}{row.reason_codes.length?' · '+row.reason_codes.join(' / '):''}</p>
  <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">结构事件与确认时点</summary><div className="my-2 flex items-center gap-2"><span>事件</span><select aria-label="DBL5 事件筛选" value={filter} onChange={e=>setFilter(e.target.value)} className="rounded border border-border bg-background px-2 py-1"><option value="">全部事件</option>{[...new Set(events.map(e=>e.type))].map(type=><option key={type} value={type}>{DBL5_LABELS[type]}</option>)}</select></div><div className="max-h-56 space-y-1 overflow-auto">{events.filter(e=>!filter||e.type===filter).map(e=><p key={e.id}>{formatUTC8(e.at)} · {DBL5_LABELS[e.type]}{e.double_breach?' · 上下双破':''}</p>)}</div><p className="mt-2">事件独立于下轨是否为空记录。箱底确认不代表已经通过后续回踩验证，普通触底不会续期。</p></details>
  <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">冻结坐标、版本与回放起点</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify({box_id:row.box_id,episode_id:row.episode_id,ended_box_id:row.ended_box_id,ended_episode_id:row.ended_episode_id,seed_time:row.seed_time,origin_time:row.origin_time,floor_anchor_time:row.floor_anchor_time,top_confirmed_at:row.top_confirmed_at,confirmed_at:row.confirmed_at,expires_at:row.expires_at,algorithm_version:row.algorithm_version,parameters:{...DBL5_DEFAULTS,...data.definition.DBL5_config},config_hash:row.config_hash,initialization_start:row.initialization_start,initialization_id:row.initialization_id,data_version:row.data_version,data_checksum:row.data_checksum,formation_freshness:row.darvas_5m_freshness,new_confirmations:row.new_confirmations},null,2)}</pre></details>
  <p className="text-[10px] text-muted-foreground">5m 已收盘工程改编，默认 n=3、几何证据360分钟，参数尚未实证拟合。窗口限制证据年龄，状态还依赖回放起点或检查点；指标不执行交易，也不修改真实止损。</p>
 </section>;
}
