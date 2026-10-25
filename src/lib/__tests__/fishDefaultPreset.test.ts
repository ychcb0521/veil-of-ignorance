import { beforeEach, expect, it } from 'vitest';
import { BUILTIN_FEATURES, STATE_DEF, FEATURES_KEY } from '@/lib/deepDig/features';
import { FISH_DEFAULT_ALGORITHMS, fishCardsKey, fishDefaultCards, fishDefaultsKey, fishCombinationKey, loadFishCardsForScan, readFishCombination } from '@/lib/fish/cards';
import { fishFeatureDefinitions } from '@/lib/fish/features';
import { fishCardPlans } from '@/lib/fish/scanPlan';
import { getUserPrefix } from '@/lib/userStoragePrefix';

const available = BUILTIN_FEATURES.map(def => def.id);
beforeEach(() => localStorage.clear());

it('uses six distinct cards with the screenshot thresholds and union before the panel opens', () => {
  const cards = loadFishCardsForScan(available);
  expect(cards.map(card => [card.featureId, card.pref.statistic, card.pref.direction, card.pref.threshold])).toEqual([
    ['cbi2', '结果', '>', '0.04'], ['drift-speed-z', '结果', '>', '15'],
    ['cda', '结果', '>', '8'], ['bss', '结果', '>', '0.8'],
    ['state', 'state', '>', '0.67'], ['state', 'avg_state_2', '>', '0.6'],
  ]);
  expect(new Set(cards.map(card => card.id)).size).toBe(6);
  expect(cards.every(card => card.enabled)).toBe(true);
  expect(readFishCombination()).toBe('or');
  const compiled = fishCardPlans(cards, fishFeatureDefinitions(BUILTIN_FEATURES));
  expect(compiled.error).toBe('');
  expect(compiled.plans.map(plan => plan.statisticName)).toEqual(['avg_CBI2_2', 'avg_az_2', 'avg_CDA_2', 'avg_BSS_2', 'state', 'avg_state_2']);
  expect(compiled.plans[1].scale).toBe(100);
  expect(compiled.plans[2].settings.threshold).toBe(8);
});

it('upgrades old cards and combination once, then keeps manual thresholds and separate S series', () => {
  localStorage.setItem(fishCardsKey(), JSON.stringify([{ id: 'first', featureId: 'bss', enabled: false, pref: { statistic: '结果', direction: '<', threshold: '0.08', constraints: [] } }]));
  localStorage.setItem(fishCombinationKey(), 'and');
  const cards = fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available);
  expect(cards).toHaveLength(6);
  expect(readFishCombination()).toBe('or');
  cards[4].pref.threshold = '0.7'; cards[5].pref.threshold = '0.65';
  cards[3].pref.threshold = '0.9'; cards[5].enabled = false;
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards));
  localStorage.setItem(fishCombinationKey(), 'and');
  const reopened = fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available);
  expect(reopened.slice(4).map(card => [card.pref.statistic, card.pref.threshold])).toEqual([['state', '0.7'], ['avg_state_2', '0.65']]);
  expect(reopened[3].pref.threshold).toBe('0.9');
  expect(reopened[5].enabled).toBe(true);
  expect(loadFishCardsForScan(available)[5].enabled).toBe(false);
  expect(readFishCombination()).toBe('and');
});

it('removing one S variant does not copy the other variant into its default slot', () => {
  const cards = fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available);
  cards[5].pref.threshold = '0.72';
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards.filter(card => card.pref.statistic !== 'state')));
  const reopened = fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available);
  expect(reopened[4].pref).toMatchObject({ statistic: 'state', threshold: '0.67' });
  expect(reopened[5].pref).toMatchObject({ statistic: 'avg_state_2', threshold: '0.72' });
});

it('upgrades the saved raw-S default before an automatic scan, leaving averages and other settings intact', () => {
  const cards = loadFishCardsForScan(available);
  cards[4].pref.threshold = '0.6';
  cards[4].enabled = false;
  cards[2].pref.threshold = '12';
  localStorage.setItem(fishCardsKey(), JSON.stringify(cards));
  localStorage.setItem(fishCombinationKey(), 'and');
  localStorage.removeItem(getUserPrefix() + 'fish-state-raw-default.v1');

  const upgraded = loadFishCardsForScan(available);
  expect(upgraded[4]).toEqual({ ...cards[4], pref: { ...cards[4].pref, threshold: '0.67' } });
  expect(upgraded.filter((_, i) => i !== 4)).toEqual(cards.filter((_, i) => i !== 4));
  expect(readFishCombination()).toBe('and');
  expect(fishCardPlans(upgraded.map(card => ({ ...card, enabled: true })), fishFeatureDefinitions(BUILTIN_FEATURES)).plans[4].settings.threshold).toBe(0.67);
  expect(fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available)[4].pref.threshold).toBe('0.67');

  // An intentional edit back to 0.6 after the upgrade must survive reopening and scanning.
  upgraded[4].pref.threshold = '0.6';
  localStorage.setItem(fishCardsKey(), JSON.stringify(upgraded));
  expect(fishDefaultCards(FISH_DEFAULT_ALGORITHMS, available)[4].pref.threshold).toBe('0.6');
  expect(loadFishCardsForScan(available)[4].pref.threshold).toBe('0.6');
});

it.each([
  ['default-state-raw', '>', '0.7'],
  ['default-state-raw', '>', '0.67'],
  ['default-state-raw', '<', '0.6'],
  ['custom-state-card', '>', '0.6'],
] as const)('preserves an existing custom raw-S setting: %s %s %s', (id, direction, threshold) => {
  const cards = loadFishCardsForScan(available);
  cards[4] = { ...cards[4], id, pref: { ...cards[4].pref, direction, threshold } };
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
  expect(loadFishCardsForScan(available)).toHaveLength(6);
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
