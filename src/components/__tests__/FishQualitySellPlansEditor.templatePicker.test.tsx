import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TemplatePicker } from '../FishQualitySellPlansEditor';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { newQualityStudy } from '@/lib/fish/quality';

it('omits built-in and screening templates in the holding template picker',async()=>{
 const {emptyPreEntryThreeStage}=await import('@/lib/fish/preEntryThreeStage'),p=enableQualityComparison(newQualityStudy()).sellPlans![0],entry={id:'screening',name:'筛选资产',savedAt:1,updatedAt:1,plan:{...p,preEntryThreeStage:emptyPreEntryThreeStage()}},holding={id:'holding',name:'持仓资产',savedAt:1,updatedAt:1,plan:p};
 render(<TemplatePicker disabled={false} actions={{templates:[entry,holding],save:vi.fn(),remove:vi.fn()}} onUse={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:/从模板新建/}));expect(screen.queryAllByTestId('plan-template-builtin')).toHaveLength(0);const items=screen.getAllByTestId('plan-template-item');expect(items).toHaveLength(1);expect(items[0]).toHaveTextContent('持仓资产');expect(screen.queryByText('筛选资产')).not.toBeInTheDocument();
});
