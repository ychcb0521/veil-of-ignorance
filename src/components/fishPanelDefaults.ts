/**
 * 进入渔面板时，捕捞、即时交易和鱼质量默认展开；鱼质量各层工作区也默认展开。
 * 本次浏览里手动展开 / 收起过的，按会话里记下的为准。
 * 测试环境在 src/test/setup.ts 里展开捕捞和鱼舱，便于验证鱼舱内的功能。
 */
export const FISH_PANEL_DEFAULTS = { catching: true, cabin: false, quality: true, qualityModules: true, secondary: false };
