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
    ['cbi2','avg_CBI2_2','>','0.04'], ['cba','avg_CBA_2','>','8'],
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

it.each(['v2','v3','v4','v5','missing'])('preserves saved %s cards without replacing algorithms, thresholds, toggles or combination', version => {
  const old:FishCard[] = [{ id:'first',featureId:'state',enabled:false,pref:{statistic:'avg_state',direction:'<',threshold:'0.65',constraints:[]} }];
  const raw = JSON.stringify(old);
  localStorage.setItem(fishCardsKey(),raw);
  if(version!=='missing') localStorage.setItem(getUserPrefix()+'fish-default-preset.'+version,'1');
  localStorage.setItem(fishCombinationKey(),'or');
  expect(fishDefaultCards(FISH_DEFAULT_ALGORITHMS,available)).toEqual(old);
  expect(loadFishCardsForScan(available)).toEqual(old);
  expect(readFishCombination()).toBe('or');
  expect(localStorage.getItem(fishCardsKey())).toBe(raw);
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
  expect(loadFishCardsForScan(onlyCBI2).map(c=>[c.featureId,c.pref.statistic])).toEqual([['cbi2','avg_CBI2_2'],['cbi2','avg_CBI2']]);
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
  const pref={...loadFishCardsForScan(available)[0].pref,statistic:'结果'};
  const manual:FishCard[]= ['state','bss','drift-speed-z','cda'].map(featureId=>({id:featureId,featureId,enabled:true,pref}));
  expect(fishCardPlans(manual,defs).plans.map(p=>p.statisticName)).toEqual(['avg_state_2','avg_BSS_2','avg_az_2','avg_CDA_2']);
});

it('preserves old named sequences and threshold values even without migration markers', () => {
  const saved:FishCard[] = [
    {id:'first',featureId:'cbi2',enabled:true,pref:{statistic:'结果',direction:'>',threshold:'0.05',constraints:[]}},
    {id:'default-bss',featureId:'bss',enabled:false,pref:{statistic:'结果',direction:'<',threshold:'0.8',constraints:[]}},
    {id:'default-state-raw',featureId:'state',enabled:true,pref:{statistic:'state',direction:'>',threshold:'0.6',constraints:[]}},
  ];
  localStorage.setItem(fishCardsKey(),JSON.stringify(saved));
  expect(readFishCards()).toEqual(saved);
  expect(loadFishCardsForScan(available)).toEqual(saved);
});
