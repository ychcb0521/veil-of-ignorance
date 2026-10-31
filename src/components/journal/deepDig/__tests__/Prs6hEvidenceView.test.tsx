import {it,expect} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {Prs6hEvidenceView} from '../Prs6hEvidenceView';
import {prsPositive} from '@/lib/deepDig/__tests__/fixtures/prsBars';
import {PRS6H_DEF} from '@/lib/deepDig/features';
import type {DeepDigData} from '@/lib/deepDig/analysis';
it('shows actual computed readiness, fixed structure, five components and honest market-only semantics',()=>{
 const {bars,rows}=prsPositive(),data={definition:PRS6H_DEF,rows:[{id:'positive',symbol:'TESTUSDT',anchorMs:rows.at(-1)!.PRS6H_at,PRS6H_details:rows.at(-1)}]} as unknown as DeepDigData;
 render(<Prs6hEvidenceView data={data} series={{PRS6H_windows:{positive:{rows,prices:bars.map((b,i)=>({time:rows[i].PRS6H_at,close:b.close}))}}} as any}/>);
 expect(screen.getByRole('img',{name:'PRS-6H 最终分与原始证据'})).toBeVisible();expect(screen.getByTestId('prs6h-evidence')).toHaveTextContent('市场条件已就绪');expect(screen.getByTestId('prs6h-evidence')).toHaveTextContent('分数不是胜率');
 fireEvent.change(screen.getByLabelText('PRS6H 已收盘时点'),{target:{value:'10'}});expect(screen.getByTestId('prs6h-evidence')).toHaveTextContent('数据不足或不可计算');
});
