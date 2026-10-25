import {expect,it,vi,beforeEach} from 'vitest';
import {archiveFishForNextRound,mergeFishSignals,collapseVisibleFish,fishDedupKey,fishVisibleKey} from '@/lib/fish/records';
import {mergeFishLists,applyFishTombstones} from '@/lib/fish/tombstones';
import {loadFishSignals,saveFishSignals,recordFishDeletion} from '@/lib/fishSignals';
import type {TradeSignal} from '@/lib/signalLibrary';
vi.mock('@/lib/simStateSync',()=>({queueSimStatePush:vi.fn()}));
const fish:TradeSignal={id:'first',symbol:'AAAUSDT',timeMs:1,timeLabel:'2026-10-25 08:00:00',fallbackZone:'',freshCatch:true,caughtAt:100,quality:4,fish:{featureId:'state',featureShort:'S',statistic:'state',average:.71,cbi2:.71,startAverage:.71,previousAverage:.69,threshold:.7,cutoffMs:2}};
beforeEach(()=>localStorage.clear());
it('archives without mutating snapshots; each round has its own stable key and survives reload/dedup',()=>{
 const before=JSON.stringify(fish),one=archiveFishForNextRound([fish],200)[0];
 const two=archiveFishForNextRound([{...fish,caughtAt:250}],300)[0];
 const current={...fish,caughtAt:301};
 expect(JSON.stringify(fish)).toBe(before);expect(one.freshCatch).toBeUndefined();expect(one.fish).toBe(fish.fish);
 const rows=collapseVisibleFish(mergeFishSignals([one,two],[current]));
 expect(rows).toHaveLength(3);expect(new Set(rows.map(fishDedupKey)).size).toBe(3);expect(new Set(rows.map(fishVisibleKey)).size).toBe(3);
 expect(saveFishSignals(rows,null)).toBe(true);expect(loadFishSignals()).toEqual(rows);
 expect(archiveFishForNextRound(rows.filter(s=>s.fishArchive))).toEqual(rows.filter(s=>s.fishArchive));
});
it('cloud union keeps every round, rejects the archived occurrence’s stale fresh flag, and keeps other new captures',()=>{
 const archive=archiveFishForNextRound([fish],200)[0],newer={...fish,caughtAt:201};
 expect(mergeFishLists([archive],[fish])).toHaveLength(1);
 expect(mergeFishLists([newer,archive],[fish])).toHaveLength(2);
 expect(mergeFishLists([fish],[archive,newer])).toHaveLength(2);
 // An independent device can have an earlier clock: only the exact archived occurrence is suppressed.
 expect(mergeFishLists([archive],[{...fish,caughtAt:99}])).toHaveLength(2);
});
it('deleting one archived round does not remove earlier/later rounds or the current fresh signal',()=>{
 const one=archiveFishForNextRound([fish],200)[0],two=archiveFishForNextRound([{...fish,caughtAt:250}],300)[0],fresh={...fish,caughtAt:301};
 saveFishSignals([one,two,fresh],null);recordFishDeletion([one],null,400);
 const retained=loadFishSignals();expect(retained).toHaveLength(2);expect(retained.some(s=>s.fishArchive?.id===one.fishArchive?.id)).toBe(false);
 expect(applyFishTombstones([two,fresh],{})).toEqual([two,fresh]);
});
