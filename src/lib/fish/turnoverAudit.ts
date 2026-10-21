/**
 * 复核库里的鱼：每条鱼信号前 1h / 12h / 24h 的 USDT 成交额是否达到捕捞门槛。
 * 【用户要求】2026-10-21「捕捉到的一些标的存在 24 小时交易额小于 1000w USDT 的，是什么原因？请你想办法解决」
 * 以前门槛只查截止前，起点之后才放量的币也成了鱼；加门槛之前捕到的鱼也没查过。这里按信号时刻重新取数核对，
 * 不达标的列出来，由用户确认删除（鱼只要没删就一直留着，不自动删）。
 */
import type { TradeSignal } from '@/lib/signalLibrary';
import type { SignalTurnoverRow } from '@/lib/signalTurnover';
import { FISH_TURNOVER_FLOORS, describeTurnoverMiss, type FishTurnoverFloor } from './shared';

/** ok：true 达标、false 不达标、null 取不到数（text 写原因）。 */
export interface FishTurnoverVerdict { ok: boolean | null; text: string }
const keyOf = (x: { exchange?: string; market?: string; symbol: string; timeMs: number }) => `${x.exchange ?? 'binance'}|${x.market ?? 'crypto'}|${x.symbol}|${x.timeMs}`;

export function auditFishTurnover(fish: readonly TradeSignal[], rows: readonly SignalTurnoverRow[], floors: readonly FishTurnoverFloor[] = FISH_TURNOVER_FLOORS): Map<string, FishTurnoverVerdict> {
  const byKey = new Map(rows.map(r => [keyOf(r), r]));
  const out = new Map<string, FishTurnoverVerdict>();
  for (const s of fish) {
    const r = byKey.get(keyOf(s));
    if (!r) continue;
    if (!r.windows) { out.set(s.id, { ok: null, text: r.reason ?? '取不到成交额' }); continue; }
    const checks = floors.map(f => { const value = r.windows![f.hours as keyof typeof r.windows] ?? NaN; return { ...f, value, ok: value >= f.min }; });
    if (r.hours < 24 - 1e-9) { out.set(s.id, { ok: false, text: `信号时上市不足 24 小时（${Number(r.hours.toFixed(1))} 小时）` }); continue; }
    out.set(s.id, checks.every(c => c.ok) ? { ok: true, text: '' } : { ok: false, text: describeTurnoverMiss(checks) });
  }
  return out;
}
