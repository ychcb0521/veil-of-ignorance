import {beforeEach,it,expect} from 'vitest';
import {readFishPreference,saveFishPreference,withFishDefaultThreshold} from '@/lib/fish/preferences';
beforeEach(()=>localStorage.clear());
it('四个截图门槛默认填入，其他算法仍为空；手动修改、零值和中间量保持原样',()=>{
 for(const [id,value] of Object.entries({cbi2:'0.04',cba:'8',bss:'0.08','drift-speed-z':'10'})){
  expect(readFishPreference(id)).toMatchObject({statistic:'结果',threshold:value});
  saveFishPreference(id,{...readFishPreference(id),threshold:'12.34'});expect(readFishPreference(id).threshold).toBe('12.34');
  saveFishPreference(id,{...readFishPreference(id),threshold:'0'});expect(readFishPreference(id).threshold).toBe('0');
  saveFishPreference(id,{...readFishPreference(id),statistic:'V',threshold:''});expect(readFishPreference(id).threshold).toBe('');
 }
 expect(readFishPreference('custom').threshold).toBe('');
});
it('旧空卡和自动建议采用固定默认值，手填卡不被重置',()=>{
 const pref={statistic:'结果',direction:'>' as const,threshold:'',constraints:[]};
 expect(withFishDefaultThreshold('cba',pref).threshold).toBe('8');
 expect(withFishDefaultThreshold('cba',{...pref,threshold:'2.1',lastSuggestion:'2.1'})).toMatchObject({threshold:'8',lastSuggestion:undefined});
 expect(withFishDefaultThreshold('cba',{...pref,threshold:'7',lastSuggestion:'2.1'}).threshold).toBe('7');
});
