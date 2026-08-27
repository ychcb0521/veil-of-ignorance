import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatPrice, getPriceDecimals } from '@/lib/formatters';

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/**
 * 成交提示里的价格一律写死两位小数,次美分标的因此全被压成「0.01」——
 * 那一行字里唯一有信息量的数被抹掉了。用户的标的常年在 0.01 以下
 * （NOM 0.010344、SCRT 0.114401），这条提示等于没有。
 */
describe('成交提示的价格精度', () => {
  it('次美分价格不得被压成 0.01', () => {
    expect((0.010344).toFixed(2)).toBe('0.01');          // 旧写法
    expect(formatPrice(0.010344)).toBe('0.010344');      // 现在
    expect(formatPrice(0.114401)).toBe('0.114401');
    expect(getPriceDecimals(0.010344)).toBeGreaterThan(2);
  });

  it('大额价格仍然是两位小数,没有被这次改动带跑', () => {
    expect(formatPrice(64_235.5)).toBe('64,235.50');
    expect(formatPrice(1.2345)).toBe('1.2345');
  });

  it('所有成交提示都走 formatPrice，没有残留的写死两位小数', () => {
    // 断言的是「@ 价格」这个模式:PnL / 保证金那些确实该用两位小数的地方不在此列。
    for (const rel of ['pages/Index.tsx', 'contexts/TradingContext.tsx', 'hooks/useBackgroundPrices.ts']) {
      const src = read(rel);
      const stale = src.match(/@ \$\{[^}]*\.toFixed\(2\)\}/g) ?? [];
      expect(stale, `${rel} 仍有写死两位小数的成交价`).toEqual([]);
      expect(src).toContain('formatPrice(');
    }
  });

  it('非当前标的的成交提示要带上数量——盘面那条一直有,它一直没有', () => {
    expect(read('hooks/useBackgroundPrices.ts')).toContain('formatSettlementQuantity(position, symbol)');
  });
});
