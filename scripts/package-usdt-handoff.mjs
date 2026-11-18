import { build } from 'esbuild';
import { mkdir,copyFile,writeFile,readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { nativeUsdtBuildPlugin } from './usdt-native-build.mjs';
const out=resolve(process.argv[2] || 'work/veil-usdt-handoff');
await mkdir(out,{recursive:true});
const entries={
  'usdt-follow-server':'usdt-follow-server','handoff':'usdt-handoff-cli','handoff-menu':'usdt-handoff-menu',
  'macos-preload':'usdt-macos-preload','windows-preload':'usdt-windows-preload','macos-setup':'usdt-macos-setup',
};
for(const [file,entry] of Object.entries(entries))
  await build({entryPoints:['scripts/'+entry+'.ts'],outfile:join(out,file+'.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',
    treeShaking:true,plugins:[nativeUsdtBuildPlugin],logLevel:'warning'});
await writeFile(join(out,'启动Mac交接执行器.command'),'#!/bin/bash\nset -eu\ncd -- "$(dirname -- "$0")"\nexport PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"\nnode -e \'if(Number(process.versions.node.split(".")[0])!==24)throw Error("请安装 Node.js 24.22.2")\'\nnode ./handoff-menu.mjs\n');
await writeFile(join(out,'Windows执行器开关.cmd'),'@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\nnode.exe handoff-menu.mjs %*\r\npause\r\n');
await copyFile('docs/usdt-executor-handoff.md',join(out,'交接与恢复说明.md'));
const runtime=createHash('sha256').update(await readFile(join(out,'usdt-follow-server.mjs'))).digest('hex');
await writeFile(join(out,'version.json'),JSON.stringify({protocol:'veil-usdt-handoff-v1',runtime,node:'24.22.2',source:'aadc2d47 + executor-handoff',realAccountCutoverTested:false})+'\n');
console.log('Windows / Mac 共用交接包已生成；运行代码指纹：'+runtime);
