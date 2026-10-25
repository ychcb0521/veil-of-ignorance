// 【用户要求】2026-10-20「在捕捉到的信号后面加一列（捕捞过程），点开之后要能够看到凭什么击中到了信号、以及为什么能避开其他噪音」
import {beforeEach,it,expect} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {FishLibrary} from '@/components/FishLibrary';
import {FishProcessDetail} from '@/components/FishProcess';
import {saveFishRound,summarizeFishRound} from '@/lib/fish/roundSummary';
import type {TradeSignal} from '@/lib/signalLibrary';
const cut=Date.UTC(2026,3,9,15),step=300000,start=Date.UTC(2026,3,9,4,55);
const fish={average:0.081,cbi2:0.081,value:0.081,startAverage:0.0712,previousAverage:0.0695,cutoffMs:cut,threshold:0.07,thresholdRaw:0.07,scale:1,unit:'',direction:'>' as const,interval:'5m',featureShort:'CBI-2',statistic:'avg_CBI2',algorithmKey:'cbi2|avg_CBI2|=|>|0.07|x',startIndex:1000,cutoffIndex:1121,aboveBars:122,runExtreme:0.0705,crossings:1,trace:{t0:start-36*step,dt:3*step,values:Array.from({length:53},(_,i)=>0.06+i*0.0004)}};
const signal:TradeSignal={id:'fish-RAVEUSDT',symbol:'RAVEUSDT',timeMs:start,timeLabel:'2026-04-09 12:55:00',fallbackZone:'',fish,freshCatch:true};
beforeEach(()=>localStorage.clear());
it('S 的持续时间成熟才命中：不会把此前已高于 0.7 误写成未过当前门槛',()=>{
 render(<FishProcessDetail signal={{...signal,fish:{...fish,featureId:'state',featureShort:'S',statistic:'state',threshold:.7,previousAverage:.75,startAverage:.75,average:.75,stateHold:{threshold:.55,requiredHours:6,verifiedHours:6,fromMs:cut-6*3600000,minimum:.58},constraints:['S > 0.55 连续至少 6 小时']}}}/>);
 const d=screen.getByTestId('fish-process-detail');
 expect(d).toHaveTextContent('尚未同时满足当前门槛与持续时间条件');
 expect(d).toHaveTextContent('S 连续高于 0.55 已覆盖 6 小时');
 expect(d).toHaveTextContent('期间最低 0.58');
 expect(d).not.toHaveTextContent('还不到门槛');
});
it('详情：越线、保持、截止三步命中依据；本轮其余币卡在哪一步、本币排名与越线次数',()=>{
 const rows=[{symbol:'RAVEUSDT',reading:0.081,outcome:'hit'},{symbol:'X1USDT',reading:0.09,outcome:'unknown'},...Array.from({length:30},(_,i)=>({symbol:`B${i}USDT`,reading:0.001*i,outcome:'below'})),{symbol:'GUSDT',reading:NaN,outcome:'gap'}];
 saveFishRound(summarizeFishRound(rows,{algorithmKey:fish.algorithmKey,cutoffMs:cut,anchorMs:cut,direction:'>',threshold:0.07,scale:1,unit:'',partial:false}));
 render(<FishProcessDetail signal={signal}/>);const d=screen.getByTestId('fish-process-detail');
 expect(d).toHaveTextContent('凭什么击中');expect(d).toHaveTextContent('越线');expect(d).toHaveTextContent('0.0695');expect(d).toHaveTextContent('0.0712');
 expect(d).toHaveTextContent('连续 122 根');expect(d).toHaveTextContent('最低 0.0705');expect(d).toHaveTextContent('读数 0.081');
 expect(d).toHaveTextContent('为什么避开了其他噪音');expect(d).toHaveTextContent('共判定 33 个币，只有 1 个命中');
 expect(d).toHaveTextContent('截止时没达到门槛：30 个');expect(d).toHaveTextContent('找不到这一轮的起点（不入库）：1 个');expect(d).toHaveTextContent('K 线有缺口：1 个');
 expect(d).toHaveTextContent('排第 2');expect(d).toHaveTextContent('越线 1 次');expect(screen.getByRole('img',{name:'读数轨迹'})).toBeInTheDocument();
});
it('没有本轮记录 / 旧记录：说明清楚，不编数字',()=>{
 render(<FishProcessDetail signal={{...signal,fish:{...fish,trace:undefined,crossings:undefined,aboveBars:undefined}}}/>);
 const d=screen.getByTestId('fish-process-detail');expect(d).toHaveTextContent('没有找到这一轮的记录');expect(d).toHaveTextContent('当时没有记下过程数据');
});
it('鱼列表每行有「捕捞过程」，点开显示详情',()=>{
 render(<FishLibrary title="新鱼" testId="fish-new" signals={[signal]} defaultOpen tradedDayIndex={new Set()} campaignDayIndex={new Set()} jumpingSignalId={null} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}}/>);
 const panel=screen.getByTestId('fish-new-panel');expect(within(panel).getByText('捕捞过程',{selector:'span'})).toBeVisible();expect(within(panel).getByText('算法类型')).toBeVisible();expect(within(panel).getByTestId('fish-algorithm-type')).toHaveTextContent('CBI-2');expect(within(panel).queryByText('兜底区')).toBeNull();
 fireEvent.click(within(panel).getByTestId('fish-process-open'));const dialog=screen.getByRole('dialog');expect(dialog).toHaveTextContent('RAVEUSDT');expect(within(dialog).getByTestId('fish-process-detail')).toHaveTextContent('凭什么击中');
});

it('组合过程区分 S 原值与 avg_S，并显示新 3 小时路径的实际核验',()=>{
 const raw={...fish,featureId:'state',featureShort:'S',statistic:'state',stateHold:{threshold:.66,requiredHours:3,verifiedHours:3,fromMs:cut-3*3600000,minimum:.68}};
 const avg={...fish,featureId:'state',featureShort:'S',statistic:'avg_state_2'};
 render(<FishProcessDetail signal={{...signal,fish:{...raw,combination:'or',hitAlgorithms:[1,2],algorithms:[raw,avg]}}}/>);
 const d=screen.getByTestId('fish-process-detail');
 expect(d).toHaveTextContent('算法 1 · S 原值');
 expect(d).toHaveTextContent('算法 2 · avg_S');
 expect(d).toHaveTextContent('S 连续高于 0.66 已覆盖 3 小时');
});
