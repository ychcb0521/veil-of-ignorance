import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {QualityCampaignCardTitle,qualityCampaignCoverTitle} from '../QualityCampaignCardTitle';
import {qualityMirrorCampaignFixture} from '@/test/fixtures/qualityMirrorCampaign';
afterEach(cleanup);
it('keeps generated cover names concise and opens complete notes without navigating the card',()=>{
 const campaign=qualityMirrorCampaignFixture().campaign;campaign.symbol='RAVEUSDT';delete campaign.comparison!.planLabel;campaign.title='RAVEUSDT · 卖出算法组合2（在组合1的基础上有加仓） CDA 原始值 < 0.5 · 否决：静态回撤 5% · 多轮加仓';campaign.comparison!.sellLabel=campaign.title.replace('RAVEUSDT · ','');campaign.notes='完整条件：几何仓位 ≥ 100 倍 且 高于均衡价 5%';
 const open=vi.fn();render(<div className="group" onClick={open}><QualityCampaignCardTitle campaign={campaign}/></div>);
 expect(screen.getByRole('heading')).toHaveTextContent(/^RAVEUSDT · 卖出算法组合2$/);expect(screen.queryByText(campaign.title)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'查看战役备注'}));expect(screen.getByText(campaign.title)).toBeInTheDocument();fireEvent.click(screen.getByText(campaign.notes));expect(open).not.toHaveBeenCalled();
});
it('preserves personal campaign titles and uses the frozen plan name for new monitoring campaigns',()=>{
 const campaign=qualityMirrorCampaignFixture().campaign;campaign.comparison!.planLabel='我的趋势方案';expect(qualityCampaignCoverTitle(campaign)).toBe(campaign.symbol+' · 我的趋势方案');expect(qualityCampaignCoverTitle({...campaign,comparison:undefined,title:'我的亲自交易记录'})).toBe('我的亲自交易记录');
});
