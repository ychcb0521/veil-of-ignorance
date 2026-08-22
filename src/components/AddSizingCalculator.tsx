import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTradingContext } from '@/contexts/TradingContext';
import { getCoinMarginedContractSizeUsd, getSettlementAsset } from '@/lib/coinMargined';
import {
  coinsToContracts,
  computeBankedAdd,
  computeCushionAdd,
  detectBankedMirrorProfit,
  pickHeldSide,
  type AddSide,
  type BankedKnob,
  type CushionAddResult,
} from '@/lib/addSizing';

/**
 * 加仓计算器 —— 使用说明 3.4 的公式做成可以按的东西。
 *
 * 界面只放数字：X₂ 与对冲量是主角，中间量降一级，价格阶梯把 S̄ / S₁ / S₂ 的几何画出来
 * （「S₁ 还在成本线下方所以没有垫子」这种情况一眼可见，不必读文字）。
 * 解释性文字一律留在使用说明 3.4，右上角那个近乎隐形的「?」给公式速览与跳转。
 */

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
}

const fmtCoins = (v: number, dp = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: dp }) : '—');
const fmtUsd = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const fmtPx = (v: number) => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(6));
const fmtPct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—');
const toNum = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : Number.NaN; };
const tidyPx = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(8))) : '');
const tidyCoins = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(4))) : '');

/** 无解时给一句带数字的诊断——说清缺什么、差多少，不写成一段话。 */
function cushionDiagnosis(r: CushionAddResult, side: AddSide): string {
  if (r.problem === 'invalid_input') return '填入 S̄ · S₁ · S₂ · X₁ 后计算';
  if (!r.needed) return '无法计算';
  const dir = r.needed.mustBe === 'above' ? '高于' : '低于';
  const what = r.problem === 's1_not_past_cost' ? '没有浮盈垫' : '新腿没有风险距离';
  return `${what}：${side === 'LONG' ? '主多' : '主空'}需 ${r.needed.field} ${dir} ${fmtPx(r.needed.threshold)}，还差 ${fmtPx(r.needed.gap)}`;
}

const BANKED_PROBLEM: Record<string, string> = {
  disabled: '填入 K_B 或 X₂ᴮ 后计算',
  kB_not_below_s2: 'K_B 需低于 S₂',
  kB_not_above_s2: 'K_B 需高于 S₂',
  x2_not_positive: 'X₂ᴮ 需大于 0',
  x2_not_above_g: 'X₂ᴮ 需大于 G',
};

