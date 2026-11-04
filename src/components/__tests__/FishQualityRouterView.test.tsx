import {fireEvent,render,screen,within} from '@testing-library/react';
import {it,expect} from 'vitest';
import {makeQualitySellPlan} from '@/lib/fish/qualitySellPlans';
import {BUILTIN_FEATURES} from '@/lib/deepDig/features';
import {FishQualityRouterView} from '../FishQualityRouterView';
import {QUALITY_ROUTER_VERSION} from '@/lib/fish/qualityPlanRouter';
import type {QualityGroup} from '@/lib/fish/quality';
it('explains the decision and allows inspecting both frozen branches without editable controls',()=>{
 const p=makeQualitySellPlan('state:state','<',.5,BUILTIN_FEATURES,undefined,'p');
 const structure={...p,addition:{enabled:false,source:'detector' as const,stricterPct:10,maxRounds:2,quantityMode:'calculator' as const}},attack={...structure,addition:{...structure.addition,maxRounds:8}};
 const plan={...p,router:{version:QUALITY_ROUTER_VERSION,afterAdditions:2,threshold:.9,structure,attack}} as QualityGroup;
 render(<FishQualityRouterView plan={plan}/>);
 expect(screen.getByTestId('quality-router-view')).toHaveTextContent('第二次成交');expect(screen.getByLabelText('最多加仓次数')).toHaveValue(2);
 fireEvent.click(within(screen.getByRole('tablist',{name:'查看条件分支'})).getByRole('tab',{name:'进攻分支'}));
 expect(screen.getByLabelText('最多加仓次数')).toHaveValue(8);
 expect(screen.queryByRole('button',{name:'保存全部方案'})).toBeNull();
},20000);
