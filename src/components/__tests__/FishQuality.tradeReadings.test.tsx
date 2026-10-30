import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {FishQuality} from '@/components/FishQuality';
import {newQualityStudy,importQualityLibrary,qualityComparisonRows,qualityResultKey} from '@/lib/fish/quality';
import {enableQualityComparison} from '@/lib/fish/qualityComparison';
import {qualityEntryKey,qualityEntryParts} from '@/lib/fish/qualityEntry';
import {buildQualitySheets} from '@/lib/fish/qualityExport';
import type {FishQualityState} from '@/hooks/useFishQuality';
const T=Date.UTC(2026,9,20),M=60000;afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();});
function state(){const study=enableQualityComparison(importQualityLibrary(newQualityStudy(),[0,1].map(i=>({id:'r'+i,symbol:'READ'+i+'USDT',timeMs:T+i*M,timeLabel:'',fallbackZone:''}))));
 study.sellPlans=study.sellPlans!.map((p,j)=>({...p,rule:{metric:p.metric,direction:'<' as const,threshold:.5},...(j?{}:{mirrorTakeProfit:{enabled:true,gainPct:50,sellPct:50}})}));
 study.results=qualityComparisonRows(study).flatMap((row,i)=>study.sellPlans!.map(p=>({key:qualityResultKey(row,p,0),sampleId:row.id,groupId:p.id,evaluatedAt:T+20*M,status:'closed' as const,entryTime:row.enteredAt!,entryPrice:100,endTime:T+10*M,endPrice:i?97:90,returnPct:i?-3:20,pnl:i?-3:20,...(!i&&p===study.sellPlans![0]?{mirrorFill:{at:T+5*M,price:150,fraction:.5,gainPct:50,atOpen:false}}:{})})));
 study.entryReadings=qualityComparisonRows(study).flatMap((row,i)=>study.sellPlans!.flatMap((p,j)=>qualityEntryParts(p).map(part=>{const r=study.results.find(r=>r.sampleId===row.id&&r.groupId===p.id)!;return {key:qualityEntryKey(row.source,r,p,part)!,entryTime:r.entryTime!,evaluatedAt:T+20*M,mode:'intrabar' as const,metric:part.metric,value:10-i+j*10,at:r.entryTime!,barOpenTime:T-5*M};})));
 return {study,ready:true,running:false,progress:null,filterRunning:false,filterProgress:null,filterError:'',warning:'',error:'',start:vi.fn(),restart:vi.fn(),cancel:vi.fn(),startFilter:vi.fn(),cancelFilter:vi.fn(),setRule:vi.fn(),setCombo:vi.fn(),setObserveHours:vi.fn(),selectSell:vi.fn(),setSelectedRows:vi.fn(),setPriority:vi.fn(),setScope:vi.fn(),setFilters:vi.fn(),setHoldingVetoes:vi.fn(),setSellPlans:vi.fn(),entry:{owner:'a',running:false,progress:null,error:'',request:vi.fn(),cancel:vi.fn()}} satisfies FishQualityState;}
