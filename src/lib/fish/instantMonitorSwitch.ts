import { qualityResultKey, type QualityResult, type QualitySample } from './quality';
import { rebaseInstantMonitorCheckpoint } from './instantMonitorSwitchCheckpoint';
import { instantMonitorTemplateIssue, type InstantMonitorPlanChoice, type InstantMonitorSettings } from './instantMonitorSettings';
import { isLegacyQualityPlan } from './qualityLegacyEngine';

export function instantMonitorSwitchIssue(choice: InstantMonitorPlanChoice) {
  if (isLegacyQualityPlan(choice.plan) || choice.plan.initialization) {
    return '该模板须从开仓开始运行，无法接手已有持仓';
  }
  return instantMonitorTemplateIssue(choice);
}

export function rebaseInstantMonitor(sample: QualitySample, current: QualityResult, initialNotional: number,
  from: InstantMonitorSettings, to: InstantMonitorSettings, at: number): QualityResult {
  const issue = instantMonitorSwitchIssue({ id: to.templateId, name: to.name, plan: to.plan });
  if (issue) throw Error(issue);
  return rebaseInstantMonitorCheckpoint(current, initialNotional, from, to, at, qualityResultKey(sample, to.plan, 0));
}
