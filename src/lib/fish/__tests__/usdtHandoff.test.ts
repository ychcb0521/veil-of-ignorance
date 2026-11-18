// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openUsdtFollowStore, type UsdtCampaignLedger } from '../../../../scripts/usdt-follow-store';
import { createUsdtHandoff, handoffHash } from '../../../../scripts/usdt-handoff';
import { createUsdtHandoffService } from '../../../../scripts/usdt-handoff-service';
import { reconcileUsdtHandoff, readOnlyUsdtRequest } from '../../../../scripts/usdt-handoff-reconcile';
import { createUsdtRequest, createUsdtExchange } from '../../../../scripts/usdt-exchange';
import { createUsdtFollower } from '../../../../scripts/usdt-follow-engine';
import { serveUsdtFollower } from '../../../../scripts/usdt-follow-server';
import { freezeQualityPlan } from '../qualityPlanVersions';
import { makeQualitySellPlan } from '../qualitySellPlans';
import { STATIC_DRAWDOWN_SELL_CHOICE } from '../qualityStaticDrawdownSell';
import { BINANCE_MANUAL_MONITOR_VERSION } from '../binanceManualMonitor';
import { INSTANT_TEMPLATE_MONITOR } from '../instantMonitorSettings';

const owner='11111111-1111-4111-8111-111111111111', account='12345', fingerprint=createHash('sha256').update(account).digest('hex');
const runtime='fixture-exact-server-build', symbol='NIGHTUSDT', now=Date.now();
const stores: ReturnType<typeof openUsdtFollowStore>[]=[];
const makeStore=(path=':memory:')=>{const s=openUsdtFollowStore(path,account,owner);stores.push(s);return s;};
const machine=(s=makeStore())=>createUsdtHandoff(s,fingerprint,owner,runtime);
afterEach(()=>{for(const s of stores.splice(0))s.close();});
function row():UsdtCampaignLedger {
  const plan=freezeQualityPlan(makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE,'>=',3,[]));
  return {
    campaign:{id:'fish-instant-original',source:{symbol,exchange:'binance'},admittedAt:now-200000,notional:100,leverage:5,actions:[{id:'open',action:'open',at:now-200000}]},
    managed:{version:BINANCE_MANUAL_MONITOR_VERSION,anchor:{symbol,positionSide:'LONG',openedAt:now-200000,openingOrderId:'11',openingTradeId:'1'},
      monitor:{version:INSTANT_TEMPLATE_MONITOR,templateId:'original-template',name:'原模板',plan},armedAt:now-100000,revision:7,planEpoch:3,
      entryPrice:10,entryQuantity:10,checkpoint:{status:'open',key:'original-key',remainingQuantity:10,endTime:now-60000} as any},
    orders:{open:{id:'original-client-id',exchangeId:'11',side:'BUY',quantity:'10',terminal:true,
      fills:[{id:'1',quantity:10,price:10,at:now-200000,commission:.01,commissionAsset:'USDT',realized:0}]}},
    skipped:['add-2'],status:{id:'fish-instant-original',symbol,state:'tracking'},
  };
}
function venue() {
  let positions:any[]=[{symbol,positionSide:'LONG',positionAmt:'10',entryPrice:'10'}], regular:any[]=[],algo:any[]=[],extraTrades:any[]=[],income:any[]=[];
  const trade={symbol,id:'1',orderId:'11',side:'BUY',positionSide:'LONG',qty:'10',price:'10',time:now-200000,commission:'.01',commissionAsset:'USDT',realizedPnl:'0'};
  const read=vi.fn(async(method:string,path:string,params:any={})=>{
    expect(method).toBe('GET');
    if(path==='/fapi/v1/time')return {serverTime:Date.now()};
    if(path==='/fapi/v3/positionRisk')return structuredClone(positions);
    if(path==='/fapi/v1/openOrders')return structuredClone(regular);
    if(path==='/fapi/v1/openAlgoOrders')return structuredClone(algo);
    if(path==='/fapi/v1/symbolConfig')return [{symbol,leverage:5,marginType:'ISOLATED'}];
    if(path==='/fapi/v1/userTrades')return params.fromId && BigInt(params.fromId)>1n ? extraTrades : [trade,...extraTrades];
    if(path==='/fapi/v1/income')return income;
    throw Error('unexpected '+path);
  });
  const exchange={...createUsdtExchange(read),account:vi.fn(async()=>({id:account,mode:'hedge' as const})),
    market:vi.fn(async()=>({symbol,step:'1',min:1,max:100000,minNotional:5})),order:vi.fn(async()=>undefined)};
  return {read,exchange,setPositions:(v:any[])=>positions=v,setRegular:(v:any[])=>regular=v,setAlgo:(v:any[])=>algo=v,
    setTrades:(v:any[])=>extraTrades=v,setIncome:(v:any[])=>income=v};
}

