/**
 * 交易战役里不常用、但舍不得删的指标：平时折起来，角落里一个很小、很淡的符号展开。
 * 【用户要求】2026-10-17「有一些指标折叠起来放在角落里（因为不常用，但是又舍不得删掉），用一个非常小、非常隐形的符号作为入口，
 * 包括：单位利润、仓位利润、仓位利润（理论）、加仓效用、算术期望、仓位放大」。
 * 用到的地方：列表的排序行与封面指标格、盈亏概览（真实战役与反事实同一个开关）、指标表。展开 / 收起跟账号走。
 * 折起来的项仍在页面里（只是不显示），导出、排序能力、Deep dig 的字母都不受影响；正在按它排序时照常显示。
 */
/** 排序项 / 封面格 / 盈亏概览里的键（仓位利润（理论）是「仓位利润」括号里的读数）。 */
export const MINOR_METRIC_KEYS = ['positionAmplification', 'addEfficiency', 'arithmeticExpectancy', 'unitProfit', 'positionProfit'] as const;
export const MINOR_METRIC_SET: ReadonlySet<string> = new Set(MINOR_METRIC_KEYS);
/** 指标表里对应的字母。 */
export const MINOR_METRIC_LETTERS: ReadonlySet<string> = new Set(['A', 'y', 'E', 'U', 'W', 'Wₜ']);
/** 展开 / 收起（usePersistedState 的键，跟账号同步）。 */
export const MINOR_METRICS_STATE_KEY = 'campaign_minor_metrics_v1';
export const MINOR_METRICS_NAMES = '单位利润、仓位利润（含理论）、加仓效用、算术期望、仓位放大';
/** 角落里那个符号的样式：很小、很淡，悬停 / 键盘聚焦时才看得清。 */
export const MINOR_TOGGLE_CLASS = 'inline-flex h-4 min-w-4 shrink-0 select-none items-center justify-center rounded font-mono text-[10px] leading-none text-muted-foreground/25 transition-colors hover:text-foreground/70 focus-visible:text-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60';
