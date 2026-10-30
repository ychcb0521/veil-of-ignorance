import {useCallback,useState,type ReactNode,type RefObject} from 'react';
import type {TradeCampaign} from '@/types/journal';
import {QualityMirrorBoard} from './QualityMirrorBoard';

/** Notes add page height; the candle surface always keeps its own full height. */
export function QualityCampaignChartFrame({campaign,chartHeight,chartRef,onSummaryHeight,children}:{campaign:TradeCampaign;chartHeight:number;chartRef?:RefObject<HTMLDivElement|null>;onSummaryHeight?:(height:number)=>void;children:ReactNode}){
 const [summaryHeight,setSummaryHeight]=useState(0);
 const measure=useCallback((height:number)=>{setSummaryHeight(height);onSummaryHeight?.(height);},[onSummaryHeight]);
 return <div ref={chartRef} data-testid="campaign-chart-frame" className="flex flex-col overflow-hidden rounded border border-border" style={{height:chartHeight+summaryHeight}}>
  <QualityMirrorBoard campaign={campaign} onHeightChange={measure}/>
  <div data-testid="campaign-candle-surface" className="min-h-0 shrink-0" style={{height:Math.max(0,chartHeight-2)}}>{children}</div>
 </div>;
}
