import { newQualityStudy } from '../quality';
import { qualityMonitorCampaignRun } from '../qualityMonitorCampaign';
import { monitorArchiveFixture } from './monitorArchive.fixture';

/** A result frozen by the current working table, independently of library records. */
export function workspaceCampaignFixture() {
  const library = monitorArchiveFixture().monitorLibrary!;
  const record = library.records[0];
  const run = qualityMonitorCampaignRun(record, library.settings.find(setting => setting.id === record.settingId)!)!;
  run.plan = { ...run.plan, rule: { metric: 'state', direction: '<', threshold: 0.5 } };
  return { ...newQualityStudy(run.firstEvaluatedAt), workspaceExecution: 1 as const,
    samples: [run.sample], groups: run.detectors, sellPlans: [run.plan],
    campaignRuns: [run], results: [run.result] };
}
