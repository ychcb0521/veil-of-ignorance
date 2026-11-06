import { describe, expect, it } from 'vitest';
import { BUILTIN_FEATURES } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { advanceQualitySoftConfirmation, classifyQualityAdvantage, requiredSoftConfirmations, withQualityAdvantageOptions } from '../qualityAdvantage';
import { buildQualityAdvantageTemplate } from '../qualityAdvantageTemplate';
import { buildFusionTemplatePlan } from '../qualityBuiltinTemplates';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import { qualityPlanFromTemplate } from '../qualityPlanTemplates';
import { qualitySellKey } from '../qualityCampaignArchive';
import { qualityPlanDetailSheet } from '../qualityExportDetails';
import { calculateAddPosition, initialAddPositionState } from '@/lib/addPositionCoverage';
import sizingRecords from './fixtures/advantage-original-sizing.json';
const STEP=300000;
const bars=(closes:number[]):ResearchBar[]=>closes.map((close,i)=>({openTime:i*STEP,open:close,high:close+.01,low:close-.01,close,volume:1,takerBuyVolume:0}));
const baseline=buildFusionTemplatePlan(BUILTIN_FEATURES,'original');
const candidate=buildQualityAdvantageTemplate(baseline,'new');
const rule=candidate.advantage!;

describe('advantage classification and confirmations',()=>{
  it('vetoes only BOTH consecutive price falls AND consecutive state falls',()=>{
    expect(classifyQualityAdvantage(3*STEP,bars([3,2,1]),[.8,.7,.6],true).grade).toBe('W');
    expect(classifyQualityAdvantage(3*STEP,bars([3,2,1]),[.6,.7,.8],true).grade).toBe('B');
    expect(classifyQualityAdvantage(3*STEP,bars([1,2,3]),[.8,.7,.6],true).grade).toBe('B');
    expect(classifyQualityAdvantage(3*STEP,bars([3,2,1]),[.8,.7,.7],true).grade).toBe('B');
    expect(classifyQualityAdvantage(3*STEP,bars([3,2,1]),[.8,.7,.6],undefined).grade).toBe('W');
  });
  it('requires an intact structure, non-falling state and a breakout only for A, not for adding',()=>{
    expect(classifyQualityAdvantage(3*STEP,bars([1,2,3]),[.6,.7,.7],true).grade).toBe('A');
    expect(classifyQualityAdvantage(3*STEP,bars([1,2,3]),[.6,.7,.7],false).grade).toBe('B');
  });
  it('falls back on missing, future, gapped or invalid auxiliary readings',()=>{
    for(const b of [bars([1,2]),bars([1,2,3]).map((b,i)=>({...b,openTime:b.openTime+(i===2?STEP:0)}))])
      expect(classifyQualityAdvantage(3*STEP,b,[.6,.7,.8],true).grade).toBe('U');
    expect(classifyQualityAdvantage(3*STEP,bars([1,2,3]),[.6,NaN,.8],true).grade).toBe('U');
  });
  it('uses two confirmations before the first addition when structure is intact, and only A after it',()=>{
    for(const grade of ['A','B','W','U'] as const){
      const o={at:STEP,grade,structureValid:true};
      expect(requiredSoftConfirmations(rule,0,o)).toBe(grade==='A'||grade==='B'?2:1);
      expect(requiredSoftConfirmations(rule,1,o)).toBe(grade==='A'?2:1);
    }
    expect(requiredSoftConfirmations(rule,0,{at:STEP,grade:'B',structureValid:false})).toBe(1);
  });
  it('resets on false, gaps and seller changes; an addition or repeated timestamp cannot manufacture a confirmation',()=>{
    const o={at:STEP,grade:'A' as const,structureValid:true};
    const first=advanceQualitySoftConfirmation(undefined,STEP,'seller',true,2,o);
    expect(first.count).toBe(1);
    expect(advanceQualitySoftConfirmation(first,STEP,'seller',true,2,o).count).toBe(1);
    expect(advanceQualitySoftConfirmation(first,STEP+60000,'seller',true,2,o).count).toBe(2);
    expect(advanceQualitySoftConfirmation(first,STEP+120000,'seller',true,2,o).count).toBe(1);
    expect(advanceQualitySoftConfirmation(first,STEP+60000,'new-stage',true,2,o).count).toBe(1);
    expect(advanceQualitySoftConfirmation(first,STEP+60000,'seller',false,2,o).count).toBe(0);
    const weakened=advanceQualitySoftConfirmation(first,STEP+60000,'seller',true,1,{...o,grade:'W'});
    expect(weakened.count>=weakened.required).toBe(true);
  });
});
describe('template preserves the complete selected baseline',()=>{
  it('reproduces all 106 exported A/B sizing quantities with the unchanged production formula',()=>{
    expect(sizingRecords).toHaveLength(106);
    for(const r of sizingRecords){
      const result=calculateAddPosition({currentPrice:r.T,support:r.K,state:initialAddPositionState(r.S,r.Q,r.P,r.average)});
      expect(result.error).toBeNull();expect(Math.abs(result.addCoins-r.quantity),`${r.source}/${r.row}/${r.round}`).toBeLessThan(1e-9);
    }
  });
  it('changes only identifiers, overlay and version manifests, never sizing, mirror, routing or exits',()=>{
    const strip=(p:typeof baseline):unknown=>{
      const {id:_id,label:_label,advantage:_a,frozenVersions:_v,router,...rest}=p;
      return {...rest,...(router?{router:{...router,structure:strip(router.structure),attack:strip(router.attack)}}:{})};
    };
    expect(strip(candidate)).toEqual(strip(baseline));
    expect(baseline.advantage).toBeUndefined();
    candidate.router!.structure.addition!.rounds!.forEach((r,i)=>expect(r).toEqual(baseline.router!.structure.addition!.rounds![i]));
  });
  it('freezes, clones, exports and versions the overlay and its formula independently',()=>{
    expect(planVersionChanges(candidate)).toEqual([]);
    const clone=qualityPlanFromTemplate({id:'t',name:'模板',savedAt:1,updatedAt:1,plan:candidate},'copy');
    expect(clone.advantage).toEqual(rule);expect(clone.router).toEqual(candidate.router);
    const off=withQualityAdvantageOptions(candidate,{screenWeak:false,beforeFirst:true,afterAddition:true,confirmations:2});
    expect(planVersionChanges(off).length).toBeGreaterThan(0);
    expect(qualitySellKey(off)).not.toBe(qualitySellKey(candidate));
    expect(planVersionChanges(freezeQualityPlan(off))).toEqual([]);
    expect(qualityPlanDetailSheet([candidate]).rows.some(r=>String(r[3]).includes('同步走弱'))).toBe(true);
  });
  it('rejects a changed frozen baseline rather than silently reinterpreting it',()=>{
    const old=structuredClone(candidate);old.router!.structure.addition!.rounds![2].structure!.buffer=9;
    expect(()=>buildQualityAdvantageTemplate(old,'bad')).toThrow();
  });
});
