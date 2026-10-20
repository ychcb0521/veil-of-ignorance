import {beforeEach,it,expect} from 'vitest';
import {readFishPreference,saveFishPreference,withFishDefaultThreshold,fishPreferenceKey,FISH_DEFAULTS_VERSION} from '@/lib/fish/preferences';
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
it('旧卡统一重置一次，新版本的手填值不再重置',()=>{
 const pref={statistic:'结果',direction:'>' as const,threshold:'',constraints:[]};
 expect(withFishDefaultThreshold('cba',pref).threshold).toBe('8');
 expect(withFishDefaultThreshold('cba',{...pref,threshold:'2.1',lastSuggestion:'2.1'})).toMatchObject({threshold:'8',lastSuggestion:undefined});
 expect(withFishDefaultThreshold('cba',{...pref,threshold:'7',lastSuggestion:'2.1'}).threshold).toBe('8');
 expect(withFishDefaultThreshold('cba',{...pref,threshold:'7',thresholdDefaultsVersion:FISH_DEFAULTS_VERSION}).threshold).toBe('7');
});

it('账号旧偏好里的非空值也恢复默认，手动保存后刷新继续保留',()=>{
 for(const [id,old,value] of [['cbi2','0.06','0.04'],['bss','0.1','0.08'],['cba','10','8'],['drift-speed-z','15','10']]){
  localStorage.setItem(fishPreferenceKey(id),JSON.stringify({statistic:'结果',direction:'>',threshold:old,constraints:[]}));
  const migrated=readFishPreference(id);expect(migrated.threshold).toBe(value);expect(migrated.thresholdDefaultsVersion).toBe(FISH_DEFAULTS_VERSION);
  saveFishPreference(id,{...migrated,threshold:'6'});expect(readFishPreference(id).threshold).toBe('6');
 }
});
