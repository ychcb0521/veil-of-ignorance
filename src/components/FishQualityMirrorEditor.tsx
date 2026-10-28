import type { QualityMirrorTakeProfit } from '@/lib/fish/qualityMirror';
export interface MirrorDraft { enabled: boolean; gainPct: string; sellPct: string }
export const mirrorDraft = (rule: QualityMirrorTakeProfit): MirrorDraft => ({enabled:rule.enabled,gainPct:String(rule.gainPct),sellPct:String(rule.sellPct)});
export function parseMirrorDraft(draft: MirrorDraft): QualityMirrorTakeProfit {
  const gain=draft.gainPct.trim()?Number(draft.gainPct):NaN,sell=draft.sellPct.trim()?Number(draft.sellPct):NaN;
  return {enabled:draft.enabled,gainPct:!draft.enabled && !(gain>0 && Number.isFinite(gain))?5:gain,sellPct:!draft.enabled && !(sell>0 && sell<=100)?50:sell};
}
const field='h-8 w-20 rounded-md border border-border/60 bg-background px-2 text-right font-mono text-xs tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40';
export function FishQualityMirrorEditor({draft,setDraft}:{draft:MirrorDraft;setDraft:(draft:MirrorDraft)=>void}) {
  return <section className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-3" data-testid="quality-mirror-editor">
    <div className="flex items-center justify-between gap-3"><div><h4 className="text-xs font-medium">镜像止盈策略</h4><p className="mt-1 text-[10.5px] text-muted-foreground">上涨时兑现一部分，余仓继续监测</p></div><label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><input type="checkbox" aria-label="启用镜像止盈策略" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"/>启用</label></div>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[11px]"><span className="text-muted-foreground">相对买入价上涨</span><input aria-label="镜像止盈涨幅" type="number" min="0" step="any" disabled={!draft.enabled} value={draft.gainPct} onChange={e=>setDraft({...draft,gainPct:e.target.value})} className={field}/><span>%</span><span className="ml-1 text-muted-foreground">卖出初始币数</span><input aria-label="镜像止盈卖出百分比" type="number" min="0" max="100" step="any" disabled={!draft.enabled} value={draft.sellPct} onChange={e=>setDraft({...draft,sellPct:e.target.value})} className={field}/><span>%</span></div>
    <p className="text-[10px] leading-relaxed text-muted-foreground">每笔持仓仅触发一次。按止盈限价模拟成交；跳空高开超过门槛时按开盘价成交。卖出比例按初始币数计算，剩余币数沿用原卖出算法、确认周期和否决条件，不重置买入价或阈值；设为 100% 则全部卖出。</p>
    <p className="text-[10px] leading-relaxed text-muted-foreground">同一分钟同时触及止损和止盈、先后不明时，保守按止损先成交。回撤仍衡量持仓期间的价格路径，总盈亏 = 镜像止盈已兑现盈亏 + 余仓盈亏；回报率 = 总盈亏 ÷ 开仓总金额。未触发时沿用原计算。应用后生效，历史结果保留。</p>
  </section>;
}
