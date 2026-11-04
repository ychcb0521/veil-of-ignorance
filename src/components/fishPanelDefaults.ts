/**
 * 渔面板各段的默认展开状态。【用户要求】2026-11-04「捕捞和鱼舱要默认折叠起来」。
 * 本次浏览里手动展开 / 收起过的，按会话里记下的为准。
 * 测试环境在 src/test/setup.ts 里改成展开：已有测试都在测展开后的功能；默认折叠本身由 FishPanel.defaultCollapsed 测试覆盖。
 */
export const FISH_PANEL_DEFAULTS = { catching: false, cabin: false };
