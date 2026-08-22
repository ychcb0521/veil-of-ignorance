/**
 * Legs 表的栅格守卫。
 *
 * 起因：新增「盈亏 / 贡献」列时只改了表头的 grid-cols，数据行少一列，
 * 最后一列「操作」被挤进隐式新行，整张表错位、按钮逐字竖排。
 * 这条测试确保表头与数据行永远共用同一份列定义。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = () =>
  readFileSync(join(process.cwd(), 'src/components/journal/CampaignLegsList.tsx'), 'utf8');

describe('Legs 表栅格', () => {
  it('列定义只有一份常量，表头与数据行都引用它', () => {
    const s = src();
    expect(s).toContain('const LEGS_GRID =');
    // 除常量声明外，不得再出现写死的 grid-cols-[...]
    const inlineGrids = s.match(/grid-cols-\[/g) ?? [];
    expect(inlineGrids.length).toBe(1);
    // 表头、数据行、主力阶段子行、合计行各引用一次
    expect((s.match(/\$\{LEGS_GRID\}/g) ?? []).length).toBe(4);
  });

  it('列定义的列数与表头单元格数一致', () => {
    const s = src();
    const grid = /grid-cols-\[([^\]]+)\]/.exec(s)?.[1] ?? '';
    // 用下划线分隔，但 minmax(200px,1fr) 内部没有下划线，可安全按 _ 切
    const columnCount = grid.split('_').length;
    expect(columnCount).toBe(11);
    for (const title of ['#', '角色', '时间', '开仓价', '平仓价', '仓位 / 币量', '状态', '盈亏 / 贡献', 'Δb', '委托', '操作']) {
      expect(s).toContain(`>${title}</div>`);
    }
  });

  it('画出合计行——它按构造恒等于盈亏概览，是防止两套账再次分家的可视断言', () => {
    const s = src();
    expect(s).toContain('data-testid="legs-total-row"');
    // 合计必须取自战役唯一真源，不能在组件里另起一套求和
    expect(s).toContain('computeCampaignRealizedPnl');
    expect(s).toContain('settlement.total');
  });

  it('仓位列同时给出名义与币量——币量 = 名义 ÷ 开仓价，就是加仓公式里的 X', () => {
    const src_ = src();
    // 反向合约面值锁在 USD 上，光看名义看不出这条腿拿着多少币
    expect(src_).toContain('leg.pre_position_size / entryPriceValue');
    // 价格缺失或为 0 时不猜一个币量出来
    expect(src_).toContain('entryPriceValue > 0');
    expect(src_).toContain('legCoinQty');
  });

  it('时间列用 minmax 而非裸 1fr——裸 1fr 被压窄时会让文字逐字竖排', () => {
    expect(/grid-cols-\[[^\]]*minmax\(200px,1fr\)/.test(src())).toBe(true);
  });

  it('操作列是图标按钮，中文标签进 title 而不是渲染成文字', () => {
    const s = src();
    expect(s).toContain("title=\"查看复盘\"");
    expect(s).toContain("aria-label=\"解除\"");
    // 旧写法把中文直接渲染在按钮里，窄列下会折成竖排
    expect(s).not.toContain('>\n                      查看复盘\n');
  });
});
