import { ArrowLeft, Activity, CalendarMinus, Gauge, Trophy, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTradingContext } from '@/contexts/TradingContext';
import {
  EXECUTION_DECISION_REWARD,
  EXECUTION_DIRECT_REWARD,
  EXECUTION_NO_TRADE_PENALTY,
  executionTradeCount,
  localDateKey,
} from '@/lib/executionAssets';

function formatSigned(points: number) {
  return `${points >= 0 ? '+' : ''}${points.toLocaleString()}`;
}

function eventTone(type: string) {
  if (type === 'decision_reward') return 'text-[#0ECB81] border-[#0ECB81]/25 bg-[#0ECB81]/5';
  if (type === 'direct_reward') return 'text-[#F0B90B] border-[#F0B90B]/25 bg-[#F0B90B]/5';
  return 'text-[#F6465D] border-[#F6465D]/25 bg-[#F6465D]/5';
}

export default function ExecutionAssetsPage() {
  const nav = useNavigate();
  const { executionAsset } = useTradingContext();
  const todayKey = localDateKey();
  const tradedToday = Boolean(executionAsset.tradedDates?.[todayKey]);
  const totalTrades = executionTradeCount(executionAsset);
  const decisionShare = totalTrades > 0 ? (executionAsset.decisionTradeCount / totalTrades) * 100 : 0;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <button
            onClick={() => nav('/')}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </button>
          <div className="text-right">
            <h1 className="text-[15px] font-semibold">执行力资产</h1>
            <p className="text-[11px] text-muted-foreground">重复次数的加速器：做，比想更贵重。</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <section className="rounded-2xl border border-border/70 bg-card shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="grid gap-4 border-b border-border/70 p-5 md:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-3 py-1 text-[11px] font-medium text-[#D89B00]">
                <Zap className="h-3.5 w-3.5" />
                没去做带来的损失，必须被系统看见
              </div>
              <div className="font-mono text-5xl font-semibold tracking-tight text-foreground">
                {executionAsset.points.toLocaleString()}
              </div>
              <div className="mt-2 text-[12px] text-muted-foreground">当前执行力积分</div>
            </div>
            <div className="grid gap-2">
              <div className={`rounded-xl border px-3 py-3 ${tradedToday ? 'border-[#0ECB81]/25 bg-[#0ECB81]/5' : 'border-[#F6465D]/25 bg-[#F6465D]/5'}`}>
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <Activity className="h-4 w-4" />
                  今日状态
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {tradedToday ? '今天已有交易，已守住执行力日线。' : `今天还没有交易；到明天仍未交易，将扣 ${EXECUTION_NO_TRADE_PENALTY} 分。`}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-3">
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <Gauge className="h-4 w-4" />
                  加速器
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  决策记录交易是直接交易的 <span className="font-mono text-foreground">10.1x</span> 权重。
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 p-5 md:grid-cols-4">
            <div className="rounded-xl border border-border/60 bg-background/70 p-4">
              <Trophy className="mb-3 h-4 w-4 text-[#0ECB81]" />
              <div className="font-mono text-2xl">{executionAsset.decisionTradeCount}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">决策记录交易</div>
              <div className="mt-2 font-mono text-[11px] text-[#0ECB81]">每次 +{EXECUTION_DECISION_REWARD}</div>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/70 p-4">
              <Zap className="mb-3 h-4 w-4 text-[#F0B90B]" />
              <div className="font-mono text-2xl">{executionAsset.directTradeCount}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">直接交易</div>
              <div className="mt-2 font-mono text-[11px] text-[#F0B90B]">每次 +{EXECUTION_DIRECT_REWARD}</div>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/70 p-4">
              <CalendarMinus className="mb-3 h-4 w-4 text-[#F6465D]" />
              <div className="font-mono text-2xl">{executionAsset.penaltyDays}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">未交易扣分日</div>
              <div className="mt-2 font-mono text-[11px] text-[#F6465D]">每天 -{EXECUTION_NO_TRADE_PENALTY}</div>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/70 p-4">
              <Gauge className="mb-3 h-4 w-4 text-muted-foreground" />
              <div className="font-mono text-2xl">{decisionShare.toFixed(0)}%</div>
              <div className="mt-1 text-[11px] text-muted-foreground">决策记录占比</div>
              <div className="mt-2 text-[11px] text-muted-foreground">越高，样本越可复盘。</div>
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-border/70 bg-card">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-[13px] font-semibold">积分规则</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">奖励真实开仓；挂单在真正成交时才计分。</p>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-3">
            <div className="rounded-xl border border-[#0ECB81]/25 bg-[#0ECB81]/5 px-4 py-3">
              <div className="text-[12px] font-medium">决策记录模块交易</div>
              <div className="mt-2 font-mono text-2xl text-[#0ECB81]">+999</div>
            </div>
            <div className="rounded-xl border border-[#F0B90B]/25 bg-[#F0B90B]/5 px-4 py-3">
              <div className="text-[12px] font-medium">直接交易</div>
              <div className="mt-2 font-mono text-2xl text-[#D89B00]">+99</div>
            </div>
            <div className="rounded-xl border border-[#F6465D]/25 bg-[#F6465D]/5 px-4 py-3">
              <div className="text-[12px] font-medium">自然日未交易</div>
              <div className="mt-2 font-mono text-2xl text-[#F6465D]">-500</div>
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-border/70 bg-card">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-[13px] font-semibold">最近积分流水</h2>
          </div>
          <div className="p-3">
            {executionAsset.events.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-[12px] text-muted-foreground">
                还没有积分流水。下一次真实开仓后，这里会出现第一条记录。
              </div>
            ) : (
              <div className="space-y-2">
                {executionAsset.events.slice(0, 12).map(event => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/70 px-4 py-3"
                  >
                    <div>
                      <div className="text-[12px] font-medium">{event.label}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{event.date}</div>
                    </div>
                    <div className={`rounded-full border px-2.5 py-1 font-mono text-[12px] ${eventTone(event.type)}`}>
                      {formatSigned(event.points)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
