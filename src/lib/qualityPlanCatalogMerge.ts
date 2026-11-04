/** Small independent account catalog: keep newer edits/deletion tombstones per template. */
export function mergeQualityPlanCatalogValues(local:unknown,remote:unknown):unknown[]{
 const map=new Map<string,{id:string;updatedAt:number;deleted?:boolean}>();
 for(const value of [local,remote])for(const t of Array.isArray(value)?value:[]){
  if(!t||typeof t.id!=='string'||!Number.isFinite(t.updatedAt))continue;
  const old=map.get(t.id);if(!old||t.updatedAt>old.updatedAt||t.updatedAt===old.updatedAt&&(!old.deleted||t.deleted))map.set(t.id,t);
 }
 return [...map.values()];
}
