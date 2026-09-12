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
    for (const title of ['#', '角色', '时间', '贡献 / 盈亏', 'Δb', '开仓价', '平仓价', '币量 / 仓位', '手续费', '委托', '操作']) {
      expect(s).toContain(`>${title}</div>`);
    }
  });

  it('贡献 / 盈亏与 Δb 紧跟时间——扫视最先停留的那一段留给要读的结论', () => {
    const s = src();
    const at = (title: string) => s.indexOf(`>${title}</div>`);
    expect(at('时间')).toBeLessThan(at('贡献 / 盈亏'));
    expect(at('贡献 / 盈亏')).toBeLessThan(at('Δb'));
    expect(at('Δb')).toBeLessThan(at('开仓价'));       // 结论在前，"怎么来的"在后
    expect(at('手续费')).toBeLessThan(at('委托'));
    expect(s).not.toContain('>状态</div>');             // 状态并进角色格，不单独占一列
  });

  it('回填标签靠右对齐、时间标签定宽——角色名与标签长短不一时才不会参差', () => {
    const s = src();
    expect(s).toContain('flex items-center justify-between gap-1.5');   // 角色格：标签推到右缘
    expect(s).toContain("const TIME_LABEL = 'inline-block w-[30px]");   // 时间格：三行时间戳同起点
    expect((s.match(/\{TIME_LABEL\}/g) ?? []).length).toBe(3);          // 开 / 平 / 操作 共用它
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

  it('弹性列是「委托」而不是「时间」——时间内容定宽，让它吃富余会在表格中段留下空洞', () => {
    const grid = /grid-cols-\[([^\]]+)\]/.exec(src())?.[1] ?? '';
    const tracks = grid.split('_');
    expect(tracks).toHaveLength(11);
    expect(tracks.filter(track => track.includes('fr'))).toHaveLength(1);
    expect(tracks[9]).toContain('minmax(224px,1fr)');      // 委托：唯一越宽越有用的列
    expect(tracks[2]).toBe('180px');                        // 时间：放得下「开 2025-09-19 22:42」
  });

  it('操作列只留两个图标按钮（标到盘面 / 解除），中文标签进 title 而不是渲染成文字', () => {
    const s = src();
    expect(s).toContain("aria-label=\"解除\"");
    expect(s).toContain("'标到盘面'");
    expect(s).not.toContain('查看复盘');     // 这个入口已按要求去掉
    // 旧写法把中文直接渲染在按钮里，窄列下会折成竖排
    expect(s).not.toContain('>\n                      查看复盘\n');
  });
});
