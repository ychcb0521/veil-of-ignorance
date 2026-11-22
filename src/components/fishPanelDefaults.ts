/**
 * 进入渔面板时，仅捕捞和即时交易默认展开。
 * 本次浏览里手动展开 / 收起过的，按会话里记下的为准。
 * 测试环境在 src/test/setup.ts 里展开捕捞和鱼舱，便于验证鱼舱内的功能。
 */
export const FISH_PANEL_DEFAULTS = { catching: true, cabin: false, quality: false, secondary: false };
