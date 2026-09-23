import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYMBOL_FILTER_SNAPSHOT_DATE, maxOrderUnits } from '@/lib/marketLotSize';

/**
 * 指南里的「单笔数量上限（市价单）」一行必须与实现、与快照对得上：用户会照着它核对数字。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('指南：单笔数量上限（市价单）', () => {
  const guide = read('pages/GuidePage.tsx');
  const at = guide.indexOf('单笔数量上限（市价单）</td>');
  const row = guide.slice(at, guide.indexOf('</tr>', at));

  it('紧跟在「杠杆分层与仓位上限」那一行后面，快照日期与数据文件一致', () => {
    expect(at).toBeGreaterThan(-1);
    const tiers = guide.indexOf('杠杆分层与仓位上限</td>');
    expect(tiers).toBeGreaterThan(-1);
    expect(tiers).toBeLessThan(at);
    // 两行之间没有别的行
    expect(guide.slice(tiers, at).match(/<tr>/g)?.length).toBe(1);
    expect(SYMBOL_FILTER_SNAPSHOT_DATE).toBe('2026-09-23');
    expect(row).toContain(`快照 <strong>${SYMBOL_FILTER_SNAPSHOT_DATE}</strong>`);
  });

  it('写的数字就是快照里的数字', () => {
    const cases: Array<[string, string]> = [
      ['BTCUSDT 120 BTC', 'BTCUSDT'],
      ['ETHUSDT 2,000 ETH', 'ETHUSDT'],
      ['KAITOUSDT 200,000 KAITO', 'KAITOUSDT'],
      ['TUTUSDT 4,000,000 TUT', 'TUTUSDT'],
      ['ORDIUSDT 20,000 ORDI', 'ORDIUSDT'],
      ['ASTERUSDT 400,000 ASTER', 'ASTERUSDT'],
    ];
    for (const [text, symbol] of cases) {
      expect(row).toContain(text);
      const qty = Number(text.split(' ')[1].replace(/,/g, ''));
      expect(maxOrderUnits(symbol, 'usdt', 'market')).toBe(qty);
    }
    expect(row).toContain('BTCUSD 60,000 张');
    expect(maxOrderUnits('BTCUSDT', 'coin', 'market')).toBe(60_000);
    expect(row).toContain('KAITOUSDT 2,000,000、BTCUSDT 1,000');
    expect(maxOrderUnits('KAITOUSDT', 'usdt', 'limit')).toBe(2_000_000);
    expect(maxOrderUnits('BTCUSDT', 'usdt', 'limit')).toBe(1_000);
    expect(row).toContain('200,000 KAITO = 21,810 张');
    expect(maxOrderUnits('KAITOUSDT', 'coin', 'market', 1.0905)).toBe(21_810);
  });

  it('写明豁免：强平、平掉整个仓位的止盈止损、一键平仓与停止回放的收尾平仓', () => {
    expect(row).toContain('<strong>不受这个上限约束</strong>：引擎强平；平掉整个仓位（100%）的止盈止损');
    expect(row).toContain('closePosition');
    expect(row).toContain('「一键平仓」与停止回放时的收尾平仓');
  });

  it('写明合成币本位里跟踪委托与 TWAP 按哪个价折张、「按上限平」留余量', () => {
    expect(row).toContain('激活价（没有激活价按现价）下方一个回调幅度');
    expect(row).toContain('价格下跌时每片上限随之变小');
    expect(row).toContain('「按上限平」在按现价折的上限前留 0.2% 余量');
  });

  it('「挂得出去就不会在触发时被拒」只对有激活价的卖出跟踪委托成立；没有激活价的与买入方向一样触发时再判', () => {
    expect(row).toContain('<strong>有激活价</strong>时，卖出方向的峰值从激活价起算、只会更高，成交价不会低于它——挂得出去就不会在触发时被拒');
    expect(row).toContain('<strong>没有激活价</strong>时挂出即开始追踪，峰值从挂出之后第一段行情算起，可能低于下单时的现价');
    expect(row).toContain('与买入方向一样在触发那一刻再判一次');
    // 旧的说法不分有没有激活价，一概承诺「不会在触发时被拒」
    expect(row).not.toContain('折张：卖出方向从峰值回撤成交，成交价不会低于它，挂得出去就不会在触发时被拒');
  });

  it('U 本位按 USDT 下单（面板默认的单位）：框里的 USDT 按现价折成币，100% 在上限前同样留 0.2% 余量；条件委托按触发价折，不留', () => {
    expect(row).toContain('U 本位按 USDT 下单（订单金额 / 初始保证金，面板默认的单位）');
    expect(row).toContain('市价、TWAP、跟踪委托的 100% 在上限前同样留 0.2% 余量');
    expect(row).toContain('条件委托按触发价折币，不留');
  });

  it('出路按单子的类型写：市价单拆成几笔或改用限价单；条件单、跟踪委托拆成几张同类的单，不建议改用限价单', () => {
    expect(row).toContain('市价单拆成几笔或改用限价单');
    expect(row).toContain('条件单、跟踪委托拆成几张同类的单（每张不超过上限）');
    expect(row).toContain('换成同价的限价单会立刻按现价成交');
    expect(row).not.toContain('提示写明上限并建议拆成几笔或改用限价单');
  });

  it('平仓弹窗确认按钮写的就是真正平掉的成数；止盈止损最小一格 10% 都放不下时只能设 100%', () => {
    expect(row).toContain('确认按钮上写的就是真正平掉的成数（0.8%）');
    expect(row).toContain('按成数挂的止盈止损最小一格是 10%');
  });

  it('写明仓位比上限大 100 倍以上也能按上限平（不再有 1% 的下限），连一笔都放不下时的出路', () => {
    expect(row).toContain('CYPHUSDT 一笔最多 2,000 CYPH');
    expect(maxOrderUnits('CYPHUSDT', 'usdt', 'market')).toBe(2_000);
    expect(row).toContain('填多少就平多少');
    expect(row).toContain('连最小的一笔都超过上限');
  });

  it('写明怎么平比上限大的仓位、触发时再判不悄悄丢保护、委托列表的标记、面板的小字', () => {
    expect(row).toContain('仓位比上限大，怎么平');
    expect(row).toContain('分几次市价平仓');
    expect(row).toContain('「按上限平」');
    expect(row).toContain('本模拟器没有只减仓的限价平仓单');
    expect(row).toContain('触发时再判，但不悄悄丢掉保护');
    expect(row).toContain('触发时将超单笔上限');
    expect(row).toContain('执行时将超单笔上限');
    expect(row).toContain('「单笔市价上限 200,000 KAITO」');
    expect(row).toContain('TWAP 的<strong>每一片</strong>');
    expect(row).toContain('分段订单的<strong>每张子单</strong>按限价上限判');
    expect(row).toContain('快照里查不到的合约<strong>不设上限</strong>');
    expect(row).toContain('更新前挂出的委托触发时不再判');
  });
});
