import type { FishMiningLibrary, FishMiningRecord } from './miningLibrary';
import { mergeMiningLibraries, normalizeMiningLibrary } from './miningLibrary';
import { serializeAccountBlob } from '../accountBlobCodec';

const PAGE = 128;
const LARGE = 4096;
type Kind = 'records' | 'anchors' | 'runs';
const kinds: Kind[] = ['records', 'anchors', 'runs'];
type Header = { meta: Omit<FishMiningLibrary, Kind>; counts: Record<Kind, number> };
type ReadPages = Header & { source: FishMiningLibrary };
const headerKey = (key: string) => 'pages-v1:' + key;
const pageKey = (key: string, kind: Kind, i: number) => headerKey(key) + ':' + kind + ':' + i;

// IndexedDB can preserve undefined, signed zero and non-JSON objects from older local versions.
function sameSnapshot(a:unknown,b:unknown):boolean {
  if(Object.is(a,b))return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  const proto=Object.getPrototypeOf(a);
  if(proto!==Object.getPrototypeOf(b)||(proto!==Object.prototype&&proto!==null&&!Array.isArray(a)))return false;
  if(Array.isArray(a)&&Array.isArray(b)&&a.length!==b.length)return false;
  const ka=Object.keys(a),kb=Object.keys(b);
  return ka.length===kb.length&&ka.every((k,i)=>k===kb[i]&&sameSnapshot((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
}

/** Share exact repeated definitions and non-hit snapshots, without dropping historical fields. */
export function miningRecordInterner() {
  const strings = new Map<string,string>(), objects = new Map<string,object>();
  const share = (obj: object) => {
    const fields = obj as Record<string,unknown>;
    for (const k of ['definitionKey','algorithmKey','featureName','featureShort','constraintKey','statistic','unit']) {
      const v = fields[k];
      if (typeof v !== 'string') continue;
      const known = strings.get(v);
      if (known !== undefined) fields[k] = known;
      else if (strings.size < 4096) strings.set(v,v);
    }
  };
  return (row: FishMiningRecord) => {
    const fish = row.signal?.fish;
    if (!fish) return;
    share(fish);
    const snapshots = fish.algorithms;
    if (!snapshots) return;
    for (let i=0;i<snapshots.length;i++) {
      const s=snapshots[i]; share(s);
      if (!s.outcome || s.outcome === 'hit') continue;
      const text = serializeAccountBlob(s), known=objects.get(text);
      if (known && sameSnapshot(known,s)) snapshots[i]=known as typeof s;
      else if (!known && objects.size<2048) objects.set(text,s);
    }
  };
}

/** Read inside the caller's transaction. Legacy clients can still edit their original row. */
export function readMiningPages(store: IDBObjectStore, key: string,
  done: (library: FishMiningLibrary | undefined, previous?: ReadPages) => void, fail: (reason: unknown)=>void) {
  const legacy = store.get(key), header = store.get(headerKey(key));
  header.onsuccess = () => {
    try {
      const h = header.result as Header | undefined;
      if (!h) { done(legacy.result == null ? undefined : normalizeMiningLibrary(legacy.result)); return; }
      const library: FishMiningLibrary = {...h.meta,records:[],anchors:[],runs:[]};
      const intern = miningRecordInterner();
      let kindIndex=0, offset=0;
      const next=() => {
        try {
          while (kindIndex<kinds.length && offset>=h.counts[kinds[kindIndex]]) {kindIndex++;offset=0;}
          if (kindIndex===kinds.length) {
            done(legacy.result ? mergeMiningLibraries(normalizeMiningLibrary(legacy.result),library) : library,{...h,source:library});
            return;
          }
          const kind=kinds[kindIndex], request=store.get(pageKey(key,kind,offset/PAGE));
          request.onsuccess=()=> {
            try {
              const page=request.result;
              if (!Array.isArray(page)||page.length!==Math.min(PAGE,h.counts[kind]-offset)) throw Error('捕捞库本机分片不完整');
              if (kind==='records') for (const row of page) intern(row);
              (library[kind] as unknown[]).push(...page); offset+=page.length; next();
            } catch (e) { fail(e); }
          };
          request.onerror=()=>fail(request.error);
        } catch(e) { fail(e); }
      };
      next();
    } catch(e) { fail(e); }
  };
  legacy.onerror=header.onerror=()=>fail(store.transaction?.error);
}

/** One transaction publishes every page and its header together. Limit queued structured clones to one. */
export function writeMiningPages(store:IDBObjectStore,key:string,library:FishMiningLibrary,previous:ReadPages|undefined,fail:(reason:unknown)=>void) {
  if (!previous && Math.max(library.records.length, library.anchors.length) <= LARGE) {store.put(library,key);return;}
  const {records,anchors,runs,...meta}=library;
  const counts={records:records.length,anchors:anchors.length,runs:runs.length};
  for(const kind of kinds) for(let i=Math.ceil(counts[kind]/PAGE);i<Math.ceil((previous?.counts[kind]??0)/PAGE);i++) store.delete(pageKey(key,kind,i));
  let kindIndex=0, offset=0;
  function next() {
    try {
      while(kindIndex<kinds.length){
        const kind=kinds[kindIndex];
        if(offset>=counts[kind]) {kindIndex++;offset=0;continue;}
        const start=offset,page=library[kind].slice(start,start+PAGE);
        offset+=page.length;
        const old=previous?.source[kind];
        if(old && Math.min(PAGE,old.length-start)===page.length && page.every((row,i)=>row===old[start+i]))continue;
        const put=store.put(page,pageKey(key,kind,start/PAGE));
        put.onsuccess=next;put.onerror=()=>fail(put.error);return;
      }
      store.put({counts,meta} satisfies Header,headerKey(key));
    } catch(e) {fail(e);}
  }
  next();
}
