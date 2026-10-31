import {prepareAccountBlobEncoding} from '../accountBlobCodec';
self.onmessage=async(event:MessageEvent<{value:unknown;knownHash?:string}>)=>{
  try{self.postMessage({ok:true,...await prepareAccountBlobEncoding(event.data.value,event.data.knownHash)});}
  catch{self.postMessage({ok:false});}
};
