import {useState} from 'react';
import {ATI6H_COMPONENTS,ATI6H_LABELS,type AtiRow} from '@/lib/ati6h';
import type {DeepDigData} from '@/lib/deepDig/analysis';
import type {DeepDigSeries} from '@/lib/deepDig/series';
import {formatUTC8} from '@/lib/timeFormat';
const colors=['#16a34a','#b78b10','#2563eb','#9333ea','#e96d22','#0891b2'];
const eventLabels:Record<string,string>={support_confirmed:'支撑确认',touch:'触碰支撑',retest_confirmed:'回踩确认',failed_retest:'回踩超时',broken:'支撑破位',expired:'结构过期',unverifiable:'数据中断',replaced:'结构升级',breakout_first_observed:'首次观测突破',breakout_cross:'突破穿越'};
const reasonLabels:Record<string,string>={no_structure:'尚未形成有效调整结构',broken:'支撑已破位，等待新结构',expired:'结构已超出6小时，等待新结构',awaiting_new_structure:'等待新结构',unverifiable:'数据中断，原结构无法继续验证',incomplete_window:'6小时窗口不完整',missing_tick_size:'缺少交易所最小价格单位',missing_mbi2_sigma:'MBI2波动尺度未就绪',missing_window_scale:'窗口内波动尺度不完整',missing_mbi2_state:'MBI2状态缺失',missing_quote_volume:'缺少计价成交额',missing_taker_volume:'缺少主动买入成交额',invalid_taker_volume:'主动买入成交额不合法',zero_volume:'没有可用成交证据',no_resistance_detected_in_6h:'6小时规则内未检测到上方阻力'};
const number=(x:unknown,d=4)=>typeof x==='number'&&Number.isFinite(x)?x.toPrecision(d):'—';
export function EvidenceLineChart({rows,fields,labels,price=false,max=1,title}:{rows:Record<string,unknown>[];fields:string[];labels:string[];price?:boolean;max?:number;title?:string}){
 const width=940,height=price?240:180,pad=35;
 const values=rows.flatMap(r=>fields.flatMap(f=>typeof r[f]==='number'&&Number.isFinite(r[f])?[r[f] as number]:[]));
 const low=price&&values.length?Math.min(...values):0,high=price&&values.length?Math.max(...values):max,range=Math.max(high-low,1e-9);
 const xy=(i:number,v:number)=>`${pad+i/Math.max(1,rows.length-1)*(width-2*pad)},${height-pad-(v-low)/range*(height-2*pad)}`;
 return <><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title??(price?'ATI-6H 固定支撑、失效边界、突破线与阻力':'ATI-6H 综合分和六分量曲线')} className="w-full rounded-lg border border-border/60 bg-background">
  {[0,.5,1].map(f=><g key={f}><line x1={pad} x2={width-pad} y1={height-pad-f*(height-2*pad)} y2={height-pad-f*(height-2*pad)} stroke="currentColor" opacity=".1"/><text x="3" y={height-pad-f*(height-2*pad)} fill="currentColor" fontSize="10">{number(low+f*range)}</text></g>)}
  {fields.map((field,k)=>{let path='',segment=false,lastStructure:unknown=null;rows.forEach((r,i)=>{const v=r[field],id=r.ATI6H_structure_id;if(typeof v!=='number'||!Number.isFinite(v)){segment=false;return;}if(price&&k>0&&id!==lastStructure)segment=false;path+=`${segment?'L':'M'}${xy(i,v)} `;segment=true;lastStructure=id;});return <path key={field} d={path} stroke={k===0?'currentColor':colors[(k-1)%colors.length]} strokeWidth={k===0?2.2:1.4} strokeDasharray={price&&k>0?'5 3':undefined} fill="none"/>;})}
  {price&&rows.flatMap((r,i)=>(r.ATI6H_events as AtiRow['ATI6H_events']??[]).map((e,j)=><g key={`${i}-${j}`}><line x1={xy(i,low).split(',')[0]} x2={xy(i,low).split(',')[0]} y1={pad} y2={height-pad} stroke={e.ATI6H_type==='broken'?'#dc2626':'#b78b10'} opacity=".35"/><circle cx={xy(i,low).split(',')[0]} cy={pad+8*(j%3)} r="3" fill="#b78b10"><title>{`${eventLabels[e.ATI6H_type]??e.ATI6H_type} · ${formatUTC8(e.ATI6H_at)}`}</title></circle></g>))}
 </svg><div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">{labels.map((label,k)=><span key={label} style={{color:k===0?'#516179':colors[(k-1)%colors.length]}}>● {label}</span>)}</div></>;
}
export function Ati6hEvidenceView({data,series}:{data:DeepDigData;series?:DeepDigSeries|null}){
 const [eventId,setEventId]=useState(''),[selectedIndex,setSelectedIndex]=useState<number|null>(null);
 const event=data.rows.find(row=>row.id===eventId)??data.rows.find(row=>row.ATI6H_details);
 if(!event)return <p className="text-xs text-muted-foreground">ATI-6H 尚无结构明细，请运行描述统计。</p>;
 const window=series?.ATI6H_windows?.[event.id],rows=window?.rows??(event.ATI6H_details?[event.ATI6H_details]:[]);
 const index=Math.min(selectedIndex??rows.length-1,rows.length-1),row=rows[index];if(!row)return null;
 const chartRows=rows.map(r=>({...r,ATI6H_close:window?.prices.find(p=>p.time===r.ATI6H_at)?.close}));
 const exportDetails=()=>{const blob=new Blob([JSON.stringify({ATI6H_definition:data.definition,ATI6H_event_id:event.id,ATI6H_rows:rows,ATI6H_archive:event.ATI6H_archive},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`ATI6H-${event.symbol}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <section data-testid="ati6h-evidence" className="space-y-3 rounded-xl border border-border/70 p-3">
  <div className="flex flex-wrap items-center gap-3 text-xs"><strong>ATI-6H · 市场证据</strong><select aria-label="ATI6H 样本" value={event.id} onChange={e=>{setEventId(e.target.value);setSelectedIndex(null);}} className="rounded border bg-background p-1">{data.rows.filter(r=>r.ATI6H_details).map(r=><option key={r.id} value={r.id}>{r.symbol} · {formatUTC8(r.anchorMs)}</option>)}</select><button type="button" className="ml-auto text-muted-foreground" onClick={exportDetails}>导出结构与参数 JSON</button></div>
  <EvidenceLineChart rows={chartRows} fields={['ATI6H',...ATI6H_COMPONENTS.map(k=>'ATI6H_s'+k)]} labels={['综合分',...ATI6H_COMPONENTS.map(k=>k+' '+ATI6H_LABELS[k])]}/>
  <EvidenceLineChart rows={chartRows} fields={['ATI6H_close','ATI6H_support_price','ATI6H_support_failure_price','ATI6H_breakout_price','ATI6H_nearest_resistance_price']} labels={['收盘价','固定支撑','失效边界','固定突破线','最近阻力']} price/>
  {rows.length>1&&<input aria-label="ATI6H 已收盘时点" type="range" min="0" max={rows.length-1} value={index} onChange={e=>setSelectedIndex(Number(e.target.value))} className="w-full accent-yellow-600"/>}
  <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs"><span>{formatUTC8(row.ATI6H_at)}</span><span>综合 <b>{row.ATI6H===null?'—':(100*row.ATI6H).toFixed(1)}</b> / 100</span><span>最弱项 {row.ATI6H_shortboard?`${row.ATI6H_shortboard} ${ATI6H_LABELS[row.ATI6H_shortboard]} · ${number(row.ATI6H_min)}`:'—（分量缺失）'}</span><span>{row.ATI6H_volume_mode==='taker'?'真实主动买卖成交额':'成交方向代理'}</span></div>
  <div className="grid grid-cols-2 gap-2 md:grid-cols-6">{ATI6H_COMPONENTS.map((k,i)=><div key={k} className={`rounded-md border p-2 text-[11px] ${row.ATI6H_shortboard===k?'border-yellow-600 bg-yellow-600/5':'border-border/60'}`}><span style={{color:colors[i]}}>{k} {ATI6H_LABELS[k]}</span><div className="mt-1 font-mono">{row['ATI6H_s'+k]===null?'缺失':number(row['ATI6H_s'+k])}</div></div>)}</div>
  <p className="text-[11px] text-muted-foreground">{row.ATI6H_reason_codes.map(code=>reasonLabels[code]??code).join('；')||'数据完整，结构有效'}</p>
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>支撑 {number(row.ATI6H_support_price,8)}</span><span>失效参考 {number(row.ATI6H_support_failure_price,8)}</span><span>突破线 {number(row.ATI6H_breakout_price,8)}</span><span>最近阻力 {number(row.ATI6H_nearest_resistance_price,8)}</span></div>
  <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">结构、回踩与突破事件</summary><ul className="mt-2 space-y-1">{rows.flatMap(r=>r.ATI6H_events).map((e,i)=><li key={i}>{formatUTC8(e.ATI6H_at)} · {eventLabels[e.ATI6H_type]??e.ATI6H_type}</li>)}</ul></details>
  <p className="text-[10px] text-muted-foreground">{row.ATI6H_version} · 新增市场证据 {row.ATI6H_parameters.WINDOW_HOURS}h · 证据半衰期 {row.ATI6H_parameters.HALF_LIFE_HOURS}h。MBI2 与单根对数收益波动尺度保留自身递推历史。几何平均具有零值否决和短板惩罚，非零短板可被部分补偿；本分数不是概率，不构成加仓指令。失效边界仅为结构参考价。</p>
 </section>;
}
