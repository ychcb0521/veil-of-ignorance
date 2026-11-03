/** 冻结的 2026-10-31 旧引擎（见同名 .js 文件头）。只声明对外用到的几个函数。 */
import type { QualityGroup, QualityResult, QualitySample } from '../quality';
import type { QualityAdditionRule } from '../qualityAddition';
import type { FishReconstructionLoader } from '../reconstruction';

export function evaluateQualitySample(sample: QualitySample, group: QualityGroup, observeHours: number, now: number,
  load: FishReconstructionLoader, signal: AbortSignal, previous?: QualityResult): Promise<QualityResult>;
/** 旧版加仓说明（10-31 界面上的原话）。 */
export function additionLabel(rule?: QualityAdditionRule): string;
export function qualityAdditionConditions(rule?: unknown): { label: string; direction: '<' | '>'; threshold: number }[];
export function qualityAdditionAtrSettings(rule: unknown): { entryBufferAtr: number; supportOffsetAtr: number };
