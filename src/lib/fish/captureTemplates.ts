import type { FishCard } from '@/components/FishAlgorithmCard';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { readPersistedStateRaw } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { FISH_AUTO_INTERVALS, type FishAutoSchedule } from './autoScan';
import { FISH_CAPTURE_TEMPLATES_KEY } from './accountSettings';
import { captureCardDefinition, freezeCaptureDefinition } from './captureDefinition';
import { validateFishDownwardWick, type FishDownwardWick } from './downwardWick';
import { AUDITED_EXCHANGES } from './exchanges';
import { resolveFishCaptureLookback, validateFishLookback, type FishLookbackPreference } from './lookback';
import { buildFishScanSettings, type FishScanSelection } from './scanPlan';
import { FISH_MAX_ALGORITHMS } from './shared';
import { validateFishTurnoverSettings, type FishTurnoverSettings } from './turnoverSettings';

export interface FishCaptureTemplateSettings {
  cards: FishCard[];
  combination: 'or' | 'and';
  selection: FishScanSelection;
  lookback: FishLookbackPreference;
  schedule?: FishAutoSchedule;
  wick: FishDownwardWick;
  turnover: FishTurnoverSettings;
}

export type FishCaptureTemplate = {
  id: string;
  updatedAt: number;
} & ({ deleted: true } | { deleted?: false; version: 1; name: string; settings: FishCaptureTemplateSettings });

export function readFishCaptureTemplates(owner: string): FishCaptureTemplate[] {
  try {
    const value = JSON.parse(readPersistedStateRaw(getUserPrefix(owner) + FISH_CAPTURE_TEMPLATES_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(row => typeof row?.id === 'string' && Number.isFinite(row.updatedAt) &&
      (row.deleted === true || (typeof row.name === 'string' && row.settings != null))) : [];
  } catch {
    return [];
  }
}

export function validateFishCaptureTemplate(settings: FishCaptureTemplateSettings) {
  const { cards, selection, combination, schedule, lookback, wick, turnover } = settings;
  if (!Array.isArray(cards) || !cards.length || cards.length > FISH_MAX_ALGORITHMS ||
      !cards.every(c => c?.frozen && typeof c.id === 'string' && typeof c.enabled === 'boolean') ||
      !['and', 'or'].includes(combination) || !Array.isArray(selection?.exchanges) ||
      !selection.exchanges.every(exchange => AUDITED_EXCHANGES.includes(exchange)) ||
      typeof selection.includeDuplicates !== 'boolean' || typeof lookback?.followsInterval !== 'boolean' ||
      (schedule && (!['auto', 'manual'].includes(schedule.mode) || !FISH_AUTO_INTERVALS.includes(schedule.hours)))) {
    throw Error('捕捞模板设置无效');
  }
  cards.forEach(card => captureCardDefinition(card));
  validateFishLookback(lookback.hours);
  validateFishDownwardWick(wick);
  validateFishTurnoverSettings(turnover);
  const built = buildFishScanSettings({
    cards, defs: [], combination, selection, time: '',
    lookbackHours: resolveFishCaptureLookback(lookback, schedule),
    downwardWick: wick, turnoverFloors: turnover.enabled ? turnover.floors : [],
  });
  if (!built.settings) throw Error(built.error);
}

export function freezeFishCaptureTemplate(settings: FishCaptureTemplateSettings, defs: readonly DeepDigFeatureDef[]): FishCaptureTemplateSettings {
  const draft = structuredClone(settings);
  draft.cards = draft.cards.map((card, i) => {
    const definition = captureCardDefinition(card, defs.find(def => def.id === card.featureId));
    if (!definition) throw Error(`算法 ${i + 1} 的原公式找不到，无法保存模板`);
    return {
      ...card, frozen: card.frozen ?? freezeCaptureDefinition(definition),
      pref: { ...card.pref, lastSuggestion: undefined },
    };
  });
  validateFishCaptureTemplate(draft);
  return draft;
}
