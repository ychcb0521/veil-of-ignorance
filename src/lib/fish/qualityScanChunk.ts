import type { TradeSignal } from '@/lib/signalLibrary';
import { isTuringCupSymbol } from '@/lib/turingCupSymbol';
import type { FishProgram } from './algorithm';
import type { FishReconstructionLoader } from './reconstruction';
import { FishError, validateFishBars } from './shared';

/** A gap in an offline lookahead must not reject a trade that exits before that gap.
 * Narrow the lookahead, retaining every required warmup bar. Never skip a missing bar. */
export async function loadQualityScanChunk(load: FishReconstructionLoader, row: TradeSignal,
  from: number, cursor: number, requestedCut: number, plan: FishProgram, signal: AbortSignal) {
  let cut = requestedCut;
  for (;;) {
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    try {
      const bars = await load(row, from, cut, plan, signal);
      validateFishBars(bars, cut, (cut - from) / plan.step, plan.step);
      return { bars, cut };
    } catch (error) {
      if (signal.aborted || !isTuringCupSymbol(row.symbol) || !(error instanceof FishError) || error.kind !== 'gap') throw error;
      const count = Math.round((cut - cursor) / plan.step);
      if (count <= 1) throw error;
      cut = cursor + Math.max(1, Math.floor(count / 2)) * plan.step;
    }
  }
}
