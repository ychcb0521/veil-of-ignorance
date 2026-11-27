import {readBlock, validBlock, type Block, type MonitorFolder} from './localMonitorFiles';
import type {BrowseScope} from './libraryBrowse';

export const localScopeName = {mining:'捕捞库',filter:'过滤库',screen:'筛选库'} as const;
export interface ResultDirectory {
  id: string; title: string; at: number; count: number; data: string; parent?: string;
  pages: Block[]; settings: Block; revisions?:Record<string,string>;
}
export interface LocalResultIndex {
  version: 1; source?:string; revisions?:Record<string,string>; owner: string; scope: BrowseScope; revision: string; savedAt: number; groups: ResultDirectory[];
}
export interface DiskResultRow {symbol: string; time: number; summary: string; record: {id:string};}
export const indexName = (owner:string,scope:BrowseScope) => `veil-${scope}-${encodeURIComponent(owner)}.json`;
export async function resultIndex(folder:MonitorFolder,owner:string,scope:BrowseScope):Promise<LocalResultIndex|undefined>{
  let file:File;
  try { file=await (await folder.getFileHandle(indexName(owner,scope))).getFile(); }
  catch(error){if((error as Error).name==='NotFoundError')return;throw error;}
  const value:LocalResultIndex=JSON.parse(await file.text());
  if(value.version!==1||value.owner!==owner||value.scope!==scope||!value.revision||!Number.isSafeInteger(value.savedAt)||
    !Array.isArray(value.groups)||!value.groups.every(g=>g&&typeof g.id==='string'&&typeof g.title==='string'&&
      Number.isFinite(g.at)&&Number.isSafeInteger(g.count)&&g.count>=0&&/^[a-f0-9]{64}\.vlib$/.test(g.data)&&
      Array.isArray(g.pages)&&g.pages.length===Math.ceil(g.count/32)&&g.pages.every(validBlock)&&validBlock(g.settings))||
    new Set(value.groups.map(g=>g.id)).size!==value.groups.length)throw Error('本机目录索引与当前账号或所选库不符。');
  return value;
}
export async function resultPage(file:File,group:ResultDirectory,page:number):Promise<DiskResultRow[]>{
  if(!Number.isSafeInteger(page)||page<0||page>=group.pages.length)throw Error('页码超出范围。');
  const value=await readBlock(file,group.pages[page]);
  if(!Array.isArray(value)||value.length!==Math.min(32,group.count-page*32)||
    !value.every(r=>typeof r?.symbol==='string'&&Number.isFinite(r.time)&&typeof r.summary==='string'&&typeof r.record?.id==='string'))
    throw Error('本机归档记录不完整。');
  return value;
}
