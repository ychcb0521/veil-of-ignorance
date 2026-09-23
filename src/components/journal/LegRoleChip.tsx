import { cn } from '@/lib/utils';
import { LEG_ROW_STATUS_LABELS, type LegRowOpenStatus } from '@/lib/legRowStatus';
import type { LegRole } from '@/types/journal';

const LABELS: Record<LegRole, string> = {
  main_open: '主力开仓',
  main_add_1: '加仓1',
  main_add_2: '加仓2',
  main_add_3: '加仓3',
  main_add_4: '加仓4',
  main_add_5: '加仓5',
  main_add_6: '加仓6',
  hedge_initial_a: '初始对冲 A',
  hedge_initial_b: '初始对冲 B',
  hedge_rolling: '滚动对冲',
  mirror_tp: '镜像止盈',
  reentry_main: '重新入场主力',
  reentry_hedge: '重新入场对冲',
  standalone: '独立单',
};

/**
 * 每个角色的一组配色，颜色与 LEG_ROLE_TONE_COLORS（导出 PNG 用）相同。
 * 全部写成完整类名：Tailwind 只认源码里整段出现的类名，拼接出来的不会生成规则。
 * - fill / text：常规的实心淡底标签；
 * - dashed / mutedText：「挂单中」的空心标签——同色虚线描边、透明底；深色主题里字色淡一档，
 *   浅色主题（根元素的 .light）里不淡：这些品牌色在白底上本来就只有 2～3:1，再淡就读不清了；
 * - dot：「进行中」标签里的小圆点。
 * 镜像止盈的亮黄在白底上读不清，浅色主题里实心、空心两种的字都压深到 #B98500（与导出 PNG 同色，见 legRoleExportTextColor）。
 */
type Tone = { fill: string; text: string; dashed: string; mutedText: string; dot: string };

const GREEN: Tone = { fill: 'bg-[#0ECB81]/10', text: 'text-[#0ECB81]', dashed: 'border-[#0ECB81]/70', mutedText: 'text-[#0ECB81]/80 [.light_&]:text-[#0ECB81]', dot: 'bg-[#0ECB81]' };
const BLUE: Tone = { fill: 'bg-[#2B80FF]/10', text: 'text-[#2B80FF]', dashed: 'border-[#2B80FF]/70', mutedText: 'text-[#2B80FF]/80 [.light_&]:text-[#2B80FF]', dot: 'bg-[#2B80FF]' };
const PURPLE: Tone = { fill: 'bg-[#B080FF]/10', text: 'text-[#B080FF]', dashed: 'border-[#B080FF]/70', mutedText: 'text-[#B080FF]/80 [.light_&]:text-[#B080FF]', dot: 'bg-[#B080FF]' };
/** 中性灰：独立单，以及没有角色的腿（标签里写「—」）。 */
const NEUTRAL: Tone = { fill: 'bg-muted', text: 'text-muted-foreground', dashed: 'border-muted-foreground/60', mutedText: 'text-muted-foreground/80 [.light_&]:text-muted-foreground', dot: 'bg-muted-foreground' };

const TONES: Record<LegRole, Tone> = {
  main_open: GREEN,
  main_add_1: GREEN,
  main_add_2: GREEN,
  main_add_3: GREEN,
  main_add_4: GREEN,
  main_add_5: GREEN,
  main_add_6: GREEN,
  hedge_initial_a: BLUE,
  hedge_initial_b: BLUE,
  hedge_rolling: { fill: 'bg-[#5BA3FF]/10', text: 'text-[#5BA3FF]', dashed: 'border-[#5BA3FF]/70', mutedText: 'text-[#5BA3FF]/80 [.light_&]:text-[#5BA3FF]', dot: 'bg-[#5BA3FF]' },
  mirror_tp: { fill: 'bg-[#F0B90B]/10', text: 'text-[#F0B90B] [.light_&]:text-[#B98500]', dashed: 'border-[#F0B90B]/70', mutedText: 'text-[#F0B90B]/80 [.light_&]:text-[#B98500]', dot: 'bg-[#F0B90B]' },
  reentry_main: PURPLE,
  reentry_hedge: PURPLE,
  standalone: NEUTRAL,
};

/** 没有角色的腿：标签里写「—」，中性灰。 */
const UNCLASSIFIED_LABEL = '—';

const SHORT_LABELS: Record<LegRole, string> = {
  main_open: 'M',
  main_add_1: 'A1',
  main_add_2: 'A2',
  main_add_3: 'A3',
  main_add_4: 'A4',
  main_add_5: 'A5',
  main_add_6: 'A6',
  hedge_initial_a: 'Ha',
  hedge_initial_b: 'Hb',
  hedge_rolling: 'R',
  mirror_tp: 'TP',
  reentry_main: 'ReM',
  reentry_hedge: 'ReH',
  standalone: 'S',
};

interface Props {
  /** null：没有角色的腿，画成写着「—」的中性灰标签（Legs 表里状态的画法与其他标签相同）。 */
  role: LegRole | null;
  short?: boolean;
  className?: string;
  /**
   * 同一档主力有多笔时的序号（按开仓先后）。只在 ≥2 笔时传，
   * 单笔写「主力1」会暗示还有个主力2。
   */
  ordinal?: number | null;
  /**
   * Legs 表里的例外状态（见 legRowStatus）：
   * 「挂单中」画成同色虚线的空心标签，「进行中」在标签文字后面加一枚实心小圆点，
   * 「爆仓」在标签文字后面加一枚红色的「爆仓」小字（与时间线、仓位面板的强平标记同色）。
   * 挂单中 / 进行中另带一段只给读屏的状态名（爆仓两个字本来就看得见、读得出）；不传即常规的实心标签。
   */
  status?: LegRowOpenStatus | null;
  /** 悬停说明（状态、历史回填等）。 */
  title?: string;
}

export function LegRoleChip({ role, short = false, className, ordinal, status = null, title }: Props) {
  const suffix = ordinal != null && ordinal > 0 ? String(ordinal) : '';
  const tone = role ? TONES[role] : NEUTRAL;
  const label = !role
    ? UNCLASSIFIED_LABEL
    : short ? `${SHORT_LABELS[role]}${suffix}` : `${LABELS[role]}${suffix ? ` ${suffix}` : ''}`;
  return (
    <span
      data-role-chip={role ?? 'none'}
      data-status={status ?? undefined}
      title={title}
      className={cn(
        'inline-flex items-center rounded text-[10px]',
        // 空心标签的 1px 虚线占掉的宽高从内边距里扣回来：两种标签外框一样大，换状态时不跳动
        status === 'pending'
          ? `border border-dashed bg-transparent px-[7px] py-px ${tone.dashed} ${tone.mutedText}`
          : `px-2 py-0.5 ${tone.fill} ${tone.text}`,
        className,
      )}
    >
      {label}
      {status === 'open' && (
        <span aria-hidden="true" data-status-dot className={`ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
      )}
      {/* 爆仓：角色仍用自己的颜色，红只给「爆仓」两个字——这一行的例外是它，不是这条腿的角色 */}
      {status === 'liquidated' && (
        <span data-status-flag className="ml-1 shrink-0 rounded-[2px] bg-[#F6465D]/15 px-1 font-medium text-[#F6465D]">爆仓</span>
      )}
      {status && status !== 'liquidated' && <span className="sr-only">{LEG_ROW_STATUS_LABELS[status]}</span>}
    </span>
  );
}
