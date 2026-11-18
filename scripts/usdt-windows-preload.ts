import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setGlobalProxyFromEnv } from 'node:http';
const paths = [
  join(process.env.USERPROFILE!,'.cache','codex-runtimes','codex-primary-runtime','dependencies','native','powershell'),
  join(process.env.ProgramFiles!,'PowerShell','7'),
];
const powerShell = paths.find(path => existsSync(join(path,'pwsh.exe')));
if (!powerShell) throw Error('找不到 PowerShell 7，无法读取当前用户的加密凭证');
process.env.PATH = powerShell + ';' + process.env.PATH;
const proxy = process.env.HTTPS_PROXY || 'http://127.0.0.1:10808';
setGlobalProxyFromEnv({HTTPS_PROXY:proxy,HTTP_PROXY:proxy,NO_PROXY:'127.0.0.1,localhost'});
