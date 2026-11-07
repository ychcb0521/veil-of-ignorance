import {expect,it} from 'vitest';
import {applySavedQualityPlans,editSavedQualityPlans,mergeSavedQualityPlans,recoverableQualityPlans,seedSavedQualityPlans} from '../qualitySavedPlans';
import {newQualityStudy,type QualityGroup} from '../quality';
import {makeQualitySellPlan} from '../qualitySellPlans';
import {BUILTIN_FEATURES} from '@/lib/deepDig/features';
const plan=(id:string,threshold=.5):QualityGroup=>makeQualitySellPlan('state:state','<',threshold,BUILTIN_FEATURES,undefined,id);
it('keeps newly saved independent plans and newer parameters across stale local/cloud snapshots',()=>{
 const original=plan('original'),structure=plan('structure',.4),attack=plan('attack',.3),old={...newQualityStudy(1),sellPlans:[original],sellPlansConfigured:true};
 const entries=editSavedQualityPlans([],old.sellPlans,[original,structure,attack],100);
 expect(applySavedQualityPlans(old,entries).sellPlans).toEqual([original,structure,attack]);
 const newer=editSavedQualityPlans(entries,[original,structure,attack],[original,plan('structure',.2),attack],200);
 expect(applySavedQualityPlans(old,mergeSavedQualityPlans(newer,entries)).sellPlans![1].rule!.threshold).toBe(.2);
 const staleSave=editSavedQualityPlans(newer,[original,structure,attack],[original,structure,attack,plan('other')],300);
 expect(staleSave.find(p=>p.id==='structure')!.plan!.rule!.threshold).toBe(.2);
 expect(staleSave).toHaveLength(4);
});
it('honors explicit removal and restoration without resurrecting deletions from old pages or backfill',()=>{
 const a=plan('a'),b=plan('b'),entries=editSavedQualityPlans([],[],[a,b],100);
 const removed=editSavedQualityPlans(entries,[a,b],[a],200),merged=mergeSavedQualityPlans(removed,entries);
 const old={...newQualityStudy(1),sellPlans:[a,b],sellPlansConfigured:true};
 expect(applySavedQualityPlans(old,seedSavedQualityPlans(merged,[a,b])).sellPlans).toEqual([a]);
 const restored=editSavedQualityPlans(merged,[a],[a,b],300);
 expect(applySavedQualityPlans({...old,sellPlans:[a]},restored).sellPlans).toEqual([a,b]);
 expect(applySavedQualityPlans(old,editSavedQualityPlans(restored,[a,b],[],400)).sellPlans).toEqual([]);
});
it('recovers the newest missing monitored snapshot instead of rebuilding its parameters from the original',()=>{
 const original=plan('original'),old=plan('structure',.4),latest=plan('structure',.2);
 const study={...newQualityStudy(1),sellPlans:[original],campaignRuns:[{plan:old,result:{evaluatedAt:10}},{plan:latest,result:{evaluatedAt:20}},{plan:original,result:{evaluatedAt:30}}]} as Parameters<typeof recoverableQualityPlans>[0];
 const result=recoverableQualityPlans(study);expect(result).toHaveLength(1);expect(result[0].plan).toEqual(latest);
 expect(latest.rule!.threshold).toBe(.2);expect(original.rule!.threshold).toBe(.5);
});
