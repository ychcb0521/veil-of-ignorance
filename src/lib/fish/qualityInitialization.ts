import type { FishReconstructionLoader } from './reconstruction';
import { isTuringCupSymbol } from '../turingCupSymbol';

export const TURING_INITIALIZATION_VERSION = 'turing-origin-v1' as const;
export const TURING_SCREENING_INITIALIZATION_VERSION = 'turing-screening-origin-v1' as const;
export type QualityInitialization = typeof TURING_INITIALIZATION_VERSION | typeof TURING_SCREENING_INITIALIZATION_VERSION;

/** An explicit, separately versioned run. The original loader and market data stay unchanged. */
export function withTuringInitialization(load: FishReconstructionLoader, symbol: string, startMs: number, version: QualityInitialization = TURING_INITIALIZATION_VERSION): FishReconstructionLoader {
  if (!isTuringCupSymbol(symbol)) throw Error('图灵杯专用方案只能运行图灵杯标的，请对真实市场使用原方案');
  if (!Number.isFinite(startMs) || startMs <= 0) throw Error('缺少图灵杯首根行情时间，不能初始化指标');
  return Object.assign(((...args: Parameters<FishReconstructionLoader>) => load(...args)) as FishReconstructionLoader,
    { turingInitialization: { version, startMs } });
}

/** History always starts at the same first complete candle; no fabricated prefix or rolling seed. */
export function qualityHistoryFrom(load: FishReconstructionLoader, requested: number, step: number): number {
  return load.turingInitialization ? Math.ceil(load.turingInitialization.startMs / step) * step : requested;
}

/** Missing initial formula windows are pending. Missing readings after a valid value remain errors. */
export function qualityInitializationPending(load: FishReconstructionLoader, values: ArrayLike<number>, index: number): boolean {
  if (!load.turingInitialization || Number.isFinite(values[index])) return false;
  for (let i = 0; i < index; i++) if (Number.isFinite(values[i])) return false;
  return true;
}
