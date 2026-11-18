import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
const folder=dirname(fileURLToPath(import.meta.url));
const mac=process.platform==='darwin';
const prompt=createInterface({input:process.stdin,output:process.stdout});
const ask=async(label:string)=>(await prompt.question(label)).trim().replace(/^"(.*)"$/,'$1');
const preload=pathToFileURL(join(folder,mac?'macos-preload.mjs':'windows-preload.mjs')).href;
const directory=mac?join(homedir(),'Library','Application Support','VeilUSDTExecutor'):
  resolve(process.argv[2] || await ask('现有 Windows 账户目录（保留原目录，不搬密钥）：'));
function run(entry:string,...args:string[]){
  const result=spawnSync(process.execPath,[...(entry==='macos-setup.mjs'?[]:['--import',preload]),join(folder,entry),...args],{stdio:'inherit',windowsHide:false});
  if(result.error || result.status!==0)console.log('操作未完成。执行权保护保留，请按恢复说明核对。');
}
async function main(){
  for(;;){
    console.log('\n无知之幕 · Windows / Mac 轮流接管');
    console.log('任何新端必须导入交接包并重新对账；启动接口本身不会获得执行权。');
    console.log('1 '+(mac?'首次配置 Mac 本机凭证（只读鉴权）':'首次升级 Windows 原端（停止旧任务，安装交接保护）'));
    console.log('2 启动本机接口（'+(mac?'保持此窗口及本机网页打开':'使用现有计划任务在后台运行')+'）');
    console.log('3 查看本机接口与交接状态');
    console.log('4 新端：生成接管请求文件');
    console.log('5 旧端：冻结并导出给指定新端');
    console.log('6 新端：导入交接包（保持只读）');
    console.log('7 新端：向币安核对账户、余仓、挂单和成交');
    console.log('8 新端：再次对账并允许执行');
    console.log('9 原端首次升级：网页同步后建立执行权');
    console.log('R 失败恢复 / 作废交接 / 恢复冻结原端');
    if(!mac)console.log('S 冻结并停止 Windows 后台任务（关闭自动重试）');
    console.log('0 退出');
    const choice=(await ask('请选择：')).toUpperCase();
    if(choice==='0')return;
    if(choice==='1'){
      if(mac){
        if(existsSync(join(directory,'usdt-follow.json')))run('handoff.mjs','prepare-account',directory);
        else run('macos-setup.mjs');
      }
      else if(await ask('此操作会停止现有 Windows 实盘并关闭旧自动重试。确认升级请输入“停止旧端”：')==='停止旧端')
        run('handoff.mjs','upgrade-windows',directory);
    }else if(choice==='2'){
      console.log('若尚未取得执行权，接口只读；已有执行权也必须通过本次启动对账。停止请按 Ctrl+C。');
      if(mac)run('usdt-follow-server.mjs',directory,'--live');else run('handoff.mjs','start-windows',directory);
    }else if(choice==='3')run('handoff.mjs','status',directory);
    else if(choice==='4')run('handoff.mjs','receive',directory,await ask('接管请求保存到哪个全新文件：'));
    else if(choice==='5'){
      const request=await ask('新端接管请求文件路径：'),out=await ask('交接包保存到哪个全新文件：');
      if(await ask('旧端会立即停止所有账户写操作；导出后保持锁定。确认请输入“交出执行权”：')==='交出执行权')
        run('handoff.mjs','export',directory,request,out);
    }else if(choice==='6')run('handoff.mjs','import',directory,await ask('旧端交接包文件路径：'));
    else if(choice==='7')run('handoff.mjs','reconcile',directory);
    else if(choice==='8'){
      if(await ask('只允许已收到交接包的新端继续。确认请输入“本端接管”：')==='本端接管')run('handoff.mjs','activate',directory);
    }else if(choice==='9'){
      if(mac){console.log('首次执行权只能由现有 Windows 原端建立。');continue;}
      if(await ask('请确认旧任务已停、当前网页已同步原监测状态。输入“原端继续”：')==='原端继续')
        run('handoff.mjs','initialize-source',directory);
    }else if(choice==='S'&&!mac)run('handoff.mjs','stop-windows',directory);
    else if(choice==='R'){
      console.log('1 新端尚未执行：永久作废此次接管并出具凭据\n2 运行中的旧端：接收作废凭据\n3 已停止的旧端：接收作废凭据\n4 冻结且未交出/已收回的旧端：重新对账后恢复\n已接管并执行过的新端，必须按 4→5→6→7→8 反向交接最新账本。');
      const recovery=await ask('请选择恢复路径：');
      if(recovery==='1')run('handoff.mjs','reject',directory,await ask('原交接包路径：'),await ask('作废凭据保存到哪个全新文件：'));
      if(recovery==='2'||recovery==='3')run('handoff.mjs',recovery==='2'?'accept-cancellation-live':'accept-cancellation',directory,await ask('新端作废凭据路径：'));
      if(recovery==='4')run('handoff.mjs','resume',directory);
    }
  }
}
try{await main();}finally{prompt.close();}
