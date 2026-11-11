import { z } from 'zod';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { queueSimStatePush } from '@/lib/simStateSync';
import { getUserId, getUserPrefix } from '@/lib/userStoragePrefix';
import { readFishCards, readFishCombination } from './cards';
import { readFishDownwardWick, validateFishDownwardWick } from './downwardWick';
import { AUDITED_EXCHANGES } from './exchanges';
import { readFishLookback, validateFishLookback } from './lookback';
import { currentDefaultRules, miningCards } from './mining';
import { MINING_COMBINATION } from './defaultRules';
import type { FishMiningScanConfig, FishMiningState } from './miningState';
import { buildFishScanSettings, type FishScanSelection } from './scanPlan';
import { FISH_MAX_ALGORITHMS, FISH_TURNOVER_FLOORS } from './shared';
import { readCaptureTurnoverSettings, validateFishTurnoverSettings } from './turnoverSettings';

const HOUR_MS = 3_600_000;
const MINING_SETTINGS_KEY = 'fish-mining-settings.v1';
export type FishMiningSettings = Pick<FishMiningState, 'rules' | 'target' | 'stepMs'> & {
  selection: FishScanSelection;
  scan: FishMiningScanConfig;
};

const schema = z.object({
  target: z.number().int().positive(),
  stepMs: z.number().int().min(300_000).max(8784 * HOUR_MS),
  rules: z.array(z.object({
    id: z.string(), featureId: z.string(), statistic: z.string(), threshold: z.string(),
    direction: z.enum(['>', '<']).optional(), enabled: z.boolean().optional(),
  })).min(1).max(FISH_MAX_ALGORITHMS),
  selection: z.object({
    exchanges: z.enum(AUDITED_EXCHANGES).array().min(1),
    includeDuplicates: z.boolean(), includeUsStocks: z.boolean().optional(),
  }),
  scan: z.object({
    combination: z.enum(['and', 'or']),
    downwardWick: z.object({ enabled: z.boolean(), hours: z.number(), atrMultiple: z.number() }),
    turnover: z.object({ enabled: z.boolean(), floors: z.array(z.object({ hours: z.number(), min: z.number() })) }),
    lookbackHours: z.number().positive().max(8784).nullable(),
  }),
});

export function readMiningSettings(): FishMiningSettings | null {
  try {
    const result = schema.safeParse(JSON.parse(readPersistedStateRaw(getUserPrefix() + MINING_SETTINGS_KEY) ?? 'null'));
    if (result.success) {
      validateFishDownwardWick(result.data.scan.downwardWick);
      validateFishTurnoverSettings(result.data.scan.turnover);
      return { ...result.data, scan: { ...result.data.scan, lookbackHours: result.data.scan.lookbackHours ?? null } };
    }
  } catch { /* Keep the established mining behavior if stored settings are unreadable. */ }
  return null;
}

export function saveMiningSettings(settings: FishMiningSettings) {
  const userId = getUserId();
  writePersistedStateRaw(getUserPrefix(userId) + MINING_SETTINGS_KEY, JSON.stringify(settings));
  if (userId) queueSimStatePush(userId, MINING_SETTINGS_KEY, settings);
}

export function initialMiningSettings(state: FishMiningState, capture: FishScanSelection): FishMiningSettings {
  return structuredClone({
    target: state.target,
    rules: state.rules.length ? state.rules : currentDefaultRules(),
    selection: (state.selection as FishScanSelection | undefined) ?? capture,
    stepMs: state.stepMs,
    scan: state.scan ?? {
      combination: MINING_COMBINATION, downwardWick: readFishDownwardWick(), lookbackHours: null,
      turnover: { enabled: true, floors: FISH_TURNOVER_FLOORS.map(floor => ({ ...floor })) },
    },
  });
}

export function copyCaptureToMining(settings: FishMiningSettings, selection: FishScanSelection): FishMiningSettings {
  const rules = readFishCards().map(({ id, featureId, pref, enabled }) => ({
    id, featureId, statistic: pref.statistic ?? '结果', threshold: pref.threshold, direction: pref.direction, enabled,
  }));
  return {
    ...settings, selection: structuredClone(selection), rules: rules.length ? rules : settings.rules,
    scan: {
      combination: readFishCombination(), downwardWick: readFishDownwardWick(),
      turnover: readCaptureTurnoverSettings(), lookbackHours: readFishLookback(),
    },
  };
}

export function buildConfiguredMiningScan(settings: FishMiningSettings, defs: readonly DeepDigFeatureDef[]) {
  if (!Number.isSafeInteger(settings.target) || settings.target <= 0) throw new Error('目标条数必须是正整数');
  if (!Number.isSafeInteger(settings.stepMs) || settings.stepMs < 300_000 || settings.stepMs > 8784 * HOUR_MS) {
    throw new Error('扫描间隔须在 5 分钟到 8784 小时之间');
  }
  if (settings.scan.lookbackHours !== null) validateFishLookback(settings.scan.lookbackHours);
  const downwardWick = validateFishDownwardWick(settings.scan.downwardWick);
  const turnover = validateFishTurnoverSettings(settings.scan.turnover);
  if (!settings.selection.exchanges.length) throw new Error('请至少选择一家交易所');
  if (!settings.rules.some(rule => rule.enabled !== false)) throw new Error('请启用至少一个挖掘算法');
  if (!schema.safeParse(settings).success) throw new Error('挖掘设置无效，请检查输入');
  const enabled = settings.rules.filter(rule => rule.enabled !== false);
  const missing = enabled.find(rule => !defs.some(def => def.id === rule.featureId));
  if (missing) throw new Error(`挖掘算法 ${missing.featureId} 已不可用`);
  const result = buildFishScanSettings({
    cards: miningCards(enabled), defs, combination: settings.scan.combination, selection: settings.selection, time: '',
    lookbackHours: settings.scan.lookbackHours, downwardWick, turnoverFloors: turnover.enabled ? turnover.floors : [],
  });
  if (!result.settings) throw new Error(result.error);
  return result.settings;
}
