import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import {DeepDigGuideContent} from '../DeepDigGuideContent';
import {DEEP_DIG_GUIDE,DEEP_DIG_GUIDE_TOC} from '../deepDigGuideOutline';
import {CDA_DEF,STATE_DEF,DBL5_DEF} from '@/lib/deepDig/features';

afterEach(cleanup);
it('keeps short numbered chapters, focuses CDA/S/DBL and places guard rules inside DBL',()=>{
  render(<DeepDigGuideContent/>);
  expect(DEEP_DIG_GUIDE_TOC.label).toBe('4.8 Deep Dig');expect(DEEP_DIG_GUIDE.children).toHaveLength(6);
  const root=screen.getByTestId('deep-dig-guide-content');
  expect(root.textContent).not.toContain('**');expect(root.querySelector('#deep-dig-guard strong')?.textContent).toBe('定义');
  const headings=Array.from(root.querySelectorAll('h3,h4,h5')).map(h=>h.textContent!);
  expect(headings).toHaveLength(8);expect(headings.every(h=>h.match(/^\d+(?:\.\d+)*/)?.[0].split('.').length<=4)).toBe(true);
  expect(root.querySelectorAll('#deep-dig-cda')).toHaveLength(1);expect(root.querySelector('#deep-dig-dbl5 #deep-dig-guard')).not.toBeNull();
  expect(within(root).getByRole('heading',{name:'4.8.4.1 防守线'})).toBeInTheDocument();
  expect(root).toHaveTextContent('0.5 是模型均衡点');expect(root).toHaveTextContent('0.6 参考线');expect(root).toHaveTextContent('越低、越负');
  expect(root).toHaveTextContent('原生收盘断裂与交易方案的 K 触价是两种执行口径');
});
it('shows complete canonical formulas in folded references without rewriting definitions',()=>{
  const before=JSON.stringify([CDA_DEF,STATE_DEF,DBL5_DEF]);
  render(<DeepDigGuideContent/>);
  for(const [key,def] of [['CDA_FORMULA',CDA_DEF],['STATE_FORMULA',STATE_DEF],['DBL5_FORMULA',DBL5_DEF]] as const){
    const detail=document.querySelector(`[data-guide-formula="${key}"]`)!;
    expect(detail).not.toHaveAttribute('open');expect(detail.querySelector('pre')?.textContent).toBe(def.formula);
  }
  expect(JSON.stringify([CDA_DEF,STATE_DEF,DBL5_DEF])).toBe(before);
  expect(screen.getByTestId('deep-dig-guide-content')).not.toHaveTextContent('[[CDA_FORMULA]]');
});
