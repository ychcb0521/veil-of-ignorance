// 【用户要求】2026-10-21「我希望捕捉到的新鱼能够及时发送到我的邮箱，并且邮箱地址数量可以添加」
import {beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,renderHook,screen} from '@testing-library/react';
import {FISH_EMAIL_MAX_ROWS,composeFishEmail,isEmail,normalizeFishNotify,readFishNotify,saveFishNotify,sendFishEmail,fishNotifyMissing,EMAILJS_ENDPOINT,FISH_NOTIFY_MAX_EMAILS} from '@/lib/fish/notify';
import {useFishNotify} from '@/hooks/useFishNotify';
import {fishVisibleKey} from '@/lib/fish/records';
import {FishNotifySettings} from '@/components/FishNotifySettings';
import type {TradeSignal} from '@/lib/signalLibrary';
const fish=(symbol:string,h:number,extra:Partial<TradeSignal>={}):TradeSignal=>({id:symbol,symbol,timeMs:Date.UTC(2026,9,21,h),timeLabel:'',fallbackZone:'',fish:{average:1,cbi2:1,startAverage:1,previousAverage:0,cutoffMs:1,threshold:1,featureShort:'CBI-2'},...extra});
const ready={enabled:true,emails:['a@qq.com','b@163.com'],serviceId:'service_1',templateId:'template_1',publicKey:'pk'};
beforeEach(()=>{localStorage.clear();});
it('邮箱：格式检查、去重、统一小写、最多 20 个；设置能存能读',()=>{
 expect(['me@qq.com','A.B@gmail.com'].every(isEmail)).toBe(true);expect(['me','me@','@qq.com','a b@qq.com','a@qq'].some(isEmail)).toBe(false);
 const c=normalizeFishNotify({enabled:true,emails:['A@qq.com','a@qq.com','bad',...Array.from({length:30},(_,i)=>`u${i}@x.com`)],serviceId:' s '});
 expect(c.emails[0]).toBe('a@qq.com');expect(c.emails).toHaveLength(FISH_NOTIFY_MAX_EMAILS);expect(c.serviceId).toBe('s');
 saveFishNotify(ready);expect(readFishNotify()).toEqual(ready);
 expect(fishNotifyMissing({...ready,emails:[]})).toContain('收件邮箱');expect(fishNotifyMissing({...ready,publicKey:''})).toContain('Public Key');expect(fishNotifyMissing(ready)).toBe('');
 // 截图里的填法：Service ID 填邮箱、Template ID 填 {{to_email}} —— 直接指出该填什么
 expect(fishNotifyMissing({...ready,serviceId:'ychpsychology@163.com'})).toContain('Service ID 填的是邮箱');
 expect(fishNotifyMissing({...ready,templateId:'{{to_email}}'})).toContain('填在 EmailJS 网站的模板里');
 expect(fishNotifyMissing({...ready,publicKey:'{{x}}'})).toContain('Public Key 不对');
 expect(fishNotifyMissing({...ready,serviceId:'ychpsychology@163.com',templateId:'{{to_email}}',publicKey:''})).toContain('Service ID 填的是邮箱');
});
it('邮件内容照「新鱼」列表画：标的 / 信号时间 / 算法类型 / 市场，最近的在上；本轮新增的标「新」；HTML 转义',()=>{
 const okx=fish('<B>USDT',2,{exchange:'okx',fish:{...fish('x',0).fish!,combination:'and',algorithms:[{...fish('x',0).fish!,featureShort:'CBI-2'},{...fish('x',0).fish!,featureShort:'BSS'}]}});
 const m=composeFishEmail([fish('AAAUSDT',1),okx],Date.UTC(2026,9,21,3),'https://site');
 expect(m.subject).toBe('【渔】新鱼 2 条 · 2026-10-21 11:00');expect(m.count).toBe(2);
 expect(m.message.split('\n')[2]).toBe('<B>USDT　2026-10-21 10:00:00　CBI-2 · BSS　OKX');expect(m.message.split('\n')[3]).toBe('AAAUSDT　2026-10-21 09:00:00　CBI-2');expect(m.message).toContain('https://site');
 for(const h of ['新鱼','标的','信号时间','算法类型','市场'])expect(m.message_html).toContain(h);
 expect(m.message_html.indexOf('&lt;B&gt;USDT')).toBeLessThan(m.message_html.indexOf('AAAUSDT'));expect(m.message_html).not.toContain('<B>USDT');
 // 整张新鱼表里只有 AAAUSDT 是本轮新增
 const n=composeFishEmail([fish('AAAUSDT',1),okx],Date.UTC(2026,9,21,3),'',new Set([fishVisibleKey(fish('AAAUSDT',1))]));
 expect(n.subject).toBe('【渔】新鱼 2 条（新增 1） · 2026-10-21 11:00');expect(n.message).toContain('【新】AAAUSDT');expect(n.message).not.toContain('【新】<B>');
 expect(n.message_html).toContain('本轮新增 1');expect(n.message_html.match(/>新</g)).toHaveLength(1);
});
it('发送：一次请求发给全部邮箱（逗号隔开）；被拒时报出状态码与原因；缺设置不发',async()=>{
 const request=vi.fn(async()=>new Response('OK',{status:200}));
 await sendFishEmail(ready,composeFishEmail([fish('AAAUSDT',1)]),request as any);
 const [url,init]=request.mock.calls[0] as any;expect(url).toBe(EMAILJS_ENDPOINT);
 const body=JSON.parse(init.body);expect(body).toMatchObject({service_id:'service_1',template_id:'template_1',user_id:'pk'});expect(body.template_params.to_email).toBe('a@qq.com,b@163.com');expect(body.template_params.subject).toContain('新鱼 1 条');
 // 不改 EmailJS 自带的 Contact Us 模板也能用：它的 {{name}} {{title}} {{time}} {{email}} {{message}} 都有值
 expect(body.template_params).toMatchObject({name:'渔',title:body.template_params.subject,email:'a@qq.com'});expect(body.template_params.time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);expect(body.template_params.message).toContain('AAAUSDT');
 await expect(sendFishEmail(ready,composeFishEmail([fish('A',1)]),(async()=>new Response('The public key is invalid',{status:400})) as any)).rejects.toThrow('EmailJS 拒绝发送（400）：The public key is invalid');
 await expect(sendFishEmail({...ready,emails:[]},composeFishEmail([fish('A',1)]),request as any)).rejects.toThrow('收件邮箱');expect(request).toHaveBeenCalledTimes(1);
});
it('没勾选不发；勾选后发并记下结果；测试邮件照常可发',async()=>{
 const request=vi.fn(async()=>new Response('OK'));
 saveFishNotify({...ready,enabled:false});
 const {result}=renderHook(()=>useFishNotify('u',request as any));
 await act(async()=>{await result.current.send([fish('AAAUSDT',1)]);});expect(request).not.toHaveBeenCalled();
 await act(async()=>{await result.current.test();});expect(request).toHaveBeenCalledTimes(1);expect(result.current.status).toMatchObject({ok:true,test:true});
 act(()=>{result.current.update({...result.current.config,enabled:true});});
 await act(async()=>{await result.current.send([fish('AAAUSDT',1),fish('BBBUSDT',2)]);});expect(request).toHaveBeenCalledTimes(2);expect(result.current.status).toMatchObject({ok:true,count:2});
});
it('设置面板：添加多个邮箱（回车或逗号分隔）、格式不对提示、删除；没填好 EmailJS 时测试按钮不可点',()=>{
 const notify:any={config:{enabled:false,emails:[],serviceId:'',templateId:'',publicKey:''},status:null,sending:false,update:vi.fn((c:any)=>{notify.config=c;}),send:vi.fn(),test:vi.fn()};
 const view=render(<FishNotifySettings notify={notify}/>);
 fireEvent.change(screen.getByLabelText('添加收件邮箱'),{target:{value:'a@qq.com, B@163.com'}});fireEvent.keyDown(screen.getByLabelText('添加收件邮箱'),{key:'Enter'});
 expect(notify.update).toHaveBeenLastCalledWith(expect.objectContaining({emails:['a@qq.com','b@163.com']}));
 view.rerender(<FishNotifySettings notify={{...notify}}/>);
 expect(screen.getByText('a@qq.com')).toBeInTheDocument();expect(screen.getByRole('button',{name:'发测试邮件'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('添加收件邮箱'),{target:{value:'nope'}});fireEvent.click(screen.getByRole('button',{name:'添加'}));
 expect(screen.getByRole('alert')).toHaveTextContent('邮箱格式不对：nope');
 expect(screen.getByRole('link',{name:'emailjs.com'})).toHaveAttribute('href','https://dashboard.emailjs.com/sign-up');
 fireEvent.click(screen.getByRole('button',{name:'删除 a@qq.com'}));expect(notify.update).toHaveBeenLastCalledWith(expect.objectContaining({emails:['b@163.com']}));
});
it('新鱼列表有变化就发一封整张表（手动、自动都走这里）：和上一封一样不发；多出来的标「新」；失败不记，下一轮再试',async()=>{
 saveFishNotify(ready);let ok=false;const request=vi.fn(async()=>ok?new Response('OK'):new Response('down',{status:500}));
 const {result}=renderHook(()=>useFishNotify('u',request as any));
 const A=fish('AAAUSDT',1),B=fish('BBBUSDT',2);
 const sent=(i:number)=>JSON.parse((request.mock.calls[i] as any)[1].body).template_params;
 await act(async()=>{await result.current.send([A],[A]);});expect(result.current.status).toMatchObject({ok:false});
 ok=true;await act(async()=>{await result.current.send([A],[A]);});expect(request).toHaveBeenCalledTimes(2);expect(sent(1).subject).toContain('新鱼 1 条');
 // 这一轮新鱼还是那几条（哪怕重新捕到）：不发
 await act(async()=>{await result.current.send([],[A]);});expect(request).toHaveBeenCalledTimes(2);
 expect(result.current.status).toMatchObject({unchanged:true,count:1});
 // 多了一条：发整张表，新增的标「新」
 await act(async()=>{await result.current.send([B],[A,B]);});expect(request).toHaveBeenCalledTimes(3);
 expect(sent(2).subject).toContain('新鱼 2 条（新增 1）');expect(sent(2).message).toContain('【新】BBBUSDT');expect(sent(2).message).not.toContain('【新】AAAUSDT');
 await act(async()=>{await result.current.send([],[A,B]);});expect(request).toHaveBeenCalledTimes(3);
 // 少了一条也是更新：发
 await act(async()=>{await result.current.send([],[B]);});expect(request).toHaveBeenCalledTimes(4);expect(sent(3).subject).toContain('新鱼 1 条');
 // 新鱼空了：不发
 await act(async()=>{await result.current.send([],[]);});expect(request).toHaveBeenCalledTimes(4);
});
it('测试邮件照当前新鱼列表发；没有新鱼时发示例',async()=>{
 saveFishNotify(ready);const request=vi.fn(async()=>new Response('OK'));let fresh:TradeSignal[]=[fish('AAAUSDT',1),fish('BBBUSDT',2)];
 const {result}=renderHook(()=>useFishNotify('u',request as any,()=>fresh));
 await act(async()=>{await result.current.test();});let p=JSON.parse((request.mock.calls[0] as any)[1].body).template_params;
 expect(p.subject).toContain('【渔】测试邮件 · 新鱼 2 条');expect(p.message.indexOf('BBBUSDT')).toBeLessThan(p.message.indexOf('AAAUSDT'));
 fresh=[];await act(async()=>{await result.current.test();});p=JSON.parse((request.mock.calls[1] as any)[1].body).template_params;expect(p.message).toContain('TESTUSDT');
});

it('新鱼很多时表格最多列 60 行（写明还有几条），整封不超过 EmailJS 免费版约 50KB 的上限',()=>{
 const many=Array.from({length:100},(_,i)=>fish(`S${i}USDT`,i%24,{id:`s${i}`,timeMs:Date.UTC(2026,9,21)+i*3e5,exchange:i%3?'binance':'okx'} as any));
 const m=composeFishEmail(many,Date.UTC(2026,9,21),'https://site',new Set());
 expect(FISH_EMAIL_MAX_ROWS).toBe(60);expect(m.message_html).toContain('还有 40 条');expect((m.message_html.match(/<tr/g)||[]).length).toBe(61);
 expect(new TextEncoder().encode(JSON.stringify(m)).length).toBeLessThan(45_000);
});
