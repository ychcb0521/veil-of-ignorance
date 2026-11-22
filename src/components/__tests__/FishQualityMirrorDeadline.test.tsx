import {useState} from 'react';
import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {FishQualityHardStopStagesEditor} from '../FishQualityHardStopStagesEditor';
import {holdingVetoDraft,parseHoldingVetoDraft,type HoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {MIRROR_LOSS_REVIEW_KIND as MIRROR_DEADLINE_KIND,MIRROR_LOSS_REVIEW_VERSION as MIRROR_DEADLINE_VERSION} from '@/lib/fish/qualityMirrorLossReview';
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
 expect(before.getByText(/小时起，每 0.5 小时检查至 12 小时/)).toBeInTheDocument();
 expect(before.getByLabelText('镜像前 启用持仓否决 1')).not.toBeChecked();
 expect(before.queryByLabelText('镜像前 持仓否决 1 方向')).toBeNull();
 fireEvent.change(duration,{target:{value:'0.5123456789'}});fireEvent.click(before.getByLabelText('镜像前 启用持仓否决 1'));
 fireEvent.click(screen.getByRole('button',{name:'保存时限'}));
 const saved=JSON.parse(document.querySelector('output')!.textContent!);
 expect(saved).toMatchObject([{kind:MIRROR_DEADLINE_KIND,threshold:.5123456789,enabled:true,mirrorDeadlineVersion:MIRROR_DEADLINE_VERSION,mirrorStage:{stage:'before'}}]);
 view.unmount();render(<Editor saved={saved}/>);
 expect(screen.getByLabelText('镜像前 持仓否决 1 镜像时限（小时）')).toHaveValue(.5123456789);
 expect(screen.getByLabelText('镜像前 启用持仓否决 1')).toBeChecked();
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
