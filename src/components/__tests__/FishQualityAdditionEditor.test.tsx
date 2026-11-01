import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it } from 'vitest';
import { useState } from 'react';
import { additionDraft,parseAdditionDraft,parseAdditionSellStages,FishQualityAdditionEditor } from '../FishQualityAdditionEditor';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
afterEach(cleanup);
function Editor(){const [draft,setDraft]=useState(()=>additionDraft());return <><FishQualityAdditionEditor draft={draft} setDraft={setDraft}/><button onClick={()=>{const r=parseAdditionDraft(draft,BUILTIN_FEATURES);document.querySelector('output')!.textContent=JSON.stringify(r);document.querySelector('[data-stages]')!.textContent=JSON.stringify(parseAdditionSellStages(draft,BUILTIN_FEATURES)??null)}}>验证保存</button><output/><pre data-stages/></>}
it('provides original-detector rescan and multiround calculator defaults, supports custom feature thresholds and unique equilibrium sizing',()=>{
 render(<Editor/>);expect(screen.getByLabelText('启用条件加仓')).not.toBeChecked();expect(screen.getByLabelText('加仓条件来源')).toBeDisabled();
 for(const part of ['addition-prerequisites','addition-timing','addition-sell'])expect(screen.getByTestId(part)).toBeInTheDocument();expect(screen.getAllByRole('heading',{level:5}).map(h=>h.textContent)).toEqual(['方向','位置','卖出']);expect(screen.getByLabelText('最多加仓次数')).toHaveValue(3);
 fireEvent.click(screen.getByLabelText('启用条件加仓'));expect(screen.getByLabelText('加仓门槛提高幅度')).toHaveValue(10);
 fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'custom'}});fireEvent.change(screen.getByLabelText('加仓特征值'),{target:{value:'mbi-bear'}});
 fireEvent.change(screen.getByLabelText('加仓方向'),{target:{value:'<'}});fireEvent.change(screen.getByLabelText('加仓指标门槛'),{target:{value:'-0.7'}});
 fireEvent.click(screen.getByRole('button',{name:'验证保存'}));
 expect(JSON.parse(document.querySelector('output')!.textContent!)).toMatchObject({enabled:true,source:'custom',quantityMode:'calculator',quantity:1,condition:{metric:'MBI_bear',direction:'<',threshold:-.7}});
});
it('validates empty/invalid coin quantities and custom thresholds before applying',()=>{
 const d={...additionDraft(),enabled:true};expect(parseAdditionDraft({...d,quantityMode:'fixed',quantity:'75'},BUILTIN_FEATURES).quantityMode).toBe('calculator');
 expect(()=>parseAdditionDraft({...d,quantity:'100',source:'custom',choice:'mbi:MBI',threshold:''},BUILTIN_FEATURES)).toThrow('有限数字');
});

it('retains a configured custom condition when the module is disabled',()=>{
 const rule=parseAdditionDraft({...additionDraft(),enabled:true,source:'custom',choice:'mbi:MBI',threshold:'.8'},BUILTIN_FEATURES);
 const saved=parseAdditionDraft({...additionDraft(rule),enabled:false},BUILTIN_FEATURES);
 expect(saved.condition).toEqual(rule.condition);expect(saved.enabled).toBe(false);
});

