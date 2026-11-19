import {DBL5_GUARD_DEFAULTS, DBL5_GUARD_RETEST, DBL5_STEP, dbl5Hash, type Dbl5Bar} from './dbl5m';
import type {Dbl5GuardPlusRow, GuardPlusImpulse} from './dbl5GuardPlus';

/** An observation layer. Never changes the native impulse, reference or execution rules. */
export const IMPULSE_1115_CLASSIFICATION_VERSION = 'impulse-1115-holding-classification-v1';
export const IMPULSE_1115_CLASSIFICATION_CHART_ID = 'DBL5_IMPULSE_1115_STATES';
export const IMPULSE_1115_CLASSIFICATION_LABEL = 'DBL-5-急拉线-1115 · 持仓分类';
export const IMPULSE_1115_CLASSIFICATION_DEFAULTS = Object.freeze({
  nearAtr: DBL5_GUARD_RETEST.nearAtr,
  departureAtr: DBL5_GUARD_RETEST.departureAtr,
  pivotBars: 1,
  weakeningTests: 3,
  weakeningAtr: 0,
  breakCloses: DBL5_GUARD_DEFAULTS.guard_range_closes,
  reclaimCloses: DBL5_GUARD_DEFAULTS.guard_trend_closes,
  quickReclaimBars: 2,
});
export type Impulse1115ClassificationParams = {readonly [K in keyof typeof IMPULSE_1115_CLASSIFICATION_DEFAULTS]: number};
export const IMPULSE_1115_CLASSIFICATION_PARAMETERS: readonly {
  key: keyof Impulse1115ClassificationParams; label: string; unit: string; min: number; max: number; integer?: boolean;
}[] = [
  {key:'nearAtr',label:'回踩附近容差',unit:'ATR',min:0,max:10},
  {key:'departureAtr',label:'独立离开距离',unit:'ATR',min:0,max:20},
  {key:'pivotBars',label:'局部高点右侧确认',unit:'根 5m K 线',min:1,max:10,integer:true},
  {key:'weakeningTests',label:'反弹递减独立测试数',unit:'次',min:2,max:10,integer:true},
  {key:'weakeningAtr',label:'每次反弹至少降低',unit:'ATR（0＝严格降低）',min:0,max:10},
  {key:'breakCloses',label:'有效跌破连续收盘',unit:'根 5m K 线',min:1,max:20,integer:true},
  {key:'reclaimCloses',label:'收复连续收盘',unit:'根 5m K 线',min:1,max:20,integer:true},
  {key:'quickReclaimBars',label:'快速收回最长间隔',unit:'根 5m K 线（同根为0）',min:0,max:20,integer:true},
];
export function impulse1115ClassificationParams(input: Partial<Impulse1115ClassificationParams> = {}): Impulse1115ClassificationParams {
  for (const key of Object.keys(input)) {
    if (!IMPULSE_1115_CLASSIFICATION_PARAMETERS.some(p => p.key === key)) throw Error('未知的急拉持仓分类参数：' + key);
  }
  const p = {...IMPULSE_1115_CLASSIFICATION_DEFAULTS, ...input};
  for (const spec of IMPULSE_1115_CLASSIFICATION_PARAMETERS) {
    const value = p[spec.key];
    if (!Number.isFinite(value) || value < spec.min || value > spec.max || spec.integer && !Number.isSafeInteger(value)) {
      throw Error(spec.label + '须为 ' + spec.min + '–' + spec.max + ' 范围内的' + (spec.integer ? '整数' : '有限数字'));
    }
  }
  if (p.departureAtr <= p.nearAtr) throw Error('独立离开距离须大于回踩附近容差');
  return Object.freeze(p);
}

