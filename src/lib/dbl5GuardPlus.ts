import {
  DBL5_GUARD_DEFAULTS, DBL5_GUARD_VERSION, DBL5_STEP, Dbl5Engine, dbl5GuardVersion, dbl5Hash,
  dbl5PriceTicks, dbl5TickPrice, type Dbl5Bar, type Dbl5Checkpoint, type Dbl5Options, type Dbl5Row,
} from './dbl5m';

export const DBL5_GUARD_PLUS_VERSION = 'dbl5-guard-impulse-1115-v1';
export const DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION = 'dbl5-guard-impulse-1115-v2';
export type Dbl5GuardPlusVersion = typeof DBL5_GUARD_PLUS_VERSION | typeof DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION;
export const DBL5_GUARD_PLUS_LABEL = 'DBL-5防守线+急拉-1115';
export const IMPULSE_1115_POSITION_VERSION = 'holding-impulse-1115-position-v1';
export const IMPULSE_1115_CONFIGURABLE_K_VERSION = 'holding-impulse-1115-position-v2';
export const DBL5_1115_POSITION_RACE_VERSION = 'holding-dbl5-1115-position-race-v1';
export const IMPULSE_1115_POSITION_LABEL = '急拉线-1115';
export function isImpulse1115PositionVersion(version: string | undefined) {
  return version === IMPULSE_1115_POSITION_VERSION || version === IMPULSE_1115_CONFIGURABLE_K_VERSION;
}
// Current chart and settings labels. The original names above also appear in frozen plan metadata.
export const DBL5_GUARD_DISPLAY_NAME = 'DBL-5-防守线';
export const DBL5_GUARD_PLUS_DISPLAY_NAME = 'DBL-5-防守线+急拉线-1115';
export const IMPULSE_1115_DISPLAY_NAME = 'DBL-5-急拉线-1115';
export const DBL5_GUARD_PLUS_PARAMS = Object.freeze({
  interval: '5m', atrPeriod: DBL5_GUARD_DEFAULTS.atr_period, windowBars: 3,
  referenceBars: 69, minIncrements: 14, halfLifeBars: 12, breakoutBars: 3,
  displacementAtr: 1.2, speedAtr: 0.8, speedMultiple: 1.5, efficiency: 0.65, retention: 0.8,
  maxExtensionAtr: 3, pauseBars: 2, pauseAtr: 1, bufferAtr: 0.5, expiryMinutes: 360, freshnessBars: 1,
});
const P = DBL5_GUARD_PLUS_PARAMS;
type Dbl5GuardPlusParams = Readonly<Omit<typeof P, 'bufferAtr'> & {bufferAtr:number}>;
export const dbl5GuardPlusParams = (impulseBufferAtr?: number): Dbl5GuardPlusParams =>
  impulseBufferAtr === undefined ? P : Object.freeze({...P, bufferAtr:impulseBufferAtr});

export type GuardPlusPhase = 'NO_CONTEXT' | 'READY' | 'WATCH' | 'EARLY' | 'ACTIVE' | 'OVEREXTENDED' | 'LATE' | 'BROKEN';
export type GuardPlusSource = 'BASE' | 'IMPULSE' | 'BOTH' | 'NONE';
export type GuardPlusEnd = 'IMPULSE_BROKEN' | 'BASE_BROKEN' | 'IMPULSE_EXPIRED' | 'DATA_GAP' | 'DATA_INVALID';

export interface GuardPlusImpulse {
  impulse_id: string;
  phase_id: string;
  start_time: number;
  detected_at: number;
  available_at: number;
  expires_at: number;
  fresh_until: number;
  bars: number;
  impulse_origin_low: number;
  impulse_guard_value: number;
  frozen_atr: number;
  frozen_mean_up: number;
  net_displacement_atr_at_detection: number;
  speed_atr_per_bar_at_detection: number;
  relative_speed_threshold_at_detection: number;
  body_efficiency_at_detection: number;
  advance_retention_at_detection: number;
  local_breakout_price: number;
  relative_volume_at_detection: number | null;
  volume_basis: 'base-volume' | null;
  algorithm_version: Dbl5GuardPlusVersion;
  effective_parameters: Dbl5GuardPlusParams;
}

