import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {FishQualityHoldingVetoEditor} from '../FishQualityHoldingVetoEditor';
import {defaultBoxStop,type BoxStopRule} from '@/lib/fish/qualityBoxStop';
import {BOX_STOP_REFERENCE_LABELS,BOX_STOP_REFERENCE_VERSION,type BoxStopReferenceKind} from '@/lib/fish/qualityBoxReference';
import {holdingVetoDraft,parseHoldingVetoDraft} from '@/lib/fish/qualityFilters';
import type {QualityHoldingVeto} from '@/lib/fish/qualityVeto';
afterEach(cleanup);
const initial=()=>{const r=defaultBoxStop();r.structure.buffer=.75;return r;};
const veto=(r:BoxStopRule):QualityHoldingVeto=>({id:'original',kind:'box-stop',enabled:true,label:'原始K',direction:'<=',threshold:0,boxStop:r});
function Editor({entry=false,saved=initial()}:{entry?:boolean;saved?:BoxStopRule}={}){
 const [draft,setDraft]=useState(()=>holdingVetoDraft([veto(saved)]));
 return <><FishQualityHoldingVetoEditor entry={entry} draft={draft} setDraft={setDraft}/><button onClick={()=>{document.querySelector('output')!.textContent=JSON.stringify(parseHoldingVetoDraft(draft));}}>保存</button><output/></>;
}
it.each([false,true])('adds real reference choices, saves and reopens each independently (screening=%s)',entry=>{
 for(const kind of Object.keys(BOX_STOP_REFERENCE_LABELS) as BoxStopReferenceKind[]){
  const source=initial(),before=JSON.stringify(source),view=render(<Editor entry={entry} saved={source}/>);
  const select=screen.getByLabelText('箱体止损 1 K基准');
  expect(Array.from((select as HTMLSelectElement).options).map(o=>o.textContent)).toEqual(expect.arrayContaining(Object.values(BOX_STOP_REFERENCE_LABELS)));
  fireEvent.change(select,{target:{value:kind}});
  expect(screen.getByLabelText('箱体止损 1 算法')).toBeDisabled();
  expect(screen.getByLabelText('箱体止损 1 额外冗余')).toHaveValue(.75);
  fireEvent.change(screen.getByLabelText('箱体止损 1 更新方式'),{target:{value:'fixed'}});
  fireEvent.change(screen.getByLabelText('箱体止损 1 确认方式'),{target:{value:'close-1m'}});
  fireEvent.change(screen.getByLabelText('箱体止损 1 连续确认根数'),{target:{value:'2'}});
  if(kind!=='impulse0'){
   fireEvent.change(screen.getByLabelText('箱体止损 1 急拉线原生冗余 ATR'),{target:{value:'0.123456789012345'}});
   expect(screen.getByLabelText('箱体止损 1 急拉线原生冗余 ATR').style.flexShrink).toBe('0');
   expect(screen.queryByLabelText('箱体止损 1 防守线类型')).toBeNull();
  }
  fireEvent.click(screen.getByRole('button',{name:'保存'}));
  const saved:QualityHoldingVeto[]=JSON.parse(document.querySelector('output')!.textContent!);
  expect(saved[0].boxStop).toMatchObject({version:BOX_STOP_REFERENCE_VERSION,reference:{kind},update:'fixed',confirmation:'close-1m',closes:2,structure:{buffer:.75}});
  expect(saved[0].label).toContain(BOX_STOP_REFERENCE_LABELS[kind]);
  expect(parseHoldingVetoDraft(holdingVetoDraft(saved))).toEqual(saved);
  expect(JSON.stringify(source)).toBe(before);
  view.unmount();const restored=render(<Editor entry={entry} saved={saved[0].boxStop!}/>);
  expect(screen.getByLabelText('箱体止损 1 K基准')).toHaveValue(kind);
  expect(screen.getByLabelText('箱体止损 1 更新方式')).toHaveValue('fixed');
  if(kind!=='impulse0')expect(screen.getByLabelText('箱体止损 1 急拉线原生冗余 ATR')).toHaveValue(.123456789012345);
  restored.unmount();
 }
});
it('requires an explicit regular basis before changing to an hourly algorithm and preserves the original selection',()=>{
 render(<Editor/>);
 expect(screen.getByLabelText('箱体止损 1 K基准')).toHaveValue('support');
 fireEvent.change(screen.getByLabelText('箱体止损 1 K基准'),{target:{value:'impulse1115'}});
 fireEvent.change(screen.getByLabelText('箱体止损 1 K基准'),{target:{value:'guard'}});
 expect(screen.getByLabelText('箱体止损 1 算法')).not.toBeDisabled();
 fireEvent.change(screen.getByLabelText('箱体止损 1 算法'),{target:{value:'1h'}});
 expect(Array.from((screen.getByLabelText('箱体止损 1 K基准') as HTMLSelectElement).options).some(o=>o.value==='impulse1115')).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const saved=JSON.parse(document.querySelector('output')!.textContent!)[0].boxStop;
 expect(saved.reference).toBeUndefined();expect(saved.version).toBe('holding-box-stop-v1');
 expect(saved.structure.buffer).toBe(.75);
});
