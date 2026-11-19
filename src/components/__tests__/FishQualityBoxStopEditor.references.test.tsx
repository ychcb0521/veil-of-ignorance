import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import {FishQualityHoldingVetoEditor} from '../FishQualityHoldingVetoEditor';
import {defaultBoxStop,selectBoxStopReference,BOX_STOP_CHANNELS_VERSION,type BoxStopRule} from '@/lib/fish/qualityBoxStop';
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
it.each([false,true])('急拉与非急拉可同时选择，冗余和执行参数分别保存恢复（screening=%s）',entry=>{
 for(const kind of Object.keys(BOX_STOP_REFERENCE_LABELS) as BoxStopReferenceKind[]){
  const source=initial(),before=JSON.stringify(source),view=render(<Editor entry={entry} saved={source}/>);
  fireEvent.click(screen.getByLabelText('箱体止损 1 使用急拉线'));
  expect(screen.getByLabelText('箱体止损 1 使用非急拉线')).toBeChecked();
  expect(screen.getByLabelText('箱体止损 1 使用急拉线')).toBeChecked();
  const impulse='箱体止损 1 急拉线 ',regular='箱体止损 1 非急拉线 ';
  fireEvent.change(screen.getByLabelText(impulse+'K基准'),{target:{value:kind}});
  expect(screen.getByLabelText(impulse+'算法')).toBeDisabled();
  expect(screen.getByLabelText(regular+'额外冗余')).toHaveValue(.75);
  fireEvent.change(screen.getByLabelText(impulse+'额外冗余'),{target:{value:'0.123456789012345'}});
  fireEvent.change(screen.getByLabelText(impulse+'更新方式'),{target:{value:'fixed'}});
  fireEvent.change(screen.getByLabelText(impulse+'确认方式'),{target:{value:'close-1m'}});
  fireEvent.change(screen.getByLabelText(impulse+'连续确认根数'),{target:{value:'2'}});
  expect(screen.getByLabelText(regular+'更新方式')).toHaveValue(source.update);
  expect(screen.getByLabelText(regular+'确认方式')).toHaveValue(source.confirmation);
  if(kind!=='impulse0')fireEvent.change(screen.getByLabelText(impulse+'急拉线向下缓冲（ATR 倍数）'),{target:{value:'0.23456789012345'}});
  expect(screen.getByLabelText(impulse+'额外冗余').style.flexShrink).toBe('0');
  fireEvent.click(screen.getByRole('button',{name:'保存'}));
  const saved:QualityHoldingVeto[]=JSON.parse(document.querySelector('output')!.textContent!);
  expect(saved[0].boxStop).toMatchObject({version:BOX_STOP_CHANNELS_VERSION,channels:{regular:{enabled:true,rule:source},impulse:{enabled:true,rule:{version:BOX_STOP_REFERENCE_VERSION,reference:{kind},update:'fixed',confirmation:'close-1m',closes:2,structure:{buffer:.123456789012345}}}}});
  expect(parseHoldingVetoDraft(holdingVetoDraft(saved))).toEqual(saved);expect(JSON.stringify(source)).toBe(before);
  view.unmount();const restored=render(<Editor entry={entry} saved={saved[0].boxStop!}/>);
  expect(screen.getByLabelText(impulse+'K基准')).toHaveValue(kind);
  expect(screen.getByLabelText(impulse+'额外冗余')).toHaveValue(.123456789012345);
  expect(screen.getByLabelText(regular+'额外冗余')).toHaveValue(.75);
  if(kind!=='impulse0')expect(screen.getByLabelText(impulse+'急拉线向下缓冲（ATR 倍数）')).toHaveValue(.23456789012345);
  restored.unmount();
 }
},20000);
it('非急拉可改用小时线，急拉仍独立使用原生5分钟；停用一路保留参数',()=>{
 render(<Editor/>);fireEvent.click(screen.getByLabelText('箱体止损 1 使用急拉线'));
 const regular='箱体止损 1 非急拉线 ',impulse='箱体止损 1 急拉线 ';
 fireEvent.change(screen.getByLabelText(regular+'算法'),{target:{value:'1h'}});
 expect(screen.getByLabelText(impulse+'算法')).toHaveValue('dbl5');
 fireEvent.change(screen.getByLabelText(impulse+'额外冗余'),{target:{value:'1.23456789'}});
 fireEvent.click(screen.getByLabelText('箱体止损 1 使用急拉线'));fireEvent.click(screen.getByRole('button',{name:'保存'}));
 const saved=JSON.parse(document.querySelector('output')!.textContent!)[0].boxStop;
 expect(saved.channels.regular.rule.structure.definition.DBL5_config.timeframe).toBe('1h');
 expect(saved.channels.regular.rule.structure.buffer).toBe(.75);expect(saved.channels.impulse).toMatchObject({enabled:false,rule:{structure:{buffer:1.23456789}}});
 fireEvent.click(screen.getByLabelText('箱体止损 1 使用急拉线'));
 expect(screen.getByLabelText(impulse+'额外冗余')).toHaveValue(1.23456789);
});
it.each([false,true])('旧单路方案只打开和保存不转换版本或参数（impulse=%s）',impulse=>{
 const source=impulse?selectBoxStopReference(initial(),'impulse1115'):initial(),before=JSON.stringify(source);
 render(<Editor saved={source}/>);expect(screen.getByLabelText('箱体止损 1 使用急拉线').getAttribute('type')).toBe('checkbox');
 fireEvent.click(screen.getByRole('button',{name:'保存'}));
 expect(JSON.parse(document.querySelector('output')!.textContent!)[0].boxStop).toEqual(source);expect(JSON.stringify(source)).toBe(before);
});