export function AddSizingCalculator({ open, onClose, symbol }: Props) {
  const ctx = useTradingContext();
  const positions = ctx.positionsMap[symbol];
  const currentPrice = ctx.priceMap[symbol] ?? 0;
  const settlement = ctx.getSymbolSettlementMode(symbol);
  const isCoin = settlement === 'coin';
  const face = getCoinMarginedContractSizeUsd(symbol);
  const coinName = getSettlementAsset(symbol);

  const held = useMemo(() => pickHeldSide(symbol, positions, face), [symbol, positions, face]);

  const [side, setSide] = useState<AddSide>('LONG');
  const [sBar, setSBar] = useState('');
  const [s1, setS1] = useState('');
  const [s2, setS2] = useState('');
  const [x1, setX1] = useState('');
  const [g, setG] = useState('');
  const [knobKind, setKnobKind] = useState<BankedKnob['kind']>('line');
  const [kB, setKB] = useState('');
  const [x2B, setX2B] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);

  const seedRef = useRef({ held, currentPrice });
  seedRef.current = { held, currentPrice };
  useEffect(() => {
    if (!open) return;
    const { held: h, currentPrice: px } = seedRef.current;
    setSide(h?.side ?? 'LONG');
    setSBar(h ? tidyPx(h.avgEntry) : '');
    setX1(h ? tidyCoins(h.coins) : '');
    setS2(px > 0 ? tidyPx(px) : '');
    setS1(''); setG(''); setKnobKind('line'); setKB(''); setX2B(''); setHelpOpen(false);
  }, [open]);

  const cushion = useMemo(
    () => computeCushionAdd({ side, sBar: toNum(sBar), s1: toNum(s1), s2: toNum(s2), x1: toNum(x1) }),
    [side, sBar, s1, s2, x1],
  );

  const banked = useMemo(
    () => detectBankedMirrorProfit(symbol, side, ctx.tradeHistory, held?.earliestOpenTime ?? null),
    [symbol, side, ctx.tradeHistory, held?.earliestOpenTime],
  );
  const bankedSuggest = isCoin ? banked.coin : banked.usd;

  const effectiveKB = kB !== '' ? toNum(kB) : toNum(s1);
  const bankedRes = useMemo(() => {
    const knob: BankedKnob = knobKind === 'line' ? { kind: 'line', kB: effectiveKB } : { kind: 'size', x2: toNum(x2B) };
    return computeBankedAdd({ side, settlement, g: toNum(g), s2: toNum(s2), s1: toNum(s1), knob });
  }, [knobKind, effectiveKB, x2B, side, settlement, g, s2, s1]);
  const bankedOn = toNum(g) > 0;

  const contracts = (coins: number, price: number) =>
    isCoin && Number.isFinite(coins) && price > 0 ? `${coinsToContracts(coins, price, face).toLocaleString('en-US')} 张` : '';

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[660px]" data-testid="add-sizing-dialog">
        <DialogHeader className="space-y-0 border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-[14px] font-medium">加仓计算器</DialogTitle>
            <span className="font-mono text-[12px] text-muted-foreground">{symbol}</span>
            <button
              type="button"
              data-testid="add-sizing-help"
              aria-label="使用说明"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen(v => !v)}
              className="ml-auto h-5 w-5 shrink-0 rounded-full text-[11px] leading-5 text-muted-foreground/25 transition-colors hover:bg-accent hover:text-foreground"
            >
              ?
            </button>
          </div>
        </DialogHeader>

        {helpOpen && (
          <div data-testid="add-sizing-help-panel" className="border-b border-border bg-muted/30 px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
            <div className="font-mono text-foreground">X₁ (S₁ − S̄) = X₂ (S₂ − S₁)</div>
            <div className="mt-0.5 font-mono">X₂ = X₁ ÷ b　·　b = (S₂ − S₁)/(S₁ − S̄)　·　1/(1+b) = P₀　·　对冲 = X₁ + X₂ @ S₁</div>
            <div className="mt-0.5 font-mono">B 腿：X₂ᴮ 从 S₂ 跌到 K_B 恰好亏掉已落袋的 G</div>
            <Link to="/guide#s3-1c" className="mt-1.5 inline-block text-[#5BA3FF] hover:underline">完整说明 · 使用说明 3.4 →</Link>
          </div>
        )}

        <div className="space-y-5 px-5 py-4">
          {/* 方向 + 盘面 */}
          <div className="flex items-center gap-1 text-[11px]">
            {(['LONG', 'SHORT'] as AddSide[]).map(v => (
              <button
                key={v}
                type="button"
                data-testid={`add-sizing-side-${v}`}
                onClick={() => setSide(v)}
                className={`rounded px-2.5 py-1 font-medium transition-colors ${
                  side === v
                    ? (v === 'LONG' ? 'bg-trading-green/15 text-trading-green' : 'bg-trading-red/15 text-trading-red')
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {v === 'LONG' ? '主多' : '主空'}
              </button>
            ))}
            {held && (
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                盘面 {held.legCount} 笔 · {fmtUsd(held.notionalUsd)} USD
              </span>
            )}
          </div>

          {/* 输入：按价格阶梯顺序 S̄ → S₁ → S₂，X₁ 殿后 */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="S̄ 开仓均价" value={sBar} onChange={setSBar} testId="add-sizing-sbar"
              onReset={held ? () => setSBar(tidyPx(held.avgEntry)) : undefined} />
            <Field label="S₁ 止损线" value={s1} onChange={setS1} testId="add-sizing-s1" accent />
            <Field label="S₂ 加仓价" value={s2} onChange={setS2} testId="add-sizing-s2"
              onReset={currentPrice > 0 ? () => setS2(tidyPx(currentPrice)) : undefined} />
            <Field label={`X₁ 既有 ${coinName}`} value={x1} onChange={setX1} testId="add-sizing-x1"
              onReset={held ? () => setX1(tidyCoins(held.coins)) : undefined} />
          </div>

          <PriceLadder side={side} sBar={toNum(sBar)} s1={toNum(s1)} s2={toNum(s2)} result={cushion} />

          {/* A 本账 */}
          <section data-testid="add-sizing-cushion" className="space-y-3">
            <SectionLabel title="A 浮盈垫" note="锁死" />
            {!cushion.ok ? (
              <p data-testid="add-sizing-cushion-problem" className="rounded bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
                {cushionDiagnosis(cushion, side)}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Hero
                    testId="add-sizing-x2"
                    label="加仓上限 X₂"
                    value={fmtCoins(cushion.x2Max)}
                    unit={coinName}
                    sub={`${fmtUsd(cushion.x2MaxNotional)} USD${isCoin ? ` · ${contracts(cushion.x2Max, toNum(s2))}` : ''}`}
                    tone="primary"
                  />
                  <Hero
                    testId="add-sizing-hedge"
                    label={`对冲 @ S₁　${side === 'LONG' ? '空' : '多'}`}
                    value={fmtCoins(cushion.hedgeCoinsAtS1)}
                    unit={coinName}
                    sub={`${fmtUsd(cushion.hedgeNotionalAtS1)} USD${isCoin ? ` · ${contracts(cushion.hedgeCoinsAtS1, toNum(s1))}` : ''}`}
                  />
                </div>
                <MetaRow items={[
                  ['浮盈垫', `${fmtUsd(cushion.cushion)} USD`],
                  ['b', cushion.b.toFixed(4)],
                  ['P₀', fmtPct(cushion.p0)],
                  ['加仓后均价', fmtPx(cushion.blendedCostAfter)],
                ]} />
              </>
            )}
          </section>

          {/* B 本账 */}
          <section data-testid="add-sizing-banked" className="space-y-3 border-t border-border pt-4">
            <SectionLabel title="B 落袋镜像" note="可选 · 允许敞口" />
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <div className="w-[150px]">
                <Field label={`G 已落袋 ${isCoin ? coinName : 'USD'}`} value={g} onChange={setG} testId="add-sizing-g" />
              </div>
              {bankedSuggest > 0 && (
                <button
                  type="button"
                  data-testid="add-sizing-fill-banked"
                  onClick={() => setG(isCoin ? tidyCoins(bankedSuggest) : String(Number(bankedSuggest.toFixed(2))))}
                  className="mb-0.5 rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  本场止盈 +{isCoin ? fmtCoins(bankedSuggest, 4) : fmtUsd(bankedSuggest)}（{banked.count} 笔）
                </button>
              )}
              {bankedOn && (
                <div className="mb-0.5 flex items-center gap-1 text-[11px]">
                  {(['line', 'size'] as BankedKnob['kind'][]).map(k => (
                    <button
                      key={k}
                      type="button"
                      data-testid={`add-sizing-knob-${k}`}
                      onClick={() => setKnobKind(k)}
                      className={`rounded px-2 py-1 transition-colors ${knobKind === k ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                    >
                      {k === 'line' ? '定线' : '定仓'}
                    </button>
                  ))}
                </div>
              )}
              {bankedOn && (
                <div className="w-[150px]">
                  {knobKind === 'line'
                    ? <Field label="K_B 零风险线" value={kB} onChange={setKB} testId="add-sizing-kb" placeholder={s1 || 'S₁'} onReset={() => setKB('')} accent />
                    : <Field label={`X₂ᴮ ${coinName}`} value={x2B} onChange={setX2B} testId="add-sizing-x2b" accent />}
                </div>
              )}
            </div>

            {!bankedOn ? (
              <p data-testid="add-sizing-banked-off" className="text-[11px] text-muted-foreground">
                未填 G，本账关闭
              </p>
            ) : !bankedRes.ok ? (
              <p data-testid="add-sizing-banked-problem" className="rounded bg-muted/40 px-3 py-2.5 text-[11px] text-muted-foreground">
                {BANKED_PROBLEM[bankedRes.problem ?? 'disabled']}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Hero
                    testId="add-sizing-x2b-out"
                    label="B 腿 X₂ᴮ"
                    value={fmtCoins(bankedRes.x2)}
                    unit={coinName}
                    sub={`${fmtUsd(bankedRes.x2Notional)} USD${isCoin ? ` · ${contracts(bankedRes.x2, toNum(s2))}` : ''}`}
                    tone="primary"
                  />
                  <Hero
                    testId="add-sizing-kb-out"
                    label="K_B 零风险线"
                    value={fmtPx(bankedRes.kB)}
                    sub={bankedRes.kBBeyondS1 ? '已越过 S₁' : '不低于 S₁'}
                  />
                </div>
                <MetaRow items={[
                  ['S₁ 处吃掉落袋', `${isCoin ? fmtCoins(bankedRes.consumedAtS1, 4) : fmtUsd(bankedRes.consumedAtS1)} · 敞口 ${fmtPct(bankedRes.exposureAtS1)}`, bankedRes.exposureAtS1 > 1],
                  ['剩余', isCoin ? fmtCoins(bankedRes.residualAtS1, 4) : fmtUsd(bankedRes.residualAtS1)],
                  ...(cushion.ok
                    ? [['合计加仓', `${fmtCoins(cushion.x2Max + bankedRes.x2)} ${coinName}　A ${fmtCoins(cushion.x2Max)} + B ${fmtCoins(bankedRes.x2)}`, false, 'add-sizing-total-add'] as const]
                    : []),
                ] as Array<readonly [string, string, boolean?, string?]>} />
              </>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 价格阶梯：把 S̄ / S₁ / S₂ 三点按比例画在一条轴上，垫子段与风险段分色。 */
function PriceLadder({ side, sBar, s1, s2, result }: {
  side: AddSide; sBar: number; s1: number; s2: number; result: CushionAddResult;
}) {
  const all = [sBar, s1, s2].filter(v => Number.isFinite(v) && v > 0);
  if (all.length < 3) return <div className="h-[46px]" aria-hidden />;
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo;
  if (!(span > 0)) return <div className="h-[46px]" aria-hidden />;
  // 主多向右为盈利方向；主空翻转，让「垫子在左、风险在右」的读法保持一致
  const pos = (p: number) => ((side === 'LONG' ? p - lo : hi - p) / span) * 100;
  const pB = pos(sBar);
  const p1 = pos(s1);
  const p2 = pos(s2);
  const seg = (a: number, b: number) => ({ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` });

  const mid = (a: number, b: number) => (a + b) / 2;

  return (
    // 左右留出 14px：两端的刻度用 -translate-x-1/2 居中，贴边会被裁掉一半
    <div className="relative h-[44px] px-3.5" data-testid="add-sizing-ladder">
      <div className="relative h-full">
        <div className="absolute inset-x-0 top-[11px] h-[3px] rounded-full bg-muted" />
        {result.ok && <div className="absolute top-[11px] h-[3px] rounded-full bg-trading-green/50" style={seg(pB, p1)} />}
        {result.ok && <div className="absolute top-[11px] h-[3px] rounded-full bg-primary/50" style={seg(p1, p2)} />}
        {([['S̄', pB, false], ['S₁', p1, true], ['S₂', p2, false]] as const).map(([label, p, accent]) => (
          <div key={label} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${p}%` }}>
            <div className={`mx-auto h-[8px] w-[2px] rounded-full ${accent ? 'bg-foreground' : 'bg-muted-foreground/50'}`} />
            <div className={`mt-[8px] text-[10px] leading-none ${accent ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</div>
          </div>
        ))}
        {/* 距离标注落在各自线段的中点下方，而不是挤在两端 */}
        {result.ok && ([
          ['垫', result.cushionDistance, mid(pB, p1)],
          ['险', result.riskDistance, mid(p1, p2)],
        ] as const).map(([tag, dist, at]) => (
          <div key={tag} className="absolute top-[30px] -translate-x-1/2 whitespace-nowrap font-mono text-[9px] text-muted-foreground" style={{ left: `${at}%` }}>
            {tag} {fmtPx(dist)}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-[11px] font-medium tracking-wide text-foreground">{title}</h3>
      <span className="text-[10px] text-muted-foreground">{note}</span>
    </div>
  );
}

function Hero({ label, value, unit, sub, tone, testId }: {
  label: string; value: string; unit?: string; sub?: string; tone?: 'primary'; testId: string;
}) {
  return (
    <div data-testid={testId} className="rounded-md bg-muted/40 px-3.5 py-3">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-[20px] font-semibold leading-none tabular-nums ${tone === 'primary' ? 'text-primary' : 'text-foreground'}`}>
        {value}
        {unit && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 font-mono text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function MetaRow({ items }: { items: Array<readonly [string, string, boolean?, string?]> }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1.5">
      {items.map(([label, value, warn, testId]) => (
        <div key={label} data-testid={testId} className="text-[10px]">
          <span className="text-muted-foreground">{label} </span>
          <span className={`font-mono tabular-nums ${warn ? 'text-trading-red' : 'text-foreground'}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, testId, onReset, accent, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; testId: string;
  onReset?: () => void; accent?: boolean; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <span className="truncate">{label}</span>
        {onReset && (
          <button type="button" aria-label={`${label} 复位`} onClick={onReset}
            className="ml-auto shrink-0 rounded p-0.5 opacity-50 transition-opacity hover:opacity-100">
            <RotateCcw className="h-2.5 w-2.5" />
          </button>
        )}
      </span>
      <input
        data-testid={testId}
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`mt-1 h-8 w-full rounded border bg-secondary px-2 font-mono text-[12px] tabular-nums text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary/40 ${
          accent ? 'border-primary/40' : 'border-border'
        }`}
      />
    </label>
  );
}
