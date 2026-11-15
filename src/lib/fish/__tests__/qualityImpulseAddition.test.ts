import { expect, it, vi } from 'vitest';
import { findCalculatorAdditions } from '../qualityAdditionCalculator';
import { defaultStructureAddition, type StructureAdditionRule } from '../qualityAdditionStructure';
import { HOLDING_LEDGER_ADDITION_VERSION } from '../qualityHoldingLedger';
import { IMPULSE_5M_VERSION } from '@/lib/impulse5m';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { QualityAdditionFill } from '../qualityAddition';

const native = vi.hoisted(() => ({ at: 0, support: 105 }));
vi.mock('../qualityAdditionStructure', async importOriginal => {
  const real = await importOriginal<typeof import('../qualityAdditionStructure')>();
  return {
    ...real,
    createStructureAdditionReader: () => Object.assign(
      async (_: StructureAdditionRule, after: number, until: number): Promise<Omit<QualityAdditionFill,'quantity'|'notional'>|undefined> => {
        if (native.at <= after || native.at >= until) return;
        return {
          at: native.at, price: NaN, scanFrom: native.at, reading: native.support, threshold: 0, direction: '>',
          metric: 'confirmed_support', label: '防守线', barOpenTime: native.at - 300_000,
          structureEvidence: {
            algorithm: 'dbl5', trigger: 'confirm', event: 'BASELINE', eventId: 'box', boxId: 'box', episodeId: null,
            at: native.at, confirmedAt: native.at, supportPrice: native.support, upperPrice: 112, nativeInvalidation: null,
            tickSize: '0.01', algorithmVersion: 'dbl-5-v2', definitionKey: 'fixture', parameters: {},
            initializationStart: 1, dataChecksum: 'fixture', marketRuleVersion: 'fixture', kBasis: 'support',
            basePrice: native.support, bufferUnit: 'atr', buffer: 0, guardCloses: 1,
          },
        };
      }, { supports: async () => [] },
    ),
  };
});

const minute = 60_000;
const entry = Date.UTC(2026, 10, 15, 10);
const impulseAt = entry + 30 * minute;
const impulsePosition = { version: IMPULSE_5M_VERSION, bufferAtr: 0 } as const;
function fixture(prior: QualityAdditionFill[] = [], since = entry, enabled = true) {
  const end = impulseAt + 10 * minute;
  const structure = { ...defaultStructureAddition(), kSource: 'guard' as const };
  const prices: ResearchBar[] = Array.from({length:(end-entry)/minute},(_,i)=> {
    const open = entry+i*minute >= impulseAt ? 112 : 110;
    return { openTime: entry+i*minute, open, high: open+.2, low: open-.2, close: open, volume: 500, takerBuyVolume: null };
  });
  const load = vi.fn(async (_row, from: number, to: number) => Array.from({length:(to-from)/(5*minute)},(_,i):ResearchBar => {
    const openTime=from+i*5*minute, surge=openTime===impulseAt-5*minute;
    return { openTime, open: 110, high: surge?112:110.2, low: 109.9, close: surge?111.8:110, volume:500,
      quoteVolume:surge?1800:1000,takerBuyQuoteVolume:surge?1150:500,takerBuyVolume:null,ATI6H_tick_size:.01 };
  }));
  const round = { structure, candidates: [], ...(enabled ? { impulsePosition } : {}) };
  return { row:{ symbol:'FIXTUREUSDT', timeMs:entry } as never, entry, entryPrice:100, notional:100,
    end, since, load, prices:prices.filter(bar=>bar.openTime>=since), signal:new AbortController().signal, repeat:true,
    candidates:[], structure, maxRounds:2, roundRules:[round,round], previous:prior, positionVersion:HOLDING_LEDGER_ADDITION_VERSION };
}

it('uses the first fill’s K and remaining holding when the 5m impulse wins the next round, including resume', async () => {
  native.at=entry+5*minute;
  native.support=105;
  const { fills }=await findCalculatorAdditions(fixture());
  expect(fills.map(f=>f.structureEvidence?.algorithm)).toEqual(['dbl5','impulse5m']);
  expect(fills[0].quantity).toBeCloseTo(1);
  expect(fills[1]).toMatchObject({at:impulseAt,ledger:{costBefore:210},sizing:{coinsBefore:2,previousSupport:105,support:109.9}});
  expect(fills[1].quantity).toBeCloseTo((2*109.9-210)/(112-109.9));
  const resumed=await findCalculatorAdditions(fixture(fills.slice(0,1),entry+15*minute));
  expect(resumed.fills).toEqual(fills);
});

it('fills once with original position priority and tries the impulse if the original position cannot fill that minute', async () => {
  native.at=impulseAt;
  native.support=105;
  expect((await findCalculatorAdditions(fixture())).fills.map(f=>f.structureEvidence?.algorithm)).toEqual(['dbl5']);
  native.support=113;
  const result=await findCalculatorAdditions(fixture());
  expect(result.fills.map(f=>f.structureEvidence?.algorithm)).toEqual(['impulse5m']);
  expect(result.skipped?.[0].kind).toBe('below-c');
});

it('does no extra candle reads on a saved plan with the impulse disabled', async () => {
  native.at=impulseAt;
  native.support=105;
  const input=fixture([],entry,false);
  expect((await findCalculatorAdditions(input)).fills.map(f=>f.structureEvidence?.algorithm)).toEqual(['dbl5']);
  expect(input.load.mock.calls.every(call=>!(call as unknown[]).some(arg => (arg as { requiresMarketEvidence?: boolean })?.requiresMarketEvidence))).toBe(true);
});

it('keeps a shared direction gate on impulse-only rounds and takes no position without valid amount data', async () => {
  native.at=impulseAt;
  native.support=105;
  const input=fixture();
  const round={...input.roundRules[0],impulsePosition:{...impulsePosition,skipNative:true as const}};
  const blocked={...input,roundRules:[{...round,unavailable:'没有所选的探测算法'}]};
  expect((await findCalculatorAdditions(blocked)).fills).toEqual([]);
  expect(blocked.load).not.toHaveBeenCalled();
  expect((await findCalculatorAdditions({...input,roundRules:[round]})).fills[0].structureEvidence?.algorithm).toBe('impulse5m');
  const withoutAmounts=async (...args: Parameters<typeof input.load>)=> (await input.load(...args)).map(b=>({...b,quoteVolume:null,takerBuyQuoteVolume:null}));
  expect((await findCalculatorAdditions({...input,load:withoutAmounts,roundRules:[round]})).fills).toEqual([]);
});

it('uses the same holding ledger if the impulse wins from the attack lane', async () => {
  native.at=entry+5*minute;
  native.support=105;
  const input=fixture();
  const original={...input.roundRules[0],impulsePosition:undefined};
  const attack={...original,impulsePosition:{...impulsePosition,skipNative:true as const}};
  const result=await findCalculatorAdditions({...input,attackFromRound:2,roundRules:[original,{...original,alternative:attack}]});
  expect(result.fills[1]).toMatchObject({lane:'attack',ledger:{costBefore:210},sizing:{coinsBefore:2,previousSupport:105}});
});
