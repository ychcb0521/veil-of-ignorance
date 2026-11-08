/** Directory presentation only; frozen conditions, times and results are never edited. */
export interface LibraryDirectoryEdit {hidden:boolean;at:number;name?:string;nameAt?:number}
export type LibraryDirectoryEdits=Record<string,LibraryDirectoryEdit>;
export const DIRECTORY_NAME_MAX_LENGTH=120;
export function renameLibraryDirectoryEdit(edits:LibraryDirectoryEdits|undefined,id:string,name:string,at=Date.now()):LibraryDirectoryEdits|undefined {
 if(!id||name.trim().length>DIRECTORY_NAME_MAX_LENGTH)return edits;
 const old=edits?.[id];
 return {...edits,[id]:{hidden:false,at:0,...old,name:name.trim(),nameAt:Math.max(at,(old?.nameAt??0)+1)}};
}
export function mergeLibraryDirectoryEdits(a:LibraryDirectoryEdits={},b:LibraryDirectoryEdits={}):LibraryDirectoryEdits {
 const out={...a};
 for(const [id,next] of Object.entries(b)){
  const old=out[id];if(!old){out[id]=next;continue;}
  const visibility=next.at>old.at||next.at===old.at&&next.hidden?next:old;
  const named=old.nameAt===undefined?next:next.nameAt===undefined?old:next.nameAt>old.nameAt||next.nameAt===old.nameAt&&(next.name??'')>(old.name??'')?next:old;
  const {name:_name,nameAt:_nameAt,...rest}=visibility;
  out[id]={...rest,...(named.nameAt!==undefined?{name:named.name??'',nameAt:named.nameAt}:{})};
 }
 return out;
}
export function validLibraryDirectoryEdits(value:unknown):value is LibraryDirectoryEdits {
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(edit=>edit&&typeof edit==='object'&&typeof edit.hidden==='boolean'&&Number.isFinite(edit.at)&&(edit.name===undefined&&edit.nameAt===undefined||typeof edit.name==='string'&&edit.name.length<=DIRECTORY_NAME_MAX_LENGTH&&Number.isFinite(edit.nameAt)));
}
