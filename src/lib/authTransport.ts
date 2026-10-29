/** Bound auth connection + body reads. Other database/storage requests retain their existing behavior. */
export const AUTH_REQUEST_TIMEOUT_MS = 15_000;
export const AUTH_ACTION_TIMEOUT_MS = 25_000;
export class AuthActionTimeout extends Error {
  constructor() { super('登录步骤未能结束。请重新加载登录页后再试；账户和交易数据会保留。'); this.name='AuthActionTimeout'; }
}
export async function boundedAuthAction<T>(action:()=>Promise<T>, timeoutMs=AUTH_ACTION_TIMEOUT_MS):Promise<T> {
  let timer:ReturnType<typeof setTimeout>;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AuthActionTimeout()),timeoutMs);});
  try { return await Promise.race([Promise.resolve().then(action),timeout]); }
  finally { clearTimeout(timer!); }
}
export function createAuthFetch(fetcher:typeof fetch=(input,init)=>fetch(input,init),timeoutMs=AUTH_REQUEST_TIMEOUT_MS):typeof fetch {
  return async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(!new URL(url).pathname.startsWith('/auth/v1/'))return fetcher(input,init);
    const controller=new AbortController(),external=init?.signal??(input instanceof Request?input.signal:undefined);
    let expired=false,timer:ReturnType<typeof setTimeout>;
    const abort=()=>controller.abort(external?.reason);
    external?.addEventListener('abort',abort,{once:true});if(external?.aborted)abort();
    const stopped=new Promise<never>((_,reject)=>{
      const fail=()=>reject(expired?new Error('登录服务在 15 秒内没有响应，请检查网络或代理连接后重试'):new DOMException('登录请求已取消','AbortError'));
      controller.signal.addEventListener('abort',fail,{once:true});if(controller.signal.aborted)fail();
      timer=setTimeout(()=>{expired=true;controller.abort();},timeoutMs);
    });
    try {
      return await Promise.race([(async()=>{
        const response=await fetcher(input,{...init,signal:controller.signal});
        const body=await response.arrayBuffer();
        return new Response(body.byteLength?body:null,{status:response.status,statusText:response.statusText,headers:response.headers});
      })(),stopped]);
    } finally { clearTimeout(timer!);external?.removeEventListener('abort',abort); }
  };
}
