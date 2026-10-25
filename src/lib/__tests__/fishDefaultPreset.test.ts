import { beforeEach, expect, it } from 'vitest';
import { BUILTIN_FEATURES, STATE_DEF, FEATURES_KEY } from '@/lib/deepDig/features';
import { FISH_DEFAULT_ALGORITHMS, fishCardsKey, fishDefaultCards, fishDefaultsKey, fishCombinationKey, loadFishCardsForScan, readFishCards, readFishCombination } from '@/lib/fish/cards';
import { fishFeatureDefinitions } from '@/lib/fish/features';
import { fishDefaultThresholdVersion } from '@/lib/fish/preferences';
import { fishCardPlans } from '@/lib/fish/scanPlan';
import { buildFishScanSettings } from '@/lib/fish/scanPlan';
import type { FishCard } from '@/components/FishAlgorithmCard';
import { getUserPrefix } from '@/lib/userStoragePrefix';

const available = BUILTIN_FEATURES.map(def => def.id);
beforeEach(() => localStorage.clear());

it('keeps five presets plus 45 added rules across reopening and automatic scan settings, capping saved overflow at 50', () => {
  const defaults = loadFishCardsForScan(available);
  const extras = Array.from({ length: 45 }, (_, i) => ({ ...defaults[0], id: `extra-${i}`,
    enabled: i !== 0, pref: { ...defaults[0].pref, threshold: (0.04 + (i + 1) / 1000).toFixed(3) } }));
  const cards = [...defaults, ...extras];
  localStorage.setItem(fishCardsKey(), JSON.stringify([...cards, { ...extras[0], id: 'overflow' }]));
  expect(readFishCards()).toEqual(cards);
  expect(fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available)).toEqual(cards);
  const scanCards = loadFishCardsForScan(available);
  expect(scanCards).toEqual(cards);
  const built = buildFishScanSettings({ cards: scanCards, defs: fishFeatureDefinitions(BUILTIN_FEATURES),
    combination: 'or', selection: { exchanges: ['binance'], includeDuplicates: false }, time: '' });
  expect(built.error).toBeUndefined();
  expect(built.settings?.algorithms).toHaveLength(50);
  expect(built.settings?.displayAlgorithmKeys).toHaveLength(49);
  // A full custom set takes priority over re-adding a removed default slot.
  const customized = [...cards.filter(card=>card.id!=='default-bss'), { ...extras[0], id: 'replacement' }];
  localStorage.setItem(fishCardsKey(), JSON.stringify(customized));
  expect(fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available)).toEqual(customized);
});

// 【用户要求】2026-10-25「渔的默认捕捞算法中，就按照这个设置」：CBI-2、avg_S、CBA、az、BSS 五条（最看重的两条在前），并集。
const LEGACY_RAW_S = { id: 'default-state-raw', featureId: 'state', enabled: true, pref: { statistic: 'state', direction: '>' as const, threshold: '0.7', constraints: [] } };
const withRawS = (threshold: string) => [...loadFishCardsForScan(available), { ...LEGACY_RAW_S, pref: { ...LEGACY_RAW_S.pref, threshold } }];

it('uses the five distinct default cards and union before the panel opens', () => {
  const cards = loadFishCardsForScan(available);
  expect(cards.map(card => [card.featureId, card.pref.statistic, card.pref.direction, card.pref.threshold])).toEqual([
    ['cbi2', '结果', '>', '0.04'], ['state', 'avg_state_2', '>', '0.6'], ['cba', '结果', '>', '8'],
    ['drift-speed-z', '结果', '>', '15'], ['bss', '结果', '>', '0.12'],
  ]);
  expect(new Set(cards.map(card => card.id)).size).toBe(5);
  expect(cards.every(card => card.enabled)).toBe(true);
  expect(readFishCombination()).toBe('or');
  const compiled = fishCardPlans(cards, fishFeatureDefinitions(BUILTIN_FEATURES));
  expect(compiled.error).toBe('');
  expect(compiled.plans.map(plan => plan.statisticName)).toEqual(['avg_CBI2_2', 'avg_state_2', 'avg_CBA_2', 'avg_az_2', 'avg_BSS_2']);
  expect(compiled.plans[1].stateHold).toBeUndefined();
  expect(compiled.plans[2].settings.threshold).toBe(8);
  expect(compiled.plans[3].scale).toBe(100);
  expect(compiled.plans[4].settings.threshold).toBe(0.12);
});

