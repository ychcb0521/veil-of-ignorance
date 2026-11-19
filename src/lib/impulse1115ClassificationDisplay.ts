import {DBL5_STEP} from './dbl5m';
import type {Impulse1115ClassificationRow} from './impulse1115Classification';
import type {Dbl5GuardPlusRow} from './dbl5GuardPlus';

export const IMPULSE_1115_CLASS_COLORS=Object.freeze({1:'#2563eb',2:'#ea580c'});
export const IMPULSE_1115_CLASSIFICATION_DESCRIPTION='蓝色线为一类，橙色线为二类。直接用原急拉线的颜色区分类别，按已收盘的5分钟行情更新。';
export const IMPULSE_1115_REFERENCE_CLASS='_DBL5C_reference_class';
export const IMPULSE_1115_REFERENCE_DETECTED_AT='_DBL5C_reference_detected_at';
export const IMPULSE_1115_DISPLAY_REFERENCE='_DBL5C_display_reference';
export const IMPULSE_1115_CLASSIFICATION_RENDER_FIELDS=[IMPULSE_1115_REFERENCE_CLASS,IMPULSE_1115_REFERENCE_DETECTED_AT,IMPULSE_1115_DISPLAY_REFERENCE] as const;

/** Chart-only projection: identify the actual native reference, never assume it is the latest candidate. */
export function impulse1115ReferenceDisplayVars(bars:readonly {openTime:number}[],output:{
 DBL5C_details?:readonly Impulse1115ClassificationRow[];DBL5P_details?:readonly Dbl5GuardPlusRow[];
},variables:readonly string[]){
 const result=new Map<string,Float64Array>();
 if(!output.DBL5C_details||!output.DBL5P_details||!IMPULSE_1115_CLASSIFICATION_RENDER_FIELDS.some(name=>variables.includes(name)))return result;
 const classes=new Float64Array(bars.length).fill(NaN),detected=new Float64Array(bars.length).fill(NaN),prices=new Float64Array(bars.length).fill(NaN);
 const points=new Map(output.DBL5C_details.map(row=>[row.at,row])),native=new Map(output.DBL5P_details.map(row=>[row.at,row]));
 bars.forEach((bar,i)=>{
  const at=bar.openTime+DBL5_STEP,source=native.get(at),active=source?.active_impulse;
  const point=points.get(at);
  // Classification continues at the original frozen price after a native line breaks or expires.
  const line=active?point?.lines.find(line=>line.lineId===active.impulse_id):point?.current;
  if(!line?.available)return;classes[i]=line.mainClass;detected[i]=line.detectedAt;prices[i]=line.price;
 });
 for(const [name,values] of [[IMPULSE_1115_REFERENCE_CLASS,classes],[IMPULSE_1115_REFERENCE_DETECTED_AT,detected],[IMPULSE_1115_DISPLAY_REFERENCE,prices]] as const)if(variables.includes(name))result.set(name,values);
 return result;
}

/** Rendering preference only; selected indicators and stored settings remain intact. */
export function classifiedImpulseReplacesReference(type:string,selected:readonly {type:string;enabled:boolean}[],catalog:readonly {id:string;core:string}[]){
 return catalog.some(item=>item.id===type&&item.core==='DBL5P_impulse')&&selected.some(ind=>ind.enabled&&catalog.some(item=>item.id===ind.type&&item.core==='DBL5C'));
}
