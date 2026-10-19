import { useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]">
      <div className="flex items-center gap-1">
        <strong className="text-xs">渔</strong>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="捕捞说明" className="rounded p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <CircleHelp className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-3 text-[11px] leading-relaxed" aria-label="捕捞说明">
            <p className="font-medium text-foreground">捕捞说明</p>
            <p className="text-muted-foreground">时间按 UTC+8 输入，留空使用币安当前时间；历史时间向下取整至5分钟，仅使用此前2000根已收盘5m K线。历史扫描的标的范围仍以当前正在交易的 USDT 永续合约为准。</p>
            <p className="text-muted-foreground">沿用内置 CBI-2，avg(CBI2, 24h) 严格大于所设阈值才命中。第1455根起读数可用；只记录本轮上穿起点，起点不明不入库。BTC 同区间必须完整。</p>
            <p className="text-muted-foreground">扫描开始后锁定时间和阈值，截止之后的数据不参与计算。结果累计保存在下方「鱼」，可手动加入信号库。</p>
            {x?.anchorMs && <p className="font-mono text-muted-foreground">本轮节点：{formatUTC8(x.anchorMs)}</p>}
            {x?.cutoffMs && <p className="font-mono text-muted-foreground">本轮阈值 &gt; {x.threshold ?? 0.3}</p>}
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={running} onClick={start}>开始捕捞</button>
        <button type="button" className={btn} disabled={!running} onClick={p.onCancel}>取消</button>
      </div>
      <label className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>时间（UTC+8）</span>
        <input className="w-48 rounded border border-border/60 bg-transparent px-2 py-1 font-mono text-foreground" aria-label="捕捞时间（UTC+8）" placeholder="YYYY-MM-DD HH:mm:ss" value={p.inputs.time} disabled={running} onChange={e => { setError(''); p.onInputsChange({ ...p.inputs, time: e.target.value }); }} />
      </label>
      <label className="flex items-center gap-2 text-muted-foreground">
        <span>阈值 &gt;</span>
        <input className="w-20 rounded border border-border/60 bg-transparent px-2 py-1 font-mono text-foreground" aria-label="捕捞阈值" type="number" min="-1" max="1" step="0.01" value={p.inputs.threshold} disabled={running} onChange={e => { setError(''); p.onInputsChange({ ...p.inputs, threshold: e.target.value }); }} />
      </label>
    </div>
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
    {x && <div className="space-y-1 text-[11px]" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p>{x.status === 'running' ? '捕捞中' : x.status === 'complete' ? '捕捞完成' : x.status === 'cancelled' ? '已取消' : '已中止'} · {x.done} / {x.total}{x.current ? ` · ${x.current}` : ''}</p>
        {x.cutoffMs && <p className="font-mono text-muted-foreground">截止（UTC+8） {formatUTC8(x.cutoffMs)}</p>}
      </div>
      <p className="flex flex-wrap gap-x-3 text-muted-foreground"><span>命中 {x.counts.hit}</span><span>未达标 {x.counts.below}</span><span>起点不明 {x.counts.unknown}</span><span>缺口 / 不足2000根 {x.counts.gap}</span><span>读数不全 {x.counts.readings}</span><span>请求失败 {x.counts.failed}</span></p>
      {x.error && <p className="text-destructive">{x.error}</p>}
    </div>}
    <FishLibrary signals={p.signals} tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} onAdd={p.onAdd} />
  </section>;
}
