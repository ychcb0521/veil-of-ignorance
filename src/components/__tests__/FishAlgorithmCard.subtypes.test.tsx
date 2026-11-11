import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FishAlgorithmCard, type FishCard } from '@/components/FishAlgorithmCard';
afterEach(cleanup);
import { BTC_FREE_FEATURES, CBI2_DEF } from '@/lib/deepDig/features';

it('changes the visible indicator tag with the selected subtype and resolves the result alias', () => {
  const def={...CBI2_DEF,formula:'CBI2=C\navg_CBI2=avg(CBI2,24)\navg_CBI2_2=avg(CBI2,12)\navg_CBI2_3=avg(CBI2,6)'};
  function Harness() {
    const [card,setCard]=useState<FishCard>({id:'first',featureId:def.id,enabled:true,pref:{statistic:'结果',direction:'>',threshold:'0.04',constraints:[]}});
    return <FishAlgorithmCard card={card} defs={[def]} locked={false} index={1} onChange={setCard} onDelete={vi.fn()}/>;
  }
  render(<Harness/>);
  const name=()=> (screen.getByLabelText('捕捞算法') as HTMLSelectElement).selectedOptions[0].label;
  expect(name()).toBe('CBI-2·avg₃');
  const algorithm = screen.getByLabelText('捕捞算法');
  const avg = screen.getByRole('option',{name:/^CBI-2·avg · /}) as HTMLOptionElement;
  const avg2 = screen.getByRole('option',{name:/^CBI-2·avg₂ · /}) as HTMLOptionElement;
  expect(avg).toBeEnabled(); expect(avg2).toBeEnabled();
  fireEvent.change(algorithm,{target:{value:avg.value}});
  expect(screen.getByLabelText('捕捞统计量')).toHaveValue('avg_CBI2');
  expect(screen.getByLabelText('捕捞阈值')).toHaveValue(null);
  fireEvent.change(algorithm,{target:{value:avg2.value}});
  expect(screen.getByLabelText('捕捞统计量')).toHaveValue('avg_CBI2_2');
  for(const [metric,label] of [['CBI2','CBI-2 原值'],['avg_CBI2','CBI-2·avg'],['avg_CBI2_2','CBI-2·avg₂']]) {
    fireEvent.change(screen.getByLabelText('捕捞统计量'),{target:{value:metric}});
    expect(name()).toBe(label);
  }
});

it('offers only the three primary series while retaining a saved result alias and its threshold',()=>{
 const def={...CBI2_DEF,formula:'helper=C-O\nCBI2=helper/O\navg_CBI2=avg(CBI2,24)\navg_CBI2_2=avg(CBI2,12)\navg_CBI2_3=avg(CBI2,6)'},onChange=vi.fn();
 const card:FishCard={id:'first',featureId:def.id,enabled:true,pref:{statistic:'结果',direction:'>',threshold:'0.04',constraints:[]}};
 render(<FishAlgorithmCard card={card} defs={[def]} locked={false} index={1} onChange={onChange} onDelete={vi.fn()}/>);
 const select=screen.getByLabelText('捕捞统计量') as HTMLSelectElement;
 expect(Array.from(select.options).filter(o=>!o.hidden).map(o=>o.textContent)).toEqual(['原值','avg','avg_2']);
 expect(select.value).toBe('结果');expect(onChange).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('捕捞阈值'),{target:{value:'0.05'}});
 expect(onChange).toHaveBeenCalledWith({...card,pref:{...card.pref,threshold:'0.05',lastSuggestion:undefined}});
});

it('hides no-BTC choices but keeps the exact selection and threshold on a saved card', () => {
  const noBtc = BTC_FREE_FEATURES.find(def => def.btcFreeSourceId === CBI2_DEF.id)!;
  const ordinary = {...CBI2_DEF, formula:'CBI2 = C\navg_CBI2 = avg(CBI2, 24)'};
  const onChange = vi.fn();
  const card: FishCard = {
    id:'saved', featureId:noBtc.id, enabled:true,
    pref:{statistic:'CBI2',direction:'>',threshold:'0.135792468',constraints:[]},
  };
  render(<FishAlgorithmCard card={card} defs={[ordinary,noBtc,{...noBtc,id:'named-copy',btcFreeSourceId:undefined}]} locked={false} index={1} onChange={onChange} onDelete={vi.fn()}/>);
  const select = screen.getByLabelText('捕捞算法') as HTMLSelectElement;
  expect(select).toHaveValue(noBtc.id);
  expect(select.selectedOptions[0].hidden).toBe(true);
  expect(Array.from(select.options).filter(option=>!option.hidden).map(option=>option.label)).toEqual(['CBI-2','CBI-2·avg']);
  expect(screen.getByLabelText('捕捞阈值')).toHaveValue(.135792468);
  expect(onChange).not.toHaveBeenCalled();
  const avg = Array.from(select.options).find(option=>option.label==='CBI-2·avg')!;
  fireEvent.change(select,{target:{value:avg.value}});
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({featureId:ordinary.id,pref:expect.objectContaining({statistic:'avg_CBI2'})}));
});
