import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiquidationModal } from '@/components/LiquidationModal';
import { liquidationNoticeCopy, mergeLiquidationDetails, type LiquidationNoticeCopy } from '@/lib/liquidationNotice';

const text = (c: LiquidationNoticeCopy) => `${c.lead}${c.emphasis}${c.tail}${c.footnote}`;

/**
 * 逐仓强平接入爆仓弹窗之后，原来那段写死给全仓的文案（「所有持仓已按市价强制平仓」
 * 「包含 0.5% 强平清算费」）对逐仓全是错的；连全仓自己也不动逐仓仓位。
 */
describe('爆仓弹窗口径', () => {
  it('逐仓：不说「所有持仓/所有挂单」、不说 0.5% 强平费；说明亏损以保证金为限', () => {
    const t = text(liquidationNoticeCopy('isolated'));
    expect(t).not.toMatch(/所有持仓|所有挂单/);
    expect(t).not.toContain('0.5%');
    expect(t).toContain('保证金为限');
    expect(t).toContain('其余仓位不受影响');
  });

  it('全仓：只动全仓仓位，逐仓不受影响；费率取自常量', () => {
    const t = text(liquidationNoticeCopy('cross'));
    expect(t).toContain('逐仓仓位不受影响');
    expect(t).toContain('0.5% 强平清算费');
    expect(t).toContain('维持保证金率 0.4%');
  });

  it('逐仓一次打掉多笔：不说「该仓位」', () => {
    const t = text(liquidationNoticeCopy('isolated', 3));
    expect(t).toContain('3 笔逐仓仓位');
    expect(t).not.toContain('该仓位');
  });

  it('缺省按全仓口径（老调用方）', () => {
    expect(liquidationNoticeCopy()).toEqual(liquidationNoticeCopy('cross'));
  });

  it('弹窗开着时再爆：数字累加，口径不同则标为 mixed', () => {
    const a = { lostAmount: 100, liquidatedPositions: 1, scope: 'isolated' as const };
    expect(mergeLiquidationDetails(a, { lostAmount: 50, liquidatedPositions: 2, scope: 'isolated' }))
      .toEqual({ lostAmount: 150, liquidatedPositions: 3, scope: 'isolated' });
    expect(mergeLiquidationDetails(a, { lostAmount: 50, liquidatedPositions: 2, scope: 'cross' }).scope).toBe('mixed');
    expect(mergeLiquidationDetails({ lostAmount: 1, liquidatedPositions: 1 }, { lostAmount: 1, liquidatedPositions: 1 }).scope)
      .toBe('cross');
  });

  it('弹窗按口径渲染', () => {
    const render = (scope: 'isolated' | 'cross') => renderToStaticMarkup(createElement(LiquidationModal, {
      open: true, onClose: () => {}, details: { lostAmount: 13_684, liquidatedPositions: 1, scope },
    }));
    const iso = render('isolated');
    expect(iso).toContain('保证金为限');
    expect(iso).not.toContain('所有持仓');
    expect(iso).toContain('-13684.00 USDT');
    expect(render('cross')).toContain('逐仓仓位不受影响');
  });
});
