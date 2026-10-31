import type {TradeCampaign} from '@/types/journal';
/** The denominator is frozen initial risk, never the later enlarged investment or realized drawdown. */
export function qualityCampaignStaticRisk(campaign?:TradeCampaign){
 if(!campaign?.comparison)return;
 const evidence=campaign.comparison.sellEvidence;
 const stops=(evidence?.holdingVetoes??[]).filter(v=>v.kind==='static-drawdown'&&(v.direction==='>='||v.direction==='>')&&Number.isFinite(v.threshold)&&v.threshold>0&&v.threshold<=100);
 const percent=evidence&&Object.prototype.hasOwnProperty.call(evidence,'initialStaticStopPct')?evidence.initialStaticStopPct:stops.length?Math.min(...stops.map(v=>v.threshold)):undefined;
 if(!(percent!>0&&percent!<=100&&Number.isFinite(percent)))return;
 const notional=campaign.comparison.holdingMetrics?.initialNotional??campaign.initial_main_size_usdt,entry=campaign.comparison.holdingMetrics?.entryPrice;
 if(!(notional>0)||!Number.isFinite(notional))return;
 return {percent,notional,loss:notional*percent/100,entry:entry!>0&&Number.isFinite(entry)?entry:undefined,stop:entry!>0&&Number.isFinite(entry)?entry!*(1-percent/100):undefined};
}
export const campaignLegDeltaLabel=(campaign?:Pick<TradeCampaign,'comparison'>)=>campaign?.comparison?'Δb':'ΔR';
