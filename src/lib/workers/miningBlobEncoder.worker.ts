import {readRaw,keyOf} from '../fish/miningDisk';
import {prepareAccountBlobEncoding} from '../accountBlobCodec';
self.onmessage=async(e:MessageEvent<{owner:string;knownHash?:string}>)=>{
  try{
    const value=await readRaw(keyOf(e.data.owner));
    self.postMessage({ok:true,result:value?await prepareAccountBlobEncoding(value,e.data.knownHash):undefined});
  }catch{self.postMessage({ok:false});}
};
