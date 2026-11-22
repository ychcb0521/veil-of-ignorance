import { afterEach, expect, it, vi } from 'vitest';
import { archiveQualityStudy } from '@/lib/fish/qualityCampaignArchive';
import { qualityCampaignPerformanceFromStudy } from '@/lib/fish/qualityCampaignPerformance';
import { workspaceCampaignFixture } from '@/lib/fish/__tests__/workspaceCampaign.fixture';
import { mergeQualityWorkspaceExecution } from '@/lib/fish/qualityWorkspaceExecutionMerge';
import { monitorArchiveFixture } from '@/lib/fish/__tests__/monitorArchive.fixture';
import { archiveQualityMonitorStudy } from '@/lib/fish/qualityMonitorLibrary';
import { listQualityCampaignDataFromStudy, qualityCampaignDetailFromStudy } from '@/lib/fish/qualityCampaignProjection';
import { projectQualityCampaignStudy, readQualityCampaignProjection } from '@/lib/fish/qualityCampaignReader';

afterEach(() => vi.unstubAllGlobals());
it('projects the same campaigns and details without traversing or changing independent archived tables', () => {
  const study = archiveQualityMonitorStudy(monitorArchiveFixture());
  const expected = listQualityCampaignDataFromStudy('owner', study, 'quality', []);
  const frozen = structuredClone(study.monitorLibrary!.archives);
  Object.defineProperty(study.monitorLibrary!.archives![0], 'study', { get() { throw new Error('history must remain off the campaign read path'); } });
  const result = projectQualityCampaignStudy(study, { owner: 'owner', kind: 'list', section: 'quality', definitions: [] });
  expect(result).toEqual({ kind: 'list', data: expected });
  expect(result.kind === 'list' && result.data.rows.length).toBeGreaterThan(0);
  const id = expected.rows[0].campaign.id;
  expect(projectQualityCampaignStudy(study, { owner: 'owner', kind: 'detail', id })).toEqual({ kind: 'detail', data: qualityCampaignDetailFromStudy('owner', study, id) });
  expect(frozen).toHaveLength(1); expect(study.monitorLibrary!.archives).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain('archives');
});
it('reads only the requested owner in a readonly transaction and never writes the derived projection', async () => {
  const study = monitorArchiveFixture(), get = vi.fn((key: string) => {
    const request: any = {}; queueMicrotask(() => { request.result = key.endsWith(':workspace-execution-v1') ? undefined : study; request.onsuccess(); }); return request;
  });
  const close = vi.fn(), transaction = vi.fn(() => ({ objectStore: () => ({ get }) }));
  vi.stubGlobal('indexedDB', { open: () => {
    const request: any = {}; queueMicrotask(() => { request.result = { transaction, close }; request.onsuccess(); }); return request;
  } });
  const request = { owner: 'isolated-owner', kind: 'list' as const, section: 'quality' as const, definitions: [] };
  expect(await readQualityCampaignProjection(request)).toEqual(projectQualityCampaignStudy(study, request));
  expect(transaction).toHaveBeenCalledWith('studies', 'readonly');
  expect(get).toHaveBeenCalledWith('fish-quality:isolated-owner'); expect(close).toHaveBeenCalledOnce();
});

function storedStudies(rows: Map<string, unknown>, rejectHistory = false) {
  const get = vi.fn((key: string) => {
    if (rejectHistory && key === 'fish-quality:owner') throw Error('Historical body must not be read');
    const read: any = {};
    queueMicrotask(() => { read.result = structuredClone(rows.get(key)); read.onsuccess(); });
    return read;
  });
  const close = vi.fn(), transaction = vi.fn(() => ({ objectStore: () => ({ get }) }));
  vi.stubGlobal('indexedDB', { open: () => {
    const request: any = {};
    queueMicrotask(() => { request.result = { transaction, close }; request.onsuccess(); });
    return request;
  } });
  return { get, transaction, close };
}

it('opens a working-table trade without reading history, current settings, other directories or rewriting its frozen plan', async () => {
  const study = workspaceCampaignFixture();
  const expected = listQualityCampaignDataFromStudy('owner', study, 'quality', []).rows.find(row => row.campaign.id.startsWith('fish-sell-'))!;
  expect(expected).toBeDefined();
  const before = structuredClone(study);
  const storage = storedStudies(new Map([['fish-quality:owner:workspace-execution-v1', study]]), true);
  const result = await readQualityCampaignProjection({ owner: 'owner', kind: 'detail', id: expected.campaign.id, workspaceOnly: true });
  expect(result).toEqual({ kind: 'detail', data: expected });
  expect(storage.get.mock.calls).toEqual([['fish-quality:owner:workspace-execution-v1']]);
  expect(storage.transaction).toHaveBeenCalledWith('studies', 'readonly');
  expect(storage.close).toHaveBeenCalledOnce();
  expect(study).toEqual(before);
});

