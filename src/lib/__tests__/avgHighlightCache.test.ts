import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), messages: [] as any[], worker: undefined as any, signalCount: 30 }));
vi.mock('@/lib/avgHighlightStorage', () => ({ readAvgCache: mocks.read, writeAvgCache: mocks.write }));
vi.mock('@/lib/signalLibrary', async original => ({ ...await original() as object, loadSignals: () => Array.from({length: mocks.signalCount}, (_, i) => ({id: String(i),symbol: `TEST${i}USDT`,quality: 5,timeMs:i,timeLabel:'',fallbackZone:''})) }));
beforeEach(() => {
  vi.resetModules(); localStorage.clear(); mocks.signalCount = 30; mocks.messages.length = 0; mocks.read.mockReset().mockResolvedValue(undefined); mocks.write.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('Worker', class { onmessage: any; onerror: any; constructor() { mocks.worker = this; } postMessage(message: any) { mocks.messages.push(message); } });
});
afterEach(() => vi.unstubAllGlobals());
it('requests a cache miss only once; caches the result and separates window and averaging kind', async () => {
  const client = await import('../avgHighlightClient');
  const context = () => client.avgCalibrationContext('state',24,36,'avg');
  context(); context();
  await vi.waitFor(() => expect(mocks.messages).toHaveLength(1));
  const limits = {lower:.4,upper:.6,d:.1,count:100,above:.2,below:.2};
  mocks.worker.onmessage({data:{key:mocks.messages[0].key,limits}});
  expect(context().limits).toEqual(limits);
  context(); expect(mocks.messages).toHaveLength(1);
  client.avgCalibrationContext('state',24,36,'avg2');
  await vi.waitFor(() => expect(mocks.messages).toHaveLength(2));
  client.avgCalibrationContext('state',24,72,'avg');
  await vi.waitFor(() => expect(mocks.messages).toHaveLength(3));
});
it('fresh accounts get all shipped built-in limits without local history, IndexedDB or Binance access', async () => {
  mocks.signalCount = 0;
  mocks.read.mockRejectedValue(Error('IndexedDB unavailable'));
  const fetch = vi.fn(() => { throw Error('Binance 429'); }); vi.stubGlobal('fetch', fetch);
  const client = await import('../avgHighlightClient');
  const { AVG_HIGHLIGHT_SPECS } = await import('../avgHighlight');
  const jobs = AVG_HIGHLIGHT_SPECS.flatMap(spec => [6,24,48].flatMap(hours => (['avg','avg2'] as const).map(kind => ({ featureId: spec.featureId, period: ['bss','dss'].includes(spec.featureId) ? 12 : ['state','state2','cbi2','cdi2'].includes(spec.featureId) ? 24 : 6, hours, kind }))));
  const contexts = () => jobs.map(j => client.avgCalibrationContext(j.featureId,j.period,j.hours,j.kind));
  contexts();
  await vi.waitFor(() => expect(contexts().every(c => c.limits && c.status === '标准样本已校准')).toBe(true));
  for (const c of contexts()) { expect(c.limits!.count).toBeGreaterThan(7_000_000); expect(c.limits!.upper).toBeGreaterThan(c.limits!.lower); }
  expect(mocks.messages).toHaveLength(0); expect(mocks.read).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  const previous = contexts().map(c => c.limits);
  localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'other-account'}}));
  expect(contexts().map(c => c.limits)).toEqual(previous);
});
it('never applies built-in limits to an edited core, named average, scale or period', async () => {
  const client = await import('../avgHighlightClient');
  const { STATE_DEF } = await import('../deepDig/features');
  for (const patch of [{formula:'state = C'}, {formula:STATE_DEF.formula+'\navg_state_2 = avg(state, 6)'}, {scale:2}]) {
    localStorage.setItem('sim_anon_deep_dig_features_v1',JSON.stringify([{...STATE_DEF,...patch}]));
    const count = mocks.messages.length;
    expect(client.avgCalibrationContext('state',24,24,'avg2').limits).toBeUndefined();
    await vi.waitFor(() => expect(mocks.messages).toHaveLength(count+1));
  }
  localStorage.removeItem('sim_anon_deep_dig_features_v1');
  client.avgCalibrationContext('state',48,24,'avg2');
  await vi.waitFor(() => expect(mocks.messages).toHaveLength(4));
});
it('ships limits for the current 3 / 0.4 / 3 State formula, including its saved named averages', async () => {
  mocks.signalCount = 0;
  mocks.read.mockRejectedValue(Error('IndexedDB unavailable'));
  const { STATE_DEF } = await import('../deepDig/features');
  const client = await import('../avgHighlightClient');
  const weighted = STATE_DEF.formula.replace(/^wb = 1/m, 'wb = 3');
  const named = weighted + '\navg_state = avg(state, 24)\nm6 = avg(state, 6)\navg_state_3 = (m6 + 2 * ago(m6, 6) + 3 * ago(m6, 12) + 4 * ago(m6, 18)) / 10\navg_state_2 = (4 * m6 + 3 * ago(m6, 6) + 2 * ago(m6, 12) + ago(m6, 18)) / 10';
  for (const formula of [weighted, named]) {
    localStorage.setItem('sim_anon_deep_dig_features_v1', JSON.stringify([{ ...STATE_DEF, formula }]));
    const contexts = () => [6, 24, 48].flatMap(hours => (['avg', 'avg2'] as const).map(kind => client.avgCalibrationContext('state', 24, hours, kind)));
    contexts();
    await vi.waitFor(() => expect(contexts().every(c => c.limits && c.status === '标准样本已校准')).toBe(true));
    for (const c of contexts()) {
      expect(c.limits!.count).toBeGreaterThan(7_000_000);
      expect(c.limits!.lower).toBeLessThan(.5);
      expect(c.limits!.upper).toBeGreaterThan(.5);
    }
  }
  expect(mocks.messages).toHaveLength(0);
  expect(mocks.read).not.toHaveBeenCalled();
});
it('keeps the saved S2 formula with named averages separate from the current built-in S2 weights', async () => {
  mocks.signalCount = 0;
  const { STATE2_DEF } = await import('../deepDig/features');
  const formula = STATE2_DEF.formula.replace(/^wb = 3/m, 'wb = 1')
    + '\navg_state2 = avg(state2, 24)\nm6 = avg(state2, 6)\navg_state2_3 = (m6 + 2 * ago(m6, 6) + 3 * ago(m6, 12) + 4 * ago(m6, 18)) / 10\navg_state2_2 = (4 * m6 + 3 * ago(m6, 6) + 2 * ago(m6, 12) + ago(m6, 18)) / 10';
  localStorage.setItem('sim_anon_deep_dig_features_v1', JSON.stringify([{ ...STATE2_DEF, formula }]));
  const client = await import('../avgHighlightClient');
  const contexts = () => [6, 24, 48].flatMap(hours => (['avg', 'avg2'] as const).map(kind => client.avgCalibrationContext('state2', 24, hours, kind)));
  contexts();
  await vi.waitFor(() => expect(contexts().every(c => c.limits && c.status === '标准样本已校准')).toBe(true));
  expect(client.avgCalibrationContext('state2', 24, 24, 'avg2').limits!.upper).toBeCloseTo(.5615612241413761, 12);
  localStorage.removeItem('sim_anon_deep_dig_features_v1');
  const builtIn = () => client.avgCalibrationContext('state2', 24, 24, 'avg2');
  builtIn();
  await vi.waitFor(() => expect(builtIn().limits).toBeDefined());
  expect(builtIn().limits!.upper).toBeCloseTo(.5703257568838939, 12);
  expect(mocks.messages).toHaveLength(0);
});
it('requires an explicit sample for unknown custom formulas rather than inventing bounds', async () => {
  mocks.signalCount=0;
  const { STATE_DEF } = await import('../deepDig/features');
  localStorage.setItem('sim_anon_deep_dig_features_v1',JSON.stringify([{...STATE_DEF,formula:'state = C'}]));
  const client = await import('../avgHighlightClient');
  const context = () => client.avgCalibrationContext('state',24,24,'avg2');context();
  await vi.waitFor(() => expect(context().status).toBe('需要30个已评分标的才能校准'));
  expect(context().limits).toBeUndefined();expect(mocks.messages).toHaveLength(0);
});
