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
  expect([...names.names.values()].map(n=>n.name)).toEqual(['监测_20261110_A','监测_20261111_A','过滤_20261111_A','筛选_20261111_A','监测_20261111_B']);
  const after=qualityTemplateNames(deleteQualityPlanTemplate(study,'a',midnight+90));
  expect(after.names.get('z')).toEqual(names.names.get('z'));
  expect(study).toEqual(before);
 });
 it('continues with AA after Z',()=>{
  const names=qualityTemplateNames({planTemplates:Array.from({length:28},(_,i)=>template('t'+i,'test',monitor,midnight+i))});
  expect([25,26,27].map(i=>names.names.get('t'+i)?.name)).toEqual(['监测_20261111_Z','监测_20261111_AA','监测_20261111_AB']);
 });
 it('uses the exact original identity and scope, and does not guess when ambiguous',()=>{
  const study={planTemplates:[template('a','甲'),template('b','乙'),template('s','筛选原名',monitor,midnight,96)]};
  const original=structuredClone(study);
  const names=qualityTemplateNames(study);
  expect(names.forPlan({...monitor,id:'working',label:'乙'})).toMatchObject({id:'b',name:'监测_20261111_B',originalName:'乙'});
  expect(names.forPlan(monitor)).toBeUndefined();
  expect(names.forPlan(monitor,'screen',48)).toBeUndefined();
  expect(names.forPlan(monitor,'screen',96)?.id).toBe('s');
  const frozen={...monitor,label:'乙'};
  expect(campaignTemplateAlias({comparison:{monitorPlan:frozen} as never},names)?.id).toBe('b');
  expect(names.forPlan({...frozen,positionManagement:{version:'holding-position-management-v1',leverage:3,notional:200}})).toBeUndefined();
  expect(study).toEqual(original);
  const stored=createQualityTemplateDirectory(study).groupPlans([frozen]);
  expect(createQualityTemplateDirectory(study,true).present(stored)).toEqual({
    id:stored.id,title:'监测_20261111_B',originalTitle:'乙',
  });
 });
});

it('keeps same-name historical snapshots separate and uses the first archived day without reading present bodies',()=>{
 const study={planTemplates:[template('a','正式模板')]};
 const directory=createQualityTemplateDirectory(study,true);
 const original={...monitor,id:'archived',label:'同名',positionManagement:{version:'holding-position-management-v1' as const,leverage:3,notional:200}};
 const distinct={...original,positionManagement:{...original.positionManagement,leverage:4}};
 const item=(at:number,plan=original)=>({at,templateGroup:directory.groupPlans([plan]),read:()=>{throw Error('仅需目录元数据');}});
 const items=[item(midnight+1000),item(midnight+3000,distinct),item(midnight+100)];
 const groups=directory.withHistoricalNames(items,'monitor').map(item=>item.templateGroup);
 expect(groups.map(group=>group.title)).toEqual(['监测_20261111_B','监测_20261111_C','监测_20261111_B']);
 expect(groups[0]).toMatchObject({originalTitle:'同名',historical:{firstArchivedAt:midnight+100}});
 expect(groups[0].id).not.toBe(groups[1].id);
 expect(items[0].templateGroup.title).toBe('同名');
});
