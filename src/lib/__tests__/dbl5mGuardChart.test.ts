import {expect,it,vi} from 'vitest';
const registered=vi.hoisted(()=>new Map<string,any>());vi.mock('klinecharts',()=>({registerIndicator:(v:any)=>registered.set(v.name,v)}));
import {registerDbl5Indicator} from '../dbl5mChart';
import {accountResearchIndicators} from '../researchIndicators';
// 【用户要求】2026-11-02 防守线画成虚线阶梯：上涨期蓝、震荡期紫；收盘确认跌破处红叉；悬停显示数值与行情状态
it('draws the guard as a dashed step line coloured by regime, marks a confirmed break and shows it in the tooltip',()=>{
 registerDbl5Indicator(accountResearchIndicators().find(i=>i.id==='DBL5')!);const template=registered.get('DBL5_CUSTOM');
 const result=[{value:100,_DBL5_episode:1,_DBL5_guard:98,_DBL5_guard_trend:1,_DBL5_guard_segment:0},{value:102,_DBL5_episode:1,_DBL5_guard:99,_DBL5_guard_trend:0,_DBL5_guard_segment:0},{_DBL5_guard_broken:1}];
 const styles:string[]=[],dashes:number[][]=[],ctx:any={save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(()=>styles.push(ctx.strokeStyle)),setLineDash:(d:number[])=>dashes.push(d),fillText:vi.fn()};
 template.draw({ctx,indicator:{result},visibleRange:{from:0,to:3},xAxis:{convertToPixel:(i:number)=>i},yAxis:{convertToPixel:(v:number)=>v}});
 expect(dashes).toContainEqual([4,3]);expect(styles).toEqual(expect.arrayContaining(['#3b82f6','#8b5cf6','#dc2626']));
 const tip=template.createTooltipDataSource({indicator:{result},crosshair:{dataIndex:2},defaultStyles:{tooltip:{icons:[]}}});
 expect(tip.values.at(-1)).toEqual({title:'防守线（震荡期）: ',value:'99'});
});
