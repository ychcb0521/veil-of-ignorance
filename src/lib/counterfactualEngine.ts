/**
 * 反事实回放执行器（纯函数）
 * 严格 SL 优先（同 K 线触双时不假设乐观结果）
 */
import type {
  CounterfactualBranchParams,
  CounterfactualBranchResult,
} from '@/types/journal';
import type { KlineData } from '@/hooks/useBinanceData';

const DEFAULT_MAX_HOLD = 24 * 60;

function pnlForLeg(
  direction: 'long' | 'short',
  entry: number,
  exit: number,
  sizeUsdt: number,
  sizePct: number,
  leverage: number,
): number {
  const sign = direction === 'long' ? 1 : -1;
  const qty = (sizeUsdt * sizePct) / 100 / entry;
  return (exit - entry) * sign * qty * leverage;
}

export function runCounterfactual(
  klines: KlineData[],
  params: CounterfactualBranchParams,
): CounterfactualBranchResult {
  const maxHoldMin = params.max_hold_minutes ?? DEFAULT_MAX_HOLD;

  // no_entry
  if (params.direction === 'no_entry') {
    return {
      exit_time: null,
      exit_price: null,
      exit_reason: 'no_entry',
      realized_pnl_usdt: 0,
      r_multiple: 0,
      filled_tp_index: null,
      hold_duration_minutes: 0,
    };
  }

  const dir = params.direction;
  const entryTimeMs = new Date(params.entry_time).getTime();

  if (klines.length === 0) {
    return emptyNoData();
  }

  // Find first kline containing entry_time
  let idx = klines.findIndex((k, i) => {
    const next = klines[i + 1]?.time ?? Infinity;
    return k.time <= entryTimeMs && entryTimeMs < next;
  });
  if (idx === -1) {
    // entry_time before first kline
    if (entryTimeMs < klines[0].time) idx = 0;
    else return emptyNoData();
  }

  const entryPriceInput = params.entry_price;
  if (entryPriceInput == null || entryPriceInput <= 0) return emptyNoData();

  let entryPrice = entryPriceInput;
  let actualEntryTimeMs = entryTimeMs;
  const entryKline = klines[idx];
  if (entryPrice >= entryKline.low && entryPrice <= entryKline.high) {
    // filled at requested price within current kline
  } else {
    // Use next kline open as fill
    const nextK = klines[idx + 1];
    if (!nextK) return emptyNoData();
    idx = idx + 1;
    entryPrice = nextK.open;
    actualEntryTimeMs = nextK.time;
  }

  const sl = params.stop_loss;
  const tps = (params.take_profits || []).filter(t => t.price > 0 && t.size_pct > 0).slice(0, 3);
  const totalPctIn = tps.reduce((s, t) => s + t.size_pct, 0);
  const remainingPct = 100; // start at 100, decrease as TPs hit
  // We'll track remaining percentages and which TPs hit
  const tpHit = new Array(tps.length).fill(false);

  const sizeUsdt = params.position_size_usdt;
  const leverage = params.leverage;

  // planned max loss for r_multiple
  let plannedMaxLoss = 0;
  if (sl != null && sl > 0) {
    plannedMaxLoss = Math.abs(entryPrice - sl) * (sizeUsdt / entryPrice) * leverage;
  }

  let realizedPnl = 0;
  let remaining = remainingPct;
  let lastExitTime: number | null = null;
  let lastExitPrice: number | null = null;
  let lastReason: CounterfactualBranchResult['exit_reason'] | null = null;
  let filledIdx: number | null = null;

  const maxHoldMs = maxHoldMin * 60_000;
  const deadline = actualEntryTimeMs + maxHoldMs;

  for (let i = idx; i < klines.length; i++) {
    const k = klines[i];
    if (k.time > deadline) break;

    // === SL FIRST (conservative) ===
    let slTriggered = false;
    if (sl != null && sl > 0) {
      if (dir === 'long' && k.low <= sl) slTriggered = true;
      if (dir === 'short' && k.high >= sl) slTriggered = true;
    }
    if (slTriggered && remaining > 0) {
      realizedPnl += pnlForLeg(dir, entryPrice, sl!, sizeUsdt, remaining, leverage);
      lastExitTime = k.time;
      lastExitPrice = sl!;
      lastReason = 'sl_hit';
      remaining = 0;
      break;
    }

    // === TPs (only if no SL hit on same candle) ===
    for (let ti = 0; ti < tps.length; ti++) {
      if (tpHit[ti]) continue;
      const tp = tps[ti];
      let tpTrig = false;
      if (dir === 'long' && k.high >= tp.price) tpTrig = true;
      if (dir === 'short' && k.low <= tp.price) tpTrig = true;
      if (!tpTrig) continue;
      const closePct = Math.min(tp.size_pct, remaining);
      if (closePct <= 0) continue;
      realizedPnl += pnlForLeg(dir, entryPrice, tp.price, sizeUsdt, closePct, leverage);
      remaining -= closePct;
      tpHit[ti] = true;
      lastExitTime = k.time;
      lastExitPrice = tp.price;
      lastReason = (`tp${ti + 1}_hit` as CounterfactualBranchResult['exit_reason']);
      filledIdx = ti;
      if (remaining <= 0.0001) break;
    }
    if (remaining <= 0.0001) break;
  }

  // timeout or end-of-data: force close remaining at last kline's close before deadline
  if (remaining > 0.0001) {
    // find last kline within deadline
    let lastK: KlineData | null = null;
    for (let i = idx; i < klines.length; i++) {
      if (klines[i].time > deadline) break;
      lastK = klines[i];
    }
    if (!lastK) {
      // no data after entry
      if (lastReason == null) return emptyNoData();
    } else {
      realizedPnl += pnlForLeg(dir, entryPrice, lastK.close, sizeUsdt, remaining, leverage);
      lastExitTime = lastK.time;
      lastExitPrice = lastK.close;
      lastReason = 'timeout';
    }
  }

  if (lastExitTime == null || lastExitPrice == null || lastReason == null) {
    return emptyNoData();
  }

  const holdMin = Math.max(0, (lastExitTime - actualEntryTimeMs) / 60_000);
  const r = plannedMaxLoss > 0 ? realizedPnl / plannedMaxLoss : 0;

  return {
    exit_time: new Date(lastExitTime).toISOString(),
    exit_price: lastExitPrice,
    exit_reason: lastReason,
    realized_pnl_usdt: Number(realizedPnl.toFixed(4)),
    r_multiple: Number(r.toFixed(4)),
    filled_tp_index: filledIdx,
    hold_duration_minutes: Math.round(holdMin),
  };
  // Avoid unused
  void totalPctIn;
}

function emptyNoData(): CounterfactualBranchResult {
  return {
    exit_time: null,
    exit_price: null,
    exit_reason: 'no_data',
    realized_pnl_usdt: 0,
    r_multiple: 0,
    filled_tp_index: null,
    hold_duration_minutes: 0,
  };
}
