import {useState} from 'react';
import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {FishQualityHardStopStagesEditor} from '../FishQualityHardStopStagesEditor';
import {holdingVetoDraft,parseHoldingVetoDraft,makeQualityHoldingVeto,type HoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {MIRROR_LOSS_REVIEW_KIND as KIND,MIRROR_LOSS_REVIEW_VERSION as V2,MIRROR_LOSS_THRESHOLD_VERSION as V3,MIRROR_REVIEW_SCHEDULE_VERSION as V4} from '@/lib/fish/qualityMirrorLossReview';
import type {QualityHoldingVeto} from '@/lib/fish/qualityVeto';
import {MIRROR_DEADLINE_KIND as LEGACY_KIND,MIRROR_DEADLINE_VERSION as LEGACY_VERSION} from '@/lib/fish/qualityMirrorDeadline';
afterEach(cleanup);
function Editor({saved=[],readOnly=false}:{saved?:QualityHoldingVeto[];readOnly?:boolean}){
 const [draft,setDraft]=useState<HoldingVetoDraft[]>(saved.length?holdingVetoDraft(saved):[]);
 return <><FishQualityHardStopStagesEditor readOnly={readOnly} draft={draft} setDraft={setDraft}/><button onClick={()=>{document.querySelector('output')!.textContent=JSON.stringify(parseHoldingVetoDraft(draft));}}>保存时限</button><output/></>;
}
it('uses only three numeric controls and saves/restores start, interval and percent at full precision',()=>{
 const view=render(<Editor/>),before=within(screen.getByTestId('quality-hard-stop-before'));
 expect(within(screen.getByTestId('quality-hard-stop-after')).queryByRole('button',{name:'添加镜像限时终止'})).toBeNull();
 fireEvent.click(before.getByRole('button',{name:'添加镜像限时终止'}));
 const settings=within(screen.getByTestId('mirror-review-simple-settings'));
 expect(settings.getAllByRole('spinbutton')).toHaveLength(3);expect(settings.queryByRole('combobox')).toBeNull();
 const start=settings.getByLabelText('镜像前 持仓否决 1 开始时间（小时）');expect(start).toHaveValue(1);
 expect(settings.getByLabelText('镜像前 持仓否决 1 判断间隔（小时）')).toHaveValue(.5);
 expect(settings.getByLabelText('镜像前 持仓否决 1 亏损门槛')).toHaveValue(0);
 expect(settings.getByTestId('mirror-review-loss-unit')).toHaveTextContent('%');
 expect(before.getByLabelText('镜像前 启用持仓否决 1')).not.toBeChecked();
 fireEvent.change(start,{target:{value:'0.5123456789'}});
 fireEvent.change(settings.getByLabelText('镜像前 持仓否决 1 判断间隔（小时）'),{target:{value:'0.25123456789'}});
 fireEvent.change(settings.getByLabelText('镜像前 持仓否决 1 亏损门槛'),{target:{value:'2.123456789'}});
 expect(settings.getByTestId('mirror-review-rule-summary')).toHaveTextContent('每 0.25123456789 小时判断');
 expect(settings.getByTestId('mirror-review-rule-summary')).toHaveTextContent('亏损达到 2.123456789%');
 expect(settings.queryByText(/亏损百分比按整笔/)).toBeNull();
 fireEvent.click(settings.getByRole('button',{name:'镜像前 持仓否决 1 百分比依据'}));expect(screen.getByText(/亏损百分比按整笔账面盈亏/)).toBeInTheDocument();
 fireEvent.click(before.getByLabelText('镜像前 启用持仓否决 1'));fireEvent.click(screen.getByRole('button',{name:'保存时限'}));
 const saved=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved).toMatchObject([{kind:KIND,threshold:.5123456789,enabled:true,mirrorDeadlineVersion:V4,mirrorLossThreshold:{version:V3,unit:'percent',value:2.123456789},mirrorReviewSchedule:{version:V4,intervalHours:.25123456789,endHours:12},mirrorStage:{stage:'before'}}]);
 view.unmount();render(<Editor saved={saved}/>);
 expect(screen.getByLabelText('镜像前 持仓否决 1 开始时间（小时）')).toHaveValue(.5123456789);
 expect(screen.getByLabelText('镜像前 持仓否决 1 判断间隔（小时）')).toHaveValue(.25123456789);
 expect(screen.getByLabelText('镜像前 持仓否决 1 亏损门槛')).toHaveValue(2.123456789);
});
it.each(['percent','usdt'] as const)('preserves the v3 %s unit, value and fixed interval without another setup choice',unit=>{
 const saved=[makeQualityHoldingVeto(KIND,'>=',1,true,[],100,{version:V3,unit,value:12.345678901})],original=structuredClone(saved);render(<Editor saved={saved}/>);
 const settings=within(screen.getByTestId('mirror-review-simple-settings'));
 expect(settings.getAllByRole('spinbutton')).toHaveLength(3);expect(settings.queryByRole('combobox')).toBeNull();
 expect(settings.getByTestId('mirror-review-loss-unit')).toHaveTextContent(unit==='percent'?'%':'USDT');
 fireEvent.click(screen.getByRole('button',{name:'保存时限'}));expect(JSON.parse(document.querySelector('output')!.textContent!)).toEqual(saved);
 fireEvent.change(settings.getByLabelText('持仓否决 1 亏损门槛'),{target:{value:'3.123456789'}});fireEvent.click(screen.getByRole('button',{name:'保存时限'}));
 const edited=JSON.parse(document.querySelector('output')!.textContent!)[0];
 expect(edited.mirrorDeadlineVersion).toBe(V3);expect(edited.mirrorLossThreshold).toMatchObject({unit,value:3.123456789});expect(edited.mirrorReviewSchedule).toBeUndefined();expect(saved).toEqual(original);
});
it('keeps v2 assets unchanged until the user explicitly edits the interval',()=>{
 const saved=[makeQualityHoldingVeto(KIND,'>=',1)],original=structuredClone(saved);render(<Editor saved={saved}/>);
 fireEvent.click(screen.getByRole('button',{name:'保存时限'}));expect(JSON.parse(document.querySelector('output')!.textContent!)).toEqual(saved);expect(saved[0].mirrorDeadlineVersion).toBe(V2);
 fireEvent.change(screen.getByLabelText('持仓否决 1 判断间隔（小时）'),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:'保存时限'}));
 expect(JSON.parse(document.querySelector('output')!.textContent!)[0]).toMatchObject({mirrorDeadlineVersion:V4,mirrorReviewSchedule:{intervalHours:1},mirrorLossThreshold:{unit:'percent',value:0}});expect(saved).toEqual(original);
});
it('disables all three parameters in read-only settings while retaining the percentage explanation',()=>{
 const saved=parseHoldingVetoDraft([{choice:KIND,direction:'>=',threshold:'1',enabled:true,lossThreshold:{version:V3,unit:'percent',value:'2'},reviewSchedule:{version:V4,intervalHours:'0.25',endHours:12}}],[]);
 render(<Editor saved={saved} readOnly/>);
 for(const input of within(screen.getByTestId('mirror-review-simple-settings')).getAllByRole('spinbutton'))expect(input).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'持仓否决 1 百分比依据'}));expect(screen.getByText(/亏损百分比按整笔账面盈亏/)).toBeInTheDocument();
});
it('restores the v1 unconditional deadline without converting its parameters',()=>{
 const saved=[makeQualityHoldingVeto(LEGACY_KIND,'>=',1.5)],original=structuredClone(saved);render(<Editor saved={saved}/>);
 expect(screen.getByLabelText('持仓否决 1 指标')).toHaveValue(LEGACY_KIND);expect(screen.getByLabelText('持仓否决 1 镜像时限（小时）')).toHaveValue(1.5);
 fireEvent.click(screen.getByRole('button',{name:'保存时限'}));const restored=JSON.parse(document.querySelector('output')!.textContent!);
 expect(restored).toEqual(saved);expect(restored[0].mirrorDeadlineVersion).toBe(LEGACY_VERSION);expect(saved).toEqual(original);
});
