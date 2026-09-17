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
    expect(columnCount).toBe(14);
    for (const title of ['#', '角色', '时间', '贡献 / 盈亏', 'Δb', '开仓价', '平仓价', '涨跌幅', '币量 / 仓位', '占比', '加仓校验', '手续费', '委托', '操作']) {
      expect(s).toContain(`>${title}</div>`);
    }
  });

  it('贡献 / 盈亏与 Δb 紧跟时间——扫视最先停留的那一段留给要读的结论', () => {
    const s = src();
    const at = (title: string) => s.indexOf(`>${title}</div>`);
    expect(at('时间')).toBeLessThan(at('贡献 / 盈亏'));
    expect(at('贡献 / 盈亏')).toBeLessThan(at('Δb'));
    expect(at('Δb')).toBeLessThan(at('开仓价'));       // 结论在前，"怎么来的"在后
    expect(at('平仓价')).toBeLessThan(at('涨跌幅'));    // 涨跌幅紧贴在开平价右边——它就是这两个数算出来的
    expect(at('涨跌幅')).toBeLessThan(at('币量 / 仓位'));
    expect(at('币量 / 仓位')).toBeLessThan(at('占比'));       // 占比紧贴在币量 / 仓位右边——它就是这一格算出来的
    expect(at('占比')).toBeLessThan(at('加仓校验'));
    expect(at('币量 / 仓位')).toBeLessThan(at('加仓校验'));   // 加仓校验紧跟币量——X 就是它要读的数
    expect(at('加仓校验')).toBeLessThan(at('手续费'));
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
    expect(tracks).toHaveLength(14);
    expect(tracks.filter(track => track.includes('fr'))).toHaveLength(1);
    expect(tracks[12]).toMatch(/^minmax\(2\d\dpx,1fr\)$/);   // 委托：唯一越宽越有用的列
    expect(tracks[2]).toBe('180px');                        // 时间：放得下「开 2025-09-19 22:42」
  });

  it('【用户要求】手续费列放得下「开 82,328 · 平 104,091 ASTER」这类最长的拆分行', () => {
    const grid = /grid-cols-\[([^\]]+)\]/.exec(src())?.[1] ?? '';
    const feeTrack = Number.parseInt(grid.split('_')[11], 10);
    expect(feeTrack).toBeGreaterThanOrEqual(148);
    // 单元格必须带 min-w-0：网格项默认 min-width:auto，长子行会顶破定宽轨道、压到左边一列上
    const cell = /data-testid=\{`leg-fees-\$\{leg\.id\}`\}[\s\S]{0,400}?className="([^"]+)"/.exec(src())?.[1] ?? '';
    expect(cell).toContain('min-w-0');
  });

  it('【用户要求】「占比」紧跟「币量 / 仓位」、约 76px；最小宽度 = Σ轨道 + 每道 10px 列间距 + 左右 24px', () => {
    const s = src();
    const tracks = (/grid-cols-\[([^\]]+)\]/.exec(s)?.[1] ?? '').split('_');
    // 币量 / 仓位：合计行的 Σ币量前多了一枚「多 / 空」标签（约 18px），百亿级 17 个字符（11px 等宽约 112px）加上标签要一行放下
    expect(tracks[8]).toBe('136px');
    expect(tracks[9]).toBe('76px');    // 占比：放得下「多 100.0%」
    // minmax(216px,1fr) 按下限计
    const trackSum = tracks.reduce((sum, track) => sum + Number.parseInt(track.replace(/^minmax\(/, ''), 10), 0);
    const minWidth = Number(/const LEGS_MIN_WIDTH = 'min-w-\[(\d+)px\]'/.exec(s)?.[1]);
    expect(minWidth).toBe(trackSum + 10 * (tracks.length - 1) + 24);
    expect(minWidth).toBe(1714);
  });

  it('【用户要求】冻结「#」与「角色」：「角色」的钉点 = 行左内边距 + # 列宽，四种行都用同一对常量', () => {
    const s = src();
    const tracks = (/grid-cols-\[([^\]]+)\]/.exec(s)?.[1] ?? '').split('_');
    const roleLeft = Number(/const FROZEN_ROLE_CELL = 'sticky left-\[(\d+)px\]/.exec(s)?.[1]);
    // 各行都是 px-3（12px）；「角色」再往左压住「#」2px。钉点错了，「角色」会在滚动时跳一下，或与 # 之间漏出一道缝
    expect(roleLeft).toBe(12 + Number.parseInt(tracks[0], 10) - 2);
    expect(s).toContain("const FROZEN_SEQ_CELL = 'sticky left-0 z-10 -ml-3 ");
    // 负外边距 = gap-x-2.5 的 10px + 重叠 2px；内边距同量，内容仍从原位起
    expect(s).toContain("const FROZEN_ROLE_CELL = 'sticky left-[46px] z-10 -ml-3 self-stretch border-r border-transparent pl-3 ");
    // 表头、数据行、主力阶段子行、合计行各用一次
    expect((s.match(/\$\{FROZEN_SEQ_CELL\}/g) ?? []).length).toBe(4);
    expect((s.match(/\$\{FROZEN_ROLE_CELL\}/g) ?? []).length).toBe(4);
    // 行区不能再套竖向滚动：否则冻结列钉在一个从不横滚的容器上
    expect(s).not.toContain('max-h-[380px] overflow-y-auto');
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
