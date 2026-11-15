import {serializeAccountBlob} from '@/lib/accountBlobCodec';
import type {FishQualityStudy,QualityBuyFilter,QualityGroup} from './quality';
import type {QualitySignalMetric} from './qualitySignalReadings';
import {activeQualityPlanTemplates, qualityTemplateKind, type QualityPlanTemplate, type QualityTemplateKind} from './qualityPlanTemplates';
export interface QualityTemplateName {
  id:string;
  originalName:string;
  name:string;
  kind:QualityTemplateKind;
}

export const TEMPLATE_KIND_PREFIX={filter:'过滤',screen:'筛选',monitor:'监测'} as const;
export function ordinalLetters(ordinal:number):string {
  let suffix='';
  while(ordinal>0){
    ordinal--;
    suffix=String.fromCharCode(65+ordinal%26)+suffix;
    ordinal=Math.floor(ordinal/26);
  }
  return suffix;
}
export function beijingTemplateDay(at:number):string|undefined{
  const day=new Date(at+8*3600_000);
  return at>0&&Number.isFinite(day.getTime())?day.toISOString().slice(0,10).replace(/-/g,''):undefined;
}
function ordered(value:unknown):unknown{
  if(Array.isArray(value))return value.map(ordered);
  if(value&&Object.getPrototypeOf(value)===Object.prototype){
    return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)]));
  }
  return value;
}
export const exactTemplateValue=(value:unknown)=>serializeAccountBlob(ordered(value??null));
function planBody({id:_id,label:_label,buyFilters,...body}:QualityGroup) {
  return exactTemplateValue(buyFilters?.length?{...body,buyFilters}:body);
}
const withoutId=<T extends {id:string}>({id:_id,...value}:T)=>value;
const filterBody=(filters:readonly QualityBuyFilter[],metrics:readonly QualitySignalMetric[])=>exactTemplateValue([filters.map(withoutId),metrics.map(withoutId)]);

const emptyCatalog:readonly QualityPlanTemplate[]=[];
const cache=new WeakMap<readonly QualityPlanTemplate[],ReturnType<typeof build>>();
export function qualityTemplateNames(study:Pick<FishQualityStudy,'planTemplates'>) {
  const templates=study.planTemplates??emptyCatalog;
  let resolver=cache.get(templates);
  if(!resolver){resolver=build(templates);cache.set(templates,resolver);}
  return resolver;
}

function build(catalog:readonly QualityPlanTemplate[]) {
  const names=new Map<string,QualityTemplateName>(), ordinals=new Map<string,number>();
  const templates=activeQualityPlanTemplates({planTemplates:catalog as QualityPlanTemplate[]});
  for(const template of [...catalog].sort((a,b)=>a.savedAt-b.savedAt||a.id.localeCompare(b.id))){
    const kind=qualityTemplateKind(template),stamp=beijingTemplateDay(template.savedAt);
    if(!kind||!stamp)continue;
    const key=kind+stamp;
    const ordinal=(ordinals.get(key)??0)+1;ordinals.set(key,ordinal);
    if(!template.deleted&&template.plan)names.set(template.id,{id:template.id,originalName:template.name,
      name:TEMPLATE_KIND_PREFIX[kind]+'_'+stamp+'_'+ordinalLetters(ordinal),kind});
  }
  const cacheBody=new WeakMap<QualityGroup,string>(), activeByBody=new Map<string,typeof templates>();
  const signature=(plan:QualityGroup)=>{
    let key=cacheBody.get(plan);
    if(!key){key=planBody(plan);cacheBody.set(plan,key);}
    return key;
  };
  const filterByBody=new Map<string,typeof templates>();
  for(const template of templates){
    const filter=template.plan.staticFilter;
    const scope=<T extends {initialization?:QualityGroup['initialization']}>(item:T):T=>template.plan.initialization
      ? {...item,initialization:template.plan.initialization} : item;
    const [map,key]=filter?[filterByBody,filterBody(filter.filters.filter(item=>item.enabled).map(scope),filter.metrics.map(scope))] as const
      :[activeByBody,signature(template.plan)] as const;
    const entries=map.get(key);
    if(entries)entries.push(template);else map.set(key,[template]);
  }
  function pick(matches:typeof templates,label?:string) {
    if(matches.length===1)return matches[0];
    if(!label)return;
    const originalName=matches.filter(t=>t.name===label||names.get(t.id)?.name===label);
    if(originalName.length===1)return originalName[0];
    const planLabel=matches.filter(t=>t.plan.label===label);
    return planLabel.length===1?planLabel[0]:undefined;
  }
  function matchPlan(plan:QualityGroup,kind:QualityTemplateKind,hours?:number) {
    return pick((activeByBody.get(signature(plan))??[]).filter(template=>qualityTemplateKind(template)===kind&&
      (kind!=='screen'||template.entryHours===undefined||template.entryHours===hours)),plan.label);
  }
  function matchFilter(filters:readonly QualityBuyFilter[],metrics:readonly QualitySignalMetric[],label?:string) {
    return pick(filterByBody.get(filterBody(filters,metrics))??[],label);
  }
  return {names,numberedCount:(kind:QualityTemplateKind,day:string)=>ordinals.get(kind+day)??0,signature,matchPlan,matchFilter,
    forPlan(plan:QualityGroup,kind:QualityTemplateKind='monitor',hours?:number){
      const match=matchPlan(plan,kind,hours);
      return match?names.get(match.id):undefined;
    },
    forFilter(filters:readonly QualityBuyFilter[],metrics:readonly QualitySignalMetric[],label?:string){
      const match=matchFilter(filters,metrics,label);
      return match?names.get(match.id):undefined;
    },
  };
}

export function campaignTemplateAlias(campaign:Pick<import('@/types/journal').TradeCampaign,'comparison'>, names?:ReturnType<typeof qualityTemplateNames>) {
  const comparison=campaign.comparison;
  if(!names||!comparison)return;
  if(comparison.monitorPlan)return names.forPlan(comparison.monitorPlan);
  const screening=comparison.instant?.metadata?.screening;
  return screening?.plan?names.forPlan(screening.plan,'screen',screening.hours):undefined;
}
