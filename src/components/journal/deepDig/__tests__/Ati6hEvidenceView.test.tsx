import {expect,it} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {renderToStaticMarkup} from 'react-dom/server';
import {writeFileSync} from 'node:fs';
import {Ati6hEvidenceView} from '../Ati6hEvidenceView';
import {computeAti6h} from '@/lib/ati6h';
import {ATI6H_DEF} from '@/lib/deepDig/features';
import type {DeepDigData} from '@/lib/deepDig/analysis';
const fixture=()=>{
 const base=Date.UTC(2026,9,30,16),step=300000,bar=(i:number,c=102,lo=c-.1,hi=c+.1,sigma=.01)=>({bar:{openTime:base+i*step,open:c,high:hi,low:lo,close:c,volume:1,takerBuyVolume:.6,quoteVolume:100,takerBuyQuoteVolume:60},sigmaBefore:sigma,mbi2State:2,tickSize:.01});
 const inputs=Array.from({length:102},(_,i)=>bar(i));
 inputs[80]=bar(80,103,102,105);inputs[81]=bar(81,103,102,104);inputs[82]=bar(82,102,101,103,.004);inputs[83]=bar(83,101,100,102);inputs[84]=bar(84,102,101,103);inputs[85]=bar(85,102,101.5,103);inputs[86]=bar(86,100.5,100.2,102);inputs[87]=bar(87,102,101,103);inputs[88]=bar(88,105.3,102,105.5);inputs[88].bar.open=102;inputs[96]=bar(96,102,99.4,103);
 const out=computeAti6h(inputs),rows=out.rows.slice(72),id='example';
 const data={definition:ATI6H_DEF,rows:[{id,symbol:'结构示例（合成行情）',anchorMs:base+102*step,ATI6H_details:rows.at(-1),ATI6H_archive:out.ATI6H_archive}],groups:[]} as unknown as DeepDigData;
 const series={ATI6H_windows:{[id]:{rows,prices:inputs.slice(72).map(i=>({time:i.bar.openTime+step,close:i.bar.close}))}}} as any;
 return {data,series};
};
it('shows six independent components, the weakest component, fixed price curves and explicitly market-only events',()=>{
 const props=fixture();render(<Ati6hEvidenceView {...props}/>);
 expect(screen.getByRole('img',{name:'ATI-6H 固定支撑、失效边界、突破线与阻力'})).toBeVisible();
 fireEvent.change(screen.getByLabelText('ATI6H 已收盘时点'),{target:{value:'16'}});
 expect(screen.getByTestId('ati6h-evidence')).toHaveTextContent('非零短板可被部分补偿');
 expect(screen.getByTestId('ati6h-evidence')).toHaveTextContent('真实主动买卖成交额');
 expect(screen.getByTestId('ati6h-evidence')).toHaveTextContent('回踩确认');
 expect(screen.getByTestId('ati6h-evidence')).toHaveTextContent('支撑破位');
});
it('renders an inspectable chart example from computed synthetic market data',()=>{
 const svg=renderToStaticMarkup(<Ati6hEvidenceView {...fixture()}/>);
 expect(svg).toContain('首次观测突破');
 if(process.env.ATI6H_EXAMPLE_PATH)writeFileSync(process.env.ATI6H_EXAMPLE_PATH,`<!doctype html><meta charset="utf-8"><title>ATI-6H · 固定结构示例</title><style>body{font:14px system-ui,sans-serif;color:#263447;background:#f4f6f9;margin:0;padding:28px}section{max-width:1100px;margin:auto;background:white;padding:24px;border-radius:16px}svg{display:block;width:100%;margin:12px 0}button,select{font:inherit}p{line-height:1.7}input{width:100%}.grid{display:grid;grid-template-columns:repeat(6,1fr);gap:18px;margin:16px 0}@media(max-width:700px){.grid{grid-template-columns:repeat(2,1fr)}}summary{margin-top:16px}details{margin:12px 0}strong{font-size:20px}</style><h1 style="text-align:center">ATI-6H · 固定结构、回踩与突破</h1><p style="text-align:center">合成行情演示；市场事件不代表实际交易</p>${svg}`);
});
