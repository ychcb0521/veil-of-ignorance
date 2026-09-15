import type { TimeBoundPriceLine } from '@/components/journal/ReplayCandleChart';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

const REVERSE_ORDER_RECORD_MATCH_MS = 60_000;

/**
 * 同一秒里挂出又撤掉（或撤单时刻早于委托时刻的脏记录）的委托，给它一个最小的正时长。
 * 以前这类线在去重时被 `endTime <= startTime` 静默丢掉：Legs 列着它，盘面上却没有。
 * 1 毫秒足够让它成为一条合法的线段，盘面再按「至少一根 K 线宽」把它画出来。
 */
const MIN_ORDER_SEGMENT_MS = 1;

function atLeastMinSegmentEnd(startTime: number, endTime: number): number {
  return endTime > startTime ? endTime : startTime + MIN_ORDER_SEGMENT_MS;
}

export function isDisplayableReverseHedgeOrder(order: CampaignReverseHedgeOrder) {
  return order.side === 'SHORT' && Number.isFinite(order.price) && order.price > 0;
}

function closeEnoughPrice(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(1e-8, Math.max(Math.abs(a), Math.abs(b), 1) * 1e-6);
}

function findReverseOrderTradeRecord(order: CampaignReverseHedgeOrder, tradeRecords: TradeRecord[]) {
  if (order.tradeRecordId) {
    const byId = tradeRecords.find(record => record.id === order.tradeRecordId);
    if (byId) return byId;
  }
  const triggeredAt = order.triggeredAt ?? order.createdAt;
  const fillPrice = order.fillPrice ?? order.price;
  return tradeRecords
    .filter(record =>
      record.side === order.side &&
      Math.abs(record.openTime - triggeredAt) <= REVERSE_ORDER_RECORD_MATCH_MS &&
      (closeEnoughPrice(record.entryPrice, fillPrice) || closeEnoughPrice(record.entryPrice, order.price))
    )
    .sort((a, b) => Math.abs(a.openTime - triggeredAt) - Math.abs(b.openTime - triggeredAt))[0] ?? null;
}

function dedupeReverseOrderLines(lines: TimeBoundPriceLine[]) {
  const result = new Map<string, TimeBoundPriceLine>();
  for (const line of lines) {
    if (!Number.isFinite(line.startTime) || !Number.isFinite(line.endTime) || line.endTime <= line.startTime) continue;
    const key = [
      Math.round(line.price * 1e8),
      Math.round(line.startTime / 1000),
      Math.round(line.endTime / 1000),
      line.dashed ? 'd' : 's',
      line.endMarker ?? '',
      line.title ?? '',
    ].join(':');
    const existing = result.get(key);
    if (!existing) {
      result.set(key, line);
    } else if (line.orderIds?.length) {
      // 完全重合只画一条，但它代表的每张委托都要能被点选到
      const orderIds = Array.from(new Set([...(existing.orderIds ?? []), ...line.orderIds]));
      result.set(key, { ...existing, orderIds });
    }
  }
  return Array.from(result.values()).sort((a, b) =>
    Number(Boolean(b.dashed)) - Number(Boolean(a.dashed))
    || a.startTime - b.startTime
    || a.endTime - b.endTime
  );
}

export function buildCampaignReverseOrderPriceLines(
  orders: CampaignReverseHedgeOrder[],
  tradeRecords: TradeRecord[],
  fallbackEnd: number,
): TimeBoundPriceLine[] {
  const segments = orders
    .filter(isDisplayableReverseHedgeOrder)
    .flatMap(order => {
      if (order.status === 'triggered') {
        const triggeredAt = order.triggeredAt ?? order.createdAt;
        const matchedRecord = findReverseOrderTradeRecord(order, tradeRecords);
        const explicitEndTime = order.cancelledAt
          ?? (matchedRecord?.closeTime && matchedRecord.closeTime > triggeredAt ? matchedRecord.closeTime : null);
        const endTime = explicitEndTime != null && explicitEndTime > triggeredAt ? explicitEndTime : fallbackEnd;
        const solidStart = Math.max(order.createdAt, triggeredAt);
        const lines: TimeBoundPriceLine[] = [];
        if (Number.isFinite(triggeredAt) && triggeredAt > order.createdAt) {
          lines.push({
            price: order.price,
            color: '#F0B90B',
            startTime: order.createdAt,
            endTime: triggeredAt,
            dashed: true,
            endMarker: null,
            title: '委托空',
            orderIds: [order.id],
          });
        }
        // 在战役最后一刻才触发（没有晚于触发的结束时刻可用）的，也至少留一段——不许整张委托从盘面上消失。
        if (Number.isFinite(endTime) && Number.isFinite(solidStart)) {
          lines.push({
            price: order.price,
            color: '#F0B90B',
            startTime: solidStart,
            endTime: atLeastMinSegmentEnd(solidStart, endTime),
            dashed: false,
            endMarker: null,
            title: '触发空',
            orderIds: [order.id],
          });
        }
        return lines;
      }
      return {
        price: order.price,
        color: '#F0B90B',
        startTime: order.createdAt,
        endTime: atLeastMinSegmentEnd(order.createdAt, order.cancelledAt ?? fallbackEnd),
        dashed: true,
        endMarker: order.status === 'cancelled' && order.cancelledAt ? ('x' as const) : null,
        title: '委托空',
        orderIds: [order.id],
      };
    });

  return dedupeReverseOrderLines(segments);
}

