import {it,expect,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {useState} from 'react';
import {FishQualityEntryVetoEditor} from '@/components/FishQualityEntryVetoEditor';
import {ADDITION_VETO_KINDS,ADDITION_VETO_LABELS} from '@/lib/fish/qualityAdditionVeto';
import {vetoDraftOf,parseAdditionVetoDraft} from '@/lib/fish/qualityEntryVetoDraft';
afterEach(cleanup);
it.each([false,true])('exposes every registered veto independently in entry=%s without mutating the source',entry=>{
 const original=vetoDraftOf(),before=JSON.stringify(original);
 function Editor(){const [draft,setDraft]=useState(()=>structuredClone(original));return <><FishQualityEntryVetoEditor entry={entry} allowDoubleDrop draft={draft} setDraft={setDraft}/><output>{JSON.stringify(parseAdditionVetoDraft(draft))}</output></>;}
 render(<Editor/>);
 for(const kind of ADDITION_VETO_KINDS){
  const label=entry&&kind==='fast-drop'?'筛选期间急跌':ADDITION_VETO_LABELS[kind];
  const checkbox=screen.getByLabelText(`启用${entry?'入选前':'加仓'}否决 ${label}`);
  expect(checkbox).not.toBeChecked();fireEvent.click(checkbox);
  const values=JSON.parse(document.querySelector('output')!.textContent!);expect(values).toHaveLength(1);expect(values[0].kind).toBe(kind);expect(values[0].historyHours).toBe(6);
  expect(screen.getAllByRole('checkbox').filter(e=>(e as HTMLInputElement).checked&&e.getAttribute('aria-label')?.startsWith('启用'))).toHaveLength(1);
  fireEvent.click(checkbox);expect(document.querySelector('output')!.textContent).toBe('[]');
 }
 expect(JSON.stringify(original)).toBe(before);
});
