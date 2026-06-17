import { cn } from '@/lib/utils';
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

const STYLES: Record<LegRole, string> = {
  main_open: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_1: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_2: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_3: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_4: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_5: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_6: 'bg-[#0ECB81]/10 text-[#0ECB81]',
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
