import {supabase} from '@/integrations/supabase/client';
import type {QualityPlanTemplate} from './qualityPlanTemplates';
export interface QualityTemplateArchiveRow {id:string;template_id:string;template_name:string;revision_hash:string;created_at:string}
const table=()=>supabase.from('quality_plan_template_archive' as never);
export async function listQualityTemplateArchive(owner:string):Promise<QualityTemplateArchiveRow[]>{
 const all:QualityTemplateArchiveRow[]=[];
 for(let from=0;;from+=100){
  const {data,error}=await (table().select('id,template_id,template_name,revision_hash,created_at') as any).eq('user_id',owner).order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,from+99);
  if(error)throw Error('系统存档暂不可用，请重试');all.push(...(data??[]));if((data??[]).length<100)break;
 }
 return all;
}
export async function readQualityTemplateArchive(owner:string,id:string):Promise<QualityPlanTemplate>{
 const {data,error}=await (table().select('snapshot') as any).eq('user_id',owner).eq('id',id).single();
 if(error||!data?.snapshot?.plan)throw Error('系统存档读取失败，请重试');return data.snapshot;
}
