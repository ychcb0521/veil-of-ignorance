import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it } from 'vitest';
import { useState } from 'react';
import { additionDraft,parseAdditionDraft,FishQualityAdditionEditor } from '../FishQualityAdditionEditor';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
afterEach(cleanup);
function Editor(){const [draft,setDraft]=useState(()=>additionDraft());return <><FishQualityAdditionEditor draft={draft} setDraft={setDraft}/><button onClick={()=>{const r=parseAdditionDraft(draft,BUILTIN_FEATURES);document.querySelector('output')!.textContent=JSON.stringify(r)}}>验证保存</button><output/></>}
it('provides original-detector rescan and multiround calculator defaults, supports custom feature thresholds and unique equilibrium sizing',()=>{
 render(<Editor/>);expect(screen.getByLabelText('启用条件加仓')).not.toBeChecked();expect(screen.getByLabelText('加仓条件来源')).toBeDisabled();
 expect(screen.getByText(/按平衡公式自动计算/)).toBeInTheDocument();expect(screen.getByLabelText('允许多轮加仓')).toBeChecked();
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
 const d={...additionDraft(),enabled:true};expect(parseAdditionDraft(d,BUILTIN_FEATURES)).toMatchObject({quantityMode:'calculator',repeat:true});expect(parseAdditionDraft({...d,repeat:false},BUILTIN_FEATURES)).toMatchObject({quantityMode:'calculator',repeat:false});
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
