import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
} from '@/lib/addSizing';

/**
 * 加仓计算器 —— 使用说明 3.4 的公式做成可以按的东西。
 *
 * 两本账并排、互不掺和：
 *   A 浮盈垫：X₂ = X₁ ÷ b，对冲 X₁ + X₂ 挂在 S₁。落袋利润永远不进这本账。
 *   B 落袋镜像：用已落袋的 G 再开一条腿，给它自己的零风险线 K_B，允许有风险敞口。
 *   G 不填时 B 本账整个关闭，A 本账一字不变。
 *
 * X₁ / S̄ / S₂ 从盘面预填（按各腿开仓价折算，不用卡片上按标记价折的「≈ xx 币」），
 * 每个输入都能手改，旁边的 ↺ 把它复位到盘面值。S₁ 必须手填——那是你的判断，系统不猜。
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
// 预填进输入框的数收一下精度：109.09090909090908 这种原始浮点串没法读，也没法改。
// 价格留 8 位有效数字、币量留 4 位小数——对公式的影响在 1e-6 以下，远小于任何下单粒度。
const tidyPx = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(8))) : '');
const tidyCoins = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(4))) : '');

const CUSHION_PROBLEM: Record<string, string> = {
  invalid_input: '四个数都要填，且都大于 0',
  s1_not_past_cost: '止损线 S₁ 还没越过开仓均价 S̄——没有浮盈垫，加不了',
  s2_not_past_s1: '加仓价 S₂ 必须越过止损线 S₁——否则新腿没有风险距离，公式分母为 0',
};
const BANKED_PROBLEM: Record<string, string> = {
  disabled: '',
  kB_not_below_s2: 'K_B 在加仓价的盈利侧——B 腿从 S₂ 到 K_B 根本不会亏，无从定量',
  kB_not_above_s2: 'K_B 在加仓价的盈利侧——B 腿从 S₂ 到 K_B 根本不会亏，无从定量',
  x2_not_positive: 'X₂ᴮ 必须大于 0',
  x2_not_above_g: '币本位空头：X₂ᴮ 必须大于 G（币）才解得出 K_B',
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

  // 只在「打开」那一刻播种盘面值；之后用户改什么都不被刷掉。
  const seedRef = useRef({ held, currentPrice });
  seedRef.current = { held, currentPrice };
  useEffect(() => {
    if (!open) return;
    const { held: h, currentPrice: px } = seedRef.current;
    setSide(h?.side ?? 'LONG');
    setSBar(h ? tidyPx(h.avgEntry) : '');
    setX1(h ? tidyCoins(h.coins) : '');
    setS2(px > 0 ? tidyPx(px) : '');
    setS1('');
    setG('');
    setKnobKind('line');
    setKB('');
    setX2B('');
    setHelpOpen(false);
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

  // K_B 默认贴着 S₁（不动落袋 = 和 A 本账同一条线），用户再往保守侧拖
  const effectiveKB = kB !== '' ? toNum(kB) : toNum(s1);
  const bankedRes = useMemo(() => {
    const knob: BankedKnob = knobKind === 'line' ? { kind: 'line', kB: effectiveKB } : { kind: 'size', x2: toNum(x2B) };
    return computeBankedAdd({ side, settlement, g: toNum(g), s2: toNum(s2), s1: toNum(s1), knob });
  }, [knobKind, effectiveKB, x2B, side, settlement, g, s2, s1]);
  const bankedOn = toNum(g) > 0;

  const contractsLabel = (coins: number, price: number) =>
    isCoin && Number.isFinite(coins) && price > 0 ? ` ≈ ${coinsToContracts(coins, price, face).toLocaleString('en-US')} 张` : '';

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[720px]" data-testid="add-sizing-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="text-[15px]">加仓计算器 · {symbol}</DialogTitle>
            {/* 使用说明入口刻意做得近乎隐形：知道的人找得到，不抢主界面 */}
            <button
              type="button"
              data-testid="add-sizing-help"
              aria-label="使用说明"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen(v => !v)}
              className="ml-auto h-5 w-5 rounded-full text-[11px] leading-5 text-muted-foreground/25 transition-colors hover:bg-accent hover:text-foreground"
            >
              ?
            </button>
          </div>
          <DialogDescription className="text-[11px]">
            浮盈垫锁死的加仓量与对冲量。X₁ / S̄ / S₂ 已从盘面读取，可手改；S₁ 请自行填入。
          </DialogDescription>
        </DialogHeader>

        {helpOpen && (
          <div data-testid="add-sizing-help-panel" className="rounded border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <div className="mb-1 font-mono text-foreground">X₁ (S₁ − S̄) = X₂ (S₂ − S₁)　⟺　X₂ = X₁ ÷ b，b = (S₂ − S₁)/(S₁ − S̄)，1/(1+b) = P₀</div>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>旧腿在止损线 S₁ 上的浮盈垫，恰好兜住新腿从 S₂ 跌回 S₁ 的亏损——整场在 S₁ 归零，锁死。X₂ 是上限不是目标。</li>
              <li>对冲 X₁ + X₂ 挂在 S₁：扛起它保护的全部仓位；锁死时等币量就是等张数。</li>
              <li>X₁ = 名义总仓位 ÷ 开仓均价（按各腿开仓价折，不是卡片上按标记价折的「≈ xx 币」）。</li>
              <li>B 本账：已落袋的镜像利润 G 可以再开一条腿 X₂ᴮ，给它自己的零风险线 K_B，使 X₂ᴮ 从 S₂ 跌到 K_B 恰好亏掉 G。K_B 低于 S₁ = 留缓冲，只吃掉一部分 G。G 不填则 B 本账关闭，A 本账不受影响。</li>
              <li>这里的 b 不是盘面 P_gap 的 b：一个往回看（成本线 → 止损线），一个往前看（现价 → 目标）。</li>
            </ul>
            <Link to="/guide#s3-1c" className="mt-1 inline-block text-[#5BA3FF] hover:underline">完整说明见使用说明 3.4 →</Link>
          </div>
        )}

        {/* 方向 */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">方向</span>
          {(['LONG', 'SHORT'] as AddSide[]).map(v => (
            <button
              key={v}
              type="button"
              data-testid={`add-sizing-side-${v}`}
              onClick={() => setSide(v)}
              className={`rounded px-2 py-0.5 transition-colors ${
                side === v
                  ? (v === 'LONG' ? 'bg-trading-green/15 text-trading-green' : 'bg-trading-red/15 text-trading-red')
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {v === 'LONG' ? '主多' : '主空'}
            </button>
          ))}
          {held && (
            <span className="ml-auto text-muted-foreground">
              盘面：{held.side === 'LONG' ? '多' : '空'} {held.legCount} 笔 · 名义 {fmtUsd(held.notionalUsd)} USD
            </span>
          )}
        </div>

        {/* 输入 */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="S̄ 开仓均价" value={sBar} onChange={setSBar} testId="add-sizing-sbar"
            hint={held ? '读自持仓' : '手填'} onReset={held ? () => setSBar(tidyPx(held.avgEntry)) : undefined} />
          <Field label="S₁ 新止损线" value={s1} onChange={setS1} testId="add-sizing-s1" hint="手填" required />
          <Field label="S₂ 加仓价" value={s2} onChange={setS2} testId="add-sizing-s2"
            hint={currentPrice > 0 ? '现价' : '手填'} onReset={currentPrice > 0 ? () => setS2(tidyPx(currentPrice)) : undefined} />
          <Field label={`X₁ 既有币量（${coinName}）`} value={x1} onChange={setX1} testId="add-sizing-x1"
            hint={held ? `读自持仓 · ${held.legCount} 笔` : '手填'} onReset={held ? () => setX1(tidyCoins(held.coins)) : undefined} />
        </div>

        {/* A 本账 */}
        <section className="rounded border border-border bg-card p-3" data-testid="add-sizing-cushion">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-[12px] font-medium text-foreground">A 本账 · 浮盈垫锁死</h3>
            <span className="text-[10px] text-muted-foreground">落袋利润不进这本账</span>
          </div>
          {!cushion.ok ? (
            <p className="text-[11px] text-muted-foreground" data-testid="add-sizing-cushion-problem">
              {CUSHION_PROBLEM[cushion.problem ?? 'invalid_input']}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-3">
              <Stat label="浮盈垫" value={`${fmtUsd(cushion.cushion)} USD`} />
              <Stat label="b（风险距离 ÷ 垫子距离）" value={cushion.b.toFixed(4)} />
              <Stat label="P₀ = 1/(1+b)" value={fmtPct(cushion.p0)} />
              <Stat
                label="加仓上限 X₂"
                value={`${fmtCoins(cushion.x2Max)} ${coinName}`}
                sub={`≈ ${fmtUsd(cushion.x2MaxNotional)} USD${contractsLabel(cushion.x2Max, toNum(s2))}`}
                emphasis
                testId="add-sizing-x2"
              />
              <Stat label="加仓后均价" value={fmtPx(cushion.blendedCostAfter)} sub="取满上限时 = S₁" />
              <Stat
                label={`对冲委托 @ S₁（${side === 'LONG' ? '空' : '多'}）`}
                value={`${fmtCoins(cushion.hedgeCoinsAtS1)} ${coinName}`}
                sub={`≈ ${fmtUsd(cushion.hedgeNotionalAtS1)} USD${contractsLabel(cushion.hedgeCoinsAtS1, toNum(s1))}`}
                emphasis
                testId="add-sizing-hedge"
              />
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            X₂ 是上限，不是目标——取等号时综合成本恰好落在 S₁ 上；要留垫子就取小于 X₂。止损线每上移一次都要重算。
          </p>
        </section>

        {/* B 本账 */}
        <section className="rounded border border-border bg-card p-3" data-testid="add-sizing-banked">
          <div className="mb-2 flex items-baseline gap-2">
            <h3 className="text-[12px] font-medium text-foreground">B 本账 · 落袋镜像（可选）</h3>
            <span className="text-[10px] text-muted-foreground">用已实现的利润再开一条腿，允许它有风险敞口</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={`G 已落袋（${isCoin ? coinName : 'USD'}）`} value={g} onChange={setG} testId="add-sizing-g" hint="手填" />
            <div className="col-span-2 flex items-end gap-2 text-[10px] text-muted-foreground sm:col-span-3">
              {bankedSuggest > 0 ? (
                <button
                  type="button"
                  data-testid="add-sizing-fill-banked"
                  onClick={() => setG(isCoin ? tidyCoins(bankedSuggest) : String(Number(bankedSuggest.toFixed(2))))}
                  className="rounded border border-border px-2 py-1 transition-colors hover:bg-accent hover:text-foreground"
                  title="同标的、同方向、以「止盈1」平掉、且不早于当前最早持仓开仓时间的成交之和"
                >
                  检测到本场止盈落袋 +{isCoin ? `${fmtCoins(bankedSuggest, 4)} ${coinName}` : `${fmtUsd(bankedSuggest)} USD`}（{banked.count} 笔）· 填入
                </button>
              ) : (
                <span>未检测到本场止盈落袋；可手填</span>
              )}
            </div>
          </div>

          {!bankedOn ? (
            <p className="mt-2 text-[11px] text-muted-foreground" data-testid="add-sizing-banked-off">
              未填落袋利润，本账关闭——上方 A 本账的结论不受影响。
            </p>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-2 text-[11px]">
                <span className="text-muted-foreground">旋钮</span>
                {(['line', 'size'] as BankedKnob['kind'][]).map(k => (
                  <button
                    key={k}
                    type="button"
                    data-testid={`add-sizing-knob-${k}`}
                    onClick={() => setKnobKind(k)}
                    className={`rounded px-2 py-0.5 transition-colors ${knobKind === k ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
                  >
                    {k === 'line' ? '定线 K_B → 推仓' : '定仓 X₂ᴮ → 推线'}
                  </button>
                ))}
                <span className="ml-auto text-[10px] text-muted-foreground">两个旋钮互为反函数</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {knobKind === 'line' ? (
                  <Field label="K_B B 腿零风险线" value={kB} onChange={setKB} testId="add-sizing-kb"
                    hint={kB === '' ? '默认 = S₁' : '手填'} onReset={() => setKB('')} placeholder={s1 || '= S₁'} />
                ) : (
                  <Field label={`X₂ᴮ B 腿币量（${coinName}）`} value={x2B} onChange={setX2B} testId="add-sizing-x2b" hint="手填" />
                )}
              </div>
              {!bankedRes.ok ? (
                <p className="mt-2 text-[11px] text-muted-foreground" data-testid="add-sizing-banked-problem">
                  {BANKED_PROBLEM[bankedRes.problem ?? 'disabled'] || 'B 本账需要 G、S₁、S₂ 和旋钮的值'}
                </p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-3">
                  <Stat
                    label="B 腿 X₂ᴮ"
                    value={`${fmtCoins(bankedRes.x2)} ${coinName}`}
                    sub={`≈ ${fmtUsd(bankedRes.x2Notional)} USD${contractsLabel(bankedRes.x2, toNum(s2))}`}
                    emphasis
                    testId="add-sizing-x2b-out"
                  />
                  <Stat
                    label="K_B B 腿零风险线"
                    value={fmtPx(bankedRes.kB)}
                    sub={bankedRes.kBBeyondS1 ? `已越过 S₁，更保守` : `与 S₁ 同线或更激进`}
                    emphasis
                    testId="add-sizing-kb-out"
                  />
                  <Stat
                    label="跌到 S₁ 时吃掉的落袋"
                    value={`${isCoin ? fmtCoins(bankedRes.consumedAtS1, 4) : fmtUsd(bankedRes.consumedAtS1)} / ${isCoin ? fmtCoins(toNum(g), 4) : fmtUsd(toNum(g))}`}
                    sub={`敞口 ${fmtPct(bankedRes.exposureAtS1)}${bankedRes.exposureAtS1 > 1 ? ' · 超过落袋，已在动本金' : ''} · 剩余 ${isCoin ? fmtCoins(bankedRes.residualAtS1, 4) : fmtUsd(bankedRes.residualAtS1)}`}
                    warn={bankedRes.exposureAtS1 > 1}
                  />
                  {cushion.ok && (
                    <Stat
                      label="合计加仓（A + B）"
                      value={`${fmtCoins(cushion.x2Max + bankedRes.x2)} ${coinName}`}
                      sub={`A ${fmtCoins(cushion.x2Max)} + B ${fmtCoins(bankedRes.x2)}`}
                      testId="add-sizing-total-add"
                    />
                  )}
                  <div className="col-span-2 text-[10px] text-muted-foreground sm:col-span-3">
                    对冲分两处：A 线 S₁ 放{side === 'LONG' ? '空' : '多'} X₁ + X₂（见上）；B 腿单独在 K_B 处止损 / 对冲 X₂ᴮ。
                    B 腿亏掉的是落袋利润，不碰浮盈垫——两本账各自归零，互不借钱。
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, onChange, testId, hint, onReset, required, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; testId: string;
  hint?: string; onReset?: () => void; required?: boolean; placeholder?: string;
}) {
  return (
    <label className="block text-[10px] text-muted-foreground">
      <span className="flex items-center justify-between">
        <span>{label}{required && <span className="text-trading-red"> *</span>}</span>
        <span className="flex items-center gap-1">
          {hint && <span className="opacity-70">{hint}</span>}
          {onReset && (
            <button type="button" aria-label={`${label} 复位`} onClick={onReset} className="rounded p-0.5 transition-colors hover:bg-accent hover:text-foreground">
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </span>
      </span>
      <input
        data-testid={testId}
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="input-dark mt-0.5 h-8 w-full px-2 py-1 text-[12px]"
      />
    </label>
  );
}

function Stat({ label, value, sub, emphasis, warn, testId }: {
  label: string; value: string; sub?: string; emphasis?: boolean; warn?: boolean; testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-mono tabular-nums ${emphasis ? 'text-[13px] font-semibold text-foreground' : 'text-foreground'} ${warn ? 'text-trading-red' : ''}`}>{value}</div>
      {sub && <div className={`text-[10px] ${warn ? 'text-trading-red' : 'text-muted-foreground'}`}>{sub}</div>}
    </div>
  );
}