it('persists calculator defaults and the chosen number of rounds with no cash input',()=>{
 const d={...additionDraft(),enabled:true};expect(parseAdditionDraft(d,BUILTIN_FEATURES)).toMatchObject({quantityMode:'calculator',repeat:true});expect(parseAdditionDraft({...d,maxRounds:'1'},BUILTIN_FEATURES)).toMatchObject({quantityMode:'calculator',repeat:false});
 render(<Editor/>);expect(screen.queryByLabelText('加仓金额')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'加仓细节说明'}));expect(screen.getByText(/首轮为半仓镜像后的剩余币数/)).toBeInTheDocument();expect(screen.getByText('Q × (K − S) + P = 新增币数 × (T − K)')).toBeInTheDocument();expect(screen.getByText(/最早从下一分钟起检查/)).toBeInTheDocument();expect(screen.getByRole('heading',{name:'加仓量（均衡公式）'})).toBeInTheDocument();
});
it('adds and removes conjunctive indicators, saves gain against current holding average and restores every constraint',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'custom'}});
 fireEvent.change(screen.getByLabelText('加仓特征值'),{target:{value:'mbi'}});fireEvent.change(screen.getByLabelText('加仓指标门槛'),{target:{value:'.8'}});
 fireEvent.click(screen.getByRole('button',{name:'＋ 添加方向条件'}));fireEvent.change(screen.getByLabelText('加仓方向条件 1 特征值'),{target:{value:'mbi-bear'}});fireEvent.change(screen.getByLabelText('加仓方向条件 1 方向'),{target:{value:'<'}});fireEvent.change(screen.getByLabelText('加仓方向条件 1 指标门槛'),{target:{value:'-.7'}});
 fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));expect(screen.getByText(/相对当前持仓均价/)).toBeInTheDocument();expect(screen.getByLabelText('加仓涨幅门槛')).toHaveValue(5);fireEvent.click(screen.getByRole('button',{name:'验证保存'}));
 const rule=JSON.parse(document.querySelector('output')!.textContent!);expect(rule).toMatchObject({minGainPct:5,conditions:[{metric:'MBI',threshold:.8},{metric:'MBI_bear',direction:'<',threshold:-.7}]});expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
 expect(parseAdditionDraft({...additionDraft(rule),enabled:false},BUILTIN_FEATURES).conditions).toEqual(rule.conditions);
 fireEvent.click(screen.getByLabelText('删除加仓方向条件 1'));fireEvent.click(screen.getByRole('button',{name:'验证保存'}));expect(JSON.parse(document.querySelector('output')!.textContent!)).toMatchObject({minGainPct:5});expect(JSON.parse(document.querySelector('output')!.textContent!).conditions).toBeUndefined();
 expect(()=>parseAdditionDraft({...additionDraft(rule),minGainPct:''},BUILTIN_FEATURES)).toThrow('涨幅门槛');
});
it('saves independent source, thresholds and gain gates for each selected addition round',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('加仓门槛提高幅度'),{target:{value:'12'}});fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));fireEvent.change(screen.getByLabelText('加仓涨幅门槛'),{target:{value:'5'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'custom'}});fireEvent.change(screen.getByLabelText('加仓特征值'),{target:{value:'mbi'}});fireEvent.change(screen.getByLabelText('加仓指标门槛'),{target:{value:'.9'}});fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));fireEvent.change(screen.getByLabelText('加仓涨幅门槛'),{target:{value:'10'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 1 次'}));expect(screen.getByLabelText('加仓条件来源')).toHaveValue('detector');expect(screen.getByLabelText('加仓门槛提高幅度')).toHaveValue(12);expect(screen.getByLabelText('加仓涨幅门槛')).toHaveValue(5);fireEvent.click(screen.getByRole('button',{name:'验证保存'}));
 const rule=JSON.parse(document.querySelector('output')!.textContent!);expect(rule).toMatchObject({maxRounds:2,rounds:[{source:'detector',stricterPct:12,minGainPct:5},{source:'custom',condition:{threshold:.9},minGainPct:10}]});expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);expect(()=>parseAdditionDraft({...additionDraft(rule),maxRounds:'1.5'},BUILTIN_FEATURES)).toThrow('整数');
});

it('edits the K multiplier independently (entry distance removed 2026-11-01) per round and restores them after saving or resizing the list',()=>{
 render(<Editor/>);expect(screen.queryByLabelText('T高于S的ATR倍数')).toBeNull();expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(1.5);expect(screen.getByLabelText('K回撤ATR倍数')).toBeDisabled();
 fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'2'}});
 fireEvent.change(screen.getByLabelText('K回撤ATR倍数'),{target:{value:'1.75'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(1.5);
 fireEvent.change(screen.getByLabelText('K回撤ATR倍数'),{target:{value:'2.5'}});
 fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'1'}});fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'4'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(2.5);
 fireEvent.click(screen.getByRole('tab',{name:'第 4 次'}));expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(1.75);
 fireEvent.click(screen.getByRole('tab',{name:'第 1 次'}));expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(1.75);
 fireEvent.click(screen.getByRole('button',{name:'验证保存'}));const rule=JSON.parse(document.querySelector('output')!.textContent!);
 expect(rule.rounds).toMatchObject([{supportOffsetAtr:1.75},{supportOffsetAtr:2.5},{supportOffsetAtr:1.5},{supportOffsetAtr:1.75}]);expect(rule.rounds.some((r:{entryBufferAtr?:number})=>'entryBufferAtr' in r)).toBe(false);expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
});
it('rejects missing, negative or non-finite formula distances, and a zero support offset',()=>{
 const draft={...additionDraft(),enabled:true};
 for(const value of ['', '-1','Infinity','NaN']){
  expect(()=>parseAdditionDraft({...draft,supportOffsetAtr:value},BUILTIN_FEATURES)).toThrow('K 回撤');
 }
 expect(()=>parseAdditionDraft({...draft,supportOffsetAtr:'0'},BUILTIN_FEATURES)).toThrow('K 回撤');
 expect(()=>parseAdditionDraft({...draft,otherRounds:[{...draft.otherRounds[0],supportOffsetAtr:'0'},draft.otherRounds[1]]},BUILTIN_FEATURES)).toThrow('第 2 次加仓');
 expect(()=>parseAdditionDraft({...draft,supportOffsetAtr:'.5'},BUILTIN_FEATURES)).not.toThrow();
});

