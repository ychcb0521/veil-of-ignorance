import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTLEMENT_MODE } from '@/types/trading';

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('下单默认结算方式', () => {
  it('新标的默认走币本位', () => {
    expect(DEFAULT_SETTLEMENT_MODE).toBe('coin');
  });

  it('实时下单路径用的是这个常量，而不是写死的字面量', () => {
    const ctx = read('contexts/TradingContext.tsx');
    expect(ctx).toContain('settlementModeMap[symbol] ?? DEFAULT_SETTLEMENT_MODE');
    // 确保没有残留的写死默认
    expect(ctx).not.toContain("settlementModeMap[symbol] ?? 'usdt'");
  });

  it('历史记录的回填仍是 usdt——不能事后改写过去交易的含义', () => {
    // 这些单子是在旧默认（U 本位）下开的。若跟着新默认改成 coin，
    // 已了结战役的保证金、R 倍数与统计会被静默重算，等于篡改历史。
    expect(read('lib/tradingSettlement.ts')).toContain('normalized.settlementMode ?? "usdt"');
    expect(read('lib/journalApi.ts')).toContain("record.settlementMode ?? 'usdt'");
    expect(read('lib/campaignAnalysis.ts')).toContain("leg.pre_settlement_mode ?? 'usdt'");
    expect(read('components/PositionPanel.tsx')).toContain("record.settlementMode ?? 'usdt'");
  });
});
