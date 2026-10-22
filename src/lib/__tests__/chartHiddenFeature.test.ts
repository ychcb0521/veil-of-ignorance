// 【用户反馈】2026-10-22「为啥不显示指标的线」：Deep dig 里删掉（隐藏）的内置特征值，图上退回内置公式照常画，不再整条 n/a
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KLineData } from 'klinecharts';
const registered = vi.hoisted(() => new Map<string, any>());
vi.mock('klinecharts', () => ({ registerIndicator: (d: any) => registered.set(d.name, d) }));
import { registerCustomIndicators } from '@/lib/customIndicators';
import { BUILTIN_FEATURES, FEATURES_KEY } from '@/lib/deepDig/features';
import { researchKcName } from '@/lib/researchIndicators';
registerCustomIndicators();
beforeEach(() => localStorage.clear());
const data = () => Array.from({ length: 600 }, (_, i) => { const close = 100 + i / 50 + 2 * Math.sin(i / 9), q = 10000 + 3000 * Math.cos(i / 7); return { timestamp: i * 300000, open: close - .1, high: close + 1, low: close - 1, close, volume: q / close, turnover: q, takerBuyTurnover: q * (.5 + .3 * Math.sin(i / 13)) } as KLineData; });
const hide = (id: string) => localStorage.setItem('sim_anon_' + FEATURES_KEY, JSON.stringify([{ ...BUILTIN_FEATURES.find(d => d.id === id)!, removed: true }]));
const run = (name: string, params: unknown[]) => { const reg = registered.get(name); return reg.calc(data(), { calcParams: params }).map((v: any) => v[reg.figures[0].key] ?? null); };
describe('Deep dig 里隐藏的内置项，图上照常画', () => {
  it('DSP·a 原版被隐藏：a、avg_a、avg_a_2 都有读数（Z 关）', () => {
    hide('drift-speed');
    for (const level of [0, 1, 2]) expect(run(researchKcName('DSP_VA', level), level === 1 ? [6, 24, 0] : [6, 0, 0]).filter((v: unknown) => v != null).length).toBeGreaterThan(100);
  });
  it('其他内置项（CBI-2、多空状态 S）被隐藏也一样', () => {
    hide('cbi2'); expect(run(researchKcName('CBI2', 0), [24, 0]).some((v: unknown) => v != null)).toBe(true);
    hide('state'); expect(run(researchKcName('STATE', 0), [24, 0, 0]).some((v: unknown) => v != null)).toBe(true);
  });
});
