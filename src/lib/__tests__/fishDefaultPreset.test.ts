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

it('uses four enabled cards, intersection and the exact chart series before the panel opens', () => {
  const cards = loadFishCardsForScan(available);
  expect(cards.map(c=>[c.featureId,c.pref.statistic,c.pref.direction,c.pref.threshold])).toEqual([
    ['cbi2','结果','>','0.04'], ['cba','结果','>','8'],
    ['cbi2','avg_CBI2','>','0.04'], ['cba','avg_CBA','>','8'],
  ]);
  expect(new Set(cards.map(c=>c.id)).size).toBe(4);
  expect(cards.every(c=>c.enabled)).toBe(true);
  expect(readFishCombination()).toBe('and');
  const compiled = fishCardPlans(cards, fishFeatureDefinitions(BUILTIN_FEATURES));
  expect(compiled.error).toBe('');
  expect(compiled.plans.map(p=>p.statisticName)).toEqual(['avg_CBI2_2','avg_CBA_2','avg_CBI2','avg_CBA']);
  expect(compiled.plans.map(p=>[p.scale,p.settings.threshold])).toEqual([[1,.04],[1,8],[1,.04],[1,8]]);
  expect(new Set(compiled.plans.map(p=>p.algorithmKey)).size).toBe(4);
});

it.each(['v2','v3'])('upgrades an existing %s preset once, backs it up, and keeps subsequent manual changes', version => {
  const old = [{ id:'first',featureId:'state',enabled:false,pref:{statistic:'avg_state',direction:'<',threshold:'0.65',constraints:[]} }];
  const raw = JSON.stringify(old);
  localStorage.setItem(fishCardsKey(),raw);
  localStorage.setItem(getUserPrefix()+'fish-default-preset.'+version,'1');
  localStorage.setItem(fishCombinationKey(),'or');
  const cards = fishDefaultCards(FISH_DEFAULT_ALGORITHMS,available);
  expect(cards).toHaveLength(4);
  expect(readFishCombination()).toBe('and');
  expect(JSON.parse(localStorage.getItem(fishDefaultsKey()+'.previous')!)).toEqual({cards:raw,combination:'or'});
  const edited:FishCard[] = [cards[0],{...cards[1],enabled:false,pref:{...cards[1].pref,threshold:'12'}},cards[3],
    {...cards[0],id:'custom-cbi2',pref:{...cards[0].pref,threshold:'0.05'}}];
  localStorage.setItem(fishCardsKey(),JSON.stringify(edited));
  localStorage.setItem(fishCombinationKey(),'or');
  expect(fishDefaultCards(FISH_DEFAULT_ALGORITHMS,available)).toEqual(edited);
  expect(loadFishCardsForScan(available)).toEqual(edited);
  expect(readFishCombination()).toBe('or');
  expect(readFishCards()[0].pref.statistic).toBe('结果'); // old avg migration must not undo avg₂
  expect(JSON.parse(localStorage.getItem(fishDefaultsKey()+'.previous')!).cards).toBe(raw);
});

it('keeps four defaults plus 46 additions at the limit, without restoring deleted cards or toggles on reopen', () => {
  const defaults = loadFishCardsForScan(available);
  const extras = Array.from({length:46},(_,i)=>({...defaults[0],id:`extra-${i}`,enabled:i!==0,
    pref:{...defaults[0].pref,threshold:(.04+(i+1)/1000).toFixed(3)}}));
  const cards = [...defaults,...extras];
  localStorage.setItem(fishCardsKey(),JSON.stringify([...cards,{...extras[0],id:'overflow'}]));
  expect(readFishCards()).toEqual(cards);
  expect(fishDefaultCards(FISH_DEFAULT_ALGORITHMS,available)).toEqual(cards);
  const built = buildFishScanSettings({cards:loadFishCardsForScan(available),defs:fishFeatureDefinitions(BUILTIN_FEATURES),
    combination:readFishCombination(),selection:{exchanges:['binance'],includeDuplicates:false},time:''});
  expect(built.error).toBeUndefined();
  expect(built.settings?.algorithms).toHaveLength(50);
  expect(built.settings?.displayAlgorithmKeys).toHaveLength(49);
  const customized = [...cards.filter(c=>c.id!=='default-cba-avg'),{...extras[0],id:'replacement'}];
  localStorage.setItem(fishCardsKey(),JSON.stringify(customized));
  expect(fishDefaultCards(FISH_DEFAULT_ALGORITHMS,available)).toEqual(customized);
});

it('skips unavailable features for both repeated slots without substituting another algorithm', () => {
  const onlyCBI2 = available.filter(id=>id!=='cba');
  expect(loadFishCardsForScan(onlyCBI2).map(c=>[c.featureId,c.pref.statistic])).toEqual([['cbi2','结果'],['cbi2','avg_CBI2']]);
});

