/** A single snapshot of total asset value at a point in time */
export interface AssetSnapshot {
  timestamp: number;   // ms
  totalBalance: number; // USD
}

/** Daily PnL record for calendar heatmap */
export interface DailyPnL {
  date: string;        // 'YYYY-MM-DD'
  pnl: number;         // USD, positive = profit, negative = loss
  trades: number;      // number of trades that day
}

/** Single closed trade shown inside a calendar-day drilldown. */
export interface DailyTradePnLRecord {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  action: string;
  pnl: number;
  fee: number;
  operationTime: number;
}

/** Symbol-level PnL summary for one calendar day. */
export interface DailySymbolPnL {
  symbol: string;
  pnl: number;
  trades: number;
  records: DailyTradePnLRecord[];
}

/** Calendar-day drilldown: all symbols traded on that objective operation date. */
export interface DailyPnLDetail {
  date: string;        // 'YYYY-MM-DD'
  pnl: number;
  trades: number;
  symbols: DailySymbolPnL[];
}

/** Account breakdown by type */
export interface AccountBalance {
  label: string;       // e.g. '合约', '资金', '现货'
  labelEn: string;     // e.g. 'Futures', 'Funding', 'Spot'
  balance: number;
  available: number;
  frozen: number;
}

/** Full asset state for the module */
export interface AssetState {
  totalBalance: number;
  todayPnl: number;
  todayPnlPct: number;
  accounts: AccountBalance[];
  history: AssetSnapshot[];
  dailyPnl: DailyPnL[];
  dailyPnlDetails: DailyPnLDetail[];
}
