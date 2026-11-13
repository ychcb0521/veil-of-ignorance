/** Bound auth connection + body reads. Other database/storage requests retain their existing behavior. */
import {authGatewayUrl,productionAuthOrigin} from './authGateway';
import {authServiceFailure} from './authErrorText';
/** The installed SDK serializes a 5xx Response itself instead of reading its
 * JSON body, yielding "{}". Supply a safe message while preserving status,
 * headers and body, so retry/session handling retains its original semantics. */
class DescribedAuthResponse extends Response {
  readonly message:string;
  readonly authCode: string | undefined;
  constructor(body:ArrayBuffer,source:Response){
    super(body.byteLength?body:null,{status:source.status,statusText:source.statusText,headers:source.headers});
    let data:{code?:unknown;error_code?:unknown;message?:unknown;msg?:unknown}|undefined;
    try{data=JSON.parse(new TextDecoder().decode(body));}catch{/* Non-JSON upstream failures still have an HTTP status. */}
    const code = data?.error_code ?? data?.code;
    this.authCode = typeof code === 'string' ? code : undefined;
    this.message=authServiceFailure(source.status,this.authCode,data?.message??data?.msg);
  }
}
// A measured slow connection returned a normal credential response after 17s.
// Keep a finite deadline, with time left for SDK/session persistence afterwards.
export const AUTH_REQUEST_TIMEOUT_MS = 30_000;
export const AUTH_ACTION_TIMEOUT_MS = 45_000;
export class AuthActionTimeout extends Error {
  constructor() { super('登录步骤未能结束。请重新加载登录页后再试；账户和交易数据会保留。'); this.name='AuthActionTimeout'; }
}
export async function boundedAuthAction<T>(action:()=>Promise<T>, timeoutMs=AUTH_ACTION_TIMEOUT_MS):Promise<T> {
  let timer:ReturnType<typeof setTimeout>;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AuthActionTimeout()),timeoutMs);});
  try { return await Promise.race([Promise.resolve().then(action),timeout]); }
  finally { clearTimeout(timer!); }
}
export function createAuthFetch(fetcher:typeof fetch=(input,init)=>fetch(input,init),timeoutMs=AUTH_REQUEST_TIMEOUT_MS,siteOrigin=productionAuthOrigin()):typeof fetch {
  return async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(!new URL(url).pathname.startsWith('/auth/v1/'))return fetcher(input,init);
    const gateway=authGatewayUrl(url,siteOrigin),method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    // Refresh rotation, signup and OTP requests must never be duplicated by this transport.
    const repeatable=method==='GET'||method==='HEAD'||method==='POST'&&new URL(url).pathname==='/auth/v1/token'&&new URL(url).searchParams.get('grant_type')==='password';
    const controller=new AbortController(),external=init?.signal??(input instanceof Request?input.signal:undefined);
    let expired=false,timer:ReturnType<typeof setTimeout>;
    const abort=()=>controller.abort(external?.reason);
    external?.addEventListener('abort',abort,{once:true});if(external?.aborted)abort();
    const stopped=new Promise<never>((_,reject)=>{
      const fail=()=>reject(expired?new Error(`登录服务在 ${Math.ceil(timeoutMs/1000)} 秒内未完成响应，可能是服务暂时异常或网络连接缓慢，请稍后重试。`):new DOMException('登录请求已取消','AbortError'));
      controller.signal.addEventListener('abort',fail,{once:true});if(controller.signal.aborted)fail();
      timer=setTimeout(()=>{expired=true;controller.abort();},timeoutMs);
    });
    try {
      return await Promise.race([(async()=>{
        const read=async(target:string|URL|Request,routed:boolean)=>{
          const request=input instanceof Request?new Request(typeof target==='string'?target:url,input.clone()):target;
          const response=await fetcher(request,{...init,cache:'no-store',...(routed?{credentials:'omit' as const}:{}),signal:controller.signal});
          const body=await response.arrayBuffer();
          if(response.status>=500)return new DescribedAuthResponse(body,response);
          return new Response(body.byteLength?body:null,{status:response.status,statusText:response.statusText,headers:response.headers});
        };
        if(!gateway)return read(input,false);
        let response:Response;
        try{response=await read(gateway,true);}
        catch(error){if(!repeatable||controller.signal.aborted)throw error;return read(input,false);}
        // An Auth error from Supabase already reached the same backend used by
        // the direct route. Replaying it adds load and can mask the original failure.
        if (response instanceof DescribedAuthResponse && response.authCode) return response;
        // A broken gateway gets one alternate route within the same deadline.
        const broken=[404,405,502,503,504].includes(response.status)||response.headers.get('Content-Type')?.includes('text/html');
        if(broken&&repeatable&&!controller.signal.aborted)return read(input,false);
        if(response.headers.get('Content-Type')?.includes('text/html'))throw Error('登录通道暂不可用，请稍后重试。');
        return response;
      })(),stopped]);
    } finally { clearTimeout(timer!);external?.removeEventListener('abort',abort); }
  };
}
