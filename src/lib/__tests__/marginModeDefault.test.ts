import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MARGIN_MODE } from '@/types/trading';

const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('下单默认仓位模式', () => {
  it('新标的默认逐仓', () => {
    expect(DEFAULT_MARGIN_MODE).toBe('isolated');
  });

  it('与「全仓是硬阻断」这条约束自洽——默认值不能是被硬阻断的那个', () => {
    // 若默认是全仓，每开一个新标的都得先手动切换才能提交，默认与约束互相打架
    expect(DEFAULT_MARGIN_MODE).not.toBe('cross');
  });

  it('实时下单路径用常量，不写死字面量', () => {
    const ctx = read('contexts/TradingContext.tsx');
    expect(ctx).toContain('marginModeMap[symbol] ?? DEFAULT_MARGIN_MODE');
    expect(ctx).not.toContain("marginModeMap[symbol] ?? 'cross'");
  });

  it('快照表单不再用 cross 兜底——那是永不触发的死代码，且会误导', () => {
    expect(read('components/journal/PreTradeSnapshotForm.tsx'))
      .not.toContain("getSymbolMarginMode(symbol) ?? 'cross'");
  });
});