export const IMPULSE_1115_STATUS = {
  UNTESTED: '延续未回踩 · 尚未受测',
  ORIGIN_WAIT: '起点下方运行，等待回踩或收复',
  FIRST_TEST: '首次回踩中，等待向上确认',
  TESTING: '回踩中，等待向上确认',
  REBOUND: '已反弹，等待局部反弹高点突破',
  HELD: '回踩守住并转强',
  WEAKENING: '反弹减弱',
  PIERCED: '已刺穿，等待快速收回或跌破确认',
  QUICK_RECLAIM: '短暂刺穿，迅速收回',
  SLOW_RECLAIM: '刺穿后收回，等待再次回踩确认',
  BROKEN: '已跌破，等待反抽结果',
  BELOW_RETEST: '线下反抽中，等待反抽结果',
  FAILED_RETEST: '反抽失败',
  RECLAIMED: '已收复，等待离开后再次回踩',
  REPAIR_TEST: '收复后回踩中，等待守住确认',
  REPAIRED: '修复确认',
  DATA_GAP: '行情不连续，暂停此线判定',
} as const;
export type Impulse1115Status = keyof typeof IMPULSE_1115_STATUS;
export const IMPULSE_1115_STATUS_CODES = Object.keys(IMPULSE_1115_STATUS) as Impulse1115Status[];
export type Impulse1115Case = 1 | 2 | 3 | 4 | 5 | 6;
export const impulse1115MainClass = (value: Impulse1115Case): 1 | 2 => value <= 2 ? 1 : 2;
export interface Impulse1115ClassificationEvent {
  at: number;
  mainClass: 1 | 2;
  case: Impulse1115Case | null;
  status: Impulse1115Status;
  tests: number;
}
export interface Impulse1115Test {
  at: number;
  departedAt: number | null;
  peak: number | null;
  peakAt: number | null;
  peakConfirmedAt: number | null;
}
export interface Impulse1115LineClassification extends Impulse1115ClassificationEvent {
  lineId: string;
  detectedAt: number;
  price: number;
  frozenAtr: number;
  available: boolean;
  piercedAt: number | null;
  brokenAt: number | null;
  reclaimedAt: number | null;
  history: readonly Impulse1115ClassificationEvent[];
  testHistory: readonly Impulse1115Test[];
  version: typeof IMPULSE_1115_CLASSIFICATION_VERSION;
}
export interface Impulse1115ClassificationRow {
  at: number;
  current: Impulse1115LineClassification | null;
  lines: readonly Impulse1115LineClassification[];
  reference: number | null;
}
interface LineState {
  impulse: GuardPlusImpulse;
  tick: number;
  status: Impulse1115Status;
  case: Impulse1115Case | null;
  mainClass: 1 | 2;
  statusAt: number;
  available: boolean;
  piercedAt: number | null;
  brokenAt: number | null;
  reclaimedAt: number | null;
  latestPierceAt: number | null;
  belowRun: number;
  aboveRun: number;
  repairNeeded: boolean;
  repairDeparted: boolean;
  belowDeparted: boolean;
  belowRetest: {at:number;low:number;high:number} | null;
  tests: Impulse1115Test[];
  pivot: {high:number;at:number} | null;
  recent: {at:number;high:number}[];
  history: Impulse1115ClassificationEvent[];
}
export interface Impulse1115ClassificationCheckpoint {
  version: typeof IMPULSE_1115_CLASSIFICATION_VERSION;
  identity: string;
  params: Impulse1115ClassificationParams;
  lastAt: number | null;
  lastSignature: string | null;
  lines: LineState[];
}

/** All evidence is frozen at a completed 5m close. Every native impulse keeps its own history,
 * including after the original line breaks/expires. Missing data suspends that line permanently. */
