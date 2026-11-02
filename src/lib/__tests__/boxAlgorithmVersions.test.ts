/**
 * 【用户要求】2026-11-02 箱体算法版本保护：用固定 K 线锁住每个版本的输出。
 * 这里的期望值不能改——改了算法逻辑请新开版本号（boxAlgorithmVersions.ts 加一条），旧版本代码与本测试保持不动。
 */
import {describe,it,expect} from 'vitest';
import {computeDbl5,DBL5_STEP,DBL5_VERSION,DBL5_GUARD_VERSION,type Dbl5Bar} from '../dbl5m';
import {computeSbs5m,SBS5M_VERSION} from '../sbs5m';
import {sbsComplete} from './fixtures/sbsBars';
import {shortFishHash} from '../fish/algorithm';
import {BOX_ALGORITHM_VERSIONS,CURRENT_BOX_VERSION,CURRENT_GUARD_VERSION,assertStructureVersionsAvailable,freezeStructureVersions,structureVersionLabel,structureVersions} from '../fish/boxAlgorithmVersions';
import {defaultStructureAddition,structureAdditionLabel} from '../fish/qualityAdditionStructure';
const T=Date.UTC(2026,0,5);
function walk(seed=7,n=900):Dbl5Bar[]{let x=seed,price=10000;const rnd=()=>((x=(x*1103515245+12345)%2147483648)/2147483648);
 return Array.from({length:n},(_,i)=>{const phase=i<200?'chop':i<500?'trend':'range',drift=phase==='trend'?6:phase==='range'?(10000+1800-price)*.02:0;
  const open=price,close=Math.max(100,Math.round(open+drift+(rnd()-.5)*60)),wick=phase==='range'&&rnd()<.08?120:20;
  const high=Math.max(open,close)+Math.round(rnd()*20),low=Math.max(1,Math.min(open,close)-Math.round(rnd()*wick));price=close;
  return {openTime:T+i*DBL5_STEP,open,high,low,close,volume:1,quoteVolume:null,takerBuyVolume:null,takerBuyQuoteVolume:null,DBL5_closed:true,DBL5_tick_size:1};});}

describe('箱体算法版本锁',()=>{
 it('code version ids match the registry',()=>{
  expect([DBL5_VERSION,SBS5M_VERSION,DBL5_GUARD_VERSION]).toEqual([CURRENT_BOX_VERSION.dbl5,CURRENT_BOX_VERSION.sbs5m,CURRENT_GUARD_VERSION]);
  for(const id of [DBL5_VERSION,SBS5M_VERSION,DBL5_GUARD_VERSION])expect(BOX_ALGORITHM_VERSIONS.find(v=>v.id===id)?.rules.length).toBeGreaterThan(0);
 });
 it('DBL-5 v2 box output is frozen',()=>{
  const rows=computeDbl5(walk(),{symbol:'TESTUSDT',tickSize:1,config:{}}).rows;
  expect(shortFishHash(JSON.stringify(rows.map(r=>[r.at,r.darvas_5m_lower,r.darvas_5m_upper,r.darvas_5m_event,r.darvas_5m_status])))).toBe('15z82ik1qaui04');
 });
 it('防守线 v1 output (defaults 0.5 / 1 ATR, 1 / 2 closes) is frozen',()=>{
  const rows=computeDbl5(walk(),{symbol:'TESTUSDT',tickSize:1,config:{}}).rows;
  expect(shortFishHash(JSON.stringify(rows.map(r=>[r.at,r.darvas_5m_guard,r.darvas_5m_guard_regime,r.darvas_5m_guard_closes,r.darvas_5m_guard_broken])))).toBe('32koj51r8bh1l');
 });
 it('SBS-5M v1 output is frozen',()=>{
  expect(shortFishHash(JSON.stringify(computeSbs5m(sbsComplete(),{symbol:'TESTUSDT',tickSize:.1}).rows))).toBe('wef7icxdc3hw');
 });
 it('freezes the version and explicit guard parameters on save, and refuses versions without an implementation',()=>{
  const r=defaultStructureAddition('dbl5');
  expect(structureVersions(r)).toEqual({box:'dbl-5-v2'});expect(structureVersionLabel(r)).toBe('DBL-5 v2');expect(structureAdditionLabel(r)).toMatch(/^DBL-5 v2 · /);
  const g=freezeStructureVersions({...r,kSource:'guard' as const});
  expect(g.versions).toEqual({box:'dbl-5-v2',guard:'dbl5-guard-v1'});expect(structureVersionLabel(g)).toBe('DBL-5 v2 · 防守线 v1');
  expect(g.definition.DBL5_config).toMatchObject({guard_trend_atr:.5,guard_range_atr:1,guard_range_closes:2});
  expect(structureVersions(defaultStructureAddition('sbs5m'))).toEqual({box:'sbs-5m-v1'});
  expect(()=>assertStructureVersionsAvailable({...r,versions:{box:'dbl-5-v1'}} as never)).toThrow('dbl-5-v1');
  expect(()=>assertStructureVersionsAvailable({...g,versions:{box:'dbl-5-v2',guard:'dbl5-guard-v9'}} as never)).toThrow('dbl5-guard-v9');
 });
});
