import {describe,it,expect,vi,beforeEach} from 'vitest';
import {mergeFishSignals,fishDedupKey,migrateFishSignal} from '@/lib/fish/records';
import {constraintFingerprint} from '@/lib/fish/algorithm';
import {mergeSignals,type TradeSignal} from '@/lib/signalLibrary';
import {loadFishSignals,saveFishSignals,FISH_STORAGE_KEY,fishSignalTitle} from '@/lib/fishSignals';
vi.mock('@/lib/simStateSync',()=>({queueSimStatePush:vi.fn()}));
const old:TradeSignal={id:'legacy-id',symbol:'AAAUSDT',timeMs:1000,timeLabel:'2026-01-01 08:00:00',fallbackZone:'',quality:4,fish:{average:.4,cbi2:.5,startAverage:.35,previousAverage:.25,threshold:.3,cutoffMs:1000}};
beforeEach(()=>localStorage.clear());
describe('鱼的算法去重与迁移',()=>{
 it('旧记录自动按原阈值迁移，无约束，不丢评分，重复载入/保存不产生重复',()=>{
  localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify([old,{...old,id:'duplicate'}]));const first=loadFishSignals();expect(first).toHaveLength(1);expect(first[0]).toMatchObject({quality:4,fish:{featureId:'cbi2',H:24,direction:'>',threshold:.3,constraints:[],value:.5,scale:1}});saveFishSignals(first,null);expect(loadFishSignals()).toEqual(first);expect(mergeFishSignals(first,[old])).toEqual(first);
 });
 it('同一时刻、不同算法/阈值/方向/约束各一条，普通信号库仍用自己的去重',()=>{
  const a=migrateFishSignal(old);const others=[{...old,fish:{...old.fish!,featureId:'custom',featureShort:'Z'}},{...old,fish:{...old.fish!,threshold:.2}},{...old,fish:{...old.fish!,direction:'<' as const}},{...old,fish:{...old.fish!,constraints:['X > 0']}}];
  const merged=mergeFishSignals([a],others);expect(merged).toHaveLength(5);expect(new Set(merged.map(s=>s.id)).size).toBe(5);expect(new Set(merged.map(fishDedupKey)).size).toBe(5);expect(mergeFishSignals(merged,others)).toHaveLength(5);expect(mergeSignals([],merged)).toHaveLength(1);
 });
 it('同算法各交易所互不覆盖，加入信号库保留原交易所去重约定；完整快照可读',()=>{
  const merged=mergeFishSignals([old],[{...old,exchange:'gate'},{...old,exchange:'okx'}]);expect(merged).toHaveLength(3);expect(mergeSignals([],merged)).toHaveLength(3);expect(fishSignalTitle(merged[0])).toContain('完整快照');expect(fishSignalTitle(merged[0])).toContain('definitionKey');
 });
 it('首尾/连续空白等价，顺序不同有不同指纹，禁用约束由编译器从列表中排除',()=>{
  expect(constraintFingerprint(['  X  > 0  ','avg(X,3) > 1'])).toBe(constraintFingerprint(['X > 0','avg(X,3) > 1']));expect(constraintFingerprint(['X > 0','B > 0'])).not.toBe(constraintFingerprint(['B > 0','X > 0']));
 });
});