export class Impulse1115ClassificationEngine {
  readonly params: Impulse1115ClassificationParams;
  private readonly identity: string;
  private states: LineState[];
  private lastAt: number | null;
  private lastSignature: string | null;
  private snapshots = new WeakMap<LineState,Impulse1115LineClassification>();
  private previousLines: readonly Impulse1115LineClassification[] = [];
  constructor(options: {
    params?: Partial<Impulse1115ClassificationParams>;
    identity?: string;
    checkpoint?: Impulse1115ClassificationCheckpoint;
  } = {}) {
    this.params = impulse1115ClassificationParams(options.params);
    this.identity = dbl5Hash([IMPULSE_1115_CLASSIFICATION_VERSION, this.params, options.identity ?? 'standalone']);
    const cp = options.checkpoint;
    if (cp && (cp.version !== IMPULSE_1115_CLASSIFICATION_VERSION || cp.identity !== this.identity ||
      dbl5Hash(cp.params) !== dbl5Hash(this.params))) throw Error('急拉持仓分类检查点的版本、参数或数据身份不一致');
    this.states = cp ? structuredClone(cp.lines) : [];
    this.lastAt = cp?.lastAt ?? null;
    this.lastSignature = cp?.lastSignature ?? null;
  }
  checkpoint(): Impulse1115ClassificationCheckpoint {
    return structuredClone({version:IMPULSE_1115_CLASSIFICATION_VERSION,identity:this.identity,params:this.params,
      lastAt:this.lastAt,lastSignature:this.lastSignature,lines:this.states});
  }
  lines(): readonly Impulse1115LineClassification[] {
    const next=this.states.map(s=>this.snapshot(s));
    if(next.length===this.previousLines.length&&next.every((s,i)=>s===this.previousLines[i]))return this.previousLines;
    this.previousLines=next;
    return next;
  }
  private snapshot(s: LineState): Impulse1115LineClassification {
    const previous=this.snapshots.get(s);
    // Rebound peaks keep evolving internally. Publish their frozen evidence when a status or
    // test-count changes; do not retain a new copy of every old line on every higher candle.
    if(previous&&previous.history===s.history&&previous.tests===s.tests.length&&previous.available===s.available&&
      previous.piercedAt===s.piercedAt&&previous.brokenAt===s.brokenAt&&previous.reclaimedAt===s.reclaimedAt)return previous;
    const next:Impulse1115LineClassification={lineId:s.impulse.impulse_id,detectedAt:s.impulse.detected_at,price:s.impulse.impulse_guard_value,
      frozenAtr:s.impulse.frozen_atr,at:s.statusAt,mainClass:s.mainClass,case:s.case,status:s.status,tests:s.tests.length,
      available:s.available,piercedAt:s.piercedAt,brokenAt:s.brokenAt,reclaimedAt:s.reclaimedAt,
      history:s.history,testHistory:s.tests,version:IMPULSE_1115_CLASSIFICATION_VERSION};
    this.snapshots.set(s,next);
    return next;
  }
  private set(s: LineState, at: number, status: Impulse1115Status, value: Impulse1115Case | null, mainClass: 1 | 2) {
    if (s.status === status && s.case === value && s.mainClass === mainClass && s.history.length) return;
    s.status = status; s.case = value; s.mainClass = mainClass; s.statusAt = at;
    s.history = [...s.history, Object.freeze({at,status,case:value,mainClass,tests:s.tests.length})];
  }
  push(bar: Dbl5Bar, source: Dbl5GuardPlusRow, tickSize: string | number): Impulse1115ClassificationRow | null {
    if (bar.DBL5_closed === false || bar.PRS6H_closed === false) return null;
    const at = bar.openTime + DBL5_STEP;
    if (source.at !== at || source.available_at > at) throw Error('分类只读取同根已收盘的原生急拉证据');
    const signature = dbl5Hash([bar, source]);
    if (this.lastAt !== null && at < this.lastAt) throw Error('急拉持仓分类须逐根顺序回放');
    if (at === this.lastAt) {
      if (signature !== this.lastSignature) throw Error('同根分类输入已修订，须从冻结起点重放');
      return this.row(at, source);
    }
    const valid = Number.isFinite(Number(tickSize)) && Number(tickSize) > 0 &&
      [bar.open,bar.high,bar.low,bar.close].every(v => Number.isFinite(v) && v > 0) &&
      bar.high >= Math.max(bar.open,bar.close,bar.low) && bar.low <= Math.min(bar.open,bar.close) &&
      source.reason !== 'DATA_INVALID' && source.reason !== 'DATA_GAP';
    const gap = this.lastAt !== null && at !== this.lastAt + DBL5_STEP;
    if (!valid || gap) for (const s of this.states) if (s.available) {
      s.available = false; this.set(s,at,'DATA_GAP',null,s.mainClass);
    }
    if (valid && !gap) {
      for (const s of this.states) if (s.available) this.advance(s,bar,at);
      const impulse = source.early_impulse_event;
      if (impulse && impulse.available_at === at && impulse.detected_at === at &&
        !this.states.some(s => s.impulse.impulse_id === impulse.impulse_id)) {
        const s: LineState = {impulse:structuredClone(impulse),tick:Number(tickSize),status:'UNTESTED',case:1,mainClass:1,
          statusAt:at,available:true,piercedAt:null,brokenAt:null,reclaimedAt:null,latestPierceAt:null,
          belowRun:0,aboveRun:0,repairNeeded:false,repairDeparted:false,belowDeparted:false,belowRetest:null,
          tests:[],pivot:null,recent:[],history:[]};
        this.set(s,at,'UNTESTED',1,1);
        this.states.push(s);
        // The formation candle is never its own later pullback.
      }
    }
    this.lastAt = at; this.lastSignature = signature;
    return this.row(at,source);
  }
  private row(at: number, source: Dbl5GuardPlusRow): Impulse1115ClassificationRow {
    const lines = this.lines();
    return {at,current:lines.at(-1) ?? null,lines,reference:source.impulse_guard_value};
  }
  private advance(s: LineState, b: Dbl5Bar, at: number) {
    const p = this.params, price = s.impulse.impulse_guard_value, atr = s.impulse.frozen_atr;
    const near = price + Math.floor(p.nearAtr * atr / s.tick + 1e-9) * s.tick;
    const nearBelow = price - Math.floor(p.nearAtr * atr / s.tick + 1e-9) * s.tick;
    const departure = Math.ceil(p.departureAtr * atr / s.tick - 1e-9) * s.tick;
    const pierced = b.low < price - s.tick / 2;
    const below = b.close < price - s.tick / 2, above = b.close > price + s.tick / 2;
    s.belowRun = below ? s.belowRun + 1 : 0;
    s.aboveRun = above ? s.aboveRun + 1 : 0;
    if (pierced) {
      s.piercedAt ??= at;
      s.latestPierceAt ??= at;
    }
    if (s.belowRun >= p.breakCloses) {
      if (s.brokenAt === null || s.reclaimedAt !== null) {
        s.brokenAt ??= at; s.reclaimedAt = null; s.belowRetest = null; s.belowDeparted = false;
        s.pivot = null; s.recent = [];
      }
      s.repairNeeded = true; s.repairDeparted = false;
    }
    if (s.brokenAt !== null || s.repairNeeded) {
      if (above && s.aboveRun >= p.reclaimCloses && s.reclaimedAt === null) {
        s.reclaimedAt = at; s.repairDeparted = false; s.belowRetest = null;
        this.set(s,at,'RECLAIMED',null,2);
        return;
      }
      if (s.reclaimedAt !== null) {
        if (below) {
          s.reclaimedAt = null; s.repairDeparted = false; s.belowRetest = null;
          this.set(s,at,'BROKEN',null,2);
          return;
        }
        if (s.status === 'REPAIRED' && !pierced) return;
        if (pierced) { s.repairDeparted = false; this.set(s,at,'REPAIR_TEST',null,2); return; }
        if (s.repairDeparted && b.low <= near + s.tick / 2) {
          if (b.close > near + s.tick / 2) this.set(s,at,'REPAIRED',6,2);
          else this.set(s,at,'REPAIR_TEST',null,2);
        } else {
          if (b.low > near + s.tick / 2 && b.close >= price + departure - s.tick / 2) s.repairDeparted = true;
          if (s.status !== 'REPAIR_TEST') this.set(s,at,'RECLAIMED',null,2);
        }
        return;
      }
      const retest = s.belowRetest;
      if (retest && at > retest.at && b.close < retest.low - s.tick / 2 &&
        b.close <= price - departure + s.tick / 2 && b.high < retest.high - s.tick / 2) {
        this.set(s,at,'FAILED_RETEST',5,2); s.belowRetest = null; return;
      }
      // A distinct bar below the nearby zone must precede an underside retest.
      if (s.belowDeparted && at > (s.brokenAt ?? s.latestPierceAt!) && b.high >= nearBelow - s.tick / 2 && !above) {
        s.belowRetest ??= {at,low:b.low,high:b.high};
        this.set(s,at,'BELOW_RETEST',null,2); return;
      }
      if (b.high < nearBelow - s.tick / 2 && b.close <= price - departure + s.tick / 2) s.belowDeparted = true;
      if (s.status !== 'FAILED_RETEST') this.set(s,at,'BROKEN',null,2);
      return;
    }
    if (s.latestPierceAt !== null) {
      const age = (at - s.latestPierceAt) / DBL5_STEP;
      if (above && s.aboveRun >= p.reclaimCloses) {
        if (age <= p.quickReclaimBars) {
          s.latestPierceAt = null;
          this.set(s,at,'QUICK_RECLAIM',4,2);
        } else {
          s.repairNeeded = true; s.reclaimedAt = at; s.repairDeparted = false;
          this.set(s,at,'SLOW_RECLAIM',null,2);
        }
      } else this.set(s,at,'PIERCED',null,2);
      return;
    }
    // A prior penetration cannot turn into case 2, but later independent weakening can still be observed.
    const piercedBefore = s.piercedAt !== null;
    const current = s.tests.at(-1);
    const newTest = b.low <= near + s.tick / 2 && (!current || current.departedAt !== null && at > current.departedAt);
    if (newTest) {
      s.tests = [...s.tests,{at,departedAt:null,peak:null,peakAt:null,peakConfirmedAt:null}];
      s.pivot = null; s.recent = [];
      if(!piercedBefore)this.set(s,at,s.tests.length === 1 ? 'FIRST_TEST' : 'TESTING',null,s.mainClass);
      return;
    }
    if (!current) {
      if(!piercedBefore){
        if(b.close < s.impulse.impulse_origin_low - s.tick/2)this.set(s,at,'ORIGIN_WAIT',null,2);
        else this.set(s,at,'UNTESTED',1,1);
      }
      return;
    }
    // Adjacent touches before departure remain one test.
    const t = {...current};
    if (b.low > near + s.tick / 2 && b.close >= price + departure - s.tick / 2) t.departedAt ??= at;
    if (t.departedAt !== null && (t.peak === null || b.high >= t.peak)) {
      t.peak = b.high; t.peakAt = at; t.peakConfirmedAt = null;
    } else if (t.peakAt !== null && at - t.peakAt >= p.pivotBars * DBL5_STEP) {
      t.peakConfirmedAt ??= at;
    }
    const recent = [...s.recent,{at,high:b.high}];
    // A local rebound high is confirmed only after its right-hand bars have closed.
    const pivot = recent[recent.length - p.pivotBars - 1];
    if (pivot && recent.slice(-p.pivotBars).every(r => r.high < pivot.high - s.tick / 2) &&
      recent.slice(Math.max(0,recent.length - 2*p.pivotBars - 1),recent.length - p.pivotBars - 1).every(r => r.high <= pivot.high)) {
      s.pivot = {high:pivot.high,at};
    }
    s.recent = recent.slice(-(2*p.pivotBars + 1));
    if(t.departedAt!==current.departedAt||t.peak!==current.peak||t.peakAt!==current.peakAt||t.peakConfirmedAt!==current.peakConfirmedAt)
      s.tests = [...s.tests.slice(0,-1),t];
    const completed = s.tests.filter(test => test.peakConfirmedAt !== null).slice(-p.weakeningTests);
    if (completed.length >= p.weakeningTests && completed.every((test,i) => i === 0 ||
      completed[i-1].peak! - test.peak! > Math.max(s.tick / 2,p.weakeningAtr * atr - s.tick / 2))) {
      this.set(s,at,'WEAKENING',3,2);
    } else if (!piercedBefore && s.pivot && at > s.pivot.at && b.low > near + s.tick / 2 &&
      b.close > s.pivot.high + s.tick / 2 && t.departedAt !== null) {
      this.set(s,at,'HELD',2,1);
    } else if (!piercedBefore && s.status !== 'HELD' && s.status !== 'WEAKENING' && t.departedAt !== null) {
      this.set(s,at,'REBOUND',null,s.mainClass);
    }
  }
}

