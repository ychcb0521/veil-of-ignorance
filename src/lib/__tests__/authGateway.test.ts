// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {AUTH_BACKEND_ORIGIN,authGatewayUrl,INSTANT_CAMPAIGN_HEADER} from '../authGateway';
import {createAuthFetch,AUTH_REQUEST_TIMEOUT_MS} from '../authTransport';
const site='https://veil-of-ignorance-ten.vercel.app',token=AUTH_BACKEND_ORIGIN+'/auth/v1/token?grant_type=password';
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
const reply=(status=200,body='{}')=>new Response(body,{status,headers:{'Content-Type':'application/json'}});
it('keeps a server 500 retryable but gives the real SDK readable diagnostics rather than the empty Response serialization',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>reply(500,'{"code":"unexpected_failure","msg":"Database error creating new session"}'));
 const storage=new Map<string,string>(),client=createClient(AUTH_BACKEND_ORIGIN,'fixture-anon',{global:{fetch:createAuthFetch(fetcher,30000,site)},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{storage.set(k,v)},removeItem:k=>{storage.delete(k)}}}});
 const result=await client.auth.signInWithPassword({email:'fixture@example.invalid',password:'test-only'});
 expect(result.error?.message).toContain('HTTP 500');expect(result.error?.message).toContain('unexpected_failure');expect(result.error?.status).toBe(500);expect(result.error?.message).not.toBe('{}');expect(result.data.session).toBeNull();expect(fetcher).toHaveBeenCalledOnce();expect(storage.size).toBe(0);
});
it('preserves the original server failure body/status and never duplicates a refresh or verification action',async()=>{
 const body='{"code":"unexpected_failure","msg":"cannot execute INSERT in a read-only transaction"}',fetcher=vi.fn<typeof fetch>(async()=>reply(500,body));
 const response=await createAuthFetch(fetcher,30000,site)(AUTH_BACKEND_ORIGIN+'/auth/v1/token?grant_type=refresh_token',{method:'POST',body:'{"refresh_token":"fixture"}'});
 expect(response.status).toBe(500);expect(await response.text()).toBe(body);expect((response as Response&{message:string}).message).toContain('只读');expect(fetcher).toHaveBeenCalledOnce();
});
it('automatically selects the gateway in a hosted production build without changing the SDK client URL',async()=>{
 vi.stubEnv('PROD',true);vi.stubGlobal('window',{location:{origin:site}});
 const fetcher=vi.fn<typeof fetch>(async()=>reply());await createAuthFetch(fetcher)(token,{method:'POST'});
 expect(fetcher.mock.calls[0][0]).toBe(site+'/auth-api/token?grant_type=password');
});

it('rewrites only this backend auth to the same hosted origin, preserving encoded queries',()=>{
 expect(authGatewayUrl(token,site)).toBe(site+'/auth-api/token?grant_type=password');
 expect(authGatewayUrl(AUTH_BACKEND_ORIGIN+'/auth/v1/verify?redirect_to=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc',site)).toContain('?redirect_to=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc');
 expect(authGatewayUrl(token,'https://veil-of-ignorance-preview-team.vercel.app')).toContain('/auth-api/token');
 for(const origin of ['http://127.0.0.1:5081','https://unknown.example','https://veil-of-ignorance-ten.vercel.app.evil.example'])expect(authGatewayUrl(token,origin)).toBeNull();
 expect(authGatewayUrl('https://different.supabase.co/auth/v1/token',site)).toBeNull();
 expect(authGatewayUrl(AUTH_BACKEND_ORIGIN+'/rest/v1/profiles',site)).toBeNull();
});

it('keeps login payload, bearer and API headers, avoids cookies/cache, and needs no browser call to Supabase when the gateway works',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>reply(200,'{"access_token":"test-only"}')),body=JSON.stringify({email:'fixture@example.invalid',password:'test-only-not-a-real-password'});
 const result=await createAuthFetch(fetcher,30000,site)(token,{method:'POST',headers:{apikey:'fixture-anon',Authorization:'Bearer fixture'},body});
 expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][0]).toBe(site+'/auth-api/token?grant_type=password');
 expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',body,headers:{apikey:'fixture-anon',Authorization:'Bearer fixture'},credentials:'omit',cache:'no-store'});
 expect(await result.json()).toEqual({access_token:'test-only'});
});

