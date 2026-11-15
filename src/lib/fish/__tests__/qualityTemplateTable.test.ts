import {expect,it} from 'vitest';
import {createQualityTemplateTable,templateCampaignPath} from '../qualityTemplateTable';
import {archivedMonitorCampaignLookup,monitorRoundStudy} from '../qualityMonitorArchive';
import {monitorArchiveFixture} from './monitorArchive.fixture';
import {qualityMonitorCampaignPath} from '../qualityMonitorCampaign';

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
