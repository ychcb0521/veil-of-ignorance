import {useFeatureDefinitions} from '@/hooks/useFeatureDefinitions';
import {IMPULSE_1115_CLASSIFICATION_VERSION} from '@/lib/impulse1115Classification';
import {defaultHoldingImpulse1115Rule,type HoldingImpulse1115Rule} from '@/lib/fish/holdingImpulse1115Classification';
import {Impulse1115ClassificationSettings} from './journal/deepDig/Impulse1115ClassificationSettings';

export function FishHoldingImpulse1115Settings({value,onChange,readOnly=false}:{
  value?:HoldingImpulse1115Rule;onChange?:(value:HoldingImpulse1115Rule|undefined)=>void;readOnly?:boolean;
}){
  const definitions=useFeatureDefinitions();
  if(readOnly&&!value)return null;
  return <section aria-label="持仓急拉线1115分类设置" data-testid="holding-impulse1115-settings"
    className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3 text-[11px]">
    <label className="flex items-start gap-2 font-medium">
      <input type="checkbox" checked={!!value} disabled={readOnly}
        onChange={e=>onChange?.(e.target.checked?defaultHoldingImpulse1115Rule(definitions.find(d=>d.id===IMPULSE_1115_CLASSIFICATION_VERSION)):undefined)}/>
      <span>DBL-5-急拉线-1115 · 持仓分类</span>
    </label>
    <p className="text-muted-foreground">一类：延续未回踩、回踩守住并转强。二类：反弹减弱、刺穿收回、反抽失败、修复确认。
      结果显示主分类、细分状态和等待条件，可查看每条线的历史；分类本身不触发交易。</p>
    {value&&<fieldset disabled={readOnly} className="min-w-0">
      <Impulse1115ClassificationSettings value={value.definition.DBL5C_parameters} onChange={parameters=>onChange?.({
        ...value,definition:{...value.definition,DBL5C_parameters:parameters},
      })}/>
    </fieldset>}
    {value&&<p className="text-muted-foreground">分类参数、原生公式和版本独立保存在本方案中；切换方案／分支会保留草稿，保存后随模板冻结。
      原生急拉线与仓位 K 各自独立，原加仓、减仓、硬性终止规则继续生效。</p>}
  </section>;
}
