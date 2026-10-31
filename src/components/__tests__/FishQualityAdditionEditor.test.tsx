import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it } from 'vitest';
import { useState } from 'react';
import { additionDraft,parseAdditionDraft,FishQualityAdditionEditor } from '../FishQualityAdditionEditor';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
afterEach(cleanup);
function Editor(){const [draft,setDraft]=useState(()=>additionDraft());return <><FishQualityAdditionEditor draft={draft} setDraft={setDraft}/><button onClick={()=>{const r=parseAdditionDraft(draft,BUILTIN_FEATURES);document.querySelector('output')!.textContent=JSON.stringify(r)}}>验证保存</button><output/></>}
it('provides original-detector rescan and multiround calculator defaults, supports custom feature thresholds and unique equilibrium sizing',()=>{
 render(<Editor/>);expect(screen.getByLabelText('启用条件加仓')).not.toBeChecked();expect(screen.getByLabelText('加仓条件来源')).toBeDisabled();
 expect(screen.getByText(/按平衡公式自动计算/)).toBeInTheDocument();expect(screen.getByLabelText('最多加仓次数')).toHaveValue(3);
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
 render(<Editor/>);expect(screen.queryByLabelText('加仓金额')).not.toBeInTheDocument();expect(screen.getByText(/首轮成本线 S/)).toHaveTextContent('首轮计算基准 Q 为镜像后的剩余币数');expect(screen.getByText(/首轮成本线 S/)).toHaveTextContent('最早从下一分钟起检查条件');
});
it('adds and removes conjunctive indicators, saves gain against current holding average and restores every constraint',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'custom'}});
 fireEvent.change(screen.getByLabelText('加仓特征值'),{target:{value:'mbi'}});fireEvent.change(screen.getByLabelText('加仓指标门槛'),{target:{value:'.8'}});
 fireEvent.click(screen.getByRole('button',{name:'＋ 添加指标条件'}));fireEvent.change(screen.getByLabelText('加仓特征值 2'),{target:{value:'mbi-bear'}});fireEvent.change(screen.getByLabelText('加仓方向 2'),{target:{value:'<'}});fireEvent.change(screen.getByLabelText('加仓指标门槛 2'),{target:{value:'-.7'}});
 fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));expect(screen.getByText('相对当前持仓均价')).toBeInTheDocument();expect(screen.getByLabelText('加仓涨幅门槛')).toHaveValue(5);fireEvent.click(screen.getByRole('button',{name:'验证保存'}));
 const rule=JSON.parse(document.querySelector('output')!.textContent!);expect(rule).toMatchObject({minGainPct:5,conditions:[{metric:'MBI',threshold:.8},{metric:'MBI_bear',direction:'<',threshold:-.7}]});expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
 expect(parseAdditionDraft({...additionDraft(rule),enabled:false},BUILTIN_FEATURES).conditions).toEqual(rule.conditions);
 fireEvent.click(screen.getByLabelText('删除加仓指标 2'));fireEvent.click(screen.getByRole('button',{name:'验证保存'}));expect(JSON.parse(document.querySelector('output')!.textContent!)).toMatchObject({minGainPct:5});expect(JSON.parse(document.querySelector('output')!.textContent!).conditions).toBeUndefined();
 expect(()=>parseAdditionDraft({...additionDraft(rule),minGainPct:''},BUILTIN_FEATURES)).toThrow('涨幅门槛');
});
it('saves independent source, thresholds and gain gates for each selected addition round',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('加仓门槛提高幅度'),{target:{value:'12'}});fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));fireEvent.change(screen.getByLabelText('加仓涨幅门槛'),{target:{value:'5'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'custom'}});fireEvent.change(screen.getByLabelText('加仓特征值'),{target:{value:'mbi'}});fireEvent.change(screen.getByLabelText('加仓指标门槛'),{target:{value:'.9'}});fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));fireEvent.change(screen.getByLabelText('加仓涨幅门槛'),{target:{value:'10'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 1 次'}));expect(screen.getByLabelText('加仓条件来源')).toHaveValue('detector');expect(screen.getByLabelText('加仓门槛提高幅度')).toHaveValue(12);expect(screen.getByLabelText('加仓涨幅门槛')).toHaveValue(5);fireEvent.click(screen.getByRole('button',{name:'验证保存'}));
 const rule=JSON.parse(document.querySelector('output')!.textContent!);expect(rule).toMatchObject({maxRounds:2,rounds:[{source:'detector',stricterPct:12,minGainPct:5},{source:'custom',condition:{threshold:.9},minGainPct:10}]});expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);expect(()=>parseAdditionDraft({...additionDraft(rule),maxRounds:'1.5'},BUILTIN_FEATURES)).toThrow('整数');
});

