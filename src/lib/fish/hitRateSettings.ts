import { z } from 'zod';
import type { FishCard } from '@/components/FishAlgorithmCard';
import { isSellerFeature, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { FishScanSettings } from '@/lib/fishScanner';
import { readPersistedStateRaw } from '@/lib/persistedStateStorage';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { compileFishPreference } from './scanPlan';
import { RESEARCH_INTERVALS } from '@/lib/deepRsa/marketData';
import { validateFishDownwardWick } from './downwardWick';
import { AUDITED_EXCHANGES, type FishExchange } from './exchanges';
import { validateFishHitRateWindow } from './hitRate';
import { fishProgramForLookback } from './lookback';
import { withFishDefaultThreshold } from './preferences';
import { FISH_MAX_ALGORITHMS } from './shared';
import { validateFishTurnoverSettings } from './turnoverSettings';

export const FISH_HIT_RATE_SETTINGS_KEY = 'fish-hit-rate-settings.v1';
const settingsSchema = z.object({
  version: z.literal(1),
  cards: z.array(z.object({
    id: z.string().min(1), featureId: z.string().min(1), enabled: z.boolean(),
    pref: z.object({
      direction: z.enum(['>', '<']), threshold: z.string(), statistic: z.string().optional(),
      constraints: z.array(z.object({ id: z.string(), text: z.string(), enabled: z.boolean() })),
      sellerSignVersion: z.literal(1).optional(), thresholdDefaultsVersion: z.number().optional(), lastSuggestion: z.string().optional(),
      time: z.object({interval:z.enum(RESEARCH_INTERVALS).optional(),window:z.string().optional(),avgh:z.string().optional(),hl:z.string().optional()}).optional(),
    }),
  })).min(1).max(FISH_MAX_ALGORITHMS),
  combination: z.enum(['and', 'or']),
  selection: z.object({
    exchanges: z.array(z.custom<FishExchange>(exchange => AUDITED_EXCHANGES.includes(exchange as FishExchange))).min(1),
    includeDuplicates: z.boolean(),
    includeUsStocks: z.boolean().optional(),
  }),
  downwardWick: z.object({ enabled: z.boolean(), hours: z.number().finite(), atrMultiple: z.number().finite() }),
  turnover: z.object({
    enabled: z.boolean(),
    floors: z.array(z.object({ hours: z.number().positive().finite(), min: z.number().positive().finite() })).min(1),
  }),
  window: z.object({ beforeHours: z.number().nonnegative().finite(), afterHours: z.number().nonnegative().finite() }),
});

export type FishHitRateSettings = z.infer<typeof settingsSchema>;

export function readFishHitRateSettings(value: unknown): FishHitRateSettings | null {
  const parsed = settingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readSavedFishHitRateSettings(): FishHitRateSettings {
  let value: unknown;
  try {
    value = JSON.parse(readPersistedStateRaw(getUserPrefix() + FISH_HIT_RATE_SETTINGS_KEY) ?? 'null');
  } catch { /* Unreadable settings are treated as unavailable. */ }
  const saved = readFishHitRateSettings(value);
  if (!saved) throw new Error('请先在「捕捞质量 → 漏报测试 → 测试设置」保存独立设置');
  return saved;
}

export function newHitRatePreference(featureId: string): FishCard['pref'] {
  const seller = isSellerFeature(featureId);
  return withFishDefaultThreshold(featureId, {
    direction: seller ? '<' : '>', statistic: '结果', threshold: '', constraints: [],
    ...(seller ? { sellerSignVersion: 1 } : {}),
  });
}

export function buildFishHitRateSettings(settings: FishHitRateSettings, defs: readonly DeepDigFeatureDef[]): FishScanSettings {
  const lookbackHours = validateFishHitRateWindow(settings.window);
  const downwardWick = validateFishDownwardWick(settings.downwardWick);
  const turnover = validateFishTurnoverSettings(settings.turnover);
  const turnoverFloors = turnover.enabled ? turnover.floors : [];
  if (!settings.selection.exchanges.length) throw new Error('请至少选择一家交易所');
  const algorithms = settings.cards.flatMap((card, index) => {
    if (!card.enabled) return [];
    const feature = defs.find(def => def.id === card.featureId);
    if (!feature) throw new Error(`算法 ${index + 1} 已不可用，请重新选择`);
    try {
      const plan = fishProgramForLookback(compileFishPreference(feature, card.pref), lookbackHours, turnoverFloors);
      if (plan.unavailable) throw new Error(plan.unavailable);
      return [{ feature: plan.def, algorithm: plan.settings }];
    } catch (cause) {
      throw new Error(`算法 ${index + 1}：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  });
  if (!algorithms.length) throw new Error('请启用至少一个测试算法');
  return { algorithms, combination: settings.combination, ...settings.selection, downwardWick, turnoverFloors };
}
