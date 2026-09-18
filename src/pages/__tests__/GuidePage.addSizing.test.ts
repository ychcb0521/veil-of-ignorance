import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 指南 §3.4 与 Legs「加仓校验」那一条必须把 S₂ 的口径说清：计算器按预计成交价定量，校验按成交价判，
 * 引擎的 Taker 滑点是 0.01% + 名义 ÷ 50 亿（函数里「K 线区间 > 2% 翻倍」那一档没有任何成交路径传区间，今天从不生效），
 * 张数 / 名义上限对 S₂ 的弹性是 S₁/(S₂ − S₁)、币数上限是 S₂/(S₂ − S₁)。
 * 这些句子与代码一一对应（calcSlippage、sizeAddAtExpectedFill、addSizingFillGuard、addSizingSnapshotLines），
 * 改了代码就要改指南，反之亦然。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('指南：加仓计算器的 S₂ 是预计成交价', () => {
  const guide = read('pages/GuidePage.tsx');

  it('§3.4 不再说「S₂ 读现价」，改为引擎成交的基准价 + 所有派生量按 S₂′', () => {
    expect(guide).not.toContain('S₂ 读现价');
    expect(guide).toContain('S₂ 从<strong>引擎市价成交的基准价</strong>读入');
    expect(guide).toContain('所有派生量都按预计成交价 S₂′ 算，不按 S₂');
  });

  it('红框写明滑点模型、放大倍数、市价 / 限价档、成交后复判、快照与「按上限下单」', () => {
    const at = guide.indexOf('S₂ 必须是预计成交价，不是下单前看到的现价');
    expect(at).toBeGreaterThan(-1);
    const block = guide.slice(at, guide.indexOf('</RedHighlight>', at));
    expect(block).toContain('0.01% + 名义 ÷ 50 亿');
    // 翻倍那一档只在函数里：没有成交路径传 K 线区间，指南不能让人为它留余量
    expect(block).toContain('2% 时滑点率翻倍」，但本模拟器没有任何成交路径把 K 线区间传给它，这一档今天从不生效');
    expect(block).not.toContain('（1 分钟 K 线区间超过收盘价 2% 时翻倍）');
    // 函数不限定周期：不说「1 分钟」
    expect(block).not.toContain('1 分钟 K 线区间');
    expect(block).toContain('「传入的 K 线区间（最高 − 最低，函数不限定周期）超过收盘价 2% 时滑点率翻倍」');
    expect(block).not.toContain('翻倍那一档计算器默认不计');
    // 两个弹性各归各的：币数 S₂/(S₂ − S₁)，张数 / 名义 S₁/(S₂ − S₁)
    expect(block).toContain('币数上限 = 垫子 ÷ (S₂ − S₁)，对 S₂ 的弹性是 <span className="font-mono">S₂ ÷ (S₂ − S₁)</span>');
    expect(block).toContain('张数 / 名义上限 = 币数 × S₂，弹性少 1，是 <span className="font-mono">S₁ ÷ (S₂ − S₁)</span>');
    expect(block).not.toContain('上限 = 垫子 ÷ (S₂ − S₁)，对 S₂ 的弹性是 <span className="font-mono">S₁');
    // 「少 1」只对主多成立：主空张数弹性比币数多 1（sizeAddAtExpectedFill 的 contractElasticity 两边都直接算）
    expect(block).toContain('（以主多写；主空把 S₂ − S₁ 换成 S₁ − S₂，张数弹性反而比币数多 1）');
    expect(block).toContain('1.57% / 3.70%');
    expect(block).toContain('成交每不利 0.1%，上限少约 N 币（M 张）');
    expect(block).toContain('「限价 @S₂」');
    expect(block).toContain('成交之后还会再判一遍');
    expect(block).toContain('实际成交价');
    expect(block).toContain('计算器算出的计划会钉在单子上');
    expect(block).toContain('按上限下单');
    expect(block).toContain('向下取整');
    // 复审：限价挂单价向有利侧取整、复判只判带计划的加仓、快照带下单参考价、归因
    expect(block).toContain('<strong>向有利侧取整</strong>（多头向下、空头向上）');
    expect(block).toContain('<strong>带着计算器计划</strong>的吃单加仓成交时——市价、最优价，以及触发后按市价成交的条件委托（盘面上、后台标的上触发都算，参考价取触发价）');
    expect(block).toContain('（给对冲加码、没开计算器的那一刀不判——那不是计算器授权的加仓；挂单价原价成交的限价单没有滑点，也不在这里判）');
    expect(block).toContain('外加这张单自己的下单参考价（市价取引擎基准价、限价取委托价、条件委托取触发价）');
    expect(block).toContain('成交比计划预计的更差、计算后价格变了，还是量本身超了计划');
    expect(block).toContain('同标的、同方向、同结算方式的开仓单');
    // 二审：二分求解、同一个数、市价单只能在基准价上成交、计划的生命周期
    expect(block).not.toContain('三四步即收敛');
    expect(block).toContain('用<strong>二分</strong>在 0 与无滑点上限之间夹出来，<strong>取不超的那一端</strong>——永远收敛');
    expect(block).toContain('迭代给 179 币，真上限 177.19，取满就超 1.67%');
    expect(block).toContain('快照与「按上限下单」<strong>读的是同一个数</strong>');
    expect(block).toContain('<strong>市价单只能在引擎基准价上成交</strong>：市价档的 S₂ 永远是基准价');
    expect(block).toContain('「手填 S₂ 只能按限价或条件单成交，已切到限价 @S₂；点复位回到市价」，旁边一键「突破加仓改按条件单」');
    expect(block).toContain('<strong>点「开多 / 开空」那一刻</strong>就随单子取走');
    // 三审：条件单档、再打开时按当下重读、清计划、敏感度精确重算、COMMONUSDT 的下单量如实写
    expect(block).toContain('<strong>「条件单 @S₂」</strong>是第三档，突破加仓用它：S₂ 是触发价，触发后引擎在<strong>触发价</strong>上按同一个 Taker 滑点成交');
    expect(block).toContain('触发价 0.0077015：限价档给 653,579 张，触发后 +0.14% 成交、超 1.57%；条件单档给 643,614 张，在自己的成交价上不超');
    expect(block).toContain('「按上限下单」预填的是一张以 S₂ 为触发价的条件委托');
    expect(block).toContain('<strong>重新打开计算器</strong>会从仍在保鲜期的计划种回 S₁ 与下单方式（限价 / 条件单计划连同锁住的价）');
    expect(block).not.toContain('种回 S₁、G 与下单方式');
    expect(block).toContain('X₁ / S̄ 按<strong>计划那一侧</strong>的持仓重读');
    expect(block).toContain('G 按本场落袋重读——计划之后又止损了一笔，G 换成本场的并注明上次计划里是多少');
    expect(block).toContain('计划早于当前持仓的开仓（停止回放后同一段历史又放了一遍、平掉又重开）就整个不认');
    expect(block).toContain('开始回放、跳到信号时刻、停止回放、合并时间轴、彻底清除标的数据时，没下出去的计划一并清掉，不跨场');
    expect(block).toContain('按成交价再不利 0.1% 精确重算，不用一阶近似');
    expect(block).toContain('消息会直接点明该改用「市价」或「条件单 @S₂」档定量');
    expect(block).not.toContain('与计算器的数只差整张取整');
    expect(block).toContain('下的是 653,602 张、1,380,961 张，比计算器按现价给出的 653,615 / 1,380,978 张还略少');
    expect(block).toContain('<strong>撤掉带计划的限价 / 条件单</strong>（包括成交时保证金不足被撤），计划仍在保鲜期、又没有更新的计划、这个标的也仍持有同方向仓位时会放回去');
    expect(block).toContain('停止回放先平仓再撤单，计划不会漏到下一场');
    // 三审：撤单放回只认这一场、这条仓位
    expect(block).toContain('但计划必须属于<strong>这一场、这条仓位</strong>：跳到信号时刻把旧挂单带进新的一场后再撤（计划早于分场、或挂单与撤单不在同一场回放里），或平掉又重开之后再撤上一轮的计划单（同方向的仓位晚于计划开出），都不放回');
    // 四审：翻转方向分出新时间线，但不是分场
    expect(block).toContain('<strong>正放 ↔ 倒放翻转不算分场</strong>——仓位、挂单与没下出去的计划都原样带过去，翻转前挂的计划单翻转后撤掉照样放回');
    expect(block).not.toContain('挂单与撤单不在同一条回放时间线上');
    // 快照里的 S₂ 按下单方式称呼，不一律叫现价
    expect(block).toContain('带着一份快照——计算时的参考价 S₂（市价计划是现价、限价计划是手填的限价、条件委托是触发价）');
    expect(block).not.toContain('带着一份快照——现价、');
  });

  it('§3.4 开头：市价档 S₂ 永远跟着基准价，限价档手改才锁定，复位回到市价', () => {
    expect(guide).toContain('市价档永远跟着它，限价档手改即锁定，复位图标回到市价并重新跟随');
    expect(guide).not.toContain('手改即锁定，复位图标重新跟随；');
  });

  it('写明 Plan B 不覆盖什么，以及两笔 3,000 万名义平仓各吃约 0.6% 的经验法则', () => {
    const at = guide.indexOf('Plan B 不覆盖什么');
    expect(at).toBeGreaterThan(-1);
    const clause = guide.slice(at, at + 700);
    expect(clause).toContain('手续费不计');
    expect(clause).toContain('对冲单触发后成交在触发价之下');
    expect(clause).toContain('多头没有平在 S₁');
    expect(clause).toContain('对冲先于多头被解掉');
    expect(clause).toContain('大单平仓本身的 Taker 滑点');
    expect(clause).toContain('两笔 3,000 万名义的平仓在本模拟器里各吃约 0.6%');
  });

  it('Legs「加仓校验」那一条：按成交价判、并排写出计算器的快照、点名滑点；老记录不猜 pre_entry_price', () => {
    const at = guide.indexOf('「加仓校验」列</strong>（紧跟「币量 / 仓位」与「多单占比」之后）');
    expect(at).toBeGreaterThan(-1);
    const bullet = guide.slice(at, guide.indexOf('</li>', at));
    expect(bullet).toContain('S₂ 一律按成交价判');
    expect(bullet).toContain('0.01% + 名义 ÷ 50 亿');
    expect(bullet).toContain('计算时 现价 …，预计成交 …，上限 … 币；实际成交 …，上限 … 币');
    expect(bullet).toContain('超出部分全部来自成交滑点 +x%');
    expect(bullet).toContain('pre_entry_price 已被成交价改写');
    // 复审：只有真是滑点才点名滑点
    expect(bullet).toContain('只有按这张单下单时的价、计入计划预计的滑点，这个量本来仍在上限之内，才点名');
    expect(bullet).toContain('x 是比计划预计多出来的那一截');
    expect(bullet).toContain('「下单时 参考价 …（计算后价格变动 +y%）」');
    // 三审：「现价」只给市价计划；限价计划写手填的限价，条件委托写触发价
    expect(bullet).toContain('「现价」只用于市价计划——限价计划的参考价是手填的限价，写「计算时 限价 …，挂单价 …」，条件委托计划写「计算时 触发价 …」');
    expect(bullet).toContain('写「下单价偏离计划挂单价」/「触发价偏离计划触发价」');
    expect(bullet).toContain('不拿滑点顶罪');
    expect(bullet).not.toContain('实际加仓量仍在计算时参考价的上限之内就直接点名');
  });

  it('指南里的口径与代码同源：引擎滑点率、快照三行话的措辞', () => {
    const trading = read('types/trading.ts');
    const sizing = read('lib/addSizing.ts');
    expect(trading).toContain('let slippageRate = 0.0001 + notionalValue / 5_000_000_000;');
    expect(trading).toContain('if (range > 0.02) slippageRate *= 2;');
    const check = read('lib/campaignAddSizingCheck.ts');
    // 点名滑点时写的是比计划预计多出来的那一截，不是整段成交滑点
    expect(check).toContain('超出部分全部来自成交滑点 ${formatSignedPct(excess.unexpectedSlippagePct)}');
    expect(check).toContain("const refWord = limitPlan ? '限价' : conditionalPlan ? '触发价' : '现价';");
    expect(check).toContain("calc: `计算时 ${refWord} ${px(snap.s2Ref)}，${limitPlan ? '挂单价' : '预计成交'} ${px(snap.s2Fill)}");
    expect(check).toContain('order: drifted ? `下单时 参考价 ${px(orderPrice)}（${driftWord}');
    expect(check).toContain("const driftWord = limitPlan ? '下单价偏离计划挂单价' : conditionalPlan ? '触发价偏离计划触发价' : '计算后价格变动';");
    const settlement = read('lib/tradingSettlement.ts');
    // 引擎唯一的成交滑点入口不传 K 线区间：指南里「今天从不生效」靠它成立
    expect(settlement).toMatch(/calcSlippage\(\s*price,\s*notionalUsd,\s*order\.side\s*\)/);
    expect(settlement.match(/calcSlippage\(/g)).toHaveLength(1);
    const calculator = read('components/AddSizingCalculator.tsx');
    expect(calculator).toContain('成交每不利 0.1%，上限少约');
    expect(calculator).toContain('按上限下单');
    expect(calculator).toContain('手填 S₂ 只能按限价或条件单成交，已切到限价 @S₂；点复位回到市价');
    expect(calculator).toContain('突破加仓改按条件单');
    expect(calculator).toContain("conditional: '条件单 @S₂',");
    const guard = read('lib/addSizingFillGuard.ts');
    expect(guard).toContain('这类单子该用计算器的「市价」或「条件单 @S₂」档定量');
    // 敏感度精确重算：S₂″ = S₂′ × (1 ± 0.001)
    expect(sizing).toContain('const worseFill = s2Fill * (1 + 0.001 * d);');
    expect(sizing).toContain("return kind === 'market' || kind === 'conditional';");
    // 二分，不是固定步数的不动点迭代
    expect(sizing).toContain('FILL_BISECTION_MAX_ITERATIONS');
    expect(sizing).not.toContain('FILL_FIXED_POINT_MAX_ITERATIONS');
    const plan = read('lib/addSizingPlan.ts');
    expect(plan).toContain('export function restoreAddSizingPlan(');
    const context = read('contexts/TradingContext.tsx');
    // 手动撤单与保证金不足被撤两处都走同一个放回口子，带上这次撤单盖的时间线章；
    // 放回前先看这个标的是否仍持有同方向仓位、这条仓位是否不晚于计划、挂单与撤单是否在同一场回放里（只隔着翻转方向也算）
    expect(context.match(/restoreCancelledAddPlan\(symbol, order, positionsMapRef\.current\[symbol\], cancelledTimelineId, timelineRegistryRef\.current\)/g)).toHaveLength(2);
    expect(context).toContain('const held = (positions ?? []).filter(p => p.side === order.side && isPositionOpen(p));');
    expect(context).toContain('if (held.length === 0) return;');
    expect(context).toContain('if (openedRealAt != null && openedRealAt > snapshot.at) return;');
    expect(context).toContain('if (order.createdTimelineId && timelineId && !isWithinDirectionFlips(timelines, order.createdTimelineId, timelineId)) return;');
    expect(read('lib/replayTimeline.ts')).toContain("if (!node || node.cause !== 'direction') return false;");
    // 分场水位：清除之前的计划不放回
    expect(plan).toContain('if (snapshot.at <= Math.max(clearedAllAt, clearedAtBySymbol.get(symbol) ?? Number.NEGATIVE_INFINITY)) return false;');
    const orderPanel = read('components/OrderPanel.tsx');
    expect(orderPanel).toContain('const planned = peekAddSizingSnapshotForOrder({');
  });
});
