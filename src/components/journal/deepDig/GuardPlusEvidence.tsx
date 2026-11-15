import { useState } from 'react';
import { DBL5_GUARD_PLUS_LABEL, DBL5_GUARD_PLUS_PARAMS, type Dbl5GuardPlusRow, type GuardPlusEnd, type GuardPlusPhase } from '@/lib/dbl5GuardPlus';
import { dbl5StepPath } from '@/lib/dbl5mChart';
import type { DeepDigData } from '@/lib/deepDig/analysis';
import type { DeepDigSeries } from '@/lib/deepDig/series';
import { formatUTC8 } from '@/lib/timeFormat';

const phaseLabel: Record<GuardPlusPhase, string> = {
  NO_CONTEXT: '阶段起点未知', READY: '观察起动', WATCH: '待突破', EARLY: '首次急拉',
  ACTIVE: '等待下一次整理', OVEREXTENDED: '过伸', LATE: '早期窗口已结束', BROKEN: '当前段已破坏',
};
const endLabel: Record<GuardPlusEnd, string> = {
  IMPULSE_BROKEN: '收盘跌破急拉线', BASE_BROKEN: '原防守线确认破坏',
  IMPULSE_EXPIRED: '急拉参考到期', DATA_GAP: '数据缺口', DATA_INVALID: '行情或格点无效',
};
const sourceLabel = {BASE:'原防守线', IMPULSE:'急拉', BOTH:'两线同价', NONE:'无有效参考'};
const value = (price: number | null | undefined) => price == null ? '—' : Number(price.toPrecision(12));

export function GuardPlusEvidence({row}: {row?: Dbl5GuardPlusRow | null}) {
  const hit = row?.early_impulse_event ?? row?.active_impulse ?? row?.impulse_broken_event ?? row?.impulse_expired_event;
  const p = DBL5_GUARD_PLUS_PARAMS;
  const outcome = row?.ended_segment?.reason ?? row?.last_impulse_end?.reason;
  return <div className="space-y-1.5 text-[11px] leading-relaxed" data-testid="guard-plus-evidence">
    <p>急拉起点参考，尚不代表回踩验证。</p>
    {row && <>
      <p><strong>{DBL5_GUARD_PLUS_LABEL}</strong> · {phaseLabel[row.phase_state]} · {formatUTC8(row.at)}</p>
      <p>原防守线 {value(row.base_guard_value)} · 起点低点 {value(hit?.impulse_origin_low)} · 急拉参考 {value(row.impulse_guard_value)} · 组合 {value(row.guard_plus_value)}（{sourceLabel[row.guard_source]}）</p>
      {hit && <p>起点 {formatUTC8(hit.start_time)} · 检测 {formatUTC8(hit.detected_at)} · 证据年龄 {(row.at-hit.detected_at)/60_000} 分钟 · 到期 {formatUTC8(hit.expires_at)} · 相对成交量 {value(hit.relative_volume_at_detection)}</p>}
      {outcome && <p className="text-destructive">{endLabel[outcome]}{row.ended_segment
        ? ` · 断段价 ${row.ended_segment.price}`
        : row.last_impulse_end ? ` · ${formatUTC8(row.last_impulse_end.at)}` : ''}</p>}
      {row.wick_penetration && <p>影线穿越急拉参考，收盘仍守住。</p>}
    </>}
    <details>
      <summary className="cursor-pointer text-muted-foreground">公式与有效参数</summary>
      <p>仅用已收盘 5m。前置 ATR({p.atrPeriod}) 冻结，参考最近最多 {p.referenceBars-1} 个正向收盘增量（下跌计 0），权重半衰期 {p.halfLifeBars} 根。</p>
      <p>前置收盘至当前位移 ≥ {p.displacementAtr} ATR，每根推进 ≥ max({p.speedAtr} ATR, {p.speedMultiple} × 常态)，净实体 ÷ 总真实波幅 ≥ {p.efficiency}，保留涨幅 ≥ {p.retention}，收盘高过开盘、前收盘及起点前三根最高价。</p>
      <p>整理用连续 {p.pauseBars} 根的总范围 ≤ {p.pauseAtr} ATR；最多观察 {p.windowBars} 根，候选或阶段超过 {p.maxExtensionAtr} ATR 拦截。急拉参考＝窗口最低价 − {p.bufferAtr} × 前置 ATR，向下取整到报价格点。一次收盘严格跌破即失效，从起点满 {p.expiryMinutes} 分钟到期。相对成交量只提供辅助读数。</p>
      {hit && <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(hit,null,2)}</pre>}
    </details>
  </div>;
}