/** 「他场委托」线的颜色与标题：灰色，与黄色委托层一眼分开。 */
export const FOREIGN_REPLAY_ORDER_LINE_COLOR = '#848E9C';
export const FOREIGN_REPLAY_ORDER_LINE_TITLE = '他场委托';

/**
 * 别的回放留下、在本场期间仍挂着的委托（foreignLiveOrders）：灰色、虚线、调低不透明度（dim），标题「他场委托」。
 * 不进黄色委托层——标题不是「委托空」，盘面不给它画挂单 / 撤单竖线与 ×；触发与否都只画一段虚线，
 * 从委托时刻到触发 / 撤单时刻，仍挂着的延续到 fallbackEnd。带 orderIds，照样能被管理区隐藏、点选。
 */
export function buildForeignReplayOrderPriceLines(
  orders: CampaignReverseHedgeOrder[],
  fallbackEnd: number,
): TimeBoundPriceLine[] {
  const lines = orders
    .filter(isDisplayableReverseHedgeOrder)
    .map((order): TimeBoundPriceLine => {
      const endTime = order.status === 'triggered'
        ? order.triggeredAt ?? fallbackEnd
        : order.cancelledAt ?? fallbackEnd;
      return {
        price: order.price,
        color: FOREIGN_REPLAY_ORDER_LINE_COLOR,
        startTime: order.createdAt,
        endTime: atLeastMinSegmentEnd(order.createdAt, endTime),
        dashed: true,
        dim: true,
        endMarker: null,
        title: FOREIGN_REPLAY_ORDER_LINE_TITLE,
        orderIds: [order.id],
      };
    });
  return dedupeReverseOrderLines(lines);
}

/** 委托时刻的紧凑写法：MM-DD HH:mm（本地时区，与盘面一致）。 */
function fmtForeignOrderTime(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fmtForeignOrderPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toPrecision(6);
}

/** 他场委托的状态字：淡注里每张各带一个，与管理区色块的 已撤 / 已触发 对得上。 */
function foreignOrderStatusWord(order: CampaignReverseHedgeOrder): string {
  return order.status === 'cancelled' ? '已撤' : order.status === 'triggered' ? '已触发' : '仍挂着';
}

/**
 * Legs 表下方与导出 PNG 共用的一行淡注：别的回放留下、本场期间挂在盘上的委托，不放进任何腿的行。
 * 例：「另有 1 张来自另一次回放的委托在本场期间挂在盘上：空 0.0300500 委 08-07 19:42 仍挂着（未计入本场）」。
 * 总句只说「挂在盘上」、每张各带状态字：本场期间才撤掉 / 触发的也在列，一句「仍挂着 N」会把已了结的也数进去。
 * 委托时刻是那次回放的模拟钟，与盘面横轴同一口径。没有这类委托返回 null。
 */
export function formatForeignReplayOrdersNote(orders: CampaignReverseHedgeOrder[]): string | null {
  const displayable = orders.filter(isDisplayableReverseHedgeOrder);
  if (displayable.length === 0) return null;
  const items = displayable.map(order => (
    `空 ${fmtForeignOrderPrice(order.price)} 委 ${fmtForeignOrderTime(order.createdAt)} ${foreignOrderStatusWord(order)}`
  ));
  return `另有 ${displayable.length} 张来自另一次回放的委托在本场期间挂在盘上：${items.join(' · ')}（未计入本场）`;
}

