import { encodeStoredPreEntry } from '../fish/preEntryBackupEncoding';
self.onmessage = async (e:MessageEvent<{owner:string;knownHash?:string}>) => {
  try { self.postMessage({ok:true,result:await encodeStoredPreEntry(e.data.owner,e.data.knownHash)}); }
  catch(error) { self.postMessage({ok:false,error:error instanceof Error?error.message:'入选库备份编码失败'}); }
};
