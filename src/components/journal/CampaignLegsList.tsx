import { useCallback, useId, useMemo, useRef, useState } from 'react';
import type { UIEvent } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Crosshair, EyeOff, Unlink } from 'lucide-react';
import { LegRoleChip } from '@/components/journal/LegRoleChip';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { HEDGE_TYPE_LABELS } from '@/lib/hedgeTypes';
import { buildTradeRecordLookup, journalOperationTime } from '@/lib/objectiveOperationTime';
import { buildDisplayReverseOrderLegMap } from '@/lib/campaignReverseOrderAttribution';
import { formatForeignReplayOrdersNote } from '@/lib/campaignReverseOrderLines';
import { buildMainLegOrdinals } from '@/lib/campaignMainLegOrdinals';
import { resolveMirrorTpOrderTiming } from '@/lib/campaignMirrorTpOrderTiming';
import type { CampaignEvent, TradeJournal } from '@/types/journal';
import { computeLegPnlContributions, sumLegPnl } from '@/lib/campaignLegPnl';
import { computeCampaignRealizedPnl, settlementBasisLabel } from '@/lib/campaignRealizedPnl';
import { formatDeltaB, legDeltaB, roundedDeltaB, splitMainLegPhases, type MainLegPhase } from '@/lib/campaignLegPhases';
import { computeLegPriceChangePct, formatLegPriceChangePct, legPriceChangeDirection } from '@/lib/legPriceChange';
import {
  computeLegPositionShares,
  describeLegPositionShare,
  describeLegPositionDenominators,
  describeLegPositionShareSort,
  describeLegPositionSideTotal,
  formatLegCoinQuantity,
  formatLegNotional,
  formatLegPositionSharePct,
  formatLegPositionShareTotal,
  legPositionSideFromDirection,
  nextLegPositionShareSort,
  sortByLegPositionShare,
  LEG_POSITION_SIDE_LABELS,
  type LegPositionShareSort,
  type LegPositionSide,
} from '@/lib/legPositionShare';
import {
  LEG_RETROACTIVE_HINT,
  LEG_ROW_STATUS_HINTS,
  LEG_UNCLASSIFIED_HINT,
  legRowStatus,
  type LegRowStatus,
} from '@/lib/legRowStatus';
import { formatFeeCoin, sumTradeRecordFees, tradeRecordFees } from '@/lib/tradeFees';
import {
  addSizingSnapshotLines,
  describeAddSizingVerdict,
  evaluateCampaignAddSizing,
  formatAddSizingCoinQuantity,
  formatAddSizingNotional,
  formatAddSizingShortfall,
  type AddSizingVerdict,
} from '@/lib/campaignAddSizingCheck';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

interface Props {
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  campaignEvents?: CampaignEvent[];
  legExitPriceCorrections?: LegExitPriceCorrections;
  reverseHedgeOrders?: CampaignReverseHedgeOrder[];
  /** 别的回放留下、本场期间仍挂着的委托：不放进任何腿的行，只在表下方写一行淡注。 */
  foreignLiveOrders?: CampaignReverseHedgeOrder[];
  highlightedLegIds?: string[];
  onToggleHighlight?: (leg: TradeJournal) => void;
  onHideReverseHedgeOrder?: (order: CampaignReverseHedgeOrder) => void;
  onDetach?: (leg: TradeJournal) => void;
  /** 战役的初始最大预期亏损 L（USDT）；Δb 列 = 各腿盈亏 ÷ L。缺失时 Δb 显示「—」。 */
  initialExpectedMaxLoss?: number | null;
}

/**
 * 角色标签的悬停说明：没有角色的先说明「—」是什么；没有平仓时说状态（挂单中 / 进行中）；历史回填的腿再补一句来源。
 * 状态与「多单占比」、合计行 Σ 的排除读的是同一个 legRowStatus，几处永远一致。
 */
