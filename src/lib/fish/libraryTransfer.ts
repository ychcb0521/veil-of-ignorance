import {applySourceDeletions,mergeSourceDeletions,pruneMiningDeletions,type SourceDeletions} from './libraryDeletion';
import {newQualityStudy} from './quality';
/** Lossless, account-independent library packages. Import never executes a formula or replaces live settings. */
import type {FishQualityStudy} from './quality';
import type {FishMiningLibrary,FishMiningRecord,FishMiningRun} from './miningLibrary';
import type {QualityFilterLibrary,QualityFilterRecord,QualityFilterSetting} from './qualityFilterLibrary';
import type {QualityMonitorLibrary,QualityMonitorRecord,QualityMonitorSetting} from './qualityMonitorLibrary';
import {librarySignalIdentity} from './libraryRounds';
import {miningLibraryConditions} from './libraryConditions';
import {adoptQualityMonitorHistory} from './qualityMonitorLibrary';
export type LibraryScope='all'|'mining'|'filter'|'monitor';
export const LIBRARY_NAMES={all:'三个库',mining:'挖掘库',filter:'过滤库',monitor:'监测库'} as const;
export interface LibraryPayload {deletedReadings?:SourceDeletions;deletedSources?:SourceDeletions;mining?:FishMiningLibrary;filter?:QualityFilterLibrary;monitor?:QualityMonitorLibrary;observations?:Pick<FishQualityStudy,'entryReadings'|'postExitReadings'>}
export interface LibraryPackage {format:'veil-fish-quality-libraries';version:1;id:string;exportedAt:number;scope:LibraryScope;source:{account:string;label:string};libraries:LibraryPayload}
export interface LibraryCollection {version:1;packages:LibraryPackage[]}
export const EMPTY_COLLECTION=():LibraryCollection=>({version:1,packages:[]});
export const LIBRARY_FILE_LIMIT=128*1024*1024;
const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v);
const fail=(what:string):never=>{throw Error('数据包无效：'+what);};
function list(v:unknown,name:string):any[]{if(!Array.isArray(v)||v.length>500000)fail(name+'不是有效记录列表');return v as any[];}
function ids(values:any[],name:string){const seen=new Set<string>();for(const v of values){if(!object(v)||typeof v.id!=='string'||!v.id||seen.has(v.id))fail(name+'编号缺失或重复');seen.add(v.id);}return seen;}
function source(v:unknown){if(!object(v)||typeof v.symbol!=='string'||!v.symbol||!finite(v.timeMs))fail('信号缺少标的或有效时间');}
function plan(v:unknown){if(!object(v)||typeof v.metric!=='string'||!object(v.snapshot)||v.snapshot.definitionKey!==undefined&&typeof v.snapshot.definitionKey!=='string')fail('卖出方案缺少完整公式快照');}
function rounds(values:any[],records:Set<string>){
 const all=ids(values,'轮次'),byId=new Map(values.map(r=>[r.id,r])),done=new Set<string>();
 for(const r of values){if(!finite(r.startedAt)||!finite(r.updatedAt))fail('轮次时间无效');if(r.base&&!all.has(r.base))fail('轮次缺少基准');for(const key of ['recordIds','added','removed'])if(r[key]!==undefined)for(const id of list(r[key],'轮次记录'))if(typeof id!=='string'||!records.has(id))fail('轮次引用不存在的记录');
  const seen=new Set<string>();let cursor=r;while(cursor&&!done.has(cursor.id)){if(seen.has(cursor.id))fail('轮次基准存在循环');seen.add(cursor.id);cursor=cursor.base?byId.get(cursor.base):undefined;}for(const id of seen)done.add(id);
 }
}
/** Validate complete references before presenting a file for confirmation. Unknown fields are retained. */
export function validateLibraryPayload(input:unknown):asserts input is LibraryPayload {
 if(!object(input))fail('缺少库内容');const v=input as LibraryPayload;if(!v.mining&&!v.filter&&!v.monitor)fail('没有三个库中的任何一个');
 if(v.mining){const l=v.mining;if(l.version!==1)fail('挖掘库版本不支持');const runs=list(l.runs,'挖掘方案'),anchors=list(l.anchors,'挖掘档位'),records=list(l.records,'挖掘记录');const runIds=ids(runs,'挖掘方案'),recordIds=ids(records,'挖掘记录');ids(anchors,'挖掘档位');
  for(const r of runs)if(typeof r.signature!=='string'||!Array.isArray(r.rules))fail('挖掘方案缺少参数');
  for(const r of records){if(!runIds.has(r.runId)||!finite(r.anchorMs)||!finite(r.updatedAt))fail('挖掘记录引用或时间无效');source(r.signal);}
  for(const a of anchors){if(!runIds.has(a.runId)||!finite(a.anchorMs))fail('挖掘档位引用无效');for(const id of list(a.recordIds,'档位记录'))if(!recordIds.has(id))fail('档位缺少关联记录');}
 }
 if(v.filter){const l=v.filter;if(l.version!==1)fail('过滤库版本不支持');const settings=list(l.settings,'过滤方案'),records=list(l.records,'过滤记录'),settingIds=ids(settings,'过滤方案'),recordIds=ids(records,'过滤记录');
  for(const s of settings){if(typeof s.signature!=='string')fail('过滤方案缺少签名');for(const f of list(s.filters,'过滤条件'))if(!object(f)||!object(f.snapshot)||f.snapshot.definitionKey!==undefined&&typeof f.snapshot.definitionKey!=='string'||!finite(f.threshold))fail('过滤条件缺少公式或门槛');}
  for(const r of records){source(r.source);if(!settingIds.has(r.settingId)||!finite(r.updatedAt)||!Array.isArray(r.readings)||!object(r.status)||!['pass','fail','pending','error','none'].includes(r.status.state))fail('过滤记录无效');}rounds(list(l.rounds,'过滤轮次'),recordIds);
 }
 if(v.monitor){const l=v.monitor;if(l.version!==1)fail('监测库版本不支持');const settings=list(l.settings,'监测方案'),records=list(l.records,'监测记录'),settingIds=ids(settings,'监测方案'),recordIds=ids(records,'监测记录');
  for(const s of settings){if(typeof s.signature!=='string'||!Array.isArray(s.detectors)||!finite(s.observeHours))fail('监测方案缺少参数');plan(s.plan);}
  for(const r of records){source(r.source);if(!settingIds.has(r.settingId)||!finite(r.updatedAt))fail('监测记录引用或时间无效');if(r.result&&(!object(r.result)||!finite(r.result.evaluatedAt)||!['open','closed','waiting','error'].includes(r.result.status)))fail('监测结果无效');}rounds(list(l.rounds,'监测轮次'),recordIds);
 }
 if(v.observations)for(const key of ['entryReadings','postExitReadings'] as const)if(v.observations[key]!==undefined)for(const r of list(v.observations[key],key))if(!object(r)||typeof r.key!=='string'||!finite(r.evaluatedAt))fail('关联读数无效');
}
export const stringifyLibraryFile=(value:unknown)=>JSON.stringify(value,(_key,v)=>typeof v==='number'&&!Number.isFinite(v)?{__veilLibraryNumber:String(v)}:v);
function parseFile(text:string){return JSON.parse(text,(key,v)=>{if(['__proto__','prototype','constructor'].includes(key))fail('包含非法对象字段');if(object(v)&&Object.keys(v).length===1&&typeof v.__veilLibraryNumber==='string'&&['NaN','Infinity','-Infinity'].includes(v.__veilLibraryNumber))return Number(v.__veilLibraryNumber);return v;});}
export async function packageId(p:Pick<LibraryPackage,'source'|'scope'|'libraries'>){const bytes=new TextEncoder().encode(stringifyLibraryFile([p.source.account,p.scope,p.libraries]));return 'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
export async function makeLibraryPackage(account:string,label:string,libraries:LibraryPayload,scope:LibraryScope='all',at=Date.now()):Promise<LibraryPackage>{
 libraries=pruneTransferPayload(libraries);
 const selected:LibraryPayload=scope==='all'?libraries:scope==='mining'?{mining:libraries.mining}:scope==='filter'?{filter:libraries.filter}:{monitor:libraries.monitor,observations:libraries.observations};
 if(libraries.deletedSources)selected.deletedSources=libraries.deletedSources;if(libraries.deletedReadings)selected.deletedReadings=libraries.deletedReadings;
 validateLibraryPayload(selected);const p={format:'veil-fish-quality-libraries' as const,version:1 as const,scope,source:{account,label},libraries:structuredClone(selected),exportedAt:at};return {...p,id:await packageId(p)};
}
export async function parseLibraryPackage(text:string):Promise<LibraryPackage>{
 if(new TextEncoder().encode(text).length>LIBRARY_FILE_LIMIT)throw Error('文件超过128MB，请分库下载后导入');
 const value=parseFile(text);
 if(!object(value)||value.format!=='veil-fish-quality-libraries'||value.version!==1||!Object.prototype.hasOwnProperty.call(LIBRARY_NAMES,value.scope)||!object(value.source)||typeof value.source.account!=='string'||typeof value.source.label!=='string'||!finite(value.exportedAt))fail('文件类型或版本不支持，请上传三库的JSON完整数据包');
 validateLibraryPayload(value.libraries);if(value.id!==await packageId(value as any))fail('内容校验失败，文件可能不完整或已修改');return value as LibraryPackage;
}
export async function parseLibraryFile(text:string):Promise<LibraryPackage[]>{
 if(new TextEncoder().encode(text).length>LIBRARY_FILE_LIMIT)throw Error('文件超过128MB，请分库下载后导入');
 const data=parseFile(text);
 if(data?.format!=='veil-fish-quality-library-collection')return [await parseLibraryPackage(text)];
 if(data.version!==1)fail('汇总包版本不支持');const packages=list(data.packages,'数据包');if(packages.length>1000)fail('汇总包数量过多');
 const out:LibraryPackage[]=[];for(const p of packages)out.push(await parseLibraryPackage(stringifyLibraryFile(p)));return mergeLibraryCollections(EMPTY_COLLECTION(),{version:1,packages:out}).packages;
}
export function libraryPayload(study:FishQualityStudy,mining:FishMiningLibrary):LibraryPayload{
 const s=adoptQualityMonitorHistory(applySourceDeletions(study));return {deletedReadings:s.deletedReadings,deletedSources:s.deletedSources,mining,filter:s.filterLibrary??{version:1,settings:[],records:[],rounds:[]},monitor:s.monitorLibrary??{version:1,importedLegacy:false,settings:[],records:[],rounds:[]},observations:{entryReadings:s.entryReadings,postExitReadings:s.postExitReadings}};
}
export function pruneTransferPayload(p:LibraryPayload,marks:SourceDeletions=p.deletedSources??{}):LibraryPayload{const s=applySourceDeletions({...newQualityStudy(1),deletedSources:mergeSourceDeletions(marks,p.deletedSources),deletedReadings:p.deletedReadings,filterLibrary:p.filter,monitorLibrary:p.monitor,...p.observations});return {...p,deletedReadings:s.deletedReadings,...(Object.keys(s.deletedSources??{}).length?{deletedSources:s.deletedSources}:{}),...(p.mining?{mining:pruneMiningDeletions(p.mining)}:{}),...(p.filter?{filter:s.filterLibrary}:{}),...(p.monitor?{monitor:s.monitorLibrary,observations:{entryReadings:s.entryReadings,postExitReadings:s.postExitReadings}}:{})};}
export function mergeLibraryCollections(a:LibraryCollection,b:LibraryCollection):LibraryCollection {const map=new Map(a.packages.map(p=>[p.id,p]));for(const p of b.packages)if(!map.has(p.id))map.set(p.id,p);return {version:1,packages:[...map.values()]};}
export type TransferRow={key:string;scope:Exclude<LibraryScope,'all'>;source:string[];account:string[];symbol:string;time:number;entry:number|null;updatedAt:number;condition:string;settingKey:string;result?:QualityMonitorRecord['result'];status:string;raw:unknown;setting:unknown;variants:number};
/** Latest record time wins, never export/import time. Original packages remain intact for auditing. */
export function aggregateLibraryPackages(packages:readonly LibraryPackage[]):TransferRow[]{
 const rows=new Map<string,TransferRow>(),catalog=new Map<string,Map<string,number>>();
 const intern=(scope:string,signature:string)=>{let m=catalog.get(scope);if(!m){m=new Map();catalog.set(scope,m);}let n=m.get(signature);if(n===undefined){n=m.size;m.set(signature,n);}return n;};
 const add=(row:TransferRow)=>{const old=rows.get(row.key);if(!old){rows.set(row.key,row);return;}const newer=row.updatedAt>old.updatedAt?row:old;rows.set(row.key,{...newer,source:[...new Set([...old.source,...row.source])],account:[...new Set([...old.account,...row.account])],variants:old.variants+1});};
 const marks=mergeSourceDeletions(...packages.map(p=>p.libraries.deletedSources));const miningMarks=new Map<string,Set<string>>();for(const p of packages){const set=miningMarks.get(p.source.account)??new Set<string>();for(const id of Object.keys(p.libraries.mining?.deletedRecords??{}))set.add(id);miningMarks.set(p.source.account,set);}
 for(const p of packages){const l=pruneTransferPayload(p.libraries,marks);
  if(l.mining){const runs=new Map(l.mining.runs.map(r=>[r.id,r]));for(const record of l.mining.records){if(miningMarks.get(p.source.account)?.has(record.id))continue;const run=runs.get(record.runId)!,c=miningLibraryConditions(record,run),settingKey=c.identity+(c.conditions.some(c=>!c.snapshot.definitionKey)?'|unknown:'+p.id+'|'+record.runId:''),key=JSON.stringify(['mining',librarySignalIdentity(record.signal),record.anchorMs,intern('mining',settingKey)]);add({key,scope:'mining',source:[p.source.label],account:[p.source.account],symbol:record.signal.symbol,time:record.signal.timeMs,entry:record.anchorMs,updatedAt:record.updatedAt,condition:c.conditions.map(c=>c.text).join('；')||'历史算法快照',settingKey,status:'已挖到',raw:record,setting:run,variants:1});}}
  if(l.filter){const settings=new Map(l.filter.settings.map(s=>[s.id,s]));for(const r of l.filter.records){const s=settings.get(r.settingId)!,settingKey=s.signature+(s.filters.some(f=>!f.snapshot.definitionKey)?'|unknown:'+p.id+'|'+s.id:''),key=JSON.stringify(['filter',librarySignalIdentity(r.source),r.enteredAt,intern('filter',settingKey)]);add({key,scope:'filter',source:[p.source.label],account:[p.source.account],symbol:r.source.symbol,time:r.source.timeMs,entry:r.enteredAt,updatedAt:r.updatedAt,condition:s.filters.map(f=>`${f.label} · ${f.metric} ${f.direction} ${f.threshold}`).join(' 且 ')||'未设过滤',settingKey,status:r.status.state,raw:r,setting:s,variants:1});}}
  if(l.monitor){const settings=new Map(l.monitor.settings.map(s=>[s.id,s]));for(const r of l.monitor.records){const s=settings.get(r.settingId)!,settingKey=s.signature+(!s.plan.snapshot.definitionKey?'|unknown:'+p.id+'|'+s.id:''),key=JSON.stringify(['monitor',librarySignalIdentity(r.source),r.enteredAt,intern('monitor',settingKey)]);add({key,scope:'monitor',source:[p.source.label],account:[p.source.account],symbol:r.source.symbol,time:r.source.timeMs,entry:r.enteredAt,updatedAt:r.updatedAt,condition:s.plan.label+(s.plan.rule?` ${s.plan.rule.direction} ${s.plan.rule.threshold}`:''),settingKey,result:r.result,status:r.result?.status??r.filterStatus.state,raw:r,setting:s,variants:1});}}
 }return [...rows.values()].sort((a,b)=>b.time-a.time||a.key.localeCompare(b.key));
}
export function transferPreview(existing:readonly LibraryPackage[],incoming:readonly LibraryPackage[]){const ids=new Set(existing.map(p=>p.id)),unique=[...new Map(incoming.map(p=>[p.id,p])).values()],newPackages=unique.filter(p=>!ids.has(p.id));const before=new Map(aggregateLibraryPackages(existing).map(r=>[r.key,r])),after=aggregateLibraryPackages([...existing,...newPackages]);let added=0,updated=0;for(const r of after){const old=before.get(r.key);if(!old)added++;else if(r.updatedAt>old.updatedAt)updated++;}return {packages:newPackages,duplicates:incoming.length-newPackages.length,added,updated,rows:after.length};}
