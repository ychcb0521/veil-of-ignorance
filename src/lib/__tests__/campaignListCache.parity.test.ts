// @vitest-environment jsdom
/**
 * 列表缓存与逐场路径的一致性。
 *
 * 列表页首载改为：一次批量取远端 + 同一份本地快照下按标的共用预处理（回放事件只排一次序）。
 * 这条用例保证它算出来的每一行，与详情页那条「逐场取远端、逐场读本地存储」的老路径逐字段相同；
 * 并把老算法（本次优化之前的 getCampaignFullData）在同一份确定性数据上的结果留成 GOLDEN 投影：
 * 回放归属、反向委托、结算与盈亏比一旦漂移，这里先红。
 *
 * 数据刻意包含：同一标的多场、两场回放同一段行情（模拟时间重合、真实时间分开）、
 * 成交 / 腿 / 委托三路事件在同一真实时刻与模拟时刻上的并列（排序稳定性）、
 * 未盖章的老成交、跨标的的异常归类、进行中的战役与仍挂着的委托。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';
import type { CancelledOrderSnapshot, FilledOrderSnapshot, PendingOrder, TradeRecord } from '@/types/trading';

const state = vi.hoisted(() => ({
  campaigns: [] as Array<Record<string, unknown>>,
  journals: [] as Array<Record<string, unknown>>,
  requests: 0,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let range: [number, number] | undefined;
      let order: { column: string; ascending: boolean } | undefined;
      const result = () => {
        state.requests += 1;
        let rows = table === 'trade_campaigns' ? state.campaigns : table === 'trade_journals' ? state.journals : [];
        rows = rows.filter(row => filters.every(filter => filter(row)));
        if (order) {
          const { column, ascending } = order;
          rows = [...rows].sort((a, b) => {
            const x = a[column] as string; const y = b[column] as string;
            return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
          });
        }
        return { data: range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000), error: null };
      };
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return builder; },
        in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return builder; },
        order(column: string, options: { ascending: boolean }) { order = { column, ascending: options.ascending }; return builder; },
        range(from: number, to: number) { range = [from, to]; return builder; },
        single() {
          const response = result();
          return Promise.resolve({ data: response.data?.[0] ?? null, error: response.data?.length ? null : { code: 'PGRST116', message: '0 rows' } });
        },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return builder;
    },
  },
}));

// 平仓价校正是确定性的：已结束战役的主力腿按记录平仓价的 0.5% 偏移给一条校正。
vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const fetchLegExitPriceCorrections = vi.fn(async (_symbol: string, legs: TradeJournal[], records: TradeRecord[]) => {
    const main = legs.find(leg => leg.leg_role === 'main_open' && leg.post_exit_price_snapshot != null);
    const record = main ? records.find(item => item.id === main.trade_record_id) : null;
    if (!main || !record) return {};
    return { [main.id]: {
      exitPrice: record.exitPrice * 1.005, originalExitPrice: record.exitPrice,
      candleLow: record.exitPrice * 0.99, candleHigh: record.exitPrice * 1.01,
    } };
  });
  return {
    ...await importOriginal<typeof import('@/lib/campaignLegExecution')>(),
    fetchLegExitPriceCorrections,
    // 列表读的是带完整性标记的版本：沿用上面的替身，结果按拉齐了处理
    fetchLegExitPriceCorrectionsResult: vi.fn(async (symbol: string, legs: TradeJournal[], records: TradeRecord[]) => (
      { corrections: await fetchLegExitPriceCorrections(symbol, legs, records), complete: true }
    )),
  };
});

// 只为数每场重算了几次；其余照旧走真实实现（Supabase 已 mock 成内存表）。
vi.mock('@/lib/journalApi', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/journalApi')>();
  return { ...actual, getCampaignFullData: vi.fn(actual.getCampaignFullData) };
});

import { buildCampaignCardData, createCampaignListCache, type CampaignCardData } from '@/lib/campaignListCache';
import { getCampaignFullData, listAllCampaigns, readUserLocalSnapshot } from '@/lib/journalApi';
import { fetchLegExitPriceCorrections } from '@/lib/campaignLegExecution';

const USER = 'user-1';
const HOUR = 3_600_000;
const MIN = 60_000;
const SIM_BASE = Date.parse('2025-01-01T00:00:00.000Z');
const REAL_BASE = Date.parse('2025-06-01T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

interface SymbolPlan {
  symbol: string; campaigns: number; open: number; price: number;
  hedges: number; partials: number; cancelled: number; live: number;
  /** 第 replayOf[i] 场与第 i 场回放同一段行情（模拟时间重合、真实时间分开）。 */
  replays: Record<number, number>;
  noiseRecords: number; noiseFilled: number; noiseCancelled: number;
}

const PLAN: SymbolPlan[] = [
  { symbol: 'ASTERUSDT', campaigns: 8, open: 2, price: 1.2, hedges: 3, partials: 2, cancelled: 12, live: 4, replays: { 3: 2 }, noiseRecords: 150, noiseFilled: 120, noiseCancelled: 200 },
  { symbol: 'BTCUSDT', campaigns: 4, open: 1, price: 60000, hedges: 2, partials: 1, cancelled: 4, live: 2, replays: {}, noiseRecords: 40, noiseFilled: 30, noiseCancelled: 50 },
];

interface Dataset {
  campaigns: TradeCampaign[];
  journals: TradeJournal[];
  tradeHistory: TradeRecord[];
  filledOrders: FilledOrderSnapshot[];
  cancelledOrders: CancelledOrderSnapshot[];
  ordersMap: Record<string, PendingOrder[]>;
  positionsMap: Record<string, Array<{ id: string; fills: { id: string }[] }>>;
}

