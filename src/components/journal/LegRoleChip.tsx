import { cn } from '@/lib/utils';
import type { LegRole } from '@/types/journal';

const LABELS: Record<LegRole, string> = {
  main_open: '主力开仓',
  hedge_initial_a: '初始对冲 A',
  hedge_initial_b: '初始对冲 B',
  hedge_rolling: '滚动对冲',
  mirror_tp: '镜像止盈',
  reentry_main: '重新入场主力',
  reentry_hedge: '重新入场对冲',
  standalone: '独立单',
};

const STYLES: Record<LegRole, string> = {
  main_open: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  hedge_initial_a: 'bg-[#2B80FF]/10 text-[#2B80FF]',
  hedge_initial_b: 'bg-[#2B80FF]/10 text-[#2B80FF]',
  hedge_rolling: 'bg-[#5BA3FF]/10 text-[#5BA3FF]',
  mirror_tp: 'bg-[#F0B90B]/10 text-[#F0B90B]',
  reentry_main: 'bg-[#B080FF]/10 text-[#B080FF]',
  reentry_hedge: 'bg-[#B080FF]/10 text-[#B080FF]',
  standalone: 'bg-muted text-muted-foreground',
};

const SHORT_LABELS: Record<LegRole, string> = {
  main_open: 'M',
  hedge_initial_a: 'Ha',
  hedge_initial_b: 'Hb',
  hedge_rolling: 'R',
  mirror_tp: 'TP',
  reentry_main: 'ReM',
  reentry_hedge: 'ReH',
  standalone: 'S',
};

interface Props {
  role: LegRole;
  short?: boolean;
  className?: string;
}

export function LegRoleChip({ role, short = false, className }: Props) {
  return (
    <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-[10px]', STYLES[role], className)}>
      {short ? SHORT_LABELS[role] : LABELS[role]}
    </span>
  );
}