function roleChipTitle(status: LegRowStatus, retroactive: boolean, unclassified: boolean): string | undefined {
  const lines = [
    ...(unclassified ? [LEG_UNCLASSIFIED_HINT] : []),
    ...(status === 'closed' ? [] : [LEG_ROW_STATUS_HINTS[status]]),
    ...(retroactive ? [LEG_RETROACTIVE_HINT] : []),
  ];
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function fmtClock(value: number | string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 委托卡片里的时刻：同一天只写 HH:mm，跨天才补 MM-DD。
 * 卡片里原本三行各印一遍完整日期（年份也在），一张卡四行高，三张就把行撑破、
 * 还要靠内部滚动切成半张。行头已经写着这条腿的开平日期，卡片只需要说"几点"。
 */
function fmtCardTime(value: number | null | undefined, sameDayAs?: number | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDayAs) {
    const ref = new Date(sameDayAs);
    if (!Number.isNaN(ref.getTime()) && ref.toDateString() === date.toDateString()) return hm;
  }
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`;
}

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toPrecision(6);
}

/**
 * Legs 表的列宽 —— 表头与数据行共用同一个常量。
 *
 * 弹性那一格给**委托**，不给时间。时间列的内容是定宽的（「开 2025-09-19 22:42」），
 * 让它吃掉所有富余宽度，富余就会变成表格中段一片空洞，而右侧的委托卡片反倒挤到发虚。
 * 委托是唯一"越宽越有用"的列，多出来的宽度停在它和操作列之间，视觉上是留白而不是裂口。
 *
 * 列序按**阅读价值**排，不按录入顺序排：贡献 / 盈亏与 Δb 紧跟在时间之后，落在从左往右
 * 扫视最先停留的那一段；开平价、涨跌幅、币量、多单占比、手续费这些"怎么来的"排在后面；委托与操作收在右端。
 * 第一列只有「角色」：不再印腿的序号，也不再挂「回填」标签（来源写在角色标签的悬停说明里）。
 * 「状态」不单独占一列——已平仓是绝大多数，只在**没有**平仓时把角色标签本身画成另一种样子
 * （挂单中：虚线空心；进行中：标签里一枚小圆点）。

 *
 * 这里曾经把表头和行各写一份，加列时只改了表头，行少一列，
 * 最后一列「操作」被挤进隐式新行、整张表错位。共用一份后物理上不可能再失配。
 *
 * 时间列用 minmax(200px, 1fr) 而不是裸 1fr：裸 1fr 在容器被压窄时会缩到
 * 放不下「操作 2026-08-21 11:03」，导致文字逐字竖排。
 */
/**
 * Δb 是这张表的主角（这条腿把整场的 b 推高/拉低了多少），用最大字号 + 淡色底的胶囊固定住视线。
 * 底色只取 12% 透明度：密排表格里满色块会盖过数字本身。
 */
function deltaTone(delta: number | null): string {
  if (delta == null || roundedDeltaB(delta) === 0) return 'bg-muted text-muted-foreground';
  // 透明度必须写成 /[0.12]：任意色 + 非标准透明度档（/12）Tailwind 不会生成规则，底色会静默失效。
  return delta > 0
    ? 'bg-[#0ECB81]/[0.12] text-[#0ECB81]'
    : 'bg-[#F6465D]/[0.12] text-[#F6465D]';
}


/** 时间列里「开 / 平 / 操作」三个标签的定宽，保证三行时间戳起点对齐。 */
const TIME_LABEL = 'inline-block w-[30px] text-muted-foreground';

/** 手续费列表头的说明：币安的算式、费率档与「盈亏列为什么已经扣了平仓费」。 */
const FEE_COLUMN_HINT = '币安口径：手续费 = 名义 × 费率，开仓、平仓各收一次；市价单 / 触发单 Taker 0.05%，盘口限价单 Maker 0.02%。'
  + 'U 本位：名义 = 数量 × 成交价，以 USDT 计，平仓价越高平仓费越高。'
  + '币本位：名义 = 张数 × 面值 ÷ 成交价，收的是币——折成美元后价格被约掉，所以开平两笔的美元数必然相同，币数才不同（价越高付的币越少），本列因此按币显示。'
  + '盈亏列已扣平仓费；开仓费在开仓当时从钱包扣除。旧记录未存开仓费，按当时 0.04% Taker 估算并标明。';

// 角色 132px：最长的「重新入场主力 2」标签带「进行中」小圆点（实测 95.4px）+ 最小间距 4 + 阶段开关 28 + 开关离右缘 4 = 131.4px，一行放下
// 币量 / 仓位 136px：合计行的 Σ币量前面多了一枚「多 / 空」标签，百亿级（17 个字符）加上标签也要一行放下
// 多单占比 72px：列头「标签 + 占比 + 排序图标」（实测 57px）与「100.0%」（约 40px）都一行放下；
// 再宽，右对齐的百分数就离左边的币量太远，读不成一组。占比只给多单这一列：空单不单独算占比
const LEGS_GRID = 'grid-cols-[132px_180px_116px_84px_88px_88px_84px_136px_72px_116px_148px_minmax(216px,1fr)_64px]';

/**
 * 各列合计的下限，与 LEGS_GRID 对应；不足时容器横向滚动而不是压扁列。
 * = Σ轨道 + 列间距 gap-x-2.5 × (列数 − 1) + 左右 px-3。加一列要连同它带来的那一道 10px 间距一起加上。
 */
const LEGS_MIN_WIDTH = 'min-w-[1668px]';

/**
 * 冻结列：「角色」横向滚动时钉在左缘，滑到右边的列也认得出是哪条腿。
 * 它是每行的第一格：用负外边距把行的左内边距（px-3 = 12px）盖住、pl-3 再把内容推回原位，
 * 从 0 到 12px + 角色列宽是一整块实心底，钉在 left-0，滚过去的内容不会从左边透出来。
 * 只有这一格冻结，没有两格之间的接缝，非整数缩放（90%、110%…）下也不会抗锯齿出一条透字的缝。
 * 主力的阶段开关就在这一格的第一行（角色标签右边），冻结着，滚到右边也点得到。
 * self-stretch：与整行同高，盖住右边更高的格子（时间列有三四行）；再按所在行的上下内边距用负外边距伸出去（FROZEN_PAD），
 * 上下相邻两行的冻结格首尾相接，右缘的分隔线与阴影才是一整条，而不是一格一段。
 * 行底还有 1px 的分隔线边框（ROW_RULE），不属于冻结格的盒子，每道行分隔线处都会断开一个像素，所以：
 * - 分隔线上下各多伸 2px（-inset-y-0.5）：它是不透明的，与相邻格的分隔线重叠处看不出来；
 *   只伸 1px 不够——非整数缩放（90%）下，行挪过位（排序、展开阶段）之后 Chrome 取整绘制钉住的格子，伪元素的端点会再偏一个设备像素；
 *   伸出表格上下两端的部分被滚动容器裁掉，表头与合计行（z-20）盖住伸进去的那一截；
 * - 阴影是半透明的，重叠处会深一档，只在下面有行分隔线时往下伸 1px（FROZEN_SHADOW_BOTTOM）。
 * 分隔线与阴影只在滚出去之后出现（容器上的 data-scrolled），没滚时表格看起来和原来一样。
 * 两样都画在伪元素上，不占格子的盒子：
 * - 分隔线（before）不用 border-r——边框下面要么铺着底色、盖掉高亮行蓝框的那 1px，
 *   要么改成 bg-clip-padding，Chrome 在 2 倍屏、非整数行高下又会把行底的分隔线吃掉一段；
 * - 阴影（after）是一条横向渐变：box-shadow 在每格上下两端会收窄，连起来是一串缺口。
 * 行高常是小数（11px 字 × 1.25 这类），Chrome 给钉住的格子取整绘制时底色会往下多铺半个到一个像素，
 * 正好压在这一行底边的分隔线上（展开 / 收起阶段、重新排序让行挪位之后最明显）——分隔线因此画在冻结格之上，见 ROW_RULE。
 */
const FROZEN_ROLE_CELL = 'sticky left-0 z-10 -ml-3 self-stretch pl-3 transition-colors '
  + "before:pointer-events-none before:absolute before:-inset-y-0.5 before:right-0 before:w-px before:bg-border before:opacity-0 before:content-[''] "
  + "after:pointer-events-none after:absolute after:top-0 after:-right-2 after:w-2 after:bg-gradient-to-r after:from-black/10 after:to-transparent after:opacity-0 after:content-[''] "
  + 'group-data-[scrolled=true]/legs:before:opacity-100 group-data-[scrolled=true]/legs:after:opacity-100';

/**
 * 冻结格右缘阴影的下端：
 * - flush：表头、合计行、阶段块里除最后一行外的阶段子行——下面没有行分隔线，紧接着的下一格自己会接上；
 * - overRule：腿行、阶段块的最后一行——下面是 1px 的行分隔线（ROW_RULE），往下多伸 1px 盖过去，
 *   分隔线叠在上面（z-[11]），交叉处两条线都完整。阶段子行之间不能也伸：阴影是半透明的，重叠的那一像素会深一档。
 */
/**
 * 合计行的冻结格：分隔线只往上伸，不往下伸。合计行是 legs-scroll 里最后渲染的东西，
 * 伸出它下沿的那 2px 不会被裁掉，而是算进可滚动的溢出——每张表都会因此能被竖向滚动 2px、滚轮不再带动页面。
 * 所以 legs-scroll 里任何东西都不许伸到合计行下沿之外。Tailwind 把 bottom 排在 inset-y 之后，这一条盖过 -inset-y-0.5 的下半截。
 */
const FROZEN_TOTAL_DIVIDER = 'before:bottom-0';

const FROZEN_SHADOW_BOTTOM = {
  flush: 'after:bottom-0',
  overRule: 'after:-bottom-px',
} as const;

/**
 * 腿行与阶段块底边的分隔线：边框本身透明（行高不变），线画在伪元素上、叠在冻结格（z-10）之上、表头与合计行（z-20）之下，
 * 冻结格取整绘制时多铺出来的那一点底色盖不住它，横穿冻结列的分隔线始终完整。
 */
const ROW_RULE = "relative border-b border-transparent after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:z-[11] after:h-px after:bg-border/40 after:content-['']";

/** 冻结格上下伸出的量 = 所在行的 py：表头与合计行 py-2、数据行 py-2.5、阶段子行 py-1。 */
const FROZEN_PAD = {
  header: '-my-2 py-2',
  row: '-my-2.5 py-2.5',
  phase: '-my-1 py-1',
  total: '-my-2 py-2',
} as const;

/**
 * 冻结格的底色必须不透明，否则底下滚过去的数字会透出来。
 * 行自己的底色是半透明的（bg-muted/40、/20、高亮行的蓝），这里用 bg-card 打底、再叠一层同色的渐变，
 * 冻结格与它所在的行看起来是同一种颜色。
 */
const HEADER_FILL = 'bg-card bg-[linear-gradient(hsl(var(--muted)/0.4),hsl(var(--muted)/0.4))]';
const PHASE_FILL = 'bg-card bg-[linear-gradient(hsl(var(--muted)/0.2),hsl(var(--muted)/0.2))]';
const ROW_FILL = 'bg-card group-hover/row:bg-accent';
const HIGHLIGHTED_ROW_FILL = 'bg-card bg-[linear-gradient(rgba(0,47,167,0.05),rgba(0,47,167,0.05))] group-hover/row:bg-accent group-hover/row:bg-none';
/**
 * 高亮行整行有一圈 ring-1 ring-inset；冻结格盖在它的左端上，这里把左、上、下三道接着画出来，框才是完整的。
 * 颜色取行上 ring 实际渲染出的值：ring-[#002FA7]/12 是任意色 + 非标准透明度档，Tailwind 不生成颜色规则，
 * 落回默认 ring 色 rgba(59,130,246,0.5)。
 */
const HIGHLIGHTED_ROLE_RING = 'shadow-[inset_1px_0_0_rgba(59,130,246,0.5),inset_0_1px_0_rgba(59,130,246,0.5),inset_0_-1px_0_rgba(59,130,246,0.5)]';

/**
 * 角色格第一行的高度 = 时间列第一行（11px 字 × leading-tight）：标签在这一行里竖直居中，
 * 与「开 2026-…」那一行的中线对齐；标签比这一行高出的部分上下对称地伸进行的内边距里。
 * gap-1 只是标签与阶段开关之间的最小间距（最长的标签时才用得上），平常开关贴着右侧，离标签更远。
 */
const ROLE_LINE = 'flex h-[13.75px] items-center gap-1';

/** 角色标签在表里的统一尺寸：行高 14px，加上下 2px 内边距共 18px；字体与表头一致用无衬线。 */
const ROLE_CHIP_SIZE = 'shrink-0 whitespace-nowrap font-sans leading-[14px]';

/**
 * 主力阶段开关：定宽 28px（两位数的阶段数也放得下）、靠右（ml-auto），不同行的开关左缘在同一条竖线上；
 * 高 18px 与角色标签同高，内容居中：悬停底色与焦点环和旁边的标签一样高，两位数时左右也各留出约 3px；
 * 箭头的 viewBox 左侧自带 4px 空白，用 -ml-1 抵掉，箭头与数字看起来才是居中的一组。
 * 离冻结格右缘留 4px（mr-1）：滚出去之后右缘出现分隔线，悬停底色与 1px 焦点环都不会贴上去、被它盖住。
 * 箭头朝右 = 折叠，转 90° 朝下 = 展开；后面的数字是阶段数，淡色小字，悬停变深。
 * -scroll-ml-[144px]（= 冻结宽度，见 LEGS_SCROLL_PADDING）：开关钉在冻结列里、永远看得见，
 * 键盘把焦点移过来时不必为了避开左侧的滚动留白把表格横向滚回最左边。
 */
const PHASE_TOGGLE = 'ml-auto mr-1 inline-flex h-[18px] w-[28px] shrink-0 -scroll-ml-[144px] items-center justify-center gap-px rounded-sm font-sans text-[10px] leading-none tabular-nums '
  + 'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** 横向滚出去时给容器打标，冻结列据此画出右缘分隔线；直接写 DOM 属性，滚动时不触发整表重渲染。 */
function markLegsScrolled(event: UIEvent<HTMLDivElement>) {
  const el = event.currentTarget;
  const scrolled = el.scrollLeft > 0 ? 'true' : 'false';
  if (el.dataset.scrolled !== scrolled) el.dataset.scrolled = scrolled;
}

/**
 * 「涨跌幅」列表头的说明：按这条腿的方向计，正数即在价格上占优。
 * 「与盈亏同号」只对所示的这一对开平价成立：一个仓位分几刀平掉时，平仓价只显示最后一刀（buildTradeRecordLookup
 * 把仓位折到最晚那条记录），盈亏却是各刀合计，两格可以一红一绿——所以要明说，不许诺无条件同号。
 */
const PRICE_CHANGE_COLUMN_HINT = '按这条腿的方向计——多单 =（平仓价 − 开仓价）÷ 开仓价，空单 =（开仓价 − 平仓价）÷ 开仓价；'
  + '正数即这条腿在价格上占优，按所示的这一对开平价看与「贡献 / 盈亏」同号'
  + '（不计手续费；一个仓位分几刀平掉时平仓价取最后一刀、盈亏是各刀合计，符号可能不同）；'
  + '阶段子行按主力方向、各自起止价计算。';

/** 涨跌幅的字色：正绿负红（按方向计，正即占优）；取整为 0 与缺值都是中性淡色。alpha 用于阶段子行的 /90。 */
function priceChangeTone(pct: number | null, muted = false): string {
  const direction = legPriceChangeDirection(pct);
  if (direction === 'up') return muted ? 'text-[#0ECB81]/90' : 'text-[#0ECB81]';
  if (direction === 'down') return muted ? 'text-[#F6465D]/90' : 'text-[#F6465D]';
  return muted ? '' : 'text-muted-foreground';
}

/**
 * 滚动区四周被钉住的东西各留一截滚动留白。键盘把焦点移到某个按钮（标到盘面 / 解除 / 加仓校验的红叉）时，
 * 浏览器只保证它落在滚动区之内——恰好落在边上，就会被钉住的那一块盖住：
 * - 顶：表头贴在顶边（约 32px）→ scroll-pt-8；
 * - 左：「角色」冻结在左缘（0 到 12px 行内边距 + 132px 角色列 = 144px）→ scroll-pl-[144px]。
 * 钉住的那几块里自己的按钮（列头的排序按钮、冻结格里的阶段开关）用负的 scroll-margin 抵掉这截留白，
 * 否则焦点一落到它们身上，浏览器就会为了「让它离开留白」去滚动表格，而它们本来就一直看得见。
 */
const LEGS_SCROLL_PADDING = 'scroll-pt-8 scroll-pl-[144px]';

/**
 * 「多单占比」列头的说明：多单各腿占多单合计的百分比；空单的行留空、也不进分母；挂单中的腿不进合计；点列头排序。
 * 只给读屏（aria-description）；排序状态在按钮的读屏名里（describeLegPositionShareSort）。
 */
const LONG_SHARE_COLUMN_HINT = '这条多单占全部计入的多单的百分比：上行币量、下行名义仓位；状态为「挂单中」的对冲 / 镜像腿不计入。'
  + '空单的行这一列留空，空单也不进分母；合计行写多单各腿合计的 100.0%（多单没有计入的腿时不写；某一行没有分母时那一行写「—」），与「币量 / 仓位」里多单那组 Σ 对齐。'
  + '点击列头按本列排序：降序 → 升序 → 默认顺序。';

/**
 * 标签的配色写成完整类名：Tailwind 只认源码里整段出现的类名，拼接出来的不会生成规则。
 * 透明度 /[0.08] 同 deltaTone 的写法：任意色 + 非标准档必须用方括号。
 */
const POSITION_SIDE_TAG_TONE: Record<LegPositionSide, string> = {
  long: 'border-[#0ECB81]/40 bg-[#0ECB81]/[0.08] text-[#0ECB81]',
  short: 'border-[#F6465D]/40 bg-[#F6465D]/[0.08] text-[#F6465D]',
};

/**
 * 「多 / 空」小标签：币安仓位方向色的描边胶囊。挂在「多单占比」的列头，以及合计行「币量 / 仓位」格每组 Σ 的上行。
 * 字号 9px、行高 11px，加上下边框 13px，比上行 11px 字的行高（15px）矮——行高一格不变。
 */
function PositionSideTag({ side }: { side: LegPositionSide }) {
  return (
    <span
      data-testid="position-side-tag"
      data-side={side}
      className={`inline-flex shrink-0 items-center rounded-sm border px-[3px] font-sans text-[9px] font-medium leading-[11px] ${POSITION_SIDE_TAG_TONE[side]}`}
    >
      {LEG_POSITION_SIDE_LABELS[side]}
    </span>
  );
}

/**
 * 合计行「币量 / 仓位」与「多单占比」共用的一组两行：上行（Σ 格带方向标签）+ 下行淡色小字。
 * 两格都用它，行高逐组一致，「100.0%」才会与多单那组 Σ 落在同一条水平线上
 * （标签 13px 高，矮于上行 11px 字的行高，带不带标签这一行都一样高）。
 */
function PositionLines({
  side,
  withTag,
  top,
  bottom,
  testId,
}: {
  side: LegPositionSide | null;
  withTag: boolean;
  top: string;
  bottom: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} data-side={side ?? undefined}>
      <div className="flex items-center justify-end gap-1">
        {side && withTag && <PositionSideTag side={side} />}
        <span>{top}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">{bottom}</div>
    </div>
  );
}

/**
 * 合计行「币量 / 仓位」与「多单占比」两格共用的样式。self-start：两格都贴着合计行的顶边排，
 * 「多单占比」只有一组，不会在行里居中，才与左格的第一组（多单那组，先多后空）落在同一条水平线上。
 */
const TOTAL_POSITION_CELL = 'self-start space-y-1 text-right font-mono font-normal tabular-nums leading-snug text-foreground/55';

/**
 * 「多单占比」列头：原生按钮（键盘可用），点击在 降序 → 升序 → 默认顺序 之间循环。
 * 看得见的是「多」标签 +「占比」+ 排序图标；读屏名是完整的「按多单占比排序：当前…，点击…」。
 * 表头不是真正的表格语义（没有 role="columnheader"），所以不用 aria-sort，状态写在读屏名里。
 * 不挂悬停说明（title）：用户明确不要列头上弹出的那块黑底长说明，列头的意思由标签、图标与指南交代。
 * 列说明只给读屏（aria-description，不显示），排序状态在读屏名里，不念两遍。
 * -scroll-mt-8：按钮在钉住的表头里、永远看得见，键盘焦点移过来时不必为了避开顶部的滚动留白把表体往上滚。
 */
function PositionShareSortHeader({
  sort,
  onSort,
}: {
  sort: LegPositionShareSort | null;
  onSort: () => void;
}) {
  const label = describeLegPositionShareSort('long', sort);
  const direction = sort?.side === 'long' ? sort.direction : null;
  const Icon = direction === 'desc' ? ArrowDown : direction === 'asc' ? ArrowUp : ArrowUpDown;
  return (
    <button
      type="button"
      data-testid="legs-share-sort-long"
      onClick={onSort}
      aria-label={label}
      aria-description={LONG_SHARE_COLUMN_HINT}
      className={`flex w-full min-w-0 -scroll-mt-8 items-center justify-end gap-1 whitespace-nowrap rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
        direction ? 'text-foreground' : ''
      }`}
    >
      <PositionSideTag side="long" />
      <span>占比</span>
      <Icon aria-hidden="true" className={`h-3 w-3 shrink-0 ${direction ? '' : 'text-muted-foreground/50'}`} />
    </button>
  );
}

/** 「加仓校验」列表头的说明：两本账合起来能否抹平新加仓退回止损线的亏损。 */
const ADD_SIZING_COLUMN_HINT = '仅加仓行：旧仓浮盈垫 X₁(S₁ − S̄) + 已落袋 G ≥ 新加仓最大预期亏损 X₂(S₂ − S₁) 即为合规（主空符号翻转）。'
  + 'X₁ 只算加仓那一刻还拿着的币；G 是本轮持仓加仓前逐刀落袋的净额（正向只认止盈1 / 镜像止盈，本轮已实现亏损含强平一律扣掉，可为负）。'
  + 'S₁ 取加仓那一刻挂着（或加仓后 5 分钟内补挂）、在亏损侧离加仓价最近的反向委托价；不计手续费，与加仓计算器同一口径。';

function signedUsdt(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${formatAddSizingNotional(value)} U`;
}

