import {describe,expect,it} from 'vitest';
import {tradeMailEvents,tradeMailContent} from '../tradeMailEvents';
import {parseTradeRoutes} from '../tradeMailRoutes';
import {tradeRecipients} from '../tradeMailDelivery';
import type {UsdtFollowStatus} from '../usdtFollow';

const input={id:'campaign-a',recordId:'admission',source:{id:'s',symbol:'AAAUSDT',timeMs:10},buyAt:20,detectors:[]};
const job={input,opened:{...input,entryPrice:3,marginUsdt:10,leverage:5}};
const receipt={id:'campaign-a',symbol:'AAAUSDT',state:'tracking',executions:[{actionId:'open',orderId:'b1',side:'BUY',
  fills:[{id:'1',at:22,price:3.1,quantity:2,realized:0,commission:0,commissionAsset:'USDT'}]}]} satisfies UsdtFollowStatus;
describe('trade email routes',()=>{
  it('waits for actual paper and Binance executions and associates the exact action and campaign',()=>{
    expect(tradeMailEvents([{input}],{},[receipt])).toEqual([]);
    expect(tradeMailEvents([job],{},[{...receipt,id:'campaign-b'},{...receipt,executions:[{...receipt.executions[0],fills:[]}]}]).map(e=>e.route)).toEqual(['paperBuy']);
    const fills=[...receipt.executions[0].fills,{...receipt.executions[0].fills[0],id:'2',at:24}];
    const events=tradeMailEvents([job],{},[{...receipt,executions:[{...receipt.executions[0],fills}]},receipt]);
    expect(events.map(e=>e.route)).toEqual(['paperBuy','liveBuy']);
    expect(tradeMailContent(events[1]).message).toContain('币安订单号 b1');
    expect(events[1]).toMatchObject({paper:{price:3},exchange:{price:3.1,at:22}});
  });
  it('keeps partial sells and their confirmed Binance fills on the two sell routes',()=>{
    const tracking={mirrorFills:new Map([['admission',{at:28,price:4,fraction:0.5,gainPct:1,atOpen:false}]])};
    const executions=[{...receipt.executions[0],side:'SELL' as const,actionId:'mirror',orderId:'s2',fills:[{...receipt.executions[0].fills[0],at:29,price:4.2}]}];
    expect(tradeMailEvents([job],tracking,[{...receipt,executions}]).map(e=>e.route)).toEqual(['paperBuy','paperSell','liveSell']);
  });
  it('isolates recipient lists and excludes events predating enablement or subscription',()=>{
    const routes=parseTradeRoutes(JSON.stringify({paperBuy:{enabledAt:18,recipients:[{email:'A@site.com',since:15},{email:'late@site.com',since:21}]},
      liveBuy:{enabledAt:21,recipients:[{email:'private@site.com',since:21}]},paperSell:{enabledAt:0,recipients:[{email:'other@site.com',since:10}]}}));
    const [paper,live]=tradeMailEvents([job],{},[receipt]);
    expect(tradeRecipients(paper,routes)).toEqual(['a@site.com']);
    expect(tradeRecipients(live,routes)).toEqual(['private@site.com']);
    expect(tradeRecipients({...paper,route:'paperSell'},routes)).toEqual([]);
    expect(tradeRecipients({...live,at:20},routes)).toEqual([]);
  });
});
