/**
 * 保存的杠杆超过合约最高杠杆时的一次性说明。
 *
 * 夹值本身在 TradingContext.getSymbolLeverage 里做（读出来就是夹过的），这里只负责告诉用户：
 * 旧版本的杠杆滑块一律到 125x，而币安按合约分层，KAITOUSDT 只到 75x、不少合约只到 10x。
 * 同一个标的、同一种结算方式、同一个保存值只说一次（整个页面会话内），不刷屏。
 */
import { toast } from '@/lib/notificationCenter';
import { LEVERAGE_TIER_SNAPSHOT_DATE } from '@/lib/leverageTiers';

const shown = new Set<string>();

export function noticeLeverageClamp(args: {
  symbol: string;
  settlement: 'usdt' | 'coin';
  /** leverageMap 里保存的原值；没保存过为 undefined。 */
  stored: number | null | undefined;
  /** 实际生效（夹过）的杠杆。 */
  applied: number;
}): boolean {
  const stored = Number(args.stored);
  if (!Number.isFinite(stored) || !(stored > args.applied)) return false;
  const key = `${args.symbol}:${args.settlement}:${stored}`;
  if (shown.has(key)) return false;
  shown.add(key);
  toast.info(`${args.symbol} 杠杆已按合约上限调整为 ${args.applied}x`, {
    description: `保存的 ${stored}x 超过该合约${args.settlement === 'coin' ? '（币本位）' : ''}的最高杠杆 ${args.applied}x`
      + `（币安杠杆分层，快照 ${LEVERAGE_TIER_SNAPSHOT_DATE}）。`,
  });
  return true;
}

/** 仅供测试：清空「已经说过」的记录。 */
export function resetLeverageClampNotices(): void {
  shown.clear();
}