export function buildParityDataset(): Dataset {
  const rand = mulberry32(20260915);
  const campaigns: TradeCampaign[] = [];
  const journals: TradeJournal[] = [];
  const tradeHistory: TradeRecord[] = [];
  const filledOrders: FilledOrderSnapshot[] = [];
  const cancelledOrders: CancelledOrderSnapshot[] = [];
  const ordersMap: Record<string, PendingOrder[]> = {};
  const positionsMap: Dataset['positionsMap'] = {};
  let globalIndex = 0;

  const record = (base: Partial<TradeRecord> & Pick<TradeRecord, 'id' | 'symbol' | 'side' | 'action' | 'entryPrice' | 'exitPrice' | 'openTime' | 'closeTime'>): TradeRecord => ({
    fillId: base.id, positionId: base.id, type: 'MARKET', quantity: 100, leverage: 5,
    pnl: (base.exitPrice - base.entryPrice) * 100 * (base.side === 'LONG' ? 1 : -1), fee: 0.1, slippage: 0,
    ...base,
  } as TradeRecord);

  const leg = (base: Partial<TradeJournal> & Pick<TradeJournal, 'id' | 'campaign_id' | 'symbol' | 'leg_role' | 'direction' | 'order_kind' | 'pre_real_time' | 'pre_simulated_time'>): TradeJournal => ({
    user_id: USER, trade_record_id: null, leg_sequence: null, source: 'live', leverage: 5, position_mode: 'isolated',
    pre_entry_price: null, pre_planned_stop_loss: null, pre_planned_take_profit: null, pre_entry_reason: null,
    pre_mental_state: 3, pre_mental_trigger: null, pre_risk_awareness: null, pre_risk_management: null,
    pre_checklist_items: null, pre_checklist_passed: null, pre_position_size: 500, pre_max_loss_usdt: 10,
    pre_account_equity_usdt: 10_000,
    created_at: base.pre_real_time, updated_at: base.pre_real_time,
    ...base,
  } as TradeJournal);

  const event = (base: Partial<CampaignEvent> & Pick<CampaignEvent, 'id' | 'timestamp' | 'event_type' | 'recorded_at'>): CampaignEvent => ({
    leg_role: null, journal_id: null, trade_record_id: null, pending_order_id: null, price: null, size_usdt: null, notes: null,
    ...base,
  } as CampaignEvent);

  for (const plan of PLAN) {
    const { symbol, price } = plan;
    const symbolSpanStart = SIM_BASE + Math.floor(rand() * 5) * 24 * HOUR;
    let symbolSpanEnd = symbolSpanStart;
    const sittings: number[] = [];
    for (let i = 0; i < plan.campaigns; i += 1) {
      const id = `${symbol}-${i}`;
      const isOpen = i >= plan.campaigns - plan.open;
      const simIndex = plan.replays[i] ?? i;
      const openedMs = symbolSpanStart + simIndex * 3 * 24 * HOUR;
      const closedMs = openedMs + 2 * 24 * HOUR;
      symbolSpanEnd = Math.max(symbolSpanEnd, closedMs);
      // 每场隔 3 小时坐下来一次（超过一次坐下来的间隔），回放同一段行情的那场在现实里晚得多
      const realOpen = REAL_BASE + globalIndex * 3 * HOUR;
      sittings.push(realOpen);
      globalIndex += 1;
      const mainId = `${id}-main`;
      const mainLegId = `${id}-leg-main`;
      const p = price * (1 + (rand() - 0.5) * 0.1);
      const events: CampaignEvent[] = [];
      events.push(event({ id: `${id}-e-open`, timestamp: iso(openedMs), event_type: 'campaign_opened', recorded_at: iso(realOpen) }));

      const mainOpenTime = openedMs + 5 * MIN;
      const mainCloseTime = closedMs - 5 * MIN;
      if (!isOpen) {
        tradeHistory.push(record({
          id: mainId, symbol, side: 'LONG', action: 'CLOSE', entryPrice: p, exitPrice: p * 1.03,
          openTime: mainOpenTime, closeTime: mainCloseTime, openedRealAt: realOpen + MIN, closedRealAt: realOpen + 40 * MIN,
          exit_method: 'manual',
        }));
      } else {
        (positionsMap[symbol] ??= []).push({ id: mainId, fills: [{ id: mainId }] });
      }
      journals.push(leg({
        id: mainLegId, campaign_id: id, symbol, leg_role: 'main_open', leg_sequence: 1, direction: 'long', order_kind: 'main',
        trade_record_id: mainId, pre_entry_price: p, pre_planned_stop_loss: p * 0.98,
        pre_real_time: iso(realOpen + MIN), pre_simulated_time: iso(mainOpenTime),
        ...(isOpen ? {} : {
          post_exit_price_snapshot: p * 1.03, post_realized_pnl: p * 0.03 * 100,
          post_simulated_close_time: iso(mainCloseTime), post_real_close_time: iso(realOpen + 40 * MIN),
        }),
      }));
      events.push(event({
        id: `${id}-e-main`, timestamp: iso(mainOpenTime), event_type: 'main_opened', recorded_at: iso(realOpen + MIN),
        leg_role: 'main_open', journal_id: mainLegId, trade_record_id: mainId, price: p, size_usdt: 500,
        direction: 'long', leverage: 5, leg_sequence: 1, order_kind: 'main', open_time: iso(mainOpenTime), operation_time: iso(realOpen + MIN),
      }));

      // 对冲空单：挂单 → 触发 → 平仓。成交快照的触发时刻与成交记录的开仓时刻在两只钟上都相同（并列）
      for (let k = 0; k < plan.hedges; k += 1) {
        const hedgeId = `${id}-h${k}`;
        const legId = `${id}-leg-h${k}`;
        const orderId = `${id}-o${k}`;
        const hedgeOpen = openedMs + (k + 1) * 2 * HOUR;
        const hedgeClose = hedgeOpen + HOUR;
        const realHedge = realOpen + 2 * MIN + k * 3 * MIN;
        const hp = p * (1 - 0.01 * (k + 1));
        tradeHistory.push(record({
          id: hedgeId, symbol, side: 'SHORT', action: 'CLOSE', entryPrice: hp, exitPrice: hp * 0.995,
          openTime: hedgeOpen, closeTime: hedgeClose, openedRealAt: realHedge, closedRealAt: realHedge + MIN, exit_method: 'manual',
        }));
        journals.push(leg({
          id: legId, campaign_id: id, symbol, leg_role: k === 0 ? 'hedge_initial_a' : k === 1 ? 'hedge_initial_b' : 'hedge_rolling',
          leg_sequence: k + 2, direction: 'short', order_kind: 'hedge', trade_record_id: hedgeId,
          pre_entry_price: hp, hedge_type: 'boundary', hedge_boundary_price: hp,
          hedge_order_method: k % 2 === 0 ? 'limit_preset' : 'market_chase',
          pre_real_time: iso(realHedge), pre_simulated_time: iso(hedgeOpen),
          post_exit_price_snapshot: hp * 0.995, post_realized_pnl: hp * 0.005 * 100,
          post_simulated_close_time: iso(hedgeClose), post_real_close_time: iso(realHedge + MIN),
        } as unknown as Parameters<typeof leg>[0]));
        events.push(event({
          id: `${id}-e-hp${k}`, timestamp: iso(hedgeOpen - 30 * MIN), event_type: 'hedge_placed', recorded_at: iso(realHedge - MIN),
          leg_role: k === 0 ? 'hedge_initial_a' : k === 1 ? 'hedge_initial_b' : 'hedge_rolling', journal_id: legId,
          pending_order_id: orderId, price: hp, size_usdt: 500, direction: 'short', leverage: 5,
        }));
        events.push(event({
          id: `${id}-e-ht${k}`, timestamp: iso(hedgeOpen), event_type: 'hedge_triggered', recorded_at: iso(realHedge),
          leg_role: k === 0 ? 'hedge_initial_a' : k === 1 ? 'hedge_initial_b' : 'hedge_rolling', journal_id: legId,
          trade_record_id: hedgeId, pending_order_id: orderId, price: hp, size_usdt: 500, direction: 'short', leverage: 5,
        }));
        filledOrders.push({
          id: orderId, symbol, side: 'SHORT', type: 'CONDITIONAL', reduceOnly: false, price: hp, triggerPrice: hp,
          quantity: 100, leverage: 5, createdAt: hedgeOpen - 30 * MIN, filledAt: hedgeOpen,
          createdRealAt: realHedge - MIN, filledRealAt: realHedge, positionId: hedgeId,
        });
      }

      for (let j = 0; j < plan.partials && !isOpen; j += 1) {
        const partialClose = openedMs + 12 * HOUR + j * HOUR;
        tradeHistory.push(record({
          id: `${id}-p${j}`, fillId: `${id}-pf${j}`, positionId: mainId, symbol, side: 'LONG', action: 'CLOSE',
          entryPrice: p, exitPrice: p * (1.01 + 0.005 * j), quantity: 25,
          openTime: mainOpenTime, closeTime: partialClose, openedRealAt: realOpen + MIN, closedRealAt: realOpen + 10 * MIN + j * MIN,
          exit_method: 'tp1',
        }));
        filledOrders.push({
          id: `${id}-tp${j}`, symbol, side: 'LONG', type: 'LIMIT_TP_SL', reduceOnly: true, reduceKind: 'TP', linkedPositionId: mainId,
          price: p * (1.01 + 0.005 * j), triggerPrice: p * (1.01 + 0.005 * j), quantity: 25, leverage: 5,
          createdAt: mainOpenTime + 10 * MIN, filledAt: partialClose,
          createdRealAt: realOpen + 2 * MIN, filledRealAt: realOpen + 10 * MIN + j * MIN,
        });
        events.push(event({
          id: `${id}-e-pc${j}`, timestamp: iso(partialClose), event_type: 'main_partial_closed', recorded_at: iso(realOpen + 10 * MIN + j * MIN),
          journal_id: mainLegId, trade_record_id: `${id}-p${j}`, price: p * (1.01 + 0.005 * j), size_usdt: 125,
        }));
      }
      for (let n = 1; n <= 2; n += 1) {
        const at = openedMs + 8 * HOUR * n;
        tradeHistory.push(record({
          id: `${id}-f${n}`, positionId: mainId, symbol, side: 'LONG', action: 'FUNDING', type: 'FUNDING' as never,
          entryPrice: p, exitPrice: p, openTime: at, closeTime: at, closedRealAt: realOpen + 20 * MIN + n * MIN, pnl: -0.05,
        }));
      }

      events.push(event({
        id: `${id}-e-mtp`, timestamp: iso(mainOpenTime + 2 * MIN), event_type: 'mirror_tp_placed', recorded_at: iso(realOpen + 3 * MIN),
        leg_role: 'mirror_tp', pending_order_id: `${id}-mtp`, price: p * 1.05, size_usdt: 250, direction: 'long',
      }));

      // 撤销的委托：前 3 张记进事件流，其余只留在本地快照（跟踪止损反复重挂）
      for (let m = 0; m < plan.cancelled; m += 1) {
        const orderId = `${id}-c${m}`;
        const createdAt = openedMs + 10 * MIN + m * 10 * MIN;
        const createdRealAt = realOpen + 4 * MIN + m * 20_000;
        const opening = m % 3 === 0;
        cancelledOrders.push({
          id: orderId, symbol, side: opening ? 'SHORT' : 'LONG', type: opening ? 'CONDITIONAL' : 'TRAILING_STOP',
          reduceOnly: !opening, linkedPositionId: opening ? null : mainId,
          price: p * (opening ? 0.985 : 1.02), quantity: opening ? 100 : 50, leverage: 5,
          createdAt, cancelledAt: createdAt + 5 * MIN, createdRealAt, cancelledRealAt: createdRealAt + 10_000,
        });
        if (m < 3 && opening) {
          events.push(event({
            id: `${id}-e-cp${m}`, timestamp: iso(createdAt), event_type: 'hedge_placed', recorded_at: iso(createdRealAt),
            leg_role: 'hedge_rolling', pending_order_id: orderId, price: p * 0.985, size_usdt: 500, direction: 'short',
          }));
          events.push(event({
            id: `${id}-e-cc${m}`, timestamp: iso(createdAt + 5 * MIN), event_type: 'hedge_cancelled', recorded_at: iso(createdRealAt + 10_000),
            leg_role: 'hedge_rolling', pending_order_id: orderId, price: p * 0.985, direction: 'short',
          }));
        }
      }

      if (isOpen) {
        for (let q = 0; q < plan.live; q += 1) {
          (ordersMap[symbol] ??= []).push({
            id: `${id}-live${q}`, side: q % 2 ? 'LONG' : 'SHORT', type: 'CONDITIONAL', price: p * (q % 2 ? 1.02 : 0.98), stopPrice: p * (q % 2 ? 1.02 : 0.98),
            quantity: 50, leverage: 5, marginMode: 'isolated', status: 'NEW',
            createdAt: openedMs + HOUR + q * 5 * MIN, createdRealAt: realOpen + 30 * MIN + q * 10_000,
          } as PendingOrder);
        }
      }

      if (!isOpen) {
        events.push(event({ id: `${id}-e-close`, timestamp: iso(closedMs), event_type: 'campaign_closed', recorded_at: iso(realOpen + 40 * MIN) }));
      }
      campaigns.push({
        id, user_id: USER, campaign_code: `C-${symbol}-${i}`, symbol, direction: 'main_long',
        status: isOpen ? 'active' : 'closed_profit', strategy_template: 'custom', title: `${symbol} ${iso(openedMs).slice(0, 10)} 多战役`,
        opened_at: iso(openedMs), closed_at: isOpen ? null : iso(closedMs),
        initial_main_size_usdt: 500, initial_leverage: 5, final_realized_pnl: null, final_r_multiple: null,
        peak_unrealized_pnl: null, peak_drawdown: null, importance_weight: i % 3, notes: null,
        actual_evolution: events, deviation_notes: {}, deleted_at: null,
        created_at: iso(realOpen), updated_at: iso(realOpen + 40 * MIN),
      });
    }

    // 同标的、不属于任何战役的噪声：七成落在某次坐下来的 50 分钟里，三成散在整段现实时间
    const span = Math.max(symbolSpanEnd - symbolSpanStart, HOUR);
    const realSpan = globalIndex * 3 * HOUR;
    const noiseRealAt = () => (rand() < 0.7
      ? sittings[Math.floor(rand() * sittings.length)] + rand() * 50 * MIN
      : REAL_BASE + rand() * realSpan);
    for (let n = 0; n < plan.noiseRecords; n += 1) {
      const open = symbolSpanStart + rand() * span;
      const funding = n % 5 === 0;
      const unstamped = n % 7 === 0;
      const realAt = noiseRealAt();
      tradeHistory.push(record({
        id: `${symbol}-noise-r${n}`, symbol, side: n % 2 ? 'LONG' : 'SHORT', action: funding ? 'FUNDING' : 'CLOSE',
        type: funding ? 'FUNDING' as never : 'MARKET', entryPrice: price, exitPrice: price * (1 + (rand() - 0.5) * 0.02),
        openTime: open, closeTime: open + rand() * 3 * HOUR,
        ...(funding || unstamped ? {} : { openedRealAt: realAt }), closedRealAt: realAt + rand() * 20 * MIN,
      }));
    }
    for (let n = 0; n < plan.noiseFilled; n += 1) {
      const createdAt = symbolSpanStart + rand() * span;
      const createdRealAt = noiseRealAt();
      filledOrders.push({
        id: `${symbol}-noise-f${n}`, symbol, side: n % 2 ? 'LONG' : 'SHORT', type: n % 3 ? 'CONDITIONAL' : 'LIMIT_TP_SL',
        reduceOnly: n % 3 === 0, price, triggerPrice: price, quantity: 50, leverage: 5,
        createdAt, filledAt: createdAt + 10 * MIN, createdRealAt, filledRealAt: createdRealAt + 30_000,
      });
    }
    for (let n = 0; n < plan.noiseCancelled; n += 1) {
      const createdAt = symbolSpanStart + rand() * span;
      const createdRealAt = noiseRealAt();
      cancelledOrders.push({
        id: `${symbol}-noise-c${n}`, symbol, side: n % 2 ? 'LONG' : 'SHORT', type: n % 2 ? 'TRAILING_STOP' : 'CONDITIONAL',
        reduceOnly: n % 2 === 1, price, quantity: 50, leverage: 5,
        createdAt, cancelledAt: createdAt + 5 * MIN, createdRealAt, cancelledRealAt: createdRealAt + 10_000,
      });
    }
  }
  // 跨标的的异常归类：BTC 的一场把一条 ASTER 成交也选了进来
  journals.push({
    ...journals.find(row => row.id === 'BTCUSDT-1-leg-main')!,
    id: 'BTCUSDT-1-leg-cross', leg_role: 'standalone', leg_sequence: 9, order_kind: 'main',
    trade_record_id: 'ASTERUSDT-noise-r1', post_exit_price_snapshot: null, post_realized_pnl: null,
  } as TradeJournal);
  const shuffle = <T,>(items: T[]) => { for (let i = items.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items; };
  shuffle(tradeHistory); shuffle(filledOrders); shuffle(cancelledOrders);
  return { campaigns, journals, tradeHistory, filledOrders, cancelledOrders, ordersMap, positionsMap };
}

function seed(dataset: Dataset) {
  localStorage.clear();
  state.campaigns = dataset.campaigns as unknown as Array<Record<string, unknown>>;
  state.journals = dataset.journals as unknown as Array<Record<string, unknown>>;
  localStorage.setItem(`sim_${USER}_trade_history`, JSON.stringify(dataset.tradeHistory));
  localStorage.setItem(`sim_${USER}_orders_map`, JSON.stringify(dataset.ordersMap));
  localStorage.setItem(`sim_${USER}_cancelled_orders`, JSON.stringify(dataset.cancelledOrders));
  localStorage.setItem(`sim_${USER}_filled_orders`, JSON.stringify(dataset.filledOrders));
  localStorage.setItem(`sim_${USER}_positions_map`, JSON.stringify(dataset.positionsMap));
}

type Details = Awaited<ReturnType<typeof getCampaignFullData>>;

/** 逐场老路径：目录 + 每场自己取远端、自己读本地存储，再套同一个 buildCampaignCardData。 */
async function buildRowsTheOldWay(): Promise<{ rows: CampaignCardData[]; details: Map<string, Details> }> {
  const details = new Map<string, Details>();
  const rows: CampaignCardData[] = [];
  for (const campaign of await listAllCampaigns(USER)) {
    const full = await getCampaignFullData(campaign.id, { local: readUserLocalSnapshot(USER), heal: false });
    const corrections = await fetchLegExitPriceCorrections(full.campaign.symbol, full.legs, full.tradeRecords);
    details.set(campaign.id, full);
    rows.push(buildCampaignCardData(full, corrections));
  }
  return { rows, details };
}

const round = (value: number | null | undefined) => (value == null || !Number.isFinite(value) ? value ?? null : Number(value.toPrecision(12)));

/** 可读的投影：回放归属直接决定的反向委托 / 挂单，加上列表页展示的每个数。 */
function project(rows: CampaignCardData[], details: Map<string, Details>) {
  return [...rows].sort((a, b) => a.campaign.id.localeCompare(b.campaign.id)).map(row => {
    const full = details.get(row.campaign.id)!;
    return {
      id: row.campaign.id,
      status: row.campaign.status,
      pnl: round(row.campaign.final_realized_pnl),
      settled: row.settlement.settled,
      payoff: round(row.profitCaptureRatio),
      maxLoss: round(row.initialExpectedMaxLoss),
      drawdownPct: round(row.initialExpectedMaxDrawdownPct),
      quality: round(row.opportunityQuality),
      legs: row.legs.map(leg => leg.id).join(','),
      records: row.tradeRecords.map(record => record.id).join(','),
      pending: full.pendingOrders.map(order => order.id).join(','),
      reverse: full.reverseHedgeOrders.map(order => `${order.id}:${order.status}:${order.tradeRecordId ?? '-'}:${round(order.price)}:${order.createdAt}:${order.triggeredAt ?? '-'}:${order.cancelledAt ?? '-'}`).join(' '),
    };
  });
}

describe('campaign list cache parity with the per-campaign path', () => {
  let dataset: Dataset;
  beforeEach(() => {
    dataset = buildParityDataset();
    seed(dataset);
    state.requests = 0;
    vi.mocked(fetchLegExitPriceCorrections).mockClear();
  });

  it('every row equals the per-campaign path, field for field, corrections included', async () => {
    const old = await buildRowsTheOldWay();
    expect(old.rows).toHaveLength(12);

    const cache = createCampaignListCache(USER);
    await cache.refresh();
    const correctedCount = old.rows.filter(row => row.campaign.status !== 'active').length;
    await vi.waitFor(() => expect(cache.getSnapshot().rows.filter(row => (
      row.settlement.total !== old.rows.find(item => item.campaign.id === row.campaign.id)?.settlement.total
    ))).toHaveLength(0));
    expect(correctedCount).toBeGreaterThan(0);
    const snapshot = cache.getSnapshot();
    expect(snapshot).toMatchObject({ complete: true, failedCount: 0, error: null, total: 12 });

    const byId = (rows: CampaignCardData[]) => [...rows].sort((a, b) => a.campaign.id.localeCompare(b.campaign.id));
    expect(JSON.parse(JSON.stringify(byId(snapshot.rows)))).toEqual(JSON.parse(JSON.stringify(byId(old.rows))));
    // 行序也一致：都是「重要性优先，其余按时间倒序」
    expect(snapshot.rows.map(row => row.campaign.id)).toEqual(old.rows.map(row => row.campaign.id));
    const projection = project(old.rows, old.details);
    if (GOLDEN.length === 0) console.log(`GOLDEN=${JSON.stringify(projection)}`);
    else expect(projection).toEqual(GOLDEN);
  });

  it('a local trade-data change reconciles only that symbol without touching Supabase; an unchanged remote refresh recomputes nothing', async () => {
    const cache = createCampaignListCache(USER);
    await cache.refresh();
    await vi.waitFor(() => expect(vi.mocked(fetchLegExitPriceCorrections)).toHaveBeenCalledTimes(12));
    await new Promise(resolve => setTimeout(resolve, 0));
    const rows = cache.getSnapshot().rows;
    const seen: Array<{ refreshing: boolean; complete: boolean; loaded: number }> = [];
    cache.subscribe(() => {
      const current = cache.getSnapshot();
      seen.push({ refreshing: current.refreshing, complete: current.complete, loaded: current.loaded });
    });

    // 时间机器一次跟踪止损重挂：ASTERUSDT 多一张撤销快照（减仓单、落在所有战役之外，不改变任何一场的结果）
    state.requests = 0;
    vi.mocked(getCampaignFullData).mockClear();
    vi.mocked(fetchLegExitPriceCorrections).mockClear();
    const farAway = 400 * 24 * HOUR;
    const cancelled: CancelledOrderSnapshot[] = [...dataset.cancelledOrders, {
      id: 'tick-1', symbol: 'ASTERUSDT', side: 'LONG', type: 'TRAILING_STOP', reduceOnly: true,
      price: 1.2, quantity: 50, leverage: 5,
      createdAt: SIM_BASE + farAway, cancelledAt: SIM_BASE + farAway + 5 * MIN,
      createdRealAt: REAL_BASE + farAway, cancelledRealAt: REAL_BASE + farAway + 10_000,
    }];
    localStorage.setItem(`sim_${USER}_cancelled_orders`, JSON.stringify(cancelled));
    await cache.refresh('local');
    expect(state.requests).toBe(0);
    const recomputed = vi.mocked(getCampaignFullData).mock.calls.map(call => call[0]);
    expect(recomputed).toHaveLength(8);
    expect(recomputed.every(id => id.startsWith('ASTERUSDT-'))).toBe(true);
    // 腿与成交没变：校正沿用，不再取；结果逐字段相同的行沿用同一对象
    expect(fetchLegExitPriceCorrections).not.toHaveBeenCalled();
    const after = cache.getSnapshot().rows;
    expect(after.map(row => row.campaign.id)).toEqual(rows.map(row => row.campaign.id));
    after.forEach((row, index) => {
      if (row.campaign.symbol !== 'ASTERUSDT') expect(row).toBe(rows[index]);
      else expect(JSON.parse(JSON.stringify(row))).toEqual(JSON.parse(JSON.stringify(rows[index])));
    });
    // 本地核对不亮 refreshing，也不会让 complete 掉回去
    expect(seen.every(item => !item.refreshing && item.complete && item.loaded === 12)).toBe(true);

    // 远端没变：一次批量读取，零重算，行数组引用不变
    state.requests = 0;
    vi.mocked(getCampaignFullData).mockClear();
    await cache.refresh('remote');
    expect(state.requests).toBeGreaterThan(0);
    expect(getCampaignFullData).not.toHaveBeenCalled();
    expect(cache.getSnapshot().rows).toBe(after);
  });
});

/** 等后台的平仓价校正落地、快照不再变。 */
async function settled(cache: ReturnType<typeof createCampaignListCache>) {
  let last = '';
  for (let round = 0; round < 60; round += 1) {
    await new Promise(resolve => setTimeout(resolve, 8));
    const current = JSON.stringify(cache.getSnapshot().rows.map(row => [row.settlement.total, row.profitCaptureRatio]));
    if (current === last) return;
    last = current;
  }
}

const projectRows = (rows: CampaignCardData[]) => JSON.parse(JSON.stringify(
  [...rows].sort((a, b) => a.campaign.id.localeCompare(b.campaign.id)),
));

describe('campaign list cache under a run of local ticks', () => {
  /**
   * 时间机器跑起来时本地数据每根 K 线都在变：资金费、跟踪止损、挂 / 撤 / 成交对冲、平仓、噪声成交、撤单快照被上限淘汰……
   * 缓存只重算改动碰得到的那几场（localChangeTouchesCampaign）。这里随机打一串这样的变化，
   * 每隔几步就拿一个全新缓存的整表重算来对：逐字段相同，才说明「跳过重算」没有跳错。
   */
  it('a random run of trailing stops, fills, funding, cancels and closes keeps every row equal to a full recompute, while skipping most recomputes', async () => {
    const dataset = buildParityDataset();
    seed(dataset);
    const DAY = 24 * HOUR;
    const rand = mulberry32(7);
    const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
    type Local = { tradeHistory: TradeRecord[]; ordersMap: Record<string, PendingOrder[]>; filledOrders: FilledOrderSnapshot[]; positionsMap: Record<string, Array<{ id: string; fills: { id: string }[] }>> };
    let local: Local = {
      tradeHistory: dataset.tradeHistory, ordersMap: dataset.ordersMap, filledOrders: dataset.filledOrders, positionsMap: dataset.positionsMap,
    };
    let cancelledOrders = dataset.cancelledOrders;
    const writeCancelled = () => localStorage.setItem(`sim_${USER}_cancelled_orders`, JSON.stringify(cancelledOrders));
    const cache = createCampaignListCache(USER);
    await cache.refresh('remote', { local });
    await settled(cache);
    expect(cache.getSnapshot()).toMatchObject({ complete: true, failedCount: 0, total: 12 });
    state.requests = 0;

    // 现实里隔了一次坐下来再回来（数据里最晚的真实时刻之后三小时）：已结束的战役第一次重算之后窗口就被这次坐下来截断；
    // 模拟时刻在回放同一段行情
    const latestRealAt = Math.max(...[
      ...dataset.tradeHistory.flatMap(row => [row.openedRealAt, row.closedRealAt]),
      ...dataset.filledOrders.flatMap(row => [row.createdRealAt, row.filledRealAt]),
      ...dataset.cancelledOrders.flatMap(row => [row.createdRealAt, row.cancelledRealAt]),
    ].filter((value): value is number => typeof value === 'number'));
    let realNow = latestRealAt + 3 * HOUR;
    const symbols = PLAN.map(plan => plan.symbol);
    const priceOf = (symbol: string) => PLAN.find(plan => plan.symbol === symbol)!.price;
    const record = (base: Partial<TradeRecord> & Pick<TradeRecord, 'id' | 'symbol' | 'side' | 'action' | 'entryPrice' | 'exitPrice' | 'openTime' | 'closeTime'>): TradeRecord => ({
      fillId: base.id, positionId: base.id, type: 'MARKET', quantity: 50, leverage: 5,
      pnl: (base.exitPrice - base.entryPrice) * 50 * (base.side === 'LONG' ? 1 : -1), fee: 0.1, slippage: 0,
      ...base,
    } as TradeRecord);
    const steps = 30;
    let recomputes = 0;
    /** 按标的整组重算（改动前的口径）会算多少场。 */
    let wholeSymbol = 0;
    const kinds: string[] = [];
    for (let step = 0; step < steps; step += 1) {
      realNow += 5_000 + rand() * 30_000;
      const symbol = symbols[step % symbols.length];
      const price = priceOf(symbol) * (1 + (rand() - 0.5) * 0.02);
      const simNow = SIM_BASE + rand() * 20 * DAY;
      const live = local.ordersMap[symbol] ?? [];
      const positions = local.positionsMap[symbol] ?? [];
      const kind = Math.floor(rand() * 8);
      kinds.push(String(kind));
      switch (kind) {
        case 0: { // 资金费：每个还开着的仓位一条
          const funding = Object.entries(local.positionsMap).flatMap(([sym, rows]) => rows.map(position => record({
            id: `fund-${step}-${position.id}`, symbol: sym, side: 'LONG', action: 'FUNDING', type: 'FUNDING' as never,
            entryPrice: priceOf(sym), exitPrice: 0, openTime: simNow, closeTime: simNow, closedRealAt: realNow, positionId: position.id, pnl: -0.05,
          })));
          local = { ...local, tradeHistory: [...local.tradeHistory, ...funding] };
          break;
        }
        case 1: { // 跟踪止损：有就推 peakPrice（每根 K 线都会），没有就挂一张
          const trailing = live.find(order => order.type === 'TRAILING_STOP');
          const orders = trailing
            ? live.map(order => (order === trailing ? { ...order, peakPrice: (order.peakPrice ?? price) * 1.001, stopPrice: price * 0.98 } : order))
            : [...live, {
              id: `ts-${step}`, side: 'LONG', type: 'TRAILING_STOP', reduceOnly: true, linkedPositionId: positions[0]?.id ?? null,
              price: 0, stopPrice: price * 0.98, quantity: 10, leverage: 5, marginMode: 'isolated', status: 'NEW',
              createdAt: simNow, createdRealAt: realNow, peakPrice: price, trailingActivated: true,
            } as PendingOrder];
          local = { ...local, ordersMap: { ...local.ordersMap, [symbol]: orders } };
          break;
        }
        case 2: { // 挂一张开仓空单
          local = { ...local, ordersMap: { ...local.ordersMap, [symbol]: [...live, {
            id: `os-${step}`, side: 'SHORT', type: 'CONDITIONAL', price: price * 0.99, stopPrice: price * 0.99,
            quantity: 50, leverage: 5, marginMode: 'isolated', status: 'NEW', createdAt: simNow, createdRealAt: realNow,
          } as PendingOrder] } };
          break;
        }
        case 3: { // 撤掉一张挂着的单子
          if (live.length === 0) break;
          const order = pick(live);
          cancelledOrders = [...cancelledOrders, {
            id: order.id, symbol, side: order.side, type: order.type, reduceOnly: order.reduceOnly, linkedPositionId: order.linkedPositionId,
            price: order.price, quantity: order.quantity, leverage: order.leverage,
            createdAt: order.createdAt, cancelledAt: simNow, createdRealAt: order.createdRealAt, cancelledRealAt: realNow,
          } as CancelledOrderSnapshot];
          writeCancelled();
          local = { ...local, ordersMap: { ...local.ordersMap, [symbol]: live.filter(item => item !== order) } };
          break;
        }
        case 4: { // 一张开仓空单成交：成交快照 + 新仓位
          const order = live.find(item => item.side === 'SHORT' && !item.reduceOnly);
          if (!order) break;
          const positionId = `pos-${step}`;
          local = {
            ...local,
            ordersMap: { ...local.ordersMap, [symbol]: live.filter(item => item !== order) },
            filledOrders: [...local.filledOrders, {
              id: order.id, symbol, side: 'SHORT', type: order.type, reduceOnly: false, price: order.price, triggerPrice: order.stopPrice,
              quantity: order.quantity, leverage: order.leverage, createdAt: order.createdAt, filledAt: simNow,
              createdRealAt: order.createdRealAt, filledRealAt: realNow, positionId,
            }],
            positionsMap: { ...local.positionsMap, [symbol]: [...positions, { id: positionId, fills: [{ id: positionId }] }] },
          };
          break;
        }
        case 5: { // 同标的一条噪声空头平仓记录（2026-08-31 起每条平仓都写 fillId；留一步没有 fillId 的老口径：按时间 + 价格接回成交快照）
          const stamped = step !== 13;
          local = { ...local, tradeHistory: [...local.tradeHistory, record({
            id: `noise-${step}`, symbol, side: 'SHORT', action: 'CLOSE', entryPrice: price * (1 - 0.01 * rand()), exitPrice: price,
            openTime: simNow - HOUR, closeTime: simNow, openedRealAt: realNow - 30_000, closedRealAt: realNow, exit_method: 'manual',
            ...(stamped ? {} : { fillId: undefined, positionId: undefined }),
          })] };
          break;
        }
        case 6: { // 撤单快照的上限淘汰最老的一张
          const oldest = [...cancelledOrders].sort((a, b) => (a.createdRealAt ?? 0) - (b.createdRealAt ?? 0))[0];
          cancelledOrders = cancelledOrders.filter(item => item !== oldest);
          writeCancelled();
          break;
        }
        default: { // 平掉一个还开着的仓位
          if (positions.length === 0) break;
          const position = pick(positions);
          local = {
            ...local,
            positionsMap: { ...local.positionsMap, [symbol]: positions.filter(item => item !== position) },
            tradeHistory: [...local.tradeHistory, record({
              id: `close-${step}`, symbol, side: position.id.startsWith('pos-') ? 'SHORT' : 'LONG', action: 'CLOSE',
              entryPrice: price, exitPrice: price * 1.01, openTime: simNow - 2 * HOUR, closeTime: simNow,
              openedRealAt: realNow - 60_000, closedRealAt: realNow, positionId: position.id, fillId: position.id, exit_method: 'manual',
            })],
          };
        }
      }
      vi.mocked(getCampaignFullData).mockClear();
      await cache.refresh('local', { local });
      recomputes += vi.mocked(getCampaignFullData).mock.calls.length;
      wholeSymbol += kind === 0 ? 12 : PLAN.find(plan => plan.symbol === symbol)!.campaigns;
      expect(state.requests).toBe(0);

      if (step % 5 === 4 || step === steps - 1) {
        await settled(cache);
        const fresh = createCampaignListCache(USER);
        state.requests = 0;
        await fresh.refresh('remote', { local });
        await settled(fresh);
        state.requests = 0;
        expect(projectRows(cache.getSnapshot().rows), `step ${step} (${kinds.join('')})`).toEqual(projectRows(fresh.getSnapshot().rows));
        expect(cache.getSnapshot()).toMatchObject({ complete: true, failedCount: 0, error: null });
      }
    }
    // 真的跳过了大半：按标的整组重算的老口径要算 wholeSymbol 场，这里只算改动碰得到的（多半只是进行中的那两三场）
    console.log(`local ticks: ${recomputes} recomputes vs ${wholeSymbol} whole-symbol (${kinds.join('')})`);
    expect(recomputes).toBeGreaterThan(0);
    expect(recomputes).toBeLessThan(wholeSymbol / 2);
  });
});

/** 本次优化之前的 getCampaignFullData 在同一份数据上的结果（由上面的用例在改动前打印后固化）。 */
const GOLDEN: ReturnType<typeof project> = [
  {"id":"ASTERUSDT-0","status":"closed_profit","pnl":5.94293290192,"settled":false,"payoff":80.4803686877,"maxLoss":7.38432613919,"drawdownPct":2,"quality":0.5,"legs":"ASTERUSDT-0-leg-main,ASTERUSDT-0-leg-h0,ASTERUSDT-0-leg-h1,ASTERUSDT-0-leg-h2,event-ASTERUSDT-0-e-mtp","records":"ASTERUSDT-0-p0,ASTERUSDT-0-h0,ASTERUSDT-0-main,ASTERUSDT-0-h2,ASTERUSDT-0-f2,ASTERUSDT-0-f1,ASTERUSDT-0-p1,ASTERUSDT-0-h1","pending":"","reverse":"ASTERUSDT-0-c3:cancelled:-:1.17428062355:1735778400000:-:1735778700000 ASTERUSDT-0-c6:cancelled:-:1.17428062355:1735780200000:-:1735780500000 ASTERUSDT-0-o0:triggered:ASTERUSDT-0-h0:1.1802414389:1735781400000:1735783200000:1735786800000 ASTERUSDT-0-o1:triggered:ASTERUSDT-0-h1:1.1683198082:1735788600000:1735790400000:1735794000000 ASTERUSDT-0-o2:triggered:ASTERUSDT-0-h2:1.15639817751:1735795800000:1735797600000:1735801200000 ASTERUSDT-noise-f68:triggered:-:1.2:1735844939004.8079:1735845539004.8079:-"},
  {"id":"ASTERUSDT-1","status":"closed_profit","pnl":5.70976207985,"settled":false,"payoff":78.3148620766,"maxLoss":7.29077716343,"drawdownPct":2,"quality":0.5,"legs":"ASTERUSDT-1-leg-main,ASTERUSDT-1-leg-h0,ASTERUSDT-1-leg-h1,ASTERUSDT-1-leg-h2,event-ASTERUSDT-1-e-mtp","records":"ASTERUSDT-1-f2,ASTERUSDT-1-p1,ASTERUSDT-1-f1,ASTERUSDT-1-h1,ASTERUSDT-1-p0,ASTERUSDT-1-main,ASTERUSDT-1-h2,ASTERUSDT-1-h0","pending":"","reverse":"ASTERUSDT-1-c0:cancelled:-:1.12820775299:1736035800000:-:1736036100000 ASTERUSDT-1-c3:cancelled:-:1.12820775299:1736037600000:-:1736037900000 ASTERUSDT-1-c6:cancelled:-:1.12820775299:1736039400000:-:1736039700000 ASTERUSDT-1-o0:triggered:ASTERUSDT-1-h0:1.1339346959:1736040600000:1736042400000:1736046000000 ASTERUSDT-1-o1:triggered:ASTERUSDT-1-h1:1.12248081008:1736047800000:1736049600000:1736053200000 ASTERUSDT-1-o2:triggered:ASTERUSDT-1-h2:1.11102692426:1736055000000:1736056800000:1736060400000"},
  {"id":"ASTERUSDT-2","status":"closed_profit","pnl":5.88052755913,"settled":false,"payoff":79.9061926603,"maxLoss":7.35928889032,"drawdownPct":2,"quality":0.5,"legs":"ASTERUSDT-2-leg-main,ASTERUSDT-2-leg-h0,ASTERUSDT-2-leg-h1,ASTERUSDT-2-leg-h2,event-ASTERUSDT-2-e-mtp","records":"ASTERUSDT-2-main,ASTERUSDT-2-f1,ASTERUSDT-2-h1,ASTERUSDT-2-f2,ASTERUSDT-2-p0,ASTERUSDT-2-h2,ASTERUSDT-2-p1,ASTERUSDT-2-h0","pending":"","reverse":"ASTERUSDT-2-c0:cancelled:-:1.16194977848:1736295000000:-:1736295300000 ASTERUSDT-2-c3:cancelled:-:1.16194977848:1736296800000:-:1736297100000 ASTERUSDT-2-c6:cancelled:-:1.16194977848:1736298600000:-:1736298900000 ASTERUSDT-2-o0:triggered:ASTERUSDT-2-h0:1.16784800071:1736299800000:1736301600000:1736305200000 ASTERUSDT-2-c9:cancelled:-:1.16194977848:1736300400000:-:1736300700000 ASTERUSDT-2-o1:triggered:ASTERUSDT-2-h1:1.15605155626:1736307000000:1736308800000:1736312400000 ASTERUSDT-2-o2:triggered:ASTERUSDT-2-h2:1.14425511181:1736314200000:1736316000000:1736319600000"},
  {"id":"ASTERUSDT-3","status":"closed_profit","pnl":5.87926250845,"settled":false,"payoff":79.8945128396,"maxLoss":7.35878134742,"drawdownPct":2,"quality":0.5,"legs":"ASTERUSDT-3-leg-main,ASTERUSDT-3-leg-h0,ASTERUSDT-3-leg-h1,ASTERUSDT-3-leg-h2,event-ASTERUSDT-3-e-mtp","records":"ASTERUSDT-3-f1,ASTERUSDT-3-f2,ASTERUSDT-3-p1,ASTERUSDT-3-h2,ASTERUSDT-3-p0,ASTERUSDT-3-h0,ASTERUSDT-3-main,ASTERUSDT-3-h1","pending":"","reverse":"ASTERUSDT-3-c3:cancelled:-:1.16169981361:1736296800000:-:1736297100000 ASTERUSDT-3-c6:cancelled:-:1.16169981361:1736298600000:-:1736298900000 ASTERUSDT-3-o0:triggered:ASTERUSDT-3-h0:1.16759676697:1736299800000:1736301600000:1736305200000 ASTERUSDT-3-o1:triggered:ASTERUSDT-3-h1:1.15580286024:1736307000000:1736308800000:1736312400000 ASTERUSDT-3-o2:triggered:ASTERUSDT-3-h2:1.1440089535:1736314200000:1736316000000:1736319600000"},
  {"id":"ASTERUSDT-4","status":"closed_profit","pnl":5.71548578822,"settled":false,"payoff":78.3686844797,"maxLoss":7.2930735359,"drawdownPct":2,"quality":0.5,"legs":"ASTERUSDT-4-leg-main,ASTERUSDT-4-leg-h0,ASTERUSDT-4-leg-h1,ASTERUSDT-4-leg-h2,event-ASTERUSDT-4-e-mtp","records":"ASTERUSDT-4-p0,ASTERUSDT-4-h2,ASTERUSDT-4-f1,ASTERUSDT-4-main,ASTERUSDT-4-f2,ASTERUSDT-4-h1,ASTERUSDT-4-h0,ASTERUSDT-4-p1","pending":"","reverse":"ASTERUSDT-4-c0:cancelled:-:1.12933871643:1736813400000:-:1736813700000 ASTERUSDT-4-c3:cancelled:-:1.12933871643:1736815200000:-:1736815500000 ASTERUSDT-4-c6:cancelled:-:1.12933871643:1736817000000:-:1736817300000 ASTERUSDT-4-o0:triggered:ASTERUSDT-4-h0:1.13507140027:1736818200000:1736820000000:1736823600000 ASTERUSDT-4-o1:triggered:ASTERUSDT-4-h1:1.12360603259:1736825400000:1736827200000:1736830800000 ASTERUSDT-4-o2:triggered:ASTERUSDT-4-h2:1.11214066491:1736832600000:1736834400000:1736838000000"},
  {"id":"ASTERUSDT-5","status":"closed_profit","pnl":5.88780812738,"settled":false,"payoff":79.9733805865,"maxLoss":7.36220988059,"drawdownPct":2,"quality":0.5,"legs":"ASTERUSDT-5-leg-main,ASTERUSDT-5-leg-h0,ASTERUSDT-5-leg-h1,ASTERUSDT-5-leg-h2,event-ASTERUSDT-5-e-mtp","records":"ASTERUSDT-5-p1,ASTERUSDT-5-h0,ASTERUSDT-5-h1,ASTERUSDT-5-p0,ASTERUSDT-5-main,ASTERUSDT-5-f1,ASTERUSDT-5-f2,ASTERUSDT-5-h2","pending":"","reverse":"ASTERUSDT-5-c0:cancelled:-:1.16338836619:1737072600000:-:1737072900000 ASTERUSDT-5-c3:cancelled:-:1.16338836619:1737074400000:-:1737074700000 ASTERUSDT-5-c6:cancelled:-:1.16338836619:1737076200000:-:1737076500000 ASTERUSDT-5-o0:triggered:ASTERUSDT-5-h0:1.16929389089:1737077400000:1737079200000:1737082800000 ASTERUSDT-5-c9:cancelled:-:1.16338836619:1737078000000:-:1737078300000 ASTERUSDT-5-o1:triggered:ASTERUSDT-5-h1:1.15748284149:1737084600000:1737086400000:1737090000000 ASTERUSDT-5-o2:triggered:ASTERUSDT-5-h2:1.14567179209:1737091800000:1737093600000:1737097200000"},
  {"id":"ASTERUSDT-6","status":"active","pnl":1.68069810915,"settled":false,"payoff":11.204654061,"maxLoss":15,"drawdownPct":2,"quality":null,"legs":"ASTERUSDT-6-leg-main,ASTERUSDT-6-leg-h0,ASTERUSDT-6-leg-h1,ASTERUSDT-6-leg-h2,event-ASTERUSDT-6-e-mtp","records":"ASTERUSDT-6-h2,ASTERUSDT-6-h1,ASTERUSDT-6-f1,ASTERUSDT-6-f2,ASTERUSDT-6-h0","pending":"ASTERUSDT-6-live0,ASTERUSDT-6-live1,ASTERUSDT-6-live2,ASTERUSDT-6-live3,ASTERUSDT-7-live0,ASTERUSDT-7-live1,ASTERUSDT-7-live2,ASTERUSDT-7-live3","reverse":"ASTERUSDT-6-live0:pending:-:1.1204654061:1737334800000:-:- ASTERUSDT-6-live2:pending:-:1.1204654061:1737335400000:-:- ASTERUSDT-6-o0:triggered:ASTERUSDT-6-h0:1.13189872657:1737336600000:1737338400000:1737342000000 ASTERUSDT-6-o1:triggered:ASTERUSDT-6-h1:1.1204654061:1737343800000:1737345600000:1737349200000 ASTERUSDT-6-o2:triggered:ASTERUSDT-6-h2:1.10903208563:1737351000000:1737352800000:1737356400000 ASTERUSDT-7-c0:cancelled:-:1.15605327369:1737591000000:-:1737591300000 ASTERUSDT-7-live0:pending:-:1.15018498296:1737594000000:-:- ASTERUSDT-7-live2:pending:-:1.15018498296:1737594600000:-:-"},
  {"id":"ASTERUSDT-7","status":"active","pnl":1.72527747444,"settled":false,"payoff":11.5018498296,"maxLoss":15,"drawdownPct":2,"quality":null,"legs":"ASTERUSDT-7-leg-main,ASTERUSDT-7-leg-h0,ASTERUSDT-7-leg-h1,ASTERUSDT-7-leg-h2,event-ASTERUSDT-7-e-mtp","records":"ASTERUSDT-7-f2,ASTERUSDT-7-h0,ASTERUSDT-7-h1,ASTERUSDT-7-f1,ASTERUSDT-7-h2","pending":"ASTERUSDT-7-live0,ASTERUSDT-7-live1,ASTERUSDT-7-live2,ASTERUSDT-7-live3","reverse":"ASTERUSDT-7-c0:cancelled:-:1.15605327369:1737591000000:-:1737591300000 ASTERUSDT-7-live0:pending:-:1.15018498296:1737594000000:-:- ASTERUSDT-7-live2:pending:-:1.15018498296:1737594600000:-:- ASTERUSDT-7-o0:triggered:ASTERUSDT-7-h0:1.16192156442:1737595800000:1737597600000:1737601200000 ASTERUSDT-7-o1:triggered:ASTERUSDT-7-h1:1.15018498296:1737603000000:1737604800000:1737608400000 ASTERUSDT-7-o2:triggered:ASTERUSDT-7-h2:1.1384484015:1737610200000:1737612000000:1737615600000"},
  {"id":"BTCUSDT-0","status":"closed_profit","pnl":256825.968365,"settled":false,"payoff":224.990144536,"maxLoss":114149.874829,"drawdownPct":2,"quality":1.12495072268,"legs":"BTCUSDT-0-leg-main,BTCUSDT-0-leg-h0,BTCUSDT-0-leg-h1,event-BTCUSDT-0-e-mtp","records":"BTCUSDT-0-f1,BTCUSDT-0-h1,BTCUSDT-0-h0,BTCUSDT-0-p0,BTCUSDT-0-main,BTCUSDT-0-f2","pending":"","reverse":"BTCUSDT-0-c3:cancelled:-:56216.3508532:1736037600000:-:1736037900000 BTCUSDT-0-o0:triggered:BTCUSDT-0-h0:56501.7130403:1736040600000:1736042400000:1736046000000 BTCUSDT-0-o1:triggered:BTCUSDT-0-h1:55930.9886661:1736047800000:1736049600000:1736053200000 BTCUSDT-noise-c8:cancelled:-:60000:1736060893716.178:-:1736061193716.178"},
  {"id":"BTCUSDT-1","status":"closed_profit","pnl":279184.916988,"settled":false,"payoff":224.991036344,"maxLoss":124087.12877,"drawdownPct":2,"quality":1.12495518172,"legs":"BTCUSDT-1-leg-main,BTCUSDT-1-leg-h0,BTCUSDT-1-leg-h1,event-BTCUSDT-1-e-mtp,BTCUSDT-1-leg-cross","records":"BTCUSDT-1-main,BTCUSDT-1-h0,BTCUSDT-1-p0,BTCUSDT-1-h1,BTCUSDT-1-f2,ASTERUSDT-noise-r1,BTCUSDT-1-f1","pending":"","reverse":"BTCUSDT-1-c0:cancelled:-:61110.4484191:1736295000000:-:1736295300000 BTCUSDT-1-c3:cancelled:-:61110.4484191:1736296800000:-:1736297100000 BTCUSDT-1-o0:triggered:BTCUSDT-1-h0:61420.653741:1736299800000:1736301600000:1736305200000 BTCUSDT-1-o1:triggered:BTCUSDT-1-h1:60800.2430972:1736307000000:1736308800000:1736312400000"},
  {"id":"BTCUSDT-2","status":"closed_profit","pnl":276893.588986,"settled":false,"payoff":224.990858773,"maxLoss":123068.817327,"drawdownPct":2,"quality":1.12495429386,"legs":"BTCUSDT-2-leg-main,BTCUSDT-2-leg-h0,BTCUSDT-2-leg-h1,event-BTCUSDT-2-e-mtp","records":"BTCUSDT-2-h1,BTCUSDT-2-h0,BTCUSDT-2-f2,BTCUSDT-2-f1,BTCUSDT-2-main,BTCUSDT-2-p0","pending":"","reverse":"BTCUSDT-2-c0:cancelled:-:60608.9300335:1736554200000:-:1736554500000 BTCUSDT-2-c3:cancelled:-:60608.9300335:1736556000000:-:1736556300000 BTCUSDT-2-o0:triggered:BTCUSDT-2-h0:60916.5895768:1736559000000:1736560800000:1736564400000 BTCUSDT-2-o1:triggered:BTCUSDT-2-h1:60301.2704902:1736566200000:1736568000000:1736571600000"},
  {"id":"BTCUSDT-3","status":"active","pnl":59829.4767403,"settled":false,"payoff":398863.178269,"maxLoss":15,"drawdownPct":2,"quality":null,"legs":"BTCUSDT-3-leg-main,BTCUSDT-3-leg-h0,BTCUSDT-3-leg-h1,event-BTCUSDT-3-e-mtp","records":"BTCUSDT-3-h0,BTCUSDT-3-f2,BTCUSDT-3-f1,BTCUSDT-3-h1","pending":"BTCUSDT-3-live0,BTCUSDT-3-live1","reverse":"BTCUSDT-3-c0:cancelled:-:59829.4767403:1736813400000:-:1736813700000 BTCUSDT-3-c3:cancelled:-:59829.4767403:1736815200000:-:1736815500000 BTCUSDT-3-live0:pending:-:59525.7738127:1736816400000:-:- BTCUSDT-3-o0:triggered:BTCUSDT-3-h0:60133.179668:1736818200000:1736820000000:1736823600000 BTCUSDT-3-o1:triggered:BTCUSDT-3-h1:59525.7738127:1736825400000:1736827200000:1736830800000"},
];