it('switches an account on the previous six-card preset once, keeping its thresholds on the cards that stay', () => {
  const p = getUserPrefix();
  const old = [
    { id: 'first', featureId: 'cbi2', enabled: false, pref: { statistic: '结果', direction: '>', threshold: '0.06', constraints: [], thresholdDefaultsVersion: fishDefaultThresholdVersion('cbi2') } },
    { id: 'default-drift-speed-z', featureId: 'drift-speed-z', enabled: true, pref: { statistic: '结果', direction: '>', threshold: '20', constraints: [], thresholdDefaultsVersion: fishDefaultThresholdVersion('drift-speed-z') } },
    { id: 'default-cda', featureId: 'cda', enabled: true, pref: { statistic: '结果', direction: '>', threshold: '8', constraints: [], thresholdDefaultsVersion: fishDefaultThresholdVersion('cda') } },
    { id: 'default-bss', featureId: 'bss', enabled: true, pref: { statistic: '结果', direction: '>', threshold: '0.08', constraints: [], thresholdDefaultsVersion: fishDefaultThresholdVersion('bss') } },
    LEGACY_RAW_S,
    { id: 'default-state-avg2', featureId: 'state', enabled: true, pref: { statistic: 'avg_state_2', direction: '>', threshold: '0.65', constraints: [] } },
  ];
  localStorage.setItem(fishCardsKey(), JSON.stringify(old));
  localStorage.setItem(p + 'fish-default-preset.v2', '1');
  localStorage.setItem(fishCombinationKey(), 'and');
  const cards = loadFishCardsForScan(available);
  expect(cards.map(card => [card.featureId, card.pref.statistic, card.pref.threshold, card.enabled])).toEqual([
    ['cbi2', '结果', '0.06', true], ['state', 'avg_state_2', '0.65', true], ['cba', '结果', '8', true],
    ['drift-speed-z', '结果', '20', true], ['bss', '结果', '0.12', true],
  ]);
  expect(readFishCombination()).toBe('or');
  // 之后的手动修改（含加回 CDA）照常保留
  const edited: FishCard[] = [...cards, old[2] as FishCard];
  localStorage.setItem(fishCardsKey(), JSON.stringify(edited));
  localStorage.setItem(fishCombinationKey(), 'and');
  expect(loadFishCardsForScan(available).map(card => card.featureId)).toEqual(['cbi2', 'state', 'cba', 'drift-speed-z', 'bss', 'cda']);
  expect(readFishCombination()).toBe('and');
  // 手动加回的 CDA 仍读图上的均值序列
  expect(fishCardPlans([edited[5]], fishFeatureDefinitions(BUILTIN_FEATURES)).plans[0].statisticName).toBe('avg_CDA_2');
});


it.each(['0.8', '0.08'])('updates the old BSS preset %s once before scanning, preserving other settings and later manual edits', (oldThreshold) => {
  const cards = loadFishCardsForScan(available);
  cards[4].pref.threshold = oldThreshold;
  cards[4].enabled = false;
  cards[0].pref.threshold = '0.12';
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards));
  localStorage.setItem(fishCombinationKey(), 'and');
  localStorage.setItem(getUserPrefix() + 'fish-bss-default.v1', '1');
  localStorage.removeItem(getUserPrefix() + 'fish-bss-default.v2');

  const upgraded = loadFishCardsForScan(available);
  expect(upgraded[4]).toEqual({ ...cards[4], pref: { ...cards[4].pref, threshold: '0.12', lastSuggestion: undefined } });
  expect(upgraded.filter((_, i) => i !== 4)).toEqual(cards.filter((_, i) => i !== 4));
  expect(fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available)[4].pref.threshold).toBe('0.12');
  expect(readFishCombination()).toBe('and');

  upgraded[4].pref.threshold = '0.8';
  localStorage.setItem(fishCardsKey(), JSON.stringify(upgraded));
  expect(loadFishCardsForScan(available)[4].pref.threshold).toBe('0.8');
  expect(fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available)[4].pref.threshold).toBe('0.8');
});

it.each([
  ['custom-bss', '结果', '>', '0.8'],
  ['default-bss', 'avg_BSS_2', '>', '0.8'],
  ['default-bss', '结果', '<', '0.8'],
  ['default-bss', '结果', '>', '0.9'],
] as const)('preserves a custom BSS setting during the correction: %s %s %s %s', (id, statistic, direction, threshold) => {
  const cards = loadFishCardsForScan(available);
  cards[4] = { ...cards[4], id, pref: { ...cards[4].pref, statistic, direction, threshold } };
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards));
  localStorage.removeItem(getUserPrefix() + 'fish-bss-default.v2');
  expect(loadFishCardsForScan(available)).toEqual(cards);
});

