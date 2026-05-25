import type { LegRole, StrategyTemplate } from '@/types/journal';

type ExpectedLeg = {
  role: LegRole;
  label: string;
  required: boolean;
};

type StrategyTemplateMeta = {
  name: string;
  description: string;
  expected_legs: ExpectedLeg[];
  rolling_roles: LegRole[];
};

export const STRATEGY_TEMPLATES: Record<StrategyTemplate, StrategyTemplateMeta> = {
  main_dual_hedge_mirror_tp: {
    name: '主仓 + 双对冲 + 镜像止盈',
    description: '开主力单时同时挂 2 个 50% 对冲委托 + 1 个 50% 镜像止盈委托。镜像止盈触发后取消 1 对冲，进入"已锁定不亏"状态。',
    expected_legs: [
      { role: 'main_open', label: '主力开仓', required: true },
      { role: 'hedge_initial_a', label: '初始对冲 A（50% 仓位）', required: true },
      { role: 'hedge_initial_b', label: '初始对冲 B（50% 仓位）', required: true },
      { role: 'mirror_tp', label: '镜像止盈委托（50% 仓位）', required: true },
    ],
    rolling_roles: ['hedge_rolling', 'reentry_main', 'reentry_hedge'],
  },
  main_only: {
    name: '纯主仓',
    description: '只有主力单，无对冲、无镜像止盈。',
    expected_legs: [{ role: 'main_open', label: '主力开仓', required: true }],
    rolling_roles: [],
  },
  custom: {
    name: '自定义',
    description: '不预设结构，每条 leg 由用户手动归类。',
    expected_legs: [],
    rolling_roles: [],
  },
};

export const LEG_ROLE_LABELS: Record<LegRole, string> = {
  main_open: '主力开仓',
  hedge_initial_a: '初始对冲 A',
  hedge_initial_b: '初始对冲 B',
  hedge_rolling: '滚动对冲',
  mirror_tp: '镜像止盈',
  reentry_main: '重新入场主力',
  reentry_hedge: '重新入场对冲',
  standalone: '独立单',
};
