/**
 * 由卡片、合并方式、交易所范围拼出一次捕捞的设置。「开始捕捞」按钮与定时自动捕捞用同一个函数，两边拿到的设置逐项一致。
 */
import type { FishCard } from '@/components/FishAlgorithmCard';
import { isRetiredFeature, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { FishExchange } from './exchanges';
import { compileFishProgram, type FishProgram } from './algorithm';
import { FISH_TURNOVER_FLOORS } from './shared';
import { fishSelectionKey, parseFishSettings, type FishScanSettings } from '@/lib/fishScanner';

export interface FishScanSelection { exchanges: FishExchange[]; includeDuplicates: boolean; includeUsStocks?: boolean }
const compile = (def: DeepDigFeatureDef, c: FishCard) => compileFishProgram(def, { statistic: c.pref.statistic ?? '结果', direction: c.pref.direction, threshold: c.pref.threshold.trim() ? Number(c.pref.threshold) : NaN, constraints: [] });

/** 勾选的卡（参与显示的组合）与全部能用的卡（都扫，扫完可任意切换组合）。 */
export function fishCardPlans(cards: readonly FishCard[], defs: readonly DeepDigFeatureDef[]): { plans: FishProgram[]; pool: FishProgram[]; error: string } {
  const plans: FishProgram[] = []; let error = '';
  const defOf = (c: FishCard, i: number) => isRetiredFeature(c.featureId) ? undefined : defs.find(d => d.id === c.featureId) ?? (i === 0 ? defs.find(d => d.id === 'cbi2') ?? defs[0] : undefined);
  for (const [i, c] of cards.entries()) if (c.enabled) try {
    const d = defOf(c, i); if (!d) throw Error(i === 0 ? 'Deep dig 里没有可用特征值' : '特征值已不存在');
    const plan = compile(d, c); if (plan.unavailable) throw Error(plan.unavailable); plans.push(plan);
  } catch (e) { error = `算法 ${i + 1}：${e instanceof Error ? e.message : String(e)}`; }
  const pool = cards.flatMap((c, i) => { try { const d = defOf(c, i); if (!d) return []; const plan = compile(d, c); return plan.unavailable ? [] : [plan]; } catch { return []; } });
  return { plans, pool, error: error || (!plans.length ? '请启用至少一个算法' : '') };
}

/** 一次捕捞的完整设置；拼不出来时返回原因（与「开始捕捞」按钮的报错相同）。time 留空 = 现在。 */
export function buildFishScanSettings(o: { cards: readonly FishCard[]; defs: readonly DeepDigFeatureDef[]; combination: 'and' | 'or'; selection: FishScanSelection; time: string }): { settings: FishScanSettings; error?: undefined } | { settings?: undefined; error: string } {
  try {
    const { plans, pool, error } = fishCardPlans(o.cards, o.defs);
    const parsed = parseFishSettings(o.time, String(plans[0]?.settings.threshold ?? 0));
    if (!o.selection.exchanges.length) throw new Error('请至少选择一家交易所');
    if (error && error !== '请启用至少一个算法') throw new Error(error);
    if (!pool.length) throw new Error('没有有效算法');
    return { settings: { ...parsed, feature: pool[0].def, algorithm: pool[0].settings, algorithms: pool.map(p => ({ feature: p.def, algorithm: p.settings })), retainMembers: true, displayAlgorithmKeys: plans.map(fishSelectionKey), combination: o.combination, exchanges: [...o.selection.exchanges], includeDuplicates: o.selection.includeDuplicates, includeUsStocks: o.selection.includeUsStocks ?? false, turnoverFloors: FISH_TURNOVER_FLOORS } };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}
