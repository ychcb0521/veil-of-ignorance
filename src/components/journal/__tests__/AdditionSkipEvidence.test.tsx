import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import {AdditionSkipEvidence,QualitySellEvidence} from '../QualitySellEvidence';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import type {TradeCampaign} from '@/types/journal';
type Evidence=NonNullable<NonNullable<TradeCampaign['comparison']>['sellEvidence']>;
afterEach(cleanup);
const H=3600000,T0=Date.UTC(2026,10,1,0,0);
const evidence=(extra:Partial<Evidence>={}):Evidence=>({addition:{...defaultQualityAddition(),enabled:true,source:'structure',maxRounds:3},confirmedAt:T0,mirrorFill:{at:T0+H,price:100,fraction:.5,gainPct:5,atOpen:true},additionSkipsFrom:T0,...extra} as Evidence);

// 【用户要求】2026-11-03 未加仓理由：监测依据「条件加仓」下方，逐次列出支撑上移却没加仓的原因
it('lists vetoes and skips in time order with per-reason counts and the whole-run notes',()=>{
 render(<AdditionSkipEvidence evidence={evidence({
  additionSkips:[{at:T0+3*H,round:1,kind:'gain',label:'涨幅门槛未达',reading:'收盘 105 比成本线 S 90 只涨 16.67%，要求 ≥ 20%',support:102},{at:T0+2*H,round:1,kind:'no-old-c',label:'没有旧 C',reading:'首个箱体',support:100},{at:T0+5*H,round:1,kind:'gain',label:'涨幅门槛未达',reading:'收盘 106',support:104}],
  additionVetoes:[{at:T0+4*H,round:1,kind:'pullback',label:'冲高回落：未收复最高点前不再加仓',reading:'锁住时持仓最高 110'}],
  executedAt:T0+6*H,
 })}/>);
 const box=screen.getByTestId('quality-addition-skips');expect(box).toHaveTextContent('未加仓理由 · 4 次');
 expect(screen.getByTestId('quality-addition-skip-counts')).toHaveTextContent('没有旧 C 1 次 · 涨幅门槛未达 2 次 · 冲高回落锁住 1 次');
 const rows=screen.getAllByTestId('quality-addition-skip-row').map(r=>r.textContent);
 expect(rows[0]).toContain('没有旧 C');expect(rows[0]).toContain('新 C 100');expect(rows[2]).toContain('否决：冲高回落');expect(rows[3]).toContain('新 C 104');
 expect(within(box).getByText(/之前的支撑上移不加仓/)).toBeInTheDocument();expect(within(box).getByText(/卖出全部持仓之后不再加仓/)).toBeInTheDocument();
 expect(within(box).queryByText(/从头重算/)).toBeNull();expect(within(box).queryByText(/已加满/)).toBeNull();
});
it('explains whole-run reasons when nothing was recorded: no mirror, full rounds, legacy or resumed results',()=>{
 const {rerender}=render(<AdditionSkipEvidence evidence={evidence({mirrorFill:undefined})}/>);
 expect(screen.getByTestId('quality-addition-skips')).toHaveTextContent('未加仓理由 · 没有逐次记录');expect(screen.getByText(/镜像止盈没有成交/)).toBeInTheDocument();
 expect(screen.queryByTestId('quality-addition-skip-counts')).toBeNull();
 const fill={at:T0+2*H,price:101,quantity:1,notional:101,reading:102,threshold:0,direction:'>',metric:'confirmed_support',label:'DBL-5'} as never;
 rerender(<AdditionSkipEvidence evidence={evidence({addition:{...defaultQualityAddition(),enabled:true,maxRounds:1},additionFills:[fill],additionFill:fill})}/>);
 expect(screen.getByText(/已加满 1 次/)).toBeInTheDocument();
 rerender(<AdditionSkipEvidence evidence={evidence({additionSkipsFrom:undefined})}/>);expect(screen.getByText(/旧版本算出来的/)).toBeInTheDocument();
 rerender(<AdditionSkipEvidence evidence={evidence({additionSkipsFrom:T0+3*H})}/>);expect(screen.getByText(/之前的理由没有记录（旧结果续算）/)).toBeInTheDocument();
 rerender(<AdditionSkipEvidence evidence={evidence({addition:{...defaultQualityAddition(),enabled:false}})}/>);expect(screen.queryByTestId('quality-addition-skips')).toBeNull();
});
it('sits right below 条件加仓 inside 监测依据',()=>{
 render(<QualitySellEvidence evidence={evidence({additionSkips:[{at:T0+2*H,round:1,kind:'no-old-c',label:'没有旧 C',reading:'首个箱体'}]})}/>);
 const add=screen.getByTestId('quality-addition-evidence'),skips=screen.getByTestId('quality-addition-skips');
 expect(screen.getByTestId('quality-evidence-details')).toContainElement(skips);expect(add.nextElementSibling).toBe(skips);
});
