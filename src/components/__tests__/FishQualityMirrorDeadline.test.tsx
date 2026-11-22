import {useState} from 'react';
import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {FishQualityHardStopStagesEditor} from '../FishQualityHardStopStagesEditor';
import {holdingVetoDraft,parseHoldingVetoDraft,type HoldingVetoDraft} from '@/lib/fish/qualityFilters';
import {MIRROR_DEADLINE_KIND,MIRROR_DEADLINE_VERSION} from '@/lib/fish/qualityMirrorDeadline';
import type {QualityHoldingVeto} from '@/lib/fish/qualityVeto';
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
