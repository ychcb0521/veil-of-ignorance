import { describe, expect, it } from 'vitest';
import { shouldRejectImmediateConditionalPlacement } from '@/lib/conditionalOrders';
import { getTriggerOperator, isTriggerConditionMet } from '@/types/trading';

/**
 * 条件单下单闸门。
 *
 * 两条独立的性质，必须分开测：
 *   A. 判定**与买卖方向无关** —— 方向是下单当刻由「触发价 vs 现价」锁定的。
 *      旧实现按 side 硬编码方向，把「跌到 X 买入」和「涨到 X 做空」误杀。
 *   B. 判定与**撮合基准同源** —— 本引擎撮合用的是当前这根未收 K 线的完整
 *      high/low（含下单之前就走完的那段），不是标量现价。闸门只比标量的话，
 *      放行的单子会在下一帧被这根 K 线的旧行程触发，以触发价成交而市价在别处。
 */
const CUR = 0.394584;   // 用户截图里的 ETHWUSD 现价
/** 这根 K 线到目前为止只在 0.37–0.41 之间走过，没碰过 0.36 也没碰过 0.42。 */
const QUIET = { high: 0.41, low: 0.37 };

describe('A · 判定与买卖方向无关', () => {
  it('触发价低于现价（跌到 X 买入 / 抄底加仓）—— 放行', () => {
    // 用户报的就是这一单：现价 0.394584、触发价 0.36、开多，旧闸门拒了它
    expect(shouldRejectImmediateConditionalPlacement(CUR, 0.36, QUIET)).toBe(false);
  });

  it('触发价高于现价（涨到 X 做空 / 突破买入）—— 放行', () => {
    expect(shouldRejectImmediateConditionalPlacement(CUR, 0.42, QUIET)).toBe(false);
  });

  it('函数签名里没有 side —— 结构上不可能再按买卖方向分叉', () => {
    expect(shouldRejectImmediateConditionalPlacement.length).toBeLessThanOrEqual(3);
  });

  it('两个方向锁定的 operator 在下单当刻都不满足（零宽度 bar = 只有现价那一点）', () => {
    for (const trigger of [0.36, 0.42]) {
      const op = getTriggerOperator(trigger, CUR);
      expect(isTriggerConditionMet(op, trigger, { high: CUR, low: CUR })).toBe(false);
    }
  });
});

describe('B · 闸门与撮合同源：这根 K 线已经走过的行程算数', () => {
  it('【回归】本根已下探到触发价之下 → 必须拒，否则下一帧就以触发价成交而市价在上方', () => {
    // 本根 low 已经打到 0.355，低于 0.36。放行的话：撮合下一帧看到
    // low 0.355 <= 0.36 → 以 0.36 开多，而市价 0.394584 —— 凭空 +9.6%。
    const dipped = { high: 0.41, low: 0.355 };
    expect(shouldRejectImmediateConditionalPlacement(CUR, 0.36, dipped)).toBe(true);

    // 证明拦住它的确实是区间而不是别的：同一单在没探过底的 bar 上照常放行
    expect(shouldRejectImmediateConditionalPlacement(CUR, 0.36, QUIET)).toBe(false);
  });

  it('【回归】本根已冲高到触发价之上 → 同样必须拒（这一侧旧闸门本来就漏）', () => {
    const spiked = { high: 0.43, low: 0.37 };
    expect(shouldRejectImmediateConditionalPlacement(CUR, 0.42, spiked)).toBe(true);
  });

  it('闸门放行 ⇒ 撮合在这根 bar 上确实不会触发（两者用同一套 operator 判据）', () => {
    for (const trigger of [0.36, 0.42]) {
      expect(shouldRejectImmediateConditionalPlacement(CUR, trigger, QUIET)).toBe(false);
      const op = getTriggerOperator(trigger, CUR);
      expect(isTriggerConditionMet(op, trigger, QUIET)).toBe(false);
    }
  });

  it('拿不到区间时退回只比标量——不因为缺数据就把正常单子拒掉', () => {
    expect(shouldRejectImmediateConditionalPlacement(CUR, 0.36, undefined)).toBe(false);
    expect(shouldRejectImmediateConditionalPlacement(CUR, 0.36, { high: NaN, low: NaN })).toBe(false);
  });
});

describe('边界', () => {
  it('触发价恰好等于现价 → 拒，且不依赖区间', () => {
    expect(shouldRejectImmediateConditionalPlacement(CUR, CUR, QUIET)).toBe(true);
    expect(shouldRejectImmediateConditionalPlacement(CUR, CUR, undefined)).toBe(true);
  });

  it('判等用相对误差：低价币的浮点噪声算相等（不给区间以隔离出标量那一层）', () => {
    const tiny = 0.000012804;
    expect(shouldRejectImmediateConditionalPlacement(tiny, tiny * (1 + 1e-12), undefined)).toBe(true);
    // 亚 tick 但大于 1e-9 容差：标量层不算相等
    expect(shouldRejectImmediateConditionalPlacement(tiny, tiny * (1 + 1e-7), undefined)).toBe(false);
  });

  it('触发价贴着现价时，任何包含现价的 bar 都会跨过它 → 区间层照样拒（这是对的）', () => {
    // 这条是上一条的补集：一旦把真实 bar 交进来，「差一丝」的触发价必然落在
    // bar 内部，撮合下一帧就会满足。拒掉它与「会立即触发」的语义一致。
    const tiny = 0.000012804;
    const bar = { high: tiny * 1.2, low: tiny * 0.9 };
    expect(shouldRejectImmediateConditionalPlacement(tiny, tiny * (1 + 1e-7), bar)).toBe(true);
  });

  it('非有限输入不拦截——交给上游的「触发价无效」去报，别在这里吞掉', () => {
    expect(shouldRejectImmediateConditionalPlacement(CUR, Number.NaN, QUIET)).toBe(false);
    expect(shouldRejectImmediateConditionalPlacement(Number.NaN, 0.36, QUIET)).toBe(false);
  });
});
