import {describe,expect,it} from 'vitest';
import {monitorArchiveFixture} from './monitorArchive.fixture';
import {qualityTemplateNames,campaignTemplateAlias} from '../qualityTemplateNames';
import {createQualityTemplateDirectory} from '../qualityTemplateDirectory';
import {deleteQualityPlanTemplate,type QualityPlanTemplate} from '../qualityPlanTemplates';
import {makeQualityBuyFilter} from '../qualityFilters';
import {createStaticFilterPlan} from '../qualityStaticFilterPlan';
const monitor=monitorArchiveFixture().sellPlans![0];
const midnight=Date.UTC(2026,10,10,16);
const template=(id:string,name:string,plan=monitor,savedAt=midnight,entryHours?:number):QualityPlanTemplate=>({id,name,plan,savedAt,updatedAt:savedAt,entryHours});
describe('template display names',()=>{
 it('uses Beijing dates, separate categories, deterministic order and stable numbering across deletion',()=>{
  const filter=createStaticFilterPlan([makeQualityBuyFilter('state:state','>',.42)],[]);
  const study={...monitorArchiveFixture(),planTemplates:[
    template('z','newer monitor'),template('a','older monitor'),template('yesterday','earlier',monitor,midnight-1),
    template('s','screen',monitor,midnight,10),template('f','filter',filter),
  ]};
  const before=structuredClone(study),names=qualityTemplateNames(study);
  expect([...names.names.values()].map(n=>n.name)).toEqual(['监测_20261110_01','监测_20261111_01','过滤_20261111_01','筛选_20261111_01','监测_20261111_02']);
  const after=qualityTemplateNames(deleteQualityPlanTemplate(study,'a',midnight+90));
  expect(after.names.get('z')).toEqual(names.names.get('z'));
  expect(study).toEqual(before);
 });
 it('uses the exact original identity and scope, and does not guess when ambiguous',()=>{
  const study={planTemplates:[template('a','甲'),template('b','乙'),template('s','筛选原名',monitor,midnight,96)]};
  const original=structuredClone(study);
  const names=qualityTemplateNames(study);
  expect(names.forPlan({...monitor,id:'working',label:'乙'})).toMatchObject({id:'b',name:'监测_20261111_02',originalName:'乙'});
  expect(names.forPlan(monitor)).toBeUndefined();
  expect(names.forPlan(monitor,'screen',48)).toBeUndefined();
  expect(names.forPlan(monitor,'screen',96)?.id).toBe('s');
  const frozen={...monitor,label:'乙'};
  expect(campaignTemplateAlias({comparison:{monitorPlan:frozen} as never},names)?.id).toBe('b');
  expect(names.forPlan({...frozen,positionManagement:{version:'holding-position-management-v1',leverage:3,notional:200}})).toBeUndefined();
  expect(study).toEqual(original);
  const stored=createQualityTemplateDirectory(study).groupPlans([frozen]);
  expect(createQualityTemplateDirectory(study,true).present(stored)).toEqual({
    id:stored.id,title:'监测_20261111_02',originalTitle:'乙',
  });
 });
});
