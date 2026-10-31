import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function validateStandaloneEnv(env,expectedProjectId){
  if(!expectedProjectId||!/^([a-z0-9]{20})$/.test(expectedProjectId))throw Error('New Supabase project has not been recorded; standalone release is blocked.');
  const ref=env.VITE_SUPABASE_PROJECT_ID,url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if(!ref||!url||!key)throw Error('All three VITE_SUPABASE variables must be explicitly set in the deployment environment.');
  if(ref!==expectedProjectId)throw Error('Deployment points at a different Supabase project; release is blocked.');
  if(url!==`https://${ref}.supabase.co`)throw Error('Supabase URL and project identifier do not match.');
  if(key.startsWith('sb_publishable_'))return true;
  if(key.startsWith('eyJ')){
    let payload;try{payload=JSON.parse(Buffer.from(key.split('.')[1]??'','base64url').toString('utf8'));}catch{throw Error('Invalid browser API key.');}
    if(payload.role==='anon'&&(!payload.ref||payload.ref===ref))return true;
  }
  throw Error('Only a browser publishable/anon key is allowed; never use a privileged or session key.');
}

export function verifyStandaloneBuild(){
  const target=JSON.parse(readFileSync(new URL('../deployment-target.json',import.meta.url),'utf8'));
  validateStandaloneEnv(process.env,target.supabaseProjectId);
  console.log('Standalone deployment backend configuration validated.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{verifyStandaloneBuild();}catch(error){console.error(error.message);process.exit(2);}
}
