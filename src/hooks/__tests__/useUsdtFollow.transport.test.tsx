import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUsdtFollow } from '@/hooks/useUsdtFollow';
import { freezeQualityPlan } from '@/lib/fish/qualityPlanVersions';
import { makeQualitySellPlan } from '@/lib/fish/qualitySellPlans';
import { STATIC_DRAWDOWN_SELL_CHOICE } from '@/lib/fish/qualityStaticDrawdownSell';
import { INSTANT_TEMPLATE_MONITOR } from '@/lib/fish/instantMonitorSettings';
import { instantPositionInput } from '@/lib/fish/instantCampaign';
import { USDT_ENTRY_MAX_AGE_MS } from '@/lib/fish/usdtLiveEntry';
import type { PreEntryRecord, PreEntryRound } from '@/lib/fish/preEntryMonitor';
import type { FishCdaTracking } from '@/hooks/useFishCdaTracking';

const pairing = vi.hoisted(() => 'a'.repeat(64));
vi.mock('@/lib/fish/fishPreferencesDb', async original => ({ ...await original<typeof import('@/lib/fish/fishPreferencesDb')>(),
  readFishPreferences: vi.fn(async () => [pairing]) }));
const T = Date.UTC(2026,10,22,12,30);
let commands: {url:string;command:string;campaigns:unknown[]}[];
let known: {id:string;symbol:string;state:string}[];

function admission(capturedAt:number|undefined=T, admittedAt=T) {
  const source={id:'source',symbol:'JTOUSDT',exchange:'binance' as const,timeMs:admittedAt,timeLabel:'',fallbackZone:''};
  const record:PreEntryRecord={id:'entry',roundId:'round',status:'matched',startTime:admittedAt,cursor:admittedAt,
    matchedAt:admittedAt,updatedAt:admittedAt,readings:[],sample:{id:source.id,source,basis:'signal',groups:[],enteredAt:admittedAt,importedAt:admittedAt}};
  const plan=freezeQualityPlan(makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE,'>=',3,[]));
  const round:PreEntryRound={id:'round',startedAt:admittedAt,updatedAt:admittedAt,state:'complete',instantTrading:true,
    liveCapturedAt:capturedAt,hours:1,filters:[],instantMonitor:{version:INSTANT_TEMPLATE_MONITOR,templateId:'frozen',name:'fixture',plan},
    instantPosition:{version:1,availableUsdt:1234,marginPct:5,leverage:8,balanceObservedAt:T-60_000}};
  const tracking={admitted:[{record,round}],alerts:new Map(),enabled:false,active:0,awaitingMail:0,error:'',saving:false,
    setEnabled:async()=>{}} satisfies FishCdaTracking;
  return {tracking,id:instantPositionInput(record,round)!.id};
}

beforeEach(() => {
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(T);
  commands=[];known=[];
  // jsdom lacks AbortSignal.any; transport is mocked, so the lifetime signal is sufficient here.
  vi.stubGlobal('AbortSignal',{any:(signals:AbortSignal[])=>signals[0],timeout:()=>new AbortController().signal});
  vi.stubGlobal('fetch',vi.fn(async (url:string,init:RequestInit) => {
    const body=JSON.parse(init.body as string);commands.push({url,...body});
    return new Response(JSON.stringify({connected:true,paused:false,startedAt:T-300_000,executionSafety:2,
      guardPlusAdditions:1,statuses:known}),{headers:{'Content-Type':'application/json'}});
  }));
});
afterEach(() => { cleanup();vi.unstubAllGlobals();vi.useRealTimers(); });
const sync=()=>commands.filter(command=>command.command==='sync');

it('sends a fresh calibrated admission to the safe executor endpoint with its original capture time',async () => {
  const {tracking,id}=admission();renderHook(()=>useUsdtFollow('fixture',tracking));
  await waitFor(()=>expect(sync().some(command=>command.campaigns.length===1)).toBe(true));
  expect(sync().at(-1)).toMatchObject({url:'http://127.0.0.1:47321/api/usdt-follow/safe',campaigns:[{id,
    liveEntry:{capturedAt:T,templateId:'frozen',notional:493.6,leverage:8},actions:[{id:'open',at:T,action:'open'}]}]});
});

it.each(['historical','expired'] as const)('does not submit a %s admission as a new live order',async kind => {
  const {tracking}=kind==='historical'?admission(undefined):admission(T-180_000,T-USDT_ENTRY_MAX_AGE_MS-1);
  if(kind==='historical')tracking.admitted[0].round.liveCapturedAt=undefined;
  renderHook(()=>useUsdtFollow('fixture',tracking));
  await waitFor(()=>expect(sync().length).toBeGreaterThan(0));
  expect(sync().every(command=>command.campaigns.length===0)).toBe(true);
});

it('keeps synchronizing an executor-confirmed existing position without authorizing a new historical entry',async () => {
  const {tracking,id}=admission(undefined,T-180_000);tracking.admitted[0].round.liveCapturedAt=undefined;
  known=[{id,symbol:'JTOUSDT',state:'tracking'}];renderHook(()=>useUsdtFollow('fixture',tracking));
  await waitFor(()=>expect(sync().some(command=>command.campaigns.length===1)).toBe(true));
  expect(sync().at(-1)?.campaigns[0]).toMatchObject({id});
  expect(sync().at(-1)?.campaigns[0]).not.toHaveProperty('liveEntry');
});
