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
import { LEG_POSITION_SHARE_COLUMN_TITLES } from '@/lib/legPositionShare';

const src = () =>
  readFileSync(join(process.cwd(), 'src/components/journal/CampaignLegsList.tsx'), 'utf8');

/**
 * 「占比」的列头是可点击排序的按钮，列名在读屏名里，源码里找的是这一处调用；
 * 列名本身来自 LEG_POSITION_SHARE_COLUMN_TITLES（页面与 PNG 共用）——按战役主方向取一侧，主多是「多单占比」。
 * 【用户要求】「空单仓位的占比也不需要，没必要存在」：只有一列占比。
 * 【用户要求 · 四续】「主空战役里，这一列改成按战役主方向算」：那一列的方向由 campaignDirection 定，源码里没有写死的 'long'。
 */
const LONG_SHARE_HEADER = '<PositionShareSortHeader ';
const headerAt = (s: string, title: string) => (
  title === '多单占比' ? s.indexOf(LONG_SHARE_HEADER) : s.indexOf(`>${title}</div>`)
);

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
    expect(columnCount).toBe(13);
    const titles = ['角色', '时间', '贡献 / 盈亏', 'Δb', '开仓价', '平仓价', '涨跌幅', '币量 / 仓位', '多单占比', '加仓校验', '手续费', '委托', '操作'];
    expect(titles).toHaveLength(columnCount);
    for (const title of titles) expect(headerAt(s, title)).toBeGreaterThan(-1);
    // 只有一列占比：列头只调用一次，列名与 PNG 表头同一份
    expect(LEG_POSITION_SHARE_COLUMN_TITLES.long).toBe('多单占比');
    expect(LEG_POSITION_SHARE_COLUMN_TITLES.short).toBe('空单占比');
    expect(s.split(LONG_SHARE_HEADER)).toHaveLength(2);
    // 【用户要求 · 四续】排序、列头、合计格都按 shareSide（战役主方向那一侧）走，没有写死的 'long'
    expect(s).toContain('describeLegPositionShareSort(side, sort)');
    // 排序状态只认当前这一侧：换一场战役 / 方向变了，旧那一侧的排序作废，列头与行序不会脱钩
    expect(s).toContain('nextLegPositionShareSort(current && current.side === shareSide ? current : null, shareSide)');
    expect(s).toContain('const activeShareSort = shareSort && shareSort.side === shareSide ? shareSort : null;');
    expect(s).toContain('sortByLegPositionShare(legs, leg => positionShares.byLeg.get(leg.id), activeShareSort)');
    expect(s).toContain('<PositionShareSortHeader side={shareSide} sort={activeShareSort}');
    expect(s).toContain('resolveLegPositionShareSide(campaignDirection, shareInputs)');
    expect(s).toContain('campaignDirection?: TradeCampaign[\'direction\'] | null;');
    expect(s).toContain('<PositionShareSortHeader side={shareSide}');
    expect(s).toContain('data-testid={`legs-share-sort-${side}`}');
    expect(s).toContain('data-testid={`legs-total-position-share-${shareSide}`}');
    expect(s).not.toContain('\'long\', sort');
    expect(s).not.toContain('current, \'long\'');
    expect(s).not.toContain('>占比</div>');
    // 只有一列：没有按方向逐列生成的格子，列名也不写死在组件里
    expect(s).not.toContain('空单占比');
    expect(s).not.toContain('多单占比');
    expect(s).not.toContain('side="short"');
    expect(s).not.toContain('side="long"');
    expect(s).not.toMatch(/legs-share-sort-(short|long)/);
    expect(s).not.toContain('LEG_POSITION_SIDES');
    // 合计行「占比」格与 Σ 格逐组对齐：本列那一侧之前的每一组垫一组隐形占位（主空战役要垫多单那一组）
    expect(s).toContain('function PositionLinesSpacer()');
    expect((s.match(/<PositionLinesSpacer /g) ?? []).length).toBe(1);
    expect(s).toContain('positionShares.sides.slice(0, shareTotalsAt)');
    // 【用户要求】第一列只有「角色」：不再有「#」列
    expect(s).not.toContain('>#</div>');
    expect(s).not.toContain('leg.leg_sequence ??');
  });

  it('贡献 / 盈亏与 Δb 紧跟时间——扫视最先停留的那一段留给要读的结论', () => {
    const s = src();
    const at = (title: string) => headerAt(s, title);
    expect(at('时间')).toBeLessThan(at('贡献 / 盈亏'));
    expect(at('贡献 / 盈亏')).toBeLessThan(at('Δb'));
    expect(at('Δb')).toBeLessThan(at('开仓价'));       // 结论在前，"怎么来的"在后
    expect(at('平仓价')).toBeLessThan(at('涨跌幅'));    // 涨跌幅紧贴在开平价右边——它就是这两个数算出来的
    expect(at('涨跌幅')).toBeLessThan(at('币量 / 仓位'));
    expect(at('币量 / 仓位')).toBeLessThan(at('多单占比'));   // 多单占比紧贴在币量 / 仓位右边——它就是这一格算出来的
    expect(at('多单占比')).toBeLessThan(at('加仓校验'));
    expect(at('币量 / 仓位')).toBeLessThan(at('加仓校验'));   // 加仓校验紧跟币量——X 就是它要读的数
    expect(at('加仓校验')).toBeLessThan(at('手续费'));
    expect(at('手续费')).toBeLessThan(at('委托'));
    expect(s).not.toContain('>状态</div>');             // 状态并进角色格，不单独占一列
  });

  it('【用户要求】角色格只有一行：不再挂「回填」，阶段开关定宽靠右、离冻结格右缘留 4px；时间标签定宽——长短不一时才不会参差', () => {
    const s = src();
    // 角色格第一行与时间列第一行同高（11px × leading-tight），标签在里面竖直居中；gap-1 是标签与开关之间的最小间距
    expect(s).toContain("const ROLE_LINE = 'flex h-[13.75px] items-center gap-1';");
    // 阶段开关：定宽、ml-auto 靠右，各行的开关左缘在同一条竖线上；mr-1 离右缘 4px，滚出去之后出现的分隔线不压住悬停底色与焦点环
    expect(s).toMatch(/const PHASE_TOGGLE = 'ml-auto mr-1 inline-flex h-\[18px\] w-\[28px\] shrink-0 /);
    // 与角色标签同高（18px）、内容居中：悬停底色与焦点环不比旁边的标签矮，两位数阶段也不贴边
    expect(s).toMatch(/const PHASE_TOGGLE = '[^']*\bjustify-center\b/);
    expect(s).not.toMatch(/>\s*回填\s*</);                              // 回填标签去掉了（来源只在悬停说明里）
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
    // 逐腿输入由共享函数 buildLegPositionShareInputs 算（Legs 表、导出 PNG、盈亏概览「多方总名义仓位」共用）
    expect(src()).toContain('buildLegPositionShareInputs(legs, recordMap, legExitPriceCorrections, fillEvidence)');
    const shared = readFileSync(join(process.cwd(), 'src/lib/legPositionShareInputs.ts'), 'utf8');
    // 反向合约面值锁在 USD 上，光看名义看不出这条腿拿着多少币
    expect(shared).toContain('leg.pre_position_size / entryPrice');
    // 价格缺失或为 0 时不猜一个币量出来
    expect(shared).toContain('entryPrice > 0');
  });

  it('弹性列是「委托」而不是「时间」——时间内容定宽，让它吃富余会在表格中段留下空洞', () => {
    const grid = /grid-cols-\[([^\]]+)\]/.exec(src())?.[1] ?? '';
    const tracks = grid.split('_');
    expect(tracks).toHaveLength(13);
    expect(tracks.filter(track => track.includes('fr'))).toHaveLength(1);
    expect(tracks[11]).toMatch(/^minmax\(2\d\dpx,1fr\)$/);   // 委托：唯一越宽越有用的列
    expect(tracks[1]).toBe('180px');                        // 时间：放得下「开 2025-09-19 22:42」
  });

  it('【用户要求】手续费列放得下「开 82,328 · 平 104,091 ASTER」这类最长的拆分行', () => {
    const grid = /grid-cols-\[([^\]]+)\]/.exec(src())?.[1] ?? '';
    const feeTrack = Number.parseInt(grid.split('_')[10], 10);
    expect(feeTrack).toBeGreaterThanOrEqual(148);
    // 单元格必须带 min-w-0：网格项默认 min-width:auto，长子行会顶破定宽轨道、压到左边一列上
    const cell = /data-testid=\{`leg-fees-\$\{leg\.id\}`\}[\s\S]{0,400}?className="([^"]+)"/.exec(src())?.[1] ?? '';
    expect(cell).toContain('min-w-0');
  });

  it('【用户要求】只有「多单占比」一列，紧跟「币量 / 仓位」、72px；最小宽度 = Σ轨道 + 每道 10px 列间距 + 左右 24px', () => {
    const s = src();
    const tracks = (/grid-cols-\[([^\]]+)\]/.exec(s)?.[1] ?? '').split('_');
    // 角色：最长的「重新入场主力 2」标签带进行中圆点（95.4px）+ 最小间距 4 + 阶段开关 28 + 离右缘 4，一行放下（浏览器里量过）
    expect(tracks[0]).toBe('132px');
    const toggleWidth = Number(/const PHASE_TOGGLE = '[^']*\bw-\[(\d+)px\]/.exec(s)?.[1]);
    expect(toggleWidth).toBe(28);
    expect(Math.ceil(95.4 + 4 + toggleWidth + 4)).toBeLessThanOrEqual(Number.parseInt(tracks[0], 10));
    // 币量 / 仓位：合计行的 Σ币量前多了一枚「多 / 空」标签（约 18px），百亿级 17 个字符（11px 等宽约 112px）加上标签要一行放下
    expect(tracks[7]).toBe('136px');
    // 多单占比：列头「标签 + 占比 + 排序图标」（57px）与「100.0%」（40px）都一行放下（浏览器里量过）
    expect(tracks[8]).toBe('72px');
    // 「空单占比」那一道 72px 连同它的 10px 列间距一起去掉：加仓校验紧跟在后面，宽度不变
    expect(tracks[9]).toBe('116px');
    expect(tracks.filter(track => track === '72px')).toHaveLength(1);
    // minmax(216px,1fr) 按下限计
    const trackSum = tracks.reduce((sum, track) => sum + Number.parseInt(track.replace(/^minmax\(/, ''), 10), 0);
    const minWidth = Number(/const LEGS_MIN_WIDTH = 'min-w-\[(\d+)px\]'/.exec(s)?.[1]);
    expect(minWidth).toBe(trackSum + 10 * (tracks.length - 1) + 24);
    expect(minWidth).toBe(1668);
    expect(1750 - minWidth).toBe(72 + 10);
  });

  it('【用户要求】只冻结「角色」一列：钉在 left-0，负外边距盖住行的左内边距；四种行都用同一个常量', () => {
    const s = src();
    const tracks = (/grid-cols-\[([^\]]+)\]/.exec(s)?.[1] ?? '').split('_');
    // 各行都是 px-3（12px）：-ml-3 把冻结格伸到 0，pl-3 把内容推回原位——一整块实心底，没有两格之间的接缝
    expect(s).toContain("const FROZEN_ROLE_CELL = 'sticky left-0 z-10 -ml-3 self-stretch pl-3 ");
    expect(s).not.toContain('FROZEN_SEQ_CELL');
    expect(s).not.toMatch(/sticky left-\[\d+px\]/);
    // 右缘分隔线与阴影画在伪元素上，滚出去之后才出现
    expect(s).toContain('group-data-[scrolled=true]/legs:before:opacity-100 group-data-[scrolled=true]/legs:after:opacity-100');
    // 表头、数据行、主力阶段子行、合计行各用一次
    expect((s.match(/\$\{FROZEN_ROLE_CELL\}/g) ?? []).length).toBe(4);
    // 键盘滚动留白 = 冻结宽度 = 行左内边距 + 角色列宽
    const frozenWidth = 12 + Number.parseInt(tracks[0], 10);
    // 表体不再竖向滚动（整张表展开、合计行不吸底），只剩横向滚动：底部不用留白，顶部与左侧仍要
    expect(s).toContain(`const LEGS_SCROLL_PADDING = 'scroll-pt-8 scroll-pl-[${frozenWidth}px]';`);
    // 冻结格里的阶段开关用同样大小的负滚动外边距抵掉左侧留白（改角色列宽时两处一起改）
    expect(s).toMatch(new RegExp(`const PHASE_TOGGLE = '[^']*-scroll-ml-\\[${frozenWidth}px\\]`));
    // 右缘分隔线（不透明）上下各多伸 2px，盖住行分隔线那一像素与取整绘制的偏差；
    // 阴影（半透明）上端贴顶，下端按行型定（腿行与阶段块最后一行伸过 1px 的行分隔线），四种行各选一次
    expect(s).toContain("before:absolute before:-inset-y-0.5 before:right-0");
    expect(s).toContain("after:absolute after:top-0 after:-right-2");
    expect(s).not.toMatch(/after:inset-y-0|after:-inset-y/);
    expect(s).toContain("overRule: 'after:-bottom-px'");
    expect((s.match(/FROZEN_SHADOW_BOTTOM\.(flush|overRule)/g) ?? []).length).toBe(5);
    // 行底分隔线画在冻结格之上（z-[11]），腿行与阶段块都用它
    expect(s).toMatch(/const ROW_RULE = "relative border-b border-transparent [^"]*after:z-\[11\]/);
    expect((s.match(/\$\{ROW_RULE\}/g) ?? []).length).toBe(2);
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
