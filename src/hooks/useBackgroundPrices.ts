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
import {
  POSITION_DUST_EPSILON,
  getPositionUnits,
  isCoinSettled,
  isPositionOpen,
  scaleSettlementPosition,
  settlePositionClose,
} from "@/lib/tradingSettlement";
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
    positionsMap,
    setOrdersMap,
    setPositionsMap,
    setBalance,
    setTradeHistory,
    tradingMode,
    recordExecutionTrade,
  } = useTradingContext();

  const positionsMapRef = useRef(positionsMap);
  useEffect(() => {
    positionsMapRef.current = positionsMap;
  }, [positionsMap]);

  const lastPollRef = useRef<number>(0);
  const pollingRef = useRef(false);

  // Reduce-only TP/SL execution: closes the linked position atomically + OCO
  const executeReduceOnlyTrigger = useCallback(
    (symbol: string, order: PendingOrder, triggerPrice: number) => {
      const targetSymbol = order.reduceSymbol || symbol;
      const positions = positionsMapRef.current[targetSymbol] || [];
      const linkedId = order.linkedPositionId;
      const pos = positions.find((p) => p.id === linkedId);
      if (!pos) return;
      const posUnits = getPositionUnits(pos);
      const closeUnits = Math.min(posUnits, getPositionUnits(order));
      const exitMethod = order.reduceKind === "TP" ? "tp1" : order.reduceKind === "SL" ? "sl" : "manual";
      const settledClose = settlePositionClose(
        targetSymbol,
        pos,
        triggerPrice,
        closeUnits,
        sim.currentSimulatedTime,
        exitMethod,
      );
      if (!settledClose) return;
      const { pct, remainingUnits, willFullyClose, returnedMargin, record, fillPrice, netPnl } = settledClose;

      setBalance((prev) => prev + Math.max(0, returnedMargin));

      setPositionsMap((prev) => {
        const list = prev[targetSymbol] || [];
        if (willFullyClose) {
          return { ...prev, [targetSymbol]: list.filter((p) => p.id !== linkedId && isPositionOpen(p)) };
        }
        return {
          ...prev,
          [targetSymbol]: list
            .map((p) => (p.id === linkedId ? scaleSettlementPosition(p, remainingUnits) : p))
            .filter(isPositionOpen),
        };
      });

      setOrdersMap((prev) => {
        const list = prev[targetSymbol] || [];
        let changed = false;
        const next: PendingOrder[] = [];
        for (const o of list) {
          if (o.id === order.id) {
            changed = true;
            continue;
          }
          if (o.reduceOnly && o.linkedPositionId === linkedId) {
            if (willFullyClose) {
              changed = true;
              continue;
            }
            const newQty = isCoinSettled(pos)
              ? Math.max(1, Math.round(getPositionUnits(o) * (1 - pct)))
              : getPositionUnits(o) * (1 - pct);
            if (newQty <= POSITION_DUST_EPSILON) {
              changed = true;
              continue;
            }
            changed = true;
            next.push({ ...o, quantity: newQty, contracts: isCoinSettled(pos) ? newQty : o.contracts });
            continue;
          }
          next.push(o);
        }
        return changed ? { ...prev, [targetSymbol]: next } : prev;
      });

      setTradeHistory((prev) => [...prev, record]);

      const kindLabel = order.reduceKind === "TP" ? "止盈" : order.reduceKind === "SL" ? "止损" : "条件";
      toast.success(`${kindLabel}已触发：${targetSymbol} @ ${fillPrice.toFixed(2)}`, {
        description: `${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)} USDT`,
      });
    },
    [setBalance, setPositionsMap, setOrdersMap, setTradeHistory, sim.currentSimulatedTime],
  );

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
            filledIds.push(order.id);
            executeReduceOnlyTrigger(symbol, order, fillPrice);
            continue;
          }

          // === REGULAR OPEN PATH ===
          filledIds.push(order.id);
          const fee = calcFee(fillPrice, order.quantity, false);
          const margin = (order.quantity * fillPrice) / order.leverage;
          const positionId = crypto.randomUUID();
          const simulatedTime = sim.currentSimulatedTime;

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
    [setBalance, setPositionsMap, setOrdersMap, executeReduceOnlyTrigger, recordExecutionTrade, tradingMode, sim.currentSimulatedTime],
  );

  const pollBackgroundSymbols = useCallback(async () => {
    if (!sim.isRunning || pollingRef.current) return;

    const now = sim.currentSimulatedTime;
    const MIN_POLL_MS = 1000;
    if (now - lastPollRef.current < MIN_POLL_MS) return;

    const backgroundSymbols = Array.from(new Set([...activeSymbols, activeSymbol]));
    if (backgroundSymbols.length === 0) return;

    pollingRef.current = true;
    lastPollRef.current = now;

    try {
      const batchSize = 10;
      const newPrices: Record<string, KlinePrice> = {};

      for (let i = 0; i < backgroundSymbols.length; i += batchSize) {
        const batch = backgroundSymbols.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((sym) => fetchCanonicalTimePriceAt(sym, now).then((r) => ({ sym, r })).catch(() => ({ sym, r: null }))),
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
  }, [
    sim.isRunning,
    sim.currentSimulatedTime,
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
