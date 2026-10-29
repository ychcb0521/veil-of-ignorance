import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,expect,it } from 'vitest';
import { useState } from 'react';
import { additionDraft,parseAdditionDraft,FishQualityAdditionEditor } from '../FishQualityAdditionEditor';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
afterEach(cleanup);
function Editor(){const [draft,setDraft]=useState(()=>additionDraft());return <><FishQualityAdditionEditor draft={draft} setDraft={setDraft}/><button onClick={()=>{const r=parseAdditionDraft(draft,BUILTIN_FEATURES);document.querySelector('output')!.textContent=JSON.stringify(r)}}>验证保存</button><output/></>}
it('provides original-detector rescan and equal-entry defaults, supports custom feature thresholds and fixed USDT amounts',()=>{
 render(<Editor/>);expect(screen.getByLabelText('启用条件加仓')).not.toBeChecked();expect(screen.getByLabelText('加仓条件来源')).toBeDisabled();
 fireEvent.click(screen.getByLabelText('启用条件加仓'));expect(screen.getByLabelText('加仓门槛提高幅度')).toHaveValue(10);
 fireEvent.change(screen.getByLabelText('加仓条件来源'),{target:{value:'custom'}});fireEvent.change(screen.getByLabelText('加仓特征值'),{target:{value:'mbi-bear'}});
 fireEvent.change(screen.getByLabelText('加仓方向'),{target:{value:'<'}});fireEvent.change(screen.getByLabelText('加仓指标门槛'),{target:{value:'-0.7'}});
 fireEvent.change(screen.getByLabelText('加仓金额方式'),{target:{value:'fixed'}});fireEvent.change(screen.getByLabelText('加仓金额 USDT'),{target:{value:'75'}});fireEvent.click(screen.getByRole('button',{name:'验证保存'}));
 expect(JSON.parse(document.querySelector('output')!.textContent!)).toMatchObject({enabled:true,source:'custom',amountMode:'fixed',amountUsdt:75,condition:{metric:'MBI_bear',direction:'<',threshold:-.7}});
});
it('validates empty/invalid cash amounts and custom thresholds before applying',()=>{
 const d={...additionDraft(),enabled:true,amountMode:'fixed' as const,amountUsdt:''};expect(()=>parseAdditionDraft(d,BUILTIN_FEATURES)).toThrow('加仓金额');
 expect(()=>parseAdditionDraft({...d,amountUsdt:'100',source:'custom',choice:'mbi:MBI',threshold:''},BUILTIN_FEATURES)).toThrow('有限数字');
});

it('retains a configured custom condition when the module is disabled',()=>{
 const rule=parseAdditionDraft({...additionDraft(),enabled:true,source:'custom',choice:'mbi:MBI',threshold:'.8'},BUILTIN_FEATURES);
 const saved=parseAdditionDraft({...additionDraft(rule),enabled:false},BUILTIN_FEATURES);
 expect(saved.condition).toEqual(rule.condition);expect(saved.enabled).toBe(false);
});
