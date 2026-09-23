import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEVERAGE_TIER_SNAPSHOT_DATE } from '@/lib/leverageTiers';

/**
 * 指南里的杠杆分层说明必须与实现对得上：快照日期、判定口径、平仓不拦、
 * 分层维持保证金只作用于新仓位。这些都是用户会照着核对的承诺。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('指南：杠杆分层与仓位上限', () => {
  const guide = read('pages/GuidePage.tsx');
  const at = guide.indexOf('杠杆分层与仓位上限</td>');
  const row = guide.slice(at, guide.indexOf('</tr>', at));

  it('有这一行，而且快照日期与数据文件一致', () => {
    expect(at).toBeGreaterThan(-1);
    expect(LEVERAGE_TIER_SNAPSHOT_DATE).toBe('2026-09-16');
    expect(row).toContain(`<strong>${LEVERAGE_TIER_SNAPSHOT_DATE}</strong>`);
    expect(row).toContain('不是历史分层');
  });

  it('写明判定口径：持仓 + 当前委托 + 这一单，多空相加，两个反读，最高一档', () => {
    expect(row).toContain('判的是下单之后的总量');
    expect(row).toContain('多空按绝对值相加');
    expect(row).toContain('某个杠杆下最多能持有多少');
    expect(row).toContain('某个规模最高能用几倍');
    expect(row).toContain('最高一档的上限');
    expect(row).toContain('触发那一刻');
  });

  it('写明合成币本位、平仓不拦、分层维持保证金只管新仓位', () => {
    expect(row).toContain('币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 分层折算');
    expect(row).toContain('平仓从不被拦');
    expect(row).toContain('本次更新之后新开');
    expect(row).toContain('0.4%');
  });

  it('写明面板「平仓」档照常受限、旧委托成交仍按旧模型、持仓卡按仓位的结算方式、100% 的余量', () => {
    expect(row).toContain('下单面板的「平仓」档并不平仓');
    expect(row).toContain('更新前挂出、更新后才成交');
    expect(row).toContain('持仓卡上的「杠杆」按该仓位自己的结算方式取分层');
    expect(row).toContain('留 0.2% 余量');
    expect(row).toContain('分段订单按各子单的委托价、跟踪委托按激活价估值');
  });

  it('【复核】写明：旧委托触发时不再判、TWAP 每片都判、下单时按触发价也判一道、敞口自己超限时只能减仓', () => {
    expect(row).toContain('本次更新之后下的条件单与跟踪委托');
    expect(row).toContain('更新前挂出的委托触发时不再判');
    expect(row).toContain('TWAP 的每一片');
    expect(row).toContain('下单时还会按触发价（跟踪委托按激活价）再判一道');
    expect(row).toContain('逐仓有持仓时不能降杠杆，只能先减仓或撤单');
  });

  it('【复核】估值口径写准：持仓按标记价，挂单按各自的委托价 / 触发价', () => {
    expect(row).not.toContain('U 本位按「数量 × 标记价」以 USDT 计');
    expect(row).toContain('持仓按标记价');
    expect(row).toContain('挂单按各自的委托价（没有委托价的按触发价');
  });

  it('旧的通用分层描述不再出现在「调整杠杆」里', () => {
    const adjust = guide.indexOf('调整杠杆</td>');
    const adjustRow = guide.slice(adjust, guide.indexOf('</tr>', adjust));
    expect(adjustRow).not.toContain('按该标的<strong>总</strong>敞口查档位上限');
    expect(adjustRow).toContain('请调低杠杆倍数至 Nx 以下');
    expect(adjustRow).toContain('KAITOUSDT 75x、BTCUSDT 150x、BTCUSD 125x');
  });

  it('默认杠杆：指南与抽屉都写「按该币对的最高杠杆生效」', () => {
    expect(guide).toContain('默认杠杆超过某个币对的最高杠杆时，在该币对上按它的最高杠杆生效');
    const drawer = read('components/TradingPreferencesDrawer.tsx');
    expect(drawer).toContain('则按该币对的最高杠杆生效');
    expect(drawer).not.toContain('则此设置无效');
  });
});

describe('指南：复核第三轮', () => {
  const guide = read('pages/GuidePage.tsx');
  const at = guide.indexOf('杠杆分层与仓位上限</td>');
  const row = guide.slice(at, guide.indexOf('</tr>', at));

  it('折币口径：持仓按标记价，挂单与这一单按各自的价（买入限价单按委托价折）', () => {
    expect(row).toContain('折币同样是持仓按标记价、挂单与这一单按各自的价');
    expect(row).toContain('跟踪委托按激活价');
    expect(row).not.toContain('币本位以币计（张数 × 面值 ÷ 标记价');
  });

  it('0.2% 余量写的是代码的行为：按现价成交（含穿价 / 贴着现价的限价单）或已有持仓才留；远离现价的限价无持仓不留；合成币本位从不留', () => {
    expect(row).toContain('估值跟着标记价浮动时，会在上限前留 0.2% 余量');
    expect(row).toContain('按现价成交的单（市价、最优价、已经穿价或离现价不到 0.2% 的限价单——面板与引擎可能对「穿没穿价」看法不同）、挂着这样的限价单、这一单或挂单按标记价估值（TWAP、没有激活价的跟踪委托），或已有持仓时留，U 本位与真币本位都一样');
    expect(row).toContain('除此之外（离现价更远的限价 / 触发价单、没有持仓，挂单也都按各自的价估值）不留');
    // 不再声称挂单一律按各自的价估值（TWAP 与没有激活价的跟踪委托按标记价）
    expect(row).not.toContain('这一单与挂单都按各自的价估值，不随现价漂');
    expect(row).toContain('合成币本位（如 KAITOUSD）按 USD 面值计、与价格无关，从不留');
    expect(row).not.toContain('以及真币本位，会在上限前留');
    // 与实现同一句话
    const impl = read('lib/positionLimit.ts');
    expect(impl).toContain("const floats = r.tiers.measure !== 'usd-face' && (live.orderAtMarket || live.hasOpenPositions);");
  });

  it('「可开」按输入框的单位报，开多开空各一列', () => {
    expect(row).toContain('「可开」按输入框当前的单位报');
    expect(row).toContain('开多、开空各一列');
  });

  it('已挂触发单的预警：只提醒不拦、三处说、预判的假设写清', () => {
    expect(row).toContain('已挂触发单的预警');
    expect(row).toContain('已挂的做多条件单 X 触发时会因超出当前杠杆最高可持有头寸被拒');
    expect(row).toContain('<strong>只提醒，不拦</strong>');
    expect(row).toContain('「<strong>触发时将超限</strong>」');
    expect(row).toContain('消息中心再记一条');
    expect(row).toContain('行情再变、之后又下了别的单或改了杠杆，触发时的结果还会不同');
  });

  it('更新前的仓位超过新上限：反向对冲不受限、同侧加仓照常受限，紧挨着旧维持保证金那一句', () => {
    const legacyMm = row.indexOf('升级本身不会让任何现有仓位或现有委托开出的仓位被强平或改变强平价。');
    const hedge = row.indexOf('更新前的仓位超过新上限时，对冲照常开得出去');
    expect(legacyMm).toBeGreaterThan(-1);
    expect(hedge).toBeGreaterThan(legacyMm);
    expect(hedge - legacyMm).toBeLessThan(80);
    expect(row).toContain('<strong>反向开仓不受上限约束</strong>，只要反方向的总量（已有持仓与挂单 + 这一单）不超过这些旧仓位的大小');
    expect(row).toContain('<strong>往旧仓位那一侧加仓照常受上限约束</strong>');
    expect(row).toContain('反向开仓对冲更新前的仓位不受此限，最多 X');
    // 与实现同一句话
    expect(read('lib/positionLimit.ts')).toContain('反向开仓对冲更新前的仓位不受此限，最多 ');
    // 「对冲单也一样」只剩新仓位
    expect(row).toContain('行情把新仓位推过了线时，对冲单也一样');
  });

  it('默认杠杆：按两张合约里较高的上限存，读时各自夹', () => {
    expect(row).toContain('偏好里的默认杠杆存的是它与两张合约（U 本位、币本位）里较高那个上限的较小者');
    expect(row).toContain('BNB：偏好 50x → U 本位 50x、币本位 20x');
  });

  it('加仓计算器的可下单量同样过这道上限', () => {
    expect(row).toContain('<strong>加仓计算器</strong>给出的可下单量同样过这道上限（见 3.4）');
  });
});

describe('指南：修复验证第一轮', () => {
  const guide = read('pages/GuidePage.tsx');
  const at = guide.indexOf('杠杆分层与仓位上限</td>');
  const row = guide.slice(at, guide.indexOf('</tr>', at));

  it('对冲豁免按仓位大小比（一律按标记价），靠它下出去的单按旧模型开，紧挨着豁免那一句', () => {
    const exemption = row.indexOf('更新前的仓位超过新上限时，对冲照常开得出去');
    const legacyModel = row.indexOf('<strong>靠这条豁免下出去的单按旧模型开</strong>');
    expect(exemption).toBeGreaterThan(-1);
    expect(legacyModel).toBeGreaterThan(exemption);
    expect(row).toContain('一律按标记价</strong>折算（U 本位比币数，真币本位比张数）');
    expect(row).toContain('一张远离现价的限价单不能因为委托价低就比它要对冲的旧仓位大');
    expect(row).toContain('价格不动也会一成交就被强平；下单面板在按钮前会说明');
    expect(row).toContain('本次更新之后挂的条件单若到触发那一刻才靠这条豁免放行，那一笔同样按旧模型开');
    // 旧维持保证金那一句点明例外
    expect(row).toContain('往它上面的加仓也一样；只靠下一条的对冲豁免下出去的除外');
    // 与实现同一句话
    expect(read('components/OrderPanel.tsx')).toContain('开出的仓位与它对冲的旧仓位一样按旧模型计维持保证金（0.4%）');
    expect(read('lib/positionLimit.ts')).toContain("r.ok && (r.atMark.reason === 'legacy-hedge' || r.atTrigger?.reason === 'legacy-hedge')");
  });
});

describe('指南：复核第五轮', () => {
  const guide = read('pages/GuidePage.tsx');
  const at = guide.indexOf('杠杆分层与仓位上限</td>');
  const row = guide.slice(at, guide.indexOf('</tr>', at));

  it('来源按记下来的判：只有更新前的仓位是豁免的底，豁免单占额度、不当底，挂着的豁免单到时再判', () => {
    const exemption = row.indexOf('更新前的仓位超过新上限时，对冲照常开得出去');
    const provenance = row.indexOf('谁算「更新前的仓位」，按记下来的来源判，不靠猜');
    expect(provenance).toBeGreaterThan(exemption);
    expect(row).toContain('<strong>只有更新前的仓位是豁免的底</strong>，某一侧的额度 = 反方向上更新前仓位<strong>冻结的底</strong>');
    expect(row).toContain('不能再给别的单当豁免的底');
    expect(row).toContain('<strong>挂着的豁免单到触发 / 成交那一刻再判一次</strong>（条件单、跟踪委托、限价单都是）');
    expect(row).toContain('放得下就开分层仓位，放不下就撤单留痕');
    expect(row).toContain('旧仓位平掉之后还留着的豁免仓位就是一个超过上限的普通仓位：只能减仓');
    // 旧文案（豁免单触发时不再判）不能再出现
    expect(row).not.toContain('挂着的条件单触发时也不再按分层判');
    expect(read('components/OrderPanel.tsx')).not.toContain('挂着的条件单触发时也不再按分层判');
    // 与实现同一条规则
    const model = read('lib/positionRiskModel.ts');
    expect(model).toContain("export const LEGACY_HEDGE_RISK_MODEL = 'legacy-hedge-v1' as const;");
    // 底按「多少」算，不按「是不是」：分层加仓并进旧仓位之后仓位变大、底不变（规则四）
    expect(read('lib/positionLimit.ts')).toContain('const baseUnits = hedgeExemptBaseUnits(p, units);');
    expect(read('lib/positionLimit.ts')).toContain('legacyUsdAtMark: units > 0 ? (usd * baseUnits) / units : 0,');
  });

  it('【复核 r7】合并四条规则写在指南里：不换模型、分层可以并进旧仓位、反过来不并、底不因合并变大', () => {
    const provenance = row.indexOf('谁算「更新前的仓位」');
    const merge = row.indexOf('<strong>加仓合并：仓位开出来之后不换强平模型</strong>');
    expect(merge).toBeGreaterThan(provenance);
    // 规则一
    expect(row).toContain('合并之后存活的仓位一律沿用<strong>被加仓的那个仓位</strong>的维持保证金模型与来源');
    expect(row).toContain('没有任何一笔成交能改动一个现有仓位的维持保证金、强平价或是否还活着');
    // 规则二（含两个方向的算例）
    expect(row).toContain('<strong>分层的加仓可以并进按旧 0.4% 的仓位</strong>');
    expect(row).toContain('<strong>整个仓位仍按旧的统一 0.4%</strong>，一个数都不重新定价');
    expect(row).toContain('整仓强平价 <strong>0.954000 → 0.945206</strong>（推远 0.92%）');
    expect(row).toContain('只加 1 个币则 0.954000 → 0.953999（几乎不动）');
    expect(row).toContain('而那一刀若单独成仓只有 <strong>0.923452</strong>（离标记价 3.81%）');
    /**
     * 【复核 r8】推远不是一般规律：往浮盈的头仓上加（这个体系最常见的画面）是**拉近**，
     * 而且要把旧仓位自己的前后两个数写出来（0.477000 → 0.567669），不能只拿并进去的数与单独成仓的数比。
     */
    expect(row).toContain('顺带把强平价<strong>推远或拉近</strong>——加到<strong>亏损</strong>的旧仓位上推远，加到<strong>浮盈</strong>的旧仓位上拉近');
    expect(row).toContain('旧仓位自己的强平价从 <strong>0.477000 变成 0.567669</strong>（拉近 9.44%）');
    expect(row).not.toContain('顺带把强平价推远：');
    expect(row).not.toContain('并进去整仓的强平价是 <strong>0.567669</strong>');
    expect(row).toContain('加仓在<strong>下单</strong>那一刻照样要过分层上限，这一条没变');
    // 规则三
    expect(row).toContain('<strong>反过来不并</strong>（规则三）');
    expect(row).toContain('239,000 × 10% − 7,700 = <strong>16,200</strong>');
    // 规则四
    expect(row).toContain('<strong>加进去的名义不会把对冲豁免的额度做大</strong>（规则四）');
    expect(row).toContain('<strong>冻结的底</strong>——分层加仓并进来只把仓位做大、底不动');
    expect(row).toContain('对冲额度、触发 / 成交那一刻的再判、面板的「可开」读的都是这个冻结的底，<strong>不是仓位当前的大小</strong>');
    // 第 6 轮那一套（两个方向都不并、旧仓位被换模型当场强平）不能再出现
    expect(row).not.toContain('<strong>加仓合并要两笔的维持保证金口径相同</strong>');
    expect(row).not.toContain('<strong>另开一个仓位站在旧仓位旁边</strong>');
    expect(row).not.toContain('合并后的整个仓位改按分层计维持保证金');
    expect(row).not.toContain('这一笔加仓可能让合并后的仓位当场被强平');
    // 仓位合并那一行也说同一条有方向的规则
    expect(guide).toContain('按旧 0.4% 的一笔不并进按币安分层的仓位（会把现有的分层仓位推进更高的档、当场强平），'
      + '反过来分层的加仓照常并进按旧 0.4% 的仓位、整仓仍按 0.4%——仓位开出来之后不换强平模型');
    // 与实现同一处
    expect(read('lib/tradingSettlement.ts')).toContain('...survivorRiskStamp(target),');
    expect(read('lib/tradingSettlement.ts')).toContain("if (mergeRiskBlocked(a, b)) return 'riskModel';");
    expect(read('lib/positionRiskModel.ts')).toContain('return tiered(a) && !tiered(b);');
    expect(read('lib/positionRiskModel.ts')).not.toContain('export function strictestRiskStamp');
    expect(read('components/OrderPanel.tsx')).toContain('会并进${isLegacyHedgeRisk(target) ? \'靠对冲豁免开的\' : \'更新前开的\'}同方向仓位');
    expect(read('components/OrderPanel.tsx')).toContain('不会并进按币安分层计的同方向仓位');
  });

  /**
   * 【复核 r7 · 修订】规则三那一格（豁免成交旁边站着分层仓位）仍会出现两笔的卡，那张卡上的三件事要写准：
   *   · 新的那一笔身上没有任何减仓单，「止盈/止损」按整张卡生效；
   *   · 「平仓」也按整张卡生效、成数摊到每一笔——不再是一按就把两笔全部市价平掉；
   *   · 「+」是卡级的，按名义等比摊到每一笔（没有单腿追加入口）。
   */
  it('【复核 r7】两笔的卡：止盈止损与平仓都按整张卡生效，「+」按名义摊到每一笔', () => {
    expect(row).toContain('规则三那一格<strong>没有合并</strong>时，新的那一笔身上<strong>没有任何减仓单</strong>');
    expect(row).toContain('<strong>「平仓」同样按整张卡生效</strong>：弹窗里挑的成数摊到卡上每一笔、各按自己的数量平');
    expect(row).toContain('不再是一按就把两笔全部市价平掉');
    expect(row).toContain('<strong>「+」是卡级的</strong>，卡上多于一笔时这笔钱按名义等比摊到每一笔，旧仓位只拿到其中一部分');
    // 旧文案（「+」能单独给那一笔追加、加仓救不了旧仓位）不能再出现
    expect(row).not.toContain('要救只能用持仓卡上的「+」单独给那一笔追加保证金');
    expect(row).not.toContain('<strong>不合并也有代价，面板会说</strong>');
    expect(read('components/OrderPanel.tsx')).not.toContain('单独给那一笔追加保证金');
    // 【复核 r8】平仓弹窗不写强平价（只有止盈止损弹窗写「最先」那一笔），指南不能说两个弹窗都写
    expect(guide).toContain('止盈止损弹窗里的强平价是逐仓里最先被强平的那一笔，平仓弹窗只写加权开仓价与标记价（不写强平价）');
    expect(guide).toContain('平仓弹窗的可用数量按此刻还活着的几笔算');
    expect(guide).not.toContain('弹窗里的开仓价是这张卡的加权开仓价、强平价是逐仓里最先被强平的那一笔');
    // 平仓弹窗的说明也不硬写「维持保证金口径不同」
    expect(read('components/ClosePositionModal.tsx')).toContain('杠杆 / 保证金模式 / 结算方式 / 维持保证金口径任一不同，没有合并');
    expect(read('components/ClosePositionModal.tsx')).not.toContain('（维持保证金口径不同，没有合并）');
    // 仓位合并那一行也写清两个按钮都按整张卡生效
    expect(guide).toContain('<strong>「止盈/止损」与「平仓」都按整张卡生效</strong>');
    // 合并持仓卡那一行写清「保证金比率（最高）」
    expect(guide).toContain('<strong>保证金比率（最高）</strong>写的是同一笔');
    // 代码里的四处
    expect(read('contexts/TradingContext.tsx')).toContain('现有仓位上的止盈止损不覆盖这一笔：在持仓卡上按一次「止盈/止损」会给卡上每一笔各挂一张。');
    expect(read('components/PositionPanel.tsx')).toContain('for (const pos of live) onPlaceTpSl(tpslModal.symbol, pos, tp, sl, pct);');
    expect(read('components/PositionPanel.tsx')).toContain('for (const { index } of live) onClosePosition(symbol, index, percentage);');
    expect(read('components/PositionPanel.tsx')).toContain("label={worstLegRatio != null ? '保证金比率（最高）' : '保证金比率'}");
  });

  it('仓位比例按钮的 100%：限价只对一个方向穿价时取挂得住的那一列；对冲豁免让两列不同时取较大的那一列', () => {
    expect(row).toContain('同一个限价只对一个方向穿价时，取<strong>挂得住的那一列</strong>（穿价的那个方向等于市价单；那一列是 0 才取另一列）');
    expect(row).toContain('对冲豁免让两列不同时取<strong>较大的那一列</strong>');
    expect(row).not.toContain('两列里较小的那个');
    const panel = read('components/OrderPanel.tsx');
    expect(panel).toContain('if (restingSide && usable(value(restingSide))) return value(restingSide);');
    expect(panel).toContain('return open.length > 0 ? Math.max(...open) : 0;');
  });

  it('已经穿价的限价单按现价估值；挂着的限价单下单时再按委托价判一道「成交那一刻」', () => {
    expect(row).toContain('<strong>已经穿价的限价单</strong>（买价 ≥ 现价、卖价 ≤ 现价，下一根 K 线就按委托价成交）按标记价估值');
    expect(row).toContain('<strong>没有穿价的限价单</strong>（分段订单取离现价最远的那笔子单）同样再按委托价判一道「成交那一刻」');
    expect(row).toContain('第二道的提示以「按委托价 X 成交那一刻估值」开头');
    expect(read('lib/positionLimit.ts')).toContain('`按委托价 ${formatPrice(price)} 成交那一刻估值：`');
    expect(row).toContain('只靠下文对冲豁免挂出的限价单除外，它成交那一刻要再判豁免是否仍成立');
  });

  it('预警一条写准：已挂触发单按触发价算进敞口，预判按价格走到触发价、路上成交的限价单算持仓；不再声称币安不看', () => {
    expect(row).not.toContain('下单与改杠杆本身不看已挂的触发单');
    expect(row).not.toContain('币安也不看');
    expect(row).toContain('下单与改杠杆时，已挂的触发单只按触发价（跟踪委托按激活价）算进敞口，不会替它们预演触发那一刻的判定');
    expect(row).toContain('预判按「<strong>价格走到触发价</strong>（跟踪委托为激活价，豁免限价单为委托价）那一刻」算');
    expect(row).toContain('走过的路上会成交的限价单（买单委托价不低于走过的最低价、卖单不高于走过的最高价，含已经穿价的，也含正要下的这一单）与会触发的条件单到时已是持仓、按那个价估值');
    expect(row).not.toContain('路上先触发的条件单也按它自己的触发价算作挂单');
  });

  it('3.4：例子写明现价 1.0；对冲按价格走到 S₁ 判，回调限价加仓到时已是持仓；突破加仓触发时算上补挂的对冲', () => {
    expect(guide).toContain('KAITOUSDT 15x、现价 1.0、多 10,000、S₁ = 0.9：单看加仓还能开 39,900');
    expect(guide).toContain('这两个数随现价变');
    expect(guide).toContain('判对冲时按<strong>价格走到 S₁ 那一刻</strong>算：回调加仓的限价单、落在这段路上的加仓条件单到那时已经成交，是按 S₁ 估值的持仓');
    expect(guide).toContain('挂着的限价加仓在补挂对冲之后，到 S₂ 成交那一刻也要放得下（S₁ 夹在现价与 S₂ 之间时，那时对冲已经是持仓；');
    // 突破加仓：两种先后都算，不再只说「对冲已经算在里面」
    expect(guide).not.toContain('突破加仓（条件单 @S₂）到 S₂ 触发时，S₁ 上补挂的对冲已经算在里面');
    expect(guide).toContain('<strong>S₂ 与 S₁ 在现价两侧时，两张单谁先到都算</strong>');
    expect(guide).toContain('先突破、加仓成交再跌回 S₁，对冲按已成交的加仓判');
    expect(guide).toContain('先跌到 S₁、对冲成交再涨到 S₂，加仓按已成交的对冲判');
    expect(guide).toContain('只算「先突破」是 13,809，「先跌到 0.9、再涨到 1.2」那一种更紧，给 10,833');
    // 保证有前提：之后不另下开仓单、不改杠杆
    expect(guide).toContain('按给出的量挂上这两张单，之后不另下开仓单、不改杠杆的话，价格不论先走哪边，两张单到各自的触发价都不会被分层拒掉');
    expect(guide).toContain('条件单加仓挂在 S₁ 之外也一样，到 S₂ 触发时对冲已经成交');
    expect(guide).toContain('另一侧还挂着开仓单时，「它先成交、价格再折回 S₂」也要放得下');
    expect(guide).toContain('预判把路上会触发的条件单一律当作已经开出来，其中自己就注定被撤的那张到时让出的位置不算在内');
    expect(guide).toContain('预警只说这一步新弄坏的那几种（这一步之前就放不下的走法不重复说，直接走过去本来就放不下的单整张不再说——它早就标着）');
  });
});

