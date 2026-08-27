import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** 从 `from` 处的 `{` 起，取到它配对的 `}`。 */
function blockAt(source: string, from: number): string {
  const open = source.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error('unbalanced');
}

/**
 * setOrdersMap / setPositionsMap / setBalance **不是** React 的 updater，
 * 而是即时推进 ref 的包装（TradingContext.tsx）：当场跑一遍回调、把结果写进 ref、
 * 再交给 React。所以在一个 updater **内部**再调用同一个 setter 是危险的——
 * 内层写进 ref 的东西，会被外层随后返回的 next 覆盖掉。
 *
 * 这正是随单止盈止损在逐 K 线撮合里被静默抹掉的原因：成交后当场挂保护单，
 * 保护单写进 ordersMapRef，外层 updater 再用它捕获的 prev 算出 next 覆盖回去，
 * 于是仓位开了、钱扣了、保护单一张不剩，而且这个版本还被持久化。
 */
describe('成交点的写入顺序', () => {
  it('【回归】逐 K 线撮合不得在 setOrdersMap 的回调里挂保护单', () => {
    const src = read('pages/Index.tsx');
    const marker = src.indexOf('for (const kline of newKlines) {');
    expect(marker).toBeGreaterThan(-1);
    const updaterStart = src.indexOf('setOrdersMap((prev) => {', marker);
    expect(updaterStart).toBeGreaterThan(-1);

    const body = blockAt(src, updaterStart);
    expect(body).not.toContain('applyAttachedTpSl(');
    // 攒起来、等外层写完再挂
    expect(body).toContain('attachAfterFill.push(');
    expect(src).toContain('for (const { position, order } of attachAfterFill)');
  });

  it('setOrdersMap 确实是即时包装——这条前提如果变了，上面那条就该重写', () => {
    const ctx = read('contexts/TradingContext.tsx');
    expect(ctx).toContain('ordersMapRef.current = next;');
    expect(ctx).toContain('balanceRef.current = next;');
  });

  it('【回归】成交时的判定基准是钱包自由现金，不是「余额 − 全仓保证金」', () => {
    // calcAvailable 把已经从余额里扣掉的全仓保证金又减了一遍。
    // 那个重复计算在下单侧只是偏严（可重试），在成交侧是不可逆的撤单。
    const ctx = read('contexts/TradingContext.tsx');
    const at = ctx.indexOf('const settleFillDebit');
    expect(at).toBeGreaterThan(-1);
    const body = blockAt(ctx, at);
    expect(body).toContain('availableUsd: balanceRef.current');
    expect(body).not.toContain('calcAvailable(');
  });

  it('闸门必须排在减仓分支之后——止盈止损是退还保证金的，绝不能被它拦下', () => {
    const idx = read('pages/Index.tsx');
    const bg = read('hooks/useBackgroundPrices.ts');
    for (const [name, src] of [['Index.tsx', idx], ['useBackgroundPrices.ts', bg]] as const) {
      const reduceAt = src.indexOf('order.reduceOnly && order.linkedPositionId');
      const gateAt = src.indexOf('settleFillDebit(');
      expect(reduceAt, `${name} 缺少减仓短路分支`).toBeGreaterThan(-1);
      expect(gateAt, `${name} 缺少扣款闸门`).toBeGreaterThan(-1);
      expect(reduceAt, `${name}: 闸门跑到减仓分支前面了`).toBeLessThan(gateAt);
    }
  });
});
