import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createUsdtRequest, createUsdtExchange } from './usdt-exchange.ts';
import { openUsdtFollowStore } from './usdt-follow-store.ts';
import { createUsdtHandoff, handoffHash, type HandoffPayload } from './usdt-handoff.ts';
import { reconcileUsdtHandoff, type HandoffEvidence } from './usdt-handoff-reconcile.ts';
import { createUsdtFollower } from './usdt-follow-engine.ts';
import { createUsdtCampaignReader } from './usdt-campaign-reader.ts';
import { matchesManualAnchor } from './usdt-managed-execution.ts';
import { loadUsdtCredentials, readUsdtConfig, usdtRuntime, lockUsdtDirectory, boundLedgerAccount } from './usdt-executor-context.ts';

function writeNew(path: string, value: unknown) {
  // Never overwrite a prior transfer/receipt. A failed export can be re-read from the durable source record.
  const fd = openSync(resolve(path), 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
}
function readArtifact(path?: string) {
  if (!path) throw Error('缺少交接文件路径');
  const bytes = readFileSync(resolve(path));
  if (bytes.length > 128 * 1024 * 1024) throw Error('交接文件超过大小限制');
  return JSON.parse(bytes.toString('utf8'));
}
function runTaskScript(script: string, env: NodeJS.ProcessEnv) {
  const wrapped = "$ErrorActionPreference='Stop'\ntry {\n" + script +
    "\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
  try {
    return execFileSync('pwsh.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(wrapped,'utf16le').toString('base64')],{
      windowsHide:true,timeout:30000,env:{...process.env,...env},stdio:['ignore','pipe','pipe'],
    }).toString('utf8').trim();
  } catch (error) {
    const message=String((error as {stderr?:Buffer}).stderr ?? '').trim();
    throw Error(message && !message.includes('CLIXML') ? message.slice(0,1000) : '计划任务操作失败，当前执行权保护保留');
  }
}
async function localApi(directory: string, command: string, more: Record<string, unknown> = {}) {
  const config = readUsdtConfig(directory);
  const reply = await fetch('http://127.0.0.1:47321/api/usdt-follow/safe', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(300_000),
    headers: { Origin: 'https://veil-of-ignorance-ten.vercel.app', 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
    body: JSON.stringify({ ...more, owner: config.owner, command }),
  });
  const body = await reply.json();
  if (!reply.ok) throw Error(body.error || '本机交接操作失败');
  return body;
}
function upgradeWindows(directory: string) {
  if (process.platform !== 'win32') throw Error('首次升级必须在当前 Windows 原端执行');
  const packageDirectory = dirname(fileURLToPath(import.meta.url));
  const script = String.raw`
$ErrorActionPreference='Stop'
$name='Veil Binance USDT-M Executor'
$task=Get-ScheduledTask -TaskName $name -TaskPath '\'
$action=$task.Actions[0]
if ($task.Actions.Count -ne 1 -or $action.Execute -notmatch '(?i)node\.exe$' -or
    $action.Arguments -notmatch 'usdt-follow-server\.mjs' -or
    !$action.Arguments.Contains($env:VEIL_HANDOFF_DATA)) { throw '同名任务不属于当前账户目录，已拒绝修改。' }
$backup=Join-Path $env:VEIL_HANDOFF_DATA 'handoff-task-before.xml'
if (!(Test-Path -LiteralPath $backup)) { Export-ScheduledTask -TaskName $name -TaskPath '\' | Set-Content -LiteralPath $backup -Encoding utf8 }
Disable-ScheduledTask -TaskName $name -TaskPath '\' | Out-Null
$oldMarker=Join-Path $action.WorkingDirectory 'work\usdt-executor-windows\autostart.enabled'
if (Test-Path -LiteralPath $oldMarker) { Remove-Item -LiteralPath $oldMarker }
if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $name -TaskPath '\' }
for($attempt=0;$attempt -lt 100;$attempt++) {
  $listener=Get-NetTCPConnection -LocalPort 47321 -State Listen -ErrorAction SilentlyContinue
  if (!$listener) { break }
  Start-Sleep -Milliseconds 100
}
if (Get-NetTCPConnection -LocalPort 47321 -State Listen -ErrorAction SilentlyContinue) { throw '仍有执行器监听，已保持自动启动关闭；请核对原进程后重试。' }
$entry=Join-Path $env:VEIL_HANDOFF_PACKAGE 'usdt-follow-server.mjs'
$preload=([uri](Join-Path $env:VEIL_HANDOFF_PACKAGE 'windows-preload.mjs')).AbsoluteUri
$arguments='--import "'+$preload+'" "'+$entry+'" "'+$env:VEIL_HANDOFF_DATA+'" --live'
$newAction=New-ScheduledTaskAction -Execute $action.Execute -Argument $arguments -WorkingDirectory $env:VEIL_HANDOFF_PACKAGE
Set-ScheduledTask -TaskName $name -TaskPath '\' -Action $newAction | Out-Null
Disable-ScheduledTask -TaskName $name -TaskPath '\' | Out-Null
$desktop=[Environment]::GetFolderPath('Desktop')
$link=Join-Path $desktop '币安 U 本位执行器开关.lnk'
if (Test-Path -LiteralPath $link) {
  $saved=$link+'.handoff-before.lnk'
  if (!(Test-Path -LiteralPath $saved)) { Copy-Item -LiteralPath $link -Destination $saved }
}
$ws=New-Object -ComObject WScript.Shell
$shortcut=$ws.CreateShortcut($link)
$shortcut.TargetPath=Join-Path $env:VEIL_HANDOFF_PACKAGE 'Windows执行器开关.cmd'
$shortcut.Arguments='"'+$env:VEIL_HANDOFF_DATA+'"'
$shortcut.WorkingDirectory=$env:VEIL_HANDOFF_PACKAGE
$shortcut.Save()
[Console]::WriteLine('旧任务已停止并禁用；新版启动入口已安装，尚未赋予执行权。')
`;
  return runTaskScript(script,{VEIL_HANDOFF_DATA:directory,VEIL_HANDOFF_PACKAGE:packageDirectory});
}

