// 【用户要求】2026-10-21「鱼中，多个信号的信息整行完全重复时，只留一个就行，不要重复」
import {beforeEach,expect,it} from 'vitest';
import {collapseVisibleFish,fishDedupKey,fishVisibleKey} from '@/lib/fish/records';
import {mergeFishLists} from '@/lib/fish/tombstones';
import {FISH_STORAGE_KEY,loadFishSignals,loadFishTombstones,recordFishDeletion} from '@/lib/fishSignals';
import type {TradeSignal} from '@/lib/signalLibrary';
const T=Date.UTC(2026,9,21,3,55);
// 同一条 ICNTUSDT 11:55 BSS，只是阈值不同（算法键不同）——列表里显示完全一样
const icnt=(threshold:number,extra:Partial<TradeSignal>={}):TradeSignal=>({id:`i${threshold}`,symbol:'ICNTUSDT',timeMs:T,timeLabel:'2026-10-21 11:55:00',fallbackZone:'',fish:{featureId:'bss',featureShort:'BSS',threshold,direction:'>',average:1,cbi2:1,startAverage:1,previousAverage:0,cutoffMs:T},...extra} as TradeSignal);
beforeEach(()=>localStorage.clear());
it('整行显示相同（标的、交易所、信号时间、算法类型）只留一条：新鱼优先，其次捕到得更晚的，评分沿用',()=>{
 const copies=[0.08,0.09,0.1,0.11,0.12,0.13,0.14].map((t,i)=>icnt(t,{caughtAt:1000+i,...(i===2?{quality:4}:{})}));
 expect(new Set(copies.map(fishDedupKey)).size).toBe(7);expect(new Set(copies.map(fishVisibleKey)).size).toBe(1);
 const one=collapseVisibleFish(copies);
 expect(one).toHaveLength(1);expect(one[0].caughtAt).toBe(1006);expect(one[0].quality).toBe(4);
 expect(collapseVisibleFish([...copies.slice(0,2),{...icnt(0.2),freshCatch:true,caughtAt:1}])[0].freshCatch).toBe(true);
 // 交易所不同、算法类型不同、时间不同的不算重复
 const others=[icnt(0.08,{exchange:'okx'}),icnt(0.08,{fish:{...icnt(0.08).fish!,featureShort:'CBA',featureId:'cba'}}),icnt(0.08,{timeMs:T+3e5})];
 expect(collapseVisibleFish([copies[0],...others])).toHaveLength(4);
 // 没有重复时原样返回（不换引用）
 const clean=[copies[0],...others];expect(collapseVisibleFish(clean)).toBe(clean);
});
it('读取本机存的鱼时合并重复；同步时两边的副本合并后也只留一条',()=>{
 localStorage.setItem(FISH_STORAGE_KEY,JSON.stringify([icnt(0.08),icnt(0.09),icnt(0.1)]));
 expect(loadFishSignals()).toHaveLength(1);expect(JSON.parse(localStorage.getItem(FISH_STORAGE_KEY)!)).toHaveLength(1);
 expect(mergeFishLists([icnt(0.08)],[icnt(0.09),icnt(0.1)])).toHaveLength(1);
});
it('删掉一条后，别处键不同、显示相同的旧副本也带不回来；之后重新捕到照常保留',()=>{
 recordFishDeletion([icnt(0.08,{caughtAt:100})],null,500);
 expect(Object.keys(loadFishTombstones()).some(k=>k.startsWith('v|'))).toBe(true);
 expect(mergeFishLists([],[icnt(0.09,{caughtAt:200})],loadFishTombstones())).toHaveLength(0);
 expect(mergeFishLists([],[icnt(0.09,{caughtAt:900})],loadFishTombstones())).toHaveLength(1);
});