it.each([400,401,429])('returns authoritative rejection %s once without another credential submission',async status=>{
 const fetcher=vi.fn<typeof fetch>(async()=>reply(status,'{"msg":"denied"}'));
 expect((await createAuthFetch(fetcher,30000,site)(token,{method:'POST',body:'{}'})).status).toBe(status);
 expect(fetcher).toHaveBeenCalledOnce();
});

it('reports the Supabase database timeout without submitting the same password again', async () => {
 const fetcher = vi.fn<typeof fetch>(async () => reply(504, '{"error_code":"request_timeout","msg":"Request timeout"}'));
 const client = createClient(AUTH_BACKEND_ORIGIN, 'fixture-anon', {
   global: { fetch: createAuthFetch(fetcher, 30000, site) },
   auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
 });
 const result = await client.auth.signInWithPassword({ email: 'fixture@example.invalid', password: 'test-only' });
 expect(result.error?.message).toContain('等待数据库响应超时（HTTP 504）');
 expect(result.data.session).toBeNull();
 expect(fetcher).toHaveBeenCalledOnce();
});

it('falls back from an infrastructure 504 that carries no Auth error code', async () => {
 const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(504)).mockResolvedValueOnce(reply(400));
 const result = await createAuthFetch(fetcher, 30000, site)(token, { method: 'POST' });
 expect(result.status).toBe(400);
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher.mock.calls[1][0]).toBe(token);
});

it('falls back once for a broken gateway and can resend a Request body without consuming the original',async()=>{
 const bodies:string[]=[],fetcher=vi.fn<typeof fetch>(async input=>{bodies.push(await (input as Request).text());if(bodies.length===1)throw new TypeError('network');return reply(400,'{"msg":"Invalid login credentials"}');});
 const request=new Request(token,{method:'POST',headers:{apikey:'fixture'},body:'{"email":"fixture@example.invalid","password":"test-only"}'});
 const result=await createAuthFetch(fetcher,30000,site)(request);
 expect(result.status).toBe(400);expect(bodies).toEqual([await request.clone().text(),await request.clone().text()]);
 expect((fetcher.mock.calls[0][0] as Request).url).toContain('/auth-api/token');
 expect((fetcher.mock.calls[1][0] as Request).url).toBe(token);
});

it.each(['token?grant_type=refresh_token','signup','verify','resend','logout'])('does not duplicate non-repeatable %s after a network failure',async path=>{
 const fetcher=vi.fn<typeof fetch>(async()=>{throw new TypeError('network');});
 await expect(createAuthFetch(fetcher,30000,site)(AUTH_BACKEND_ORIGIN+'/auth/v1/'+path,{method:'POST',body:'{}'})).rejects.toThrow('network');
 expect(fetcher).toHaveBeenCalledOnce();
});

it('shares one total deadline across routes and never starts another attempt after cancellation',async()=>{
 vi.useFakeTimers();
 const fetcher=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise<Response>((_r,reject)=>setTimeout(()=>reject(new TypeError('network')),20000))).mockImplementationOnce(()=>new Promise<Response>(()=>{}));
 const result=createAuthFetch(fetcher,30000,site)(token,{method:'POST',body:'{}'}),assertion=expect(result).rejects.toThrow('30 秒');
 await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);await assertion;expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher.mock.calls.every(c=>c[1]?.signal?.aborted)).toBe(true);expect(vi.getTimerCount()).toBe(0);
 const controller=new AbortController(),blocked=vi.fn<typeof fetch>(()=>new Promise<Response>(()=>{}));
 const pending=createAuthFetch(blocked,30000,site)(token,{method:'POST',signal:controller.signal}),cancelled=expect(pending).rejects.toMatchObject({name:'AbortError'});
 controller.abort();await cancelled;expect(blocked).toHaveBeenCalledOnce();
});

it('never mistakes an SPA HTML fallback for successful login and leaves database traffic unchanged',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('<html>app</html>',{headers:{'Content-Type':'text/html'}})).mockResolvedValueOnce(reply(400));
 expect((await createAuthFetch(fetcher,30000,site)(token,{method:'POST'})).status).toBe(400);expect(fetcher).toHaveBeenCalledTimes(2);
 const database=reply(),db=vi.fn<typeof fetch>(async()=>database),url=AUTH_BACKEND_ORIGIN+'/rest/v1/profiles',init={headers:{apikey:'fixture'}};
 expect(await createAuthFetch(db,30000,site)(url,init)).toBe(database);expect(db).toHaveBeenCalledWith(url,init);
});

