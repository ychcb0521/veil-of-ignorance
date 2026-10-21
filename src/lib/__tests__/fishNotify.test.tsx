// 【用户要求】2026-10-21「我希望捕捉到的新鱼能够及时发送到我的邮箱，并且邮箱地址数量可以添加」
import {beforeEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,renderHook,screen} from '@testing-library/react';
import {composeFishEmail,isEmail,normalizeFishNotify,readFishNotify,saveFishNotify,sendFishEmail,fishNotifyMissing,EMAILJS_ENDPOINT,FISH_NOTIFY_MAX_EMAILS} from '@/lib/fish/notify';
import {useFishNotify} from '@/hooks/useFishNotify';
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
it('邮件内容：主题写条数，正文逐条列出标的 / 交易所 / 信号时间 / 算法类型，HTML 转义',()=>{
 const m=composeFishEmail([fish('AAAUSDT',1),fish('<B>USDT',2,{exchange:'okx',fish:{...fish('x',0).fish!,combination:'and',algorithms:[{...fish('x',0).fish!,featureShort:'CBI-2'},{...fish('x',0).fish!,featureShort:'BSS'}]}})],Date.UTC(2026,9,21,3),'https://site');
 expect(m.subject).toBe('【渔】新鱼 2 条 · 2026-10-21 11:00');expect(m.count).toBe(2);
 expect(m.message).toContain('AAAUSDT　币安　信号 2026-10-21 09:00　CBI-2');expect(m.message).toContain('OKX');expect(m.message).toContain('CBI-2 · BSS');expect(m.message).toContain('https://site');
 expect(m.message_html).toContain('&lt;B&gt;USDT');expect(m.message_html).not.toContain('<B>USDT');
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
it('同一条鱼只提醒一次：发过的不再发；发送失败不记，下次再试',async()=>{
 saveFishNotify(ready);let ok=false;const request=vi.fn(async()=>ok?new Response('OK'):new Response('down',{status:500}));
 const {result}=renderHook(()=>useFishNotify('u',request as any));
 await act(async()=>{await result.current.send([fish('AAAUSDT',1)]);});expect(result.current.status).toMatchObject({ok:false});
 ok=true;await act(async()=>{await result.current.send([fish('AAAUSDT',1)]);});expect(request).toHaveBeenCalledTimes(2);
 await act(async()=>{await result.current.send([fish('AAAUSDT',1),fish('BBBUSDT',2)]);});expect(request).toHaveBeenCalledTimes(3);
 expect(JSON.parse((request.mock.calls[2] as any)[1].body).template_params.subject).toContain('新鱼 1 条');
 await act(async()=>{await result.current.send([fish('AAAUSDT',1),fish('BBBUSDT',2)]);});expect(request).toHaveBeenCalledTimes(3);
});
