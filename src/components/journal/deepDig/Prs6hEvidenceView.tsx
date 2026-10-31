import {useState} from 'react';
import type {DeepDigData} from '@/lib/deepDig/analysis';
import type {DeepDigSeries} from '@/lib/deepDig/series';
import {PRS6H_COMPONENTS,type PrsRow} from '@/lib/prs6h';
import {formatUTC8} from '@/lib/timeFormat';
import {EvidenceLineChart} from './Ati6hEvidenceView';
const LABELS={T:'趋势及增强',S:'固定支撑有效',D:'向下推进弱',B:'买方价格确认',V:'成交辅助证据'};
const GATES:Record<string,string>={trend:'上升趋势',higher:'更高防守结构',tested:'冻结后独立测试',valid:'结构未失效',time_valid:'候选与测试未过期',breakout:'两根突破确认',spike:'无明显下针或冲击',space:'无近距离已识别障碍',distance:'失效距离合适',core:'核心分项下限'};
const STATES:Record<string,string>={SEARCHING:'搜索平台',FROZEN:'平台已冻结、尚未测试',TESTING:'支撑测试中',VERIFIED:'支撑测试完成',BASELINE_ONLY:'仅建立初始基准',MARKET_READY:'市场证据就绪',INVALID:'结构永久失效',TEST_FAILED:'测试未及时恢复',CANDIDATE_EXPIRED:'候选等待过期',TEST_EXPIRED:'测试有效期过期',REFERENCE_EXPIRED:'前一参考过期',DATA_UNAVAILABLE:'数据不足或不可计算'};
const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Number(v.toPrecision(8)).toString():'—';
export function Prs6hEvidenceView({data,series}:{data:DeepDigData;series?:DeepDigSeries|null}){
 const [sample,setSample]=useState(''),[at,setAt]=useState<number|null>(null),event=data.rows.find(r=>r.id===sample)??data.rows.find(r=>r.PRS6H_details);
 if(!event)return <p className="text-xs text-muted-foreground">PRS-6H 尚无解释结果，请运行描述统计。</p>;
 const window=series?.PRS6H_windows?.[event.id],rows=window?.rows??(event.PRS6H_details?[event.PRS6H_details]:[]),index=Math.min(at??rows.length-1,rows.length-1),row=rows[index];if(!row)return null;
 const s=row.PRS6H_structure,chart=rows.map(r=>({PRS6H:r.PRS6H,PRS6H_raw:r.PRS6H_evidence_raw,close:window?.prices.find(p=>p.time===r.PRS6H_at)?.close,support:r.PRS6H_structure?.support,invalidation:r.PRS6H_structure?.invalidation,upper:r.PRS6H_structure?.upper,ATI6H_structure_id:r.PRS6H_structure?.structure_id,ATI6H_events:r.PRS6H_events.map(e=>({ATI6H_type:e.type,ATI6H_at:e.at,ATI6H_structure_id:e.structure_id}))}));
 const download=()=>{const content={feature:data.definition,PRS6H_rows:rows,PRS6H_checkpoint:window?.checkpoint??event.PRS6H_checkpoint,PRS6H_evaluation:data.PRS6H_evaluation};const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='PRS-6H-'+event.symbol+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <section data-testid="prs6h-evidence" className="space-y-3 rounded-xl border border-border/60 p-3">
  <div className="flex flex-wrap items-center gap-3 text-xs"><strong>PRS-6H · 日内顺势加仓证据</strong><select aria-label="PRS6H 样本" value={event.id} onChange={e=>{setSample(e.target.value);setAt(null);}} className="rounded border bg-background p-1">{data.rows.filter(r=>r.PRS6H_details).map(r=><option key={r.id} value={r.id}>{r.symbol} · {formatUTC8(r.anchorMs)}</option>)}</select><button type="button" onClick={download} className="ml-auto text-muted-foreground">导出状态、结构与检查点</button></div>
  <EvidenceLineChart rows={chart} fields={['PRS6H','PRS6H_raw']} labels={['最终证据分','原始几何证据']} max={100} title="PRS-6H 最终分与原始证据"/>
  <EvidenceLineChart rows={chart} fields={['close','support','upper','invalidation']} labels={['收盘价','固定支撑','固定平台上沿','固定失效参考']} price title="PRS-6H 因果固定平台与测试事件"/>
  {rows.length>1&&<input aria-label="PRS6H 已收盘时点" type="range" min="0" max={rows.length-1} value={index} onChange={e=>setAt(Number(e.target.value))} className="w-full accent-yellow-600"/>}
  <p className="flex flex-wrap gap-x-4 text-xs"><span>{formatUTC8(row.PRS6H_at)}</span><strong>证据分 {n(row.PRS6H)} / 100</strong><span>原始证据 {n(row.PRS6H_evidence_raw)}</span><span>{STATES[row.PRS6H_state]}</span><span>{row.PRS6H_market_ready?'市场条件已就绪':'市场条件未就绪'}</span></p>
  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">{PRS6H_COMPONENTS.map(k=><div key={k} className="rounded border border-border/50 p-2 text-[11px]"><span>{k} · {LABELS[k]}</span><div className="mt-1 font-mono">{n(row[('PRS6H_'+k) as keyof PrsRow])}</div></div>)}</div>
  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">{Object.entries(row.PRS6H_gates).map(([key,value])=><span key={key} className={value===true?'text-emerald-600':value===false?'text-muted-foreground':'text-amber-600'}>{value===true?'✓':value===false?'×':'?'} {GATES[key]??key}{value===null?'（未知）':''}</span>)}</div>
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>支撑 {n(s?.support)}</span><span>平台上沿 {n(s?.upper)}</span><span>失效参考 K {n(s?.invalidation)}</span><span>测试 {s?.test_completed_at?formatUTC8(s.test_completed_at):'尚未测试'}</span><span>突破确认 {s?.breakout_confirmed_at?formatUTC8(s.breakout_confirmed_at):'—'}</span><span>插针 / 冲击 {n(row.PRS6H_debug.max_wick)} / {n(row.PRS6H_debug.max_shock)}</span><span>观察剩余 {n(Number(row.PRS6H_debug.spike_wait_ms)/60000)} 分钟</span></div>
  <p className="text-[11px] text-muted-foreground">{row.PRS6H_data_complete?'必需数据完整':'必需数据不完整或无法计算'} · {row.PRS6H_volume_mode==='quote'?'报价币成交额加权下推弱度':row.PRS6H_volume_mode==='flow'?'真实主动成交方向模式':'基础币量×收盘价近似成交额'} · {row.PRS6H_reasons.join('；')||'所有市场门控通过'}</p>
  <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">冻结、测试、失效与市场事件</summary><ul className="mt-2 space-y-1">{rows.flatMap(r=>r.PRS6H_events).map((e,i)=><li key={i}>{formatUTC8(e.at)} · {STATES[e.type]??e.type} · {e.structure_id}</li>)}</ul></details>
  <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">参数、版本及研究诊断</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify({version:row.PRS6H_version,config_hash:row.PRS6H_config_hash,source:row.PRS6H_source,data_version:row.PRS6H_data_version,parameters:row.PRS6H_parameters,debug:row.PRS6H_debug,evaluation:data.PRS6H_evaluation},null,2)}</pre></details>
  <p className="text-[10px] text-muted-foreground">默认参数均为研究初值。0 表示本指标证据不满足，不是看空或多空均衡；分数不是胜率。市场就绪仍需通过已有持仓权限、风险预算与执行检查，未知时不允许加仓；K 不直接改写账户止损。未来收益只用于事后评估。</p>
 </section>;
}
