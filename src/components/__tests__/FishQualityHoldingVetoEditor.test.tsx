import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {FishQualityHoldingVetoEditor} from '../FishQualityHoldingVetoEditor';
import {holdingVetoDraft,parseHoldingVetoDraft,planHoldingVetoDraft} from '@/lib/fish/qualityFilters';
import { DBL5_GUARD_VERSION, DBL5_RETEST_GUARD_VERSION } from '@/lib/dbl5m';
import {BOX_STOP_GUARD_REGIME_VERSION,defaultBoxBreak,defaultBoxStop} from '@/lib/fish/qualityBoxStop';
import {holdingVetoIdentity,type QualityHoldingVeto} from '@/lib/fish/qualityVeto';
import { qualityDefinition, qualityMetricPlan } from '@/lib/fish/quality';
afterEach(cleanup);
function Editor({plan=false,entry=false,saved=[]}:{plan?:boolean;entry?:boolean;saved?:QualityHoldingVeto[]}={}){const [draft,setDraft]=useState(plan?planHoldingVetoDraft(saved):holdingVetoDraft(saved));return <><FishQualityHoldingVetoEditor entry={entry} draft={draft} setDraft={setDraft}/><button onClick={()=>{document.querySelector('output')!.textContent=JSON.stringify(parseHoldingVetoDraft(draft));}}>保存</button><output/></>}
it.each([false,true])('freezes independent indicator periods and formula hours (screening=%s)', entry=>{
 const view=render(<Editor entry={entry}/>);
 for (const row of [1,2]) {
   fireEvent.change(screen.getByLabelText(`持仓否决 ${row} 指标`),{target:{value:'cda:CDA'}});
   fireEvent.change(screen.getByLabelText(`持仓否决 ${row} 方向`),{target:{value:'<'}});
   fireEvent.change(screen.getByLabelText(`持仓否决 ${row} 阈值`),{target:{value:'-15'}});
   fireEvent.click(screen.getByLabelText(`启用持仓否决 ${row}`));
 }
 fireEvent.change(screen.getByLabelText('持仓否决 1 K 线周期'),{target:{value:'15m'}});
 fireEvent.change(screen.getByLabelText('持仓否决 1 半衰期（小时）'),{target:{value:'1.5'}});
 fireEvent.change(screen.getByLabelText('持仓否决 2 K 线周期'),{target:{value:'30m'}});
 fireEvent.change(screen.getByLabelText('持仓否决 2 公式回看（小时）'),{target:{value:'12'}});
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const saved:QualityHoldingVeto[]=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved.map(rule=>qualityMetricPlan(rule.snapshot!,rule.metric).plan.step)).toEqual([900000,1800000]);
 expect(qualityDefinition(saved[0].snapshot!).halfLifeHours).toBe(1.5);
 expect(qualityDefinition(saved[1].snapshot!).avgHours).toBe(12);
 expect(parseHoldingVetoDraft(holdingVetoDraft(saved))).toEqual(saved);
 view.unmount();
 render(<Editor entry={entry} saved={saved}/>);
 expect(screen.getByLabelText('持仓否决 1 K 线周期')).toHaveValue('15m');
 expect(screen.getByLabelText('持仓否决 1 半衰期（小时）')).toHaveValue(1.5);
 expect(screen.getByLabelText('持仓否决 2 K 线周期')).toHaveValue('30m');
 expect(screen.getByLabelText('持仓否决 2 公式回看（小时）')).toHaveValue(12);
});
it('adds an independent opt-in red-cross rule with frozen DBL-5 details and no price-stop controls',()=>{
 render(<Editor/>);fireEvent.click(screen.getByRole('button',{name:'添加支撑断裂终止'}));
 expect(screen.getByLabelText('启用持仓否决 3')).not.toBeChecked();
 expect(screen.getByLabelText('持仓否决 3 指标')).toHaveValue('box-support-break');
 expect(screen.queryByLabelText('箱体止损 3 更新方式')).toBeNull();
 expect(screen.queryByLabelText('箱体止损 3 额外冗余')).toBeNull();
 expect(screen.queryByLabelText('箱体止损 3 防守线类型')).toBeNull();
 expect(screen.getByLabelText('箱体止损 3 防守线版本')).toHaveValue(DBL5_RETEST_GUARD_VERSION);
 fireEvent.click(screen.getByLabelText('启用持仓否决 3'));
 fireEvent.change(screen.getByLabelText('箱体止损 3 防守线震荡断线根数'),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const saved=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved).toMatchObject([{kind:'box-stop',enabled:true,boxStop:{version:'holding-support-break-v1',confirmation:'guard-break',structure:{algorithm:'dbl5',kSource:'guard',buffer:0,versions:{guard:DBL5_RETEST_GUARD_VERSION},definition:{DBL5_config:{guard_range_closes:3,guard_version:DBL5_RETEST_GUARD_VERSION}}}}}]);
 expect(parseHoldingVetoDraft(holdingVetoDraft(saved))).toEqual(saved);
});
it('defaults new screening red-cross rules to the retest guard while restoring existing rules verbatim',()=>{
 const existing=parseHoldingVetoDraft([{choice:'box-support-break',direction:'<=',threshold:'0',enabled:true,boxStop:defaultBoxBreak()}]);
 const original=structuredClone(existing);
 render(<Editor entry saved={existing}/>);
 expect(screen.getByLabelText('箱体止损 1 防守线版本')).toHaveValue(DBL5_GUARD_VERSION);
 fireEvent.click(screen.getByRole('button',{name:'添加否决条件'}));
 fireEvent.change(screen.getByLabelText('持仓否决 2 指标'),{target:{value:'box-support-break'}});
 expect(screen.getByLabelText('箱体止损 2 防守线版本')).toHaveValue(DBL5_RETEST_GUARD_VERSION);
 fireEvent.click(screen.getByLabelText('启用持仓否决 2'));
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const saved=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved[0]).toEqual(original[0]);
 expect(saved[1].boxStop.structure.versions.guard).toBe(DBL5_RETEST_GUARD_VERSION);
 expect(existing).toEqual(original);
});
it('adds an opt-in box hard stop with independent algorithm, parameters and execution choices',()=>{
 render(<Editor/>);fireEvent.click(screen.getByRole('button',{name:'添加箱体终止'}));
 expect(screen.getByLabelText('启用持仓否决 3')).not.toBeChecked();
 expect(screen.getByLabelText('箱体止损 3 算法')).toBeDisabled();
 fireEvent.click(screen.getByLabelText('启用持仓否决 3'));
 fireEvent.change(screen.getByLabelText('箱体止损 3 确认方式'),{target:{value:'close-5m'}});
 fireEvent.change(screen.getByLabelText('箱体止损 3 连续确认根数'),{target:{value:'3'}});
 fireEvent.change(screen.getByLabelText('箱体止损 3 更新方式'),{target:{value:'fixed'}});
 fireEvent.change(screen.getByLabelText('箱体止损 3 算法'),{target:{value:'sbs5m'}});
 fireEvent.change(screen.getByLabelText('箱体止损 3 K基准'),{target:{value:'invalidation'}});
 fireEvent.change(screen.getByLabelText('箱体止损 3 额外冗余'),{target:{value:'1.25'}});
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const saved=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved[0]).toMatchObject({kind:'box-stop',enabled:true,boxStop:{version:'holding-box-stop-v1',confirmation:'close-5m',closes:3,update:'fixed',structure:{algorithm:'sbs5m',kBasis:'invalidation',buffer:1.25,versions:{box:'sbs-5m-v1'}}}});
 expect(parseHoldingVetoDraft(holdingVetoDraft(saved))).toEqual(saved);
});
it.each([false,true])('persists DBL-5 hard-stop line choices in the shared editor (screening=%s)',entry=>{
 const original=defaultBoxStop();
 original.structure.kSource='guard';
 const saved=parseHoldingVetoDraft([{choice:'box-stop',direction:'<=',threshold:'0',enabled:true,boxStop:original}]);
 render(<Editor entry={entry} saved={saved}/>);
 const select=screen.getByLabelText('箱体止损 1 防守线类型');
 expect(select).toHaveValue('both');
 fireEvent.change(select,{target:{value:'range'}});
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const ranged=JSON.parse(document.querySelector('output')!.textContent!);
 expect(ranged[0].boxStop).toMatchObject({version:BOX_STOP_GUARD_REGIME_VERSION,guardRegime:'range'});
 expect(parseHoldingVetoDraft(holdingVetoDraft(ranged))).toEqual(ranged);
 fireEvent.change(screen.getByLabelText('箱体止损 1 K基准'),{target:{value:'support'}});
 expect(screen.queryByLabelText('箱体止损 1 防守线类型')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 expect(JSON.parse(document.querySelector('output')!.textContent!)[0].boxStop).toMatchObject({version:'holding-box-stop-v1',structure:{kSource:'current'}});
 expect(saved[0].boxStop?.guardRegime).toBeUndefined();
});
it('offers joint addition profit rules with editable 100× / 5% defaults, and independently persists multiple rules',()=>{
 render(<Editor/>);fireEvent.click(screen.getByRole('button',{name:'添加加仓止盈约束'}));expect(screen.getByLabelText('持仓否决 3 几何仓位倍数')).toHaveValue(100);expect(screen.getByLabelText('持仓否决 3 均衡价涨幅')).toHaveValue(5);expect(screen.getByLabelText('启用持仓否决 3')).not.toBeChecked();
 fireEvent.click(screen.getByLabelText('启用持仓否决 3'));fireEvent.change(screen.getByLabelText('持仓否决 3 几何仓位倍数'),{target:{value:'125.5'}});fireEvent.change(screen.getByLabelText('持仓否决 3 均衡价涨幅'),{target:{value:'6.25'}});
 fireEvent.click(screen.getByRole('button',{name:'添加加仓止盈约束'}));fireEvent.click(screen.getByLabelText('启用持仓否决 4'));fireEvent.click(screen.getByRole('button',{name:'保存'}));const saved=JSON.parse(document.querySelector('output')!.textContent!);expect(saved).toMatchObject([{kind:'addition-geometric-profit',geometricMultiple:125.5,threshold:6.25,enabled:true},{kind:'addition-geometric-profit',geometricMultiple:100,threshold:5,enabled:true}]);expect(parseHoldingVetoDraft(holdingVetoDraft(saved))).toEqual(saved);
 expect(holdingVetoIdentity(saved)).not.toEqual(holdingVetoIdentity([{...saved[0],geometricMultiple:126},saved[1]]));
});
it('rejects empty or invalid position and gain thresholds',()=>{
 for(const geometricMultiple of ['', '0','-1','Infinity','NaN'])expect(()=>parseHoldingVetoDraft([{choice:'addition-geometric-profit',direction:'>=',threshold:'5',geometricMultiple,enabled:true}])).toThrow();
 for(const threshold of ['', '-1','Infinity'])expect(()=>parseHoldingVetoDraft([{choice:'addition-geometric-profit',direction:'>=',threshold,geometricMultiple:'100',enabled:true}])).toThrow();
});
// 【用户要求】2026-11-03 硬性终止加「盈亏比止盈」：默认 5000R，可改，单位 R
it('adds a payoff-ratio stop with a 5000R default that can be edited and saved',()=>{
 // 方案的硬性终止框默认带一条不勾选的盈亏比止盈；没勾、仍是 5000R 时不存进方案
 render(<Editor plan/>);expect(screen.getByLabelText('持仓否决 3 指标')).toHaveValue('payoff-ratio');expect(screen.getByLabelText('持仓否决 3 阈值')).toHaveValue(5000);expect(screen.getByLabelText('启用持仓否决 3')).not.toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'保存'}));expect(JSON.parse(document.querySelector('output')!.textContent!)).toEqual([]);
 fireEvent.click(screen.getByLabelText('启用持仓否决 3'));
 expect(screen.getByLabelText('持仓否决 3 方向')).toBeDisabled();
 fireEvent.change(screen.getByLabelText('持仓否决 3 阈值'),{target:{value:'3000'}});fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const saved=JSON.parse(document.querySelector('output')!.textContent!);expect(saved.find((v:{kind:string})=>v.kind==='payoff-ratio')).toMatchObject({kind:'payoff-ratio',direction:'>=',threshold:3000,enabled:true,label:'盈亏比止盈'});
 expect(holdingVetoDraft(saved).find(d=>d.choice==='payoff-ratio')).toMatchObject({threshold:'3000'});
});