describe('指南：复核第五轮 · 二', () => {
  const guide = read('pages/GuidePage.tsx');
  const at = guide.indexOf('杠杆分层与仓位上限</td>');
  const row = guide.slice(at, guide.indexOf('</tr>', at));

  it('几种走法：先去现价另一侧再折回来也算，标记与预警都按它；正要下的触发单自己也说', () => {
    expect(row).toContain('价格也可能<strong>先去现价另一侧、再折回来</strong>');
    expect(row).toContain('「先突破再跌回来」对冲按已成交的加仓判，「先跌到对冲再涨回来」加仓按已成交的对冲判');
    expect(row).toContain('正要下的这一单若是触发类单，「另一侧的挂单先成交、再折回来触发它」会被拒时也会说');
    expect(row).toContain('靠下文对冲豁免挂出的限价单标「<strong>成交时将超限</strong>」');
    const lib = read('lib/positionLimit.ts');
    expect(lib).toContain('export function restingTriggerScenarios(');
    expect(read('components/PositionPanel.tsx')).toContain("triggerDoom.kind === 'limit' ? '成交时将超限' : '触发时将超限'");
  });

  it('【复核 r7】旧维持保证金一句：直到平掉——分层加仓并进这个仓位，整仓仍按 0.4%', () => {
    expect(row).toContain('仍按旧的统一 0.4% 计算，直到平掉（往它上面的分层加仓会并进这个仓位，整仓仍按 0.4%，见下文的合并规则）');
    expect(row).not.toContain('往它上面的分层加仓另成一个仓位，不与它合并');
  });

  it('币安下单时只判一次（持仓按标记价）——不再说「只按标记价判」', () => {
    expect(row).toContain('币安下单时只判一次（持仓按标记价），这是与币安刻意不同的一处');
    expect(row).not.toContain('币安下单时只按标记价判一次');
  });

  it('第二道：路上会先触发的条件单也算作那个价上的持仓', () => {
    expect(row).toContain('价格走过去的路上会成交的限价单、会触发的条件单也算作那个价上的持仓');
    expect(row).toContain('持仓、路上会先成交的限价单与会先触发的条件单、这一单都按委托价估值');
  });
});
