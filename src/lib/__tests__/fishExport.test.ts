import { expect, it } from 'vitest';
import { buildFishCabinSheets } from '@/lib/fish/export';
import { buildXlsxBytes } from '@/lib/xlsxWorkbook';
import type { FishSnapshot } from '@/lib/fish/algorithm';
import type { TradeSignal } from '@/lib/signalLibrary';
import { definitionKey, STATE_DEF } from '@/lib/deepDig/features';
const cut = Date.UTC(2026, 9, 25, 7);
const base: FishSnapshot = {featureId:'state',featureShort:'S',statistic:'state',algorithmKey:'state|state|=|>|0.7|x',definitionKey:definitionKey(STATE_DEF),interval:'5m',direction:'>',threshold:.7,scale:1,unit:'原值',average:.75,cbi2:.75,startAverage:.71,previousAverage:.69,cutoffMs:cut,startIndex:2,cutoffIndex:5};
const avg: FishSnapshot = {...base,statistic:'avg_state_2',algorithmKey:'state|avg_state_2|=|>|0.6|x',threshold:.6};
const signal = (id:string,members=[base,avg],hitAlgorithms:number[]|undefined=[1,2]): TradeSignal => ({id,symbol:id+'USDT',timeMs:cut-900000,timeLabel:'',fallbackZone:'',fish:{...base,combination:'or',algorithms:members,hitAlgorithms}});
const table = (sheets:ReturnType<typeof buildFishCabinSheets>,name:string) => {
 const s=sheets.find(s=>s.name===name)!;return s.rows.map(row=>Object.fromEntries(s.columns.map((c,i)=>[c.header,row[i]])));
};
it('overlap uses only jointly known outcomes, with conditional unique-hit denominators and no single-card inflation',()=>{
 const rows=[signal('both'),signal('onlyA',[base,{...avg,outcome:'below'}],[1]),signal('onlyB',[{...base,outcome:'below'},avg],[2]),signal('failed',[base,{...avg,outcome:'failed'}],[1]),{...signal('single'),fish:base}];
 const before=JSON.stringify(rows),sheets=buildFishCabinSheets(rows,cut);
 const pair=table(sheets,'两两重叠')[0];
 expect(pair).toMatchObject({'共同出现记录数':4,'共同可判定记录数':3,'含未知的记录数':1,'共同命中数':1,'仅A命中数':1,'仅B命中数':1,'命中并集数':3,'A被B覆盖率(0-1)':.5,'B被A覆盖率(0-1)':.5});
 expect(pair['Jaccard(0-1)']).toBeCloseTo(1/3);
 const summary=table(sheets,'算法汇总');
 expect(summary[0]).toMatchObject({'参与记录数':5,'命中记录数':4,'未命中记录数':1,'未知记录数':0,'多算法全部可判定时本算法命中数':2,'同记录内独有命中数':1,'同记录内独有率(0-1)':.5});
 expect(summary[1]).toMatchObject({'命中记录数':2,'未命中记录数':1,'未知记录数':1});
 expect(table(sheets,'算法判定').find(r=>r['原记录ID']==='failed'&&r['卡片序号']===2)?.['是否命中(1/0/空)']).toBeNull();
 expect(JSON.stringify(rows)).toBe(before);
});
it('keeps raw, avg, avg_2, threshold and formula versions distinct; missing configuration remains explicit',()=>{
 const second={...avg,statistic:'avg_state',algorithmKey:'state|avg_state|=|>|0.6|x'};
 const changed={...avg,definitionKey:definitionKey({...STATE_DEF,formula:'state = C\navg_state_2 = avg(state,12)'})};
 const s=buildFishCabinSheets([signal('versions',[base,avg,second,changed,{...avg,threshold:.8}], [1,2,3,4,5]),signal('legacy',[{...avg,definitionKey:undefined,scale:undefined}], [1])]);
 const algorithms=table(s,'算法汇总');expect(algorithms).toHaveLength(6);
 expect(new Set(algorithms.map(a=>a['实际指标']))).toEqual(new Set(['state（原始值）','avg_state','avg_state_2']));
 expect(algorithms.at(-1)?.['配置完整性']).toContain('不完整');
});
it('missing tags and contradictory evidence remain empty; valid rejected outcomes stay numeric zero',()=>{
 const unknown=signal('unknown',[{...base,outcome:'hit'},avg]);delete unknown.fish!.hitAlgorithms;
 const conflict=signal('conflict',[{...base,outcome:'below'},avg],[1,2]);
 const missing={id:'missing',symbol:'OLDUSDT',timeMs:cut,timeLabel:'',fallbackZone:''};
 const s=buildFishCabinSheets([unknown,conflict,missing,signal('rejected',[base,{...avg,outcome:'unknown'}],[1])]);
 const rows=table(s,'算法判定');
 expect(rows.find(r=>r['原记录ID']==='unknown'&&r['卡片序号']===2)?.['是否命中(1/0/空)']).toBeNull();
 expect(rows.find(r=>r['原记录ID']==='conflict'&&r['卡片序号']===1)?.['判定依据']).toContain('冲突');
 expect(rows.find(r=>r['原记录ID']==='missing')?.['是否命中(1/0/空)']).toBeNull();
 expect(rows.find(r=>r['原记录ID']==='rejected'&&r['卡片序号']===2)?.['是否命中(1/0/空)']).toBe(0);
});
it('duplicate cards count once; conflicts do not become a forced positive and zero denominators stay empty',()=>{
 const s=buildFishCabinSheets([signal('duplicate',[base,base,avg],[1,2]),signal('conflict',[base,base,avg],[1])]);
 const summary=table(s,'算法汇总');expect(summary).toHaveLength(2);
 expect(summary[0]).toMatchObject({'参与记录数':2,'命中记录数':1,'未知记录数':1,'同记录内独有命中数':1});
 const pair=table(s,'两两重叠')[0];expect(pair).toMatchObject({'共同出现记录数':2,'共同可判定记录数':1,'B被A覆盖率(0-1)':null});
});
it('exports every cabin row independently of venue/time coincidences, excludes fresh fish and preserves all raw JSON via safe chunks',()=>{
 const huge='😀'.repeat(20000),old=signal('huge',[{...base,constraints:[huge]}],[1]);
 const same={...old,id:'other-venue',exchange:'okx' as const};
 const s=buildFishCabinSheets([old,same,{...signal('fresh'),freshCatch:true}]);
 expect(table(s,'信号明细')).toHaveLength(2);
 const chunks=s.find(s=>s.name==='原始快照')!.rows.filter(r=>r[0]==='F000001');
 expect(chunks.length).toBeGreaterThan(1);expect(chunks.every(r=>String(r[2]).length<=28000)).toBe(true);
 expect(JSON.parse(chunks.map(r=>r[2]).join(''))).toEqual(old);
 const long=table(s,'算法判定')[0];expect(long['本算法起点(UTC+8)']).toBe('2026-10-25 14:45:00');
 const bytes=buildXlsxBytes(s);const xml=new TextDecoder().decode(bytes);
 expect(xml).toContain('t="inlineStr"');expect(xml).toContain('<v>0.7</v>');expect(xml).not.toContain('<f>');
});
it('documents selection bias and the comparison grain instead of claiming market-wide importance',()=>{
 const notes=table(buildFishCabinSheets([]),'说明');
 const content=notes.map(r=>r['口径']).join('\n');
 expect(content).toContain('不受月份');expect(content).toContain('空白不是0');expect(content).toContain('交集样本本身要求全部命中');expect(content).toContain('不能单独证明算法收益价值');
});
