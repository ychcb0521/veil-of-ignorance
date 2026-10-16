import { mulberry32 } from '@/lib/deepRsa/grouping';
import type { RunEvent } from '@/lib/deepRsa/pipeline';

/** 合成事件：shift = 实验组 V 相对其他事件的平移（原值，对数 / 根）。 */
export function driftEvents(n: number, shift = 0): RunEvent[] {
  const rand = mulberry32(5);
  const t0 = Date.parse('2025-01-01T00:00:00Z');
  return Array.from({ length: n }, (_, i) => {
    const vol = 0.005 + 0.02 * rand();
    const kind = i % 3 ? 'event' : 'background';
    const label = kind === 'event' ? (rand() < 0.2 ? 'positive' : rand() < 0.8 ? 'control' : null) : null;
    const v = 2e-4 * (rand() - 0.3) + (label === 'positive' ? shift : 0);
    const f = { vol_w: vol, dsp_v: v, dsp_a: rand() - 0.5, dsp_gap: vol * 2 * (rand() - 0.3) };
    return {
      id: `e${i}`, symbol: `S${i % 20}USDT`, anchorMs: t0 + i * 8 * 3_600_000, kind,
      featuresByH: { 2: f, 6: f, 12: f }, label, outcome: vol * 4,
      block: new Date(t0 + i * 8 * 3_600_000).toISOString().slice(0, 7), momentum: null,
      maxUp: vol * 4, maxDown: -vol * 4, endRet: 0.02 * (rand() - 0.5),
      memberIds: kind === 'event' ? [`c${i}`, ...(i % 7 === 0 ? [`c${i}b`] : [])] : [],
    } as RunEvent;
  });
}
