/** Read-only account library requests may use one alternate route. Never replay writes. */
const ROUTE_TIMEOUT_MS = 5_000;

export async function fetchLibraryRead(fetcher:typeof fetch,input:RequestInfo|URL,init:RequestInit|undefined,gateway:string):Promise<Response> {
  const external=init?.signal??(input instanceof Request?input.signal:undefined);
  const read=async(target:RequestInfo|URL)=>{
    if(external?.aborted)throw new DOMException('读取已取消','AbortError');
    const controller=new AbortController();
    const abort=()=>controller.abort(external?.reason);
    external?.addEventListener('abort',abort,{once:true});
    if(external?.aborted)abort();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const stopped=new Promise<never>((_,reject)=>{
      const fail=()=>reject(external?.aborted?new DOMException('读取已取消','AbortError'):new Error('库记录读取超时，请重试'));
      controller.signal.addEventListener('abort',fail,{once:true});
      if(controller.signal.aborted)fail();
      timer=setTimeout(()=>controller.abort(),ROUTE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([(async()=>{
        const request=input instanceof Request?new Request(target,input):target;
        const response=await fetcher(request,{...init,signal:controller.signal,cache:'no-store',credentials:'omit'});
        // Bound the body as well as the connection; headers alone are not a completed read.
        const body=await response.arrayBuffer();
        return new Response(body.byteLength?body:null,{status:response.status,statusText:response.statusText,headers:response.headers});
      })(),stopped]);
    } finally {
      clearTimeout(timer);external?.removeEventListener('abort',abort);
    }
  };
  let response:Response;
  try { response=await read(gateway); }
  catch(cause) { if(external?.aborted)throw cause;return read(input); }
  const broken=[404,405,502,503,504].includes(response.status)||response.headers.get('Content-Type')?.includes('text/html');
  if(!broken||external?.aborted)return response;
  return read(input);
}
