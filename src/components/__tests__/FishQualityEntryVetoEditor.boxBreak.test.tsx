import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,afterEach,expect} from 'vitest';
import {FishQualityEntryVetoEditor} from '../FishQualityEntryVetoEditor';
import {vetoDraftOf,parseAdditionVetoDraft} from '@/lib/fish/qualityEntryVetoDraft';
import {defaultBoxBreakVeto,BOX_BREAK_VETO_VERSION,guardDistanceConfig,type QualityAdditionEntryVeto} from '@/lib/fish/qualityAdditionVeto';
import {DBL5_RETEST_GUARD_VERSION} from '@/lib/dbl5m';
afterEach(cleanup);
function Editor({entry=false,saved=[]}:{entry?:boolean;saved?:QualityAdditionEntryVeto[]}={}){
 const [draft,setDraft]=useState(()=>vetoDraftOf(saved));
 return <><FishQualityEntryVetoEditor entry={entry} draft={draft} setDraft={setDraft}/><button onClick={()=>{document.querySelector('output')!.textContent=JSON.stringify(parseAdditionVetoDraft(draft));}}>保存</button><output/></>;
}
it.each([false,true])('independently edits, saves and restores native box-break veto parameters (screening=%s)',entry=>{
 const saved:QualityAdditionEntryVeto[]=[{kind:'guard-distance',enabled:true,atr:4,guardDistance:guardDistanceConfig()}],before=JSON.stringify(saved);
 const view=render(<Editor entry={entry} saved={saved}/>);
 const label=entry?'筛选期间箱体断裂':'持仓期间箱体断裂',enable='启用'+(entry?'入选前':'加仓')+'否决 '+label;
 expect(screen.getByLabelText(enable)).not.toBeChecked();
 fireEvent.click(screen.getByLabelText(enable));
 expect(screen.getByLabelText(label+' 防守线版本')).toHaveValue(DBL5_RETEST_GUARD_VERSION);
 expect(screen.queryByLabelText(label+' 扫描范围')).toBeNull();
 expect(screen.queryByLabelText(label+' 更新方式')).toBeNull();
 fireEvent.change(screen.getByLabelText(label+' 算法'),{target:{value:'1h'}});
 fireEvent.change(screen.getByLabelText(label+' 防守线震荡断线根数'),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const restored:QualityAdditionEntryVeto[]=JSON.parse(document.querySelector('output')!.textContent!);
 expect(restored.find(v=>v.kind==='guard-distance')).toEqual(saved[0]);
 expect(restored.find(v=>v.kind==='box-break')).toMatchObject({enabled:true,boxBreak:{version:BOX_BREAK_VETO_VERSION,rule:{structure:{definition:{interval:'1h',DBL5_config:{guard_range_closes:3}}}}}});
 expect(parseAdditionVetoDraft(vetoDraftOf(restored))).toEqual(restored);
 view.unmount();render(<Editor entry={entry} saved={restored}/>);
 expect(screen.getByLabelText(enable)).toBeChecked();
 expect(screen.getByLabelText(label+' 算法')).toHaveValue('1h');
 expect(screen.getByLabelText(label+' 防守线震荡断线根数')).toHaveValue(3);
 expect(JSON.stringify(saved)).toBe(before);
});
it('leaves existing disabled defaults and a different instance unchanged',()=>{
 const frozen=[{kind:'box-break' as const,enabled:true,boxBreak:defaultBoxBreakVeto()}],copy=structuredClone(frozen);
 const view=render(<Editor saved={frozen}/>);
 fireEvent.change(screen.getByLabelText('持仓期间箱体断裂 防守线震荡断线根数'),{target:{value:'4'}});
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 expect(frozen).toEqual(copy);
 view.unmount();render(<Editor saved={copy}/>);
 expect(screen.getByLabelText('持仓期间箱体断裂 防守线震荡断线根数')).toHaveValue(copy[0].boxBreak.rule.structure.definition.DBL5_config!.guard_range_closes!);
});
