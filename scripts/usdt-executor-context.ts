import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMacUsdtCredentials } from './usdt-macos-credentials.ts';
import { DatabaseSync } from 'node:sqlite';

export function loadUsdtCredentials(directory: string) {
  if (process.platform === 'darwin') return readMacUsdtCredentials(directory);
  if (process.platform !== 'win32') throw Error('此执行器只支持 Windows 和 Mac');
  const script = [
    '$ErrorActionPreference="Stop"',
    '$saved = Get-Content -LiteralPath $env:VEIL_BINANCE_CREDENTIAL_FILE -Raw | ConvertFrom-Json',
    '$key = $saved.apiKey | ConvertTo-SecureString',
    '$secret = $saved.secretKey | ConvertTo-SecureString',
    'try { @{apiKey=[net.networkcredential]::new("",$key).Password;secret=[net.networkcredential]::new("",$secret).Password} | ConvertTo-Json -Compress }',
    'finally { $key.Dispose(); $secret.Dispose() }',
  ].join('\n');
  let buffer: Buffer;
  try {
    buffer = execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, timeout: 10_000, env: { ...process.env, VEIL_BINANCE_CREDENTIAL_FILE: join(directory, 'account.dpapi') },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { throw Error('无法读取本机加密的币安 API 凭证'); }
  try {
    const data = JSON.parse(buffer.toString('utf8'));
    if (typeof data.apiKey !== 'string' || typeof data.secret !== 'string' || !data.apiKey || !data.secret) throw Error('币安凭证格式错误');
    return { apiKey: data.apiKey, secret: Buffer.from(data.secret) };
  } finally { buffer.fill(0); }
}
export function readUsdtConfig(directory: string) {
  const value = JSON.parse(readFileSync(join(directory, 'usdt-follow.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!/^[a-f0-9-]{36}$/i.test(value.owner) || !/^[0-9a-f]{64}$/i.test(value.token) || !/^[0-9a-f]{64}$/.test(value.account))
    throw Error('本机配对配置无效');
  return value as { owner: string; token: string; account: string; ledgerAccount?: string };
}
export function boundLedgerAccount(directory: string) {
  const config = readUsdtConfig(directory);
  let account = config.ledgerAccount;
  if (!account) {
    const db = new DatabaseSync(join(directory,'usdt-follow.sqlite'),{readOnly:true});
    try { account = String(db.prepare('SELECT account FROM connection WHERE id=1').get()?.account ?? ''); }
    finally { db.close(); }
  }
  if (!/^[1-9]\d*$/.test(account ?? '') || createHash('sha256').update(account!).digest('hex') !== config.account)
    throw Error('本机缺少已验证的原账户身份，请先完成只读账户配置');
  return account!;
}
export function usdtRuntime() {
  // Both OS packages contain this exact same server bundle. CLI and server hash the same file.
  return createHash('sha256').update(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'usdt-follow-server.mjs'))).digest('hex');
}
export function lockUsdtDirectory(directory: string) {
  const path = join(directory, 'usdt-follow.lock');
  let fd: number;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(readFileSync(path, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('本机执行锁无效，请人工核对进程');
    try { process.kill(pid, 0); throw Error('本机执行器仍在运行，请先冻结并停止原进程'); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
      unlinkSync(path);
    }
    fd = openSync(path, 'wx', 0o600);
  }
  writeFileSync(fd, String(process.pid));
  return () => { closeSync(fd); unlinkSync(path); };
}
