import {dbl5TickRule} from './dbl5m';
/** Audited venue metadata, not a decimal-place inference from OHLC prices. */
export const DBL5_MARKET_RULE_VERSION='binance-usdm-ticks-20260427-v1';
export const DBL5_TICK_CHANGES=[{
 symbol:'RAVEUSDT',effectiveAt:Date.UTC(2026,3,27,6,30),before:'0.00001',after:'0.0001',
 source:'https://www.binance.com/en/support/announcement/detail/bb0c704f3ca344c7a8741c551dd624ce',
}] as const;
/** Only back-project a verified chain whose final rule still matches live venue metadata.
 * Unknown newer changes and other sources retain the supplied rule; off-grid data stays unavailable.
 * Supplier timestamps are opens; a candle straddling a rule change cannot mix two tick regimes.
 */
export function dbl5TickAt(symbol:string,openTime:number,current:string|number|null|undefined,source='binance-usdm'):string|number|null {
 if(current==null)return null;
 if(!['binance-usdm','binance-futures','binance-usd-m'].includes(source))return current;
 const changes=DBL5_TICK_CHANGES.filter(r=>r.symbol===symbol).sort((a,b)=>a.effectiveAt-b.effectiveAt);
 if(!changes.length||dbl5TickRule(current)!==changes.at(-1)!.after)return current;
 return changes.find(r=>openTime<r.effectiveAt)?.before??current;
}