function Overlay({rows, nativeSegments, prices}:{
  rows: readonly Dbl5GuardPlusRow[];
  nativeSegments: ReadonlyMap<number, number | undefined>;
  prices: readonly {time:number;close:number}[];
}) {
  const range = [...rows.flatMap(row=>[row.base_guard_value,row.guard_plus_value,row.early_impulse_event?.impulse_origin_low,row.ended_segment?.price]),...prices.map(bar=>bar.close)]
    .filter((price):price is number=>price!=null&&Number.isFinite(price));
  if(!range.length)return null;
  const min=Math.min(...range),max=Math.max(...range),first=rows[0].at,last=rows.at(-1)!.at;
  const x=(at:number)=>14+(at-first)/Math.max(last-first,1)*772;
  const y=(price:number)=>180-(price-min)/Math.max(max-min,Number.EPSILON)*156;
  const path=(pick:(row:Dbl5GuardPlusRow)=>number|null,segment:(row:Dbl5GuardPlusRow)=>string|number|null)=>
    dbl5StepPath(rows.map(row=>({x:x(row.at),y:pick(row)===null?null:y(pick(row)!),episode:segment(row)})));
  return <svg viewBox="0 0 800 200" role="img" aria-label="原防守线与急拉组合线对照" className="w-full rounded bg-muted/20">
    <path d={dbl5StepPath(prices.map(bar=>({x:x(bar.time),y:y(bar.close),episode:1})))} stroke="#8994a5" fill="none" opacity=".5"/>
    <path data-guard-plus-line="base" d={path(row=>row.base_guard_value,row=>nativeSegments.get(row.at)??null)} stroke="#229173" strokeWidth="2" fill="none"/>
    <path data-guard-plus-line="plus" d={path(row=>row.guard_plus_value,row=>row.segment_id)} stroke="#b38126" strokeWidth="2.5" strokeDasharray="5 3" fill="none"/>
    {rows.map(row=>{
      const hit=row.early_impulse_event;
      return <g key={row.at}>
        {hit && <g>
          <path d={`M${x(Math.max(first,hit.start_time+300000))},${y(hit.impulse_origin_low)} H${x(row.at)}`} stroke="#b38126" strokeDasharray="2 4"/>
          <circle cx={x(row.at)} cy={y(hit.impulse_origin_low)} r="4" fill="#b38126"><title>首次急拉 {formatUTC8(row.at)}，回指起点 {formatUTC8(hit.start_time)}</title></circle>
        </g>}
        {row.phase_changed&&<circle cx={x(row.at)} cy={192} r="2.5" fill="#7e79d6"><title>阶段切换 {formatUTC8(row.at)}</title></circle>}
        {(row.ended_segment||row.impulse_expired_event||row.base_guard_broken_event)&&
          <circle cx={x(row.at)} cy={row.ended_segment?y(row.ended_segment.price):12} r="4" fill={row.impulse_expired_event?'#8591a5':'#c65252'}>
            <title>{row.ended_segment?endLabel[row.ended_segment.reason]:row.impulse_expired_event?'急拉参考到期':'原防守线确认破坏'} · {formatUTC8(row.at)}</title>
          </circle>}
      </g>;
    })}
  </svg>;
}

