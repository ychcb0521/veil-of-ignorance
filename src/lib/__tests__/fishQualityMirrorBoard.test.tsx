import {QualitySellEvidence,QualitySellTiming} from '@/components/journal/QualitySellEvidence';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { buildQualityCampaignData } from '@/lib/fish/qualityCampaigns';
import { qualityMirrorBoard, qualityMirrorChartArtifacts } from '@/lib/fish/qualityMirrorBoard';
import { QualityMirrorBoard } from '@/components/journal/QualityMirrorBoard';
import { halfMirrorSummary } from '@/lib/fish/qualityPresentation';
import { importQualityLibrary, newQualityStudy, qualityComparisonRows, type QualityResult } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { buildCampaignEventStream, computeDecisionAccuracy, resolveCampaignEquityPathLegFacts } from '@/lib/campaignAnalysis';
import { computeCampaignRealizedPnl, reconcileCampaignWithSettlement } from '@/lib/campaignRealizedPnl';
import { mirrorPnlBreakdown } from '@/lib/fish/qualityMirror';
import { drawMirrorBoard } from '@/lib/campaignLegsPngExport';
import { resolveLegExecution } from '@/lib/campaignLegExecution';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import { campaignPriceChange } from '@/lib/campaignMainPriceChange';

const T = Date.UTC(2026, 9, 28), M = 60_000;
const rule = { enabled: true, gainPct: 5, sellPct: 50 };
function fixture(options: {open?: boolean; fraction?: number; fillPrice?: number; noFill?: boolean; disabled?: boolean; exitPrice?: number} = {}) {
  const study = enableQualityComparison(importQualityLibrary(newQualityStudy(T), [{id: 's', symbol: 'TESTUSDT', timeMs: T, timeLabel: '', fallbackZone: ''}]));
  const sample = qualityComparisonRows(study)[0], plan = study.sellPlans![0];
  plan.mirrorTakeProfit = {...rule, sellPct: (options.fraction ?? .5) * 100, enabled: !options.disabled};
  const fill = options.noFill ? undefined : {at: T + M, price: options.fillPrice ?? 105, fraction: options.fraction ?? .5, gainPct: 5, atOpen: (options.fillPrice ?? 105) > 105};
  const price = options.exitPrice ?? 110, breakdown = mirrorPnlBreakdown(100, 100, price, fill);
  const result: QualityResult = {key:'board', sampleId:sample.id, groupId:plan.id, status:options.open?'open':'closed', evaluatedAt:T+4*M,
    entryTime:T, entryPrice:100, endTime:fill?.fraction===1?fill.at:T+4*M, endPrice:price, pnl:breakdown.totalPnl, returnPct:breakdown.returnPct, peakPct:20,
    mirrorFill:fill, initialNotional:100, mirrorRealizedPnl:breakdown.mirrorPnl, remainingPnl:breakdown.remainingPnl};
  return {...buildQualityCampaignData('owner', {sample,plan,result,detectors:[],firstEvaluatedAt:T,observeHours:0}, 'sell'), result, plan};
}

