import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it } from 'vitest';
import { useState } from 'react';
import { additionDraft,parseAdditionDraft,parseAdditionSellStages,FishQualityAdditionEditor } from '../FishQualityAdditionEditor';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import { makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { defaultQualityAddition, type QualityAdditionRule } from '@/lib/fish/qualityAddition';
afterEach(cleanup);
function Editor(){const [draft,setDraft]=useState(()=>additionDraft());return <><FishQualityAdditionEditor draft={draft} setDraft={setDraft}/><button onClick={()=>{const r=parseAdditionDraft(draft,BUILTIN_FEATURES);document.querySelector('output')!.textContent=JSON.stringify(r);document.querySelector('[data-stages]')!.textContent=JSON.stringify(parseAdditionSellStages(draft,BUILTIN_FEATURES)??null)}}>验证保存</button><output/><pre data-stages/></>}
const save=()=>{fireEvent.click(screen.getByRole('button',{name:'验证保存'}));return JSON.parse(document.querySelector('output')!.textContent!);};
const tab=(n:number)=>fireEvent.click(screen.getByRole('tab',{name:`第 ${n} 次`}));
// 【用户要求】2026-11-01 位置只用箱体算法（DBL / SBS），下方一行 K = 旧C − n×ATR，n 由用户自己填（新方案先填 0）。
it('offers only the box position, with calculator defaults and K = 旧C − n×ATR',()=>{
 render(<Editor/>);expect(screen.getByLabelText('启用条件加仓')).not.toBeChecked();expect(screen.getByLabelText('加仓条件来源')).toBeDisabled();
 for(const part of ['addition-prerequisites','addition-timing','addition-sell'])expect(screen.getByTestId(part)).toBeInTheDocument();expect(screen.getAllByRole('heading',{level:5}).map(h=>h.textContent)).toEqual(['方向','位置','卖出']);expect(screen.getByLabelText('最多加仓次数')).toHaveValue(3);
 fireEvent.click(screen.getByLabelText('启用条件加仓'));
 expect([...(screen.getByLabelText('加仓条件来源') as HTMLSelectElement).options].map(o=>o.value)).toEqual(['structure']);
 for(const gone of ['加仓特征值','加仓门槛提高幅度','K回撤ATR倍数','T高于S的ATR倍数','箱体K基准','箱体冗余单位'])expect(screen.queryByLabelText(gone)).toBeNull();
 expect(screen.getByLabelText('箱体加仓算法')).toHaveValue('dbl5');expect(screen.getByLabelText('箱体加仓时机')).toHaveValue('raise');expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(0);
 expect(screen.getByTestId('addition-k-row')).toHaveTextContent(/^K =/);expect(screen.getByLabelText('K基准箱体')).toHaveValue('previous');expect(screen.getByTestId('addition-timing')).not.toHaveTextContent('K ≤');
 const rule=save();expect(rule).toMatchObject({enabled:true,quantityMode:'calculator',quantity:1,source:'structure',structure:{algorithm:'dbl5',buffer:0}});expect(rule.rounds.map((r:QualityAdditionRule)=>r.source)).toEqual(['structure','structure','structure']);
});
it('converts legacy rounds: a custom indicator moves into 方向, an original-detector round becomes a box',()=>{
 const mbi=makeQualityBuyFilter('mbi:MBI','>',.8,true,BUILTIN_FEATURES),bear=makeQualityBuyFilter('mbi-bear:MBI_bear','<',-.7,true,BUILTIN_FEATURES);
 const legacy:QualityAdditionRule={...defaultQualityAddition(),enabled:true,maxRounds:2,rounds:[{source:'custom',stricterPct:10,condition:mbi,conditions:[mbi,bear],minGainPct:5,supportOffsetAtr:2},{source:'detector',stricterPct:10}]};
 const saved=parseAdditionDraft(additionDraft(legacy),BUILTIN_FEATURES);
 expect(saved.rounds![0]).toMatchObject({source:'structure',structure:{buffer:0},minGainPct:5,prerequisites:[{metric:'MBI',direction:'>',threshold:.8},{metric:'MBI_bear',direction:'<',threshold:-.7}]});expect(saved.rounds![0].conditions).toBeUndefined();
 expect(saved.rounds![1]).toMatchObject({source:'structure'});expect(saved.rounds![1].prerequisites).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(saved),BUILTIN_FEATURES)).toEqual(saved);
});
it('persists calculator defaults and the chosen number of rounds with no cash input',()=>{
 const d={...additionDraft(),enabled:true};expect(parseAdditionDraft({...d,quantityMode:'fixed',quantity:'75'},BUILTIN_FEATURES).quantityMode).toBe('calculator');expect(parseAdditionDraft(d,BUILTIN_FEATURES)).toMatchObject({quantityMode:'calculator',repeat:true});expect(parseAdditionDraft({...d,maxRounds:'1'},BUILTIN_FEATURES)).toMatchObject({quantityMode:'calculator',repeat:false});
 render(<Editor/>);expect(screen.queryByLabelText('加仓金额')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'加仓细节说明'}));expect(screen.getByText(/首轮为镜像止盈后的剩余币数/)).toBeInTheDocument();expect(screen.getByText('Q × (K − S) + P = 新增币数 × (T − K)')).toBeInTheDocument();expect(screen.getByText(/最早从下一分钟起检查/)).toBeInTheDocument();expect(screen.getByRole('heading',{name:'加仓量（均衡公式）'})).toBeInTheDocument();
});
it('adds and removes 方向 indicators, saves gain against the latest cost line S and restores every constraint',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));
 for(const [i,feature,dir,th] of [[1,'mbi','>','.8'],[2,'mbi-bear','<','-.7']] as const){fireEvent.click(screen.getByRole('button',{name:'＋ 添加方向条件'}));fireEvent.change(screen.getByLabelText(`加仓方向条件 ${i} 特征值`),{target:{value:feature}});fireEvent.change(screen.getByLabelText(`加仓方向条件 ${i} 方向`),{target:{value:dir}});fireEvent.change(screen.getByLabelText(`加仓方向条件 ${i} 指标门槛`),{target:{value:th}});}
 fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));expect(screen.getByText(/相对最新成本线 S/)).toBeInTheDocument();expect(screen.getByLabelText('加仓涨幅门槛')).toHaveValue(5);
 const rule=save();expect(rule).toMatchObject({minGainPct:5,prerequisites:[{metric:'MBI',threshold:.8},{metric:'MBI_bear',direction:'<',threshold:-.7}]});expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);
 expect(parseAdditionDraft({...additionDraft(rule),enabled:false},BUILTIN_FEATURES).prerequisites).toEqual(rule.prerequisites);
 fireEvent.click(screen.getByLabelText('删除加仓方向条件 1'));expect(save().prerequisites).toMatchObject([{metric:'MBI_bear'}]);
 expect(()=>parseAdditionDraft({...additionDraft(rule),minGainPct:''},BUILTIN_FEATURES)).toThrow('涨幅门槛');
});
it('keeps each round’s box algorithm, trigger, n and gain gate independent, also after resizing the list',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('启用条件加仓'));fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'2'}});
 fireEvent.change(screen.getByLabelText('箱体支撑冗余'),{target:{value:'.75'}});fireEvent.click(screen.getByLabelText('启用加仓涨幅门槛'));
 tab(2);expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(0);fireEvent.change(screen.getByLabelText('K基准箱体'),{target:{value:'current'}});fireEvent.change(screen.getByLabelText('箱体加仓算法'),{target:{value:'sbs5m'}});expect(screen.getByLabelText('K基准箱体')).toHaveValue('current');fireEvent.change(screen.getByLabelText('箱体加仓时机'),{target:{value:'retest'}});fireEvent.change(screen.getByLabelText('箱体支撑冗余'),{target:{value:'.25'}});
 fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'1'}});fireEvent.change(screen.getByLabelText('最多加仓次数'),{target:{value:'3'}});
 tab(2);expect(screen.getByLabelText('箱体加仓算法')).toHaveValue('sbs5m');expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(.25);
 tab(1);expect(screen.getByLabelText('箱体加仓算法')).toHaveValue('dbl5');expect(screen.getByLabelText('箱体支撑冗余')).toHaveValue(.75);expect(screen.getByLabelText('加仓涨幅门槛')).toHaveValue(5);
 const rule=save();expect(rule.rounds).toMatchObject([{source:'structure',minGainPct:5,structure:{algorithm:'dbl5',trigger:'raise',kBasis:'support',bufferUnit:'atr',buffer:.75}},{source:'structure',structure:{algorithm:'sbs5m',trigger:'retest',buffer:.25}},{source:'structure'}]);expect(rule.rounds.map((r:QualityAdditionRule)=>r.structure?.kSource??'previous')).toEqual(['previous','current','previous']);expect(rule.rounds[1].minGainPct).toBeUndefined();
 expect(parseAdditionDraft(additionDraft(rule),BUILTIN_FEATURES)).toEqual(rule);expect(()=>parseAdditionDraft({...additionDraft(rule),maxRounds:'1.5'},BUILTIN_FEATURES)).toThrow('整数');
});
it('rejects a blank, negative or non-finite n and names the round',()=>{
 const draft={...additionDraft(),enabled:true};
 for(const value of ['', '-1','Infinity','NaN'])expect(()=>parseAdditionDraft({...draft,structureBuffer:value},BUILTIN_FEATURES)).toThrow('冗余');
 expect(()=>parseAdditionDraft({...draft,otherRounds:[{...draft.otherRounds[0],structureBuffer:'-1'},draft.otherRounds[1]]},BUILTIN_FEATURES)).toThrow('第 2 次加仓');
 const saved=parseAdditionDraft({...draft,structureBuffer:'0'},BUILTIN_FEATURES);expect(saved.structure?.buffer).toBe(0);
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