type EventFilter = 'all' | 'early' | 'broken' | 'expired' | 'overextended' | 'phase';
const eventMatches = (row: Dbl5GuardPlusRow, filter: EventFilter) => {
  if(filter==='early')return !!row.early_impulse_event;
  if(filter==='broken')return !!row.impulse_broken_event||row.base_guard_broken_event;
  if(filter==='expired')return !!row.impulse_expired_event;
  if(filter==='overextended')return row.phase_state==='OVEREXTENDED';
  return filter==='all'||row.phase_changed;
};

export function GuardPlusReplay({data,series}: {data: DeepDigData;series?: DeepDigSeries|null}) {
  const [sample,setSample]=useState('');
  const [index,setIndex]=useState<number|null>(null);
  const [filter,setFilter]=useState<EventFilter>('all');
  const available=data.rows.filter(row=>row.DBL5P_details||series?.DBL5_windows?.[row.id]?.guardPlusRows?.length);
  const event=available.find(row=>row.id===sample)??available[0];
  const window=event&&series?.DBL5_windows?.[event.id];
  const rows=window?.guardPlusRows??(event?.DBL5P_details?[event.DBL5P_details]:[]);
  if(!event||!rows.length)return null;
  const selected=Math.min(index??rows.length-1,rows.length-1);
  const visible=rows.slice(0,selected+1);
  const positions=rows.flatMap((row,i)=>eventMatches(row,filter)?[{row,i}]:[]);
  function download(){
    const payload={definition:data.definition,symbol:event.symbol,rows,nativeRows:window?.rows,prices:window?.prices,checkpoint:window?.guardPlusCheckpoint??event.DBL5P_checkpoint};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`DBL5-1115-${event.symbol}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className="space-y-3 rounded-xl border p-3" data-testid="guard-plus-replay">
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <strong>{DBL5_GUARD_PLUS_LABEL}</strong>
      <select aria-label="急拉对照样本" value={event.id} onChange={e=>{setSample(e.target.value);setIndex(null);}} className="max-w-full rounded border bg-background p-1">
        {available.map(row=><option key={row.id} value={row.id}>{row.symbol} · {formatUTC8(row.anchorMs)}</option>)}
      </select>
      <button type="button" onClick={download} className="ml-auto text-muted-foreground">导出对照与检查点</button>
    </div>
    <Overlay rows={visible} nativeSegments={new Map(window?.rows.map(r=>[r.at,r.darvas_5m_guard_segment]))}
      prices={window?.prices.filter(bar=>bar.time>=visible[0].at&&bar.time<=visible.at(-1)!.at)??[]}/>
    <p className="text-[11px] text-muted-foreground">绿线 原防守线 · 金色虚线 组合参考 · 金点 首次检测 · 紫点 阶段切换 · 红点 破坏 · 灰点 到期</p>
    {rows.length>1&&<input aria-label="急拉回放时点" type="range" min={0} max={rows.length-1} value={selected} onChange={e=>setIndex(e.target.valueAsNumber)} className="w-full"/>}
    <div className="flex flex-wrap gap-2 text-xs">
      <select aria-label="急拉事件类别" value={filter} onChange={e=>setFilter(e.target.value as EventFilter)} className="rounded border bg-background p-1">
        <option value="all">全部时点</option><option value="early">首次急拉</option><option value="broken">破坏</option>
        <option value="expired">到期</option><option value="overextended">过伸</option><option value="phase">阶段切换</option>
      </select>
      <select aria-label="定位急拉事件" value={positions.some(point=>point.i===selected)?selected:''} onChange={e=>setIndex(Number(e.target.value))} className="rounded border bg-background p-1">
        <option value="" disabled>{positions.length?'定位至事件':'本样本无此类事件'}</option>
        {positions.map(({row,i})=><option key={row.at} value={i}>{formatUTC8(row.at)} · {phaseLabel[row.phase_state]}</option>)}
      </select>
    </div>
    <GuardPlusEvidence row={rows[selected]}/>
  </section>;
}