interface EndedLine {
  at: number;
  reason: GuardPlusEnd;
  price: number;
  source: GuardPlusSource;
  segment_id: string;
}

export interface Dbl5GuardPlusRow {
  at: number;
  guard_plus_value: number | null;
  base_guard_value: number | null;
  impulse_guard_value: number | null;
  impulse_origin_low: number | null;
  guard_source: GuardPlusSource;
  segment_id: string | null;
  impulse_id: string | null;
  phase_id: string | null;
  phase_state: GuardPlusPhase;
  phase_changed: boolean;
  next_phase_id: string | null;
  early_impulse_event: GuardPlusImpulse | null;
  impulse_active: boolean;
  active_impulse: GuardPlusImpulse | null;
  impulse_broken_event: GuardPlusImpulse | null;
  impulse_expired_event: GuardPlusImpulse | null;
  base_guard_broken_event: boolean;
  line_raised_by_impulse: boolean;
  wick_penetration: boolean;
  origin_wick_penetration: boolean;
  ended_segment: EndedLine | null;
  last_impulse_end: {at:number;reason:'IMPULSE_BROKEN'|'IMPULSE_EXPIRED';impulse:GuardPlusImpulse} | null;
  current_phase_extension: number | null;
  impulse_age_minutes: number | null;
  distance_to_guard_bps: number | null;
  reason: 'DATA_GAP' | 'DATA_INVALID' | 'PHASE_UNKNOWN' | 'INSUFFICIENT_HISTORY' | 'ATR_UNAVAILABLE' | 'NO_MOTION' | 'NO_BREAKOUT' | 'INVALID_GUARD' | null;
  available_at: number;
  algorithm_version: Dbl5GuardPlusVersion;
  effective_parameters: Dbl5GuardPlusParams;
}

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  atr: number | null;
  tr: number;
}
interface Phase {
  id: string;
  start: number;
  price: number;
  atr: number;
  high: number;
  lockedAt: number | null;
  state: GuardPlusPhase;
}
interface Candidate {
  start: number;
  price: number;
  atr: number;
  meanUp: number;
  meanVolume: number | null;
  barrier: number;
}
interface PlusState {
  history: Candle[];
  phase: Phase | null;
  watch: Candidate | null;
  active: GuardPlusImpulse | null;
  lastRow: Dbl5GuardPlusRow | null;
  lastVolume: number | null;
}
export interface Dbl5GuardPlusCheckpoint {
  checkpoint_version: 1;
  identity: string;
  algorithm_version: Dbl5GuardPlusVersion;
  effective_parameters: Dbl5GuardPlusParams;
  base: Dbl5Checkpoint;
  state: PlusState;
}

function reference(bars: readonly Candle[], startIndex: number): Candidate | null {
  const preceding = bars.slice(Math.max(0, startIndex - P.referenceBars), startIndex);
  const last = preceding.at(-1);
  if (preceding.length <= P.minIncrements || !last?.atr) return null;
  let weight = 0, sumUp = 0, sumVolume = 0, hasVolume = true;
  for (let i = 1; i < preceding.length; i++) {
    const w = 2 ** (-(preceding.length - 1 - i) / P.halfLifeBars);
    const volume = preceding[i].volume;
    weight += w;
    sumUp += w * Math.max(0, preceding[i].close - preceding[i - 1].close);
    if (volume === null) hasVolume = false;
    else sumVolume += w * volume;
  }
  return {
    start: bars[startIndex].time, price: last.close, atr: last.atr,
    meanUp: sumUp / weight, meanVolume: hasVolume && sumVolume > 0 ? sumVolume / weight : null,
    barrier: Math.max(...preceding.slice(-P.breakoutBars).map(bar => bar.high)),
  };
}

