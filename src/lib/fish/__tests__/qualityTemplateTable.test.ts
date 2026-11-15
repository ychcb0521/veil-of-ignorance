import {expect,it} from 'vitest';
import {createQualityTemplateTable,qualityTemplateImportSelection,templateCampaignPath} from '../qualityTemplateTable';
import {archivedMonitorCampaignLookup,monitorRoundStudy} from '../qualityMonitorArchive';
import {monitorArchiveFixture} from './monitorArchive.fixture';
import {qualityMonitorCampaignPath} from '../qualityMonitorCampaign';
import {entryDirectoryStudy} from '../qualityLibraryDirectory';
import {qualityScreeningResults} from '../qualityScreeningResults';
import type {PreEntryLibrary} from '../preEntryMonitor';

it('merges duplicate snapshots on display without discarding changed results or retargeting a campaign',()=>{
  const original=monitorArchiveFixture(),before=structuredClone(original);
  const record=original.monitorLibrary!.records[0];
  const lookup=archivedMonitorCampaignLookup(original);
  const table=createQualityTemplateTable();
  table.append(original,lookup);
  table.append(structuredClone(original),lookup);
  table.append({...original,results:original.results.map(result=>result.key===record.result!.key?{...result,peakPct:48}:result)},lookup);
  const view=table.finish();
  expect(view.rows).toHaveLength(3);
  expect(view.study.sellPlans).toHaveLength(original.sellPlans!.length);
  const aa=view.rows.filter(row=>row.source.symbol===record.source.symbol);
  expect(aa).toHaveLength(2);
  const cells=aa.map(row=>[...view.results.get(row.signalId!)!.values()].find(result=>result.key===record.result!.key)!);
  expect(cells.map(result=>result.peakPct)).toEqual([20,48]);
  expect(cells.map(templateCampaignPath)).toEqual([qualityMonitorCampaignPath(record.id),undefined]);
  expect(original).toEqual(before);
});

it('links record-only rounds to their frozen monitor record rather than a synthesized result key',()=>{
  const original=monitorArchiveFixture(),round=original.monitorLibrary!.rounds[0],record=original.monitorLibrary!.records[0];
  const table=createQualityTemplateTable();
  table.append(monitorRoundStudy(original,round));
  const view=table.finish();
  expect(view.rows).toHaveLength(2);
  const paths=view.study.results.map(templateCampaignPath);
  expect(paths).toContain(qualityMonitorCampaignPath(record.id));
});

it('keeps frozen screening evidence available when a saved snapshot carries a working-table erase marker',()=>{
  const study=monitorArchiveFixture(),sample=study.samples[0],at=sample.source.timeMs;
  const round={id:'screening',state:'complete' as const,filters:[],hours:1,startedAt:at,updatedAt:at};
  const library:PreEntryLibrary={version:1,rounds:[round],records:[{
    id:'match',roundId:round.id,sample,status:'matched',startTime:at,matchedAt:at+60_000,cursor:at+60_000,updatedAt:at+60_000,readings:[],
  }]};
  const snapshot=entryDirectoryStudy(library,round);
  snapshot.screeningResults![0].tableClearedAt=at+120_000;
  expect(qualityScreeningResults(snapshot)).toEqual([]);
  const builder=createQualityTemplateTable();builder.append(snapshot);
  const table=builder.finish(),row=table.rows[0];
  expect(table.screening.get(row.signalId!)?.[0].record).toMatchObject({status:'matched',matchedAt:at+60_000,tableClearedAt:at+120_000});
});

it('imports a batch of original input records without copying view IDs, plans or results',()=>{
  const input=monitorArchiveFixture(), before=structuredClone(input);
  const builder=createQualityTemplateTable(true);
  builder.append(input);
  builder.append(structuredClone(input));
  const directory=builder.finish();
  expect(directory.rows).toHaveLength(2);
  const selected=qualityTemplateImportSelection(directory,[directory.rows[1].id]);
  expect(selected.snapshot.samples).toEqual([input.samples[1]]);
  expect(selected.snapshot.results).toEqual([]);
  expect(selected.snapshot.sellPlans).toBeUndefined();
  expect(selected.ids).toHaveLength(1);
  expect(selected.ids[0]).not.toMatch(/^template-/);
  expect(input).toEqual(before);
});
