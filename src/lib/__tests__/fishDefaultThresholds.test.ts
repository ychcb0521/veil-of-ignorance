import {beforeEach,it,expect} from 'vitest';
import {readFishPreference,saveFishPreference,withFishDefaultThreshold,fishPreferenceKey,FISH_DEFAULTS_VERSION,fishDefaultThresholdVersion} from '@/lib/fish/preferences';
beforeEach(()=>localStorage.clear());
it('四个截图门槛默认填入，其他算法仍为空；手动修改、零值和中间量保持原样',()=>{
 for(const [id,value] of Object.entries({cbi2:'0.04',cba:'8',bss:'0.12','drift-speed-z':'15'})){
  expect(readFishPreference(id)).toMatchObject({statistic:'结果',threshold:value});
  saveFishPreference(id,{...readFishPreference(id),threshold:'12.34'});expect(readFishPreference(id).threshold).toBe('12.34');
  saveFishPreference(id,{...readFishPreference(id),threshold:'0'});expect(readFishPreference(id).threshold).toBe('0');
  saveFishPreference(id,{...readFishPreference(id),statistic:'V',threshold:''});expect(readFishPreference(id).threshold).toBe('');
 }
 expect(readFishPreference('custom').threshold).toBe('');
});
it('只有新建空白偏好填默认值，已有非空阈值不受版本影响',()=>{
 const pref={statistic:'结果',direction:'>' as const,threshold:'',constraints:[]};
 expect(withFishDefaultThreshold('cba',pref).threshold).toBe('8');
 expect(withFishDefaultThreshold('cba',{...pref,threshold:'2.1',lastSuggestion:'2.1'})).toMatchObject({threshold:'2.1',lastSuggestion:'2.1'});
 expect(withFishDefaultThreshold('cba',{...pref,threshold:'7',lastSuggestion:'2.1'}).threshold).toBe('7');
 expect(withFishDefaultThreshold('cba',{...pref,threshold:'7',thresholdDefaultsVersion:FISH_DEFAULTS_VERSION}).threshold).toBe('7');
});

it('旧偏好非空值和手动清空均保留',()=>{
 for(const [id,old,value] of [['cbi2','0.06','0.04'],['bss','0.08','0.12'],['cba','10','8'],['drift-speed-z','10','15']]){
  localStorage.setItem(fishPreferenceKey(id),JSON.stringify({statistic:'结果',direction:'>',threshold:old,constraints:[]}));
  const migrated=readFishPreference(id);expect(migrated.threshold).toBe(old);
  saveFishPreference(id,{...migrated,threshold:''});expect(readFishPreference(id).threshold).toBe('');
 }
});

it('DSP·a 旧门槛不升级覆盖，首次默认值仍是 15',()=>{
 const p={statistic:'结果',direction:'>' as const,threshold:'10',thresholdDefaultsVersion:1,constraints:[]};
 expect(withFishDefaultThreshold('drift-speed-z',p)).toMatchObject({threshold:'10',thresholdDefaultsVersion:1});
 expect(withFishDefaultThreshold('bss',{...p,threshold:'.12'}).threshold).toBe('.12');
 expect(readFishPreference('bss').threshold).toBe('0.12');
 saveFishPreference('drift-speed-z',{...p,threshold:'13'});expect(readFishPreference('drift-speed-z').threshold).toBe('13');
});