function motion(window: readonly Candle[], setup: Candidate) {
  const last = window.at(-1)!;
  const previousClose = window.at(-2)?.close ?? setup.price;
  const displacement = last.close - setup.price;
  const range = window.reduce((sum, bar) => sum + bar.tr, 0);
  const high = Math.max(...window.map(bar => bar.high));
  if (range <= 0 || high <= setup.price || last.close <= Math.max(last.open, previousClose)) return null;
  const body = window.reduce((sum, bar) => sum + bar.close - bar.open, 0);
  const x = displacement / setup.atr, speed = x / window.length;
  const minimumSpeed = Math.max(P.speedAtr, P.speedMultiple * setup.meanUp / setup.atr);
  const efficiency = Math.max(body, 0) / range, retention = displacement / (high - setup.price);
  return x >= P.displacementAtr && speed >= minimumSpeed && efficiency >= P.efficiency && retention >= P.retention
    ? {x, speed, minimumSpeed, efficiency, retention} : null;
}

function selectReference(base: number | null, impulse: number | null): {price: number | null; source: GuardPlusSource} {
  if (base === null) return {price: impulse, source: impulse === null ? 'NONE' : 'IMPULSE'};
  if (impulse === null || base > impulse) return {price: base, source: 'BASE'};
  return {price: impulse, source: base === impulse ? 'BOTH' : 'IMPULSE'};
}

/** Research and holding replay share this sequential implementation. The owned native engine advances exactly once. */
export class Dbl5GuardPlusEngine {
  readonly base: Dbl5Engine;
  private readonly identity: string;
  private readonly version: Dbl5GuardPlusVersion;
  private readonly parameters: Dbl5GuardPlusParams;
  private state: PlusState;

  constructor(options: Omit<Dbl5Options, 'checkpoint'> & {checkpoint?: Dbl5GuardPlusCheckpoint; impulseBufferAtr?: number}) {
    const {checkpoint, impulseBufferAtr, ...baseOptions} = options;
    if (impulseBufferAtr !== undefined && (!Number.isFinite(impulseBufferAtr) || impulseBufferAtr < 0)) {
      throw Error('组合版的急拉冗余须为不小于 0 的有限 ATR 倍数');
    }
    this.version = impulseBufferAtr === undefined ? DBL5_GUARD_PLUS_VERSION : DBL5_GUARD_PLUS_CONFIGURABLE_K_VERSION;
    this.parameters = dbl5GuardPlusParams(impulseBufferAtr);
    this.base = new Dbl5Engine({...baseOptions, checkpoint: checkpoint?.base});
    if (dbl5GuardVersion(this.base.config) !== DBL5_GUARD_VERSION) throw Error('急拉-1115 的基线须为防守线 v1');
    const native = this.base;
    this.identity = dbl5Hash([
      this.version, this.parameters, native.config_hash, native.symbol, native.market, native.data_source,
      native.data_version, native.initialization_id, native.initialization_start,
    ]);
    if (checkpoint && (checkpoint.checkpoint_version !== 1 || checkpoint.algorithm_version !== this.version ||
      checkpoint.identity !== this.identity || dbl5Hash(checkpoint.effective_parameters) !== dbl5Hash(this.parameters))) {
      throw Error('急拉-1115 检查点的数据版本、参数或初始化身份不一致');
    }
    this.state = checkpoint ? structuredClone(checkpoint.state) :
      {history: [], phase: null, watch: null, active: null, lastRow: null, lastVolume: null};
  }

  checkpoint(): Dbl5GuardPlusCheckpoint {
    return {
      checkpoint_version: 1, identity: this.identity, algorithm_version: this.version,
      effective_parameters: this.parameters, base: this.base.checkpoint(), state: structuredClone(this.state),
    };
  }

  push(bar: Dbl5Bar): {base: Dbl5Row; plus: Dbl5GuardPlusRow} | null {
    const at = bar.openTime + DBL5_STEP;
    const volume = Number.isFinite(bar.volume) && bar.volume >= 0 ? bar.volume : null;
    if (bar.DBL5_closed !== false && bar.PRS6H_closed !== false && at <= this.base.asOf &&
      at === this.base.last_time && volume !== this.state.lastVolume) {
      throw Error('急拉-1115 同时间戳成交量变化：需修订版本并顺序回放');
    }
    const base = this.base.push(bar);
    if (!base) return null;
    this.state.lastVolume = volume;
    const plus = this.update(bar, base, volume);
    this.state.lastRow = plus;
    return {base, plus};
  }