/**
 * 管理区「他场」一组的标题。数字只数各自的状态，与后面每个色块的 已撤 / 已触发 一一对得上：
 * 全部仍挂着 →「来自另一次回放 · 仍挂着 2」；混着 →「来自另一次回放 · 仍挂着 1 · 已了结 1」；
 * 都了结了 →「来自另一次回放 · 2 张 · 本场期间已了结」。没有这类委托返回 null。
 */
export function formatForeignReplayOrdersHeading(orders: CampaignReverseHedgeOrder[]): string | null {
  const displayable = orders.filter(isDisplayableReverseHedgeOrder);
  if (displayable.length === 0) return null;
  const pending = displayable.filter(order => order.status === 'pending').length;
  const settled = displayable.length - pending;
  if (settled === 0) return `来自另一次回放 · 仍挂着 ${pending}`;
  if (pending === 0) return `来自另一次回放 · ${settled} 张 · 本场期间已了结`;
  return `来自另一次回放 · 仍挂着 ${pending} · 已了结 ${settled}`;
}

/** 对冲空单腿：对冲类角色、方向为空。 */
export function isHedgeShortLeg(leg: { leg_role?: string | null; direction?: string | null }): boolean {
  const role = leg.leg_role ?? '';
  return leg.direction === 'short' && (role.startsWith('hedge_') || role === 'reentry_hedge');
}

/** 画一条手动对冲空单所需的最少信息：已成交的开平时刻与开仓价。 */
export interface HedgeShortLegExecution {
  legId: string;
  recordId: string | null;
  openTime: number | null;
  closeTime: number | null;
  entryPrice: number | null;
}

interface TriggeredOrderMatch {
  order: CampaignReverseHedgeOrder;
  recordId: string | null;
}

/** 这条腿是不是某张被触发的委托空单开出来的——与 findReverseOrderTradeRecord 同一套口径。 */
function isOpenedByTriggeredOrder(leg: HedgeShortLegExecution, triggered: TriggeredOrderMatch[]): boolean {
  for (const { order, recordId } of triggered) {
    if (leg.recordId && (leg.recordId === recordId || leg.recordId === order.tradeRecordId)) return true;
    if (leg.openTime == null || leg.entryPrice == null) continue;
    const triggeredAt = order.triggeredAt ?? order.createdAt;
    if (Math.abs(leg.openTime - triggeredAt) > REVERSE_ORDER_RECORD_MATCH_MS) continue;
    const fillPrice = order.fillPrice ?? order.price;
    if (closeEnoughPrice(leg.entryPrice, fillPrice) || closeEnoughPrice(leg.entryPrice, order.price)) return true;
  }
  return false;
}

/**
 * 手动开的对冲空单：与被触发的委托空单同一个目的（给主仓做反向保护），只是由人按下、
 * 而不是价格走到委托价自动触发。所以画法照「触发空」——黄色实线，从开仓到平仓；
 * 价位取实际开仓价（手动单没有委托价可言），标题「手动空」。
 *
 * 由委托触发开出的对冲腿不再画，它已有自己的「触发空」。判定用全部可显示的委托：
 * 用户在盘面上隐藏某张委托，不会让它开出的那条腿冒充成手动单。
 */
export function buildManualHedgeShortPriceLines(
  legs: HedgeShortLegExecution[],
  orders: CampaignReverseHedgeOrder[],
  tradeRecords: TradeRecord[],
  fallbackEnd: number,
): TimeBoundPriceLine[] {
  const triggered: TriggeredOrderMatch[] = orders
    .filter(order => isDisplayableReverseHedgeOrder(order) && order.status === 'triggered')
    .map(order => ({ order, recordId: findReverseOrderTradeRecord(order, tradeRecords)?.id ?? null }));
  const lines: TimeBoundPriceLine[] = [];
  for (const leg of legs) {
    const { openTime, closeTime, entryPrice } = leg;
    if (openTime == null || !Number.isFinite(openTime)) continue;
    if (entryPrice == null || !Number.isFinite(entryPrice) || entryPrice <= 0) continue;
    // 平仓时刻早于开仓是坏数据：不画，也不拿战役结束去补一条错的线。
    if (closeTime != null && !(closeTime > openTime)) continue;
    if (isOpenedByTriggeredOrder(leg, triggered)) continue;
    lines.push({
      price: entryPrice,
      color: '#F0B90B',
      startTime: openTime,
      endTime: closeTime ?? fallbackEnd,
      dashed: false,
      endMarker: null,
      title: '手动空',
    });
  }
  return dedupeReverseOrderLines(lines);
}
