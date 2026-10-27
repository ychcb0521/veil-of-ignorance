/** A live, read-only collection of existing and future resonant detector events. */
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import { fishMetricLabel } from './records';
import { qualityMembers, type FishQualityStudy } from './quality';
import type { FishSnapshot } from './algorithm';

export const FOCUS_DETECTORS = ['avg_CBI2_2', 'avg_CBA_2'] as const;
/** User's screenshot, April 2026, UTC+8. References only; never invent monitoring returns. */
export const FOCUS_SIGNAL_SEEDS = [
 ['MMT','04-05 20:40'], ['GALA','04-08 06:50'], ['FIL','04-06 18:00'],
 ['DASH','04-10 04:40'], ['ALGO','04-14 08:45'], ['BASED','04-15 09:45'],
 ['ORDI','04-15 18:35'], ['RUNE','04-21 18:55'], ['GALA','04-25 05:15'],
 ['AXS','04-25 11:05'], ['W','04-25 03:55'], ['WCT','04-26 11:05'],
].map(([symbol,time])=>({id:`focus-seed-${symbol}-${time}`,symbol:`${symbol}USDT`,timeMs:Date.parse(`2026-${time.replace(' ','T')}:00+08:00`),timeLabel:`2026-${time}`,fallbackZone:'',exchange:'binance' as const}));
export const focusSignalKey = (source: Pick<TradeSignal,'symbol'|'timeMs'|'exchange'|'market'|'underlying'>) => JSON.stringify([
 source.exchange ?? 'binance',source.market ?? 'crypto',source.underlying ?? '',source.symbol.toUpperCase().replace(/\//g,''),source.timeMs,
]);
export interface QualityFocusSignal {
 key:string; source:TradeSignal; specified:boolean; resonance:boolean; found:boolean;
 detectors:string[]; recordIds:string[];
}
/** Resolve the selected saved series, never a display label or a formula merely containing avg₂. */
export function focusDetector(snapshot: FishSnapshot): typeof FOCUS_DETECTORS[number] | undefined {
 const name=fishMetricLabel(snapshot);
 if(name==='avg_CBI2_2'&&(!snapshot.featureId||snapshot.featureId==='cbi2'))return name;
 if(name==='avg_CBA_2'&&(!snapshot.featureId||snapshot.featureId==='cba'))return name;
}
export function qualityFocusSignals(study:FishQualityStudy):QualityFocusSignal[] {
 const events=new Map<string,QualityFocusSignal>(), settings=new Map(study.monitorLibrary?.settings.map(s=>[s.id,s]) ?? []);
 const groups=new Map(study.groups.map(g=>[g.id,g]));
 const ensure=(source:TradeSignal,found=true)=>{
  const key=focusSignalKey(source);let event=events.get(key);
  if(!event){event={key,source,specified:false,resonance:false,found,detectors:[],recordIds:[]};events.set(key,event);}
  else if(found){event.found=true;event.source=source;}
  return event;
 };
 const names=new WeakMap<FishSnapshot,ReturnType<typeof focusDetector>>();
 const evidence=(event:QualityFocusSignal,snapshots:readonly FishSnapshot[])=>{
  for(const snapshot of snapshots){if(!names.has(snapshot))names.set(snapshot,focusDetector(snapshot));const name=names.get(snapshot);if(name&&!event.detectors.includes(name))event.detectors.push(name);}
  event.resonance=FOCUS_DETECTORS.every(name=>event.detectors.includes(name));
 };
 for(const seed of FOCUS_SIGNAL_SEEDS)ensure(seed,false).specified=true;
 for(const sample of study.samples){
  const event=ensure(sample.source);
  if(sample.origin==='library')continue;
  evidence(event,[...sample.groups.flatMap(id=>groups.has(id)?[groups.get(id)!.snapshot]:[]),...qualityMembers(sample.source)]);
 }
 for(const run of study.campaignRuns ?? []){
  const event=ensure(run.sample.source);
  if(run.sample.origin!=='library')evidence(event,run.detectors.map(g=>g.snapshot));
 }
 for(const record of study.monitorLibrary?.records ?? []){
  const setting=settings.get(record.settingId);if(!setting)continue;
  const event=ensure(record.source);event.recordIds.push(record.id);
  if(setting.detectorsKnown)evidence(event,setting.detectors.map(g=>g.snapshot));
 }
 return [...events.values()].filter(event=>event.specified||event.resonance).sort((a,b)=>b.source.timeMs-a.source.timeMs||a.source.symbol.localeCompare(b.source.symbol));
}
export const focusSignalLabel=(event:QualityFocusSignal)=>`${event.source.symbol} · ${formatUTC8(event.source.timeMs).slice(0,16)}`;
