import { expect, it } from 'vitest';
import { qualityDetectorReading } from '@/lib/fish/qualityDetectorReading';
import { importQualityFish, newQualityStudy, qualityDisplayRows, type QualitySample } from '@/lib/fish/quality';
import { definitionKey, BSS_DEF } from '@/lib/deepDig/features';
import { buildQualitySheets } from '@/lib/fish/qualityExport';
const T=Date.UTC(2026,9,29),snapshot={featureId:'bss',featureShort:'BSS',statistic:'结果',definitionKey:definitionKey(BSS_DEF),interval:'5m',threshold:5,direction:'>' as const,scale:100,cutoffMs:T,average:.125,cbi2:999,startAverage:777,previousAverage:666};
it('uses each signal own capture-time observation and scale, preserving zero and separating detector rows in exports',()=>{
 const sources=[.125,0,-.084].map((average,i)=>({id:String(i),symbol:'TEST'+i+'USDT',timeMs:T-3600000,timeLabel:'',fallbackZone:'',fish:{...snapshot,average}}));
 const study=importQualityFish(newQualityStudy(T),sources),rows=qualityDisplayRows(study),before=structuredClone(study);
 expect(rows.map(r=>qualityDetectorReading(r).value)).toEqual([12.5,0,-8.4]);
 expect(qualityDetectorReading(rows[0])).toMatchObject({text:'12.5',at:T});
 expect(qualityDetectorReading(rows[0]).detail).toContain('探测时刻');
 const sheet=buildQualitySheets(study,rows)[0],index=sheet.columns.findIndex(c=>c.header==='探测值');
 expect(sheet.columns[index-1].header).toBe('评分');expect(sheet.rows.map(r=>r[index])).toEqual([12.5,0,-8.4]);expect(study).toEqual(before);
});
it('preserves each hit member of a combined signal, and never invents missing readings or scales',()=>{
 const members=[snapshot,{...snapshot,statistic:'BSS',scale:1,average:.9}],source={id:'combined',symbol:'TESTUSDT',timeMs:T-3600000,timeLabel:'',fallbackZone:'',fish:{...snapshot,algorithms:members}};
 const study=importQualityFish(newQualityStudy(T),[source]),rows=qualityDisplayRows(study);
 expect(rows).toHaveLength(2);expect(rows.map(r=>qualityDetectorReading(r).value)).toEqual([12.5,.9]);
 for(const average of [NaN,Infinity,undefined]) { const row={...rows[0],readings:undefined,source:{...rows[0].source,fish:{...snapshot,average}}} as QualitySample; expect(qualityDetectorReading(row).value).toBeNull(); }
 for(const scale of [0,-1,undefined])expect(qualityDetectorReading({...rows[0],readings:{[rows[0].detectorId!]:{...snapshot,scale}}}).value).toBeNull();
 const missing={...rows[0],readings:undefined,source:{...rows[0].source,fish:undefined}};expect(qualityDetectorReading(missing).text).toBe('—');
 expect(qualityDetectorReading({...rows[0],detectorId:undefined,origin:'library'}).value).toBeNull();
});
