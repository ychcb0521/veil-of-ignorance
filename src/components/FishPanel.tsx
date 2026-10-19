import { useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import { parseFishSettings, type FishScanSettings, type FishProgress } from '@/lib/fishScanner';
import { formatUTC8 } from '@/lib/timeFormat';
import { FishLibrary } from '@/components/FishLibrary';

export interface FishPanelProps {
  signals: TradeSignal[]; progress: FishProgress | null;
  inputs: { time: string; threshold: string }; onInputsChange: (value: { time: string; threshold: string }) => void;
  onStart: (settings: FishScanSettings) => void; onCancel: () => void; onAdd: (id?: string) => void;
  onJump: (id: string) => void; onDelete: (id: string) => void; onRate: (id: string, value: number) => void;
  jumpingSignalId: string | null; tradedDayIndex: Set<string>; campaignDayIndex: Set<string>;
}
export function FishPanel(p: FishPanelProps) {
  const [error, setError] = useState('');
  const start = () => {
    try { const settings = parseFishSettings(p.inputs.time, p.inputs.threshold); setError(''); p.onStart(settings); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const running = p.progress?.status === 'running';
  const btn = 'rounded border border-border/60 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40';
  const x = p.progress;
  return <section className="mt-2 space-y-2 rounded border border-border/60 bg-background p-3" aria-label="渔" data-testid="fish-panel">
    <div className="flex flex-wrap items-center gap-2">
      <strong className="text-xs">渔</strong>
      <button type="button" className={btn} disabled={running} onClick={start}>开始捕捞</button>
      <button type="button" className={btn} disabled={!running} onClick={p.onCancel}>取消</button>
    </div>
    <div className="flex flex-wrap items-end gap-3 text-[11px]">
      <label className="space-y-1"><span className="block text-muted-foreground">捕捞时间（UTC+8）</span>
        <input className="w-60 rounded border border-border/60 bg-transparent px-2 py-1.5 font-mono" aria-label="捕捞时间（UTC+8）" placeholder="YYYY-MM-DD HH:mm:ss" value={p.inputs.time} disabled={running} onChange={e => { setError(''); p.onInputsChange({ ...p.inputs, time: e.target.value }); }} />
      </label>
      <label className="space-y-1"><span className="block text-muted-foreground">捕捞阈值 · 严格大于</span>
        <input className="w-24 rounded border border-border/60 bg-transparent px-2 py-1.5 font-mono" aria-label="捕捞阈值" type="number" min="-1" max="1" step="0.01" value={p.inputs.threshold} disabled={running} onChange={e => { setError(''); p.onInputsChange({ ...p.inputs, threshold: e.target.value }); }} />
      </label>
      <span className="pb-1 text-muted-foreground">历史时间只取此前已收盘数据；留空使用币安当前时间。</span>
    </div>
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
    <p className="text-[11px] leading-relaxed text-muted-foreground">币安 USDT 永续 · 已收盘 5m 2000 根 · 内置 CBI-2 · avg(CBI2, 24h) 严格大于所设阈值。第1455根起读数可用；只记录本轮上穿起点，起点不明不入库。BTC 同区间必须完整。</p>
    <p className="font-mono text-[11px] text-muted-foreground">截止（UTC+8）：{x?.cutoffMs ? formatUTC8(x.cutoffMs) : '开始扫描时锁定本轮时间'}{x?.cutoffMs ? ` · 本轮阈值 > ${x.threshold ?? 0.3}` : ''}</p>
    {x?.anchorMs && <p className="font-mono text-[11px] text-muted-foreground">本轮时间节点（UTC+8）：{formatUTC8(x.anchorMs)} · 截止时刻之后的数据不参与计算</p>}
    {x && <div className="space-y-1 text-[11px]" role="status" aria-live="polite">
      <p>{x.status === 'running' ? '捕捞中' : x.status === 'complete' ? '捕捞完成' : x.status === 'cancelled' ? '已取消' : '已中止'} · {x.done} / {x.total}{x.current ? ` · ${x.current}` : ''}</p>
      <p className="flex flex-wrap gap-x-3 text-muted-foreground"><span>命中 {x.counts.hit}</span><span>未达标 {x.counts.below}</span><span>起点不明 {x.counts.unknown}</span><span>缺口 / 不足2000根 {x.counts.gap}</span><span>读数不全 {x.counts.readings}</span><span>请求失败 {x.counts.failed}</span></p>
      {x.error && <p className="text-destructive">{x.error}</p>}
    </div>}
    <FishLibrary signals={p.signals} tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} onAdd={p.onAdd} />
  </section>;
}
