import { describe, expect, it } from 'vitest';
import {
  computeDbl5, dbl5ConfigHash, DBL5_RETEST_GUARD_VERSION, DBL5_STEP, type Dbl5Bar, type Dbl5Options,
} from '../dbl5m';
import { createPreEntryGuardReader, nativeGuardEvent } from '../fish/preEntryGuardEvent';
import { emptyPreEntryThreeStage, freezePreEntryThreeStage, retryPreEntryThreeStage } from '../fish/preEntryThreeStage';
import { assertStructureVersionsAvailable, freezeStructureVersions, selectStructureGuardVersion } from '../fish/boxAlgorithmVersions';
import { createStructureAdditionReader, defaultStructureAddition, structureAdditionIdentity, structureAdditionSignal, withGuard } from '../fish/qualityAdditionStructure';
import { withTuringInitialization } from '../fish/qualityInitialization';
import type { TradeSignal } from '../signalLibrary';

const start=Date.UTC(2026,10,12), step=DBL5_STEP;
const bar=(i:number,[high,low,close]:readonly [number,number,number]):Dbl5Bar=>({
  openTime:start+i*step,open:close,high,low,close,volume:1,quoteVolume:1,takerBuyVolume:1,takerBuyQuoteVolume:1,DBL5_tick_size:1,
});
const source=[
  ...Array.from({length:16},()=>[106,102,104] as const),
  [114,106,111],[112,104,107],[112,105,109],[111,106,109],[113,107,110],
  [113,109,112],[113,105,110],[113,108,111],
].map((values,i)=>bar(i,values as [number,number,number]));
const params={symbol:'TESTUSDT',tickSize:1,config:{guard_version:DBL5_RETEST_GUARD_VERSION}} satisfies Dbl5Options;
const legacy=()=>computeDbl5(source,{symbol:params.symbol,tickSize:1});
const pendingIndex=20, retestIndex=22;

