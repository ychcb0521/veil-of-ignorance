import {encodeStoredQuality} from '../fish/qualityBackupEncoding';
self.onmessage=async({data})=>{
  try{self.postMessage({ok:true,result:await encodeStoredQuality(data.owner,data.plans,data.knownHash)});}
  catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'鱼质量备份编码失败'});}
};
