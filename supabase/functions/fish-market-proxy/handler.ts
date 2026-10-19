/** Fixed public GET routes only; no arbitrary host, write operation, caller headers or credentials. */
export const fishProxyCors = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, OPTIONS', 'Access-Control-Allow-Headers':'apikey, authorization, content-type', 'Access-Control-Expose-Headers':'Retry-After' };
type Venue = 'okx'|'bitget'|'gate';
const fail=(message:string):never=>{throw new Error(message);};
const integer=(s:string|null,max=Number.MAX_SAFE_INTEGER,min=0)=>s!==null&&/^\d+$/.test(s)&&Number.isSafeInteger(Number(s))&&Number(s)>=min&&Number(s)<=max;
const routes:Record<Venue,Record<string,readonly string[]>>={
  okx:{'public/instruments':['instType'],'market/history-candles':['instId','bar','after','limit'],'market/history-trades':['instId','type','after','limit']},
  gate:{contracts:[],candlesticks:['contract','interval','from','to'],trades:['contract','from','to','limit','offset']},
  bitget:{contracts:['productType'],'history-candles':['symbol','productType','granularity','endTime','limit'],'fills-history':['symbol','productType','startTime','endTime','limit','idLessThan']},
};
export function publicMarketUrl(exchange:string,path:string):URL {
  if(!Object.prototype.hasOwnProperty.call(routes,exchange))fail('交易所不在白名单中');
  if(!/^[a-z-]+(?:\/[a-z-]+)?(?:\?[^#]*)?$/.test(path))fail('公开接口路径无效');
  const venue=exchange as Venue,base=venue==='okx'?'https://www.okx.com/api/v5/':venue==='gate'?'https://api.gateio.ws/api/v4/futures/usdt/':'https://api.bitget.com/api/v2/mix/market/';
  const route=path.split('?')[0],allowed=routes[venue][route];if(!allowed)fail('接口不在白名单中');
  const url=new URL(path,base),q=url.searchParams;
  for(const key of q.keys())if(!allowed.includes(key)||q.getAll(key).length!==1)fail('不允许的参数或重复参数');
  const required=(key:string,value?:string)=>{if(!q.has(key)||(value!==undefined&&q.get(key)!==value))fail(`缺少或无效的 ${key} 参数`);};
  const limit=(max:number)=>{if(q.has('limit')&&!integer(q.get('limit'),max,1))fail('每次数量超出上限');};
  const cursor=(key:string)=>{if(q.has(key)&&!/^\d{1,22}$/.test(q.get(key)!))fail('分页游标无效');};
  if(venue==='okx'){
    limit(100);cursor('after');
    if(route==='public/instruments')required('instType','SWAP');
    else {if(!/^[A-Z0-9]{1,40}-USDT-SWAP$/.test(q.get('instId')??''))fail('只允许 USDT 永续');
      if(route==='market/history-candles')required('bar','5m');
      else {if(q.has('type')&&!['1','2'].includes(q.get('type')!))fail('分页类型无效');}
    }
  }else if(venue==='gate'){
    if(route!=='contracts'){
      if(!/^[A-Z0-9]{1,40}_USDT$/.test(q.get('contract')??''))fail('只允许 USDT 永续');
      if(!integer(q.get('from'),8640000000000,1)||!integer(q.get('to'),8640000000000,1))fail('时间参数无效');
      const from=Number(q.get('from')),to=Number(q.get('to'));if(to<from)fail('时间区间倒置');
      if(route==='candlesticks'){
        required('interval','5m');
        if(from%300||to%300||(to-from)/300+1>2000)fail('K线边界或根数超出上限');
      }else {limit(1000);if(to-from>7*86400)fail('成交查询区间超过7天');if(q.has('offset')&&!integer(q.get('offset'),10000000))fail('分页偏移无效');}
    }
  }else {
    required('productType','USDT-FUTURES');
    if(route!=='contracts'){
      if(!/^[A-Z0-9]{1,40}USDT$/.test(q.get('symbol')??''))fail('只允许 USDT 永续');
      if(!integer(q.get('endTime'),8640000000000000,1))fail('截止时间无效');
      if(route==='history-candles'){required('granularity','5m');limit(200);if(Number(q.get('endTime'))%300000)fail('K线游标须为5分钟边界');}
      else {limit(1000);cursor('idLessThan');if(!integer(q.get('startTime'),8640000000000000,1))fail('开始时间无效');const span=Number(q.get('endTime'))-Number(q.get('startTime'));if(span<0||span>7*86400000)fail('成交查询区间须在7天内');}
    }
  }
  return url;
}
/** Backwards compatible with the already delivered OKX proxy URLs. */
export const okxPublicUrl=(path:string)=>publicMarketUrl('okx',path);
export async function handleFishProxy(request:Request,fetcher:typeof fetch=fetch):Promise<Response>{
  const headers={...fishProxyCors,'Content-Type':'application/json','Cache-Control':'no-store'};
  const error=(message:string,status:number)=>new Response(JSON.stringify({error:message}),{status,headers});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return error('只允许只读 GET 请求',405);
  let upstream:URL;
  try{
    const input=new URL(request.url);
    if([...input.searchParams.keys()].some(k=>!['path','exchange'].includes(k))||input.searchParams.getAll('path').length!==1||input.searchParams.getAll('exchange').length>1)throw new Error('参数无效');
    upstream=publicMarketUrl(input.searchParams.get('exchange')??'okx',input.searchParams.get('path')??'');
  }catch{return error('公开行情路径或参数不在白名单内',400);}
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetcher.call(globalThis,upstream,{method:'GET',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
    const body=await response.text();
    if(body.length>4_000_000)return error('上游响应超出大小上限',502);
    try{JSON.parse(body);}catch{return error('上游返回的不是有效 JSON',502);}
    const retry=response.headers.get('Retry-After');if(retry)Object.assign(headers,{'Retry-After':retry});
    return new Response(body,{status:response.status,headers});
  }catch{return error('公开行情上游不可用或请求超时',502);}
  finally{clearTimeout(timeout);}
}
