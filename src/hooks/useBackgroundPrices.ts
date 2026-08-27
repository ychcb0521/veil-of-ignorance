/**
 * Background Price Polling Engine
 *
 * For symbols with active positions/orders that are NOT currently displayed on chart,
 * periodically fetches the latest kline to update prices and run matching.
 */

import { useEffect, useRef, useCallback } from "react";
import { useTradingContext } from "@/contexts/TradingContext";
import type { PendingOrder } from "@/types/trading";
import type { ExecutionTradeSnapshot } from "@/lib/executionAssets";
import { getConditionalTriggerDecisionFromRange } from "@/lib/conditionalOrders";
import {
  executeSettlementFill,
  formatSettlementQuantity,
  getPositionNotionalUsd,
  getPositionUnits,
  isPositionOpen,
} from "@/lib/tradingSettlement";
import { upsertOrderSnapshot } from "@/lib/orderSnapshotHistory";
import { formatPrice } from "@/lib/formatters";
import { toast } from "sonner";
import { fetchCanonicalTimePriceAt, type CanonicalTimePrice } from "@/lib/canonicalTimePrice";

type KlinePrice = CanonicalTimePrice;

export function useBackgroundPrices() {
  const {
    sim,
    activeSymbol,
    activeSymbols,
    setPriceMap,
    markPriceAsOf,
    ordersMap,
    setOrdersMap,
    setPositionsMap,
    setBalance,
    setFilledOrders,
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
          //
          // 走与盘面同一个结算入口。这里**曾经自己手算**:
          //   fee    = calcFee(fillPrice, order.quantity)
          //   margin = order.quantity × fillPrice ÷ leverage
          // 那是线性合约的式子。币本位的 quantity 是**张**,名义是 张 × 面值(USD),
          // 与价无关——13291 张 RAVE 的名义是 132,910 USD,手算式给出 5,994 USD,
          // 保证金因此只收了应收的 1/22。而且建出来的仓位不带 settlementMode /
          // contracts / contractSizeUsd / marginCoin,于是此后每一处
          // getPositionNotionalUsd 都会走 U 本位分支,未实现盈亏、维持保证金、
          // 强平距离全部按错误的名义计算。
          //
          // executeSettlementFill 是纯函数,盘面撮合(Index.tsx:545,1251)用的就是它:
          // 归一化 → 滑点 → 手续费 → 保证金 → 造出带齐结算字段的 Position。
          filledIds.push(order.id);
          const simulatedTime = getEffectiveTime(symbol);
          const { fee, margin, position } = executeSettlementFill(symbol, fillPrice, order, false, simulatedTime);
          const actualFillPrice = position.entryPrice;

          // 成交快照。此前这里一处都不写,于是「非当前标的」上触发的单子
          // 在 filled_orders 里没有任何痕迹——战役页的「反向对冲挂单」
          // (journalApi.ts:2466 triggeredReverseOrders)永远看不到这些腿。
          setFilledOrders((prev) => upsertOrderSnapshot(prev, {
            id: order.id,
            symbol,
            side: order.side,
            type: order.type,
            reduceOnly: order.reduceOnly ?? false,
            reduceKind: order.reduceKind ?? null,
            linkedPositionId: order.linkedPositionId ?? null,
            price: actualFillPrice,
            triggerPrice: fillPrice,
            quantity: order.quantity,
            contracts: order.contracts,
            leverage: order.leverage,
            settlementMode: order.settlementMode,
            settlementAsset: order.settlementAsset,
            contractSizeUsd: order.contractSizeUsd,
            createdAt: order.createdAt,
            filledAt: simulatedTime,
            positionId: position.id,
          }));
          setBalance((prev) => prev - margin - fee);
          setPositionsMap((prev) => {
            // isPositionOpen 而不是 quantity > 1e-8:币本位的存量记在 contracts 上。
            const existing = (prev[symbol] || []).filter(isPositionOpen);
            return { ...prev, [symbol]: [...existing, position] };
          });
          // 执行力资产只奖励做多开仓；做空都是辅助对冲单，不计分。
          if (order.side === 'LONG') {
            const trade: ExecutionTradeSnapshot = {
              symbol,
              side: order.side,
              orderType: order.type,
              entryPrice: actualFillPrice,
              quantity: getPositionUnits(position),
              leverage: order.leverage,
              marginMode: order.marginMode,
              settlementMode: position.settlementMode,
              settlementAsset: position.settlementAsset,
              contractSizeUsd: position.contractSizeUsd,
              contracts: position.contracts,
              marginCoin: position.marginCoin,
              margin,
              notional: getPositionNotionalUsd(symbol, position, actualFillPrice),
              notionalUsd: getPositionNotionalUsd(symbol, position, actualFillPrice),
              simulatedTime,
              positionId: position.id,
            };
            recordExecutionTrade(order.tradingMode ?? tradingMode, trade);
          }
          toast.success(
            `条件单已触发：${symbol} ${order.side === 'LONG' ? '开多' : '开空'} ${formatSettlementQuantity(position, symbol)} @ ${formatPrice(actualFillPrice, symbol)}`,
          );
        }
      }

      if (filledIds.length > 0) {
        setOrdersMap((prev) => ({
          ...prev,
          [symbol]: (prev[symbol] || []).filter((o) => !filledIds.includes(o.id)),
        }));
      }
    },
    [setBalance, setPositionsMap, setOrdersMap, setFilledOrders, executeReduceOnlyTrigger, recordExecutionTrade, tradingMode, getEffectiveTime],
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
          if (!r) continue;
          newPrices[sym] = r;
          // 登记这个价属于哪一刻：用发起请求时的 effectiveTime，不是落地时刻。
          // 只给**真正取到价**的标的盖戳——取失败的（catch → r=null）保持旧戳，
          // 于是它继续被强平判据视为陈价。这是整条闸门的关键：
          // 盖戳绝不能按「结果 map 里的所有键」来，那会把陈价一起认证成新鲜的。
          markPriceAsOf(sym, getEffectiveTime(sym));
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
    markPriceAsOf,
    matchBackgroundOrders,
  ]);

  useEffect(() => {
    if (!sim.isRunning) return;
    const handle = window.setInterval(pollBackgroundSymbols, 1000);
    return () => window.clearInterval(handle);
  }, [sim.isRunning, pollBackgroundSymbols]);
}