it('reports a missing working trade explicitly, without swallowing corrupt data or leaking another account', async () => {
  const study = archiveQualityStudy(monitorArchiveFixture());
  const id = listQualityCampaignDataFromStudy('owner', study, 'quality', []).rows[0].campaign.id;
  const rows = new Map<string, unknown>([['fish-quality:other:workspace-execution-v1', study]]);
  storedStudies(rows, true);
  const request = { owner: 'owner', kind: 'detail' as const, id, workspaceOnly: true as const };
  expect(await readQualityCampaignProjection(request)).toEqual({ kind: 'missing' });
  rows.set('fish-quality:owner:workspace-execution-v1', { ...study, results: null });
  await expect(readQualityCampaignProjection(request)).rejects.toThrow('格式异常');
});

it('includes working and historical frozen trades in list/detail/statistics once, keeping historical plans and archives untouched', async () => {
  const history = workspaceCampaignFixture(), working = structuredClone(history);
  const base = working.campaignRuns![0];
  const added = { ...structuredClone(base), result: { ...base.result, key: 'workspace-only', evaluatedAt: base.result.evaluatedAt + 100 } };
  working.campaignRuns = [added]; working.results = [];
  working.sellPlans = working.sellPlans?.map(plan => ({ ...plan, label: 'Later editable plan' }));
  const oldRows = listQualityCampaignDataFromStudy('owner', history, 'quality', []).rows;
  const newRows = listQualityCampaignDataFromStudy('owner', working, 'quality', []).rows;
  const expected = [...new Map([...oldRows, ...newRows].map(row => [row.campaign.id, row])).values()];
  const before = structuredClone({ history, working });
  storedStudies(new Map([['fish-quality:owner', history], ['fish-quality:owner:workspace-execution-v1', working]]));
  const result = await readQualityCampaignProjection({ owner: 'owner', kind: 'list', section: 'quality', definitions: [] });
  if (result.kind !== 'list') throw Error('list expected');
  expect(result.data.rows).toEqual(expected);
  for (const row of expected) expect(await readQualityCampaignProjection({ owner: 'owner', kind: 'detail', id: row.campaign.id })).toEqual({ kind: 'detail', data: row });
  const sellKey = expected[0].campaign.comparison!.sellKey;
  const performance = await readQualityCampaignProjection({ owner: 'owner', kind: 'performance', section: 'quality', sellKey });
  expect(performance).toEqual({ kind: 'performance', data: qualityCampaignPerformanceFromStudy('owner', { ...history, campaignRuns: [...history.campaignRuns!, added] }, 'quality', sellKey) });
  expect({ history, working }).toEqual(before);
});
it('does not turn an unsuccessful account recovery into an empty campaign list', async () => {
  const close = vi.fn();
  vi.stubGlobal('indexedDB', { open: () => {
    const request: any = {}; queueMicrotask(() => {
      request.result = { close, transaction: () => ({ objectStore: () => ({ get: () => {
        const read: any = {}; queueMicrotask(() => read.onsuccess()); return read;
      } }) }) }; request.onsuccess();
    }); return request;
  } });
  await expect(readQualityCampaignProjection({ owner: 'empty', kind: 'list', section: 'quality', definitions: [], warning: '账号研究恢复失败，原数据仍保留' })).rejects.toThrow('原数据仍保留');
  expect(close).toHaveBeenCalledOnce();
});

it('keeps the latest valuation for the same frozen run and never opens unrelated archive bodies while joining sources', () => {
  const history = workspaceCampaignFixture(), working = structuredClone(history);
  const old = history.campaignRuns[0], next = working.campaignRuns[0];
  next.result = { ...next.result, evaluatedAt: old.result.evaluatedAt + 1, pnl: 20, endPrice: 120 };
  working.results = [next.result];
  history.monitorLibrary = { version: 1, importedLegacy: false, records: [], rounds: [], settings: [],
    archives: [{ id: 'unrelated-directory', get study(): never { throw Error('unselected archive body'); } } as any] };
  const merged = mergeQualityWorkspaceExecution(history, working);
  expect(merged.campaignRuns).toHaveLength(1);
  expect(merged.campaignRuns[0].result).toEqual(next.result);
  expect(merged.campaignRuns[0].plan).toEqual(old.plan);
  expect(merged.monitorLibrary?.archives).toHaveLength(1);
  expect(mergeQualityWorkspaceExecution(working, history).campaignRuns[0].result).toEqual(next.result);
});
