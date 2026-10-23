import { expect, it, vi } from 'vitest';
import { drawChartLine } from '../drawChartLine';

it('merges adjacent segments with identical colors and leaves gaps unconnected', () => {
  const paths: number[][][] = []; let current: number[][] = [];
  const ctx = { save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: () => { current=[]; }, moveTo: (x:number,y:number) => current.push([x,y]), lineTo: (x:number,y:number) => current.push([x,y]), stroke: () => paths.push(current) };
  const result = [1,2,3,null,5,-1,-2].map(v => v == null ? {} : {value:v});
  const args = { ctx, indicator:{result}, kLineDataList: result, visibleRange:{from:0,to:7}, xAxis:{convertToPixel:(v:number)=>v*10}, yAxis:{convertToPixel:(v:number)=>v*2}, defaultStyles:{lines:[{color:'gray',size:1.5,style:'solid',smooth:false}]} };
  const figure = {key:'value',type:'line',styles:({next}:any)=>({color:next.indicatorData.value > 0?'green':'red'})};
  expect(drawChartLine(args as any,figure as any)).toBe(true);
  expect(paths).toEqual([[[0,2],[10,4],[20,6]],[[40,10],[50,-2],[60,-4]]]);
  expect(ctx.restore).toHaveBeenCalledOnce();
});
it('retains native rendering for custom geometry or smoothing', () => {
  const args = { xAxis:{}, visibleRange:{}, indicator:{}, defaultStyles:{lines:[{smooth:true}]} };
  expect(drawChartLine(args as any,{key:'x',type:'line'} as any)).toBe(false);
});
