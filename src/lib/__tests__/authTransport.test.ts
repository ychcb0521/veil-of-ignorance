import { afterEach, expect, it, vi } from 'vitest';
import { AUTH_REQUEST_TIMEOUT_MS, AuthActionTimeout, boundedAuthAction, createAuthFetch } from '../authTransport';
afterEach(()=>vi.useRealTimers());
const url='https://example.supabase.co/auth/v1/token?grant_type=password';
it('aborts a stalled connection and settles even when the fetch implementation ignores cancellation',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn<typeof fetch>(()=>new Promise(()=>{})),request=createAuthFetch(fetcher)(url,{method:'POST'});
 const assertion=expect(request).rejects.toThrow('15 秒');await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);await assertion;
 expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
it('the timeout covers stalled response bodies, while successful JSON remains unchanged',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn<typeof fetch>(async()=>({status:200,headers:new Headers(),arrayBuffer:()=>new Promise(()=>{})}) as Response);
 const request=createAuthFetch(fetcher)(url),assertion=expect(request).rejects.toThrow('登录服务');await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);await assertion;
 const working=createAuthFetch(vi.fn<typeof fetch>(async()=>new Response('{"access_token":"test-only"}',{status:200,headers:{'Content-Type':'application/json'}})));
 expect(await (await working(url)).json()).toEqual({access_token:'test-only'});
});
it('preserves server rejection responses and does not impose the auth timeout on database requests',async()=>{
 const reply=new Response('{"msg":"Invalid login credentials"}',{status:400}),fetcher=vi.fn<typeof fetch>(async()=>reply),request=createAuthFetch(fetcher);
 const denied=await request(url);expect(denied.status).toBe(400);expect(await denied.json()).toEqual({msg:'Invalid login credentials'});
 const database=new Response('[]'),dbFetcher=vi.fn<typeof fetch>(async()=>database);
 expect(await createAuthFetch(dbFetcher)('https://example.supabase.co/rest/v1/profiles')).toBe(database);
});
it('ends SDK steps that never settle and clears timers after success',async()=>{
 vi.useFakeTimers();const request=boundedAuthAction(()=>new Promise(()=>{}),100),assertion=expect(request).rejects.toBeInstanceOf(AuthActionTimeout);
 await vi.advanceTimersByTimeAsync(100);await assertion;
 expect(await boundedAuthAction(async()=>42)).toBe(42);expect(vi.getTimerCount()).toBe(0);
});