  private update(bar: Dbl5Bar, base: Dbl5Row, volume: number | null): Dbl5GuardPlusRow {
    const {at} = base, s = this.state, previous = s.lastRow, old = s.active;
    const close = bar.DBL5_prices?.close ?? bar.close;
    const tick = base.tick_size;
    const gap = !base.data_continuous || (previous !== null && at !== previous.at + DBL5_STEP);
    const breakReason = !base.data_valid ? 'DATA_INVALID' : gap ? 'DATA_GAP' : null;
    let ended: GuardPlusEnd | null = breakReason;
    let broken: GuardPlusImpulse | null = null, expired: GuardPlusImpulse | null = null, early: GuardPlusImpulse | null = null;
    let wick = false, originWick = false, phaseChanged = false, extension: number | null = null;
    let reason: Dbl5GuardPlusRow['reason'] = breakReason;
    let rowPhase: GuardPlusPhase = 'NO_CONTEXT';
    let rowPhaseId: string | null = null;

    if (breakReason) {
      s.history = [];
      s.phase = null;
      s.watch = null;
      s.active = null;
    }
    if (base.data_valid && tick) {
      const exact = bar.DBL5_prices ?? bar;
      const toTicks = (value: string | number) => Number(dbl5PriceTicks(value, tick));
      const toPrice = (ticks: number) => dbl5TickPrice(BigInt(ticks), tick);
      const candle = {
        time: bar.openTime, open: toTicks(exact.open), high: toTicks(exact.high), low: toTicks(exact.low),
        close: toTicks(exact.close), volume, atr: this.base.guard.samples >= P.atrPeriod ? this.base.guard.atr : null, tr: 0,
      };
      const preceding = s.history.at(-1);
      candle.tr = preceding
        ? Math.max(candle.high - candle.low, Math.abs(candle.high - preceding.close), Math.abs(candle.low - preceding.close))
        : candle.high - candle.low;
      // Clear the affected segment before any new event can be generated.
      if (old && !breakReason) {
        const oldTicks = toTicks(old.impulse_guard_value);
        wick = candle.low < oldTicks && candle.close >= oldTicks;
        originWick = candle.low < toTicks(old.impulse_origin_low);
        if (candle.close < oldTicks) {
          broken = old;
          ended = 'IMPULSE_BROKEN';
          s.active = null;
        } else {
          if (base.darvas_5m_guard_broken && (previous?.guard_source === 'BASE' || previous?.guard_source === 'BOTH')) ended = 'BASE_BROKEN';
          if (at >= old.expires_at) {
            expired = old;
            s.active = null;
            if ((base.darvas_5m_guard ?? -Infinity) < old.impulse_guard_value) ended ??= 'IMPULSE_EXPIRED';
          }
        }
      }

      const bars = [...s.history, candle], phase = s.phase;
      if (phase) {
        phase.high = Math.max(phase.high, candle.high);
        extension = (phase.high - phase.price) / phase.atr;
        if (ended === 'IMPULSE_BROKEN' || ended === 'BASE_BROKEN') {
          this.lock(phase, at, 'BROKEN');
        } else if (!ended && phase.lockedAt === null) {
          const result = this.detect(bars, phase, at, extension, toPrice);
          early = result.early;
          reason = result.reason;
        }
      } else {
        reason ??= 'PHASE_UNKNOWN';
      }

      rowPhase = phase?.state ?? 'NO_CONTEXT';
      rowPhaseId = phase?.id ?? null;
      // A pause takes effect on the next bar. Neither of its candles can be part of the next impulse.
      const [beforePause, firstPause, secondPause] = bars.slice(-3);
      if (!s.watch && beforePause?.atr && firstPause && secondPause && candle.atr &&
        (phase?.lockedAt == null || firstPause.time >= phase.lockedAt) &&
        Math.max(beforePause.close, firstPause.high, secondPause.high) -
          Math.min(beforePause.close, firstPause.low, secondPause.low) <= P.pauseAtr * beforePause.atr) {
        const id = 'phase-' + dbl5Hash([this.identity, tick, at]);
        s.phase = {id, start: at, price: candle.close, atr: candle.atr, high: candle.close, lockedAt: null, state: 'READY'};
        phaseChanged = true;
      } else if (phase?.state === 'EARLY') {
        phase.state = 'ACTIVE';
      }
      s.history = bars.slice(-(P.referenceBars + P.windowBars - 1));
    }

    const active = s.active;
    const basePrice = base.darvas_5m_guard ?? null;
    const selected = ended ? selectReference(null, null) : selectReference(basePrice, active?.impulse_guard_value ?? null);
    const nativeOnlyBreak = old === null && base.darvas_5m_guard_broken;
    const segment = selected.price === null ? null :
      (!nativeOnlyBreak ? previous?.segment_id : null) ?? 'guard-plus-' + dbl5Hash([this.identity, at]);
    return {
      at, guard_plus_value: selected.price, base_guard_value: basePrice,
      impulse_guard_value: active?.impulse_guard_value ?? null,
      impulse_origin_low: active?.impulse_origin_low ?? null, guard_source: selected.source, segment_id: segment,
      impulse_id: early?.impulse_id ?? active?.impulse_id ?? null, phase_id: rowPhaseId, phase_state: rowPhase, phase_changed: phaseChanged,
      next_phase_id: phaseChanged ? s.phase!.id : null,
      early_impulse_event: early, impulse_active: active !== null, active_impulse: active,
      impulse_broken_event: broken, impulse_expired_event: expired, base_guard_broken_event: base.darvas_5m_guard_broken === true,
      line_raised_by_impulse: early !== null && early.impulse_id === active?.impulse_id &&
        (previous?.guard_plus_value == null || early.impulse_guard_value > previous.guard_plus_value) &&
        (basePrice === null || early.impulse_guard_value > basePrice),
      wick_penetration: wick, origin_wick_penetration: originWick,
      ended_segment: ended && previous?.segment_id && previous.guard_plus_value !== null
        ? {at, reason: ended, price: previous.guard_plus_value, source: previous.guard_source, segment_id: previous.segment_id} : null,
      last_impulse_end: broken ? {at, reason:'IMPULSE_BROKEN', impulse:broken} :
        expired ? {at, reason:'IMPULSE_EXPIRED', impulse:expired} : previous?.last_impulse_end ?? null,
      current_phase_extension: extension, impulse_age_minutes: active ? (at - active.detected_at) / 60_000 : null,
      distance_to_guard_bps: selected.price === null ? null : (Number(close) / selected.price - 1) * 10_000,
      reason, available_at: at, algorithm_version: this.version, effective_parameters: this.parameters,
    };
  }

