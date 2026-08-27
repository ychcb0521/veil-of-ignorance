import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTradingContext } from '@/contexts/TradingContext';
import { getCoinMarginedContractSizeUsd, getSettlementAsset } from '@/lib/coinMargined';
import {
  PRE_MAIN_LOOKBACK_MS,
  evaluateS1Deviation,
  readHedgeLines,
  sameLine,
} from '@/lib/hedgeLines';
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
 * 界面只放数字：X₂ 与对冲量是主角，中间量降成一行芯片，价格阶梯把 S̄ / S₁ / S₂ 的几何画出来。
 * 阶梯**不看有没有解**：三个价格齐了就画，方向反了的那一段标红——「S₁ 还在成本线亏损侧」
 * 因此一眼可见，不必读文字。解释性文字一律留在使用说明 3.4，右上角近乎隐形的「?」给公式速览。
 */

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: string;
  /**
   * 实时现价（Index 的 displayCurrentPrice）。不能读 ctx.priceMap ——
   * 那是 usePersistedState('price_map') 的持久化行情缓存，会留着上一段回放的陈旧价，
   * 于是 S₂ 被预填成完全不相干的数（实测 0.6273 vs 真实 0.012804）。
   * 全 app 的面板拿的都是这个实时值，计算器也必须同源。
   */
  currentPrice?: number;
}

const fmtCoins = (v: number, dp = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: dp }) : '—');
const fmtUsd = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const fmtPx = (v: number) => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(6));
const fmtPct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—');
const toNum = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : Number.NaN; };
const tidyPx = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(8))) : '');
const tidyCoins = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(4))) : '');

/**
 * 无解分两档，不能混为一谈：
 *   还没填全 → 中性，这不是错误；
 *   条件违反 → 告警，并给出「差多少」这个能行动的数。
 */
function cushionNote(r: CushionAddResult, side: AddSide): { text: string; violation: boolean } {
  if (r.problem === 'invalid_input') return { text: '填入 S̄ · S₁ · S₂ · X₁ 后计算', violation: false };
  if (!r.needed) return { text: '无法计算', violation: true };
  const dir = r.needed.mustBe === 'above' ? '高于' : '低于';
  const what = r.problem === 's1_not_past_cost' ? '没有浮盈垫' : '新腿没有风险距离';
  return {
    text: `${what} · ${side === 'LONG' ? '主多' : '主空'}需 ${r.needed.field} ${dir} ${fmtPx(r.needed.threshold)}，还差 ${fmtPx(r.needed.gap)}`,
    violation: true,
  };
}

const BANKED_PROBLEM: Record<string, string> = {
  disabled: '填入 K_B 或 X₂ᴮ 后计算',
  kB_not_below_s2: 'K_B 需低于 S₂',
  kB_not_above_s2: 'K_B 需高于 S₂',
  x2_not_positive: 'X₂ᴮ 需大于 0',
  x2_not_above_g: 'X₂ᴮ 需大于 G',
};