it('edits both formula multipliers independently per round and restores them after saving or resizing the list',()=>{
 render(<Editor/>);expect(screen.getByLabelText('T高于S的ATR倍数')).toHaveValue(2);expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(1.5);expect(screen.getByLabelText('K回撤ATR倍数')).toBeDisabled();
 fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'2'}});
 fireEvent.change(screen.getByLabelText('T高于S的ATR倍数'),{target:{value:'3.25'}});fireEvent.change(screen.getByLabelText('K回撤ATR倍数'),{target:{value:'1.75'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));expect(screen.getByLabelText('T高于S的ATR倍数')).toHaveValue(2);expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(1.5);
 fireEvent.change(screen.getByLabelText('T高于S的ATR倍数'),{target:{value:'4'}});fireEvent.change(screen.getByLabelText('K回撤ATR倍数'),{target:{value:'2.5'}});
 fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'1'}});fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'4'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));expect(screen.getByLabelText('T高于S的ATR倍数')).toHaveValue(4);expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(2.5);
 fireEvent.click(screen.getByRole('tab',{name:'第 4 次'}));expect(screen.getByLabelText('T高于S的ATR倍数')).toHaveValue(3.25);expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(1.75);
 fireEvent.click(screen.getByRole('tab',{name:'第 1 次'}));expect(screen.getByLabelText('T高于S的ATR倍数')).toHaveValue(3.25);expect(screen.getByLabelText('K回撤ATR倍数')).toHaveValue(1.75);
 fireEvent.click(screen.getByRole('button',{name:'验证保存'}));const rule=JSON.parse(document.querySelector('output')!.textContent!);
 expect(rule.rounds).toMatchObject([{entryBufferAtr:3.25,supportOffsetAtr:1.75},{entryBufferAtr:4,supportOffsetAtr:2.5},{entryBufferAtr:2,supportOffsetAtr:1.5},{entryBufferAtr:3.25,supportOffsetAtr:1.75}]);expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
});
it('rejects missing, negative or non-finite formula distances, and a zero support offset',()=>{
 const draft={...additionDraft(),enabled:true};
 for(const value of ['', '-1','Infinity','NaN']){
  expect(()=>parseAdditionDraft({...draft,entryBufferAtr:value},BUILTIN_FEATURES)).toThrow('T 高于 S');
  expect(()=>parseAdditionDraft({...draft,supportOffsetAtr:value},BUILTIN_FEATURES)).toThrow('K 回撤');
 }
 expect(()=>parseAdditionDraft({...draft,supportOffsetAtr:'0'},BUILTIN_FEATURES)).toThrow('K 回撤');
 expect(()=>parseAdditionDraft({...draft,otherRounds:[{...draft.otherRounds[0],supportOffsetAtr:'0'},draft.otherRounds[1]]},BUILTIN_FEATURES)).toThrow('第 2 次加仓');
 expect(()=>parseAdditionDraft({...draft,entryBufferAtr:'0',supportOffsetAtr:'.5'},BUILTIN_FEATURES)).not.toThrow();
});

it('offers native box timing and K redundancy with an independent saved choice for each round',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'structure'}});
 expect(screen.getByLabelText('箱体加仓算法')).toHaveValue('dbl5');expect(screen.getByLabelText('箱体加仓时机')).toHaveValue('raise');expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(.5);expect(screen.queryByLabelText('K回撤ATR倍数')).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('箱体支撑冗余'),{target:{value:'.75'}});fireEvent.change(screen.getByLabelText('箱体冗余单位'),{target:{value:'percent'}});
 fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'structure'}});fireEvent.change(screen.getByLabelText('箱体加仓算法'),{target:{value:'sbs5m'}});fireEvent.change(screen.getByLabelText('箱体加仓时机'),{target:{value:'retest'}});fireEvent.change(screen.getByLabelText('箱体K基准'),{target:{value:'invalidation'}});fireEvent.change(screen.getByLabelText('箱体支撑冗余'),{target:{value:'.25'}});
 fireEvent.click(screen.getByRole('button',{name:'验证保存'}));const saved=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved.rounds).toMatchObject([{source:'structure',structure:{algorithm:'dbl5',trigger:'raise',bufferUnit:'percent',buffer:.75}},{source:'structure',structure:{algorithm:'sbs5m',trigger:'retest',kBasis:'invalidation',bufferUnit:'atr',buffer:.25}},{source:'detector'}]);
 expect(parseAdditionDraft(additionDraft(saved),BUILTIN_FEATURES)).toEqual(saved);
 fireEvent.click(screen.getByRole('tab',{name:'第 1 次'}));expect(screen.getByLabelText('箱体加仓算法')).toHaveValue('dbl5');expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(.75);
});
it('does not reinterpret legacy ATR saves and rejects blank box redundancy',()=>{
 const d=additionDraft();const old=parseAdditionDraft({...d,enabled:true},BUILTIN_FEATURES);expect(old.structure).toBeUndefined();
 expect(()=>parseAdditionDraft({...d,enabled:true,source:'structure',structureBuffer:''},BUILTIN_FEATURES)).toThrow('冗余');
 const saved=parseAdditionDraft({...d,enabled:true,source:'structure',structureBuffer:'0'},BUILTIN_FEATURES);expect(saved.structure?.buffer).toBe(0);
 expect(parseAdditionDraft({...additionDraft(saved),enabled:false},BUILTIN_FEATURES).structure).toEqual(saved.structure);
});