  private lock(phase: Phase, at: number, state: GuardPlusPhase) {
    phase.lockedAt = at;
    phase.state = state;
    this.state.watch = null;
  }

  private detect(
    bars: readonly Candle[], phase: Phase, at: number, extension: number, toPrice: (ticks: number) => number,
  ): {early: GuardPlusImpulse | null; reason: Dbl5GuardPlusRow['reason']} {
    const watch = this.state.watch;
    const earliest = Math.max(0, bars.length - P.windowBars);
    let reason: Dbl5GuardPlusRow['reason'] = 'INSUFFICIENT_HISTORY';
    for (let i = earliest; i < bars.length; i++) {
      if (bars[i].time < phase.start || watch && bars[i].time !== watch.start) continue;
      const setup = watch ?? reference(bars, i);
      if (!setup) {
        if (i > P.minIncrements && !bars[i - 1]?.atr) reason = 'ATR_UNAVAILABLE';
        continue;
      }
      const window = bars.slice(i), measure = motion(window, setup);
      reason = 'NO_MOTION';
      if (!measure) continue;
      // The longest passing motion window wins, including when it is overextended or has not broken out.
      if (measure.x > P.maxExtensionAtr || extension > P.maxExtensionAtr) {
        this.lock(phase, at, 'OVEREXTENDED');
        return {early: null, reason: null};
      }
      if (window.at(-1)!.close <= setup.barrier) {
        this.state.watch = setup;
        phase.state = 'WATCH';
        reason = 'NO_BREAKOUT';
        break;
      }
      const origin = Math.min(...window.map(bar => bar.low));
      const guard = Math.floor(origin - this.parameters.bufferAtr * setup.atr);
      if (guard < 1) {
        this.lock(phase, at, 'LATE');
        return {early: null, reason: 'INVALID_GUARD'};
      }
      const relativeVolume = setup.meanVolume === null || window.some(bar => bar.volume === null) ? null :
        window.reduce((sum, bar) => sum + bar.volume!, 0) / window.length / setup.meanVolume;
      const early = Object.freeze({
        impulse_id: 'impulse-' + dbl5Hash([phase.id, setup.start]), phase_id: phase.id, start_time: setup.start,
        detected_at: at, available_at: at, expires_at: setup.start + P.expiryMinutes * 60_000,
        fresh_until: at + P.freshnessBars * DBL5_STEP, bars: window.length,
        impulse_origin_low: toPrice(origin), impulse_guard_value: toPrice(guard),
        frozen_atr: setup.atr * Number(this.base.tick_size), frozen_mean_up: setup.meanUp * Number(this.base.tick_size),
        net_displacement_atr_at_detection: measure.x, speed_atr_per_bar_at_detection: measure.speed,
        relative_speed_threshold_at_detection: measure.minimumSpeed, body_efficiency_at_detection: measure.efficiency,
        advance_retention_at_detection: measure.retention, local_breakout_price: toPrice(setup.barrier + 1),
        relative_volume_at_detection: relativeVolume, volume_basis: relativeVolume === null ? null : 'base-volume',
        algorithm_version: this.version, effective_parameters: this.parameters,
      } satisfies GuardPlusImpulse);
      this.lock(phase, at, 'EARLY');
      if (!this.state.active || early.impulse_guard_value > this.state.active.impulse_guard_value) this.state.active = early;
      return {early, reason: null};
    }
    if (extension > P.maxExtensionAtr) this.lock(phase, at, 'OVEREXTENDED');
    else if (this.state.watch && at - this.state.watch.start >= P.windowBars * DBL5_STEP) this.lock(phase, at, 'LATE');
    return {early: null, reason};
  }
}