export const IMPULSE_1115_CLASSIFICATION_FIELDS = [
  'DBL5C','DBL5C_state','DBL5C_status','DBL5C_line','DBL5C_reference','DBL5C_tests','DBL5C_pierced',
  'DBL5C_changed','DBL5C_detected_at','DBL5C_valid',
] as const;
export function impulse1115ClassificationNumeric(row: Impulse1115ClassificationRow, name: string): number | null {
  const s = row.current;
  if (name === 'DBL5C_reference') return row.reference;
  if (!s) return null;
  if (name === 'DBL5C_valid') return Number(s.available);
  if (name === 'DBL5C_status') return IMPULSE_1115_STATUS_CODES.indexOf(s.status) + 1;
  if (name === 'DBL5C_line') return s.price;
  if (name === 'DBL5C_detected_at') return s.detectedAt;
  if (!s.available) return null;
  switch (name) {
    case 'DBL5C': return s.mainClass;
    case 'DBL5C_state': return s.case ?? 0;
    case 'DBL5C_tests': return s.tests;
    case 'DBL5C_pierced': return Number(s.piercedAt !== null);
    case 'DBL5C_changed': return Number(s.at === row.at);
    default: return null;
  }
}
export const impulse1115ClassificationText = (s: Pick<Impulse1115LineClassification,'mainClass'|'status'>) =>
  (s.mainClass === 1 ? '一类｜' : '二类｜') + IMPULSE_1115_STATUS[s.status];