describe('mirror campaign board and consistent accounting', () => {
  it('displays actual execution gain rather than final ROI, configured threshold or proportion-weighted gain', () => {
    const full = fixture({fillPrice:108, fraction:.25});
    const summary = halfMirrorSummary(full.plan.mirrorTakeProfit, full.result);
    expect(summary.value).toBeCloseTo(8); expect(summary.text).toBe('+8.00% · 已卖 25%');
    const model = qualityMirrorBoard(full.campaign)!;
    expect(model).toMatchObject({title:'镜像止盈',soldFraction:.25,remainingFraction:0,closed:true});
    expect(model.mirrorPnl).toBeCloseTo(2); expect(model.remainingPnl).toBeCloseTo(7.5);
    expect(model.returnPct).toBeCloseTo(9.5); expect(model.quantity).toBe(.25);
    render(<QualityMirrorBoard campaign={full.campaign}/>);
    expect(screen.getByTestId('mirror-actual-gain')).toHaveTextContent('+8.00%');
    expect(screen.getByTestId('mirror-total-roi')).toHaveTextContent('+9.50%');
    expect(screen.getByTestId('quality-mirror-board')).toHaveTextContent('余仓 75% 已按原卖出条件卖出');
    expect(screen.getByTestId('quality-mirror-board')).toHaveTextContent('止盈已兑现 +2.00 USDT');
    cleanup();
  });
  it('never derives a mirror fill from a later peak; legacy disabled and missing entry stay explicit', () => {
    const full=fixture({noFill:true});full.result.peakPct=30;
    const model=qualityMirrorBoard(full.campaign)!;
    expect(model.status).toBe('未触发');expect(model.gainPct).toBeNull();
    expect(qualityMirrorChartArtifacts(full.campaign).markers).toEqual([]);
    expect(halfMirrorSummary(rule,{...full.result,entryPrice:undefined,mirrorFill:{at:T,price:105,fraction:.5,gainPct:5,atOpen:false}}).value).toBeNull();
    expect(qualityMirrorBoard(fixture({noFill:true,disabled:true}).campaign)).toBeNull();
  });
  it.each([true,false])('preserves every partial/final event exactly once, without copying settlement PnL onto opening (open=%s)', open => {
    const {campaign,legs,tradeRecords}=fixture({open});
    const events=buildCampaignEventStream(campaign,legs,tradeRecords);
    expect(events.map(e=>e.event_type)).toEqual(open?['main_opened','main_partial_closed']:['main_opened','main_partial_closed','main_fully_closed','campaign_closed']);
    expect(events[0].price).toBe(100);expect(events[0].realized_pnl).toBeUndefined();
    expect(events[1]).toMatchObject({price:105,size_usdt:50,realized_pnl:expect.closeTo(2.5)});
    for (const event of events.filter(e=>e.event_type.endsWith('_closed') && e.trade_record_id)) expect(tradeRecords.some(r=>r.id===event.trade_record_id)).toBe(true);
    expect(events.filter(e=>e.realized_pnl!=null).reduce((s,e)=>s+e.realized_pnl!,0)).toBeCloseTo(open?2.5:7.5);
  });
  it('keeps unsold coins in the active equity path until frozen valuation, while only partial profit is realized', () => {
    const full=fixture({open:true});
    const klines=Array.from({length:4},(_,i)=>({time:T+i*M,open:100,high:i>=2?120:105,low:100,close:110,volume:1}));
    const facts=resolveCampaignEquityPathLegFacts(full.campaign,full.legs,full.tradeRecords);
    expect(facts.analysisEndMs).toBe(T+4*M);
    const accuracy=computeDecisionAccuracy(full.campaign,full.legs,full.tradeRecords,klines);
    expect(accuracy.campaign_max_profit_real).toBeCloseTo(2.5+50*.2);
    const settlement=computeCampaignRealizedPnl(full.campaign,full.legs,full.tradeRecords);
    expect(settlement.total).toBeCloseTo(2.5);expect(settlement.settled).toBe(false);
    expect(reconcileCampaignWithSettlement(full.campaign,full.legs,settlement).final_realized_pnl).toBeNull();
  });
  it.each([true,false])('resolves the frozen final exit, even when a position lookup picks the earlier mirror fill at a shared evaluation clock (reverse=%s)', reverse => {
    const full=fixture(), records=reverse?[...full.tradeRecords].reverse():full.tradeRecords;
    const leg=full.legs[0],record=buildTradeRecordLookup(records).get(leg.trade_record_id!)!;
    const execution=resolveLegExecution(leg,record);
    expect(execution).toMatchObject({entryPrice:100,exitPrice:110,closeTime:T+4*M});
    expect(campaignPriceChange(full.campaign,full.legs,records).pct).toBeCloseTo(10);
  });
  it.each([.25,.5,1])('uses actual quantities and one frozen fill for fraction %s in the board, event stream and settlement', fraction => {
    const full=fixture({fraction,exitPrice:fraction===1?105:90});
    const board=qualityMirrorBoard(full.campaign)!, annotations=qualityMirrorChartArtifacts(full.campaign);
    expect(board.gainPct).toBeCloseTo(5);expect(board.totalPnl).toBeCloseTo(100*fraction*.05+100*(1-fraction)*(fraction===1?.05:-.1));
    expect(full.tradeRecords.reduce((n,r)=>n+r.quantity,0)).toBeCloseTo(1);
    expect(computeCampaignRealizedPnl(full.campaign,full.legs,full.tradeRecords).total).toBeCloseTo(board.totalPnl!);
    expect(annotations.markers).toHaveLength(1);expect(annotations.markers[0]).toMatchObject({time:T+M,price:105,label:expect.stringContaining(`卖出 ${fraction*100}%`)});
    expect(annotations.timeBoundPriceLines[0].endTime).toBe(T+M);
  });
  it('includes the visible mirror strip in PNG capture instead of capturing only native candle canvases', () => {
    const full=fixture(), view=render(<div><QualityMirrorBoard campaign={full.campaign}/></div>);
    const box={left:0,top:0,width:1000,height:110} as DOMRect;
    const board=screen.getByTestId('quality-mirror-board');vi.spyOn(board,'getBoundingClientRect').mockReturnValue(box);
    const range=vi.spyOn(document,'createRange').mockReturnValue({setStart:vi.fn(),setEnd:vi.fn(),getBoundingClientRect:()=>({...box,width:8,height:12}),detach:vi.fn()} as unknown as Range);
    const ctx={save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),fillRect:vi.fn(),fillText:vi.fn()} as unknown as CanvasRenderingContext2D;
    try {
      drawMirrorBoard(ctx,view.container,box);
      const text=vi.mocked(ctx.fillText).mock.calls.map(call=>call[0]).join('');
      expect(text).toContain('半仓止盈');expect(text).toContain('+5.00%');expect(text).toContain('+7.50%');expect(text.replace(/\s/g,'')).toContain('余仓50%');
    } finally {range.mockRestore();cleanup();}
  });
});

