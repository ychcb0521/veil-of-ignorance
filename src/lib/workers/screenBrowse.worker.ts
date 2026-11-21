import {indexExistingScreenSnapshot} from '../fish/preEntryPersistence';

self.onmessage=async(event:MessageEvent<{owner:string}>)=>{
  try{
    await indexExistingScreenSnapshot(event.data.owner);
    self.postMessage({ok:true});
  }catch(error){
    self.postMessage({ok:false,message:error instanceof Error?error.message:'本机目录读取失败'});
  }
};
