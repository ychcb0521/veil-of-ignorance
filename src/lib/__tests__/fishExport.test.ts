import { expect, it } from 'vitest';
import { buildFishCabinSheets } from '@/lib/fish/export';
import { buildXlsxBytes } from '@/lib/xlsxWorkbook';
import type { FishSnapshot } from '@/lib/fish/algorithm';
import type { TradeSignal } from '@/lib/signalLibrary';
import { definitionKey, STATE_DEF } from '@/lib/deepDig/features';
const cut = Date.UTC(2026, 9, 25, 7);
const base: FishSnapshot = {featureId:'state',featureShort:'S',statistic:'state',algorithmKey:'state|state|=|>|0.7|x',definitionKey:definitionKey(STATE_DEF),interval:'5m',direction:'>',threshold:.7,scale:1,unit:'原值',average:.75,cbi2:.75,startAverage:.71,previousAverage:.69,cutoffMs:cut};
const avg: FishSnapshot = {...base,statistic:'avg_state_2',algorithmKey:'state|avg_state_2|=|>|0.6|x',threshold:.6};
const signal = (id:string,members=[base,avg],hitAlgorithms=[1,2]): TradeSignal => ({id,symbol:id+'USDT',timeMs:cut,timeLabel:'',fallbackZone:'',fish:{...base,combination:'or',algorithms:members,hitAlgorithms}});
it('exports one simple cabin table with the list columns followed by saved metrics and thresholds',()=>{
 const s=signal('both');s.quality=3;
 const sheets=buildFishCabinSheets([s]);
 expect(sheets).toHaveLength(1);expect(sheets[0].name).toBe('鱼舱');
 expect(sheets[0].columns.map(c=>c.header)).toEqual(['标的','信号时间','算法类型','市场','评分','具体指标','捕获阈值']);
 expect(sheets[0].rows[0]).toEqual(['bothUSDT','2026-10-25 15:00:00','S 原值 · avg_S','',3,'S 原值：state（原始值）；avg_S：avg_state_2','S 原值：> 0.7；avg_S：> 0.6']);
});
it('exports only the hit members of unions and all intersection members, keeping a single fish on one row',()=>{
 const single=signal('one',[base,avg],[2]),all=signal('all');all.fish!.combination='and';
 const rows=buildFishCabinSheets([single,all])[0].rows;
 expect(rows[0].slice(2)).toEqual(['avg_S','',null,'avg_state_2','> 0.6']);
 expect(rows[1][2]).toBe('S 原值 · avg_S');
});
it('resolves the captured formula result, preserves older averages and restores only saved thresholds',()=>{
 const formula=JSON.stringify(['state=C;avg_state=avg(state,12);avg_state_2=avg(avg_state,12)','','','']);
 const result={...avg,statistic:'结果',definitionKey:formula};
 const legacy={...base,statistic:'state',H:24,threshold:undefined,direction:undefined,algorithmKey:'state|state|24|<|0.55|x'};
 const missing={featureShort:'OLD',statistic:'结果',algorithmKey:'old|结果|=|>|0.25|x'} as FishSnapshot;
 const rows=buildFishCabinSheets([signal('result',[result],[1]),signal('legacy',[legacy],[1]),signal('missing',[missing],[1])])[0].rows;
 expect(rows[0].slice(5)).toEqual(['avg_state_2','> 0.6']);
 expect(rows[1].slice(5)).toEqual(['avg(state, 24h)（旧版外层均值）','< 0.55']);
 expect(rows[2].slice(5)).toEqual(['结果（指标未记录）','> 0.25']);
});
it('excludes fresh fish, sorts like the default list, leaves missing ratings blank and does not mutate input',()=>{
 const early={...signal('early'),timeMs:cut-300000,market:'us_stock' as const,exchange:'okx' as const};
 const late=signal('late'),fresh={...signal('fresh'),freshCatch:true};
 const input=[early,fresh,late],before=JSON.stringify(input);
 const s=buildFishCabinSheets(input);
 expect(s[0].rows.map(r=>r[0])).toEqual(['lateUSDT','earlyUSDT（OKX）']);
 expect(s[0].rows[1][3]).toBe('美股');expect(s[0].rows[1][4]).toBeNull();expect(JSON.stringify(input)).toBe(before);
 const xml=new TextDecoder().decode(buildXlsxBytes(s));expect(xml).toContain('avg_state_2');expect(xml).not.toContain('<f>');
});
