/**
 * Background Price Polling Engine
 *
 * For symbols with active positions/orders that are NOT currently displayed on chart,
 * periodically fetches the latest kline to update prices and run matching.
 */

import { useEffect, useRef, useCallback } from "react";
import { useTradingContext } from "@/contexts/TradingContext";
import type { PendingOrder } from "@/types/trading";
import { calcFee } from "@/types/trading";
import { getConditionalTriggerDecisionFromRange } from "@/lib/conditionalOrders";
import { toast } from "sonner";

interface KlinePrice {
  high: number;
  low: number;
  close: number;
}

async function fetchLatestPrice(symbol: string, interval: string, endTime: number): Promise<KlinePrice | null> {
  try {
    const qs = new URLSearchParams({
      symbol,
      interval,
      limit: "1",
      endTime: String(endTime),
    });
    const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?${qs}`);
    if (!res.ok) return null;
    const raw: any[][] = await res.json();
    if (raw.length === 0) return null;
    return {
      high: parseFloat(raw[0][2]),
      low: parseFloat(raw[0][3]),
      close: parseFloat(raw[0][4]),
    };
  } catch {
    return null;
  }
}

/**
 * useBackgroundPrices
 *
 * Polls prices for all active symbols (those with positions or orders)
 * that are not the currently viewed symbol.
 * Also runs matching for background symbols' pending orders.
 */
export function useBackgroundPrices() {
  const {
    sim,
    activeSymbol,
    interval,
    activeSymbols,
    setPriceMap,
    ordersMap,
    setOrdersMap,
    setPositionsMap,
    setBalance,
    setTradeHistory,
  } = useTradingContext();

  const lastPollRef = useRef<number>(0);
  const pollingRef = useRef(false);

  const pollBackgroundSymbols = useCallback(async () => {
    if (!sim.isRunning || pollingRef.current) return;

    // Use 1m interval for accurate pricing instead of potentially large chart intervals
    const fetchInterval = "1m";
    const now = sim.currentSimulatedTime;
    const MIN_POLL_MS = 1000;
    if (now - lastPollRef.current < MIN_POLL_MS) return;

    // Fetch prices for ALL active symbols, including the main activeSymbol,
    // so the engine always has the precise 1m price regardless of chart interval
    const backgroundSymbols = Array.from(new Set([...activeSymbols, activeSymbol]));
    if (backgroundSymbols.length === 0) return;

    pollingRef.current = true;
    lastPollRef.current = now;

    try {
      // Fetch all background prices in parallel (max 10 concurrent)
      const batchSize = 10;
      const newPrices: Record<string, KlinePrice> = {};

      for (let i = 0; i < backgroundSymbols.length; i += batchSize) {
        const batch = backgroundSymbols.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((sym) => fetchLatestPrice(sym, fetchInterval, now).then((r) => ({ sym, r }))),
        );
        for (const { sym, r } of results) {
          if (r) newPrices[sym] = r;
        }
      }

      // Update price map
      if (Object.keys(newPrices).length > 0) {
        setPriceMap((prev) => {
          const next = { ...prev };
          for (const [sym, kline] of Object.entries(newPrices)) {
            next[sym] = kline.close;
          }
          return next;
        });
      }

      // Run matching for ALL symbols using precise 1m data
      for (const sym of backgroundSymbols) {
        const kline = newPrices[sym];
        if (!kline) continue;
        const orders = ordersMap[sym];
        if (!orders || orders.length === 0) continue;

        matchBackgroundOrders(sym, kline, orders);
      }
    } finally {
      pollingRef.current = false;
    }
  }, [sim.isRunning, sim.currentSimulatedTime, activeSymbol, activeSymbols, ordersMap]);

  // Simple matching for background symbols (limit/stop orders only)
  const matchBackgroundOrders = useCallback(
    (symbol: string, kline: KlinePrice, orders: PendingOrder[]) => {
      const filledIds: string[] = [];
      const cleanupIds: string[] = [];

      for (const order of orders) {
        let triggered = false;
        let fillPrice = 0;

        if (order.type === "LIMIT" || order.type === "POST_ONLY") {
          if (order.side === "LONG" && kline.low <= order.price) {
            triggered = true;
            fillPrice = order.price;
          } else if (order.side === "SHORT" && kline.high >= order.price) {
            triggered = true;
            fillPrice = order.price;
          }
        } else if (order.type === "MARKET_TP_SL") {
          const dir = order.triggerDirection || (order.side === "LONG" ? "UP" : "DOWN");
          if (dir === "UP" && kline.high >= order.stopPrice) {
            triggered = true;
            fillPrice = order.stopPrice;
          } else if (dir === "DOWN" && kline.low <= order.stopPrice) {
            triggered = true;
            fillPrice = order.stopPrice;
          }
        } else if (order.type === "LIMIT_TP_SL") {
          const dir = order.triggerDirection || (order.side === "LONG" ? "UP" : "DOWN");
          const triggerHit =
            (dir === "UP" && kline.high >= order.stopPrice) || (dir === "DOWN" && kline.low <= order.stopPrice);
          if (triggerHit) {
            if (order.side === "LONG" && kline.low <= order.price) {
              triggered = true;
              fillPrice = order.price;
            } else if (order.side === "SHORT" && kline.high >= order.price) {
              triggered = true;
              fillPrice = order.price;
            }
          }
        } else if (order.type === "CONDITIONAL") {
          if (order.status !== "PENDING") {
            continue;
          }

          const decision = getConditionalTriggerDecisionFromRange(order, kline);
          if (decision?.triggered) {
            triggered = true;
            fillPrice = decision.triggerPriceNum;
          }
        }

        if (triggered) {
          filledIds.push(order.id);
          const fee = calcFee(fillPrice, order.quantity, false);
          const margin = (order.quantity * fillPrice) / order.leverage;

          setBalance((prev) => prev - margin - fee);
          setPositionsMap((prev) => {
            const existing = (prev[symbol] || []).filter((position) => position.quantity > 1e-8);
            return {
              ...prev,
              [symbol]: [
                ...existing,
                {
                  id: crypto.randomUUID(),
                  side: order.side,
                  entryPrice: fillPrice,
                  quantity: order.quantity,
                  leverage: order.leverage,
                  marginMode: order.marginMode,
                  margin,
                  isolatedMargin: order.marginMode === "isolated" ? margin : undefined,
                },
              ],
            };
          });
          toast.success(`条件单已触发：${symbol} ${order.side} @ ${fillPrice.toFixed(2)}`);
        }
      }

      if (filledIds.length > 0) {
        setOrdersMap((prev) => ({
          ...prev,
          [symbol]: (prev[symbol] || []).filter((o) => !filledIds.includes(o.id) && !cleanupIds.includes(o.id)),
        }));
      } else if (cleanupIds.length > 0) {
        setOrdersMap((prev) => ({
          ...prev,
          [symbol]: (prev[symbol] || []).filter((o) => !cleanupIds.includes(o.id)),
        }));
      }
    },
    [setBalance, setPositionsMap, setOrdersMap, setTradeHistory, sim.currentSimulatedTime],
  );

  // Poll on interval
  useEffect(() => {
    if (!sim.isRunning) return;
    const handle = window.setInterval(pollBackgroundSymbols, 1000);
    return () => window.clearInterval(handle);
  }, [sim.isRunning, pollBackgroundSymbols]);

  // Also check for liquidation across all symbols
  useEffect(() => {
    // Background liquidation now handled by TradingContext's liquidation engine
    // which uses priceMap (updated by this hook) against the single global balance.
  }, []);
}
