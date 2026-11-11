import type { FishExchange } from './exchanges';
import type { FishTurnoverCheck } from './shared';

/** Original readings from one failed liquidity check, with no additional market fetch. */
export interface FishTurnoverRejection {
  symbol: string;
  exchange: FishExchange;
  market?: 'us_stock';
  stage: 'cutoff' | 'signal-start';
  at: number;
  checks: readonly FishTurnoverCheck[];
}

export interface FishTurnoverDetail extends FishTurnoverRejection {
  algorithms: readonly string[];
}

export function fishTurnoverSymbolKey(row: FishTurnoverRejection): string {
  return JSON.stringify([row.exchange, row.market ?? 'crypto', row.symbol]);
}

export function fishTurnoverDetailKey(row: FishTurnoverRejection): string {
  return JSON.stringify([fishTurnoverSymbolKey(row), row.stage, row.at, row.checks.map(check => [check.hours, check.min, check.value])]);
}

/** Share the same evidence across algorithms when their checks were identical. */
export class FishTurnoverRejections {
  private readonly symbols = new Set<string>();
  private readonly rows = new Map<string, FishTurnoverDetail>();
  private snapshot?: FishTurnoverDetail[];

  record(memberKey: string, evidence: FishTurnoverRejection | undefined, algorithm: string) {
    this.symbols.add(memberKey);
    if (!evidence) return;
    const key = fishTurnoverDetailKey(evidence);
    const row = this.rows.get(key);
    if (row?.algorithms.includes(algorithm)) return;
    this.rows.set(key, { ...evidence, algorithms: [...(row?.algorithms ?? []), algorithm] });
    this.snapshot = undefined;
  }

  get count() { return this.symbols.size; }
  get details() { return this.snapshot ??= [...this.rows.values()]; }
}
