import {supabase} from '@/integrations/supabase/client';
import type {QualityPlanTemplate} from './qualityPlanTemplates';
export interface QualityTemplateArchiveRow {id:string;template_id:string;template_name:string;revision_hash:string;created_at:string}
const table=()=>supabase.from('quality_plan_template_archive' as never);
export type QualityTemplatePurpose = 'entry' | 'sell';

export async function listQualityTemplateArchive(owner: string, purpose: QualityTemplatePurpose): Promise<QualityTemplateArchiveRow[]> {
  const all: QualityTemplateArchiveRow[] = [];
  const entryPlan = 'snapshot->plan->>preEntryThreeStage';
  const pageSize = 100;
  for (let from = 0; ; from += pageSize) {
    const query = (table().select('id,template_id,template_name,revision_hash,created_at') as any).eq('user_id', owner);
    const scoped = purpose === 'entry' ? query.not(entryPlan, 'is', null) : query.is(entryPlan, null);
    const { data, error } = await scoped.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + pageSize - 1);
    if (error) throw Error('系统存档暂不可用，请重试');
    all.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return all;
  }
}
export async function readQualityTemplateArchive(owner:string,id:string):Promise<QualityPlanTemplate>{
 const {data,error}=await (table().select('snapshot') as any).eq('user_id',owner).eq('id',id).single();
 if(error||!data?.snapshot?.plan)throw Error('系统存档读取失败，请重试');return data.snapshot;
}
