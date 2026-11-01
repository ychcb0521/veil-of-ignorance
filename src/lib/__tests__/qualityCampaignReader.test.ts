import { afterEach, expect, it, vi } from 'vitest';
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
  const study = monitorArchiveFixture(), get = vi.fn(() => {
    const request: any = {}; queueMicrotask(() => { request.result = study; request.onsuccess(); }); return request;
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