async function windowsTask(directory: string, start: boolean) {
  if (process.platform !== 'win32') throw Error('此后台任务入口用于 Windows');
  if (!start) {
    const status = await localApi(directory,'status');
    if (status.handoff?.stage === 'active') await localApi(directory,'handoff-freeze');
  }
  const folder = dirname(fileURLToPath(import.meta.url));
  const script = String.raw`
$ErrorActionPreference='Stop'
$name='Veil Binance USDT-M Executor'
$task=Get-ScheduledTask -TaskName $name -TaskPath '\'
$entry=Join-Path $env:VEIL_HANDOFF_PACKAGE 'usdt-follow-server.mjs'
if ($task.Actions.Count -ne 1 -or !$task.Actions[0].Arguments.Contains($entry) -or
    !$task.Actions[0].Arguments.Contains($env:VEIL_HANDOFF_DATA)) { throw '任务尚未升级或路径不符，请先核对，禁止启动其他执行器。' }
if ($env:VEIL_HANDOFF_START -eq '1') {
  Enable-ScheduledTask -TaskName $name -TaskPath '\' | Out-Null
  if ($task.State -ne 'Running') { Start-ScheduledTask -TaskName $name -TaskPath '\' }
} else {
  Disable-ScheduledTask -TaskName $name -TaskPath '\' | Out-Null
  if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $name -TaskPath '\' }
}
[Console]::WriteLine('本机后台任务开关已更新；是否允许交易仍由交接状态和本次启动对账决定。')
`;
  console.log(runTaskScript(script,{VEIL_HANDOFF_PACKAGE:folder,VEIL_HANDOFF_DATA:directory,VEIL_HANDOFF_START:start?'1':'0'}));
}