it('upgrades old cards and combination once, then keeps manual thresholds', () => {
  localStorage.setItem(fishCardsKey(), JSON.stringify([{ id: 'first', featureId: 'bss', enabled: false, pref: { statistic: '结果', direction: '<', threshold: '0.08', constraints: [] } }]));
  localStorage.setItem(fishCombinationKey(), 'and');
  const cards = fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available);
  expect(cards).toHaveLength(5);
  expect(readFishCombination()).toBe('or');
  cards[1].pref.threshold = '0.65';
  cards[4].pref.threshold = '0.9'; cards[1].enabled = false;
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards));
  localStorage.setItem(fishCombinationKey(), 'and');
  const reopened = fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available);
  expect(reopened[1].pref).toMatchObject({ statistic: 'avg_state_2', threshold: '0.65' });
  expect(reopened[4].pref.threshold).toBe('0.9');
  expect(reopened[1].enabled).toBe(true);
  expect(loadFishCardsForScan(available)[1].enabled).toBe(false);
  expect(readFishCombination()).toBe('and');
});

it('upgrades the saved raw-S default before an automatic scan, leaving averages and other settings intact', () => {
  const cards = withRawS('0.6');
  cards[5].enabled = false;
  cards[2].pref.threshold = '12';
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards));
  localStorage.setItem(fishCombinationKey(), 'and');
  localStorage.removeItem(getUserPrefix() + 'fish-state-raw-default.v1');
  localStorage.removeItem(getUserPrefix() + 'fish-state-raw-default.v2');

  const upgraded = loadFishCardsForScan(available);
  expect(upgraded[5]).toEqual({ ...cards[5], pref: { ...cards[5].pref, threshold: '0.7' } });
  expect(upgraded.filter((_, i) => i !== 5)).toEqual(cards.filter((_, i) => i !== 5));
  expect(readFishCombination()).toBe('and');
  expect(fishCardPlans(upgraded.map(card => ({ ...card, enabled: true })), fishFeatureDefinitions(BUILTIN_FEATURES)).plans[5].settings.threshold).toBe(0.7);

  // An intentional edit back to 0.6 after the upgrade must survive scanning.
  upgraded[5].pref.threshold = '0.6';
  localStorage.setItem(fishCardsKey(), JSON.stringify(upgraded));
  expect(loadFishCardsForScan(available)[5].pref.threshold).toBe('0.6');
});

it.each([
  ['default-state-raw', '>', '0.7'],
  ['default-state-raw', '>', '0.67'],
  ['default-state-raw', '<', '0.6'],
  ['custom-state-card', '>', '0.6'],
] as const)('preserves an existing custom raw-S setting: %s %s %s', (id, direction, threshold) => {
  const cards = withRawS('0.6');
  cards[5] = { ...cards[5], id, pref: { ...cards[5].pref, direction, threshold } };
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards));
  localStorage.removeItem(getUserPrefix() + 'fish-state-raw-default.v1');
  expect(loadFishCardsForScan(available)).toEqual(cards);
});

it('keeps the preset migration scoped to each account and leaves signal / research storage intact', () => {
  const key = getUserPrefix() + FEATURES_KEY;
  localStorage.setItem(key, 'research sentinel');
  localStorage.setItem('veil.fishSignals.v1', 'fish sentinel');
  loadFishCardsForScan(available);
  expect(localStorage.getItem(key)).toBe('research sentinel');
  expect(localStorage.getItem('veil.fishSignals.v1')).toBe('fish sentinel');
  const anonymousMarker = fishDefaultsKey();
  localStorage.setItem('sb-test-auth-token', JSON.stringify({ user: { id: 'second' } }));
  expect(fishDefaultsKey()).not.toBe(anonymousMarker);
  expect(loadFishCardsForScan(available)).toHaveLength(5);
  expect(localStorage.getItem(fishDefaultsKey())).toBe('1');
});

it('reuses chart averages without overwriting an account-defined named series or mutating definitions', () => {
  const custom = { ...STATE_DEF, formula: `${STATE_DEF.formula}\navg_state = avg(state, 24)\navg_state_2 = avg(state, 12)` };
  const original = custom.formula;
  const [prepared] = fishFeatureDefinitions([custom]);
  expect(prepared).toBe(custom);
  expect(prepared.formula).toBe(original);
  const before = JSON.stringify(BUILTIN_FEATURES);
  fishFeatureDefinitions(BUILTIN_FEATURES);
  expect(JSON.stringify(BUILTIN_FEATURES)).toBe(before);
});

it('upgrades the saved 0.67 default once without resetting other cards or later manual edits', () => {
  const cards = withRawS('0.67');
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards));
  localStorage.removeItem(getUserPrefix() + 'fish-state-raw-default.v2');
  expect(loadFishCardsForScan(available)[5].pref.threshold).toBe('0.7');
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards));
  expect(loadFishCardsForScan(available)[5].pref.threshold).toBe('0.67');
});
