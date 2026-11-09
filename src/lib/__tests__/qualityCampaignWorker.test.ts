import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({ prepare: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/fish/qualityStore', () => ({ prepareQualityCampaignRead: store.prepare, loadQualityStudy: store.load }));
vi.mock('@/lib/featureSource', () => ({ accountFeatureDefs: () => [] }));
import { listQualityCampaignData, loadQualityCampaignData, loadQualityCampaignPerformance } from '@/lib/fish/qualityCampaigns';
import { newQualityStudy } from '@/lib/fish/quality';
beforeEach(() => { store.prepare.mockReset().mockResolvedValue({ durable: true }); store.load.mockReset(); });
it('requests only a worker summary for detail account metrics, never a full campaign list', async () => {
  const sent = vi.fn(), terminate = vi.fn();
  class Reader {
    onmessage: any; onerror: any; terminate = terminate;
    postMessage(request: any) { sent(request); queueMicrotask(() => this.onmessage({ data: { ok: true, result: { kind: 'performance', data: { performance: {}, asymmetricRisk: {} } } } })); }
  }
  vi.stubGlobal('Worker', Reader);
  await loadQualityCampaignPerformance('owner', 'quality', 'selected-key');
  expect(sent).toHaveBeenCalledWith({ owner: 'owner', kind: 'performance', section: 'quality', sellKey: 'selected-key', warning: undefined });
  expect(store.load).not.toHaveBeenCalled(); expect(terminate).toHaveBeenCalledOnce();
});
afterEach(() => vi.unstubAllGlobals());
it('sends only a small read request, returns the campaign result and releases the archive worker', async () => {
  const sent = vi.fn(), terminate = vi.fn();
  class Reader {
    onmessage: any; onerror: any; terminate = terminate;
    postMessage(request: any) { sent(request); queueMicrotask(() => this.onmessage({ data: { ok: true, result: { kind: 'list', data: { rows: [], buyFilterLabel: '过滤', selectedSellKey: undefined } } } })); }
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
    postMessage(body: any) { this.body = body; }
  }
  vi.stubGlobal('Worker', Reader);
  const list = listQualityCampaignData('owner'), detail = loadQualityCampaignData('other', 'fish-sell-example');
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  workers[0].onmessage({ data: { ok: true, result: { kind: 'list', data: { rows: [] } } } }); await list;
  await vi.waitFor(() => expect(workers).toHaveLength(2));
  expect(workers[0].terminate).toHaveBeenCalledOnce(); expect(workers[1].body.owner).toBe('other');
  workers[1].onmessage({ data: { ok: true, result: { kind: 'detail', data: { campaign: { id: 'fish-sell-example' } } } } });
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
