/**
 * 「真实体量」的信号库夹具：791 条，与用户手上那一库同一个量级。
 *
 * 信号库的性能问题只在体量上来之后才存在（4 条信号怎么写都快），
 * 所以窗口化 / memo 的回归测试必须拿这个尺寸去跑，而不是拿几条示例。
 *
 * 全部由下标推导，不带随机数：同一批信号在每次运行、每台机器上完全一致，
 * 断言才能写成「第 15 行必须是 X」这种精确形式。
 * 刻意铺开成 20 个月 × 791 个互不相同的标的，并让约三分之一有评分、
 * 约十一分之一有不可跳转标记、四分之一没有兜底区——
 * 三个排序键、月份筛选、两种行内徽标因此都能被这一份夹具覆盖到。
 */
import type { TradeSignal } from '@/lib/signalLibrary';

export const BULK_SIGNAL_COUNT = 791;

const STEMS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'TRB', 'ACE', 'AAVE', 'PEPE',
  'LINK', 'SUI', 'TIA', 'APT', 'ARB', 'OP', 'INJ', 'SEI', 'TON', 'AVAX',
];

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 第 index 条信号。时间按 UTC+8 墙钟构造（先算出 UTC+8 的瞬时再减 8 小时），
 * 与 signalMonthKey / parseSignalTime 的时区口径一致。
 */
export function makeBulkSignal(index: number): TradeSignal {
  const stem = STEMS[index % STEMS.length];
  const tier = Math.floor(index / STEMS.length);
  const symbol = `${stem}${tier === 0 ? '' : tier}USDT`;

  // 20 个月：2024-09 ~ 2026-04
  const monthOffset = index % 20;
  const year = 2024 + Math.floor((8 + monthOffset) / 12);
  const month = ((8 + monthOffset) % 12) + 1;
  const day = (index % 27) + 1;
  const hour = index % 23;
  const minute = index % 59;
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const timeLabel = `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`;

  const signal: TradeSignal = {
    id: `bulk-${String(index).padStart(4, '0')}`,
    symbol,
    timeMs: wallMs - 8 * 3600_000,
    timeLabel,
    fallbackZone: index % 4 === 0 ? '' : String(((index % 97) + 1) / 10),
  };
  if (index % 3 === 0) signal.quality = (index % 5) + 1;
  if (index % 11 === 0) {
    signal.jumpIssue = {
      code: 'before_listing',
      reason: `第 ${index} 条早于上市时间`,
      checkedAt: wallMs,
    };
  }
  return signal;
}

export function makeBulkSignals(count: number = BULK_SIGNAL_COUNT): TradeSignal[] {
  return Array.from({ length: count }, (_, i) => makeBulkSignal(i));
}
