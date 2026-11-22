import {useState} from 'react';
import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {FishQualityHardStopStagesEditor} from '../FishQualityHardStopStagesEditor';
import {holdingVetoDraft,parseHoldingVetoDraft,type HoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {MIRROR_LOSS_REVIEW_KIND as MIRROR_DEADLINE_KIND,MIRROR_LOSS_THRESHOLD_VERSION as MIRROR_DEADLINE_VERSION,MIRROR_LOSS_REVIEW_VERSION} from '@/lib/fish/qualityMirrorLossReview';
import type {QualityHoldingVeto} from '@/lib/fish/qualityVeto';
import {makeQualityHoldingVeto} from '@/lib/fish/qualityFilters';
import {MIRROR_DEADLINE_KIND as LEGACY_KIND,MIRROR_DEADLINE_VERSION as LEGACY_VERSION} from '@/lib/fish/qualityMirrorDeadline';
afterEach(cleanup);
function Editor({saved=[]}:{saved?:QualityHoldingVeto[]}){
 const [draft,setDraft]=useState<HoldingVetoDraft[]>(saved.length?holdingVetoDraft(saved):[]);
 return <><FishQualityHardStopStagesEditor draft={draft} setDraft={setDraft}/><button onClick={()=>{document.querySelector('output')!.textContent=JSON.stringify(parseHoldingVetoDraft(draft));}}>保存时限</button><output/></>;
}
it('adds an independent before-mirror rule defaulting to one hour, saves full precision and restores it',()=>{
 const view=render(<Editor/>),before=within(screen.getByTestId('quality-hard-stop-before'));
 expect(within(screen.getByTestId('quality-hard-stop-after')).queryByRole('button',{name:'添加镜像限时终止'})).toBeNull();
 fireEvent.click(before.getByRole('button',{name:'添加镜像限时终止'}));
 const duration=before.getByLabelText('镜像前 持仓否决 1 镜像时限（小时）');expect(duration).toHaveValue(1);
 expect(before.getByLabelText('镜像前 持仓否决 1 亏损门槛')).toHaveValue(0);
 expect(before.getByLabelText('镜像前 持仓否决 1 亏损单位')).toHaveValue('percent');
 expect(before.getByText(/小时起，每 0.5 小时检查至 12 小时/)).toBeInTheDocument();
 expect(before.getByLabelText('镜像前 启用持仓否决 1')).not.toBeChecked();
 expect(before.queryByLabelText('镜像前 持仓否决 1 方向')).toBeNull();
 fireEvent.change(duration,{target:{value:'0.5123456789'}});fireEvent.change(before.getByLabelText('镜像前 持仓否决 1 亏损门槛'),{target:{value:'2.123456789'}});fireEvent.click(before.getByLabelText('镜像前 启用持仓否决 1'));
 fireEvent.click(screen.getByRole('button',{name:'保存时限'}));
 const saved=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved).toMatchObject([{kind:MIRROR_DEADLINE_KIND,threshold:.5123456789,enabled:true,mirrorDeadlineVersion:MIRROR_DEADLINE_VERSION,mirrorLossThreshold:{version:MIRROR_DEADLINE_VERSION,unit:'percent',value:2.123456789},mirrorStage:{stage:'before'}}]);
 view.unmount();render(<Editor saved={saved}/>);
 expect(screen.getByLabelText('镜像前 持仓否决 1 镜像时限（小时）')).toHaveValue(.5123456789);
 expect(screen.getByLabelText('镜像前 启用持仓否决 1')).toBeChecked();
 expect(screen.getByLabelText('镜像前 持仓否决 1 亏损门槛')).toHaveValue(2.123456789);
});
it.each(['percent','usdt'] as const)('saves and restores the selected loss unit and full editable number (%s)',unit=>{
 const view=render(<Editor/>),before=within(screen.getByTestId('quality-hard-stop-before'));
 fireEvent.click(before.getByRole('button',{name:'添加镜像限时终止'}));
 fireEvent.change(before.getByLabelText('镜像前 持仓否决 1 亏损单位'),{target:{value:unit}});
 fireEvent.change(before.getByLabelText('镜像前 持仓否决 1 亏损门槛'),{target:{value:'12.345678901'}});
 fireEvent.click(screen.getByRole('button',{name:'保存时限'}));const saved=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved[0].mirrorLossThreshold).toEqual({version:MIRROR_DEADLINE_VERSION,unit,value:12.345678901});
 view.unmount();render(<Editor saved={saved}/>);
 expect(screen.getByLabelText('镜像前 持仓否决 1 亏损门槛')).toHaveValue(12.345678901);
 expect(screen.getByLabelText('镜像前 持仓否决 1 亏损单位')).toHaveValue(unit);
});
it('keeps the v2 fixed-loss asset unchanged until the user explicitly edits the loss threshold',()=>{
 const saved=[makeQualityHoldingVeto(MIRROR_DEADLINE_KIND,'>=',1)],before=structuredClone(saved);
 render(<Editor saved={saved}/>);
 fireEvent.click(screen.getByRole('button',{name:'保存时限'}));
 expect(JSON.parse(document.querySelector('output')!.textContent!)).toEqual(saved);
 expect(saved[0].mirrorDeadlineVersion).toBe(MIRROR_LOSS_REVIEW_VERSION);
 fireEvent.change(screen.getByLabelText('持仓否决 1 亏损门槛'),{target:{value:'3'}});
 fireEvent.click(screen.getByRole('button',{name:'保存时限'}));
 const edited=JSON.parse(document.querySelector('output')!.textContent!);
 expect(edited[0]).toMatchObject({mirrorDeadlineVersion:MIRROR_DEADLINE_VERSION,mirrorLossThreshold:{unit:'percent',value:3}});
 expect(saved).toEqual(before);
});
it('restores the saved unconditional v1 deadline without converting it to the new loss-only schedule',()=>{
 const saved=[makeQualityHoldingVeto(LEGACY_KIND,'>=',1.5)],before=structuredClone(saved);
 render(<Editor saved={saved}/>);
 expect(screen.getByLabelText('持仓否决 1 指标')).toHaveValue(LEGACY_KIND);
 expect(screen.getByLabelText('持仓否决 1 镜像时限（小时）')).toHaveValue(1.5);
 fireEvent.click(screen.getByRole('button',{name:'保存时限'}));
 const restored=JSON.parse(document.querySelector('output')!.textContent!);
 expect(restored).toEqual(saved);expect(restored[0].mirrorDeadlineVersion).toBe(LEGACY_VERSION);expect(saved).toEqual(before);
});
