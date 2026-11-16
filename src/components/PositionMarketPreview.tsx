import {useState} from 'react';
import {X} from 'lucide-react';
import {intervalToMs} from '@/hooks/useBinanceData';
import {useReplayKlines} from '@/hooks/useReplayKlines';
import type {InstantPositionFill} from '@/lib/fish/instantCampaign';
import {EXCHANGE_NAMES} from '@/lib/fish/exchanges';
import {ReplayKlineChart} from '@/components/journal/ReplayKlineChart';
import {RESEARCH_INTERVALS, type ResearchInterval} from '@/lib/deepRsa/marketData';

export interface PositionChartPreview {
  symbol:string;
  at:number;
  source?:InstantPositionFill['source'];
}

export function PositionMarketPreview({preview,initialInterval,onClose}:{
  preview:PositionChartPreview;initialInterval:string;onClose:()=>void;
}) {
  const [interval,setInterval]=useState<ResearchInterval>(()=>RESEARCH_INTERVALS.find(value=>value===initialInterval)??'5m');
  const step=intervalToMs(interval);
  const through=Math.floor(preview.at/step)*step;
  const {source}=preview;
  const nativeBinance=(!source?.exchange||source.exchange==='binance')&&source?.market!=='us_stock';
  // Binance's endTime is inclusive. The external-market adapter takes a closing boundary.
  const end=nativeBinance?through-1:through;
  const {klines,loading,error,reload}=useReplayKlines(preview.symbol,through-144*step,end,interval,source);
  return <div className="flex h-full min-h-0 flex-col bg-background">
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1">
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-xs font-medium">{preview.symbol} · {preview.source?.exchange?EXCHANGE_NAMES[preview.source.exchange]:'币安'} · 行情预览</span>
        <select aria-label="行情周期" value={interval} onChange={event=>setInterval(event.target.value as ResearchInterval)}
          className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs">
          {RESEARCH_INTERVALS.map(value=><option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <button type="button" aria-label="关闭行情预览" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted" onClick={onClose}>
        <X aria-hidden="true" className="h-4 w-4"/>
      </button>
    </div>
    <div className="min-h-0 flex-1">
      {loading||error||klines.length===0?<div role="status" className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        {loading?'正在加载行情…':error?'行情加载失败':'暂无行情'}
        {error&&<button type="button" className="text-primary hover:underline" onClick={reload}>重试</button>}
      </div>:<ReplayKlineChart klines={klines} currentTime={through} intervalMs={step} symbol={preview.symbol}
        marketSource={preview.source} fitAll/>}
    </div>
  </div>;
}
