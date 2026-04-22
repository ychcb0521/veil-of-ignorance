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
      const idx = positions.findIndex((p) => p.id === order.linkedPositionId);
      if (idx === -1) return;
      const pos = positions[idx];
      const closeQty = Math.min(pos.quantity, order.quantity);
      if (closeQty <= 0) return;
      const pct = pos.quantity > 0 ? closeQty / pos.quantity : 1;

      const fee = calcFee(triggerPrice, closeQty, false);
      const pnl =
        pos.side === "LONG"
          ? (triggerPrice - pos.entryPrice) * closeQty
          : (pos.entryPrice - triggerPrice) * closeQty;
      const closedMargin = pos.margin * pct;
      const closedIso = pos.isolatedMargin != null ? pos.isolatedMargin * pct : undefined;
      const returnedMargin =
        pos.marginMode === "isolated" && closedIso != null ? closedIso + pnl - fee : closedMargin + pnl - fee;

      setBalance((prev) => prev + Math.max(0, returnedMargin));

      const willFullyClose = pct >= 1 || pos.quantity * (1 - pct) < 1e-8;
      const linkedId = pos.id;

      setPositionsMap((prev) => {
        const list = [...(prev[targetSymbol] || [])];
        if (willFullyClose) {
          list.splice(idx, 1);
        } else {
          const remainPct = 1 - pct;
          list[idx] = {
            ...pos,
            quantity: pos.quantity * remainPct,
            margin: pos.margin * remainPct,
            isolatedMargin: pos.isolatedMargin != null ? pos.isolatedMargin * remainPct : undefined,
          };
        }
        return { ...prev, [targetSymbol]: list.filter((p) => p.quantity > 1e-8) };
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
            const newQty = o.quantity * (1 - pct);
            if (newQty < 1e-8) {
              changed = true;
              continue;
            }
            changed = true;
            next.push({ ...o, quantity: newQty });
            continue;
          }
          next.push(o);
        }
        return changed ? { ...prev, [targetSymbol]: next } : prev;
      });

      setTradeHistory((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          symbol: targetSymbol,
          side: pos.side,
          type: "MARKET",
          action: "CLOSE",
          entryPrice: pos.entryPrice,
          exitPrice: triggerPrice,
          quantity: closeQty,
          leverage: pos.leverage,
          pnl: pnl - fee,
          fee,
          slippage: 0,
          openTime: pos.openTime || 0,
          closeTime: sim.currentSimulatedTime,
        },
      ]);

      const kindLabel = order.reduceKind === "TP" ? "止盈" : order.reduceKind === "SL" ? "止损" : "条件";
      const net = pnl - fee;
      toast.success(`${kindLabel}已触发：${targetSymbol} @ ${triggerPrice.toFixed(2)}`, {
        description: `${net >= 0 ? "+" : ""}${net.toFixed(2)} USDT`,
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
                  openTime: Date.now(),
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
          [symbol]: (prev[symbol] || []).filter((o) => !filledIds.includes(o.id)),
        }));
      }
    },
    [setBalance, setPositionsMap, setOrdersMap, executeReduceOnlyTrigger],
  );

  const pollBackgroundSymbols = useCallback(async () => {
    if (!sim.isRunning || pollingRef.current) return;

    const fetchInterval = "1m";
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
          batch.map((sym) => fetchLatestPrice(sym, fetchInterval, now).then((r) => ({ sym, r }))),
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
