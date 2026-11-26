import { ATR_PRICE_PCT_DEF } from '@/lib/deepDig/features';
import {it,expect,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {useState} from 'react';
import {FishQualityEntryVetoEditor} from '@/components/FishQualityEntryVetoEditor';
import {ADDITION_VETO_LABELS} from '@/lib/fish/qualityAdditionVeto';
import {SHARED_VETO_DRAFT_KEYS,vetoDraftOf,parseAdditionVetoDraft} from '@/lib/fish/qualityEntryVetoDraft';
afterEach(cleanup);
it.each([false,true])('saves and restores two independent algorithm vetoes with custom periods (screening=%s)',entry=>{
 function Editor(){
  const [draft,setDraft]=useState(()=>vetoDraftOf());
  return <><FishQualityEntryVetoEditor entry={entry} definitions={[ATR_PRICE_PCT_DEF]} draft={draft} setDraft={setDraft}/>
   <button onClick={()=>setDraft(vetoDraftOf(JSON.parse(JSON.stringify(parseAdditionVetoDraft(draft)))))}>重新载入</button></>;
 }
 render(<Editor/>);
 const add=screen.getByLabelText('添加算法否决');
 fireEvent.change(add,{target:{value:'atr-price-pct-v1:ATRP'}});
 fireEvent.change(screen.getByLabelText('算法否决 1 阈值'),{target:{value:'3'}});
 fireEvent.change(screen.getByLabelText('算法否决 1 比较方式'),{target:{value:'<'}});
 fireEvent.change(screen.getByLabelText('算法否决 1 K 线周期'),{target:{value:'15m'}});
 fireEvent.change(screen.getByLabelText('算法否决 1 ATR 周期（根）'),{target:{value:'7'}});
 fireEvent.change(add,{target:{value:'atr-price-pct-v1:ATRP'}});
 fireEvent.change(screen.getByLabelText('算法否决 2 阈值'),{target:{value:'6'}});
 fireEvent.click(screen.getByLabelText('启用算法否决 2'));
 fireEvent.click(screen.getByText('重新载入'));
 expect(screen.getByLabelText('算法否决 1 K 线周期')).toHaveValue('15m');
 expect(screen.getByLabelText('算法否决 1 ATR 周期（根）')).toHaveValue(7);
 expect(screen.getByLabelText('算法否决 1 阈值')).toHaveValue(3);
 expect(screen.getByLabelText('算法否决 1 比较方式')).toHaveValue('<');
 expect(screen.getByLabelText('启用算法否决 2')).not.toBeChecked();
 expect(screen.getByLabelText('算法否决 2 阈值')).toHaveValue(6);
});
it.each([false,true])('exposes every registered veto independently in entry=%s without mutating the source',entry=>{
 const original=vetoDraftOf(),before=JSON.stringify(original);
 function Editor(){const [draft,setDraft]=useState(()=>structuredClone(original));return <><FishQualityEntryVetoEditor entry={entry} allowDoubleDrop draft={draft} setDraft={setDraft}/><output>{JSON.stringify(parseAdditionVetoDraft(draft))}</output></>;}
 render(<Editor/>);
 for(const key of SHARED_VETO_DRAFT_KEYS){
  const kind=key==='guard-distance-1h'?'guard-distance':key;
  const label=kind==='guard-distance'?(key==='guard-distance-1h'?'距 DBL-5-1h 防守线过远':'距 DBL-5-5mins 防守线过远'):entry&&kind==='box-break'?'筛选期间箱体断裂':entry&&kind==='fast-drop'?'筛选期间急跌':ADDITION_VETO_LABELS[kind];
  const checkbox=screen.getByLabelText(`启用${entry?'入选前':'加仓'}否决 ${label}`);
  expect(checkbox).not.toBeChecked();fireEvent.click(checkbox);
  const values=JSON.parse(document.querySelector('output')!.textContent!);expect(values).toHaveLength(1);expect(values[0].kind).toBe(kind);if(kind==='guard-distance')expect(values[0].guardDistance.parameters.timeframe).toBe(key==='guard-distance-1h'?'1h':'5m');expect(values[0].historyHours).toBe(kind==='guard-distance'||kind==='box-break'?undefined:6);
  expect(screen.getAllByRole('checkbox').filter(e=>(e as HTMLInputElement).checked&&e.getAttribute('aria-label')?.startsWith('启用'))).toHaveLength(1);
  fireEvent.click(checkbox);expect(document.querySelector('output')!.textContent).toBe('[]');
 }
 expect(JSON.stringify(original)).toBe(before);
});
