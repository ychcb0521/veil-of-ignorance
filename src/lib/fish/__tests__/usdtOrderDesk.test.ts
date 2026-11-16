// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createUsdtOrderDesk,deskOrderParameters} from '../../../../scripts/usdt-order-desk';
import {createUsdtExchange,UsdtApiError} from '../../../../scripts/usdt-exchange';
import {openUsdtFollowStore} from '../../../../scripts/usdt-follow-store';
import type {UsdtDeskOpenRequest} from '../usdtOrderDesk';

const symbol='BEATUSDT';
const market={symbol,step:'1',marketStep:'1',min:1,max:100_000,minNotional:5,priceTick:'0.00001'};

it('uses IOC to cap slippage on both sides and chooses the matching conditional direction',async()=>{
  const book=async()=> '0.08123';
  const buy=await deskOrderParameters({type:'market',slippage:.5},market,'BUY','fake',.08123,book);
  const sell=await deskOrderParameters({type:'market',slippage:.5},market,'SELL','fake',.08123,book);
  expect(buy.params).toMatchObject({type:'LIMIT',timeInForce:'IOC',price:'0.08163'});
  expect(sell.params).toMatchObject({type:'LIMIT',timeInForce:'IOC',price:'0.08083'});
  expect((await deskOrderParameters({type:'conditional',triggerPrice:'0.082'},market,'BUY','fake',.08123,book)).params)
    .toMatchObject({type:'STOP_MARKET',workingType:'MARK_PRICE',clientAlgoId:'fake'});
  expect((await deskOrderParameters({type:'conditional',triggerPrice:'0.082'},market,'SELL','fake',.08123,book)).params)
    .toMatchObject({type:'TAKE_PROFIT_MARKET'});
});

it('recovers the same manual opening after an ambiguous POST without sending it again',async()=>{
  const store=openUsdtFollowStore(':memory:','fixture-account','fixture');
  let report:Record<string,string> | undefined;
  let ready=false;
  const request=vi.fn(async (method:string,path:string,params:Record<string,string>={})=>{
    if(path.endsWith('/account'))return {assets:[{asset:'USDT',availableBalance:'100'}]};
    if(path.endsWith('/symbolConfig'))return [{symbol,leverage:5,maxNotionalValue:'10000'}];
    if(path.endsWith('/dual'))return {dualSidePosition:true};
    if(path.endsWith('/positionRisk'))return [];
    if(method==='POST'){
      report={...params,clientOrderId:params.newClientOrderId,status:'NEW',executedQty:'0'};
      throw new TypeError('response lost');
    }
    if(!ready)throw new UsdtApiError(400,-2013);
    expect(params.origClientOrderId).toBe(report?.clientOrderId);
    return report;
  });
  const exchange={...createUsdtExchange(request),book:vi.fn(async()=> '0.08123'),market:vi.fn(async()=>market)};
  const desk=createUsdtOrderDesk(request,exchange,store,'fixture','hedge',async()=>{},Date.now,async()=> '0.08123');
  const order:UsdtDeskOpenRequest={id:randomUUID(),symbol,direction:'short',quantity:'100',order:{type:'limit',price:'0.08125',timeInForce:'GTC'}};
  try{
    expect(await desk.execute(order)).toEqual({pending:true});
    await expect(desk.execute({...order,id:randomUUID()})).rejects.toThrow('上一笔开仓');
    ready=true;
    expect(await desk.execute(order)).toMatchObject({issue:undefined});
    expect(request.mock.calls.filter(([method])=>method==='POST')).toEqual([
      ['POST','/fapi/v1/order',expect.objectContaining({side:'SELL',positionSide:'SHORT',type:'LIMIT',quantity:'100',price:'0.08125'})]
    ]);
  }finally{store.close();}
});