const expandEntries=()=>{for(const header of screen.getAllByTestId('quality-entry-header'))fireEvent.click(within(header).getByRole('button',{name:/^展开/}));};
const row=(i:number)=>screen.getAllByTestId('quality-fish-row').find(r=>r.textContent!.includes('READ'+i+'USDT'))!;
it('places entry before ROI and final price change before a permanently separate half-mirror and detector-label column',()=>{
 const s=state(),a=s.study.sellPlans![0],b=s.study.sellPlans![1];render(<FishQuality state={s}/>);
 for(const p of [a,b]){const entry=screen.getByRole('button',{name:'按'+p.label+'入场读数排序'}).closest('th')!;expect(entry.nextElementSibling).toHaveAttribute('data-testid','quality-sell-column');const price=screen.getByRole('button',{name:'按'+p.label+'卖出涨跌幅排序'}).closest('th')!;const mirror=screen.getByRole('button',{name:'按'+p.label+'半仓镜像实际涨幅排序'}).closest('th')!;expect(price.nextElementSibling).toBe(mirror);expect(mirror.nextElementSibling).toHaveAttribute('data-testid','quality-detector-label-header');}
 expect(screen.queryByTestId('quality-entry-value')).not.toBeInTheDocument();expandEntries();
 expect(within(row(0)).getAllByTestId('quality-entry-value').map(x=>x.textContent)).toEqual(['10','20']);expect(within(row(0)).getAllByTestId('quality-sale-price-change')[0]).toHaveTextContent('-10.00%');expect(row(0)).toHaveTextContent('+20.00%');
 expect(within(row(0)).getAllByTestId('quality-half-mirror')[1]).toHaveTextContent('未启用');fireEvent.click(screen.getByRole('button',{name:'展开'+b.label+'探测标签'}));for(const label of screen.getAllByTestId('quality-detector-label-item')){expect(label).toHaveTextContent('未判定');expect(label).not.toHaveTextContent('镜像');}
 expect(s.entry.request).toHaveBeenCalled();expect(s.start).not.toHaveBeenCalled();expect(s.restart).not.toHaveBeenCalled();
});
it('sorts numeric entry values and price changes independently and exports unchanged ROI with both new fields',()=>{
 const s=state(),p=s.study.sellPlans![0],sheets=buildQualitySheets(s.study,qualityComparisonRows(s.study)),main=sheets[0],runs=sheets.find(s=>s.name==='运行结果')!;
 for(const sheet of sheets)expect(sheet.rows.every(r=>r.length===sheet.columns.length)).toBe(true);
 const entry=main.columns.findIndex(c=>c.header===p.label+' · 入场读数'),price=main.columns.findIndex(c=>c.header===p.label+' · 卖出涨跌幅 %');expect(main.rows[0][entry]).toBe(10);expect(main.rows[0][entry+1]).toBe(20);expect(main.rows[0][price]).toBeCloseTo(-10);expect(main.columns[price+1].header).toContain('半仓镜像');expect(runs.columns.some(c=>c.header==='卖出算法入场读数')).toBe(true);expect(runs.columns.some(c=>c.header==='卖出涨跌幅 %')).toBe(true);
 render(<FishQuality state={s}/>);fireEvent.click(screen.getByRole('button',{name:'按'+p.label+'入场读数排序'}));expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('READ0USDT');fireEvent.click(screen.getByRole('button',{name:'按'+p.label+'入场读数排序'}));expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('READ1USDT');fireEvent.click(screen.getByRole('button',{name:'按'+p.label+'卖出涨跌幅排序'}));expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('READ1USDT');
});
it('separates missing readings and unfinished sales from real zero and offers targeted entry retries',()=>{
 const s=state(),p=s.study.sellPlans![0];s.study.entryReadings=s.study.entryReadings!.map((r,i)=>i===0?{...r,value:0}:i===1?{...r,value:undefined,error:'缺历史'}:r);s.study.results=s.study.results.map((r,i)=>i===0?{...r,status:'open' as const}:r);render(<FishQuality state={s}/>);expandEntries();expect(within(row(0)).getAllByTestId('quality-entry-value')[0]).toHaveTextContent('0');expect(within(row(0)).getAllByTestId('quality-sale-price-change')[0]).toHaveTextContent('持仓中');fireEvent.click(within(row(0)).getAllByTestId('quality-entry-value')[1]);expect(s.entry.request).toHaveBeenCalledWith([s.study.sellPlans![1].id],expect.any(Array),true);expect(s.start).not.toHaveBeenCalled();
});

it('collapses each plan independently and uses consistent column sizes without changing results',()=>{
 const s=state(),before=JSON.stringify(s.study);render(<FishQuality state={s}/>);
 expect(screen.queryByTestId('quality-entry-value')).toBeNull();const headers=screen.getAllByTestId('quality-entry-header');
 fireEvent.click(within(headers[0]).getByRole('button',{name:/^展开/}));expect(screen.getAllByTestId('quality-entry-value')).toHaveLength(2);expect(within(headers[1]).getByRole('button',{name:/^展开/})).toHaveAttribute('aria-expanded','false');
 fireEvent.click(within(headers[0]).getByRole('button',{name:/^收起/}));expect(screen.queryByTestId('quality-entry-value')).toBeNull();
 const table=screen.getByTestId('quality-fish-table').querySelector('table')!;expect(table).toHaveClass('table-fixed');expect(table.querySelectorAll('col')).toHaveLength(table.querySelectorAll('thead tr:last-child th').length);expect(JSON.stringify(s.study)).toBe(before);
});
