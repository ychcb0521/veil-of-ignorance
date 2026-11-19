import {useEffect,useState} from 'react';
import {
  IMPULSE_1115_CLASSIFICATION_DEFAULTS,IMPULSE_1115_CLASSIFICATION_PARAMETERS,
  type Impulse1115ClassificationParams,
} from '@/lib/impulse1115Classification';

function ClassificationNumber({value,label,min,max,integer,onChange}:{
  value:number;label:string;min:number;max:number;integer?:boolean;onChange:(value:number)=>void;
}){
  const [text,setText]=useState(()=>String(value));
  useEffect(()=>{
    setText(previous=>Object.is(previous.trim()===''?NaN:Number(previous),value)?previous:Number.isNaN(value)?'':String(value));
  },[value]);
  return <input aria-label={label} type="number" inputMode={integer?'numeric':'decimal'}
    min={min} max={max} step={integer?1:'any'} value={text}
    className="w-28 min-w-0 rounded border border-border bg-background px-2 py-1 font-mono text-xs"
    onChange={e=>{setText(e.target.value);onChange(e.target.value.trim()===''?NaN:Number(e.target.value));}}/>;
}
export function Impulse1115ClassificationSettings({value,onChange}:{
  value?:Partial<Impulse1115ClassificationParams>;
  onChange:(value:Partial<Impulse1115ClassificationParams>)=>void;
}){
  const params={...IMPULSE_1115_CLASSIFICATION_DEFAULTS,...value};
  return <fieldset className="min-w-0 flex-1 rounded border border-border p-3 text-xs">
    <legend className="px-1 font-medium">急拉线持仓分类参数 · 固定 5m 已收盘</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      {IMPULSE_1115_CLASSIFICATION_PARAMETERS.map(spec=><label key={spec.key} className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-36">{spec.label}</span>
        <ClassificationNumber label={spec.label} min={spec.min} max={spec.max} integer={spec.integer} value={params[spec.key]}
          onChange={next=>onChange({...value,[spec.key]:next})}/>
        <span className="text-muted-foreground">{spec.unit}{spec.integer&&spec.key!=='weakeningTests'?' · '+params[spec.key]*5+'分钟':''}</span>
      </label>)}
    </div>
    <p className="mt-3 leading-5 text-muted-foreground">附近容差和离开距离复用防守线回踩初值；尺度使用该急拉线形成时冻结的 ATR。
      第1、2种为一类，第3至6种为二类；过渡期明确显示等待条件。参数仅属于此分类定义，保存后重新运行；
      已冻结模板继续使用各自原参数。分类不改变原线、不触发加减仓或对冲。</p>
  </fieldset>;
}
