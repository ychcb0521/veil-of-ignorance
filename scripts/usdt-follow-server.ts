import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { mkdirSync, openSync, closeSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { createUsdtExchange, createUsdtRequest } from './usdt-exchange.ts';
import { openUsdtFollowStore } from './usdt-follow-store.ts';
import { createUsdtFollower } from './usdt-follow-engine.ts';
import type { UsdtFollowCampaign } from '../src/lib/fish/usdtFollow.ts';

const origin = 'https://veil-of-ignorance-ten.vercel.app';
const dashPort = 47321;
const bodyLimit = 1_000_000;

function loadCredentials(directory: string) {
  if (process.platform !== 'win32') throw Error('币安凭证由 Windows 当前用户保护');
  const script = [
    '$ErrorActionPreference="Stop"',
    '$saved = Get-Content -LiteralPath $env:VEIL_BINANCE_CREDENTIAL_FILE -Raw | ConvertFrom-Json',
    '$key = $saved.apiKey | ConvertTo-SecureString',
    '$secret = $saved.secretKey | ConvertTo-SecureString',
    'try { @{apiKey=[net.networkcredential]::new("",$key).Password;secret=[net.networkcredential]::new("",$secret).Password} | ConvertTo-Json -Compress }',
    'finally { $key.Dispose(); $secret.Dispose() }',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  let buffer: Buffer;
  try {
    buffer = execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, timeout: 10_000, env: { ...process.env, VEIL_BINANCE_CREDENTIAL_FILE: join(directory, 'account.dpapi') },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { throw Error('无法读取本机加密的币安 API 凭证'); }
  try {
    const data = JSON.parse(buffer.toString('utf8'));
    if (typeof data.apiKey !== 'string' || typeof data.secret !== 'string' || !data.apiKey || !data.secret) throw Error('币安凭证格式错误');
    return { apiKey: data.apiKey as string, secret: Buffer.from(data.secret as string) };
  } finally { buffer.fill(0); }
}

function parseCampaigns(value: unknown, now: number): UsdtFollowCampaign[] {
  if (!Array.isArray(value) || value.length > 250) throw Error('即时交易请求格式无效');
  const campaigns = new Set<string>();
  const safeTime = (at: number) => Number.isSafeInteger(at) && at > 0 && at <= now + 10_000;
  const validPositive = (n: number) => Number.isFinite(n) && n > 0;
  for (const row of value) {
    if (!row || !/^fish-instant-[\w-]{3,80}$/.test(row.id ?? '') || campaigns.has(row.id)
      || typeof row.source?.symbol !== 'string' || !/^[A-Za-z0-9_/.:-]{1,35}$/.test(row.source.symbol)
      || (row.source.exchange != null && typeof row.source.exchange !== 'string')
      || (row.source.market != null && typeof row.source.market !== 'string')
      || !safeTime(row.admittedAt) || !validPositive(row.notional) || !Number.isInteger(row.leverage) || row.leverage < 1 || row.leverage > 125
      || !Array.isArray(row.actions) || row.actions.length < 1 || row.actions.length > 250
      || row.actions[0]?.id !== 'open' || row.actions[0].action !== 'open') throw Error('即时交易战役格式无效');
    const ids = new Set<string>();
    for (const [index, action] of row.actions.entries()) {
      if (!action || ids.has(action.id) || !safeTime(action.at) || (index > 0 && row.actions[index - 1].at > action.at)) throw Error('即时交易动作顺序无效');
      const actionValid = action.action === 'open' ? index === 0 && action.id === 'open'
        : action.action === 'close' ? /^(close|mirror|manual-[1-9]\d*)$/.test(action.id)
        : action.action === 'add' ? /^add-[1-9]\d*$/.test(action.id) && validPositive(action.notional)
        : action.action === 'mirror' ? action.id === 'mirror' && validPositive(action.fraction) && action.fraction < 1
        : action.action === 'support-reduction' ? /^support-[1-9]\d*$/.test(action.id) && validPositive(action.fraction) && action.fraction < 1
        : action.action === 'manual-reduction' && /^manual-[1-9]\d*$/.test(action.id) && validPositive(action.fraction) && action.fraction < 1;
      if (!actionValid) throw Error('即时交易动作参数无效');
      ids.add(action.id);
    }
    campaigns.add(row.id);
  }
  return value as UsdtFollowCampaign[];
}

async function jsonBody(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if ((size += chunk.length) > bodyLimit) throw Error('即时交易请求超过大小限制');
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('即时交易请求格式无效');
  return request;
}

const digest = (value: string) => createHash('sha256').update(value).digest();
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

export function serveUsdtFollower({
  owner, token, exchange, store, mode, startedAt, allowedOrigin = origin, port = dashPort, statusFile,
}: {
  owner: string; token: string; exchange: ReturnType<typeof createUsdtExchange>;
  store: ReturnType<typeof openUsdtFollowStore>; mode: 'hedge' | 'one-way'; startedAt: number;
  allowedOrigin?: string; port?: number; statusFile?: string;
}) {
  const follower = createUsdtFollower(store, exchange, owner, mode, startedAt);
  const tokenDigest = digest(token);
  const snapshot = () => ({ connected: true, paused: follower.paused, startedAt: follower.entryAfter, statuses: follower.statuses() });
  const server = createServer({ maxHeaderSize: 4000, requestTimeout: 10_000, headersTimeout: 6000 }, (req, res) => {
    const work = async () => {
      if (req.headers.origin !== allowedOrigin ||
          req.headers.host !== '127.0.0.1:' + (server.address() as { port: number }).port ||
          req.url !== '/api/usdt-follow') {
        json(res, 403, { error: '本机执行端只接受配对页面' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Private-Network': 'true' }).end();
        return;
      }
      if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json') ||
          !timingSafeEqual(tokenDigest, digest(req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''))) {
        json(res, 401, { error: '本机配对码无效' });
        return;
      }
      const content = await jsonBody(req);
      if (content.owner !== owner) return json(res, 403, { error: '本机执行端绑定了另一个无知之幕账号' });
      if (content.command === 'pause') follower.pauseNewOrders();
      else if (content.command === 'resume') follower.resumeNewOrders();
      else if (content.command !== 'sync') throw Error('未知的实盘指令');
      follower.ingest(parseCampaigns(content.campaigns, Date.now()));
      json(res, 200, snapshot());
      void follower.tick();
    };
    void work().catch(error => {
      if (!res.headersSent) json(res, 400, { error: error instanceof SyntaxError ? '本机请求格式无效' : error instanceof Error ? error.message : '本机执行端拒绝请求' });
    });
  });
  const timer = setInterval(() => {
    void follower.tick();
    if (statusFile) {
      try { writeFileSync(statusFile, JSON.stringify(snapshot()), { mode: 0o600 }); } catch { /* API still has authoritative state. */ }
    }
  }, 1000);
  server.once('close', () => clearInterval(timer));
  server.listen(port, '127.0.0.1');
  return server;
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw Error('请指定保存币安凭证的本机目录');
  const live = process.argv.includes('--live');
  const setup = process.argv.includes('--prepare');
  const credentials = loadCredentials(directory);
  const exchange = createUsdtExchange(createUsdtRequest(credentials));
  let verified: Awaited<ReturnType<typeof exchange.account>>;
  try { verified = await exchange.account(); }
  catch (error) {
    credentials.secret.fill(0);
    if (error instanceof TypeError) throw Error('本机网络无法访问币安 U 本位账户接口');
    throw error;
  }
  if (setup) {
    const account = createHash('sha256').update(verified.id).digest('hex');
    credentials.secret.fill(0);
    console.log(JSON.stringify({ connected: true, market: 'USDT-M', mode: verified.mode, account }));
    return;
  }
  if (!live) {
    credentials.secret.fill(0);
    console.log(JSON.stringify({ connected: true, market: 'USDT-M', mode: verified.mode }));
    return;
  }
  const config = JSON.parse(readFileSync(join(directory, 'usdt-follow.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!/^[a-f0-9-]{36}$/i.test(config.owner) || !/^[0-9a-f]{64}$/i.test(config.token)
    || config.account !== createHash('sha256').update(verified.id).digest('hex')) throw Error('本机实盘配对设置与币安账户不符');
  mkdirSync(directory, { recursive: true });
  const lockPath = join(directory, 'usdt-follow.lock');
  let lock: number;
  try { lock = openSync(lockPath, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(readFileSync(lockPath, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw Error('本机执行端正在启动，请稍后重试');
    try { process.kill(pid, 0); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
      unlinkSync(lockPath);
      lock = openSync(lockPath, 'wx');
    }
    if (lock == null) throw Error('本机 U 本位执行端已运行');
  }
  writeFileSync(lock, String(process.pid));
  let store: ReturnType<typeof openUsdtFollowStore> | undefined;
  const close = () => {
    try { store?.close(); } finally { closeSync(lock); unlinkSync(lockPath); credentials.secret.fill(0); }
  };
  process.once('exit', close);
  store = openUsdtFollowStore(join(directory, 'usdt-follow.sqlite'), verified.id, config.owner);
  const server = serveUsdtFollower({ owner: config.owner, token: config.token, exchange, store, mode: verified.mode,
    startedAt: Date.now(), statusFile: join(directory, 'usdt-follow-status.json') });
  server.once('listening', () => console.log('币安 U 本位执行端已就绪，等待已配对的即时交易。'));
  server.once('error', () => { console.error('本机执行端端口不可用'); process.exit(1); });
}

if (process.argv[1] && /usdt-follow-server\.(?:mjs|ts)$/.test(process.argv[1])) {
  void main().catch(error => {
    console.error(error instanceof Error && !error.stack?.includes('readFileSync') ? error.message : '本机执行端无法启动');
    process.exitCode = 1;
  });
}
