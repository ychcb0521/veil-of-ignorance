import {deserializeAccountBlob} from '../accountBlobCodec';
self.onmessage = async (event: MessageEvent<{enc:'gzip'|'json';text:string}>) => {
  try {
    const {enc,text}=event.data;
    let json=text;
    if(enc==='gzip'){
      const binary=atob(text),bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      json=await new Response(stream).text();
    }
    self.postMessage({ok:true,value:deserializeAccountBlob(json)});
  } catch { self.postMessage({ok:false}); }
};
