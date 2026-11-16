import {expect, it, vi} from 'vitest';
import {registerIndicator} from 'klinecharts';
import {impulse1115ChartRows, impulse1115TooltipRow, registerImpulse1115Chart} from '../impulse1115Chart';
import {accountResearchIndicators, IMPULSE_1115_CHART, IMPULSE_1115_CHART_ID, researchChartSeries} from '../researchIndicators';
import {bar, impulse, STEP, TICK, warm} from './fixtures/dbl5GuardPlusBars';

const candles = (bars: ReturnType<typeof warm>) => bars.map(row => ({
  ...row, timestamp:row.openTime, researchSymbol:'TESTUSDT', PRS6H_tick_size:TICK, cba2Closed:true,
}));
vi.mock('klinecharts', async original => ({
  ...await original<typeof import('klinecharts')>(), registerIndicator:vi.fn(),
}));

it('draws the 1115 reference as segments without drawing origin dots',()=>{
  registerImpulse1115Chart(IMPULSE_1115_CHART);
  const spec=vi.mocked(registerIndicator).mock.calls.at(-1)![0];
  const ctx={save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),setLineDash:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),arc:vi.fn(),fill:vi.fn()};
  spec.draw!({ctx,visibleRange:{from:0,to:2},
    indicator:{result:[{time:STEP,available:true,value:99,confirmedOrigin:100},{time:2*STEP,available:true,value:99}]},
    xAxis:{convertToPixel:(i:number)=>i*5},yAxis:{convertToPixel:(price:number)=>price},
  } as never);
  expect(ctx.lineTo).toHaveBeenCalled();
  expect(ctx.stroke).toHaveBeenCalledOnce();
  expect(ctx.arc).not.toHaveBeenCalled();
  expect(ctx.fill).not.toHaveBeenCalled();
});

it('plots only the confirmed 1115 impulse and ends its reference after a strict closing break', () => {
  const market = candles([...warm(), impulse(), bar(21,101.4,101.7,99.3,100.6),
    bar(22,100.6,100.7,98.5,98.6), bar(23,98.6,99,98.5,98.9)]);
  const combined = accountResearchIndicators().find(item=>item.id==='DBL5_GUARD_PLUS')!;
  const source = researchChartSeries(market, combined, 3, {fetchReference:false});
  const rows = impulse1115ChartRows(market, 3, false);
  expect(source.core.slice(0,20).some(Number.isFinite)).toBe(true);
  expect(rows.slice(0,20).every(row=>row.value==null&&row.confirmedOrigin==null)).toBe(true);
  expect(rows[20]).toMatchObject({confirmedOrigin:99.95,value:source.components!.DBL5P_impulse[20]});
  expect(rows[20].value).toBeLessThan(rows[20].confirmedOrigin!);
  expect(rows[21].value).toBe(rows[20].value);
  expect(rows[21].confirmedOrigin).toBeUndefined();
  expect(rows[22].value).toBeUndefined();
  expect(rows[23].value).toBeUndefined();
  expect(impulse1115TooltipRow(rows,20)?.confirmedOrigin).toBeUndefined();
  expect(impulse1115TooltipRow(rows,21)?.confirmedOrigin).toBe(99.95);
  expect(impulse1115TooltipRow(rows,23)?.value).toBeUndefined();
});

it('hides a forming impulse, resets at gaps, and accepts only 5m data', () => {
  const market = candles([...warm(), impulse(), bar(22,101.4,101.8,101.2,101.5)]);
  const gap = impulse1115ChartRows(market, 3, false);
  expect(gap[20].value).toBeDefined();
  expect(gap[21].value).toBeUndefined();
  expect(impulse1115TooltipRow(gap,21)).toBeUndefined();
  const forming = market.slice(0,21).map((row,index)=>({...row,cba2Closed:index!==20}));
  expect(impulse1115ChartRows(forming,3,false).at(-1)).toMatchObject({available:false});
  expect(impulse1115ChartRows(forming,3,false).every(row=>row.value==null&&row.confirmedOrigin==null)).toBe(true);
  const non5m = market.map((row,index)=>({...row,timestamp:market[0].timestamp+index*STEP*3}));
  expect(impulse1115ChartRows(non5m,3,false).every(row=>row.value==null&&row.confirmedOrigin==null)).toBe(true);
  expect(accountResearchIndicators().filter(item=>item.id===IMPULSE_1115_CHART_ID)).toHaveLength(1);
});
