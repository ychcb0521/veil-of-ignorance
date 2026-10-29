import { mbi2EvaluationCsv, type Mbi2Evaluation, type Mbi2ScanRow } from '@/lib/deepDig/mbi2Evaluation';
const num=(v:number|null,d=2)=>v==null||!Number.isFinite(v)?'—':v.toFixed(d);
const pct=(v:number|null)=>v==null?'—':(100*v).toFixed(2)+'%';
function download(report:Mbi2Evaluation){const url=URL.createObjectURL(new Blob([mbi2EvaluationCsv(report)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='MBI2-parameter-scan.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function Table({rows}:{rows:Mbi2ScanRow[]}){return <div className="max-h-[60vh] max-w-full overflow-auto rounded border border-border/60"><table className="whitespace-nowrap text-left text-[11px]" data-testid="mbi2-scan-table"><thead className="sticky top-0 bg-card"><tr>{['T小时','缓冲带','n根','强趋势n','试探及以上','确认','本轮小时中位数','确认小时中位数','对照n','对照试探及以上','对照确认','每千根试探开始','每千根进入确认','平衡准确率·5折','样本外AUC','缺失'].map(h=><th className="px-2 py-2 font-medium" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i} className="border-t border-border/40">{[num(r.hours,4),num(r.band,1),r.n,r.positiveN,pct(r.positiveProbe),pct(r.positiveConfirm),num(r.leadMedian),num(r.confirmMedian),r.controlN,pct(r.controlProbe),pct(r.controlConfirm),num(r.probePer1000),num(r.confirmPer1000),pct(r.balancedAccuracy),num(r.auc,4),r.missing].map((v,j)=><td className="px-2 py-1.5 font-mono" title={j===13?r.accuracyReason:undefined} key={j}>{v}</td>)}</tr>)}</tbody></table></div>;}
export function Mbi2EvaluationView({report}:{report:Mbi2Evaluation}){return <section className="min-w-0 space-y-3" data-testid="mbi2-evaluation">
 <div className="flex items-center justify-between"><h3 className="font-medium">MBI2 调参扫描与 n 推荐</h3><button className="rounded border px-2 py-1" onClick={()=>download(report)}>下载 MBI2 扫描 CSV</button></div>
 <p className="text-[11px] text-muted-foreground">本次运行的完整样本 · 固定入场锚点 · 只用锚点及以前的已收盘线。分组或样本修改后需重跑；结果不自动修改参数。</p>
 <p className="text-[11px] text-muted-foreground">强趋势：{report.positiveRule}；空白对照：{report.controlRule}。{report.accuracyMethod}</p>
 <h4 className="text-xs">周期扫描 · 缓冲带0.2</h4><Table rows={report.scan.filter(r=>r.kind==='hours')}/>
 <h4 className="text-xs">缓冲带扫描 · 默认 n=25 对应的日历时长</h4><Table rows={report.scan.filter(r=>r.kind==='band')}/>
 <div className="rounded border border-border/60 p-3 text-xs" data-testid="mbi2-recommendation"><p>T_min：25%分位 {num(report.q25)}h · 50%分位 {num(report.q50)}h · 75%分位 {num(report.q75)}h</p>
 <p className="mt-1 text-muted-foreground">MBI2_T_HOURS 取75%分位数时，可覆盖约75%的强趋势。δ≤0排除 {report.excludedDelta} 场；缺数据 {report.missingCampaigns} 场；有效 {report.recommendations.filter(r=>r.hours!=null).length} 场。</p>
 <p className="mt-1 text-muted-foreground">n 推荐仅使用已结束强趋势战役自身起止段作事后估算，不将该段未来价格输入锚点指标或扫描。</p></div>
 </section>;}
