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
import type { ExecutionTradeSnapshot } from "@/lib/executionAssets";
import { getConditionalTriggerDecisionFromRange } from "@/lib/conditionalOrders";
import { toast } from "sonner";
import { fetchCanonicalTimePriceAt, type CanonicalTimePrice } from "@/lib/canonicalTimePrice";

type KlinePrice = CanonicalTimePrice;

export function useBackgroundPrices() {
  const {
    sim,
    activeSymbol,
    activeSymbols,
    setPriceMap,
    ordersMap,
    setOrdersMap,
    setPositionsMap,
    setBalance,
    tradingMode,
    getEffectiveTime,
    recordExecutionTrade,
    executeReduceOnlyTrigger,
  } = useTradingContext();

  const lastPollRef = useRef<number>(0);
  const pollingRef = useRef(false);

  // Simple matching for background symbols
  const matchBackgroundOrders = useCallback(
    (symbol: string, kline: KlinePrice, orders: PendingOrder[]) => {
      const filledIds: string[] = [];

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
          // === REDUCE-ONLY (TP/SL) PATH ===
          if (order.reduceOnly && order.linkedPositionId) {
            executeReduceOnlyTrigger(symbol, order, fillPrice, getEffectiveTime(order.reduceSymbol || symbol));
            continue;
          }

          // === REGULAR OPEN PATH ===
          filledIds.push(order.id);
          const fee = calcFee(fillPrice, order.quantity, false);
          const margin = (order.quantity * fillPrice) / order.leverage;
          const positionId = crypto.randomUUID();
          const simulatedTime = getEffectiveTime(symbol);

          setBalance((prev) => prev - margin - fee);
          setPositionsMap((prev) => {
            const existing = (prev[symbol] || []).filter((position) => position.quantity > 1e-8);
            return {
              ...prev,
              [symbol]: [
                ...existing,
                {
                  id: positionId,
                  side: order.side,
                  entryPrice: fillPrice,
                  quantity: order.quantity,
                  leverage: order.leverage,
                  marginMode: order.marginMode,
                  margin,
                  isolatedMargin: order.marginMode === "isolated" ? margin : undefined,
                  openTime: simulatedTime,
                },
              ],
            };
          });
          // 执行力资产只奖励做多开仓；做空都是辅助对冲单，不计分。
          if (order.side === 'LONG') {
            const trade: ExecutionTradeSnapshot = {
              symbol,
              side: order.side,
              orderType: order.type,
              entryPrice: fillPrice,
              quantity: order.quantity,
              leverage: order.leverage,
              marginMode: order.marginMode,
              margin,
              notional: order.quantity * fillPrice,
              simulatedTime,
              positionId,
            };
            recordExecutionTrade(order.tradingMode ?? tradingMode, trade);
          }
          toast.success(`条件单已触发：${symbol} ${order.side} @ ${fillPrice.toFixed(2)}`);
        }
      }

      if (filledIds.length > 0) {
        setOrdersMap((prev) => ({
          ...prev,
          [symbol]: (prev[symbol] || []).filter((o) => !filledIds.includes(o.id)),
        }));
      }
    },
    [setBalance, setPositionsMap, setOrdersMap, executeReduceOnlyTrigger, recordExecutionTrade, tradingMode, getEffectiveTime],
  );

  const pollBackgroundSymbols = useCallback(async () => {
    if (!sim.isRunning || pollingRef.current) return;

    const now = Date.now();
    const MIN_POLL_MS = 1000;
    if (now - lastPollRef.current < MIN_POLL_MS) return;

    const priceSymbols = Array.from(new Set([...activeSymbols, activeSymbol]));
    if (priceSymbols.length === 0) return;
    // Keep refreshing the visible symbol's canonical price, but never match its
    // orders here: Index's candle engine owns that path.
    const backgroundOrderSymbols = priceSymbols.filter((symbol) => symbol !== activeSymbol);

    pollingRef.current = true;
    lastPollRef.current = now;

    try {
      const batchSize = 10;
      const newPrices: Record<string, KlinePrice> = {};

      for (let i = 0; i < priceSymbols.length; i += batchSize) {
        const batch = priceSymbols.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((sym) => {
            const effectiveTime = getEffectiveTime(sym);
            return fetchCanonicalTimePriceAt(sym, effectiveTime).then((r) => ({ sym, r })).catch(() => ({ sym, r: null }));
          }),
        );
        for (const { sym, r } of results) {
          if (r) newPrices[sym] = r;
        }
      }

      if (Object.keys(newPrices).length > 0) {
        setPriceMap((prev) => {
          const next = { ...prev };
          for (const [sym, kline] of Object.entries(newPrices)) {
            next[sym] = kline.close;
          }
          return next;
        });
      }

      for (const sym of backgroundOrderSymbols) {
        const kline = newPrices[sym];
        if (!kline) continue;
        const orders = ordersMap[sym];
        if (!orders || orders.length === 0) continue;
        matchBackgroundOrders(sym, kline, orders);
      }
    } finally {
      pollingRef.current = false;
    }
  }, [
    sim.isRunning,
    getEffectiveTime,
    activeSymbol,
    activeSymbols,
    ordersMap,
    setPriceMap,
    matchBackgroundOrders,
  ]);

  useEffect(() => {
    if (!sim.isRunning) return;
    const handle = window.setInterval(pollBackgroundSymbols, 1000);
    return () => window.clearInterval(handle);
  }, [sim.isRunning, pollBackgroundSymbols]);
}
