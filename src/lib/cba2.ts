/** CBA-2：按用户 2026-10-18 图片，成交支持下的价格重心迁移。仅已收盘 5m。
 * 未指定的研究参数：h=6h，基线/EWMA 半衰期=24h，α=1，ε=1e-6，m=12，dmax=3。
 * 完整基线与48h窗口尚未就绪、无成交或缺关键数据时留空，绝不补零。
 */
import { evaluateProgramVars, parseFormula, type Value } from '@/lib/deepDig/formula';
export const CBA2_DEFAULTS = { halfLifeHours: 6, normHours: 24, alpha: 1, epsilon: 1e-6, m: 12, dmax: 3 } as const;
export type Cba2Params = { -readonly [K in keyof typeof CBA2_DEFAULTS]: number };
export const CBA2_FORMULA = [
  '# CBA-2 = 100·tanh(Σ w·F*·G*·R*)；仅已收盘5分钟，48小时权重合计1；不是胜率',
  '# hl = 时间权重半衰期（小时）；avgh = 成交额基线时长与 r² EWMA 半衰期（小时）；以下为可修改的研究默认值',
  'alpha = 1', 'epsilon = 0.000001', 'm = 12', 'dmax = 3',
  'V = if(Q > 0 and B >= 0 and S >= 0 and (not has(prev(T)) or T - prev(T) == 300000), Q, 0 / 0)',
  'price = if(V > 0 and E > 0, E, 0 / 0) # E=成交额/成交数量（VWAP）',
  'D = B - S # 主动成交净差额，不是市场净资金流入',
  'r = ln(price / prev(price))',
  'Vbar = prev(if(has(full(V, avgh * 12)), avg(V, avgh), 0 / 0)) # 只用上一根及以前',
  's = if(has(prev(full(r, avgh * 12))), sqrt(prev(ema(r ^ 2, avgh)) + epsilon ^ 2), 0 / 0)',
  'F = ln(1 + V / Vbar)',
  'G = 1 + alpha * abs(D) / V * (D * r > 0) # 主动买配合上涨、主动卖配合下跌均放大',
  'R = r / s',
  'U = full(F * G * R, 576) # 满48小时且无缺值才计算',
  'W = wsum(1, hl * 12, 576)',
  'score = wsum(F * G * R, hl * 12, 576) / W',
  'Ppeak = peak(C, m + 1) # 含当前共m+1个收盘价',
  'DD = ln(Ppeak / C) / s',
  'invalid = DD > dmax # 独立失效标记，不清零主指标，不替代止损；未失效不代表满足买入条件',
  'CBA2 = if(has(U), 100 * tanh(score), 0 / 0)',
].join('\n');
export const CBA2_DEFINITION = 'CBA-2｜成交支持下的价格重心迁移指标（−100 ~ 100）：正值表示加权上行变化占优，负值表示加权下行变化占优，不是胜率。仅已结束的5分钟K线；回撤失效标记独立运行，不清零主指标，也不替代交易止损。';
export const CBA2_STEPS = [
  'CBA-2ₜ = 100·tanh(Σ wᵢ,ₜ·Fᵢ*·Gᵢ*·Rᵢ*)，Wₜ = 截至当前的48小时窗口',
  'wᵢ,ₜ = 2^(−ΔTᵢ,ₜ/h) ÷ Σ 2^(−ΔTⱼ,ₜ/h)，时间以小时计，窗口权重合计1',
  'Vᵢ = Bᵢ + Sᵢ；Dᵢ = Bᵢ − Sᵢ；B、S为主动买入/卖出成交额（统一计价）',
  'Fᵢ* = ln(1 + Vᵢ / V̄ᵢ₋₁)，V̄为截至上一根的历史常态成交额',
  'Gᵢ* = 1 + α·|Dᵢ|/Vᵢ·1{Dᵢrᵢ > 0}，同向取1，否则取0',
  'Rᵢ* = rᵢ/sᵢ₋₁；rᵢ = ln(Eᵢ/Eᵢ₋₁)；Eᵢ = 成交额/成交数量（VWAP）',
  'sᵢ₋₁ = sqrt(EWMAᵢ₋₁(r²) + ε²)，仅用上一根及以前数据',
  'Ppeak = max(Cₜ₋ₘ,…,Cₜ)；DD = ln(Ppeak/Cₜ)/sₜ₋₁；DD > dmax 暂停认定为有效做多候选',
  '研究默认值（原图未定，尚需回测）：h=6小时，成交额基线24小时、r² EWMA半衰期24小时，α=1，ε=0.000001，m=12根，dmax=3。EWMA从首个有效r²起算；缺值或基线/48小时窗口未就绪留空。',
  '未触发失效不等于满足买入条件；读数不能直接解释为未来上涨概率。',
].join('\n');
const program = parseFormula(CBA2_FORMULA, new Set(['Q','B','S','E','C','T','hl','avgh']));
export interface Cba2Bar { closed?: boolean; time: number; close: number; volume?: number | null; quoteVolume?: number | null; takerBuyQuoteVolume?: number | null; }
export interface Cba2Point { cba2: number | null; dd: number | null; invalid: boolean | null; }
/** nowMs 可由回放时钟传入。截止时刻之前完全收盘的根才参与。 */
export function computeCba2(bars: readonly Cba2Bar[], params: Partial<Cba2Params> = {}, nowMs = Date.now()): Cba2Point[] {
  const p = { ...CBA2_DEFAULTS, ...params };
  if (!(p.halfLifeHours > 0 && p.normHours > 0 && p.alpha >= 0 && p.epsilon > 0 && Number.isInteger(p.m) && p.m >= 0 && p.dmax >= 0)) throw new Error('CBA-2 参数无效');
  const series = (f: (b: Cba2Bar) => number | null | undefined) => Float64Array.from(bars, b => b.closed !== false && b.time + 300000 <= nowMs ? f(b) ?? NaN : NaN);
  const Q = series(b => b.quoteVolume), B = series(b => b.takerBuyQuoteVolume);
  const inputs = { Q, B, S: Q.map((v,i) => v - B[i]), E: series(b => b.volume! > 0 ? b.quoteVolume! / b.volume! : NaN), C: series(b => b.close), T: series(b => b.time), hl: p.halfLifeHours, avgh: p.normHours };
  // 参数只替换标量赋值，公式主体与 Deep dig 共用。
  const custom = params.alpha != null || params.epsilon != null || params.m != null || params.dmax != null;
  const prog = custom ? parseFormula(CBA2_FORMULA.replace('alpha = 1', `alpha = ${p.alpha}`).replace('epsilon = 0.000001', `epsilon = ${p.epsilon}`).replace('m = 12', `m = ${p.m}`).replace('dmax = 3', `dmax = ${p.dmax}`), new Set(Object.keys(inputs))) : program;
  const out = evaluateProgramVars(prog, inputs, { barMinutes: 5 });
  const at = (v: Value | undefined, i: number): number | null => { const n = typeof v === 'number' ? v : v?.[i]; return n != null && Number.isFinite(n) ? n : null; };
  return bars.map((_, i) => ({ cba2: at(out.last,i), dd: at(out.vars.get('DD'),i), invalid: at(out.vars.get('invalid'),i) == null ? null : at(out.vars.get('invalid'),i) === 1 }));
}
