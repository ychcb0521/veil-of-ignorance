import type { LegRole } from '@/types/journal';

/** 中性灰：独立单与没有角色的腿（「—」）的标签色，与页面的 muted 同一档。 */
export const LEG_ROLE_NEUTRAL_COLOR = '#848E9C';

/**
 * 角色标签的主色：与 LegRoleChip 里的 Tailwind 类同一组颜色（那边必须写成完整类名，Tailwind 才会生成规则，
 * 所以两处各写一份，由测试钉住一致）。导出 PNG 画角色标签时读这里：底色取它的 10%，
 * 挂单中的虚线描边、进行中的小圆点都用它。独立单与页面的 muted 同为中性灰。
 */
export const LEG_ROLE_TONE_COLORS: Record<LegRole, string> = {
  main_open: '#0ECB81',
  main_add_1: '#0ECB81',
  main_add_2: '#0ECB81',
  main_add_3: '#0ECB81',
  main_add_4: '#0ECB81',
  main_add_5: '#0ECB81',
  main_add_6: '#0ECB81',
  hedge_initial_a: '#2B80FF',
  hedge_initial_b: '#2B80FF',
  hedge_rolling: '#5BA3FF',
  mirror_tp: '#F0B90B',
  reentry_main: '#B080FF',
  reentry_hedge: '#B080FF',
  standalone: LEG_ROLE_NEUTRAL_COLOR,
};

/** 白底上镜像止盈的字色：亮黄 #F0B90B 在白底上只有 1.8:1，压深到 #B98500（约 3.3:1）。 */
export const LEG_ROLE_MIRROR_TEXT_ON_LIGHT = '#B98500';

/**
 * 白底（导出 PNG、页面浅色主题）上标签文字的颜色：镜像止盈的亮黄读不清，压深一档（LEG_ROLE_MIRROR_TEXT_ON_LIGHT）；
 * 其余与主色相同；没有角色的腿是中性灰。页面浅色主题里 LegRoleChip 的 [.light_&]:text-… 与这里同色，由测试钉住。
 */
export function legRoleExportTextColor(role: LegRole | null): string {
  if (!role) return LEG_ROLE_NEUTRAL_COLOR;
  return role === 'mirror_tp' ? LEG_ROLE_MIRROR_TEXT_ON_LIGHT : LEG_ROLE_TONE_COLORS[role];
}
