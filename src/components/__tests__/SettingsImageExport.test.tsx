import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SettingsImageScope,SettingsImageButton} from '../SettingsImageExport';
import {DefinitionPanel} from '../journal/deepDig/DefinitionPanel';
import {FishQualityAdditionEditor,additionDraft} from '../FishQualityAdditionEditor';
import {defaultQualityAddition} from '@/lib/fish/qualityAddition';
import {BUILTIN_FEATURES} from '@/lib/deepDig/features';
import {downloadSettingsImage} from '@/lib/settingsImageExport';
vi.mock('@/lib/settingsImageExport',async original=>({...await original<typeof import('@/lib/settingsImageExport')>(),downloadSettingsImage:vi.fn(async()=>1)}));
afterEach(()=>{cleanup();vi.clearAllMocks();localStorage.clear();});
const captured=()=>vi.mocked(downloadSettingsImage).mock.calls.at(-1)![1].map(b=>b.text).join('\n');
it('exports Deep Dig definition/formula/parameters, excludes groups, and never saves',async()=>{
  const def=structuredClone(BUILTIN_FEATURES[0]),before=JSON.stringify(def),save=vi.fn();
  render(<DefinitionPanel def={def} editing={false} onEditingChange={()=>{}} onSave={save} samples={{campaigns:[],signals:[]}}/>);
  fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await screen.findByRole('status');
  expect(captured()).toContain(def.name);expect(captured()).toContain(def.formula);expect(captured()).toContain('完整参数');expect(captured()).not.toMatch(/分组|实验组|对照组/);expect(save).not.toHaveBeenCalled();expect(JSON.stringify(def)).toBe(before);
});
it('exports every addition round without switching the selected round or mutating the draft',async()=>{
  const draft=additionDraft({...defaultQualityAddition(),enabled:true,maxRounds:3}),before=JSON.stringify(draft),set=vi.fn();
  render(<SettingsImageScope title="持仓监测条件"><FishQualityAdditionEditor draft={draft} setDraft={set}/><SettingsImageButton/></SettingsImageScope>);
  fireEvent.click(screen.getByRole('tab',{name:'第 2 次'}));
  fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await screen.findByRole('status');
  expect(captured()).toContain('第 1 次加仓 · 完整条件');expect(captured()).toContain('第 3 次加仓 · 完整条件');expect(screen.getByRole('tab',{name:'第 2 次'})).toHaveAttribute('aria-selected','true');expect(set).not.toHaveBeenCalled();expect(JSON.stringify(draft)).toBe(before);
});
it('includes complete special-feature parameters and their current values without grouping standards',async()=>{
  for(const id of ['darvas_5m_lower','sbs_5m','ati6h']){
    const def=structuredClone(BUILTIN_FEATURES.find(d=>d.id===id)!);expect(def).toBeTruthy();
    if(id==='darvas_5m_lower')def.DBL5_config={n:7,guard_trend_atr:.1234567890123456,guard_range_atr:1.9876543210987654,guard_range_closes:3};
    const before=JSON.stringify(def),save=vi.fn();
    render(<DefinitionPanel def={def} editing={false} onEditingChange={()=>{}} onSave={save} samples={{campaigns:[],signals:[]}}/>);
    fireEvent.click(screen.getByRole('button',{name:'生成图片'}));await screen.findByRole('status');
    const text=captured();expect(text).toContain(def.formula);expect(text).toContain('完整参数');expect(text).not.toContain('分组');
    if(id==='darvas_5m_lower'){expect(text).toContain('"n": 7');expect(text).toContain('"window_minutes": 360');expect(text).toContain('防守线公式');expect(text).toContain('0.1234567890123456 × ATR');expect(text).toContain('1.9876543210987654 × ATR');expect(text).toContain('震荡期连续 3 根');}
    if(id==='sbs_5m')expect(text).toContain('"active_box_max_age": 6');
    if(id==='ati6h'){expect(text).toContain('"ATI6H_volume_mode": "taker"');expect(text).toContain('"WEIGHTS"');}
    expect(save).not.toHaveBeenCalled();expect(JSON.stringify(def)).toBe(before);cleanup();
  }
});
it('shows an encoding failure and permits a complete retry with the current values',async()=>{
  vi.mocked(downloadSettingsImage).mockRejectedValueOnce(Error('PNG 生成失败'));
  render(<SettingsImageScope title="条件"><input aria-label="数值" defaultValue="123.456789"/><SettingsImageButton/></SettingsImageScope>);
  fireEvent.click(screen.getByRole('button',{name:'生成图片'}));expect(await screen.findByRole('alert')).toHaveTextContent('PNG 生成失败');
  fireEvent.change(screen.getByLabelText('数值'),{target:{value:'987.654321'}});fireEvent.click(screen.getByRole('button',{name:'生成图片'}));
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('图片已生成并下载'));expect(captured()).toContain('987.654321');
});
