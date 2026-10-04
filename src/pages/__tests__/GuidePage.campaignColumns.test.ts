import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 指南里「战役列表」几段话要与页面对得上：排序行的新次序与左对齐、封面指标左对齐与排序高亮、
 * 涨跌幅 / 涨跌幅倍数 / 加仓效用的公式浮层与散点图。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('指南：战役列表的排序次序、封面统计格与新增散点图', () => {
  const guide = read('pages/GuidePage.tsx');
  const page = read('pages/JournalCampaignsPage.tsx');

  it('排序行的次序与页面 SORT_OPTIONS 一致', () => {
    const block = /const SORT_OPTIONS[^=]*= \[([\s\S]*?)\n\];/.exec(page)?.[1] ?? '';
    const labels = [...block.matchAll(/label: '([^']+)'/g)].map(match => match[1]);
    // 【用户要求】操作时间、镜像止盈 ┆ 预期回撤 … 算术期望 ┆ 杠杆倍数 … 字母（自评在杠杆倍数之后、字母之前；「DSI 贡献」「USI 贡献」已删）
    expect(labels).toEqual([
      '操作时间', '镜像止盈', '预期回撤', '涨跌幅', '涨跌幅倍数', '盈亏比', '加仓效用', '加仓次数', '涨幅未兑现', '几何期望',
      '算术期望', '杠杆倍数', '自评', '字母',
    ]);
    expect(guide).toContain('排序行原有的「DSI 贡献」「USI 贡献」两项已删掉——它们与盈亏比几乎同序，单场的 DSI/USI 贡献仍在详情页「盈亏概览」里，整表的 DSI / USI 仍在统计概览的「不对称风险」里');
    expect(guide).not.toContain('<SubTitle>DSI 贡献率与 USI 贡献率</SubTitle>');
    const at = guide.indexOf('排序行依次是');
    expect(at).toBeGreaterThan(-1);
    const sentence = guide.slice(at, at + 260);
    let cursor = 0;
    for (const label of labels) {
      const next = sentence.indexOf(label, cursor);
      expect(next, `指南里「${label}」的位置`).toBeGreaterThanOrEqual(cursor);
      cursor = next + label.length;
    }
  });

  it('写明排序行左对齐、封面指标左对齐与排序高亮，以及新增三项的公式浮层', () => {
    // 【用户要求】「排序方式这里不美观。这里还是用左对齐吧」
    expect(guide).toContain('排序行<strong>左对齐</strong>、按钮依次排开、间距均匀');
    expect(guide).not.toContain('与上方排序行的同名按钮共用同一套列');
    // 【用户要求】「交易战役的封面上的指标做成左对齐，要美观，不需要均匀分布」：左对齐、按读数定宽，顺序与排序行一致
    expect(guide).toContain('第二层<strong>左对齐、紧凑排开</strong>');
    expect(guide).not.toContain('<strong>等宽的统计格</strong>');
    expect(guide).toContain('<strong>顺序与排序行一致</strong>：镜像止盈状态、预期回撤、涨跌幅、涨跌幅倍数、盈亏比、加仓效用、加仓次数、单场几何期望、单场算术期望');
    expect(guide).toContain('<strong>同名的项在上下各张卡片上落在同一条竖线上</strong>');
    // 【用户要求】「选中排序功能的时候，交易战役封面上对应的模块高亮显示」
    expect(guide).toContain('<strong>当前排序项在封面上高亮</strong>');
    expect(guide).not.toContain('DSI / USI 贡献不在封面上');
    // 旧的按读数定宽、窄屏自然换行的说法不再出现
    expect(guide).not.toContain('列宽按真实最长的读数定');
    expect(guide).not.toContain('卡片按原顺序自然换行');
    // 【用户要求】「分布要做的非常均匀，美观，不要有没必要的空隙」：宽度按当前列表里实际出现的读数定，不再按理论最长读数写死
    expect(guide).toContain('每项的宽度按<strong>当前列表里实际出现的读数</strong>定');
    expect(guide).not.toContain('每项的宽度按它自己最长的真实读数定');
    // 宽度按整个时间段算、不随排序变：切换排序（会筛掉算不出这一项的战役）时文字不挪，与「高亮只换底色」同一句话不打架
    expect(page).toContain('const cardMetricWidths = useMemo(() => cardMetricWidthStyle(displayRows), [displayRows]);');
    expect(guide).toContain('换一个时间段，宽度跟着这一段的战役重算；<strong>切换排序不改宽度</strong>');
    expect(guide).toContain('高亮只换底色，切换排序时文字不会挪动');
    expect(guide).not.toContain('换一个排序或时间段');
    expect(guide).toContain('首次加载时战役分批到达，宽度可能随新到的读数放宽，加载完就定下来');
    // 【用户要求】「盈亏比只保留括号内的数字，把百分比部分删除」
    expect(guide).toContain('<strong>盈亏比只写倍数 b</strong>（如「34.60」「-0.80」），不再写百分数和括号');
    expect(guide).toContain('页面只写倍数 bᵢ（两位小数，如 34.60、-0.80），不写百分数');
    expect(guide).toContain('不到 0.005 的读作 0.00、用中性色，不按原始正负上红绿');
    expect(guide).not.toContain('页面同时显示百分数和括号内数字');
    expect(guide).not.toContain('76740.80%（767.41）');
    // 「仓位击穿」挪到标题行、紧跟杠杆倍数
    expect(guide).toContain('杠杆倍数（仓位击穿的战役紧跟一枚红色的「仓位击穿」标签）');
    expect(guide).toContain('卡片标题行紧跟杠杆倍数的「仓位击穿」标签');
    expect(guide).not.toContain('几何期望连同「仓位击穿」徽标');
    expect(page.indexOf('data-testid="campaign-ruinous-sizing"')).toBeGreaterThan(page.indexOf('data-testid="campaign-leverage"'));
    // 与页面常量一致：手机两列、≥ 640px 左对齐排开
    expect(page).toContain("const CARD_METRIC_STRIP = 'grid grid-cols-2 gap-1 sm:flex sm:flex-wrap sm:gap-x-2 sm:gap-y-1';");
    expect(guide).toContain('自评放在后面，排在字母之前');
    expect(guide).not.toContain('排序行依次是自评');
    expect(guide).toContain('涨跌幅、涨跌幅倍数、加仓效用与其他公式指标一样，<strong>双击或右键</strong>打开公式浮层');
  });

  it('散点图清单与颜色说明包含涨跌幅、涨跌幅倍数、加仓效用', () => {
    expect(guide).toContain('盈亏比、预期回撤、涨跌幅、涨跌幅倍数、加仓效用、加仓次数、算术期望、几何期望、自评、镜像止盈都各自配有一张散点图');
    // 【用户要求】颜色一律按这一场的 b 的正负分，不按图上的指标
    expect(guide).toContain('<strong>颜色一律按这一场的盈亏比 b 的正负分</strong>');
    expect(guide).toContain('没有加仓、或涨跌幅倍数显示为 0.00 的战役不进加仓效用图');
    // 【用户要求】涨跌幅倍数为负的也算、分布图上下镜像
    expect(guide).toContain('<strong>涨跌幅倍数为负的也算，分母取绝对值、正负跟随 b</strong>');
    expect(guide).toContain('<strong>加仓效用分布图上下镜像</strong>');
    // 页面上确实给三项注册了散点图
    for (const key of ['mainPriceChange', 'mainPriceEfficiency', 'addEfficiency']) {
      expect(page).toContain(`key: '${key}',`);
      expect(page).toMatch(new RegExp(`${key}: '${key}Sort'`));
      expect(page).toMatch(new RegExp(`${key}: '${key}',`));
    }
  });
  it('【用户要求】散点图一屏看全：图盒高度按窗口算、放不下时压紧行距——指南与实现对得上', () => {
    expect(guide).toContain('<strong>整张图一屏看全</strong>：图盒的高度按窗口算');
    expect(guide).toContain('点排序项把图滚进视野时，图的顶边停在吸顶区正下方');
    expect(guide).toContain('<strong>把这一图的行距均匀压紧</strong>');
    expect(guide).toContain('行距压到 4px（相邻两点只露出一半）还放不下，才把顶上那一截合成一个三角并在脚注报数');
    expect(guide).toContain('<strong>图盒的高度拉满这一屏</strong>');
    expect(guide).toContain('窗口很矮时不低于 18rem');
    expect(guide).not.toContain('堆得比图高还高时先把图盒撑高，撑到上限仍放不下的那一截在柱顶合成一个三角');
    // 实现里的三个数：行距下限 4px、盒高上限 704px（44rem）与下限 288px（18rem）
    expect(read('components/charts/stackLayout.ts')).toContain('export const STACK_PITCH_FLOOR = 4;');
    const plot = read('components/charts/ScatterPlot.tsx');
    expect(plot).toContain('const STACK_BOX_CAP = 704;');
    expect(plot).toContain('const STACK_BOX_FLOOR = 288;');
    expect(guide).toContain('展开「说明」或点开合并三角的战役列表时图盒高度不变');
    expect(guide).toContain('盒高不超过窗口高减 14rem');
    expect(plot).toContain('max-h-[max(18rem,calc(100dvh-14rem))]');
    expect(plot).toContain('data-chart-fit="ignore"');
    // 页面把按视口算出的上限传给图，并让面板滚进视野时停在吸顶区下方
    expect(page).toContain('maxBoxHeight={chartMaxBoxHeight}');
    expect(page).toContain('style={{ scrollMarginTop: CAMPAIGN_PAGE_HEADER_HEIGHT + stickyControlsHeight }}');
  });
  it('【用户要求】涨幅未兑现的图点开就完整：沿用上次读数、整图一次换新、旧读数只在图上——指南与页面的文案对得上', () => {
    expect(guide).toContain('<strong>涨幅未兑现也有散点图，点开就是完整的图。</strong>');
    expect(guide).toContain('<strong>行情需要重算时（改过腿、口径升级、缓存失效）先沿用上次的读数把整张图画出来</strong>');
    expect(guide).toContain('图右上角写「沿用上次读数 N 场 · 后台更新中」');
    expect(guide).toContain('<strong>整张图一次换成新值</strong>');
    expect(guide).toContain('接口暂时不通时改写「等待自动重试」、断网时改写「离线，联网后继续」');
    expect(guide).toContain('<strong>沿用的旧读数只在图上</strong>：卡片封面、排序、统计、「已计算 x / y 场」与导出一律只用当前算出来的值');
    expect(guide).toContain('图区先显示「正在计算涨幅未兑现… x / N 场」的进度');
    expect(guide).toContain('主力已平仓的战役历史行情确实取不到时记为「资料不完整」，十分钟内不再重复请求，点「重试缺失项」或刷新页面才重新读取；主力还在持仓的战役窗口一直在变，每次重新计算都会再读一次');
    // 页面上的文案与默认视图
    expect(page).toContain("`沿用上次读数 ${unrealizedChart.cachedCount} 场 · ${pricePaths.offline ? '离线，联网后继续' : unrealizedQueueStalled ? '等待自动重试' : '后台更新中'}`");
    expect(page).toContain('title="正在计算涨幅未兑现…"');
    expect(page).toContain("unrealizedPriceChangePct: 'unrealizedPriceChangePctDistribution'");
    expect(page).toContain('重试缺失项');
    // 「十分钟」与实现一致
    const hook = readFileSync(join(process.cwd(), 'src/hooks/useCampaignPricePaths.ts'), 'utf8');
    expect(hook).toContain('const TERMINAL_MEMORY_TTL_MS = 10 * 60_000;');
    // 「资料不完整」只对主力已平仓的战役记住；进行中的每次重读
    expect(hook).toContain("// An ongoing campaign's window keeps moving, so its verdict is never final.\n  if (!task.historical) return;");
  });
  it('【用户要求】涨跌幅、涨跌幅倍数、加仓效用、算术期望默认看分布，可切回时序；加仓效用另有 1.00 参照线', () => {
    expect(guide).toContain('<strong>盈亏比、涨跌幅、涨跌幅倍数、加仓效用、算术期望与几何期望默认展开的是分布图；镜像止盈、预期回撤、自评与加仓次数默认展开的是柱状图</strong>');
    // 【用户要求】预期回撤柱状按倒数 100 ÷ D% 等间距分档，默认打开。
    expect(guide).toContain('<strong>倒数 100 ÷ D%</strong> 等间距分档');
    expect(page).toContain("expectedDrawdownPct: 'expectedDrawdownPctBars'");
    expect(page).toContain("importance: 'importanceBars'");
    expect(guide).toContain('<strong>自评默认看柱状。</strong>');
    expect(guide).toContain('<strong>涨跌幅、涨跌幅倍数、加仓效用、算术期望默认看分布</strong>');
    expect(guide).toContain('<strong>琥珀色 1.00 虚线</strong>「加仓没有额外放大」');
    expect(guide).toContain('用面板右上角的「时序 | 分布」切回时序');
    for (const source of ['mainPriceChange', 'mainPriceEfficiency', 'addEfficiency', 'arithmeticExpectancy']) {
      expect(page).toContain(`${source}: '${source}Distribution'`);
    }
  });
  it('【用户要求】涨跌幅：开仓价取主力最有利的一笔；主力平仓时有对冲锁住行情就按对冲开仓价（初始对冲 A/B 算滚动对冲，回场对冲只认同平）', () => {
    expect(guide).toContain('<strong>开仓价取主力各笔里最有利的那个</strong>（主多最低、主空最高）');
    expect(guide).toContain('<strong>平仓价看主力平仓那一刻有没有对冲把行情锁住</strong>');
    expect(guide).toContain('<strong>已触发的初始对冲 A/B 在这里也算滚动对冲</strong>');
    expect(guide).toContain('<strong>回场对冲只认与主力同一次操作里平掉</strong>（主力平仓后它仍持有不算）');
    // 旧口径「初始对冲 A/B 不算」不能留在指南里，与「A/B 算滚动对冲」自相矛盾
    expect(guide).not.toContain('初始对冲 A/B 不算');
    expect(guide).not.toMatch(/主力有几笔时取涨(跌)?幅最大的那笔/);
    expect(page).not.toContain('主力 = 名义最大的 main_open');
  });
  it('【用户要求】盈亏概览：右栏加入动态最大回撤，并将两项名义仓位合并为仓位放大', () => {
    expect(guide).toContain('左栏是<strong>层层递进的一列</strong>——预期回撤、涨跌幅、涨跌幅倍数、盈亏比、加仓效用、几何期望、算术期望');
    // 【用户要求】「最大预期亏损放在那一列的第一个」
    expect(guide).toContain('右栏是结果与仓位——第一个是<strong>最大预期亏损</strong>，与左栏第一个的预期回撤同一行');
    expect(guide).toContain('<strong>动态最大回撤</strong>');
    expect(guide).toContain('<strong>仓位放大</strong>');
    expect(guide).toContain('同一份 14 项指标（左栏：预期回撤');
  });
  it('【用户要求】多级排序：单击替换、「+」加层、手机长按、排序链、缺值规则、清除保留第一级', () => {
    const sortLib = read('lib/campaignListSort.ts');
    expect(guide).toContain('<strong>多级排序</strong>：<strong>单击</strong>排序项仍是只按这一项排');
    expect(guide).toContain('点它右上角出现的<strong>「+」</strong>，这一项就追加为下一级');
    expect(guide).toContain('「+」挂在排序项右上角外沿、只盖住角上一小块，不挡文字与 Σ');
    expect(guide).toContain('多级时单击链上的某一项＝只按它排、方向不变，双击看说明不改排序链');
    expect(guide).toContain('手机上没有悬停，<strong>长按排序项</strong>加一级（短按仍是只按它排）');
    expect(guide).toContain('「① 镜像止盈 ↓ › ② 加仓效用 ↓」');
    expect(guide).toContain('<strong>「清除」回到单级、保留第一级</strong>');
    expect(guide).toContain('只有一级时这条链不出现，界面与原来一样');
    expect(guide).toContain('<strong>进不进列表只由第一级决定</strong>');
    expect(guide).toContain('<strong>第二级起算不出的战役留在本档、排到本档末尾</strong>（不论这一级是升序还是降序）');
    expect(guide).toContain('之后每级一个 then=项.方向');
    expect(guide).toContain('跟随上一级的写 then=项.follow');
    expect(guide).toContain('「双向 → 降序 → 升序」');
    expect(guide).toContain('严格按照上一级的原始读数与升降序排列');
    // 与实现对得上：清除保留第一级、URL 第一级仍是 sort / direction、之后 then；长按 450ms
    expect(sortLib).toContain('return chain.length <= 1 ? chain : [chain[0]];');
    expect(sortLib).toContain("params.append('then', `${level.mode}.${level.follow ? 'follow' : level.direction}`);");
    expect(page).toContain('const SORT_LONG_PRESS_MS = 450;');
    expect(page).toContain('{sortChain.length > 1 && renderSortChainBar()}');
    // 「+」挂在右上角（与级数角标同位），没显形时不接收指针
    expect(page).toMatch(/const SORT_ADD_BUTTON = 'pointer-events-none absolute -right-1 -top-1 /);
    expect(page).toContain('加一级：悬停排序项，点右上角的「+」；手机上长按排序项。');
  });
  it('【用户已定】连续指标作第一级时按四分位分档；排序链每一级标出本级排了几场', () => {
    const sortLib = read('lib/campaignListSort.ts');
    expect(guide).toContain('<strong>第一级是连续数值指标时分档</strong>');
    expect(guide).toContain('先把进入列表的战役分成四档（档界按当前列表算，降序时数值最高的一档在前），同档内按后面各级排，各级都打平再按第一级本身的数值');
    // 【用户要求】与 0 相关的指标：0 的分界线保留、正负两侧各按场数对半
    expect(guide).toContain('以 0 为界</strong>：负的一侧与正的一侧<strong>各按场数对半分</strong>成两档');
    expect(guide).toContain('排序链上第一级标着<strong>「分档」</strong>，悬停或点它（也可点 ⓘ）看档界');
    expect(guide).toContain('档界按封面精度取整、就是那一档里最小的读数，封面读数相同的战役必在同一档');
    expect(guide).toContain('镜像止盈 / 自评 / 杠杆倍数 / 字母 / 操作时间不分档，只有一级时也不分档（与原来逐位相同）');
    expect(guide).toContain('<strong>「本级排了 N 场」</strong>');
    expect(guide).toContain('（悬停或点它看明细）');
    expect(guide).toContain('<strong>「未起作用」</strong>= 前面各级没有并列、并列的读数全相同（比如某一档里全是 5 分），或并列的都算不出这一项');
    // 与实现对得上：七个连续指标；只有一级永远不分档；分档按封面精度取整；第一级分档后各级都打平再按它本身的数值；读数全相同的组记 tied
    expect(sortLib).toContain("'expectedDrawdownPct',\n  'mainPriceChange',\n  'mainPriceEfficiency',\n  'unrealizedPriceChangePct',\n  'captureRate',\n  'addEfficiency',\n  'geometricExpectancy',\n  'arithmeticExpectancy',\n]);");
    expect(sortLib).toContain('return chain.length > 1 && isContinuousSortMode(chain[0].mode);');
    expect(sortLib).toContain('export function sortBinValue(');
    expect(sortLib).toContain('const own = firstKey.compare(a, b, first.direction);');
    expect(sortLib).toContain('tied: number;');
    expect(page).toContain('data-testid="sort-chain-binned"');
    expect(page).toContain('data-testid={`sort-chain-effect-${index + 1}`}');
    expect(page).toContain('data-testid="sort-chain-current"');
    expect(page).toContain('先把列表分成四档');
    expect(page).toContain("phrase: '以 0 为界、正负两侧各按场数对半分成四档'");
  });
  it('【用户要求】反事实盘面与原始盘面同高', () => {
    expect(guide).toContain('<strong>反事实盘面与原始盘面同高</strong>');
  });
});
