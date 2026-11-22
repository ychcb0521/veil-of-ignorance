// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {AUTH_BACKEND_ORIGIN,INSTANT_CAMPAIGN_HEADER} from '../authGateway';
import {createAuthFetch} from '../authTransport';

const site='https://veil-of-ignorance-ten.vercel.app';
const upstream=AUTH_BACKEND_ORIGIN+'/rest/v1/user_sim_state?select=key%2Crevision%3Avalue-%3E%3Erev%2Cdocument%3Avalue-%3Ebrowse&user_id=eq.alice&key=in.%28idb%3Afish-quality%2Cidb%3Afish-library-browse-v1%2Ffilter%29';
const headers={Authorization:'Bearer fixture',apikey:'fixture'};
const reply=(status=200,body='[]')=>new Response(body,{status,headers:{'Content-Type':'application/json'}});
afterEach(()=>vi.useRealTimers());

it.each(['network','html',502,503,504])('retries a broken directory gateway through the same backend once (%s)',async failure=>{
  const fetcher=vi.fn<typeof fetch>().mockImplementationOnce(async()=>{
    if(failure==='network')throw new TypeError('Failed to fetch');
    return failure==='html'?new Response('<html>app</html>',{headers:{'Content-Type':'text/html'}}):reply(failure as number);
  }).mockResolvedValueOnce(reply(200,'[{"key":"catalog"}]'));
  const response=await createAuthFetch(fetcher,30000,site)(upstream,{headers});
  expect(await response.json()).toEqual([{key:'catalog'}]);
  expect(fetcher.mock.calls.map(c=>c[0])).toEqual([site+'/instant-campaign-api'+new URL(upstream).search,upstream]);
  for(const [,init] of fetcher.mock.calls){
    expect(new Headers(init?.headers).get('Authorization')).toBe(headers.Authorization);
    expect(new Headers(init?.headers).get('apikey')).toBe(headers.apikey);
    expect(init).toMatchObject({cache:'no-store',credentials:'omit'});
  }
});

it.each([400,401,403,429])('returns authoritative rejection %s without a duplicate request',async status=>{
  const fetcher=vi.fn<typeof fetch>(async()=>reply(status));
  expect((await createAuthFetch(fetcher,30000,site)(upstream,{headers})).status).toBe(status);
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(['connection','body'])('bounds a stalled gateway %s before the directory deadline',async stage=>{
  vi.useFakeTimers();
  const fetcher=vi.fn<typeof fetch>().mockImplementationOnce(()=>stage==='connection'?new Promise<Response>(()=>{}):Promise.resolve(new Response(new ReadableStream({start(){}}))))
    .mockResolvedValueOnce(reply());
  const response=createAuthFetch(fetcher,30000,site)(upstream,{headers});
  await vi.advanceTimersByTimeAsync(6000);
  expect((await response).status).toBe(200);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('cancels a directory request without starting the alternate route',async()=>{
  const controller=new AbortController();
  const fetcher=vi.fn<typeof fetch>(()=>new Promise<Response>(()=>{}));
  const response=createAuthFetch(fetcher,30000,site)(upstream,{headers,signal:controller.signal});
  const cancelled=expect(response).rejects.toMatchObject({name:'AbortError'});
  controller.abort();await cancelled;
  expect(fetcher).toHaveBeenCalledOnce();
});

it('does not replay a write carrying the existing instant-campaign header',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>{throw new TypeError('network');});
  await expect(createAuthFetch(fetcher,30000,site)(upstream,{method:'POST',headers:{...headers,[INSTANT_CAMPAIGN_HEADER]:'1'},body:'{}'})).rejects.toThrow('network');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('keeps real SDK JSON projections, account and key filters intact across the fallback',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(reply(200,'[{"key":"catalog","revision":"r1","document":{"groups":[]}}]'));
  const client=createClient(AUTH_BACKEND_ORIGIN,'fixture',{global:{fetch:createAuthFetch(fetcher,30000,site)},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const result=await client.from('user_sim_state').select('key,revision:value->>rev,document:value->browse').eq('user_id','alice').in('key',['idb:fish-library-browse-v1/filter','idb:fish-quality']);
  expect(result.error).toBeNull();expect(result.data).toEqual([{key:'catalog',revision:'r1',document:{groups:[]}}]);
  const [first,second]=fetcher.mock.calls.map(c=>new URL(String(c[0])));
  expect(second.origin).toBe(AUTH_BACKEND_ORIGIN);expect(second.search).toBe(first.search);
  expect(second.searchParams.get('user_id')).toBe('eq.alice');
  expect(second.searchParams.get('select')).toBe('key,revision:value->>rev,document:value->browse');
});
