import {expect,it,vi} from 'vitest';
interface ChartTemplate {name:string;draw:(params:unknown)=>void;createTooltipDataSource:(params:unknown)=>{values:{title:string;value:string}[]}}
const registered=vi.hoisted(()=>new Map<string,ChartTemplate>());vi.mock('klinecharts',()=>({registerIndicator:(v:ChartTemplate)=>registered.set(v.name,v)}));
import {registerDbl5Indicator} from '../dbl5mChart';
import {accountResearchIndicators} from '../researchIndicators';
// 【用户要求】2026-11-02 颜色太多分不清：防守线是唯一主线（蓝色），上涨期实线、震荡期虚线；箱底箱顶淡色细线；只有防守线跌破画红叉
it('draws the guard as the single blue main line, dashed only in ranges, with faint box lines and a red cross only for a confirmed guard break',()=>{
 registerDbl5Indicator(accountResearchIndicators().find(i=>i.id==='DBL5')!);const template=registered.get('DBL5_CUSTOM');
 const result=[{value:100,_DBL5_episode:1,_DBL5_guard:98,_DBL5_guard_trend:1,_DBL5_guard_segment:0},{value:102,_DBL5_episode:1,_DBL5_guard:99,_DBL5_guard_trend:0,_DBL5_guard_segment:0},{_DBL5_guard:99,_DBL5_guard_trend:0,_DBL5_guard_segment:0},{_DBL5_guard_broken:1}];
 const styles:string[]=[],dashes:number[][]=[],ctx={strokeStyle:'',save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(()=>styles.push(ctx.strokeStyle)),setLineDash:(d:number[])=>dashes.push(d),fillText:vi.fn()};
 template.draw({ctx,indicator:{result},visibleRange:{from:0,to:4},xAxis:{convertToPixel:(i:number)=>i},yAxis:{convertToPixel:(v:number)=>v}});
 expect(dashes).toContainEqual([5,3]);expect(dashes).toContainEqual([]);expect(new Set(styles)).toEqual(new Set(['#0b9f78','#2563eb','#dc2626']));
 const tip=template.createTooltipDataSource({indicator:{result},crosshair:{dataIndex:2},defaultStyles:{tooltip:{icons:[]}}});
 expect(tip.values.at(-1)).toEqual({title:'防守线（虚线·震荡期）: ',value:'99'});
});

function drawGuard(result:Record<string,number>[],spacing=3,from=0){
 registerDbl5Indicator(accountResearchIndicators().find(i=>i.id==='DBL5')!);
 const strokes:{points:number[][];dash:number[];color:string;alpha:number}[]=[];
 const ctx={globalAlpha:1,strokeStyle:'',points:[] as number[][],dash:[] as number[],save(){},restore(){},beginPath(){this.points=[];},moveTo(x:number,y:number){this.points.push([x,y]);},lineTo(x:number,y:number){this.points.push([x,y]);},stroke(){strokes.push({points:this.points,dash:this.dash,color:this.strokeStyle,alpha:this.globalAlpha});},setLineDash(d:number[]){this.dash=d;},fillText(){}};
 registered.get('DBL5_CUSTOM')!.draw({ctx,indicator:{result},visibleRange:{from,to:result.length},xAxis:{convertToPixel:(i:number)=>i*spacing},yAxis:{convertToPixel:(v:number)=>v}});
 return strokes.filter(s=>s.color==='#2563eb'&&s.alpha===1);
}
const guard=(trend=0,segment=0)=>({_DBL5_guard:98,_DBL5_guard_trend:trend,_DBL5_guard_segment:segment});

it.each([1,3,4,12])('keeps visible dash gaps across candles spaced only %s pixels apart',spacing=>{
 const strokes=drawGuard(Array.from({length:30},()=>guard()),spacing);
 // A continuous run spans multiple full dash cycles even when each individual
 // candle is narrower than the 5 px painted portion. Per-candle strokes fail.
 expect(strokes).toContainEqual({points:[[spacing,98],[30*spacing,98]],dash:[5,3],color:'#2563eb',alpha:1});
});

it('switches line style only at the completed result publication, even if the price does not change',()=>{
 const strokes=drawGuard([guard(1),guard(1),guard(0),guard(0),guard(1),guard(1)],10);
 expect(strokes).toContainEqual({points:[[10,98],[30,98]],dash:[],color:'#2563eb',alpha:1});
 expect(strokes).toContainEqual({points:[[30,98],[50,98]],dash:[5,3],color:'#2563eb',alpha:1});
 expect(strokes).toContainEqual({points:[[50,98],[60,98]],dash:[],color:'#2563eb',alpha:1});
 const template=registered.get('DBL5_CUSTOM')!;
 for(const [dataIndex,label] of [[2,'实线·上涨期'],[3,'虚线·震荡期']] as const){
  expect(template.createTooltipDataSource({indicator:{result:[guard(1),guard(1),guard(0)]},crosshair:{dataIndex},defaultStyles:{tooltip:{icons:[]}}}).values.at(-1)?.title).toBe(`防守线（${label}）: `);
 }
});

it('does not bridge missing guards or new guard segments while joining horizontal runs',()=>{
 const result=[guard(),guard(),{},guard(),guard(),guard(0,1),guard(0,1)];
 const strokes=drawGuard(result,10);
 expect(strokes.filter(s=>s.points[1][0]-s.points[0][0]>2).map(s=>s.points)).toEqual([[[10,98],[20,98]],[[40,98],[50,98]],[[60,98],[70,98]]]);
});

it('keeps the visible tail dashed after panning into a long range',()=>{
 const strokes=drawGuard(Array.from({length:100},()=>guard()),3,80);
 expect(strokes).toContainEqual({points:[[79*3,98],[100*3,98]],dash:[5,3],color:'#2563eb',alpha:1});
});
it('keeps a guard-step connector faint so it cannot conceal the triggering candle wick at the same x coordinate',()=>{
 registerDbl5Indicator(accountResearchIndicators().find(i=>i.id==='DBL5')!);const template=registered.get('DBL5_CUSTOM');
 const strokes:{points:number[][];alpha:number;width:number;dash:number[]}[]=[],ctx={globalAlpha:1,lineWidth:2,strokeStyle:'',points:[] as number[][],dash:[] as number[],save(){},restore(){},beginPath(){this.points=[];},moveTo(x:number,y:number){this.points.push([x,y]);},lineTo(x:number,y:number){this.points.push([x,y]);},stroke(){strokes.push({points:this.points,alpha:this.globalAlpha,width:this.lineWidth,dash:this.dash});},setLineDash(d:number[]){this.dash=d;},fillText(){}};
 const result=[{_DBL5_guard:.1776,_DBL5_guard_segment:0,_DBL5_guard_trend:1},{_DBL5_guard:.22206,_DBL5_guard_segment:0,_DBL5_guard_trend:1}];
 template.draw({ctx,indicator:{result},visibleRange:{from:0,to:2},xAxis:{convertToPixel:(i:number)=>i},yAxis:{convertToPixel:(v:number)=>v}});
 expect(strokes).toContainEqual({points:[[1,.1776],[2,.1776]],alpha:1,width:2,dash:[]});
 expect(strokes).toContainEqual({points:[[2,.1776],[2,.22206]],alpha:.25,width:1,dash:[2,3]});
 expect(result[1]._DBL5_guard).toBe(.22206);
});
