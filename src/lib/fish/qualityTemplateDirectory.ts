import type { FishQualityStudy, QualityGroup } from './quality';
import type { QualityFilterRoundSnapshot, QualityFilterSetting } from './qualityFilterLibrary';
import type { PreEntryRound } from './preEntryMonitor';
import {exactTemplateValue as exact,qualityTemplateNames} from './qualityTemplateNames';
import { fingerprintAccountBlob } from '../accountBlobCodec';

export interface QualityTemplateDirectoryGroup {
  id: string;
  title: string;
  originalTitle?: string;
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
    const groups = new Map<string, {title:string;original:string}>();
    for (const plan of batch) {
      const key=catalog.signature(plan);
      const match=catalog.matchPlan(plan,screening?'screen':'monitor',screening?.hours);
      const original=match?.name||plan.label||'历史方案';
      groups.set(match ? 'tpl:' + match.id : key, {title:match?titleOf(match.id,original):original,original});
    }
    const suffix=groups.size > 1 ? ' · 多方案' : '';
    const title = [...groups.values()].map(value=>value.title).join('、')+suffix;
    const originalTitle = [...groups.values()].map(value=>value.original).join('、')+suffix;
    return {...displayGroup(screening ? 'screen' : 'monitor', exact([...groups.keys()].sort()), title),
      ...(title!==originalTitle?{originalTitle}:{})};
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
        return {id:'filter:'+match.id,title,...(title!==match.name?{originalTitle:match.name}:{})};
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
    storedGroups.set(id,{id,title:entry.name,originalTitle:entry.originalName});
  }
  const present=(group:QualityTemplateDirectoryGroup,candidate?:QualityTemplateDirectoryGroup)=>{
    if(!numbered)return group;
    return storedGroups.get(group.id)??(candidate?.id===group.id?candidate:group);
  };
  return { groupPlans, groupFilters, present };

}
