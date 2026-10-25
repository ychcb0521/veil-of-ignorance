import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { FishAlgorithmCard, type FishCard } from '@/components/FishAlgorithmCard';
import { CBI2_DEF } from '@/lib/deepDig/features';

it('changes the visible indicator tag with the selected subtype and resolves the result alias', () => {
  const def={...CBI2_DEF,formula:'CBI2=C\navg_CBI2=avg(CBI2,24)\navg_CBI2_2=avg(CBI2,12)\navg_CBI2_3=avg(CBI2,6)'};
  function Harness() {
    const [card,setCard]=useState<FishCard>({id:'first',featureId:def.id,enabled:true,pref:{statistic:'结果',direction:'>',threshold:'0.04',constraints:[]}});
    return <FishAlgorithmCard card={card} defs={[def]} locked={false} index={1} onChange={setCard} onDelete={vi.fn()}/>;
  }
  render(<Harness/>);
  const name=()=> (screen.getByLabelText('捕捞算法') as HTMLSelectElement).selectedOptions[0].label;
  expect(name()).toBe('CBI-2·avg₃');
  for(const [metric,label] of [['CBI2','CBI-2 原值'],['avg_CBI2','CBI-2·avg'],['avg_CBI2_2','CBI-2·avg₂']]) {
    fireEvent.change(screen.getByLabelText('捕捞统计量'),{target:{value:metric}});
    expect(name()).toBe(label);
  }
});
