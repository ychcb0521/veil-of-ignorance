import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({ prepare: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/fish/qualityStore', () => ({ prepareQualityCampaignRead: store.prepare, loadQualityStudy: store.load }));
vi.mock('@/lib/featureSource', () => ({ accountFeatureDefs: () => [] }));
import { listQualityCampaignData, loadQualityCampaignData, loadQualityCampaignPerformance } from '@/lib/fish/qualityCampaigns';
import { newQualityStudy } from '@/lib/fish/quality';
import { serializeArchiveWork } from '@/lib/serializeArchiveWork';
import {encodeQualityCampaignPacket} from '@/lib/fish/qualityCampaignTransfer';
function reply(worker:any,result:any){let sequence=0;for(const chunk of encodeQualityCampaignPacket({kind:'result',result}))worker.onmessage({data:{type:'chunk',sequence:sequence++,...chunk}});worker.onmessage({data:{type:'complete'}});}
beforeEach(() => { store.prepare.mockReset().mockResolvedValue({ durable: true }); store.load.mockReset(); });
it('requests only a worker summary for detail account metrics, never a full campaign list', async () => {
  const sent = vi.fn(), terminate = vi.fn();
  class Reader {
    onmessage: any; onerror: any; terminate = terminate;
    postMessage(request: any) { if(request.type==='ack')return;sent(request); queueMicrotask(() => reply(this,{ kind: 'performance', data: { performance: {}, asymmetricRisk: {} } })); }
  }
  vi.stubGlobal('Worker', Reader);
  await loadQualityCampaignPerformance('owner', 'quality', 'selected-key');
  expect(sent).toHaveBeenCalledWith({ owner: 'owner', kind: 'performance', section: 'quality', sellKey: 'selected-key', warning: undefined });
  expect(store.load).not.toHaveBeenCalled(); expect(terminate).toHaveBeenCalledOnce();
});
afterEach(() => vi.unstubAllGlobals());
it('cancels an obsolete read and releases the shared archive queue immediately',async()=>{
 const workers:any[]=[];
 class Reader{onmessage:any;onerror:any;terminate=vi.fn();constructor(){workers.push(this);}postMessage(){}}
 vi.stubGlobal('Worker',Reader);const controller=new AbortController();
 const read=listQualityCampaignData('old','quality',controller.signal),rejected=expect(read).rejects.toMatchObject({name:'AbortError'});
 await vi.waitFor(()=>expect(workers).toHaveLength(1));controller.abort();await rejected;
 expect(workers[0].terminate).toHaveBeenCalledOnce();
 const next=listQualityCampaignData('new');await vi.waitFor(()=>expect(workers).toHaveLength(2));
 reply(workers[1],{kind:'list',data:{rows:[]}});await next;
 expect(store.load).not.toHaveBeenCalled();
});
it.each(['detail', 'performance'])('terminates the %s worker when the user leaves a campaign', async kind => {
  const workers: { terminate: ReturnType<typeof vi.fn> }[] = [];
  class Reader {
    terminate = vi.fn();
    constructor() { workers.push(this); }
    postMessage() {}
  }
  vi.stubGlobal('Worker', Reader);
  const controller = new AbortController();
  const pending = kind === 'detail'
    ? loadQualityCampaignData('owner', 'fish-sell-example', controller.signal)
    : loadQualityCampaignPerformance('owner', 'quality', 'selected-key', controller.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  controller.abort();
  await rejected;
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  expect(store.load).not.toHaveBeenCalled();
});

it('rejects a mid-transfer failure without publishing a partial list or rereading on the main thread',async()=>{
 class Reader{
  onmessage:any;onerror:any;terminate=vi.fn();
  postMessage(body:any){if(body.type==='ack')return;queueMicrotask(()=>{
   let sequence=0;for(const chunk of encodeQualityCampaignPacket({kind:'list',data:{buyFilterLabel:'',repair:undefined,selectedSellKey:undefined}}))this.onmessage({data:{type:'chunk',sequence:sequence++,...chunk}});
   this.onmessage({data:{type:'error',error:'Data cannot be cloned, out of memory.'}});
  });}
 }
 vi.stubGlobal('Worker',Reader);await expect(listQualityCampaignData('owner')).rejects.toThrow('out of memory');expect(store.load).not.toHaveBeenCalled();
});
it('waits for a shared archive backup before opening a campaign snapshot', async () => {
  let release!: () => void;
  const backup = serializeArchiveWork(() => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve();
  const workers: any[] = [];
  class Reader {
    onmessage: any; onerror: any; terminate = vi.fn();
    constructor() { workers.push(this); }
    postMessage(request:any) { if(request.type==='ack')return;queueMicrotask(() => reply(this,{kind:'list',data:{rows:[]}})); }
  }
  vi.stubGlobal('Worker', Reader);
  const list = listQualityCampaignData('owner');
  await Promise.resolve(); await Promise.resolve();
  expect(workers).toHaveLength(0);
  release(); await backup; await list;
  expect(workers).toHaveLength(1); expect(workers[0].terminate).toHaveBeenCalledOnce();
});
it('sends only a small read request, returns the campaign result and releases the archive worker', async () => {
  const sent = vi.fn(), terminate = vi.fn();
  class Reader {
    onmessage: any; onerror: any; terminate = terminate;
    postMessage(request: any) { if(request.type==='ack')return;sent(request); queueMicrotask(() => reply(this,{ kind: 'list', data: { rows: [], buyFilterLabel: '过滤', selectedSellKey: undefined } })); }
  }
  vi.stubGlobal('Worker', Reader);
  expect((await listQualityCampaignData('owner')).buyFilterLabel).toBe('过滤');
  expect(sent).toHaveBeenCalledWith({ owner: 'owner', kind: 'list', section: 'quality', definitions: [], warning: undefined });
  expect(store.load).not.toHaveBeenCalled(); expect(terminate).toHaveBeenCalledOnce();
});
it('serializes list and detail reads so navigation cannot hold concurrent full archives', async () => {
  const workers: any[] = [];
  class Reader {
    onmessage: any; onerror: any; body: any; terminate = vi.fn();
    constructor() { workers.push(this); }
    postMessage(body: any) { if(body.type!=='ack')this.body = body; }
  }
  vi.stubGlobal('Worker', Reader);
  const list = listQualityCampaignData('owner'), detail = loadQualityCampaignData('other', 'fish-sell-example');
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  reply(workers[0],{ kind: 'list', data: { rows: [] } }); await list;
  await vi.waitFor(() => expect(workers).toHaveLength(2));
  expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(workers[1].body.owner).toBe('other');
  reply(workers[1],{ kind: 'detail', data: { campaign: { id: 'fish-sell-example' } } });
  expect((await detail).campaign.id).toBe('fish-sell-example'); expect(workers[1].terminate).toHaveBeenCalledOnce();
});
it('surfaces worker errors without trying another huge UI-thread read', async () => {
  const terminate = vi.fn();
  class Reader {
    onmessage: any; onerror: any; terminate = terminate;
    postMessage() { queueMicrotask(() => this.onerror({ message: 'worker failed' })); }
  }
  vi.stubGlobal('Worker', Reader);
  await expect(listQualityCampaignData('owner')).rejects.toThrow('原数据仍保留');
  expect(terminate).toHaveBeenCalledOnce(); expect(store.load).not.toHaveBeenCalled();
});
it('retains the legacy storage merge path instead of ignoring a newer fallback', async () => {
  store.prepare.mockResolvedValue({ durable: false }); store.load.mockResolvedValue({ study: newQualityStudy() });
  const worker = vi.fn(); vi.stubGlobal('Worker', worker);
  expect((await listQualityCampaignData('legacy')).rows).toEqual([]);
  expect(store.load).toHaveBeenCalledWith('legacy'); expect(worker).not.toHaveBeenCalled();
});
