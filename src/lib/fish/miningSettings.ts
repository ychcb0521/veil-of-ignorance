import { z } from 'zod';
import type { FishCard } from '@/components/FishAlgorithmCard';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { RESEARCH_INTERVALS } from '@/lib/deepRsa/marketData';
import { readPersistedStateRaw, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { hydrateSimState, queueSimStatePush } from '@/lib/simStateSync';
import { getUserId, getUserPrefix } from '@/lib/userStoragePrefix';
import { readFishCards, readFishCombination } from './cards';
import { readFishDownwardWick, validateFishDownwardWick } from './downwardWick';
import { AUDITED_EXCHANGES } from './exchanges';
import { validateFishHitRateWindow } from './hitRate';
import { readSavedFishHitRateSettings } from './hitRateSettings';
import { FISH_DEFAULT_LOOKBACK_HOURS, readFishLookback, validateFishLookback } from './lookback';
import { currentDefaultRules, miningCards, readMiningState } from './mining';
import { MINING_COMBINATION } from './defaultRules';
import { MINING_STEP_MS, MINING_TIMED_ROUND_KEY, MINING_CONFIGURED_ROUND_KEY, MINING_RANGE_LOGICAL_KEY, MINING_ROUND_LOGICAL_KEY, MINING_LOGICAL_KEY, type FishMiningScanConfig, type FishMiningState } from './miningState';
import { buildFishScanSettings, type FishScanSelection } from './scanPlan';
import { FISH_MAX_ALGORITHMS, FISH_TURNOVER_FLOORS } from './shared';
import { readCaptureTurnoverSettings, validateFishTurnoverSettings } from './turnoverSettings';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MINING_SETTINGS_KEY = 'fish-mining-settings.v1';
export type FishMiningSettings = Pick<FishMiningState, 'rules' | 'target' | 'stepMs'> & {
  selection: FishScanSelection;
  scan: FishMiningScanConfig;
};

const schema = z.object({
  target: z.number().int().positive(),
  stepMs: z.number().int().min(MINUTE_MS).max(8784 * HOUR_MS),
  rules: z.array(z.object({
    id: z.string(), featureId: z.string(), statistic: z.string(), threshold: z.string(),
    direction: z.enum(['>', '<']).optional(), enabled: z.boolean().optional(),
    time: z.object({interval:z.enum(RESEARCH_INTERVALS).optional(),window:z.string().optional(),avgh:z.string().optional(),hl:z.string().optional()}).optional(),
  })).min(1).max(FISH_MAX_ALGORITHMS),
  selection: z.object({
    exchanges: z.enum(AUDITED_EXCHANGES).array().min(1),
    includeDuplicates: z.boolean(), includeUsStocks: z.boolean().optional(),
  }),
  scan: z.object({
    combination: z.enum(['and', 'or']),
    downwardWick: z.object({ enabled: z.boolean(), hours: z.number(), atrMultiple: z.number() }),
    turnover: z.object({ enabled: z.boolean(), floors: z.array(z.object({ hours: z.number(), min: z.number() })) }),
    lookbackHours: z.number().positive().max(8784).nullable().optional(),
    continuous: z.literal(true).optional(),
  }),
});

export function readMiningSettings(userId = getUserId(), strict = false): FishMiningSettings | null {
  const raw = readPersistedStateRaw(getUserPrefix(userId) + MINING_SETTINGS_KEY);
  if (raw == null) return null;
  try {
    const result = schema.parse(JSON.parse(raw));
    validateFishDownwardWick(result.scan.downwardWick);
    validateFishTurnoverSettings(result.scan.turnover);
    return { ...result, scan: { ...result.scan, lookbackHours: result.scan.lookbackHours ?? null } };
  } catch {
    if (strict) throw new Error('已保存的批量捕捞设置无法读取');
    return null;
  }
}

export async function loadMiningSettings(userId: string, capture: FishScanSelection, signal: AbortSignal) {
  const hydrate = async (keys: readonly string[]) => {
    const result = await hydrateSimState(userId, keys, signal);
    if (signal.aborted) throw signal.reason ?? new Error('读取批量捕捞设置已取消');
    if (result.status !== 'hydrated' && result.status !== 'empty') throw new Error('无法读取账号的批量捕捞设置');
  };

  await hydrate([MINING_SETTINGS_KEY]);
  const saved = readMiningSettings(userId, true);
  if (saved) return saved;
  await hydrate([MINING_TIMED_ROUND_KEY, MINING_CONFIGURED_ROUND_KEY, MINING_RANGE_LOGICAL_KEY, MINING_ROUND_LOGICAL_KEY, MINING_LOGICAL_KEY]);
  return readMiningSettings(userId, true) ?? initialMiningSettings(readMiningState({ userId, persistPresetUpgrade: false }), capture);
}

export function saveMiningSettings(settings: FishMiningSettings, userId = getUserId()) {
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

function miningRulesFromCards(cards: readonly FishCard[]): FishMiningSettings['rules'] {
  return cards.map(({ id, featureId, pref, enabled }) => ({
    id, featureId, statistic: pref.statistic ?? '结果', threshold: pref.threshold, direction: pref.direction, enabled, ...(pref.time?{time:pref.time}:{}),
  }));
}

export function copyCaptureToMining(settings: FishMiningSettings, selection: FishScanSelection): FishMiningSettings {
  const rules = miningRulesFromCards(readFishCards());
  return {
    ...settings, selection: structuredClone(selection), rules: rules.length ? rules : settings.rules,
    scan: {
      combination: readFishCombination(), downwardWick: readFishDownwardWick(),
      turnover: readCaptureTurnoverSettings(), lookbackHours: readFishLookback(),
    },
  };
}

export function copyHitRateToMining(settings: FishMiningSettings): FishMiningSettings {
  const { cards, combination, selection, downwardWick, turnover, window } = readSavedFishHitRateSettings();
  return {
    ...settings, rules: miningRulesFromCards(cards), selection,
    scan: { combination, downwardWick, turnover, lookbackHours: validateFishHitRateWindow(window) },
  };
}

export function continuousMiningSettings(settings: FishMiningSettings): FishMiningSettings {
  const hours = validateFishLookback(settings.scan.lookbackHours ?? FISH_DEFAULT_LOOKBACK_HOURS);
  // User-selected anchors are minute-aligned, as are all supported candle close times.
  const minutes = Math.max(1, Math.floor(hours * 60 + 1e-9));
  return { ...settings, stepMs: Math.min(minutes * MINUTE_MS, MINING_STEP_MS),
    scan: { ...settings.scan, continuous: true } };
}

export function buildConfiguredMiningScan(settings: FishMiningSettings, defs: readonly DeepDigFeatureDef[]) {
  if (!Number.isSafeInteger(settings.target) || settings.target <= 0) throw new Error('目标条数必须是正整数');
  if (!Number.isSafeInteger(settings.stepMs) || settings.stepMs < MINUTE_MS || settings.stepMs > 8784 * HOUR_MS) {
    throw new Error('挖掘推进设置无效，请重新开始一轮');
  }
  if (settings.scan.lookbackHours !== null) validateFishLookback(settings.scan.lookbackHours);
  const downwardWick = validateFishDownwardWick(settings.scan.downwardWick);
  const turnover = validateFishTurnoverSettings(settings.scan.turnover);
  if (!settings.selection.exchanges.length) throw new Error('请至少选择一家交易所');
  if (!settings.rules.some(rule => rule.enabled !== false)) throw new Error('请启用至少一个挖掘算法');
  if (!schema.safeParse(settings).success) throw new Error('批量捕捞设置无效，请检查输入');
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
