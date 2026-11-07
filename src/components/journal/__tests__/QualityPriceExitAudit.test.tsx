import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {QualityPriceExitAudit} from '../QualityPriceExitAudit';
import {QualitySellTiming} from '../QualitySellEvidence';
import {QualityCampaignChartFrame} from '../QualityCampaignChartFrame';
import {qualityMirrorCampaignFixture} from '@/test/fixtures/qualityMirrorCampaign';
const T=Date.UTC(2026,4,29,6,15),minute=60000;
const klines=[{time:T,open:.23227,high:.23450,low:.21518,close:.22560,volume:1}];
afterEach(cleanup);
it('shows the exact frozen price stop and the containing candle low without repricing the campaign',()=>{
 const {campaign}=qualityMirrorCampaignFixture(),e=campaign.comparison!.sellEvidence!;
 Object.assign(e,{confirmedAt:T+2*minute,executedAt:T+2*minute,reading:.21742736288038955,triggerCause:{id:'box',kind:'box-stop',label:'DBL-5 防守线 − 0.5ATR',direction:'<=',threshold:.21742736288038955,boxStopEvidence:{version:'holding-box-stop-v1',line:.21742736288038955,confirmedAt:T,confirmation:'touch'}}});
 const before=structuredClone(campaign);
 render(<><QualityCampaignChartFrame campaign={campaign} chartHeight={360} klines={klines} intervalMs={5*minute}><div>盘面</div></QualityCampaignChartFrame><QualitySellTiming evidence={e}/></>);
 const audit=screen.getByTestId('quality-price-exit-audit');expect(audit).toHaveTextContent('执行 K 0.21742736288');expect(audit).toHaveTextContent('最低价 0.21518');expect(audit).toHaveTextContent('14:17:00 触价分钟');expect(audit).toHaveTextContent('显示 K 线起点 2026-05-29 14:15:00');
 expect(screen.getByTestId('quality-sell-timing')).toHaveTextContent('不等待 5 分钟收盘或防守线红叉');expect(campaign).toEqual(before);
});
it('distinguishes a rolling five-minute 7% trigger from the aligned candle body and later rebound',()=>{
 const {campaign}=qualityMirrorCampaignFixture(),e=campaign.comparison!.sellEvidence!;
 Object.assign(e,{barOpenAt:T-2*minute,confirmedAt:T+3*minute,executedAt:T+3*minute,reading:7.001156861904964,triggerCause:{id:'drop',kind:'drop-5m',label:'5分钟内跌幅',direction:'>=',threshold:7}});
 render(<><QualityPriceExitAudit campaign={campaign} klines={klines} intervalMs={5*minute}/><QualitySellTiming evidence={e}/></>);
 const audit=screen.getByTestId('quality-price-exit-audit');expect(audit).toHaveTextContent('滚动 5 分钟跌幅 7.00115686% >= 7%');expect(audit).toHaveTextContent('本图 5m K 线实体跌幅 2.87%');expect(audit).toHaveTextContent('2026-05-29 14:13:00 → 2026-05-29 14:18:00');expect(audit).toHaveTextContent('触发之后的反弹');expect(screen.getByTestId('quality-sell-timing')).toHaveTextContent('窗口不必与图上 5 分钟 K 线边界对齐');
});
it('does not invent a touched price, candle or execution for a red-cross event or pending result',()=>{
 const {campaign}=qualityMirrorCampaignFixture(),e=campaign.comparison!.sellEvidence!;
 Object.assign(e,{confirmedAt:T,executedAt:T,triggerCause:{kind:'box-stop',boxBreakEvidence:{version:'holding-support-break-v1'}}});
 const view=render(<QualityPriceExitAudit campaign={campaign} klines={klines}/>);expect(screen.queryByTestId('quality-price-exit-audit')).toBeNull();
 Object.assign(e,{executedAt:undefined,triggerCause:{kind:'drop-5m',direction:'>=',threshold:7}});view.rerender(<QualityPriceExitAudit campaign={campaign}/>);expect(screen.queryByTestId('quality-price-exit-audit')).toBeNull();
});
