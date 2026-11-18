import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { setGlobalProxyFromEnv } from 'node:http';
import { createUsdtExchange, createUsdtRequest } from './usdt-exchange.ts';
import { saveMacUsdtCredentials } from './usdt-macos-credentials.ts';

const directory = join(homedir(), 'Library', 'Application Support', 'VeilUSDTExecutor');
async function question(label: string, hidden = false) {
  const quiet = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const prompt = createInterface({ input: process.stdin, output: hidden ? quiet : process.stdout, terminal: true });
  if (hidden) process.stdout.write(label);
  try { return (await prompt.question(hidden ? '' : label)).trim(); }
  finally { prompt.close(); if (hidden) process.stdout.write('\n'); }
}
async function main() {
  if (process.platform !== 'darwin' || !process.stdin.isTTY) throw Error('请在 Mac 的终端中运行配置。');
  const owner = await question('无知之幕 → 即时交易 → 条件设置 → 币安实盘中显示的账号 ID：');
  if (!/^[a-f0-9-]{36}$/i.test(owner)) throw Error('网站账号 ID 格式无效，请复制该入口显示的完整账号 ID。');
  if (existsSync(join(directory, 'usdt-follow.json'))) throw Error('Mac 已配置过。为保留配对和账本，本入口不会覆盖现有设置。');
  const proxy = await question('代理 HTTP 地址（例如 http://127.0.0.1:7890；直连则留空）：');
  if (proxy && !/^https?:\/\/[^\s]+$/.test(proxy)) throw Error('代理地址应使用 http:// 或 https://。');
  setGlobalProxyFromEnv({ HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY: '127.0.0.1,localhost' });
  const apiKey = await question('币安 API Key（输入不显示）：', true);
  const secret = await question('币安 Secret Key（输入不显示）：', true);
  if (!/^[a-zA-Z0-9]{16,256}$/.test(apiKey) || !/^[a-zA-Z0-9]{16,256}$/.test(secret)) throw Error('API Key 或 Secret 格式无效。');
  const credentials = { apiKey, secret: Buffer.from(secret) };
  try {
    const verified = await createUsdtExchange(createUsdtRequest(credentials)).account();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    saveMacUsdtCredentials(directory, apiKey, secret);
    const token = randomBytes(32).toString('hex');
    writeFileSync(join(directory, 'proxy.json'), JSON.stringify({ proxy }), { mode: 0o600, flag: 'wx' });
    writeFileSync(join(directory, 'usdt-follow.json'), JSON.stringify({ owner, token, account: createHash('sha256').update(verified.id).digest('hex') }), { mode: 0o600, flag: 'wx' });
    console.log('账户只读验证通过，凭证已存入 Mac 钥匙串。配置过程没有下单。');
    console.log('本机配对码（仅粘贴到本机无知之幕的实盘配对入口）：\n' + token);
  } finally { credentials.secret.fill(0); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Mac 配置失败'); process.exitCode = 1; });