async function main() {
  const [command, rawDirectory, input, output] = process.argv.slice(2);
  if (!rawDirectory || !command) throw Error('用法：handoff.mjs 命令 本机账户目录 [输入文件] [输出文件]');
  const directory = resolve(rawDirectory);
  const config = readUsdtConfig(directory);
  if (command === 'start-windows' || command === 'stop-windows') { await windowsTask(directory,command === 'start-windows'); return; }
  if (command === 'status') {
    const value = await localApi(directory, 'status');
    console.log(JSON.stringify({ connected: value.connected, paused: value.paused, handoff: value.handoff },null,2));
    return;
  }
  if (command === 'freeze' || command === 'resume' || command === 'initialize-source' || command === 'accept-cancellation-live') {
    const content = command === 'accept-cancellation-live' ? { receipt: readArtifact(input) } : { confirmed: true };
    const name = command === 'initialize-source' ? 'initialize' : command === 'accept-cancellation-live' ? 'cancellation' : command;
    console.log(JSON.stringify(await localApi(directory, 'handoff-' + name, content),null,2));
    return;
  }
  if (command === 'export') {
    if (!input || !output) throw Error('导出需要接管请求文件与全新的输出文件路径');
    if (existsSync(resolve(output))) throw Error('输出文件已存在，禁止覆盖');
    try {
      const result = await localApi(directory, 'handoff-export', { request: readArtifact(input) });
      writeNew(output,result.bundle);
      console.log('交接包已导出。原端执行权已经交出，重启或网页恢复按钮都不能重新下单。');
      return;
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof DOMException)) throw error;
    }
  }
  if (command === 'receive') {
    if (!input || existsSync(resolve(input))) throw Error('接管请求需要一个全新的输出文件路径');
    // A surrendered source may stay online read-only while requesting the return trip.
    try {
      const result = await localApi(directory,'handoff-request');
      writeNew(input,result.request);
      console.log('本机接管请求已生成；本端仍不能交易。');
      return;
    } catch (error) {
      if (!(error instanceof TypeError || error instanceof DOMException)) throw error;
    }
  }
  if (command === 'upgrade-windows') console.log(upgradeWindows(directory));
  const unlock = lockUsdtDirectory(directory);
  let credentials: ReturnType<typeof loadUsdtCredentials> | undefined;
  let store: ReturnType<typeof openUsdtFollowStore> | undefined;
  try {
    // Request, import and cancellation remain available even if the new proxy/IP fails Binance authentication.
    const account = boundLedgerAccount(directory);
    store = openUsdtFollowStore(join(directory,'usdt-follow.sqlite'),account,config.owner);
    const machine = createUsdtHandoff(store,config.account,config.owner,usdtRuntime());
    if (command === 'export') {
      if (machine.state().stage !== 'outgoing') throw Error('只有已交出端可离线重取原包；首次导出必须启动接口并核对币安');
      writeNew(output!,machine.export(readArtifact(input),null,0));
      console.log('已离线重取同一交接包，执行权继续保持已交出。');
      return;
    }
    if (command === 'upgrade-windows') { store.setLocal('legacy-windows-stopped',true); return; }
    if (command === 'receive') {
      if (!input) throw Error('接管请求需要输出文件路径');
      writeNew(input,machine.receiveRequest());
      console.log('本机接管请求已生成，请传到原执行端。该文件不包含 API 凭证或配对码。');
      return;
    }
    if (command === 'import') {
      machine.import(readArtifact(input));
      for (const row of store.readAll()) if (!row.managed && !['closed','ignored'].includes(row.status.state))
        store.setLocal('imported-monitor:' + row.campaign.id,true);
      console.log('账本与冻结监测状态已导入，仍为只读。请先执行 reconcile，再执行 activate。');
      return;
    }
    if (command === 'reject') {
      if (!output) throw Error('作废接管需要原交接文件和全新的凭据输出路径');
      if (existsSync(resolve(output))) throw Error('作废凭据输出文件已存在，禁止覆盖');
      writeNew(output,machine.cancelIncoming(readArtifact(input)));
      console.log('本次接管已永久作废。将作废凭据传回原端；本端不能再导入该交接包。');
      return;
    }
    if (command === 'accept-cancellation') {
      machine.acceptCancellation(readArtifact(input));
      console.log('已核验接收端作废凭据；原端保持冻结，需重新对账后明确恢复。');
      return;
    }
    if (command !== 'reconcile' && command !== 'activate') throw Error('未知交接命令');
    if (!['staged','frozen'].includes(machine.state().stage)) throw Error('本端尚无可核对的交接；已交出端不能直接恢复');
    credentials = loadUsdtCredentials(directory);
    const read = createUsdtRequest(credentials,fetch,()=> { throw Error('交接工具禁止发送交易请求'); });
    const exchange = createUsdtExchange(read), verified = await exchange.account();
    if (verified.id !== account || config.account !== createHash('sha256').update(verified.id).digest('hex'))
      throw Error('当前凭证与本机绑定账户不符');
    const campaigns = createUsdtCampaignReader(read);
    const follower = createUsdtFollower(store,exchange,config.owner,verified.mode,Date.now(),async anchor => {
      const result = await campaigns(Math.max(1,anchor.openedAt-1000),[{symbol:anchor.symbol,openedAt:anchor.openedAt}],anchor.symbol);
      const actual = result.campaigns.find(row=>matchesManualAnchor(anchor,row));
      if (!actual) throw Error('原首仓成交尚未核实');
      return actual;
    });
    await follower.quiesce();
    await follower.reconcileForHandoff();
    const expected = machine.state().stage === 'staged' ? machine.state().bundle?.payload.evidence as HandoffEvidence : undefined;
    const evidence = await reconcileUsdtHandoff(store,exchange,read,config.owner,expected);
    store.setLocal('last-reconciliation',{at:evidence.at,digest:handoffHash(evidence)});
    if (command === 'activate') machine.activateAfterReconciliation();
    console.log(command === 'activate' ? '本次账户、余仓、普通及条件挂单、成交与冻结版本核对通过；已允许本机启动执行器。' :
      '本次对账通过，仍为只读。activate 会再次读取币安，不能沿用旧的通过结果。');
  } finally { try { store?.close(); } finally { credentials?.secret.fill(0); unlock(); } }
}
void main().catch(error => {
  console.error(error instanceof Error && !('stderr' in error) ? error.message : '交接操作失败；原执行权保护保留，请读取状态并按恢复说明处理');
  process.exitCode = 1;
});
