// @vitest-environment node
import {once} from 'node:events';
import {expect,it,vi} from 'vitest';
import {createUsdtPositionReader} from '../../../../scripts/usdt-position-reader';
import {serveUsdtFollower} from '../../../../scripts/usdt-follow-server';
import {createUsdtExchange} from '../../../../scripts/usdt-exchange';
import {openUsdtFollowStore} from '../../../../scripts/usdt-follow-store';
import {usdtMirrorRevision} from '../usdtPositionMirror';

const now=Date.UTC(2026,10,15,8), symbol='TESTUSDT', first=now-1250590, add=now-550451, reduce=now-547;
const raw=(amount='0.75',side='BOTH',updatedAt=reduce)=>({symbol,positionSide:side,positionAmt:amount,
  entryPrice:'100.01000',markPrice:'112.00001',unRealizedProfit:'8.99101',updateTime:updatedAt});
const trade=(id:string,time:number,qty:string,side:string,positionSide='BOTH')=>({symbol,id,time,orderId:'200'+id,side,qty,positionSide,price:'100.01000'});
const fills=[trade('3',reduce,'0.75','SELL'),trade('2',add,'0.5','BUY'),trade('1',first,'1.0','BUY')];
function venue(rows:ReturnType<typeof raw>[],orders:typeof fills) {
 return vi.fn(async (method:'GET',path:string,params?:Record<string,string>)=>{
   expect(method).toBe('GET');
   if(path==='/fapi/v3/positionRisk')return rows;
   expect(path).toBe('/fapi/v1/userTrades');
   return orders.filter(row=>row.time>=Number(params?.startTime)&&row.time<=Number(params?.endTime)).slice(0,1000);
 });
}
it('replays the open, add and reduction at exact exchange milliseconds without re-querying an unchanged history',async()=>{
 const request=venue([raw()],fills),reader=createUsdtPositionReader(request,()=>now);
 expect(request).not.toHaveBeenCalled();
 const [position]=(await reader.positions()).positions,revision=usdtMirrorRevision(position);
 expect(position).toMatchObject({direction:'long',quantity:'0.75',entryPrice:'100.01000',updatedAt:reduce});
 const history=await reader.history(symbol,'BOTH',revision);
 expect(history.openedAt).toBe(first);
 expect(history.fills.map(f=>[f.action,f.at,f.quantity])).toEqual([['open',first,'1.0'],['add',add,'0.5'],['reduce',reduce,'0.75']]);
 const count=request.mock.calls.length;
 expect(await reader.history(symbol,'BOTH',revision)).toBe(history);
 expect(request).toHaveBeenCalledTimes(count);
});
it('uses only the new-side quantity on a reversal and sorts same-millisecond fills by numeric trade id',async()=>{
 const before=trade('9',first,'0.8','SELL'),flip=trade('10',first,'1.25','BUY'),short=trade('11',first,'2','SELL','SHORT');
 const reader=createUsdtPositionReader(venue([raw('0.45','BOTH',first),raw('-2','SHORT',first)],[short,flip,before]),()=>now);
 const {positions}=await reader.positions();
 const history=await reader.history(symbol,'BOTH',usdtMirrorRevision(positions[0]));
 expect(history.fills).toMatchObject([{at:first,id:'10',quantity:'1.25',positionQuantity:'0.45',action:'open'}]);
 const hedge=await reader.history(symbol,'SHORT',usdtMirrorRevision(positions[1]));
 expect(hedge.fills).toMatchObject([{at:first,id:'11',side:'SELL',action:'open'}]);
});
it.each([1, 2])('checks the current position when the position feed is %s ms ahead of its fill', async gap => {
  const reader=createUsdtPositionReader(venue([raw('0.75','BOTH',reduce+gap)],fills),()=>now);
  const [position]=(await reader.positions()).positions;
  const history=await reader.history(symbol,'BOTH',usdtMirrorRevision(position));
  if(gap===1)expect(history.openedAt).toBe(first);
  else expect(history).toMatchObject({fills:[],issue:expect.stringContaining('无法与当前仓位核对')});
});
it('does not invent an opening timestamp with incomplete trades or a position that changed while being read',async()=>{
 const noHistory=createUsdtPositionReader(venue([raw()],[fills[0]]),()=>now);
 const pending=(await noHistory.positions()).positions[0];
 expect(await noHistory.history(symbol,'BOTH',usdtMirrorRevision(pending))).toEqual({fills:[],issue:expect.stringContaining('历史成交不足')});
 const request=venue([raw()],fills);
 const original=request.getMockImplementation()!;
 request.mockImplementation(async (...args)=>args[2]?.symbol&&args[1].includes('positionRisk')?[raw('0.25')]:original(...args));
 const racing=createUsdtPositionReader(request,()=>now);
 const position=(await racing.positions()).positions[0];
 expect(await racing.history(symbol,'BOTH',usdtMirrorRevision(position))).toEqual({fills:[],issue:expect.stringContaining('仓位已变化')});
});
it('only authenticated, paired loopback requests can read; a read command never enters the order follower',async()=>{
 const request=venue([raw()],fills),reader=createUsdtPositionReader(request,()=>now);
 const store=openUsdtFollowStore(':memory:','synthetic-account','fixture');
 const signed=vi.fn(async()=>{throw Error('must not call order exchange');});
 const allowedOrigin='http://127.0.0.1:49182',token='a'.repeat(64);
 const server=serveUsdtFollower({owner:'fixture',token,exchange:createUsdtExchange(signed),store,mode:'one-way',
   startedAt:now,positionReader:reader,allowedOrigin,port:0});
 await once(server,'listening');
 const endpoint='http://127.0.0.1:'+(server.address() as {port:number}).port+'/api/usdt-follow';
 const send=(body:object,origin=allowedOrigin,key=token)=>fetch(endpoint,{method:'POST',headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify({owner:'fixture',...body})});
 try{
  expect((await send({command:'positions'},'https://wrong.test')).status).toBe(403);
  expect((await send({command:'positions'},allowedOrigin,'bad')).status).toBe(401);
  expect((await send({command:'positions',owner:'wrong'})).status).toBe(403);
  expect(request).not.toHaveBeenCalled();
  const status=await (await send({command:'sync',campaigns:[]})).json();
  expect(status).toMatchObject({statuses:[],positionMirror:1});
  const snapshot=await (await send({command:'positions',campaigns:[{malicious:true}]})).json();
  expect(snapshot.positions).toHaveLength(1);
  const history=await (await send({command:'position-history',symbol,positionSide:'BOTH',revision:usdtMirrorRevision(snapshot.positions[0])})).json();
  expect(history.openedAt).toBe(first);
  expect(signed).not.toHaveBeenCalled();
 }finally{
   await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
   store.close();
 }
});
