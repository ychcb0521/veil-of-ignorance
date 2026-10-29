/** Public read-only OKX market proxy. No arbitrary URL, method, headers or credentials can be forwarded. */
export const fishProxyCors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, OPTIONS', 'Access-Control-Allow-Headers':'apikey, authorization, content-type' };
export function okxPublicUrl(path: string): URL {
  const input=new URL(path,'https://www.okx.com/api/v5/');
  if(input.origin!=='https://www.okx.com'||input.hash||input.username||input.password) throw new Error('Invalid public path');
  const routes:Record<string,readonly string[]>={
    '/api/v5/public/instruments':['instType'],
    '/api/v5/market/history-candles':['instId','bar','after','limit'],
    '/api/v5/market/history-trades':['instId','type','after','limit'],
  };
  const allowed=routes[input.pathname];if(!allowed)throw new Error('Path not allowed');
  for(const [key,value] of input.searchParams){
    if(!allowed.includes(key)||input.searchParams.getAll(key).length!==1)throw new Error('Parameter not allowed');
    if(key==='instId'&&!/^[A-Z0-9]{1,40}-USDT-SWAP$/.test(value))throw new Error('USDT SWAP only');
    if(key==='instType'&&value!=='SWAP')throw new Error('SWAP only');
    if(key==='bar'&&value!=='5m')throw new Error('5m only');
    if(key==='type'&&!['1','2'].includes(value))throw new Error('Invalid pagination type');
    if(key==='after'&&!/^\d{1,22}$/.test(value))throw new Error('Invalid cursor');
    if(key==='limit'&&(!/^\d+$/.test(value)||Number(value)<1||Number(value)>100))throw new Error('Invalid limit');
  }
  if(input.pathname.endsWith('/instruments')&&input.searchParams.get('instType')!=='SWAP')throw new Error('Missing SWAP');
  if(input.pathname.includes('/market/')&&!input.searchParams.has('instId'))throw new Error('Missing instrument');
  if(input.pathname.endsWith('/history-candles')&&input.searchParams.get('bar')!=='5m')throw new Error('Missing 5m');
  return input;
}
export async function handleFishProxy(request:Request,fetcher:typeof fetch=fetch):Promise<Response>{
  const headers={...fishProxyCors,'Content-Type':'application/json','Cache-Control':'no-store'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return new Response('{"error":"GET only"}',{status:405,headers});
  let upstream:URL;
  try{
    const input=new URL(request.url);
    if([...input.searchParams.keys()].some(k=>k!=='path')||input.searchParams.getAll('path').length!==1)throw new Error('One path required');
    upstream=okxPublicUrl(input.searchParams.get('path')??'');
  }catch{return new Response('{"error":"Public market path not allowed"}',{status:400,headers});}
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetcher.call(globalThis,upstream,{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
    const body=await response.text();
    if(body.length>4_000_000)return new Response('{"error":"Upstream response too large"}',{status:502,headers});
    try{JSON.parse(body);}catch{return new Response('{"error":"Invalid upstream JSON"}',{status:502,headers});}
    const retry=response.headers.get('Retry-After');if(retry)Object.assign(headers,{'Retry-After':retry});
    return new Response(body,{status:response.status,headers});
  }catch{return new Response('{"error":"Public market upstream unavailable"}',{status:502,headers});}
  finally{clearTimeout(timeout);}
}
