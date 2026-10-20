import {it,expect} from 'vitest';
import type {FishMemberResult} from '@/lib/fish/intersection';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {combineFishRound,selectFishRound,fishSelectionKey,type FishCombinationRound} from '@/lib/fishScanner';
const plan=(id:string)=>compileFishProgram({...CBI2_DEF,id,formula:'C',scale:1},{direction:'>',threshold:1,constraints:[]});
const plans=['a','b','c'].map(plan);
const hit=(i:number,t:number)=>({outcome:'hit',signal:{id:`original-${i}`,symbol:'XUSDT',timeMs:t,timeLabel:'',fallbackZone:'',fish:{algorithmKey:plans[i].algorithmKey,average:2,cbi2:2,startAverage:2,previousAverage:0,cutoffMs:1000,threshold:1}}});
const round:FishCombinationRound={plans,anchorMs:1000,complete:true,memberHits:[1,1,0],results:new Map([['binance|crypto|XUSDT',new Map<number,FishMemberResult>([[0,hit(0,20)],[1,hit(1,40)],[2,{outcome:'below'}]])]])};
it('任意子集独立合并，单算法保留原 ID；空选不命中，原池不变',()=>{
 const keys=plans.map(fishSelectionKey);
 expect(combineFishRound(round,'and').signals).toEqual([]);
 const two=selectFishRound(round,keys.slice(0,2))!;
 expect(combineFishRound(two,'and').signals[0].timeMs).toBe(40);
 expect(combineFishRound(two,'or').signals[0].timeMs).toBe(20);
 expect(combineFishRound(selectFishRound(round,[keys[0]])!,'and').signals[0].id).toBe('original-0');
 expect(combineFishRound(selectFishRound(round,[])!,'or').signals).toEqual([]);
 expect(combineFishRound(selectFishRound(round,[keys[1],keys[0]])!,'and').signals[0].id).toBe(combineFishRound(two,'and').signals[0].id);
 expect(round.plans).toHaveLength(3);expect(round.results.values().next().value?.size).toBe(3);
});
it('定义变化不能冒用旧结果；重复卡按出现次数匹配',()=>{
 const changed=compileFishProgram({...plans[0].def,formula:'C * 2'},plans[0].settings);
 expect(changed.algorithmKey).toBe(plans[0].algorithmKey);
 expect(selectFishRound(round,[fishSelectionKey(changed)])).toBeNull();
 expect(selectFishRound(round,[fishSelectionKey(plans[0]),fishSelectionKey(plans[0])])).toBeNull();
});
it('子集里起点不明的算法不算命中；来源不同不能交叉配对',()=>{
 const unknown={...round,results:new Map([['binance|crypto|XUSDT',new Map<number,FishMemberResult>([[0,{outcome:'unknown',boundaryMs:30}],[1,hit(1,40)]])]])};
 expect(combineFishRound(selectFishRound(unknown,plans.slice(0,2).map(fishSelectionKey))!,'and').signals).toEqual([]);
 expect(combineFishRound(selectFishRound(unknown,plans.slice(0,2).map(fishSelectionKey))!,'and').counts.unknown).toBe(1);
 const separate={...round,results:new Map([['binance|crypto|XUSDT',new Map<number,FishMemberResult>([[0,hit(0,20)]])],['okx|crypto|XUSDT',new Map([[1,hit(1,40)]])]])};
 expect(combineFishRound(selectFishRound(separate,plans.slice(0,2).map(fishSelectionKey))!,'and').signals).toEqual([]);
});
