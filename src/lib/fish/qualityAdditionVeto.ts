/**
 * 【用户要求】2026-11-02 加仓否决（不再加仓）：持仓期间已出现明显长上影线、向下大插针、进入高震荡、冲高回落未收复时，
 * 新 C 出现也不加——ONTUSDT 第 3 次、STRKUSDT 第 2、3 次加仓都加在这类形态之后，扫损成了必然。
 * 只看加仓那一刻已收盘的 5 分钟 K 线；ATR 为 5 分钟 ATR(14)（Wilder，与加仓 K 同一序列）。任一条成立即这次不加，继续等下一个新 C。
 */
export type AdditionEntryVetoKind = 'upper-wick' | 'lower-spike' | 'volatility' | 'pullback' | 'pullback-atr' | 'fast-drop';
/** 持仓期间急跌：任意 minutes 分钟内跌幅 ≥ pct%（与硬性终止「N 分钟内跌幅」同口径：窗口首根开盘 → 末根收盘）。 */
export interface FastDropWindow { minutes: number; pct: number }
export interface QualityAdditionEntryVeto {
  kind: AdditionEntryVetoKind; enabled: boolean;
  /** 回看根数（5 分钟）：长上影线 / 下插针。 */
  lookbackBars?: number;
  /** ATR 倍数：上影 / 下影长度、冲高回落幅度。 */
  atr?: number;
  /** 上影占整根振幅的最小比例（%）；高震荡：ATR 相对 6 小时中位数的倍数。 */
  ratio?: number;
  /** 下插针：最低价低于前一根收盘的百分比。 */
  pct?: number;
  /** 高震荡：效率比 ER(24) 上限（来回多、净涨少）。 */
  er?: number;
  /** 持仓期间急跌：几组「N 分钟内跌 ≥ X%」，任一组曾出现即否决。 */
  windows?: FastDropWindow[];
  /** 【用户要求】2026-11-02 冲高回落：ATR 倍数与回落百分比（pct）都填时的组合方式，默认「且」。 */
  join?: 'and' | 'or';
  /** 【用户要求】2026-11-03 冲高回落（含仅 ATR）：触发后锁住——收复当时的持仓最高点（5 分钟收盘 ≥ 该价）之前，之后的新 C 都不加仓。 */
  sticky?: boolean;
}
export const ADDITION_VETO_DEFAULTS: Record<AdditionEntryVetoKind, QualityAdditionEntryVeto> = {
  'upper-wick': { kind: 'upper-wick', enabled: false, lookbackBars: 12, atr: 1.5, ratio: 60 },
  'lower-spike': { kind: 'lower-spike', enabled: false, lookbackBars: 12, atr: 2, pct: 3 },
  volatility: { kind: 'volatility', enabled: false, ratio: 1.8, er: .25 },
  // 【用户要求】2026-11-03 默认值按「组合算法1」44 场回放定：回落 ≥2.5 ATR 且 ≥4% 只改善不伤大单（单用 2.5 ATR 会把 SAPIEN +3936 砍到 +533）；可修改
  pullback: { kind: 'pullback', enabled: false, atr: 2.5, pct: 4, join: 'and' },
  // 【用户要求】2026-11-03 另设一条「冲高回落 · 仅 ATR」：回放里胜率明显更高（但会砍掉 SAPIEN 这类大单），与上一条各自勾选
  'pullback-atr': { kind: 'pullback-atr', enabled: false, atr: 2.5 },
  // 【用户要求】2026-11-02 持仓期间曾出现任意 1 分钟跌超 5%、5 分钟超 7%、10 分钟超 10% 等，就不再加仓（PENGU 第 3 次加仓前那根长红线）
  'fast-drop': { kind: 'fast-drop', enabled: false, windows: [{ minutes: 1, pct: 5 }, { minutes: 5, pct: 7 }, { minutes: 10, pct: 10 }] },
};
export const ADDITION_VETO_KINDS = Object.keys(ADDITION_VETO_DEFAULTS) as AdditionEntryVetoKind[];
export const ADDITION_VETO_LABELS: Record<AdditionEntryVetoKind, string> = { 'upper-wick': '长上影线', 'lower-spike': '向下大插针', volatility: '高震荡', pullback: '冲高回落', 'pullback-atr': '冲高回落·仅ATR', 'fast-drop': '持仓期间急跌' };
export const activeAdditionVetoes = (vetoes?: readonly QualityAdditionEntryVeto[]) => (vetoes ?? []).filter(v => v.enabled);
export function additionVetoLabel(v: QualityAdditionEntryVeto): string {
  return baseVetoLabel(v) + ((v.kind === 'pullback' || v.kind === 'pullback-atr') && v.sticky ? '，未收复最高点前不再加仓' : '');
}
function baseVetoLabel(v: QualityAdditionEntryVeto): string {
  const d = { ...ADDITION_VETO_DEFAULTS[v.kind], ...v };
  return v.kind === 'upper-wick' ? `长上影线：近 ${d.lookbackBars} 根内上影 ≥ ${d.atr} ATR 且占整根 ≥ ${d.ratio}%`
    : v.kind === 'lower-spike' ? `向下大插针：近 ${d.lookbackBars} 根内下影 ≥ ${d.atr} ATR 或低于前收 ≥ ${d.pct}%`
      : v.kind === 'volatility' ? `高震荡：ATR ≥ 6 小时中位 ${d.ratio} 倍 或 ER(24) ≤ ${d.er}`
        : v.kind === 'pullback-atr' ? `冲高回落（仅 ATR）：距持仓最高点回落 ≥ ${d.atr} ATR`
        : v.kind === 'fast-drop' ? `持仓期间急跌：${(d.windows ?? []).map(w => `${w.minutes} 分钟内跌 ≥ ${w.pct}%`).join(' 或 ')}`
        : `冲高回落：距持仓最高点回落 ${pullbackText(pullbackParams(v))}`;
}
/** 冲高回落实际用的门槛：ATR 与百分比都没填（旧数据）时沿用默认 2 ATR；填了哪个就只用哪个，不再补默认值。 */
/** 早期只存了开关、没存门槛的冲高回落按当时的 2 ATR 读，默认值改了也不影响旧方案。 */
const LEGACY_PULLBACK_ATR = 2;
export const pullbackParams = (raw: QualityAdditionEntryVeto): QualityAdditionEntryVeto => raw.atr == null && raw.pct == null ? { ...raw, atr: LEGACY_PULLBACK_ATR } : { ...raw, join: raw.atr != null && raw.pct != null ? raw.join ?? 'and' : undefined };
/** 冲高回落的门槛文字：≥ a ATR、≥ x%，或两者「且 / 或」。 */
const pullbackText = (d: QualityAdditionEntryVeto) => [d.atr != null ? `≥ ${d.atr} ATR` : '', d.pct != null ? `≥ ${d.pct}%` : ''].filter(Boolean).join(d.join === 'or' ? ' 或 ' : ' 且 ');
export function validateAdditionVetoes(vetoes?: readonly QualityAdditionEntryVeto[]) {
  for (const v of activeAdditionVetoes(vetoes)) {
    if (!ADDITION_VETO_KINDS.includes(v.kind)) throw new Error('加仓否决条件类型无效');
    const d = { ...ADDITION_VETO_DEFAULTS[v.kind], ...v }, bad = (x: number | undefined, lo: number, hi: number) => x == null || !Number.isFinite(x) || x < lo || x > hi;
    if ((v.kind === 'upper-wick' || v.kind === 'lower-spike') && (bad(d.lookbackBars, 1, 288) || !Number.isInteger(d.lookbackBars))) throw new Error(`${ADDITION_VETO_LABELS[v.kind]}：回看根数须为 1–288 的整数`);
    if (v.kind === 'fast-drop') { if (!d.windows?.length) throw new Error('持仓期间急跌：至少填一组「N 分钟内跌幅」'); for (const w of d.windows) if (bad(w.minutes, 1, 240) || !Number.isInteger(w.minutes) || bad(w.pct, 0, 100)) throw new Error('持仓期间急跌：分钟须为 1–240 的整数，跌幅须为 0–100%'); continue; }
    if (v.kind === 'pullback') {
      const d = pullbackParams(v);
      if (d.atr == null && d.pct == null) throw new Error('冲高回落：ATR 倍数与回落百分比至少填一项');
      if (d.atr != null && bad(d.atr, 0, 50)) throw new Error('冲高回落：ATR 倍数须为 0–50 的数字');
      if (d.pct != null && bad(d.pct, 0, 100)) throw new Error('冲高回落：回落百分比须为 0–100%');
      if (d.join != null && d.join !== 'and' && d.join !== 'or') throw new Error('冲高回落：组合方式无效');
      continue;
    }
    if (v.kind !== 'volatility' && bad(d.atr, 0, 50)) throw new Error(`${ADDITION_VETO_LABELS[v.kind]}：ATR 倍数须为 0–50 的数字`);
    if (v.kind === 'upper-wick' && bad(d.ratio, 0, 100)) throw new Error('长上影线：上影占比须为 0–100%');
    if (v.kind === 'lower-spike' && bad(d.pct, 0, 100)) throw new Error('向下大插针：跌幅须为 0–100%');
    if (v.kind === 'volatility' && (bad(d.ratio, 0, 50) || bad(d.er, 0, 1))) throw new Error('高震荡：ATR 倍数须为 0–50，效率比须为 0–1');
  }
}
export const additionVetoIdentity = (vetoes?: readonly QualityAdditionEntryVeto[]) => activeAdditionVetoes(vetoes).map(v => { const d = v.kind === 'pullback' ? pullbackParams(v) : { ...ADDITION_VETO_DEFAULTS[v.kind], ...v }; return [d.kind, d.lookbackBars ?? null, d.atr ?? null, d.ratio ?? null, d.pct ?? null, d.er ?? null, ...(d.kind === 'fast-drop' ? [(d.windows ?? []).map(w => [w.minutes, w.pct])] : []), ...(d.kind === 'pullback' && d.pct != null ? ['pullback-pct-v1', d.join ?? null] : []), ...((d.kind === 'pullback' || d.kind === 'pullback-atr') && v.sticky ? ['pullback-sticky-v1'] : [])]; }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

export interface VetoBar { openTime: number; open: number; high: number; low: number; close: number }
export interface AdditionVetoHit { kind: AdditionEntryVetoKind; label: string; reading: string;
  /** 冲高回落勾选了「未收复前不再加」时：要收复的持仓最高点。 */
  lockPeak?: number }
/**
 * bars / atr：截至决策时刻（含）已收盘的 5 分钟 K 线与对应 ATR，按时间升序；entry：首次买入时间（冲高回落从这里起算最高点）。
 */
/** 判断是否需要 1 分钟线（只有「持仓期间急跌」要）。 */
export const additionVetoesNeedMinutes = (vetoes?: readonly QualityAdditionEntryVeto[]) => activeAdditionVetoes(vetoes).some(v => v.kind === 'fast-drop');
/**
 * 持仓期间急跌：买入后每个整分钟往前看 N 分钟（窗口须完整、连续），首根开盘 → 末根收盘跌幅 ≥ X% 即命中。minutes：买入至决策时刻的 1 分钟线（升序）。
 */
export function fastDropHit(windows: readonly FastDropWindow[], minutes: readonly VetoBar[], entry: number): { window: FastDropWindow; at: number; drop: number } | undefined {
  const M = 60000, first = minutes.findIndex(b => b.openTime >= entry);
  if (first < 0) return;
  for (const w of windows) {
    for (let end = first + w.minutes - 1; end < minutes.length; end++) {
      const start = end - w.minutes + 1, a = minutes[start], b = minutes[end];
      if (a.openTime < entry || b.openTime - a.openTime !== (w.minutes - 1) * M || !(a.open > 0)) continue;
      const drop = (a.open - b.close) / a.open * 100;
      if (drop >= w.pct - 1e-9) return { window: w, at: a.openTime, drop };
    }
  }
}
export function evaluateAdditionVetoes(vetoes: readonly QualityAdditionEntryVeto[] | undefined, bars: readonly VetoBar[], atr: readonly number[], entry: number, minutes?: readonly VetoBar[]): AdditionVetoHit | undefined {
  const active = activeAdditionVetoes(vetoes), n = bars.length;
  if (!active.length || !n) return;
  const A = atr[n - 1], last = bars[n - 1];
  if (!(A > 0) || !Number.isFinite(A)) return;
  const fmt = (x: number) => +x.toFixed(2);
  for (const raw of active) {
    const v = { ...ADDITION_VETO_DEFAULTS[raw.kind], ...raw };
    if (v.kind === 'upper-wick') {
      for (let i = Math.max(0, n - v.lookbackBars!); i < n; i++) { const b = bars[i], range = b.high - b.low, up = b.high - Math.max(b.open, b.close);
        if (range > 0 && up >= v.atr! * A && up / range * 100 >= v.ratio!) return { kind: v.kind, label: additionVetoLabel(v), reading: `${fmtTime(b.openTime)} 上影 ${fmt(up / A)} ATR，占整根 ${Math.round(up / range * 100)}%` }; }
    } else if (v.kind === 'lower-spike') {
      for (let i = Math.max(1, n - v.lookbackBars!); i < n; i++) { const b = bars[i], prev = bars[i - 1].close, down = Math.min(b.open, b.close) - b.low, drop = (prev - b.low) / prev * 100;
        if (down >= v.atr! * A || drop >= v.pct!) return { kind: v.kind, label: additionVetoLabel(v), reading: `${fmtTime(b.openTime)} 下影 ${fmt(down / A)} ATR，低于前收 ${fmt(drop)}%` }; }
    } else if (v.kind === 'volatility') {
      const recent = atr.slice(Math.max(0, n - 72)).filter(x => x > 0).sort((a, b) => a - b), median = recent[Math.floor(recent.length / 2)];
      const ratio = median > 0 ? A / median : NaN;
      let er = NaN; if (n > 24) { let path = 0; for (let i = n - 24; i < n; i++) path += Math.abs(bars[i].close - bars[i - 1].close); er = path > 0 ? Math.abs(last.close - bars[n - 25].close) / path : NaN; }
      if (ratio >= v.ratio! || er <= v.er!) return { kind: v.kind, label: additionVetoLabel(v), reading: `ATR 为 6 小时中位 ${fmt(ratio)} 倍，ER(24) ${fmt(er)}` };
    } else if (v.kind === 'fast-drop') {
      const hit = minutes ? fastDropHit(v.windows ?? [], minutes, entry) : undefined;
      if (hit) return { kind: v.kind, label: additionVetoLabel(v), reading: `${fmtTime(hit.at)} 起 ${hit.window.minutes} 分钟内跌 ${fmt(hit.drop)}%` };
    } else if (v.kind === 'pullback-atr') {
      let peak = -Infinity; for (const b of bars) if (b.openTime >= entry) peak = Math.max(peak, b.high);
      const back = (peak - last.close) / A;
      if (Number.isFinite(back) && back >= v.atr!) return { kind: v.kind, label: additionVetoLabel(v), reading: `距持仓最高 ${+peak.toPrecision(8)} 回落 ${fmt(back)} ATR（${fmt((peak - last.close) / peak * 100)}%）`, ...(raw.sticky ? { lockPeak: peak } : {}) };
    } else {
      let peak = -Infinity; for (const b of bars) if (b.openTime >= entry) peak = Math.max(peak, b.high);
      const back = (peak - last.close) / A, backPct = (peak - last.close) / peak * 100;
      if (!Number.isFinite(back) || !Number.isFinite(backPct)) continue;
      const p = pullbackParams(raw), byAtr = p.atr != null ? back >= p.atr : undefined, byPct = p.pct != null ? backPct >= p.pct - 1e-9 : undefined;
      const hit = byAtr != null && byPct != null ? (p.join === 'or' ? byAtr || byPct : byAtr && byPct) : (byAtr ?? byPct)!;
      if (hit) return { kind: v.kind, label: additionVetoLabel(raw), reading: `距持仓最高 ${+peak.toPrecision(8)} 回落 ${fmt(back)} ATR（${fmt(backPct)}%）`, ...(raw.sticky ? { lockPeak: peak } : {}) };
    }
  }
}
const fmtTime = (t: number) => new Date(t + 8 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
