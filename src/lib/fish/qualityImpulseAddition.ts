import { confirmedImpulse5m, IMPULSE_5M_BASELINE, IMPULSE_5M_STEP, IMPULSE_5M_VERSION, type Impulse5mBar } from '@/lib/impulse5m';
import { dbl5TickRule } from '@/lib/dbl5m';
import { dbl5TickAt, DBL5_MARKET_RULE_VERSION } from '@/lib/dbl5mMarketRules';
import type { TradeSignal } from '@/lib/signalLibrary';
import { isTuringCupSymbol } from '@/lib/turingCupSymbol';
import { compileFishProgram, shortFishHash } from './algorithm';
import type { ImpulseAdditionPosition, QualityAdditionFill } from './qualityAddition';
import type { FishReconstructionLoader } from './reconstruction';
import { fishDelay, validateFishBars } from './shared';

type Gain = NonNullable<QualityAdditionFill['priceGate']>;
type Candidate = Omit<QualityAdditionFill, 'quantity' | 'notional'>;
type Event = { low: number; high: number; close: number; confirmedAt: number; tickSize: string; checksum: string };

export function createImpulseAdditionReader(o: { row: TradeSignal; entry: number; load: FishReconstructionLoader; signal: AbortSignal }) {
  const step = IMPULSE_5M_STEP;
  const from = Math.max(0, Math.floor(o.entry / step) * step - (IMPULSE_5M_BASELINE + 1) * step);
  let cursor = from;
  const history: Impulse5mBar[] = [];
  const events: Event[] = [];
  const unsupportedMarket = o.row.exchange != null && o.row.exchange !== 'binance' || o.row.market === 'us_stock' || isTuringCupSymbol(o.row.symbol);
  let plan: ReturnType<typeof compileFishProgram> | undefined;

  return async (rule: ImpulseAdditionPosition, after: number, until: number, gain?: Pick<Gain, 'basis' | 'referencePrice' | 'thresholdPct'>): Promise<Candidate | undefined> => {
    if (unsupportedMarket || until <= after) return;
    plan ??= { ...compileFishProgram({ id: IMPULSE_5M_VERSION, name: '急拉线', short: '急拉', formula: 'C',
      definition: '', scale: 1, unit: '', positive: '1', control: '0', interval: '5m' },
      { statistic: '结果', direction: '>', threshold: 0, constraints: [] }), requiresMarketEvidence: true };
    const cut = Math.floor((until - 1) / step) * step;
    let candidateIndex = 0;
    while (true) {
      for (; candidateIndex < events.length; candidateIndex++) {
        const event = events[candidateIndex];
        if (event.confirmedAt <= after) continue;
        if (event.confirmedAt >= until) return;
        if (gain && event.close < gain.referencePrice * (1 + gain.thresholdPct / 100)) continue;
        const id = IMPULSE_5M_VERSION + ':' + event.confirmedAt;
        return {
          at: event.confirmedAt, price: NaN, scanFrom: o.entry, reading: event.low, threshold: 0, direction: '>',
          metric: 'confirmed_support', label: '急拉线 5m · 起涨低点', featureId: IMPULSE_5M_VERSION,
          definitionKey: IMPULSE_5M_VERSION, barOpenTime: event.confirmedAt - step,
          structureEvidence: {
            algorithm: 'impulse5m', trigger: 'confirm', event: 'IMPULSE_CONFIRMED', eventId: id, boxId: id, episodeId: null,
            at: event.confirmedAt, confirmedAt: event.confirmedAt, supportPrice: event.low, upperPrice: event.high,
            nativeInvalidation: event.low, tickSize: event.tickSize, algorithmVersion: IMPULSE_5M_VERSION,
            definitionKey: IMPULSE_5M_VERSION, parameters: { ...rule }, initializationStart: from,
            dataChecksum: event.checksum, marketRuleVersion: DBL5_MARKET_RULE_VERSION,
            kBasis: 'support', basePrice: event.low, bufferUnit: 'atr', buffer: rule.bufferAtr,
          },
          ...(gain ? { priceGate: { ...gain, observedPrice: event.close,
            gainPct: (event.close / gain.referencePrice - 1) * 100, confirmedAt: event.confirmedAt } } : {}),
        };
      }
      if (cursor >= cut) return;
      const to = Math.min(cut, cursor + 64 * step);
      const bars = await o.load(o.row, cursor, to, plan, o.signal);
      validateFishBars(bars, to, (to - cursor) / step, step);
      for (const bar of bars) {
        const candle = { timestamp: bar.openTime, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
          turnover: bar.quoteVolume, takerBuyTurnover: bar.takerBuyQuoteVolume };
        if (bar.DBL5_closed === false) { history.length = 0; continue; }
        const hit = confirmedImpulse5m(candle, history.slice(-IMPULSE_5M_BASELINE), history.length > IMPULSE_5M_BASELINE ? history[0] : undefined);
        if (hit && hit.confirmedAt > o.entry) {
          const tick = dbl5TickAt(o.row.symbol, bar.openTime, bar.DBL5_tick_size ?? bar.ATI6H_tick_size ?? bar.PRS6H_tick_size, bar.PRS6H_data_source);
          if (tick != null && Number(tick) > 0 && Number.isFinite(Number(tick))) {
            events.push({ ...hit, tickSize: dbl5TickRule(tick), checksum: shortFishHash(JSON.stringify([...history, candle])) });
          }
        }
        history.push(candle);
        if (history.length > IMPULSE_5M_BASELINE + 1) history.shift();
      }
      cursor = to;
      await fishDelay(0, o.signal);
    }
  };
}
