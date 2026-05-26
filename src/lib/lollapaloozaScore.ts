/**
 * Lollapalooza 风险组合评分
 *
 * Munger 的 lollapalooza 原理：多个偏差同时叠加才致命。心态差 + 重仓 +
 * 刚亏完 + 深夜下单单独看都不算什么，组合在一起就是爆仓配方。
 *
 * 输出 0-100：
 *   0-30  : 安全
 *   30-60 : caution（警告，仍可下单）
 *   60-100: 强制阻挡（绝对不允许下单）
 */
import type { TradeJournal } from '@/types/journal';

export interface LollapaloozaInputs {
  /** 1-5 心态自评 */
  mentalState: number;
  /** 心态触发说明文本（关键词检测） */
  mentalTrigger: string | null;
  /** 仓位金额 USDT */
  positionSizeUsdt: number;
  /** 当前可用余额 USDT */
  availableBalance: number;
  /** 24h 内的所有 journal（含本次未提交的） */
  recentJournals24h: TradeJournal[];
  /** 当前时间（用于日内时段判断），默认 Date.now() */
  nowMs?: number;
}

export interface LollapaloozaBreakdown {
  score: number;
  reasons: { label: string; points: number }[];
}

const HIGH_RISK_KEYWORDS = ['报仇', '赌一把', '亏回来', '生气', '群里', '老师推荐', '听说', 'fomo', 'FOMO'];

export function computeLollapaloozaScore(input: LollapaloozaInputs): LollapaloozaBreakdown {
  const reasons: { label: string; points: number }[] = [];
  const now = input.nowMs ?? Date.now();

  // 1. Mental state
  if (input.mentalState <= 1) reasons.push({ label: '心态极差', points: 35 });
  else if (input.mentalState === 2) reasons.push({ label: '心态较差', points: 20 });
  else if (input.mentalState === 3) reasons.push({ label: '心态中性', points: 8 });

  // 2. Position sizing relative to account
  if (input.availableBalance > 0) {
    const pct = (input.positionSizeUsdt / input.availableBalance) * 100;
    if (pct >= 30) reasons.push({ label: `仓位 ${pct.toFixed(0)}% 账户`, points: 35 });
    else if (pct >= 15) reasons.push({ label: `仓位 ${pct.toFixed(0)}% 账户`, points: 20 });
    else if (pct >= 8) reasons.push({ label: `仓位 ${pct.toFixed(0)}% 账户`, points: 10 });
  }

  // 3. Recent losses (24h consecutive losers)
  const recent = [...input.recentJournals24h]
    .filter(j => now - new Date(j.pre_simulated_time).getTime() <= 24 * 3600_000)
    .sort((a, b) => new Date(b.pre_simulated_time).getTime() - new Date(a.pre_simulated_time).getTime());
  let streak = 0;
  for (const j of recent) {
    if (j.post_outcome === 'loss') streak += 1;
    else if (j.post_outcome === 'win') break;
  }
  if (streak >= 3) reasons.push({ label: `今日连续 ${streak} 笔亏损`, points: 25 });
  else if (streak === 2) reasons.push({ label: '今日已连亏 2 笔', points: 12 });

  // 4. Trigger text keyword sweep
  if (input.mentalTrigger) {
    const lower = input.mentalTrigger;
    const hit = HIGH_RISK_KEYWORDS.find(k => lower.includes(k));
    if (hit) reasons.push({ label: `情绪关键词「${hit}」`, points: 25 });
  }

  // 5. Late-night decision window
  const hour = new Date(now).getHours();
  if (hour >= 0 && hour < 5) reasons.push({ label: `深夜下单 (${hour}:00)`, points: 15 });

  const total = reasons.reduce((s, r) => s + r.points, 0);
  return { score: Math.min(100, total), reasons };
}

export function lollapaloozaLevel(score: number): 'safe' | 'caution' | 'blocked' {
  if (score >= 60) return 'blocked';
  if (score >= 30) return 'caution';
  return 'safe';
}