it('shows every addition round and describes the K stop as a price with correct execution timing',()=>{
 const {campaign}=fixture(),e=campaign.comparison!.sellEvidence!;
 const fill={at:T+M,price:110,notional:220,quantity:2,scanFrom:T,reading:1,threshold:.5,direction:'>' as const,metric:'raw',label:'触发',barOpenTime:T,sizing:{support:107,previousSupport:100,atr:2,atrAt:T,coinsBefore:1,realAverageBefore:100,baseCoins:2,mirrorCoins:0,mirrorUsed:0}};
 e.addition={...defaultQualityAddition(),enabled:true};e.additionFill=fill;e.additionFills=[fill,{...fill,at:T+2*M,sizing:{...fill.sizing,support:117,previousSupport:107}}];e.totalInvested=540;e.averageEntryPrice=108;
 e.triggerCause={id:'addition-support',label:'加仓支撑线 K',kind:'addition-support',direction:'<=',threshold:117};e.reading=117;e.confirmedAt=T+3*M;e.executedAt=T+3*M;e.triggerAtOpen=true;
 render(<><QualitySellEvidence evidence={e}/><QualitySellTiming evidence={e}/></>);
 expect(screen.getByTestId('quality-addition-evidence')).toHaveTextContent('已成交 2 轮');expect(screen.getByTestId('quality-addition-evidence')).toHaveTextContent('成本线 S 107');expect(screen.getByTestId('quality-sell-timing')).toHaveTextContent('开盘跳空越过 K，按开盘价成交');expect(screen.getByTestId('quality-sell-evidence')).not.toHaveTextContent('117%');cleanup();
});
