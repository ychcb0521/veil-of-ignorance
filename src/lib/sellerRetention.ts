/** Independent seller copies. These are candle-based trade-imbalance/impact proxies, not L2 OFI. */
export const SELLER_RETENTION_SPECS = [
 {sourceId:'cdi2',label:'CDI2',id:'cdi2-retain',core:'CDI2_retained',sourceCore:'CDI2',chartId:'CDI2_RETAIN',bound:1},
 {sourceId:'seller-control',label:'DSP·bc',id:'seller-control-retain',core:'bc_retained',sourceCore:'bc',chartId:'SELLER_CONTROL_RETAIN',bound:0},
 {sourceId:'dss',label:'DSS',id:'dss-retain',core:'DSS_retained',sourceCore:'DSS',chartId:'DSS_RETAIN',bound:1},
 {sourceId:'mbi-bear',label:'MBI·空方',id:'mbi-bear-retain',core:'MBI_bear_retained',sourceCore:'MBI_bear',chartId:'MBI_BEAR_RETAIN',bound:1},
 {sourceId:'ctba-bear',label:'CTBA·空方',id:'ctba-bear-retain',core:'CTBA_bear_retained',sourceCore:'CTBA_bear',chartId:'CTBA_BEAR_RETAIN',bound:100},
 {sourceId:'mbi2-bear',label:'MBI2·卖方',id:'mbi2-bear-retain',core:'MBI2_bear_retained',sourceCore:'MBI2_bear',chartId:'MBI2_BEAR_RETAIN',bound:1},
 {sourceId:'ctba_12h-bear',label:'CTBA-12H·卖方',id:'ctba_12h-bear-retain',core:'CTBA_12H_bear_retained',sourceCore:'CTBA_12H_bear',chartId:'CTBA_12H_BEAR_RETAIN',bound:100},
] as const;
export type SellerRetentionSpec=typeof SELLER_RETENTION_SPECS[number];
export const retentionComponents=(p='sr')=>['base','retention_z','price_z','support','flow','impact','anomaly_z'].map(n=>p+'_'+n);
export const RETENTION_COMPONENT_LABELS=['原算法原值','未收复成交位移','未收复价格位移','相对成交支持','主动成交失衡','单位失衡下行冲击','当前价格波动异常'];
export function retentionFormula(source:string,baseExpression:string,core:string,bound:number,windowHours=48){
 let p='sr';while(new RegExp('\\b'+p+'_').test(source))p+='_';
 const n=(key:string)=>p+'_'+key;
 const lines=[
  '# seller-retention-v1：先冻结输入，再原样计算副本的原算法；不读取原特征结果或递推状态',
  `${n('time')} = T`,`${n('c')} = C`,`${n('e')} = E`,`${n('q')} = Q`,`${n('b')} = B`,`${n('s')} = S`,`${n('minutes')} = BAR_MINUTES`,
  source,`${n('base')} = ${baseExpression}`,
  '# 以下参数仅属于本副本。gain=0时逐根返回原算法；窗口不缩短，增强在最终压缩前进行',
  `${n('version')} = 1`,`${n('gain')} = 0.5`,`${n('window_h')} = ${windowHours}`,`${n('eta')} = 0.5`,`${n('alpha')} = 1`,`${n('impact_weight')} = 0.25`,`${n('flow_floor')} = 0.05`,`${n('sigma_floor')} = 0.000001`,`${n('epsilon')} = 0.000000000001`,
  `${n('window_n')} = bars(${n('window_h')})`,`${n('baseline_n')} = bars(avgh)`,
  `${n('parameters')} = if(${n('gain')} >= 0 and ${n('eta')} >= 0 and ${n('eta')} <= 1 and ${n('alpha')} >= 0 and ${n('impact_weight')} >= 0 and ${n('flow_floor')} > 0 and ${n('sigma_floor')} > 0 and ${n('epsilon')} > 0, 1, 0/0)`,
  `${n('valid')} = if(has(${n('parameters')}) and ${n('q')} > 0 and ${n('b')} >= 0 and ${n('s')} >= 0 and ${n('e')} > 0 and ${n('c')} > 0 and ${n('time')} - prev(${n('time')}) == ${n('minutes')} * 60000, 1, 0/0)`,
  `${n('r')} = if(has(${n('valid')}), ln(${n('e')} / prev(${n('e')})), 0/0)`,
  `${n('vbar')} = if(has(prev(full(${n('valid')}, ${n('baseline_n')}))), prev(avg(${n('q')}, avgh)), 0/0)`,
  `${n('sigma')} = if(has(prev(full(${n('r')}, ${n('baseline_n')}))), prev(sd(${n('r')}, avgh)), 0/0)`,
  `${n('denom')} = max(${n('sigma')}, ${n('sigma_floor')}) + ${n('epsilon')}`,
  `${n('flow')} = (${n('b')} - ${n('s')}) / ${n('q')}`,
  `${n('support')} = ln(1 + (abs(${n('b')} - ${n('s')}) + ${n('eta')} * (${n('q')} - abs(${n('b')} - ${n('s')}))) / ${n('vbar')})`,
  `${n('impact')} = -max(-${n('r')}, 0) / (${n('denom')} * (abs(${n('flow')}) + ${n('flow_floor')}))`,
  `${n('weight')} = ${n('support')} * (1 + ${n('alpha')} * max(-${n('flow')}, 0)) * (1 + ${n('impact_weight')} * max(-${n('flow')}, 0) * tanh(-${n('impact')}))`,
  `${n('ready')} = full(if(has(${n('valid')}) and has(${n('weight')}) and has(${n('sigma')}), 1, 0/0), ${n('window_n')})`,
  `${n('price')} = max(${n('e')}, ${n('c')})`,
  '# retain每根用当前price重估过去各时点位移；下移未收复为负，收复后回升，零点不随样本平移',
  `${n('retention_z')} = if(has(${n('ready')}), retain(${n('weight')}, ${n('price')}, prev(${n('e')}), hl, ${n('window_h')}) / ${n('denom')}, 0/0)`,
  `${n('price_z')} = if(has(${n('ready')}), retain(1, ${n('price')}, prev(${n('e')}), hl, ${n('window_h')}) / ${n('denom')}, 0/0)`,
  `${n('anomaly_z')} = if(has(${n('valid')}), ln(${n('price')} / prev(${n('e')})) / ${n('denom')}, 0/0)`,
 ];
 const b=n('base'),z=n('retention_z'),g=n('gain');
 if(bound){
  lines.push(`${n('base_unit')} = clip(${b} / ${bound}, -1 + ${n('epsilon')}, 1 - ${n('epsilon')})`,`${n('base_z')} = 0.5 * ln((1 + ${n('base_unit')}) / (1 - ${n('base_unit')}))`);
  lines.push(`${core} = if(${g} == 0, ${b}, if(has(${b}) and has(${z}) and abs(${b}) <= ${bound}, ${bound} * tanh(${n('base_z')} + ${g} * ${z}), 0/0))`);
 }else lines.push(`${core} = if(${g} == 0, ${b}, if(has(${b}) and has(${z}), ${b} + ${g} * ${z}, 0/0))`);
 return {formula:lines.join('\n'),prefix:p};
}
