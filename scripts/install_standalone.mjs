import {spawnSync} from 'node:child_process';
import {verifyStandaloneBuild} from './verify_standalone_env.mjs';
try{verifyStandaloneBuild();}catch(error){console.error(error.message);process.exit(2);}
const result=spawnSync('bun',['install','--frozen-lockfile'],{stdio:'inherit',env:process.env});
if(result.error){console.error('Bun is unavailable; install was not completed.');process.exit(2);}
process.exit(result.status??1);