// 【用户要求】2026-11-01 位置只有算法 + 一行「K ≤ 旧C − n×ATR」：新 C 产生即加仓，K 取上一箱体的旧 C（不用 S，免得和成本线混淆），n 存为箱体冗余（单位 ATR，默认 0）。
it('offers native box timing and K ≤ 旧C − n×ATR with an independent saved choice for each round',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'structure'}});
 expect(screen.getByLabelText('箱体加仓算法')).toHaveValue('dbl5');expect(screen.getByLabelText('箱体加仓时机')).toHaveValue('raise');expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(0);expect(screen.queryByLabelText('K回撤ATR倍数')).not.toBeInTheDocument();
 expect(screen.getByTestId('addition-timing')).toHaveTextContent('K ≤ 旧C −');expect(screen.getByTestId('addition-timing')).not.toHaveTextContent('K ≤ S');expect(screen.queryByLabelText('箱体K基准')).toBeNull();expect(screen.queryByLabelText('箱体冗余单位')).toBeNull();
 fireEvent.change(screen.getByLabelText('箱体支撑冗余'),{target:{value:'.75'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'structure'}});fireEvent.change(screen.getByLabelText('箱体加仓算法'),{target:{value:'sbs5m'}});fireEvent.change(screen.getByLabelText('箱体加仓时机'),{target:{value:'retest'}});fireEvent.change(screen.getByLabelText('箱体支撑冗余'),{target:{value:'.25'}});
 fireEvent.click(screen.getByRole('button',{name:'验证保存'}));const saved=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved.rounds).toMatchObject([{source:'structure',structure:{algorithm:'dbl5',trigger:'raise',kBasis:'support',bufferUnit:'atr',buffer:.75}},{source:'structure',structure:{algorithm:'sbs5m',trigger:'retest',kBasis:'support',bufferUnit:'atr',buffer:.25}},{source:'detector'}]);
 expect(parseAdditionDraft(additionDraft(saved),BUILTIN_FEATURES)).toEqual(saved);
 fireEvent.click(screen.getByRole('tab',{name:'第 1 次'}));expect(screen.getByLabelText('箱体加仓算法')).toHaveValue('dbl5');expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(.75);
});
it('does not reinterpret legacy ATR saves and rejects blank box redundancy',()=>{
 const d=additionDraft();const old=parseAdditionDraft({...d,enabled:true},BUILTIN_FEATURES);expect(old.structure).toBeUndefined();
 expect(()=>parseAdditionDraft({...d,enabled:true,source:'structure',structureBuffer:''},BUILTIN_FEATURES)).toThrow('冗余');
 const saved=parseAdditionDraft({...d,enabled:true,source:'structure',structureBuffer:'0'},BUILTIN_FEATURES);expect(saved.structure?.buffer).toBe(0);
 expect(parseAdditionDraft({...additionDraft(saved),enabled:false},BUILTIN_FEATURES).structure).toEqual(saved.structure);
});
it('box position with 方向 conditions saves them as prerequisites of that round only, and restores them',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'2'}});
 fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'structure'}});fireEvent.click(screen.getByRole('button',{name:'＋ 添加方向条件'}));
 fireEvent.change(screen.getByLabelText('加仓方向条件 1 特征值'),{target:{value:'mbi'}});fireEvent.change(screen.getByLabelText('加仓方向条件 1 指标门槛'),{target:{value:'.6'}});
 fireEvent.click(screen.getByRole('button',{name:'验证保存'}));
 const rule=JSON.parse(document.querySelector('output')!.textContent!);
 expect(rule.rounds[0]).toMatchObject({source:'structure',prerequisites:[{metric:'MBI',direction:'>',threshold:.6}]});expect(rule.rounds[0].conditions).toBeUndefined();expect(rule.rounds[1].prerequisites).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
});
it('sets an independent seller for each addition round and keeps switches beyond the round limit',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'2'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));fireEvent.click(screen.getByLabelText('第 2 次加仓后改用卖出算法'));
 fireEvent.change(screen.getByLabelText('第 2 次加仓后卖出 特征值'),{target:{value:'cda'}});fireEvent.change(screen.getByLabelText('第 2 次加仓后卖出 方向'),{target:{value:'<'}});fireEvent.change(screen.getByLabelText('第 2 次加仓后卖出 指标门槛'),{target:{value:'.5'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 1 次'}));expect(screen.getByLabelText('第 1 次加仓后改用卖出算法')).not.toBeChecked();
 fireEvent.click(screen.getByRole('button',{name:'验证保存'}));
 const stages=JSON.parse(document.querySelector('[data-stages]')!.textContent!),rule=JSON.parse(document.querySelector('output')!.textContent!);
 expect(stages).toHaveLength(1);expect(stages[0]).toMatchObject({afterAdditions:2,snapshot:{featureId:'cda'},rule:{direction:'<',threshold:.5}});
 const restored=additionDraft(rule,stages);expect(restored.otherRounds[0].sellSwitch).toMatchObject({enabled:true,threshold:'.5'.replace('.','0.')});expect(parseAdditionSellStages(restored,BUILTIN_FEATURES)).toEqual(stages);
 const later={...stages[0],afterAdditions:6},kept=additionDraft(rule,[...stages,later]);expect(kept.laterSellStages).toEqual([later]);expect(parseAdditionSellStages(kept,BUILTIN_FEATURES)).toEqual([...stages,later]);
 expect(()=>parseAdditionSellStages({...restored,otherRounds:[{...restored.otherRounds[0],sellSwitch:{...restored.otherRounds[0].sellSwitch,threshold:''}}]},BUILTIN_FEATURES)).toThrow('第 2 次加仓');
});