it('preserves the existing SDK storage namespace and restores a session produced through the gateway',async()=>{
 const storage=new Map<string,string>(),adapter={getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>{storage.set(key,value);},removeItem:(key:string)=>{storage.delete(key);}};
 const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'fixture@example.invalid',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const payload=Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),access='eyJhbGciOiJIUzI1NiJ9.'+payload+'.test-only';
 const fetcher=vi.fn<typeof fetch>(async()=>reply(200,JSON.stringify({access_token:access,refresh_token:'test-only-refresh',expires_in:3600,token_type:'bearer',user})));
 const client=createClient(AUTH_BACKEND_ORIGIN,'fixture-anon',{global:{fetch:createAuthFetch(fetcher,30000,site)},auth:{storage:adapter,autoRefreshToken:false,detectSessionInUrl:false}});
 const result=await client.auth.signInWithPassword({email:user.email,password:'test-only'});expect(result.error).toBeNull();expect(result.data.user?.id).toBe(user.id);
 expect([...storage.keys()]).toContain('sb-elynuzxnvjzypjgzkemc-auth-token');
 expect((await client.auth.getSession()).data.session?.user.id).toBe(user.id);
 expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][0]).toContain('/auth-api/token?grant_type=password');
 const restored=createClient(AUTH_BACKEND_ORIGIN,'fixture-anon',{global:{fetch:fetcher},auth:{storage:adapter,autoRefreshToken:false,detectSessionInUrl:false}});
 expect((await restored.auth.getSession()).data.session?.user.id).toBe(user.id);expect(fetcher).toHaveBeenCalledOnce();
});

it('routes the authenticated instant query through the same-origin gateway with its filters and no cache', async () => {
 const upstream=AUTH_BACKEND_ORIGIN+'/rest/v1/user_sim_state?key=lt.idb%3Ainstant-campaign-v1%2Ffish-instanu&key=gte.idb%3Ainstant-campaign-v1%2Ffish-instant-';
 const fetcher=vi.fn<typeof fetch>(async()=>reply(200,'[]'));
 const fetch=createAuthFetch(fetcher,30000,site);
 const headers={Authorization:'Bearer fixture',apikey:'fixture',[INSTANT_CAMPAIGN_HEADER]:'1'};
 await fetch(upstream,{headers});
 const [url,init]=fetcher.mock.calls[0];
 expect(url).toBe(site+'/instant-campaign-api?'+new URL(upstream).searchParams.toString());
 expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture');
 expect(new Headers(init?.headers).get(INSTANT_CAMPAIGN_HEADER)).toBeNull();
 expect(init).toMatchObject({cache:'no-store',credentials:'omit'});
 await fetch(upstream,{headers:{apikey:'fixture'}});
 expect(fetcher.mock.calls[1][0]).toBe(upstream);
 const config=JSON.parse(readFileSync('vercel.json','utf8'));
 expect(config.rewrites.find((r:{source:string})=>r.source==='/instant-campaign-api').destination).toBe(AUTH_BACKEND_ORIGIN+'/rest/v1/user_sim_state');
 expect(config.rewrites.find((r:{destination:string})=>r.destination==='/index.html').source).toContain('instant-campaign-api');
});

it('routes auth before SPA fallback to the same recorded backend and forbids CDN/browser caching',()=>{
 const config=JSON.parse(readFileSync('vercel.json','utf8')),target=JSON.parse(readFileSync('deployment-target.json','utf8'));
 const route=config.rewrites.find((r:{source:string})=>r.source==='/auth-api/:path*');
 expect(route.destination).toBe(`https://${target.supabaseProjectId}.supabase.co/auth/v1/:path*`);
 expect(config.rewrites.indexOf(route)).toBe(0);expect(config.rewrites[1].source).toContain('auth-api/');
 const headers=config.headers.find((r:{source:string})=>r.source==='/auth-api/:path*').headers;
 for(const key of ['Cache-Control','CDN-Cache-Control','Vercel-CDN-Cache-Control'])expect(headers.find((h:{key:string})=>h.key===key).value).toContain('no-store');
 expect(config.rewrites[1].source).toContain('assets/');
});
