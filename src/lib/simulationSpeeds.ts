/**
 * 时间机器的倍速档位——所有倍速选择器唯一的真源。
 *
 * 抽成一份是有来由的：此前桌面 TimeControl、全屏 MultiChartLayout、移动端
 * MobileHeader / MobileChartView 各抄了一份字面量。四份之间没有任何东西保证相等，
 * 漏改一处的症状是「在全屏选的速度回到主栏没有高亮」——看起来像选择被拒绝，
 * 而没有任何测试能发现这种漂移。同步必须靠「只有一份」，不能靠人记得改四处。
 *
 * 必须严格升序且唯一：移动端紧凑栏取前 4 档做快捷键，依赖的正是「最前面的最慢」。
 * 只允许追加、不允许删除：已选倍速会被持久化且读回时不做集合校验
 * （usePersistedState 是裸 JSON.parse），删掉某档会让恢复出来的速度照跑但无按钮高亮。
 *
 * 注意：与 REPLAY_SPEEDS（src/contexts/ReplayContext.tsx，日志回放专用、含时间机器
 * 从未有过的 50x）是两套东西，不要互相引用、也不要合并。
 */
export const SIMULATION_SPEED_OPTIONS = [1, 2, 5, 10, 30, 60, 180, 300, 900, 1800, 3600] as const;

/** 单个合法倍速。目前全链路仍是 number，不做类型收窄，以免波及持久化读回。 */
export type SimulationSpeed = (typeof SIMULATION_SPEED_OPTIONS)[number];

/** 当前最高倍速——数据供给的余量公式与指南文案都以它为基准。 */
export const MAX_SIMULATION_SPEED =
  SIMULATION_SPEED_OPTIONS[SIMULATION_SPEED_OPTIONS.length - 1];

/** 移动端紧凑栏直接摆出来的快捷档位；其余档位走「更多」弹层，保证每一档都够得着。 */
export const QUICK_SIMULATION_SPEEDS = SIMULATION_SPEED_OPTIONS.slice(0, 4);
