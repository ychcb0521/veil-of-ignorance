// @vitest-environment node
import { expect,it,vi } from 'vitest';
import { advanceFrozenUsdtFollow } from '../usdtFrozenContinuation';
import { usdtFollowCampaigns } from '../usdtFollow';
import { usdtFollowBatches } from '../usdtFollowBatches';
import { freezeQualityPlan } from '../qualityPlanVersions';
import { makeQualitySellPlan } from '../qualitySellPlans';
import { STATIC_DRAWDOWN_SELL_CHOICE } from '../qualityStaticDrawdownSell';
import { QUALITY_POSITION_MANAGEMENT_VERSION } from '../qualityPositionManagement';
const at=Math.floor(Date.now()/60000)*60000;
function fixture(){
  const plan=freezeQualityPlan({...makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE,'>=',3,[]),
    positionManagement:{version:QUALITY_POSITION_MANAGEMENT_VERSION,notional:100,leverage:5}});
  const monitor={version:'instant-template-monitor-v1',templateId:'original-template',name:'冻结模板',plan};
  const record:any={id:'original-record',roundId:'original-round',status:'matched',matchedAt:at-300000,updatedAt:at-300000,
    sample:{id:'original-sample',source:{id:'source',symbol:'NIGHTUSDT',exchange:'binance',timeMs:at-360000},basis:'signal',groups:[],enteredAt:at-300000}};
  const round:any={id:record.roundId,state:'complete',instantTrading:true,liveCapturedAt:at-300000,instantMonitor:monitor};
  const checkpoint:any={status:'open',entryTime:at-300000,endTime:at-120000,key:'frozen-result',initialNotional:100,remainingQuantity:10,
    peakPct:23,vetoPath:{peak:12.3,minimum:9,dynamic:2},additionFills:[]};
  const tracking:any={admitted:[{record,round}],alerts:new Map(),monitorResults:new Map([[record.id,checkpoint]])};
  const campaign=usdtFollowCampaigns(tracking)[0];
  return {campaign,checkpoint,monitor,record,round};
}
it('普通跟单跨设备从原检查点续算，原信号、模板和入场不变，只生成后续原动作',async()=>{
  const {campaign,checkpoint,monitor,record}=fixture(),before=JSON.stringify(campaign);
  const evaluate=vi.fn(async(state,end)=>{expect(state.checkpoint).toEqual(checkpoint);return {...checkpoint,status:'closed' as const,endTime:end,endPrice:9,reason:'原防守线断裂'};});
  const next=await advanceFrozenUsdtFollow(campaign,at,evaluate,vi.fn());
  expect(next?.id).toBe(campaign.id);expect(next?.admittedAt).toBe(campaign.admittedAt);
  expect(next?.frozenMonitor?.admission.record.id).toBe(record.id);
  expect(next?.frozenMonitor?.admission.round.instantMonitor).toEqual(monitor);
  expect(next?.actions[0]).toEqual(campaign.actions[0]);expect(next?.actions.at(-1)?.action).toBe('close');
  expect(JSON.stringify(campaign)).toBe(before);
});
it('已冻结的卖出信号即使未进入旧端动作队列，也会按原战役恢复，不丢失退出',async()=>{
  const {campaign}=fixture();campaign.frozenMonitor!.sale={at:at-60000,closePrice:9,evidence:{version:'instant-template-monitor-v1',reason:'template',detail:'原退出'}};
  const next=await advanceFrozenUsdtFollow(campaign,at,vi.fn(),vi.fn());
  expect(next?.actions).toContainEqual({id:'close',action:'close',at:at-60000});
  expect(await advanceFrozenUsdtFollow(next!,at,vi.fn(),vi.fn())).toBeUndefined();
});
it('恢复已经部分手动减仓的状态时保留原动作编号，不产生新开仓',async()=>{
  const {campaign}=fixture();campaign.frozenMonitor!.manual={version:'instant-manual-v1',startedAt:at-120000,through:at-60000,entryPrice:10,
    fills:[{reason:'manual',at:at-60000,priceAt:at-60000,price:11,fraction:.25}]};
  const next=await advanceFrozenUsdtFollow(campaign,at,vi.fn(),vi.fn());
  expect(next?.actions.filter(a=>a.action==='open')).toHaveLength(1);
  expect(next?.actions).toContainEqual({id:'manual-1',at:at-60000,action:'manual-reduction',fraction:.25});
});
it('行情错误不会推进冻结检查点或补造动作',async()=>{
  const {campaign}=fixture(),before=JSON.stringify(campaign);
  await expect(advanceFrozenUsdtFollow(campaign,at,async()=>({status:'error',reason:'缺少分钟行情'} as any),vi.fn())).rejects.toThrow(/缺少分钟/);
  expect(JSON.stringify(campaign)).toBe(before);
});
it('大状态按字节分批，不丢弃战役；单笔超限明确阻断',()=>{
  const {campaign}=fixture();const rows=[campaign,{...campaign,id:'other'}];
  const size=new TextEncoder().encode(JSON.stringify(campaign)).length+1050;
  expect(usdtFollowBatches(rows,size)).toHaveLength(2);
  expect(usdtFollowBatches(rows,size).flat()).toEqual(rows);
  expect(()=>usdtFollowBatches(rows,1024)).toThrow(/大小限制/);
});