describe('防守线-20261112',()=>{
  it('keeps box geometry and waits for a distinct departure and retest before enabling the new guard',()=>{
    const old=legacy().rows, next=computeDbl5(source,params).rows;
    const boxGeometry=(rows:typeof next)=>rows.map(r=>[r.at,r.darvas_5m_lower,r.darvas_5m_upper,r.darvas_5m_event]);
    expect(boxGeometry(next)).toEqual(boxGeometry(old));
    expect(old[pendingIndex].darvas_5m_guard).not.toBeNull();
    expect(next[pendingIndex]).toMatchObject({darvas_5m_lower:104,darvas_5m_guard:null,darvas_5m_guard_waiting:true});
    expect(next[pendingIndex+1].darvas_5m_guard_waiting).toBe(true);
    expect(next[retestIndex].darvas_5m_guard).toBeGreaterThan(0);
    expect(next[retestIndex].darvas_5m_guard_retest).toMatchObject({at:next[retestIndex].at,box_id:next[pendingIndex].box_id});
    expect(next[retestIndex+1].darvas_5m_guard_retest).toBeUndefined();
  });

  it('cannot confirm through adjacent touches without departure or through a wick below the box floor',()=>{
    const waiting=computeDbl5([...source.slice(0,21),bar(21,[112,105,111]),bar(22,[112,105,111])],params);
    expect(waiting.rows.at(-1)).toMatchObject({darvas_5m_guard_waiting:true,darvas_5m_guard:null});
    const broken=computeDbl5([...source.slice(0,22),bar(22,[113,103,110])],params);
    expect(broken.rows.at(-1)).toMatchObject({darvas_5m_event:'SUPPORT_BROKEN',darvas_5m_guard:null});
    expect(broken.checkpoint.guard_retest_pending).toBeUndefined();
    const gap=computeDbl5([...source.slice(0,22),bar(23,[113,105,110])],params);
    expect(gap.rows.at(-1)).toMatchObject({darvas_5m_event:'DATA_GAP',darvas_5m_guard:null});
    expect(gap.checkpoint.guard_retest_pending).toBeUndefined();
  });

  it('keeps the first observation of the final floor when an equal low resets geometry confirmation',()=>{
    const repeated=[...source.slice(0,18),bar(18,[112,104,109]),...source.slice(19,22)];
    const confirmed=computeDbl5(repeated,params).rows.at(-1)!;
    expect(confirmed.active?.first_floor_time).toBe(source[17].openTime+step);
    expect(confirmed.floor_anchor_time).toBe(source[18].openTime+step);
    expect(confirmed.darvas_5m_guard_waiting).toBe(true);
  });

  it('restores both waiting phases at the same timestamps and rejects a legacy checkpoint',()=>{
    const whole=computeDbl5(source,params);
    for(const split of [21,22]){
      const head=computeDbl5(source.slice(0,split),params);
      expect(head.checkpoint.guard_retest_pending?.departed).toBe(split===22);
      const checkpoint=JSON.parse(JSON.stringify(head.checkpoint));
      const tail=computeDbl5(source.slice(split),{...params,checkpoint});
      expect(tail.rows).toEqual(whole.rows.slice(split));
      expect(tail.checkpoint).toEqual(whole.checkpoint);
    }
    expect(()=>computeDbl5([],{...params,checkpoint:legacy().checkpoint})).toThrow();
  });

  it('keeps the earlier guard during a new waiting period and still checks it for breakage',()=>{
    const extended=[...source,[121,112,118],[119,114,117],[119,115,117],[119,116,118],[119,115,117],[116,90,93],[116,90,93]].map((v,i)=>Array.isArray(v)?bar(i,v as [number,number,number]):v);
    const rows=computeDbl5(extended,params).rows;
    const oldGuard=rows[23].darvas_5m_guard;
    expect(oldGuard).toBeGreaterThan(93);
    expect(rows[28]).toMatchObject({darvas_5m_guard_waiting:true,darvas_5m_guard:oldGuard});
    expect(rows[29]).toMatchObject({darvas_5m_guard:oldGuard,darvas_5m_guard_broken:false});
    expect(rows[30]).toMatchObject({darvas_5m_guard:null,darvas_5m_guard_broken:true});
  });

  it('freezes version and identity and releases only a real, later screening or addition event',()=>{
    const old=freezeStructureVersions({...defaultStructureAddition(),trigger:'confirm' as const,kSource:'guard' as const});
    const oldSnapshot=structuredClone(old);
    const rule=freezeStructureVersions(selectStructureGuardVersion(old,DBL5_RETEST_GUARD_VERSION));
    const restored=JSON.parse(JSON.stringify(rule));
    expect(restored.versions.guard).toBe(DBL5_RETEST_GUARD_VERSION);
    expect(restored.definition.DBL5_config.guard_version).toBe(DBL5_RETEST_GUARD_VERSION);
    expect(()=>assertStructureVersionsAvailable(restored)).not.toThrow();
    expect(()=>assertStructureVersionsAvailable({...restored,versions:old.versions})).toThrow(/不一致/);
    expect(structureAdditionIdentity(restored)).not.toEqual(structureAdditionIdentity(old));
    expect(dbl5ConfigHash(restored.definition.DBL5_config)).toBe(dbl5ConfigHash(params.config));
    expect(dbl5ConfigHash({...restored.definition.DBL5_config,guard_range_atr:2})).not.toBe(dbl5ConfigHash(params.config));
    expect(old).toEqual(oldSnapshot);
    const rows=computeDbl5(source,params).rows;
    const before=rows[pendingIndex],ret=rows[retestIndex];
    expect(nativeGuardEvent(rows[pendingIndex-1],before,start)).toBeUndefined();
    expect(nativeGuardEvent(rows[retestIndex-1],ret,start)).toMatchObject({at:ret.at,guardVersion:DBL5_RETEST_GUARD_VERSION});
    expect(withGuard(structureAdditionSignal(restored,before,start)!,before)).toBeUndefined();
    const evidence=structureAdditionSignal(restored,ret,start)!;
    expect(withGuard(evidence,ret)).toMatchObject({event:'GUARD_RETEST',at:ret.at,confirmedAt:ret.at,guardPrice:ret.darvas_5m_guard});
    expect(structureAdditionSignal({...restored,kSource:'current'},ret,start)).toBeUndefined();
  });

  it('feeds actual screening and addition readers only when the closed retest exists',async()=>{
    const row={symbol:'TURING:TURING 1'} as TradeSignal;
    const load=withTuringInitialization(async(_row,from,to)=>source.filter(x=>x.openTime>=from&&x.openTime<to),row.symbol,start);
    const signal=new AbortController().signal;
    const entry=start+17*step,end=start+source.length*step;
    const candidateAt=source[pendingIndex].openTime+step,retestAt=source[retestIndex].openTime+step;
    const config=retryPreEntryThreeStage(emptyPreEntryThreeStage());
    config.guard.rule.structure=selectStructureGuardVersion(config.guard.rule.structure,DBL5_RETEST_GUARD_VERSION);
    const screen=createPreEntryGuardReader({config:freezePreEntryThreeStage(config),row,start:entry,load,signal});
    expect(await screen(candidateAt)).toMatchObject({broken:false});
    expect((await screen(candidateAt+step)).event).toBeUndefined();
    expect((await screen(retestAt)).event).toMatchObject({at:retestAt,guardVersion:DBL5_RETEST_GUARD_VERSION});
    const add=createStructureAdditionReader({row,entry,end,load,signal});
    const rule=selectStructureGuardVersion({...defaultStructureAddition(),trigger:'confirm',kSource:'guard'},DBL5_RETEST_GUARD_VERSION);
    const blocked:number[]=[];
    expect(await add(rule,entry,candidateAt+step,[],undefined,x=>{if(x.reason==='guard-retest')blocked.push(x.at);})).toBeUndefined();
    expect(blocked).toEqual([candidateAt]);
    expect(await add(rule,entry,end,[])).toMatchObject({at:retestAt,structureEvidence:{event:'GUARD_RETEST',confirmedAt:retestAt}});
  });
});