function AddSizingDetailDialog({
  leg,
  verdict,
  onClose,
}: {
  leg: TradeJournal;
  verdict: AddSizingVerdict;
  onClose: () => void;
}) {
  const actualCoins = verdict.x2Coins;
  const actualNotional = actualCoins != null && verdict.s2 != null ? actualCoins * verdict.s2 : null;
  const excessCoins = actualCoins != null && verdict.maxAllowedCoins != null
    ? Math.max(0, actualCoins - verdict.maxAllowedCoins)
    : null;
  const excessNotional = excessCoins != null && verdict.s2 != null ? excessCoins * verdict.s2 : null;
  const d = leg.direction === 'short' ? -1 : 1;
  // 加仓校验只给 main_add_N 的腿打标，标题就用角色里的编号（表里不再印腿的序号，这里也不拿它兜底）
  const addOrdinal = leg.leg_role?.match(/^main_add_(\d+)$/)?.[1] ?? '';
  const averageEntry = verdict.x1Coins != null && verdict.x1Coins > 0
    && verdict.s1 != null && verdict.cushion != null
    ? verdict.s1 - verdict.cushion / (verdict.x1Coins * d)
    : null;
  const lossFormula = leg.direction === 'short' ? 'S₁ − S₂' : 'S₂ − S₁';
  const lossPriceTerms = leg.direction === 'short'
    ? `${fmtPrice(verdict.s1)} − ${fmtPrice(verdict.s2)}`
    : `${fmtPrice(verdict.s2)} − ${fmtPrice(verdict.s1)}`;
  const cushionFormula = leg.direction === 'short' ? 'X₁ × (S̄ − S₁)' : 'X₁ × (S₁ − S̄)';
  const cushionPriceTerms = leg.direction === 'short'
    ? `${fmtPrice(averageEntry)} − ${fmtPrice(verdict.s1)}`
    : `${fmtPrice(verdict.s1)} − ${fmtPrice(averageEntry)}`;
  const snapshotLines = addSizingSnapshotLines(verdict);

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[600px]" data-testid="add-sizing-detail-dialog">
        <DialogHeader>
          <DialogTitle>加仓{addOrdinal} · Plan B 仓位校验</DialogTitle>
          <DialogDescription>
            “正确加仓”指 Plan B 允许的最大币量；U 是它按加仓价 S₂ 折算的名义仓位。两者是同一仓位，不是两个可相加的额度。
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-[#F6465D]/30 bg-[#F6465D]/[0.07] p-4">
          <div className="text-xs font-medium text-[#F6465D]">Plan B 加仓上限</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[#F6465D]" data-testid="add-sizing-correct-coins">
            {formatAddSizingCoinQuantity(verdict.maxAllowedCoins)} 币
          </div>
          <div className="mt-1 text-sm tabular-nums text-foreground/70" data-testid="add-sizing-correct-notional">
            ≈ {formatAddSizingNotional(verdict.maxAllowedNotional)} U 名义仓位
          </div>
          <div className="mt-3 border-t border-[#F6465D]/20 pt-3 text-xs leading-relaxed text-foreground/65">
            实际加仓 {formatAddSizingCoinQuantity(actualCoins)} 币（{formatAddSizingNotional(actualNotional)} U），
            超出 {formatAddSizingCoinQuantity(excessCoins)} 币（{formatAddSizingNotional(excessNotional)} U）。
          </div>
        </div>

        {/* 成交记录带着计算器当时的计划：把「计算时」「下单时」「实际成交」并排摆出来。
            判定仍按成交价；这里只解释红叉从哪来——真是滑点才点名滑点，价格变了、量超了各说各的。 */}
        {snapshotLines && (
          <div data-testid="add-sizing-snapshot-line" className="rounded border border-border px-3 py-2 text-xs leading-relaxed text-foreground/70">
            <div className="text-muted-foreground">加仓计算器当时的计划{verdict.snapshot?.orderKind === 'limit' ? '（限价 @S₂）' : verdict.snapshot?.orderKind === 'conditional' ? '（条件委托 @S₂ · 触发后市价，含滑点）' : '（市价 · 含滑点）'}</div>
            <div className="font-mono tabular-nums">{snapshotLines.calc}；</div>
            {snapshotLines.order && <div data-testid="add-sizing-order-line" className="font-mono tabular-nums">{snapshotLines.order}；</div>}
            <div className="font-mono tabular-nums">{snapshotLines.actual}。</div>
            {snapshotLines.slippage && (
              <div data-testid="add-sizing-slippage-line" className="mt-1 font-medium text-[#F6465D]">{snapshotLines.slippage}。</div>
            )}
            {snapshotLines.cause && (
              <div data-testid="add-sizing-cause-line" className="mt-1 font-medium text-[#F6465D]">{snapshotLines.cause}。</div>
            )}
          </div>
        )}

        <div className="space-y-2 text-xs">
          <div className="font-medium text-foreground">计算过程</div>
          <div className="grid grid-cols-3 gap-3 rounded bg-muted/35 px-3 py-2">
            <span className="text-muted-foreground">① 旧仓浮盈垫 Y₁</span>
            <span className="col-span-2 text-right font-mono tabular-nums">
              {cushionFormula} = {formatAddSizingCoinQuantity(verdict.x1Coins)} × ({cushionPriceTerms}) = {signedUsdt(verdict.cushion)}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded bg-muted/35 px-3 py-2">
            <span className="text-muted-foreground">② 已落袋 G</span>
            <span className="col-span-2 text-right font-mono tabular-nums">{signedUsdt(verdict.banked)}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded bg-muted/35 px-3 py-2">
            <span className="text-muted-foreground">③ 可用覆盖额</span>
            <span className="col-span-2 text-right font-mono tabular-nums">
              Y₁ + G = {signedUsdt(verdict.cushion)} + {signedUsdt(verdict.banked)} = {signedUsdt(verdict.required)}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded bg-muted/35 px-3 py-2">
            <span className="text-muted-foreground">④ 每币风险</span>
            <span className="col-span-2 text-right font-mono tabular-nums">
              |{lossFormula}| = |{lossPriceTerms}| = {fmtPrice(verdict.riskPerCoin)} U/币
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded bg-muted/35 px-3 py-2">
            <span className="text-muted-foreground">⑤ 正确币量上限</span>
            <span className="col-span-2 text-right font-mono tabular-nums">
              max(0, Y₁ + G) ÷ 每币风险 = {formatAddSizingCoinQuantity(verdict.maxAllowedCoins)} 币
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded bg-muted/35 px-3 py-2">
            <span className="text-muted-foreground">⑥ 折算 U 仓位</span>
            <span className="col-span-2 text-right font-mono tabular-nums">
              {formatAddSizingCoinQuantity(verdict.maxAllowedCoins)} × S₂ {fmtPrice(verdict.s2)} = {formatAddSizingNotional(verdict.maxAllowedNotional)} U
            </span>
          </div>
        </div>

        <div className="rounded border border-border px-3 py-2 text-xs leading-relaxed text-foreground/70">
          实际新仓最大预期亏损 {formatAddSizingNotional(verdict.maxLoss)} U，可用覆盖额 {formatAddSizingNotional(verdict.required)} U，
          尚缺 <span className="font-semibold text-[#F6465D]">{formatAddSizingShortfall(verdict.shortfall ?? 0)} U</span>。
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CampaignLegsList({
  legs,
  tradeRecords,
  campaignEvents = [],
  legExitPriceCorrections = {},
  reverseHedgeOrders = [],
  foreignLiveOrders = [],
  highlightedLegIds = [],
  onToggleHighlight,
  onHideReverseHedgeOrder,
  onDetach,
  initialExpectedMaxLoss = null,
}: Props) {
  const [addSizingDetailLegId, setAddSizingDetailLegId] = useState<string | null>(null);
  // 「多单占比」的点击排序：只在本组件里记，不持久化；null = 默认顺序（legs 传进来的先后）。只有这一列能排，状态里只会是多单
  const [shareSort, setShareSort] = useState<LegPositionShareSort | null>(null);
  const legsScrollRef = useRef<HTMLDivElement>(null);
  const toggleShareSort = useCallback(() => {
    // 换了排序就回到表体顶端，排在最前的行直接看得见；横向位置不动。
    // 在重排之前归零：滚动位置为 0 时浏览器不做滚动锚定，不会为了盯住原来顶上那一行又把表体滚下去。
    const scroller = legsScrollRef.current;
    if (scroller) scroller.scrollTop = 0;
    setShareSort(current => nextLegPositionShareSort(current, 'long'));
  }, []);
  // 主力阶段子行默认折叠：展开的是哪几条主力，按腿 id 记，不持久化
  const [expandedPhaseLegIds, setExpandedPhaseLegIds] = useState<ReadonlySet<string>>(() => new Set());
  const togglePhases = useCallback((legId: string) => {
    setExpandedPhaseLegIds(current => {
      const next = new Set(current);
      if (next.has(legId)) next.delete(legId);
      else next.add(legId);
      return next;
    });
  }, []);
  // 阶段容器的 id 前缀：同一页上有两张 Legs 表时 aria-controls 也不会撞
  const phasesIdPrefix = useId();
  // 与导出 PNG 同一个函数：两处的淡注一字不差
  const foreignLiveOrdersNote = useMemo(() => formatForeignReplayOrdersNote(foreignLiveOrders), [foreignLiveOrders]);
  const recordMap = useMemo(() => buildTradeRecordLookup(tradeRecords), [tradeRecords]);
  const highlightedSet = useMemo(() => new Set(highlightedLegIds), [highlightedLegIds]);
  // 每条腿的已实现盈亏与对全场的贡献率。必须整体算——贡献率的分母依赖全部腿。
  // 盈亏取值走全局唯一真源，Legs 表不再自己算一套——
  // 曾经这里用「一条腿一条成交」而战役总额用「一个仓位的每一刀」，同一场战役于是两个数。
  const settlement = useMemo(
    () => computeCampaignRealizedPnl(
      { final_realized_pnl: null, actual_evolution: campaignEvents },
      legs,
      tradeRecords,
      legExitPriceCorrections,
    ),
    [campaignEvents, legs, tradeRecords, legExitPriceCorrections],
  );
  const legPnlMap = useMemo(
    () => computeLegPnlContributions(legs, leg => settlement.byLeg.get(leg.id) ?? null),
    [legs, settlement],
  );
  // 主力腿的阶段拆解：每一次滚动对冲的结束把主力切成一段。
  // 边界价取对冲的平仓价（resolveLegExecution 同源，含平仓价校正）。
  const mainPhasesMap = useMemo(() => {
    const hedgeBoundaries = legs
      .filter(l => l.order_kind === 'hedge' || (l.leg_role ?? '').startsWith('hedge_') || l.leg_role === 'reentry_hedge')
      .map(l => {
        const rec = l.trade_record_id ? recordMap.get(l.trade_record_id) ?? null : null;
        const exec = resolveLegExecution(l, rec, legExitPriceCorrections);
        return { legId: l.id, closeTime: exec.closeTime ?? null, closePrice: exec.exitPrice ?? null };
      });
    const map = new Map<string, MainLegPhase[]>();
    for (const leg of legs) {
      if (leg.leg_role !== 'main_open' && leg.leg_role !== 'reentry_main') continue;
      const rec = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
      const exec = resolveLegExecution(leg, rec, legExitPriceCorrections);
      const pnl = settlement.byLeg.get(leg.id) ?? null;
      if (pnl == null || exec.entryPrice == null || exec.exitPrice == null) continue;
      const phases = splitMainLegPhases({
        pnl,
        entryPrice: exec.entryPrice,
        exitPrice: exec.exitPrice,
        openTime: exec.openTime ?? null,
        closeTime: exec.closeTime ?? null,
        side: leg.direction === 'short' ? 'short' : 'long',
        hedges: hedgeBoundaries,
      });
      // 只有真被切开（≥2 段）才展示子行；单段就是整腿自身，无需重复
      if (phases.length >= 2) map.set(leg.id, phases);
    }
    return map;
  }, [legs, recordMap, legExitPriceCorrections, settlement.byLeg]);

  const totalPnl = useMemo(() => (settlement.total ?? null), [settlement]);
  const totalDeltaB = useMemo(
    () => (totalPnl == null ? null : legDeltaB(totalPnl, initialExpectedMaxLoss)),
    [totalPnl, initialExpectedMaxLoss],
  );
  // 贡献率分母（与 legPnlMap 同口径），供阶段子行使用：
  // 阶段是主力贡献的细分，用同一分母，Σ阶段贡献 = 主力贡献，不双计。
  const contributionDenominator = useMemo(() => {
    let sum = 0;
    for (const entry of legPnlMap.values()) {
      if (entry.pnl != null) sum += Math.abs(entry.pnl);
    }
    return sum;
  }, [legPnlMap]);

  // 两笔及以上主力时给它们编号——归类按时间走，界面上得能一眼核对归对没有。
  const mainLegOrdinals = useMemo(() => buildMainLegOrdinals(legs), [legs]);

  // 手续费合计：按成交记录去重（主力与镜像止盈可能挂同一条记录），不是按腿相加。
  const feeTotals = useMemo(() => {
    const records: TradeRecord[] = [];
    for (const leg of legs) {
      const rec = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
      if (rec) records.push(rec);
    }
    return sumTradeRecordFees(records);
  }, [legs, recordMap]);

  // 加仓之后挂出的委托接在最新那次加仓的行后面；持仓窗口与这一行渲染的「开 / 平」严格同源。
  // 与导出 PNG 调的是同一个函数，两处不可能再各算各的。
  const reverseOrderLegMap = useMemo(
    () => buildDisplayReverseOrderLegMap(legs, reverseHedgeOrders, recordMap, legExitPriceCorrections),
    [legs, reverseHedgeOrders, recordMap, legExitPriceCorrections],
  );

  // 「币量 / 仓位」与「多单占比」：币量逐腿只算这一次，格子显示的数与占比的分母读的是同一份。
  // 多单、空单分开算：分组取这条腿的持仓方向，与「涨跌幅」列同一个来源（不看角色）。
  // 「多单占比」的分母只有多单；空单不单独算占比，它的 Σ 只写进合计行「币量 / 仓位」格。
  // 状态为「挂单中」的腿（对冲 / 镜像腿还没有成交或平仓记录）不进分母——判定与角色标签的空心样式同一个 legRowStatus，两处永远一致。与导出 PNG 同一个 helper。
  const positionShares = useMemo(() => computeLegPositionShares(legs.map(leg => {
    const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
    const entryPriceValue = resolveLegExecution(leg, record, legExitPriceCorrections).entryPrice;
    // 币量 = 名义 ÷ 开仓价。名义为 0 或价格缺失时不猜，显示空。
    const legCoinQty = leg.pre_position_size != null && entryPriceValue != null && entryPriceValue > 0
      ? leg.pre_position_size / entryPriceValue
      : null;
    return {
      legId: leg.id,
      side: legPositionSideFromDirection(leg.direction),
      coinQty: legCoinQty,
      notional: leg.pre_position_size ?? null,
      counted: legRowStatus(leg, record) !== 'pending',
    };
  })), [legs, recordMap, legExitPriceCorrections]);

  // 行的先后：点了「多单占比」列头就按它排（空单与没有值的行沉底、并列保持原序），否则就是传进来的先后。
  // 只重排行，不重算任何数：阶段子行、高亮、加仓校验、委托归属都按腿 id 取，跟着各自的腿走；合计行不在这里，始终在最后。
  const orderedLegs = useMemo(
    () => sortByLegPositionShare(legs, leg => positionShares.byLeg.get(leg.id), shareSort),
    [legs, positionShares, shareSort],
  );
  // 合计行「多单占比」只在列出了多单那组 Σ 时写 100.0%；多单那组永远排在第一组（先多后空），不用垫占位就与它同一行。
  const longTotalsListed = positionShares.sides.some(totals => totals.side === 'long');

  // 加仓校验：浮盈垫 + 已落袋能否抹平新加仓退回 S₁ 的亏损。与导出 PNG 同一个函数、同一份输入。
  const addSizingMap = useMemo(
    () => evaluateCampaignAddSizing({ legs, tradeRecords, legExitPriceCorrections, reverseHedgeOrders }),
    [legs, tradeRecords, legExitPriceCorrections, reverseHedgeOrders],
  );
  const selectedAddSizingLeg = addSizingDetailLegId == null
    ? null
    : legs.find(leg => leg.id === addSizingDetailLegId) ?? null;
  const selectedAddSizingVerdict = addSizingDetailLegId == null
    ? null
    : addSizingMap.get(addSizingDetailLegId) ?? null;

  return (
    <>
    <div className="bg-card border border-border rounded overflow-hidden">
      {/* 不限制高度：全部腿行随页面纵向展开，合计留在最后。
          共用横向滚动容器，保留角色列横向冻结。 */}
      <div
        data-testid="legs-scroll"
        ref={legsScrollRef}
        onScroll={markLegsScrolled}
        className={`group/legs ${LEGS_SCROLL_PADDING} overflow-x-auto`}
      >
        <div className={LEGS_MIN_WIDTH}>
          <div
            data-testid="legs-header-row"
            className={`sticky top-0 z-20 grid ${LEGS_GRID} gap-x-2.5 text-[10px] font-medium text-muted-foreground ${HEADER_FILL} py-2 px-3`}
          >
            <div className={`${FROZEN_ROLE_CELL} ${FROZEN_PAD.header} ${FROZEN_SHADOW_BOTTOM.flush} ${HEADER_FILL}`}>角色</div>
            <div>时间</div>
            <div className="text-right text-foreground/70" title="上行：该腿在本场各腿盈亏绝对值之和里所占的份额；下行：已实现盈亏金额（已扣平仓费，开仓费在开仓当时从钱包扣除，见手续费列）">贡献 / 盈亏</div>
            <div className="text-right font-semibold tracking-wide text-foreground/85" title="该腿盈亏 ÷ 初始最大预期亏损 L：这条腿把整场 b 推高 / 拉低了多少">Δb</div>
            <div className="text-right">开仓价</div>
            <div className="text-right">平仓价</div>
            <div className="text-right" title={PRICE_CHANGE_COLUMN_HINT}>涨跌幅</div>
            <div className="text-right" title="上行：按开仓价折算的币量，即加仓公式里的 X；下行：名义仓位（USD）">币量 / 仓位</div>
            <PositionShareSortHeader sort={shareSort} onSort={toggleShareSort} />
            <div className="text-center" title={ADD_SIZING_COLUMN_HINT}>加仓校验</div>
            <div className="text-right text-muted-foreground/60" title={FEE_COLUMN_HINT}>手续费</div>
            <div>委托</div>
            <div className="text-right">操作</div>
          </div>
          <div>
            {orderedLegs.map(leg => {
              const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
              const execution = resolveLegExecution(leg, record, legExitPriceCorrections);
              const status = legRowStatus(leg, record);
              const highlighted = highlightedSet.has(leg.id);
              const openLabel = fmtClock(execution.openTime ?? leg.pre_simulated_time);
              const closeLabel = fmtClock(execution.closeTime);
              const operationLabel = fmtClock(journalOperationTime(leg, record));
              const entryPriceValue = execution.entryPrice;
              // 币量与占比取自同一份（positionShares）：格子里的数就是分母里加的那个数
              const position = positionShares.byLeg.get(leg.id) ?? null;
              const legCoinQty = position?.coinQty ?? null;
              const exitPriceValue = execution.exitPrice;
              // 与左边两格同一对价（含 K 线平仓价校正）、按这条腿的方向计：三个数永远对得上。
              // 阶段子行沿用这个方向。
              const priceChangeSide = leg.direction === 'short' ? 'short' : 'long';
              const priceChangePct = computeLegPriceChangePct(entryPriceValue, exitPriceValue, priceChangeSide);
              /**
               * 强平记录的价格不在平仓时刻那根 K 线里，说明引擎用了一个不属于那一刻的价去判强平
               * （旧版会拿比仓位还早的价）。这不是普通的价格误差：按 K 线改价只会把一次误判的强平
               * 改写成一笔看似合理的亏损，所以要明说。
               */
              const liquidationAnomaly = Boolean(execution.exitCorrection) && execution.record?.action === 'LIQUIDATION';
              const exitCorrectionTitle = execution.exitCorrection
                ? liquidationAnomaly
                  ? `强平异常：记录的强平价 ${fmtPrice(execution.exitCorrection.originalExitPrice)} 不在平仓时刻 1m K 线范围 ${fmtPrice(execution.exitCorrection.candleLow)}-${fmtPrice(execution.exitCorrection.candleHigh)} 内，属于引擎误判的强平。本页按 K 线时价显示，这条腿的盈亏不代表真实结果。`
                  : `原 TradeRecord 平仓价 ${fmtPrice(execution.exitCorrection.originalExitPrice)} 超出该平仓时刻 1m K 线范围 ${fmtPrice(execution.exitCorrection.candleLow)}-${fmtPrice(execution.exitCorrection.candleHigh)}，本页按 K 线时价显示。`
                : undefined;
              const reverseOrdersForLeg = reverseHedgeOrders.filter(order => reverseOrderLegMap.get(order.id) === leg.id);
              const mirrorTpTiming = resolveMirrorTpOrderTiming(leg, record, campaignEvents);
              const hedgeSummary = leg.order_kind === 'hedge' && leg.hedge_type
                ? `${HEDGE_TYPE_LABELS[leg.hedge_type]}${leg.hedge_necessity_pct != null ? ` · ${leg.hedge_necessity_pct.toFixed(0)}%` : ''}`
                : null;
              const phases = mainPhasesMap.get(leg.id) ?? null;
              const phasesExpanded = phases != null && expandedPhaseLegIds.has(leg.id);
              const phasesId = `${phasesIdPrefix}-phases-${leg.id}`;
              return (
                <div key={leg.id}>
                <div
                  className={`group/row grid ${LEGS_GRID} gap-x-2.5 items-start text-[11px] font-mono py-2.5 px-3 ${ROW_RULE} hover:bg-accent transition-colors ${
                    highlighted ? 'bg-[#002FA7]/5 ring-1 ring-inset ring-[#002FA7]/12' : ''
                  }`}
                >
                  {/* 冻结的角色格：一行、一枚标签。没有平仓时标签本身换样子（挂单中空心、进行中带圆点），
                      来源（历史回填）只在悬停说明里；主力的阶段开关靠右，各行的开关落在同一条竖线上。
                      没有角色的腿也是一枚标签（中性灰、写「—」），进行中的圆点照样画得出来。
                      外层是冻结格（拉满行高），内层只占时间列第一行那么高，标签与「开 …」那一行居中对齐。 */}
                  <div
                    data-testid={`leg-frozen-role-${leg.id}`}
                    className={`${FROZEN_ROLE_CELL} ${FROZEN_PAD.row} ${FROZEN_SHADOW_BOTTOM.overRule} ${highlighted ? `${HIGHLIGHTED_ROW_FILL} ${HIGHLIGHTED_ROLE_RING}` : ROW_FILL}`}
                  >
                    <div className={ROLE_LINE}>
                      <LegRoleChip
                        role={leg.leg_role ?? null}
                        ordinal={mainLegOrdinals.get(leg.id) ?? null}
                        status={status === 'closed' ? null : status}
                        title={roleChipTitle(status, leg.source === 'retroactive_from_record', !leg.leg_role)}
                        className={ROLE_CHIP_SIZE}
                      />
                      {/* 主力阶段子行默认折叠：开关是角色标签右边的小箭头 + 阶段数，冻结着，滚到右边也点得到。
                          title 给鼠标看，与读屏名同一句；aria-description="" 让读屏不再把 title 当描述重复念一遍。 */}
                      {phases && (
                        <button
                          type="button"
                          data-testid={`leg-phases-toggle-${leg.id}`}
                          onClick={() => togglePhases(leg.id)}
                          aria-expanded={phasesExpanded}
                          aria-controls={phasesId}
                          aria-label={`${phasesExpanded ? '收起' : '展开'} ${phases.length} 个阶段`}
                          aria-description=""
                          title={`${phasesExpanded ? '收起' : '展开'} ${phases.length} 个阶段`}
                          className={PHASE_TOGGLE}
                        >
                          <ChevronRight
                            aria-hidden="true"
                            className={`-ml-1 h-3 w-3 shrink-0 transition-transform duration-150 ${phasesExpanded ? 'rotate-90' : ''}`}
                          />
                          <span aria-hidden="true">{phases.length}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  {/* 标签定宽（按最长的「操作」定），三行时间戳才会起于同一条竖线：
                      一个字的「开」与两个字的「操作」若各自占位，日期就会落在两个位置上。
                      定宽写在 span 上而不是拆成两栏，文本本身仍是「开 2025-09-19 21:49」，
                      复制出去、读屏念出来都还是一句完整的话。 */}
                  <div className="leading-tight">
                    <div><span className={TIME_LABEL}>开 </span>{openLabel}</div>
                    <div><span className={TIME_LABEL}>平 </span>{closeLabel}</div>
                    <div><span className={TIME_LABEL}>操作 </span>{operationLabel}</div>
                    {hedgeSummary && <div className="text-[10px] text-[#F0B90B]">{hedgeSummary}</div>}
                  </div>
                  {(() => {
                    const entry = legPnlMap.get(leg.id);
                    const pnl = entry?.pnl ?? null;
                    if (pnl == null) {
                      // 未平仓 / 无数据：显示「—」而不是 0——0 会被读成「打平」
                      return <div className="text-right text-muted-foreground">—</div>;
                    }
                    const positive = pnl > 0;
                    const contribution = entry?.contribution ?? null;
                    return (
                      <div
                        data-testid={`leg-pnl-${leg.id}`}
                        title="上行：该腿在本场各腿盈亏绝对值之和里所占的份额；下行：已实现盈亏金额"
                        className="text-right text-[12px] leading-snug"
                      >
                        {/* 份额才是要读的那个数：同样一笔金额，在小场子里是主因、在大场子里是零头。 */}
                        <div
                          className={`font-mono font-medium tabular-nums ${
                            pnl === 0 ? 'text-foreground/50' : positive ? 'text-[#0ECB81]/90' : 'text-[#F6465D]/90'
                          }`}
                        >
                          {contribution == null
                            ? '—'
                            : `${contribution > 0 ? '+' : ''}${(contribution * 100).toFixed(1)}%`}
                        </div>
                        <div className="text-[10px] tabular-nums text-foreground/45">
                          {positive ? '+' : ''}{pnl.toFixed(2)}
                        </div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const pnl = legPnlMap.get(leg.id)?.pnl ?? null;
                    const delta = legDeltaB(pnl, initialExpectedMaxLoss);
                    if (delta == null) return <div className="text-right text-[11px] text-foreground/30">—</div>;
                    return (
                      <div className="flex justify-end">
                        <span
                          data-testid={`leg-delta-b-${leg.id}`}
                          title="该腿盈亏 ÷ 初始最大预期亏损 L —— 这条腿把整场 b 推高 / 拉低了多少个单位"
                          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[14px] font-semibold leading-tight tabular-nums ${deltaTone(delta)}`}
                        >
                          {formatDeltaB(delta)}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="text-right tabular-nums">{fmtPrice(entryPriceValue)}</div>
                  <div className="text-right tabular-nums" title={exitCorrectionTitle}>
                    {fmtPrice(exitPriceValue)}
                    {liquidationAnomaly && (
                      <div data-testid="leg-liquidation-anomaly" className="text-[10px] text-[#F6465D]">强平异常</div>
                    )}
                  </div>
                  {/* 涨跌幅：开仓价走到平仓价的百分比，按这条腿的方向计——空单价格跌了才是正数，
                      按所示这一对开平价看与盈亏同号（分几刀平掉时盈亏是各刀合计，可能不同号）。
                      与开平价同字号，不抢 Δb 的主角位。 */}
                  <div
                    data-testid={`leg-price-change-${leg.id}`}
                    className={`text-right tabular-nums ${priceChangeTone(priceChangePct)}`}
                  >
                    {formatLegPriceChangePct(priceChangePct)}
                  </div>
                  {/* 币量在上、名义在下：加仓公式里的 X 是币量，名义只是它乘开仓价的结果。
                      反向合约的面值锁在 USD 上，光看名义看不出这条腿到底拿着多少币。 */}
                  <div
                    className="text-right tabular-nums leading-snug"
                    title={legCoinQty != null
                      ? `币量 = 名义 ÷ 开仓价 = ${leg.pre_position_size?.toFixed(2)} ÷ ${fmtPrice(entryPriceValue)}`
                      : '缺开仓价时不猜币量'}
                  >
                    <div>{formatLegCoinQuantity(legCoinQty)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatLegNotional(position?.notional)}
                    </div>
                  </div>
                  {/* 多单占比：与左边一格同构——上行币量占比，下行名义仓位占比，都是多单合计里的份额。
                      只有多单的行有数；空单（对冲通常是空单）的行整格留空（连「—」都不写），空单也不进分母。列头已写明方向，行里不挂标签。
                      百分数本身中性色，不上红绿：这是仓位分布，不是盈亏。挂单中的腿不进分母，两行都是「—」。 */}
                  {position?.side === 'long' ? (
                    <div
                      data-testid={`leg-position-share-${leg.id}`}
                      data-side="long"
                      title={describeLegPositionShare(position)}
                      className="text-right tabular-nums leading-snug"
                    >
                      <div>{formatLegPositionSharePct(position.coinSharePct)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {formatLegPositionSharePct(position.notionalSharePct)}
                      </div>
                    </div>
                  ) : <div />}
                  {(() => {
                    /**
                     * 合规是常态，对号几乎隐形；过大则直接写出 Plan B 的币量上限与 U 名义仓位。
                     * 红叉整格是按钮，不靠 hover；点击才打开完整计算过程。
                     */
                    const verdict = addSizingMap.get(leg.id);
                    if (!verdict) return <div />;
                    const label = describeAddSizingVerdict(verdict);
                    if (verdict.status === 'ok') {
                      return (
                        <div
                          data-testid={`add-sizing-check-ok-${leg.id}`}
                          role="img"
                          aria-label={label}
                          className="text-center text-[10px] leading-snug text-muted-foreground/30"
                        >
                          ✓
                        </div>
                      );
                    }
                    if (verdict.status === 'fail') {
                      return (
                        <button
                          type="button"
                          data-testid={`add-sizing-check-fail-${leg.id}`}
                          aria-label={label}
                          onClick={() => setAddSizingDetailLegId(leg.id)}
                          className="w-full rounded px-0.5 text-center leading-none text-[#F6465D] transition-colors hover:bg-[#F6465D]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F6465D]/50"
                        >
                          <div className="text-[18px] font-bold">✗</div>
                          <div className="mt-0.5 text-[9px] font-semibold leading-tight tabular-nums">
                            上限 {formatAddSizingCoinQuantity(verdict.maxAllowedCoins)} 币
                          </div>
                          <div className="mt-0.5 text-[8px] leading-tight tabular-nums text-[#F6465D]/80">
                            ≈ {formatAddSizingNotional(verdict.maxAllowedNotional)} U
                          </div>
                          <div className="mt-1 text-[8px] font-sans leading-tight text-[#F6465D]/70">点击看计算</div>
                        </button>
                      );
                    }
                    return (
                      <div
                        data-testid={`add-sizing-check-unknown-${leg.id}`}
                        role="img"
                        aria-label={label}
                        className="text-center text-[10px] leading-snug text-muted-foreground/30"
                      >
                        —
                      </div>
                    );
                  })()}
                  {(() => {
                    /**
                     * 三列的主次由**字号与字重**定，不靠发灰：
                     *   Δb 14px 半粗 + 淡色底（主角）→ 盈亏 12px 中粗（次角）→ 手续费 11px 常规（注脚）。
                     * 手续费用中性前景色而不是灰调，密排小字下灰调会显脏。
                     * 费率、Maker/Taker、估算依据都在 tooltip 里。
                     */
                    const fees = execution.record ? tradeRecordFees(execution.record) : null;
                    if (!fees) return <div className="text-right text-[11px] text-foreground/30">—</div>;
                    /**
                     * **主行永远是金额**：手续费最终要用钱衡量，而钱包扣的正是这个数
                     * （币本位按成交当时的价把币折成 USDT 扣，Σ手续费 = 钱包少掉的钱）。
                     *
                     * 次行给拆分。币本位的拆分写**币数**：手续费 = 张数 × 面值 ÷ 成交价 × 费率，收的是币；
                     * 折成美元后价格被约掉（= 张数 × 面值 × 费率），开平两笔的金额必然相同——
                     * 把两个一模一样的金额并排写出来只会让人以为引擎算错了，币数才看得出两笔的差别。
                     */
                    const coinMode = fees.coinSettled && fees.open?.coin != null && fees.close.coin != null;
                    return (
                      <div
                        data-testid={`leg-fees-${leg.id}`}
                        // min-w-0 不能少：网格项的 min-width 默认是 auto，等于「不许比内容窄」，
                        // 于是这条长子行会把 132px 的轨道顶破、压到左边「币量 / 仓位」那一列上。
                        className="min-w-0 text-right text-[11px] leading-snug tabular-nums text-foreground/55"
                      >
                        <div>
                          {fees.totalUsd == null ? '—' : fees.totalUsd.toFixed(2)}
                          {fees.estimated && <span className="ml-1 text-[8px] tracking-wide text-foreground/30">估</span>}
                        </div>
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[9px] text-foreground/35">
                          开 {coinMode
                            ? formatFeeCoin(fees.open?.coin)
                            : fees.open ? fees.open.usd.toFixed(2) : '—'}
                          {' · 平 '}
                          {coinMode ? formatFeeCoin(fees.close.coin) : fees.close.usd.toFixed(2)}
                          {coinMode && <span className="ml-1 text-[8px] text-foreground/30">{fees.asset}</span>}
                        </div>
                      </div>
                    );
                  })()}
                  {/* 委托列：多条卡片会把行撑得很高。限高 + 内部滚动，
                      让各行高度趋于一致，同时一条委托都不丢。 */}
                  <div data-testid={`leg-orders-${leg.id}`} className="max-h-[152px] max-w-[300px] space-y-1 overflow-y-auto pr-1 font-sans">
                    {mirrorTpTiming && (
                      <div
                        className="rounded border border-[#F0B90B]/25 bg-[#F0B90B]/5 px-2 py-1 leading-tight"
                        title={`委 ${fmtClock(mirrorTpTiming.placedAt)} · 触 ${fmtClock(mirrorTpTiming.triggeredAt)}`}
                      >
                        <div className="text-[10px] font-medium text-[#D89B00]">镜像止盈</div>
                        <div className="text-[10px] tabular-nums text-muted-foreground">
                          委 {fmtCardTime(mirrorTpTiming.placedAt)} · 触 {fmtCardTime(mirrorTpTiming.triggeredAt, mirrorTpTiming.placedAt)}
                        </div>
                      </div>
                    )}
                    {reverseOrdersForLeg.length === 0 && !mirrorTpTiming ? (
                      <span className="font-mono text-muted-foreground">—</span>
                    ) : (
                      reverseOrdersForLeg.map(order => (
                        <div
                          key={order.id}
                          data-order-id={order.id}
                          title={`委 ${fmtClock(order.createdAt)}${order.status === 'triggered' ? ` · 触 ${fmtClock(order.triggeredAt)}` : ''} · ${order.status === 'triggered' ? '平' : '撤'} ${order.cancelledAt ? fmtClock(order.cancelledAt) : '—'}`}
                          className="group rounded border border-border/50 bg-muted/30 px-2 py-1 leading-tight"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={order.side === 'SHORT' ? 'text-[#6D28D9]' : 'text-[#002FA7]'}>
                              {order.side === 'SHORT' ? '空' : '多'} {fmtPrice(order.price)}
                            </span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground">
                                {order.status === 'pending'
                                  ? '挂单中'
                                  : order.status === 'triggered'
                                    ? '已触发'
                                    : '已撤'}
                              </span>
                              {onHideReverseHedgeOrder && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onHideReverseHedgeOrder(order);
                                  }}
                                  title="从盘面隐藏这条委托空单"
                                  aria-label="从盘面隐藏这条委托空单"
                                  className="inline-flex items-center text-muted-foreground/25 opacity-0 transition-opacity hover:text-[#F6465D] group-hover:opacity-100"
                                >
                                  <EyeOff className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="text-[10px] tabular-nums text-muted-foreground">
                            委 {fmtCardTime(order.createdAt)}
                            {order.status === 'triggered' && ` · 触 ${fmtCardTime(order.triggeredAt, order.createdAt)}`}
                            {` · ${order.status === 'triggered' ? '平' : '撤'} ${order.cancelledAt ? fmtCardTime(order.cancelledAt, order.createdAt) : '—'}`}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {/* 操作列：等宽图标按钮，文字进 tooltip。
                      三个中文按钮横排放不进窄列，会逐字竖排并把整行撑歪。 */}
                  <div className="flex items-center justify-end gap-0.5 font-sans">
                    {onToggleHighlight && (
                      <button
                        type="button"
                        onClick={() => onToggleHighlight(leg)}
                        title={highlighted ? '已标注到盘面，点击取消' : '标到盘面'}
                        aria-label={highlighted ? '取消盘面标注' : '标到盘面'}
                        aria-pressed={highlighted}
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${
                          highlighted
                            ? 'bg-[#002FA7]/10 text-[#002FA7] hover:bg-[#002FA7]/15'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onDetach && (
                      <button
                        type="button"
                        onClick={() => onDetach(leg)}
                        title="从本战役解除该腿"
                        aria-label="解除"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#F6465D]"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* 主力阶段拆解：每一次滚动对冲的结束 = 主力一个阶段的完成。
                    子行缩进浅色呈现，Σ阶段盈亏 === 主力整腿盈亏（分摊守恒）。默认折叠，折叠时整块不渲染。 */}
                {phases && phasesExpanded && (
                  <div id={phasesId} data-testid={`leg-phases-${leg.id}`} className={`${ROW_RULE} bg-muted/20`}>
                    {phases.map((phase, phaseIndex) => {
                      const phaseDelta = legDeltaB(phase.pnl, initialExpectedMaxLoss);
                      const phaseContribution = contributionDenominator > 0 ? phase.pnl / contributionDenominator : null;
                      const positive = phase.pnl > 0;
                      return (
                        <div
                          key={phase.index}
                          className={`grid ${LEGS_GRID} gap-x-2.5 items-center py-1 px-3 text-[10px] font-mono text-muted-foreground`}
                        >
                          {/* 「阶段 N」与主力标签里的文字对齐（标签左内边距 px-2），各列的阶段数也与腿行的同列对齐 */}
                          <div
                            className={`${FROZEN_ROLE_CELL} ${FROZEN_PAD.phase} ${
                              phaseIndex === phases.length - 1 ? FROZEN_SHADOW_BOTTOM.overRule : FROZEN_SHADOW_BOTTOM.flush
                            } ${PHASE_FILL} flex items-center`}
                          >
                            <div className="whitespace-nowrap pl-2 font-sans text-[9px]">
                              阶段 {phase.index}
                              {phase.boundaryLegId == null && <span className="text-muted-foreground/60"> · 收尾</span>}
                            </div>
                          </div>
                          <div className="tabular-nums" title={`${fmtClock(phase.startTime)} → ${fmtClock(phase.endTime)}`}>
                            {fmtCardTime(phase.startTime)} → {fmtCardTime(phase.endTime, phase.startTime)}
                            {phase.boundaryLegId != null && (
                              <span className="ml-1 font-sans text-[9px] text-[#6D28D9]/80">对冲结束切段</span>
                            )}
                          </div>
                          <div className="text-right leading-tight">
                            <div className={`tabular-nums ${phase.pnl === 0 ? '' : positive ? 'text-[#0ECB81]/90' : 'text-[#F6465D]/90'}`}>
                              {phaseContribution == null ? '—' : `${phaseContribution > 0 ? '+' : ''}${(phaseContribution * 100).toFixed(1)}%`}
                            </div>
                            <div className="text-[9px] tabular-nums text-muted-foreground/70">
                              {positive ? '+' : ''}{phase.pnl.toFixed(2)}
                            </div>
                          </div>
                          <div className={`text-right tabular-nums ${phaseDelta == null ? '' : phaseDelta > 0 ? 'text-[#0ECB81]/90' : phaseDelta < 0 ? 'text-[#F6465D]/90' : ''}`}>
                            {phaseDelta == null ? '—' : `${phaseDelta > 0 ? '+' : ''}${phaseDelta.toFixed(2)}`}
                          </div>
                          <div className="text-right tabular-nums">{fmtPrice(phase.startPrice)}</div>
                          <div className="text-right tabular-nums">{fmtPrice(phase.endPrice)}</div>
                          {(() => {
                            // 阶段自己的起止价各算各的、方向沿用主力：切段处的边界价就是对冲平仓那一刻的市价
                            const phasePriceChangePct = computeLegPriceChangePct(phase.startPrice, phase.endPrice, priceChangeSide);
                            return (
                              <div
                                data-testid={`leg-phase-price-change-${leg.id}-${phase.index}`}
                                className={`text-right tabular-nums ${priceChangeTone(phasePriceChangePct, true)}`}
                              >
                                {formatLegPriceChangePct(phasePriceChangePct)}
                              </div>
                            );
                          })()}
                          <div />
                          <div />
                          <div />
                          <div />
                          <div />
                          <div />
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
              );
            })}
            {/* 合计行：按构造恒等于盈亏概览的「已实现 P&L」。
                历史上两处各算各的、谁也不显示合计，用户只能手加三个数才发现对不上；
                把这一行画出来，界面本身就是一道持续生效的断言。
                合计随表格自然排列，不再贴底遮挡腿行。
                保留不透明底色与层级，覆盖相邻冻结列的分隔线延伸。 */}
            <div
              data-testid="legs-total-row"
              className={`relative z-20 bg-card grid ${LEGS_GRID} items-center gap-x-2.5 border-t-2 border-border px-3 py-2 text-[11px] font-medium`}
            >
              <div className={`${FROZEN_ROLE_CELL} ${FROZEN_PAD.total} ${FROZEN_SHADOW_BOTTOM.flush} ${FROZEN_TOTAL_DIVIDER} flex items-center bg-card text-muted-foreground`}>合计</div>
              <div className="text-[10px] text-muted-foreground">{settlementBasisLabel(settlement.basis)}</div>
              <div className={`text-right text-[12px] font-medium tabular-nums ${totalPnl == null ? 'text-foreground/50' : totalPnl > 0 ? 'text-[#0ECB81]/90' : totalPnl < 0 ? 'text-[#F6465D]/90' : ''}`}>
                {totalPnl == null ? '—' : `${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)}`}
              </div>
              <div className="flex justify-end">
                <span
                  data-testid="legs-total-delta-b"
                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[14px] font-semibold leading-tight tabular-nums ${deltaTone(totalDeltaB)}`}
                >
                  {formatDeltaB(totalDeltaB)}
                </span>
              </div>
              {/* 开仓价 / 平仓价 / 涨跌幅留空：各腿开平价不同，跨腿拼一个「整场涨跌幅」没有意义。 */}
              <div /><div /><div />
              {/* 币量 / 仓位：多单、空单各写一组 Σ（上行 Σ币量、下行 Σ名义仓位，挂单中的腿不计入），
                  每组以同样的「多 / 空」标签开头；没有计入腿的方向不列。
                  多单那组是「多单占比」的分母；空单那组只是空单各腿的合计（对冲一共开了多大），不作任何占比的分母。
                  多单占比：写多单那组的「100.0%」，与左格里多单那组落在同一行；多单没有计入腿时整格留空。
                  两个方向都没有时两格照旧两行「—」。加仓校验留空。合计行可以因此变高，腿行不变。 */}
              <div
                data-testid="legs-total-position"
                title={describeLegPositionDenominators(positionShares.sides)}
                className={TOTAL_POSITION_CELL}
              >
                {positionShares.sides.length === 0 ? (
                  <PositionLines side={null} withTag={false} top="—" bottom="—" />
                ) : positionShares.sides.map(totals => (
                  <PositionLines
                    key={totals.side}
                    testId={`legs-total-position-${totals.side}`}
                    side={totals.side}
                    withTag
                    top={formatLegCoinQuantity(totals.totalCoins)}
                    bottom={formatLegNotional(totals.totalNotional)}
                  />
                ))}
              </div>
              <div
                data-testid="legs-total-position-share-long"
                title={longTotalsListed ? describeLegPositionSideTotal(positionShares.bySide.long) : undefined}
                className={TOTAL_POSITION_CELL}
              >
                {positionShares.sides.length === 0 ? (
                  <PositionLines side={null} withTag={false} top="—" bottom="—" />
                ) : longTotalsListed ? (
                  <PositionLines
                    side="long"
                    withTag={false}
                    top={formatLegPositionShareTotal(positionShares.bySide.long.totalCoins)}
                    bottom={formatLegPositionShareTotal(positionShares.bySide.long.totalNotional)}
                  />
                ) : null}
              </div>
              <div />
              <div
                data-testid="legs-total-fees"
                title={feeTotals?.totalCoin != null
                  ? `本场全部成交记录的开仓费 + 平仓费（按记录去重）：${feeTotals.totalUsd.toFixed(2)} USDT，币计 ${formatFeeCoin(feeTotals.totalCoin, feeTotals.asset)}。币本位按成交当时的价折成 USDT 从钱包扣除。`
                  : '本场全部成交记录的开仓费 + 平仓费（按记录去重：同一条记录挂在几条腿上只算一次）'}
                className="text-right text-[11px] font-normal tabular-nums leading-snug text-foreground/55"
              >
                {feeTotals == null ? '—' : feeTotals.totalUsd.toFixed(2)}
                {feeTotals?.estimated && <span className="ml-1 text-[8px] tracking-wide text-foreground/30">估</span>}
              </div>
              <div /><div />
            </div>
          </div>
        </div>
      </div>
    </div>
    {/* 他场委托：别的回放留下、本场期间仍挂着。不进任何腿的行、不进合计，只在表下方淡淡交代一句 */}
    {foreignLiveOrdersNote && (
      <div
        data-testid="legs-foreign-replay-orders-note"
        className="mt-1.5 px-1 text-[10px] leading-relaxed text-muted-foreground/50"
      >
        {foreignLiveOrdersNote}
      </div>
    )}
    {selectedAddSizingLeg && selectedAddSizingVerdict?.status === 'fail' && (
      <AddSizingDetailDialog
        leg={selectedAddSizingLeg}
        verdict={selectedAddSizingVerdict}
        onClose={() => setAddSizingDetailLegId(null)}
      />
    )}
    </>
  );
}
