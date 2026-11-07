import {useCallback,useState,type ReactNode,type RefObject} from 'react';
import type {TradeCampaign} from '@/types/journal';
import {QualityMirrorBoard} from './QualityMirrorBoard';
import type {KlineData} from '@/hooks/useBinanceData';

/** Reserve compact notes inside the viewport budget; expanded details add page height. */
export function QualityCampaignChartFrame({campaign,chartHeight,fitHeight,chartRef,onSummaryHeight,children,klines,intervalMs}:{campaign:TradeCampaign;chartHeight:number;fitHeight?:number;chartRef?:RefObject<HTMLDivElement|null>;onSummaryHeight?:(height:number)=>void;children:ReactNode;klines?:readonly KlineData[];intervalMs?:number}){
 const [summaryHeight,setSummaryHeight]=useState(0),[compactHeight,setCompactHeight]=useState(0);
 const surfaceHeight=fitHeight==null?chartHeight:Math.max(chartHeight,fitHeight-compactHeight);
 const measure=useCallback((height:number)=>{setSummaryHeight(height);onSummaryHeight?.(height);},[onSummaryHeight]);
 return <div ref={chartRef} data-testid="campaign-chart-frame" className="flex flex-col overflow-hidden rounded border border-border" style={{height:surfaceHeight+summaryHeight}}>
  <QualityMirrorBoard campaign={campaign} onHeightChange={measure} onCompactHeightChange={setCompactHeight} klines={klines} intervalMs={intervalMs}/>
  <div data-testid="campaign-candle-surface" className="min-h-0 shrink-0" style={{height:Math.max(0,surfaceHeight-2)}}>{children}</div>
 </div>;
}