export const DBL5_GUARD_PLUS_NUMERIC = [
  'DBL5P', 'DBL5P_base', 'DBL5P_impulse', 'DBL5P_origin', 'DBL5P_distance_bps',
  'DBL5P_early', 'DBL5P_overextended', 'DBL5P_broken', 'DBL5P_expired', 'DBL5P_wick', 'DBL5P_phase_change',
] as const;
export const DBL5_GUARD_PLUS_RENDER = ['_DBL5P_segment', '_DBL5P_detected_origin', '_DBL5P_detected_bars', '_DBL5P_end'] as const;
export function guardPlusFieldUnit(name:string):string|undefined {
  if(!DBL5_GUARD_PLUS_NUMERIC.some(field=>field===name))return;
  if(name==='DBL5P_distance_bps')return 'bp';
  return ['DBL5P','DBL5P_base','DBL5P_impulse','DBL5P_origin'].includes(name)?'价格':'事件（0/1）';
}
export function guardPlusNumeric(row: Dbl5GuardPlusRow, name: string): number | null {
  if(row.reason==='DATA_INVALID'&&name!=='_DBL5P_end')return null;
  switch (name) {
    case 'DBL5P': return row.guard_plus_value;
    case 'DBL5P_base': return row.base_guard_value;
    case 'DBL5P_impulse': return row.impulse_guard_value;
    case 'DBL5P_origin': return row.impulse_origin_low;
    case 'DBL5P_distance_bps': return row.distance_to_guard_bps;
    case 'DBL5P_early': return Number(row.early_impulse_event !== null);
    case 'DBL5P_overextended': return Number(row.phase_state === 'OVEREXTENDED');
    case 'DBL5P_broken': return Number(row.impulse_broken_event !== null || row.base_guard_broken_event);
    case 'DBL5P_expired': return Number(row.impulse_expired_event !== null);
    case 'DBL5P_wick': return Number(row.wick_penetration);
    case 'DBL5P_phase_change': return Number(row.phase_changed);
    case '_DBL5P_segment': return row.segment_id ? Number.parseInt(row.segment_id.slice(-12), 16) : null;
    case '_DBL5P_detected_origin': return row.early_impulse_event?.impulse_origin_low ?? null;
    case '_DBL5P_detected_bars': return row.early_impulse_event?.bars ?? null;
    case '_DBL5P_end': return row.ended_segment?.price ?? null;
    default: return null;
  }
}