export function AddSizingCalculator({ open, onClose, symbol, currentPrice = 0 }: Props) {
  const ctx = useTradingContext();
  const positions = ctx.positionsMap[symbol];
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
  const [sideOpen, setSideOpen] = useState(false);

  const seedRef = useRef({ held, currentPrice });
  seedRef.current = { held, currentPrice };
  useEffect(() => {
    if (!open) return;
    const { held: h, currentPrice: px } = seedRef.current;
    setSide(h?.side ?? 'LONG');
    setSBar(h ? tidyPx(h.avgEntry) : '');
    setX1(h ? tidyCoins(h.coins) : '');
    setS2(px > 0 ? tidyPx(px) : '');
    setS1(''); setG(''); setKnobKind('line'); setKB(''); setX2B(''); setHelpOpen(false); setSideOpen(false);
  }, [open]);

  const cushion = useMemo(
    () => computeCushionAdd({ side, sBar: toNum(sBar), s1: toNum(s1), s2: toNum(s2), x1: toNum(x1) }),
    [side, sBar, s1, s2, x1],
  );
  const note = cushionNote(cushion, side);

  const banked = useMemo(
    () => detectBankedMirrorProfit(symbol, side, ctx.tradeHistory, held?.earliestOpenTime ?? null),
    [symbol, side, ctx.tradeHistory, held?.earliestOpenTime],
  );
  const bankedSuggest = isCoin ? banked.coin : banked.usd;

  /**
   * 盘口上真实挂着的对冲线。整套「锁死」的前提是 S₁ 就是这条线——
   * 此前计算器读不到 ordersMap，两者可以静默地不是同一个数：
   * 实测填 0.114572 而盘口挂 0.114401，差 0.149%，加仓量因此超 9.1%，
   * 到线那一刻净值 −3,247 而不是设计的 0。
   * 只产出候选、不预填也不锁定：系统分不出「对冲单」和「试单/遗留单」的意图，
   * 用一个可能错的值去占住用户唯一需要判断的输入，是让确定性最低的一方拿走决定权。
   */
  const hedgeRead = useMemo(() => readHedgeLines(
    symbol, ctx.ordersMap, positions, side,
    (held?.earliestOpenTime ?? 0) - PRE_MAIN_LOOKBACK_MS,
    isCoin ? 'coin' : 'usdt', face,
  ), [symbol, ctx.ordersMap, positions, side, held?.earliestOpenTime, isCoin, face]);

  const bookLine = hedgeRead.candidates[0] ?? null;
  const s1Deviation = useMemo(() => {
    if (!bookLine || !cushion.ok) return null;
    if (sameLine(bookLine.price, toNum(s1))) return null;
    return evaluateS1Deviation({
      side, sBar: toNum(sBar), s1: toNum(s1), s2: toNum(s2),
      x1: toNum(x1), g: Math.max(0, toNum(g)), bookPrice: bookLine.price,
      settlement: isCoin ? 'coin' : 'usdt',
    });
  }, [bookLine, cushion.ok, side, sBar, s1, s2, x1, g, isCoin]);

  const effectiveKB = kB !== '' ? toNum(kB) : toNum(s1);
  const bankedRes = useMemo(() => {
    const knob: BankedKnob = knobKind === 'line' ? { kind: 'line', kB: effectiveKB } : { kind: 'size', x2: toNum(x2B) };
    return computeBankedAdd({ side, settlement, g: toNum(g), s2: toNum(s2), s1: toNum(s1), knob });
  }, [knobKind, effectiveKB, x2B, side, settlement, g, s2, s1]);
  const bankedOn = toNum(g) > 0;

  const contracts = (coins: number, price: number) =>
    isCoin && Number.isFinite(coins) && price > 0 ? ` · ${coinsToContracts(coins, price, face).toLocaleString('en-US')} 张` : '';

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[600px]" data-testid="add-sizing-dialog">
        {/* pr-14 给右上角的关闭 × 让位——ml-auto 的「?」会和它叠在一起 */}
        <DialogHeader className="space-y-0 border-b border-border py-2.5 pl-4 pr-14">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-[13px] font-medium">加仓计算器</DialogTitle>
            <span className="font-mono text-[11px] text-muted-foreground">{symbol}</span>
            <button
              type="button"
              data-testid="add-sizing-help"
              aria-label="使用说明"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen(v => !v)}
              className="ml-auto h-4 w-4 shrink-0 rounded-full text-[10px] leading-4 text-muted-foreground/25 transition-colors hover:bg-accent hover:text-foreground"
            >
              ?
            </button>
          </div>
        </DialogHeader>

        {helpOpen && (
          <div data-testid="add-sizing-help-panel" className="border-b border-border bg-muted/30 px-4 py-2.5 font-mono text-[10px] leading-[1.7] text-muted-foreground">
            <div className="text-foreground">加仓量 = 垫 ÷ 险　险 = S₂ − S₁</div>
            <div>A 浮盈垫 Y₁ = X₁(S₁−S̄)　→　X₂ = Y₁ ÷ 险 = X₁ ÷ b　b = 险 / (S₁−S̄)</div>
            <div className="font-sans">此处的 b 往回看（成本线 → 止损线 → 现价），与盘面 P_gap 的 b（现价 → 目标）无关</div>
            <div>B 落袋垫 Y_G = G　　　　 →　X_G = Y_G ÷ 险</div>
            <div>对冲 @ S₁ = X₁ + X₂ (+ X_G)</div>
            <Link to="/guide#s3-1c" className="mt-1 inline-block font-sans text-primary hover:underline">完整说明 · 使用说明 3.4 →</Link>
          </div>
        )}

        <div className="space-y-3 px-4 py-3">
          {/* 方向 + 盘面。方向默认由持仓推定，几乎不用改——
              所以收成一个小字，点开才露出另一个选项，不占常驻视觉分量。 */}
          <div className="flex items-center gap-1">
            {sideOpen ? (
              (['LONG', 'SHORT'] as AddSide[]).map(v => (
                <button
                  key={v}
                  type="button"
                  data-testid={`add-sizing-side-${v}`}
                  onClick={() => { setSide(v); setSideOpen(false); }}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    side === v
                      ? (v === 'LONG' ? 'bg-trading-green/15 text-trading-green' : 'bg-trading-red/15 text-trading-red')
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {v === 'LONG' ? '主多' : '主空'}
                </button>
              ))
            ) : (
              <button
                type="button"
                data-testid="add-sizing-side-toggle"
                onClick={() => setSideOpen(true)}
                title="切换方向"
                className={`rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent ${
                  side === 'LONG' ? 'text-trading-green/60 hover:text-trading-green' : 'text-trading-red/60 hover:text-trading-red'
                }`}
              >
                {side === 'LONG' ? '主多' : '主空'}
              </button>
            )}
            {held && (
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                盘面 {held.legCount} 笔 · {fmtUsd(held.notionalUsd)} USD
              </span>
            )}
          </div>

          {/* 输入：按价格阶梯顺序 S̄ → S₁ → S₂，X₁ 殿后 */}
          <div className="grid grid-cols-4 gap-x-2">
            <Field label="S̄ 均价" value={sBar} onChange={setSBar} testId="add-sizing-sbar"
              onReset={held ? () => setSBar(tidyPx(held.avgEntry)) : undefined} />
            <Field label="S₁ 止损线" value={s1} onChange={setS1} testId="add-sizing-s1" accent />
            <Field label="S₂ 加仓价" value={s2} onChange={setS2} testId="add-sizing-s2"
              onReset={currentPrice > 0 ? () => setS2(tidyPx(currentPrice)) : undefined} />
            <Field label={`X₁ ${coinName}`} value={x1} onChange={setX1} testId="add-sizing-x1"
              onReset={held ? () => setX1(tidyCoins(held.coins)) : undefined} />
          </div>

          {/* 盘口上真实挂着的对冲线。只摆候选、不预填也不锁定 S₁——
              系统分不出「对冲单」与「试单 / 上一场遗留单」的意图。 */}
          {(bookLine || hedgeRead.unlineable.length > 0) && (
            <div data-testid="add-sizing-book-lines" className="flex flex-wrap items-center gap-1 text-[10px]">
              <span className="text-muted-foreground/70">盘口对冲线</span>
              {hedgeRead.candidates.map(c => (
                <button
                  key={c.id}
                  type="button"
                  data-testid="add-sizing-book-line"
                  onClick={() => setS1(tidyPx(c.price))}
                  title="填入 S₁"
                  className={`rounded border px-1.5 py-0.5 font-mono transition-colors ${
                    sameLine(c.price, toNum(s1))
                      ? 'border-trading-green/50 bg-trading-green/10 text-trading-green'
                      : 'border-border text-foreground/80 hover:bg-accent'
                  }`}
                >
                  {fmtPx(c.price)} · {fmtCoins(c.coins)} {coinName}
                </button>
              ))}
              {hedgeRead.candidates.length > 1 && (
                <span className="text-muted-foreground/60">{hedgeRead.candidates.length} 条线 · 系统不替你选</span>
              )}
              {hedgeRead.unlineable.length > 0 && (
                <span className="text-muted-foreground/60">
                  {hedgeRead.unlineable.length} 张无固定线（跟踪 / TWAP），未计入
                </span>
              )}
              {hedgeRead.staleCount > 0 && (
                <span className="text-muted-foreground/60">{hedgeRead.staleCount} 张早于本场，已排除</span>
              )}
            </div>
          )}

          {/* S₁ 与盘口线不一致：不报价差（0.15% 看着就该被忽略），报**钱**。 */}
          {s1Deviation && (
            <div data-testid="add-sizing-s1-deviation"
              className="rounded border border-trading-red/40 bg-trading-red/5 px-2 py-1.5 text-[10px] leading-[1.6] text-trading-red">
              S₁ {fmtPx(s1Deviation.typedS1)} 与盘口对冲线 {fmtPx(s1Deviation.bookPrice)} 不是同一条线 ——
              加仓{s1Deviation.excessCoins > 0 ? '多' : '少'}下 {fmtCoins(Math.abs(s1Deviation.excessCoins))} {coinName}
              （应 {fmtCoins(s1Deviation.shouldAdd)}）；价格走到 {fmtPx(s1Deviation.bookPrice)} 时账面
              <span className="font-medium"> {fmtUsd(s1Deviation.netAtBookLine)} USD</span>，锁死本应是 0。
              <button type="button" data-testid="add-sizing-use-book-line"
                onClick={() => setS1(tidyPx(s1Deviation.bookPrice))}
                className="ml-1 underline hover:no-underline">按盘口重算</button>
            </div>
          )}

          <PriceLadder side={side} sBar={toNum(sBar)} s1={toNum(s1)} s2={toNum(s2)} />

          {/* A 本账 */}
          <section data-testid="add-sizing-cushion" className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[11px] font-medium text-foreground">A 浮盈垫</h3>
              <span className="text-[10px] text-muted-foreground">锁死</span>
              {!cushion.ok && (
                <span
                  data-testid="add-sizing-cushion-problem"
                  className={`ml-auto truncate rounded border px-1.5 py-0.5 text-[10px] ${
                    note.violation
                      ? 'border-trading-red/40 bg-trading-red/10 text-trading-red'
                      : 'border-dashed border-border text-muted-foreground'
                  }`}
                >
                  {note.text}
                </span>
              )}
            </div>
            {cushion.ok && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {/* B 账本一开，这两个数就都**只是 A 那一半**，不是该照着下的量。
                      合计加仓 / 合计对冲在 B 段以 Hero 呈现；这里相应降级，
                      免得屏幕上最醒目的两个数恰恰是不该用的那两个（本次事故的形状之一）。 */}
                  <Hero testId="add-sizing-x2" label={bankedOn ? '加仓 X₂ · 仅 A' : '加仓上限 X₂'}
                    value={fmtCoins(cushion.x2Max)} unit={coinName}
                    sub={`${fmtUsd(cushion.x2MaxNotional)} USD${contracts(cushion.x2Max, toNum(s2))}`}
                    tone={bankedOn ? undefined : 'primary'} />
                  <Hero testId="add-sizing-hedge"
                    label={`对冲 @ S₁ · ${side === 'LONG' ? '空' : '多'}${bankedOn ? ' · 仅 A' : ''}`}
                    value={fmtCoins(cushion.hedgeCoinsAtS1)} unit={coinName}
                    sub={`${fmtUsd(cushion.hedgeNotionalAtS1)} USD${contracts(cushion.hedgeCoinsAtS1, toNum(s1))}`} />
                </div>
                <Chips items={[
                  ['浮盈垫 Y₁', `${fmtUsd(cushion.cushion)} USD ÷ 险 ${fmtPx(cushion.riskDistance)}`],
                  ['b', cushion.b.toFixed(4)],
                  ['新腿占比', fmtPct(cushion.p0)],
                  ['加仓后均价', fmtPx(cushion.blendedCostAfter)],
                ]} />
              </>
            )}
          </section>

          {/* B 本账 */}
          <section data-testid="add-sizing-banked" className="space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <h3 className="text-[11px] font-medium text-foreground">B 落袋镜像</h3>
              <span className="text-[10px] text-muted-foreground">同一 S₁ / S₂ · 只是垫子不同</span>
              {!bankedOn && (
                <span data-testid="add-sizing-banked-off" className="ml-auto text-[10px] text-muted-foreground">未填 G，本账关闭</span>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-x-2 gap-y-1.5">
              <div className="w-[116px]"><Field label={`G 已落袋 ${isCoin ? coinName : 'USD'}`} value={g} onChange={setG} testId="add-sizing-g" /></div>
              {bankedSuggest > 0 && (
                <button
                  type="button"
                  data-testid="add-sizing-fill-banked"
                  onClick={() => setG(isCoin ? tidyCoins(bankedSuggest) : String(Number(bankedSuggest.toFixed(2))))}
                  className="h-7 rounded border border-border px-2 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  本场止盈 +{isCoin ? fmtCoins(bankedSuggest, 4) : fmtUsd(bankedSuggest)}（{banked.count} 笔）
                </button>
              )}
              {bankedOn && (
                <>
                  <div className="flex h-7 items-center gap-0.5 rounded bg-secondary p-0.5">
                    {(['line', 'size'] as BankedKnob['kind'][]).map(k => (
                      <button
                        key={k}
                        type="button"
                        data-testid={`add-sizing-knob-${k}`}
                        onClick={() => setKnobKind(k)}
                        className={`rounded px-2 py-0.5 text-[10px] transition-colors ${knobKind === k ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {k === 'line' ? '定线' : '定仓'}
                      </button>
                    ))}
                  </div>
                  <div className="w-[116px]">
                    {knobKind === 'line'
                      ? <Field label="K_B 零风险线" value={kB} onChange={setKB} testId="add-sizing-kb" placeholder={s1 || 'S₁'} onReset={() => setKB('')} accent />
                      : <Field label={`X₂ᴮ ${coinName}`} value={x2B} onChange={setX2B} testId="add-sizing-x2b" accent />}
                  </div>
                </>
              )}
              {bankedOn && !bankedRes.ok && (
                <span data-testid="add-sizing-banked-problem" className="mb-1 text-[10px] text-muted-foreground">
                  {BANKED_PROBLEM[bankedRes.problem ?? 'disabled']}
                </span>
              )}
            </div>
            {bankedOn && bankedRes.ok && (
              <>
                {/* B 账本一开，真正要下的那一单就是 A + B 的总量——X_G 单独看没有下单意义。
                    所以合计升为头条，X_G 与 K_B 退到下一行做拆解。 */}
                {cushion.ok && (
                  <div className="grid grid-cols-2 gap-2">
                    <Hero
                      testId="add-sizing-total-add"
                      label="合计加仓 X₂ + X_G"
                      value={fmtCoins(cushion.x2Max + bankedRes.x2)}
                      unit={coinName}
                      sub={`A ${fmtCoins(cushion.x2Max)} + B ${fmtCoins(bankedRes.x2)}${contracts(cushion.x2Max + bankedRes.x2, toNum(s2))}`}
                      tone="primary"
                    />
                    {/* 对冲量此前只是底部一行小字，而 A 段那个「对冲 @ S₁」Hero 只算了 A。
                        真正要挂的是 X₁ + X₂ + X_G —— 它必须和合计加仓一样醒目。 */}
                    {!bankedRes.kBBeyondS1 && (
                      <Hero
                        testId="add-sizing-total-hedge-hero"
                        label={`合计对冲 @ S₁ · ${side === 'LONG' ? '空' : '多'}`}
                        value={fmtCoins(cushion.hedgeCoinsAtS1 + bankedRes.x2)}
                        unit={coinName}
                        sub={`X₁ + X₂ + X_G${hedgeRead.filledHedgeCoins > 0 || bookLine
                          ? ` · 已挂 ${fmtCoins((bookLine?.coins ?? 0) + hedgeRead.filledHedgeCoins)}`
                          : ''}`}
                        tone="primary"
                      />
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Hero testId="add-sizing-x2b-out" label={bankedRes.kBBeyondS1 ? 'B 腿 X_G · 带敞口' : 'B 腿 X_G · 零风险'} value={fmtCoins(bankedRes.x2)} unit={coinName}
                    sub={`${fmtUsd(bankedRes.x2Notional)} USD${contracts(bankedRes.x2, toNum(s2))}`}
                    tone={cushion.ok ? undefined : 'primary'} />
                  <Hero testId="add-sizing-kb-out" label="K_B 零风险线" value={fmtPx(bankedRes.kB)}
                    sub={bankedRes.kBBeyondS1 ? '已越过 S₁' : '不低于 S₁'} />
                </div>
                <Chips items={[
                  ['S₁ 处吃掉', `${isCoin ? fmtCoins(bankedRes.consumedAtS1, 4) : fmtUsd(bankedRes.consumedAtS1)} · 敞口 ${fmtPct(bankedRes.exposureAtS1)}`, bankedRes.exposureAtS1 > 1],
                  ['剩余', isCoin ? fmtCoins(bankedRes.residualAtS1, 4) : fmtUsd(bankedRes.residualAtS1)],
                  ...(cushion.ok
                    ? [
                      // 合计加仓已升为本段头条，这里不再重复同一个数。
                      // K_B = S₁ 时 B 腿也挂在同一条线上，对冲要一并扛起来；
                      // K_B 拖低则 B 腿单独在 K_B 处对冲，A 线只管 X₁ + X₂。
                      ...(bankedRes.kBBeyondS1
                        ? [] as const
                        : [['合计对冲 @ S₁', `${fmtCoins(cushion.hedgeCoinsAtS1 + bankedRes.x2)} ${coinName} · X₁ + X₂ + X_G`, false, 'add-sizing-total-hedge'] as const]),
                    ]
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

/**
 * 价格阶梯：三个价格齐了就画，**不看有没有解**。
 * 方向反了的那一段标红——「S₁ 还在成本线亏损侧」于是一眼可见，而不是只剩一句灰字。
 */
function PriceLadder({ side, sBar, s1, s2 }: { side: AddSide; sBar: number; s1: number; s2: number }) {
  const ok = [sBar, s1, s2].every(v => Number.isFinite(v) && v > 0);
  const lo = ok ? Math.min(sBar, s1, s2) : 0;
  const hi = ok ? Math.max(sBar, s1, s2) : 0;
  const span = hi - lo;
  // 三个价格没齐、或三点重合时不占位——留一块空白比什么都不放更糟
  if (!ok || !(span > 0)) return null;

  const d = side === 'SHORT' ? -1 : 1;
  const pos = (p: number) => ((d > 0 ? p - lo : hi - p) / span) * 100;
  const pB = pos(sBar);
  const p1 = pos(s1);
  const p2 = pos(s2);
  const mid = (a: number, b: number) => (a + b) / 2;
  const seg = (a: number, b: number) => ({ left: `${Math.min(a, b)}%`, width: `${Math.abs(b - a)}%` });
  const cushionOk = (s1 - sBar) * d > 0;
  const riskOk = (s2 - s1) * d > 0;

  return (
    // 左右留 14px：两端刻度用 -translate-x-1/2 居中，贴边会被裁掉一半
    <div className="px-3.5" data-testid="add-sizing-ladder">
      <div className="relative h-[40px]">
        <div className="absolute inset-x-0 top-[10px] h-[3px] rounded-full bg-muted" />
        <div className={`absolute top-[10px] h-[3px] rounded-full ${cushionOk ? 'bg-trading-green/55' : 'bg-trading-red/55'}`} style={seg(pB, p1)} />
        <div className={`absolute top-[10px] h-[3px] rounded-full ${riskOk ? 'bg-primary/55' : 'bg-trading-red/55'}`} style={seg(p1, p2)} />
        {([['S̄', pB, false], ['S₁', p1, true], ['S₂', p2, false]] as const).map(([label, p, accent]) => (
          <div key={label} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${p}%` }}>
            <div className={`mx-auto h-[7px] w-[2px] rounded-full ${accent ? 'bg-foreground' : 'bg-muted-foreground/50'}`} />
            <div className={`mt-[7px] text-[9px] leading-none ${accent ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</div>
          </div>
        ))}
        {/* 距离标注落在各自线段的中点下方，而不是挤在两端 */}
        {([
          ['垫', Math.abs(s1 - sBar), mid(pB, p1), cushionOk],
          ['险', Math.abs(s2 - s1), mid(p1, p2), riskOk],
        ] as const).map(([tag, dist, at, good]) => (
          <div
            key={tag}
            className={`absolute top-[27px] -translate-x-1/2 whitespace-nowrap font-mono text-[9px] ${good ? 'text-muted-foreground' : 'text-trading-red'}`}
            style={{ left: `${at}%` }}
          >
            {good ? '' : '反向 '}{tag} {fmtPx(dist)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Hero({ label, value, unit, sub, tone, testId }: {
  label: string; value: string; unit?: string; sub?: string; tone?: 'primary'; testId: string;
}) {
  return (
    <div data-testid={testId} className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-[18px] font-semibold leading-tight tabular-nums ${tone === 'primary' ? 'text-primary' : 'text-foreground'}`}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>}
      </div>
      {sub && <div className="font-mono text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Chips({ items }: { items: Array<readonly [string, string, boolean?, string?]> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([label, value, warn, testId]) => (
        <div key={label} data-testid={testId} className="text-[10px] leading-tight">
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
    <label className="block min-w-0">
      <span className="flex items-center gap-1 text-[10px] leading-tight text-muted-foreground">
        <span className="truncate">{label}</span>
        {onReset && (
          <button type="button" aria-label={`${label} 复位`} onClick={onReset}
            className="ml-auto shrink-0 rounded opacity-40 transition-opacity hover:opacity-100">
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
        className={`mt-0.5 h-7 w-full rounded border bg-secondary px-1.5 font-mono text-[11px] tabular-nums text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary/40 ${
          accent ? 'border-primary/40' : 'border-border'
        }`}
      />
    </label>
  );
}
