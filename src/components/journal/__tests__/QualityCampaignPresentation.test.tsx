import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QualityCampaignChartFrame} from '../QualityCampaignChartFrame';
import {QualitySellEvidence} from '../QualitySellEvidence';
import {CampaignLegsList} from '../CampaignLegsList';
import {qualityMirrorCampaignFixture} from '@/test/fixtures/qualityMirrorCampaign';
import {buildCampaignLegsExportRows} from '@/lib/campaignLegsPngExport';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('keeps candles at their full height while mirror details expand into extra page height',()=>{
 const data=qualityMirrorCampaignFixture();let detailHeight=36,notify:()=>void=()=>{};
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(){return {height:this.dataset.testid==='quality-mirror-board'?detailHeight:0,width:1200,top:0,bottom:detailHeight,left:0,right:1200,x:0,y:0,toJSON(){}};});
 vi.stubGlobal('ResizeObserver',class {constructor(cb:()=>void){notify=cb;}observe(){}unobserve(){}disconnect(){}});
 render(<><QualitySellEvidence evidence={data.campaign.comparison!.sellEvidence}/><QualityCampaignChartFrame campaign={data.campaign} chartHeight={600}><div>真实盘面</div></QualityCampaignChartFrame></>);
 const surface=screen.getByTestId('campaign-candle-surface'),frame=screen.getByTestId('campaign-chart-frame'),details=screen.getByTestId('quality-mirror-details');
 expect(surface).toHaveStyle({height:'598px'});expect(frame).toHaveStyle({height:'636px'});expect(details).not.toHaveAttribute('open');expect(screen.getByTestId('quality-evidence-details')).not.toHaveAttribute('open');
 fireEvent.click(within(details).getByText('成交明细 ▾'));detailHeight=130;act(()=>notify());expect(frame).toHaveStyle({height:'730px'});expect(surface).toHaveStyle({height:'598px'});
});
it('renders mirror as a normal settled Legs row and exports identical allocation and total PnL',()=>{
 const fixture=qualityMirrorCampaignFixture(),data={...fixture,unfilledOrderIds:new Set(fixture.unfilledOrderIds??[])};vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({measureText:(text:string)=>({width:text.length*7})} as CanvasRenderingContext2D);const view=render(<MemoryRouter><CampaignLegsList {...data} campaignEvents={data.campaign.actual_evolution}/></MemoryRouter>);
 const mirror=data.legs.find(l=>l.leg_role==='mirror_tp')!;expect(screen.getByTestId(`leg-frozen-role-${mirror.id}`)).toHaveTextContent('镜像止盈');expect(screen.getByTestId('legs-total-row')).toHaveTextContent('+32.50');
 const rows=buildCampaignLegsExportRows(data),row=rows.find(r=>r.legId===mirror.id)!;expect(row.cells.flat().map(c=>c.text).join(' ')).toContain('镜像止盈');expect(row.cells.flat().map(c=>c.text).join(' ')).toContain('+2.50');
 expect(data.legs.reduce((n,l)=>n+l.pre_position_size!,0)).toBe(320);
 const added=data.legs.find(l=>l.leg_role==='main_add_1')!;expect(screen.getByTestId(`add-sizing-check-ok-${added.id}`)).toBeInTheDocument();const oversized={...data,legs:data.legs.map(l=>l.id===added.id?{...l,pre_position_size:l.pre_position_size!*1.1}:l),tradeRecords:data.tradeRecords.map(r=>r.positionId===added.trade_record_id?{...r,quantity:r.quantity*1.1,pnl:r.pnl*1.1}:r)};view.rerender(<MemoryRouter><CampaignLegsList {...oversized} campaignEvents={data.campaign.actual_evolution}/></MemoryRouter>);fireEvent.click(screen.getByTestId(`add-sizing-check-fail-${added.id}`));expect(screen.getByTestId('add-sizing-detail-dialog')).toBeInTheDocument();expect(screen.getByTestId('add-sizing-correct-coins')).toHaveTextContent('2');
});
it('fits compact notes and all candle/indicator panes inside the viewport and expands details without covering panes',()=>{
 const data=qualityMirrorCampaignFixture();let total=37,notify:()=>void=()=>{};
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(){const h=this.dataset.testid==='quality-mirror-board'?total:this.tagName==='SUMMARY'?36:this.dataset.testid==='quality-mirror-details'?total-1:0;return {height:h,width:1200,top:0,bottom:h,left:0,right:1200,x:0,y:0,toJSON(){}};});
 vi.stubGlobal('ResizeObserver',class {constructor(cb:()=>void){notify=cb;}observe(){}unobserve(){}disconnect(){}});
 render(<QualityCampaignChartFrame campaign={data.campaign} chartHeight={360} fitHeight={600}><div>主图＋指标副图</div></QualityCampaignChartFrame>);
 const frame=screen.getByTestId('campaign-chart-frame'),surface=screen.getByTestId('campaign-candle-surface');expect(frame).toHaveStyle({height:'600px'});expect(surface).toHaveStyle({height:'561px'});
 fireEvent.click(screen.getByText('成交明细 ▾'));total=131;act(()=>notify());expect(surface).toHaveStyle({height:'561px'});expect(frame).toHaveStyle({height:'694px'});
});
it('shows the actual sale reason without expanding details and displays per-leg and total delta b from frozen static-stop risk',()=>{
 const data=qualityMirrorCampaignFixture();data.campaign.comparison!.sellEvidence!.exitReason='加仓支撑线 K 止损：107；盘中触线，按支撑价卖出';data.campaign.comparison!.sellEvidence!.holdingVetoes=[{id:'s',label:'静态止损',kind:'static-drawdown',direction:'>=',threshold:5}];vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({measureText:(text:string)=>({width:text.length*7})} as CanvasRenderingContext2D);
 render(<MemoryRouter><QualitySellEvidence evidence={data.campaign.comparison!.sellEvidence}/><CampaignLegsList campaign={data.campaign} legs={data.legs} tradeRecords={data.tradeRecords}/></MemoryRouter>);expect(screen.getByTestId('quality-sell-reason')).toBeVisible();expect(screen.getByTestId('quality-sell-reason')).toHaveTextContent('加仓支撑线 K 止损：107');expect(screen.getByTestId('quality-evidence-details')).not.toHaveAttribute('open');expect(screen.getByText('Δb')).toBeInTheDocument();expect(screen.getByTestId('legs-total-delta-b')).toHaveTextContent('6.50');
});
it('opens the full calculation even when a monitor addition passed validation',()=>{
 const data=qualityMirrorCampaignFixture();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({measureText:(text:string)=>({width:text.length*7})} as CanvasRenderingContext2D);render(<MemoryRouter><CampaignLegsList campaign={data.campaign} legs={data.legs} tradeRecords={data.tradeRecords}/></MemoryRouter>);const add=data.legs.find(l=>l.leg_role==='main_add_1')!;fireEvent.click(screen.getByTestId(`add-sizing-check-ok-${add.id}`));expect(screen.getByTestId('add-sizing-detail-dialog')).toBeVisible();expect(screen.getByTestId('add-sizing-detail-dialog')).toHaveTextContent('⑤ 可加仓 Q₂');expect(screen.getByTestId('add-sizing-correct-coins')).toHaveTextContent('2');
});
