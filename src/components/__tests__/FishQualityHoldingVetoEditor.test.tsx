import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {FishQualityHoldingVetoEditor} from '../FishQualityHoldingVetoEditor';
import {holdingVetoDraft,parseHoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {holdingVetoIdentity} from '@/lib/fish/qualityVeto';
afterEach(cleanup);
function Editor(){const [draft,setDraft]=useState(holdingVetoDraft());return <><FishQualityHoldingVetoEditor draft={draft} setDraft={setDraft}/><button onClick={()=>{document.querySelector('output')!.textContent=JSON.stringify(parseHoldingVetoDraft(draft));}}>保存</button><output/></>}
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
