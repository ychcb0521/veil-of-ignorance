import { expect, it } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { emptyPreEntryConditions, validatePreEntryConditions } from '../preEntryConditions';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import type { QualityGroup } from '../quality';
import type { QualityHoldingVeto } from '../qualityVeto';

// 旧版筛选引擎（pre-entry-conditions-v4）已下线；这里只保留仍需为新旧方案读取版本的冻结与校验逻辑。
const T=Date.UTC(2026,2,29,5);
const plan=():QualityGroup=>({id:'entry',label:'入选',metric:'raw',execution:'intrabar-1m',rule:{metric:'raw',direction:'>',threshold:105},preEntryConditions:emptyPreEntryConditions(),
  snapshot:{featureId:'price',definitionKey:definitionKey({formula:'raw=C',positive:'1',control:'0',interval:'5m'}),statistic:'raw',interval:'5m',scale:1,threshold:0,cutoffMs:T,average:0,cbi2:0,startAverage:0,previousAverage:0}});
const priceVeto=(kind:QualityHoldingVeto['kind'],threshold=5):QualityHoldingVeto=>({id:kind,label:kind,kind,direction:'>=',threshold,enabled:true});

it('freezes the additional conditions and rejects position-only or unknown versions',()=>{
  const p=plan();p.preEntryConditions!.hardVetoes=[priceVeto('drop-5m',10)];
  const frozen=freezeQualityPlan(p);
  expect(planVersionChanges(frozen)).toEqual([]);
  frozen.preEntryConditions!.hardVetoes[0].threshold=11;
  expect(planVersionChanges(frozen).map(c=>c.key)).toContain('pre-entry-conditions');
  expect(()=>validatePreEntryConditions({...emptyPreEntryConditions(),hardVetoes:[priceVeto('payoff-ratio',100)]})).toThrow('没有实际持仓');
  expect(()=>validatePreEntryConditions({...emptyPreEntryConditions(),version:'unknown' as never})).toThrow('版本不可用');
});