it('新端默认没有执行权；交出端不能通过初始化、恢复或重启复活',()=>{
  const a=machine(),b=machine();
  expect(()=>a.assertActive()).toThrow();
  a.initializeSource();a.freeze();
  const bundle=a.export(b.receiveRequest(),{},now);
  expect(a.state().stage).toBe('outgoing');
  for(const action of [()=>a.initializeSource(),()=>a.activateAfterReconciliation(),()=>a.assertActive()])expect(action).toThrow();
  expect(a.export(bundle.payload.request,{},now)).toEqual(bundle);
  expect(()=>a.export(machine().receiveRequest(),{},now)).toThrow();
});
it('完整账本、模板、检查点、原战役与订单编号原样导入；设备私钥与配对码不导出',()=>{
  const source=makeStore(),target=makeStore();source.save(row());source.savePositionControl('control',{test:'保护单'},false);
  source.saveDeskOrder('desk',{test:'原手动单'},false);source.savePositionLeverage('original',{leverage:5,at:now});
  const a=machine(source),b=machine(target),targetDevice=b.device;
  source.setLocal('secret-example','never-export-this');
  a.initializeSource();a.freeze();const bundle=a.export(b.receiveRequest(),{},now);
  expect(JSON.stringify(bundle)).not.toContain('never-export-this');
  expect(JSON.stringify(bundle)).not.toContain('PRIVATE KEY');
  b.import(bundle);
  expect(target.readAll()).toEqual(source.readAll());expect(target.positionLeverage('original')).toEqual({leverage:5,at:now});
  expect(b.device).toBe(targetDevice);expect(b.state().stage).toBe('staged');expect(target.paused()).toBe(true);
  expect(()=>b.assertActive()).toThrow();expect(()=>b.import(bundle)).toThrow();
});
it('活动接管端只能反向交接最新账本，不能伪造未执行的作废凭据',()=>{
  const a=machine(),b=machine();a.initializeSource();a.freeze();const forward=a.export(b.receiveRequest(),{},now);
  b.import(forward);b.activateAfterReconciliation();
  expect(()=>b.cancelIncoming(forward)).toThrow();
  b.freeze();const back=b.export(a.receiveRequest(),{},now+1);
  expect(()=>b.cancelIncoming(forward)).toThrow();
  a.import(back);expect(a.state().epoch).toBe(2);a.activateAfterReconciliation();
  expect(()=>b.assertActive()).toThrow();expect(()=>a.import(forward)).toThrow();
});
it('新端鉴权失败时仍可离线作废；作废后旧包永久无效，旧端仍需重新对账',()=>{
  const a=machine(),b=machine();a.initializeSource();a.freeze();const bundle=a.export(b.receiveRequest(),{},now);
  b.import(bundle);const receipt=b.cancelIncoming(bundle);a.acceptCancellation(receipt);
  expect(a.state().stage).toBe('frozen');expect(()=>a.assertActive()).toThrow();
  expect(()=>b.import(bundle)).toThrow();expect(b.cancelIncoming(bundle)).toEqual(receipt);
  a.activateAfterReconciliation();expect(()=>a.assertActive()).not.toThrow();
});
it('接管包尚未导入也可出具作废凭据；损坏、错机和错代码包拒绝导入',()=>{
  const a=machine(),b=machine();a.initializeSource();a.freeze();const bundle=a.export(b.receiveRequest(),{},now);
  const broken=structuredClone(bundle);broken.payload.ledger.owner='other';
  expect(()=>b.import(broken)).toThrow(/签名/);expect(()=>machine().import(bundle)).toThrow();
  expect(()=>createUsdtHandoff(makeStore(),fingerprint,owner,'different-code').import(bundle)).toThrow();
  a.acceptCancellation(b.cancelIncoming(bundle));expect(a.state().stage).toBe('frozen');
});
it('导入事务遇到无效行完整回滚，源端出让记录不能被导入覆盖',()=>{
  const a=machine(),target=makeStore(),b=machine(target);a.initializeSource();a.freeze();
  const bundle=a.export(b.receiveRequest(),{},now),before=target.snapshot();
  const bad=structuredClone(bundle.payload.ledger);bad.tables.settings=[{key:'paused',value:'1'},{key:'bad',value:3} as any];
  expect(()=>target.importSnapshot(bad,{stage:'active'})).toThrow();
  expect(target.snapshot()).toEqual(before);expect(b.state().stage).toBe('empty');
});
it('新接收端存在来源不明的旧账本时不自动覆盖',()=>{
  const source=machine(),s=makeStore(),target=machine(s);s.save(row());source.initializeSource();source.freeze();
  const bundle=source.export(target.receiveRequest(),{},now);
  expect(()=>target.import(bundle)).toThrow(/旧账本/);
  expect(s.readAll()).toHaveLength(1);expect(target.state().stage).toBe('empty');
});
it('SQLite 逻辑快照包含 WAL 中尚未 checkpoint 的事务，而非复制主文件',()=>{
  const dir=mkdtempSync(join(tmpdir(),'veil-handoff-wal-')),path=join(dir,'ledger.sqlite');
  const s=makeStore(path);s.save(row());const writer=new DatabaseSync(path);writer.exec('PRAGMA wal_autocheckpoint=0');
  writer.prepare('INSERT INTO settings VALUES (?,?)').run('position-leverage:wal','committed-in-wal');
  expect(s.snapshot().tables.settings).toContainEqual({key:'position-leverage:wal',value:'committed-in-wal'});
  writer.close();s.close();stores.splice(stores.indexOf(s),1);rmSync(dir,{recursive:true});
});
it('在时间接口 await 期间冻结，最终签名发送前再次拦截所有写请求',async()=>{
  let release!:(v:Response)=>void,allowed=true;
  const fetcher=vi.fn(()=>new Promise<Response>(resolve=>release=resolve));
  const request=createUsdtRequest({apiKey:'fixture',secret:Buffer.from('fixture')},fetcher as any,()=>{if(!allowed)throw Error('frozen');});
  const pending=request('POST','/fapi/v1/order',{symbol});
  allowed=false;release(new Response(JSON.stringify({serverTime:Date.now()})));
  await expect(pending).rejects.toThrow('frozen');expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(readOnlyUsdtRequest(request)('DELETE','/fapi/v1/order')).rejects.toThrow(/只允许读取/);
});
it('逐笔成交、账户、余仓、挂单、冻结版本及配置完整核对后仍只读',async()=>{
  const s=makeStore(),original=row();s.save(original);const v=venue(),e=await reconcileUsdtHandoff(s,v.exchange,v.read,owner);
  expect(e.account).toBe(fingerprint);expect(e.cursors[symbol]).toBe('1');
  expect(await reconcileUsdtHandoff(s,v.exchange,v.read,owner,e)).toMatchObject({account:fingerprint});
  expect(s.readAll()[0]).toEqual(original);expect(v.read.mock.calls.every(call=>call[0]==='GET')).toBe(true);
});
it.each(['position','fill','mode','permission','template','missing-monitor','new-income'] as const)('交接后 %s 变化会拒绝启用',async(change)=>{
  const s=makeStore(),original=row();s.save(original);const v=venue(),e=await reconcileUsdtHandoff(s,v.exchange,v.read,owner);
  if(change==='position')v.setPositions([{symbol,positionSide:'LONG',positionAmt:'9',entryPrice:'10'}]);
  if(change==='fill')v.setTrades([{symbol,id:'2',orderId:'12',side:'SELL',positionSide:'LONG',qty:'1',price:'10',time:now,commission:'.01',commissionAsset:'USDT',realizedPnl:'0'}]);
  if(change==='mode')v.exchange.account.mockResolvedValue({id:account,mode:'one-way'} as any);
  if(change==='permission')v.exchange.account.mockRejectedValue(Error('401/-2015'));
  if(change==='template'){original.managed!.monitor.plan.frozenVersions![0].version='unknown';s.save(original);}
  if(change==='missing-monitor'){delete original.managed;s.save(original);}
  if(change==='new-income')v.setIncome([{symbol:'OTHERUSDT',tradeId:'9',incomeType:'COMMISSION',time:now}]);
  await expect(reconcileUsdtHandoff(s,v.exchange,v.read,owner,e)).rejects.toThrow();
});
it('对账期间变化或分页满额都不会静默通过',async()=>{
  const s=makeStore();s.save(row());const v=venue();let reads=0;
  const read=vi.fn(async(method:any,path:string,params?:any)=>{
    if(path==='/fapi/v3/positionRisk' && ++reads===2)v.setPositions([{symbol,positionSide:'LONG',positionAmt:'8',entryPrice:'10'}]);
    return v.read(method,path,params);
  });
  await expect(reconcileUsdtHandoff(s,v.exchange,read,owner)).rejects.toThrow(/过程中/);
});
it('相同余仓但入场成本不符也拒绝，不能只比较仓位数量',async()=>{
  const s=makeStore();s.save(row());const v=venue();
  v.setPositions([{symbol,positionSide:'LONG',positionAmt:'10',entryPrice:'20'}]);
  await expect(reconcileUsdtHandoff(s,v.exchange,v.read,owner)).rejects.toThrow(/成本/);
});
it('接管请求代码版本不一致时不会交出执行权',()=>{
  const a=machine(),b=createUsdtHandoff(makeStore(),fingerprint,owner,'other-runtime');
  a.initializeSource();a.freeze();expect(()=>a.export(b.receiveRequest(),{},now)).toThrow(/版本/);
  expect(a.state().stage).toBe('frozen');
});
it('账户对账失败的进程启动仍只读，网页恢复不能绕过启动检查',async()=>{
  const s=makeStore();s.save(row());const v=venue(),handoff=createUsdtHandoffService(s,account,owner,runtime,v.exchange,v.read);
  handoff.machine.initializeSource();v.exchange.account.mockRejectedValue(Error('401/-2015'));
  const runner=createUsdtFollower(s,v.exchange,owner,'hedge',now);await handoff.begin(runner);
  expect(handoff.describe().authorized).toBe(false);expect(()=>handoff.assertWritable()).toThrow();
  expect(()=>runner.resumeNewOrders()).toThrow(/冻结/);await runner.tick();expect(v.exchange.order).not.toHaveBeenCalled();
});
it('真实 HTTP 交出后只有接收端能通过对账获得执行权，返回时使用最新账本',async()=>{
  const source=makeStore(),target=makeStore();source.save(row());const v=venue();
  const a=createUsdtHandoffService(source,account,owner,runtime,v.exchange,v.read),b=machine(target);
  a.machine.initializeSource();
  const origin='https://fixture.test',token='b'.repeat(64);
  const server=serveUsdtFollower({owner,token,store:source,exchange:v.exchange,mode:'hedge',startedAt:now,port:0,allowedOrigin:origin,handoff:a});
  await once(server,'listening');
  const send=async(command:string,more:any={})=>{
    const response=await fetch('http://127.0.0.1:'+(server.address() as any).port+'/api/usdt-follow/safe',{
      method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({owner,command,...more})});
    return {status:response.status,body:await response.json()};
  };
  try{
    for(let i=0;i<100&&!a.describe().authorized;i++)await new Promise(resolve=>setTimeout(resolve,5));
    expect(a.describe().authorized).toBe(true);
    const exported=await send('handoff-export',{request:b.receiveRequest()});
    expect(exported.status).toBe(200);expect(a.machine.state().stage).toBe('outgoing');
    expect((await send('resume',{campaigns:[],controlRevision:source.controlRevision()})).status).toBe(400);
    b.import(exported.body.bundle);
    const evidence=await reconcileUsdtHandoff(target,v.exchange,v.read,owner,exported.body.bundle.payload.evidence);
    expect(evidence.cursors[symbol]).toBe('1');
    b.activateAfterReconciliation();expect(()=>b.assertActive()).not.toThrow();expect(()=>a.assertWritable()).toThrow();
    const latest=target.readAll()[0];latest.managed!.revision=9;latest.managed!.checkpoint!.endTime=atMinute();
    target.save(latest);
    const returnRequest=(await send('handoff-request')).body.request;
    b.freeze();const back=b.export(returnRequest,await reconcileUsdtHandoff(target,v.exchange,v.read,owner),Date.now());
    // Close the original frozen process before importing, just as the real CLI requires.
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    a.machine.import(back);
    expect(source.readAll()[0].managed!.revision).toBe(9);
    expect(source.readAll()[0].campaign.id).toBe('fish-instant-original');
    expect(()=>b.cancelIncoming(exported.body.bundle)).toThrow();
    expect(v.read.mock.calls.every(call=>call[0]==='GET')).toBe(true);
  }finally{if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
function atMinute(){return Math.floor(Date.now()/60000)*60000;}
it('未决订单未查明时保持冻结，不能换编号或当作新开仓',async()=>{
  const s=makeStore(),original=row();original.orders.open.terminal=false;s.save(original);
  const v=venue(),runner=createUsdtFollower(s,v.exchange,owner,'hedge',Date.now());await runner.quiesce();
  await expect(runner.reconcileForHandoff()).rejects.toThrow(/未决订单/);
  await runner.tick();expect(v.exchange.order).toHaveBeenCalledWith(expect.anything(),'hedge',original.orders.open,false);
  expect((v.exchange.order.mock.calls as unknown[][]).some(call=>call[3]===true)).toBe(false);
});
it('冻结等待正在进行的手动操作结束，随后禁止清理、订单及网页恢复',async()=>{
  const s=makeStore(),v=venue(),runner=createUsdtFollower(s,v.exchange,owner,'hedge',now);
  let finish!:()=>void;const control=runner.runPositionControl(()=>new Promise<void>(resolve=>finish=resolve));
  const stopped=vi.fn();const freeze=runner.quiesce().then(stopped);
  await Promise.resolve();expect(stopped).not.toHaveBeenCalled();finish();await control;await freeze;
  await expect(runner.runPositionControl(async()=>{})).rejects.toThrow(/冻结/);
  expect(()=>runner.resumeNewOrders()).toThrow(/冻结/);
});
it('新端 HTTP 层默认拒绝 sync、开仓、平仓、撤单、模板切换与恢复，仅状态和对账可读',async()=>{
  const s=makeStore(),v=venue(),handoff=createUsdtHandoffService(s,account,owner,runtime,v.exchange,v.read);
  const token='a'.repeat(64),origin='https://fixture.test';
  const server=serveUsdtFollower({owner,token,store:s,exchange:v.exchange,mode:'hedge',startedAt:now,port:0,allowedOrigin:origin,handoff});
  await once(server,'listening');
  try{
    for(const command of ['resume','sync','position-control','desk-open','desk-close','manual-monitor-update','follow-monitor-switch']){
      const response=await fetch('http://127.0.0.1:'+(server.address() as any).port+'/api/usdt-follow/safe',{
        method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({owner,command,campaigns:[]})});
      // Bootstrap sync only captures existing frozen monitors and cannot create a campaign.
      expect(response.status).toBe(command==='sync'?200:400);
    }
    expect(s.readAll()).toEqual([]);expect(v.exchange.order).not.toHaveBeenCalled();
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
