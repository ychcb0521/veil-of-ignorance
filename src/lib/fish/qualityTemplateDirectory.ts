import type { FishQualityStudy, QualityGroup } from './quality';
import type { QualityFilterRoundSnapshot, QualityFilterSetting } from './qualityFilterLibrary';
import type { PreEntryRound } from './preEntryMonitor';
import {beijingTemplateDay,exactTemplateValue as exact,ordinalLetters,qualityTemplateNames,TEMPLATE_KIND_PREFIX} from './qualityTemplateNames';
import type {QualityTemplateKind} from './qualityPlanTemplates';
import { fingerprintAccountBlob } from '../accountBlobCodec';

export interface QualityTemplateDirectoryGroup {
  id: string;
  title: string;
  originalTitle?: string;
  savedTemplate?: true;
  historical?: { firstArchivedAt:number };
}

export const unknownTemplateGroup: QualityTemplateDirectoryGroup = {
  id: 'unknown',
  title: '历史记录 · 未记录模板',
};

/** Used only for display keys. Comparison with a saved template uses the full original data. */
function displayGroup(kind: string, key: string, title: string): QualityTemplateDirectoryGroup {
  return { id: kind + ':' + fingerprintAccountBlob(key), title };
}

export function createQualityTemplateDirectory(study: Pick<FishQualityStudy, 'planTemplates'>, numbered=false) {
  const catalog=qualityTemplateNames(study);
  const titleOf=(id:string,name:string)=>numbered?catalog.names.get(id)?.name??name:name;
  const groupPlans = (batch: readonly QualityGroup[], screening?: PreEntryRound): QualityTemplateDirectoryGroup => {
    if (!batch.length) return unknownTemplateGroup;
    let allSaved=numbered;
    const groups = new Map<string, {title:string;original:string}>();
    for (const plan of batch) {
      const key=catalog.signature(plan);
      const match=catalog.matchPlan(plan,screening?'screen':'monitor',screening?.hours);
      if(!match||!catalog.names.has(match.id))allSaved=false;
      const original=match?.name||plan.label||'历史方案';
      const unmatchedKey=numbered&&screening ? exact([key,screening.hours,screening.engine]) : key;
      groups.set(match ? 'tpl:' + match.id : unmatchedKey, {title:match?titleOf(match.id,original):original,original});
    }
    const suffix=groups.size > 1 ? ' · 多方案' : '';
    const title = [...groups.values()].map(value=>value.title).join('、')+suffix;
    const originalTitle = [...groups.values()].map(value=>value.original).join('、')+suffix;
    return {...displayGroup(screening ? 'screen' : 'monitor', exact([...groups.keys()].sort()), title),
      ...(title!==originalTitle?{originalTitle}:{}),...(allSaved?{savedTemplate:true as const}:{})};
  };
  const groupFilters = (settings: readonly QualityFilterSetting[], snapshot?: QualityFilterRoundSnapshot): QualityTemplateDirectoryGroup => {
    if (!settings.length) return unknownTemplateGroup;
    const conditions = settings.map(setting => setting.filters);
    const metrics = snapshot?.signalMetrics ?? [];
    const key = exact([conditions.map(exact).sort(), metrics]);
    if (snapshot && conditions.length === 1) {
      const match=catalog.matchFilter(conditions[0],metrics,settings[0].plans.length===1?settings[0].plans[0]:undefined);
      if(match){
        const title=titleOf(match.id,match.name);
        return {id:'filter:'+match.id,title,...(title!==match.name?{originalTitle:match.name}:{}),...(numbered&&catalog.names.has(match.id)?{savedTemplate:true as const}:{})};
      }
    }
    const labels = [...new Set(settings.flatMap(setting => setting.plans))];
    const names = [...new Set(conditions.flatMap(filters => filters.map(filter => filter.label + ' ' + filter.direction + ' ' + filter.threshold)))];
    const metricNames = [...new Set(metrics.map(metric => metric.label))];
    return displayGroup('filter', key, labels.join('、') || [...names, ...metricNames].slice(0,3).join('、') || '历史过滤条件');
  };
  const storedGroups=new Map<string,QualityTemplateDirectoryGroup>();
  if(numbered)for(const entry of catalog.names.values()){
    const id=entry.kind==='filter'?'filter:'+entry.id:displayGroup(entry.kind,exact(['tpl:'+entry.id]),'').id;
    storedGroups.set(id,{id,title:entry.name,originalTitle:entry.originalName,savedTemplate:true});
  }
  const present=(group:QualityTemplateDirectoryGroup,candidate?:QualityTemplateDirectoryGroup)=>{
    if(!numbered)return group;
    return storedGroups.get(group.id)??(candidate?.id===group.id?candidate:group);
  };
  /** Display-only fallback for complete historical group identities. Never reads or groups archive bodies by name. */
  const withHistoricalNames=<T extends {at:number;templateGroup?:QualityTemplateDirectoryGroup}>(items:readonly T[],kind:QualityTemplateKind):T[]=>{
    if(!numbered)return [...items];
    const firstSeen=new Map<string,{at:number;group:QualityTemplateDirectoryGroup}>();
    const known=new Map<string,QualityTemplateDirectoryGroup>();
    for(const item of items){
      const group=item.templateGroup;
      if(!group||group.id===unknownTemplateGroup.id)continue;
      if(group.savedTemplate){known.set(group.id,group);continue;}
      if(!beijingTemplateDay(item.at))continue;
      const earliest=firstSeen.get(group.id);
      if(!earliest||item.at<earliest.at)firstSeen.set(group.id,{at:item.at,group});
    }
    const aliases=new Map(known),days=new Map<string,number>();
    for(const {at,group} of [...firstSeen.values()].sort((a,b)=>a.at-b.at||a.group.id.localeCompare(b.group.id))){
      if(aliases.has(group.id))continue;
      const day=beijingTemplateDay(at)!;
      const ordinal=(days.get(day)??catalog.numberedCount(kind,day))+1;
      days.set(day,ordinal);
      aliases.set(group.id,{...group,title:TEMPLATE_KIND_PREFIX[kind]+'_'+day+'_'+ordinalLetters(ordinal),originalTitle:group.originalTitle??group.title,historical:{firstArchivedAt:at}});
    }
    return items.map(item=>{
      const alias=item.templateGroup&&aliases.get(item.templateGroup.id);
      return alias?{...item,templateGroup:alias}:item;
    });
  };
  return { groupPlans, groupFilters, present, withHistoricalNames };

}
