import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {DeepDigDirectory} from '@/pages/JournalDeepDigPage';
import {MBI_DEF,newFeatureTemplate,copyFeatureDefinition} from '@/lib/deepDig/features';
afterEach(cleanup);
it('shows Beijing creation time beside every feature, distinguishing version history, recorded copies and unknown legacy records',()=>{
 const created=Date.parse('2026-10-30T05:26:17Z'),custom={...newFeatureTemplate(created),name:'自建特征'},copy=copyFeatureDefinition(MBI_DEF,[MBI_DEF],created+60000),old={...custom,id:'old',createdAt:undefined};const onOpen=vi.fn(),onCopy=vi.fn();
 render(<DeepDigDirectory defs={[MBI_DEF,custom,copy,old]} results={{}} notes={{}} onOpen={onOpen} onCopy={onCopy} onAdd={()=>{}}/>);
 expect(screen.getAllByTestId('deep-dig-entry')).toHaveLength(4);
 const saved=screen.getByTestId('deep-dig-created-'+custom.id);expect(saved).toHaveTextContent('创建于 2026-10-30 13:26');expect(saved).toHaveAttribute('data-source','recorded');expect(saved.querySelector('time')).toHaveAttribute('datetime','2026-10-30T05:26:17.000Z');expect(saved.title).toContain('北京时间 2026-10-30 13:26:17');
 expect(screen.getByTestId('deep-dig-created-'+copy.id)).toHaveTextContent('2026-10-30 13:27');
 const builtin=screen.getByTestId('deep-dig-created-mbi');expect(builtin).toHaveTextContent('创建于 2026-10-29 06:26');expect(builtin).toHaveTextContent('版本记录');expect(builtin.title).toContain('07010b08');
 expect(screen.getByTestId('deep-dig-created-old')).toHaveTextContent('创建时间未记录');
 fireEvent.click(screen.getByTestId('deep-dig-open-'+custom.id+'-infer'));expect(onOpen).toHaveBeenCalledWith(custom.id,'infer');fireEvent.click(screen.getByTestId('deep-dig-copy-mbi'));expect(onCopy).toHaveBeenCalledWith(MBI_DEF);
});
