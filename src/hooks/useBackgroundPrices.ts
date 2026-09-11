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
  mergeFilledPosition,
} from "@/lib/tradingSettlement";
import type { PositionMergeResult } from "@/lib/tradingSettlement";
import { upsertOrderSnapshot } from "@/lib/orderSnapshotHistory";
import { formatPrice } from "@/lib/formatters";
import { toast } from '@/lib/notificationCenter';
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
    setFilledOrders,
    settleFillDebit,
    tradingMode,
    getEffectiveTime,
    recordExecutionTrade,
    executeReduceOnlyTrigger,
    applyAttachedTpSl,
    applyMergeSideEffects,
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
          const { fee, margin, position } = executeSettlementFill(symbol, fillPrice, order, false, simulatedTime, Date.now());
          const actualFillPrice = position.entryPrice;

          // 付不起就当场撤单留痕。id 已经进了 filledIds（上一行 push），
          // 所以这一单无论如何都会离开 ordersMap，不会变成一张永远挂着却成不了的单。
          if (!settleFillDebit(symbol, order, margin, fee, simulatedTime)) {
            continue;
          }

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
            createdRealAt: order.createdRealAt,
            filledAt: simulatedTime,
            filledRealAt: Date.now(),
            positionId: position.id,
          }));
          // 合并结果要带出来：合并后必须改指减仓单，否则挂在被吞并那笔上的止损
          // 会指向一个不存在的仓位 id，永不触发且无声。后台成交这一路尤其要紧——
          // 它本来就是「用户没在看的那个标的」。
          const mergeOut: { current: PositionMergeResult | null } = { current: null };
          setPositionsMap((prev) => {
            // isPositionOpen 而不是 quantity > 1e-8:币本位的存量记在 contracts 上。
            const existing = (prev[symbol] || []).filter(isPositionOpen);
            const result = mergeFilledPosition(symbol, existing, position);
            mergeOut.current = result;
            return { ...prev, [symbol]: result.positions };
          });
          if (mergeOut.current) applyMergeSideEffects(symbol, mergeOut.current);
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
          /**
           * 随单止盈止损：**并入现有仓位时不挂**，与 TradingContext 的市价/最优价路径、
           * Index 的条件单路径同一口径。
           *
           * 这里原来无条件传 `position`——也就是**被吞并的那一笔**。合并后活下来的是
           * 主力的 id，于是这张止损从诞生起就指向一个已经不存在的仓位：
           * planReduceOnlyTrigger 按 id 找不到仓位就返回 linked_position_missing 并
           * **原样保留**这张单，不撤、不改指、不报错。用户在委托列表里看得见一张
           * 永远不会触发的止损——而这条路径恰恰是「他没在看的那个标的」。
           * （改指也救不了它：applyMergeSideEffects 在它被造出来之前就跑完了。）
           * 传存活仓位同样不行：applyAttachedTpSl 按 linkedPositionId 先删后建，
           * 会悄悄抹掉主力现有的止损，而且按成数算量，「100%」会变成平掉合并后的全部。
           */
          const mergedFill = mergeOut.current;
          if (mergedFill?.absorbedFillId) {
            if (Number(order.attachedTpPrice) > 0 || Number(order.attachedSlPrice) > 0) {
              toast.warning('随单止盈/止损未挂出', {
                description: `${symbol} 本次成交已并入现有同向仓位；请在仓位上重新设置止盈止损，避免覆盖已有保护。`,
              });
            }
          } else {
            applyAttachedTpSl(symbol, mergedFill?.survivor ?? position, order);
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
    [setPositionsMap, setOrdersMap, setFilledOrders, settleFillDebit, executeReduceOnlyTrigger, applyAttachedTpSl, recordExecutionTrade, tradingMode, getEffectiveTime],
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

  /**
   * 定时器只跟「在不在播放」走，回调本身走 ref。
   *
   * 事故：这个 1 秒的 interval 从来没有触发过一次。
   * pollBackgroundSymbols 的依赖里有 getEffectiveTime，而它依赖 sim.currentSimulatedTime
   * ——播放时每 250ms 由 RAF 循环 flush 一次。于是 effect 每 250ms 重跑：
   * 清掉旧定时器、装一个新的，永远等不到第 1000ms。
   *
   * 后果不只是「价格不刷新」：非当前图表标的的委托**只在这里撮合**
   * （matchBackgroundOrders 全仓库仅此一个调用点），而强平判据又要求价格新鲜。
   * 也就是说，你切走的那些标的：止损不触发、条件单不成交、爆仓也不发生，
   * 而界面上它们的浮盈定格在最后一次看到的价上，看起来一切正常。
   *
   * 这个 bug 能活这么久，是因为它的测试把 currentSimulatedTime 写成了常量——
   * 时间不动，effect 就不重装，定时器于是「正常」触发。下面的回归测试让时间动起来。
   */
  const pollRef = useRef(pollBackgroundSymbols);
  pollRef.current = pollBackgroundSymbols;
  useEffect(() => {
    if (!sim.isRunning) return;
    const handle = window.setInterval(() => { void pollRef.current(); }, 1000);
    return () => window.clearInterval(handle);
  }, [sim.isRunning]);
}