it('does not turn an explicitly empty or retired capture set into a live scan', () => {
  loadFishCardsForScan(available);
  localStorage.setItem(fishCardsKey(),'[]');
  expect(loadFishCardsForScan(available)).toEqual([]);
  localStorage.removeItem(fishDefaultsKey());
  localStorage.setItem(fishCardsKey(),JSON.stringify([{featureId:'seller-push'}]));
  expect(loadFishCardsForScan(available)).toEqual([]);
  expect(localStorage.getItem(fishDefaultsKey())).toBeNull();
});

it('keeps migration account scoped and leaves formulas, research, signals and scheduling intact', () => {
  const sentinels = {[getUserPrefix()+FEATURES_KEY]:'research sentinel','veil.fishSignals.v1':'fish sentinel',
    [getUserPrefix()+'fish-auto.v1']:'schedule sentinel'};
  for(const [key,value] of Object.entries(sentinels))localStorage.setItem(key,value);
  loadFishCardsForScan(available);
  for(const [key,value] of Object.entries(sentinels))expect(localStorage.getItem(key)).toBe(value);
  const anonymousMarker=fishDefaultsKey();
  localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'second'}}));
  expect(fishDefaultsKey()).not.toBe(anonymousMarker);
  expect(loadFishCardsForScan(available)).toHaveLength(4);
  expect(localStorage.getItem(fishDefaultsKey())).toBe('1');
});

it('keeps chart preparation for nondefault manual algorithms and preserves account-defined named series', () => {
  const custom={...STATE_DEF,formula:`${STATE_DEF.formula}\navg_state = avg(state, 24)\navg_state_2 = avg(state, 12)`};
  expect(fishFeatureDefinitions([custom])[0]).toBe(custom);
  const before=JSON.stringify(BUILTIN_FEATURES);
  const defs=fishFeatureDefinitions(BUILTIN_FEATURES);
  expect(JSON.stringify(BUILTIN_FEATURES)).toBe(before);
  const pref=loadFishCardsForScan(available)[0].pref;
  const manual:FishCard[]= ['state','bss','drift-speed-z','cda'].map(featureId=>({id:featureId,featureId,enabled:true,pref}));
  expect(fishCardPlans(manual,defs).plans.map(p=>p.statisticName)).toEqual(['avg_state_2','avg_BSS_2','avg_az_2','avg_CDA_2']);
});

it('switches saved default cards from avg₂ to avg once, keeping thresholds, toggles and custom cards', () => {
  const p = getUserPrefix();
  const saved = [
    { id: 'first', featureId: 'cbi2', enabled: true, pref: { statistic: '结果', direction: '>', threshold: '0.05', constraints: [] } },
    { id: 'default-state-avg2', featureId: 'state', enabled: false, pref: { statistic: 'avg_state_2', direction: '>', threshold: '0.62', constraints: [] } },
    { id: 'default-cba', featureId: 'cba', enabled: true, pref: { statistic: 'avg_CBA', direction: '>', threshold: '9', constraints: [] } },
    { id: 'default-drift-speed-z', featureId: 'drift-speed-z', enabled: true, pref: { statistic: '结果', direction: '>', threshold: '15', constraints: [] } },
    { id: 'default-bss', featureId: 'bss', enabled: true, pref: { statistic: '结果', direction: '>', threshold: '0.8', constraints: [] } },
    { id: 'custom', featureId: 'cbi2', enabled: true, pref: { statistic: '结果', direction: '>', threshold: '0.07', constraints: [], thresholdDefaultsVersion: fishDefaultThresholdVersion('cbi2') } },
  ];
  localStorage.setItem(fishCardsKey(), JSON.stringify(saved));
  localStorage.setItem(p + 'fish-default-preset.v3', '1');
  localStorage.setItem(p + 'fish-bss-default.v2', '1');
  const cards = readFishCards();
  expect(cards.map(c => [c.id, c.pref.statistic, c.pref.threshold, c.enabled])).toEqual([
    ['first', 'avg_CBI2', '0.05', true], ['default-state-avg2', 'avg_state', '0.62', false], ['default-cba', 'avg_CBA', '9', true],
    ['default-drift-speed-z', 'avg_az', '0.15', true], ['default-bss', 'avg_BSS', '0.8', true], ['custom', '结果', '0.07', true],
  ]);
  // 之后手动改回 avg₂ 不再被覆盖
  localStorage.setItem(fishCardsKey(), JSON.stringify(saved));
  expect(readFishCards()[0].pref.statistic).toBe('结果');
});
