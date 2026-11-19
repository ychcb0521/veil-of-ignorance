import {useState} from 'react';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {FishQualityHoldingVetoEditor} from '../FishQualityHoldingVetoEditor';
import {holdingVetoDraft,parseHoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {BOX_SECOND_BREAK_CHOICE,BOX_SECOND_BREAK_VERSION,defaultBoxBreak} from '@/lib/fish/qualityBoxStop';
import {DBL5_RETEST_GUARD_VERSION} from '@/lib/dbl5m';
import type {QualityHoldingVeto} from '@/lib/fish/qualityVeto';
afterEach(cleanup);
function Editor({entry=false,saved=[]}:{entry?:boolean;saved?:QualityHoldingVeto[]}={}){
 const [draft,setDraft]=useState(()=>holdingVetoDraft(saved));
 return <><FishQualityHoldingVetoEditor entry={entry} draft={draft} setDraft={setDraft}/><button onClick={()=>{document.querySelector('output')!.textContent=JSON.stringify(parseHoldingVetoDraft(draft));}}>保存</button><output/></>;
}
it('adds, edits, saves and restores the opt-in second-break rule independently of the original',()=>{
 const existing=parseHoldingVetoDraft([{choice:'box-support-break',direction:'<=',threshold:'0',enabled:true,boxStop:defaultBoxBreak()}]);
 const snapshot=JSON.stringify(existing),view=render(<Editor saved={existing}/>);
 fireEvent.click(screen.getByRole('button',{name:'添加二次断裂终止'}));
 expect(screen.getByLabelText('启用持仓否决 2')).not.toBeChecked();
 expect(screen.getByLabelText('持仓否决 2 指标')).toHaveValue(BOX_SECOND_BREAK_CHOICE);
 fireEvent.click(screen.getByLabelText('启用持仓否决 2'));
 expect(screen.getByLabelText('箱体止损 2 防守线版本')).toHaveValue(DBL5_RETEST_GUARD_VERSION);
 expect(screen.queryByLabelText('箱体止损 2 更新方式')).toBeNull();
 fireEvent.change(screen.getByLabelText('箱体止损 2 算法'),{target:{value:'1h'}});
 fireEvent.change(screen.getByLabelText('箱体止损 2 防守线震荡断线根数'),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const saved:QualityHoldingVeto[]=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved[0]).toEqual(existing[0]);
 expect(saved[1]).toMatchObject({enabled:true,boxStop:{version:BOX_SECOND_BREAK_VERSION,structure:{definition:{interval:'1h',DBL5_config:{guard_range_closes:3}}}}});
 expect(parseHoldingVetoDraft(holdingVetoDraft(saved))).toEqual(saved);
 view.unmount();render(<Editor saved={saved}/>);
 expect(screen.getByLabelText('启用持仓否决 2')).toBeChecked();
 expect(screen.getByLabelText('箱体止损 2 算法')).toHaveValue('1h');
 expect(screen.getByLabelText('箱体止损 2 防守线震荡断线根数')).toHaveValue(3);
 expect(JSON.stringify(existing)).toBe(snapshot);
});
it('offers the new choice in the dropdown and prevents enabling it in pre-entry screening',()=>{
 const view=render(<Editor/>);
 fireEvent.change(screen.getByLabelText('持仓否决 1 指标'),{target:{value:BOX_SECOND_BREAK_CHOICE}});
 fireEvent.click(screen.getByLabelText('启用持仓否决 1'));
 expect(screen.getByText(/本笔持仓的主分支、备选分支/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 expect(JSON.parse(document.querySelector('output')!.textContent!)[0].boxStop.version).toBe(BOX_SECOND_BREAK_VERSION);
 view.unmount();render(<Editor entry/>);
 expect(screen.getByRole('button',{name:'添加二次断裂终止'})).toBeDisabled();
 expect(screen.getAllByRole('option',{name:'首次断裂停加仓，二次断裂终止（仅适用持仓）'}).every(o=>(o as HTMLOptionElement).disabled)).toBe(true);
});
