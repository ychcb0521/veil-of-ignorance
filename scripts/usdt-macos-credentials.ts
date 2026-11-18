import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const service = 'app.veil-of-ignorance.usdt-executor';
const identity = (directory: string) => createHash('sha256').update(resolve(directory)).digest('hex');
type Run = (args: string[], input?: Buffer) => Buffer;
const security: Run = (args, input) => execFileSync('/usr/bin/security', args, {
  input, stdio: ['pipe', 'pipe', 'ignore'], timeout: 30_000,
});
export function readMacUsdtCredentials(directory: string, run: Run = security) {
  let buffer: Buffer | undefined;
  try {
    buffer = run(['find-generic-password', '-s', service, '-a', identity(directory), '-w']);
    const data = JSON.parse(Buffer.from(buffer.toString('utf8').trim(), 'base64').toString('utf8'));
    if (!/^[a-zA-Z0-9]{16,256}$/.test(data.apiKey) || !/^[a-zA-Z0-9]{16,256}$/.test(data.secret)) throw Error();
    return { apiKey: data.apiKey as string, secret: Buffer.from(data.secret as string) };
  } catch { throw Error('无法读取 Mac 钥匙串中的币安凭证，请先配置并允许本机钥匙串访问。'); }
  finally { buffer?.fill(0); }
}
export function saveMacUsdtCredentials(directory: string, apiKey: string, secret: string, run: Run = security) {
  if (!/^[a-zA-Z0-9]{16,256}$/.test(apiKey) || !/^[a-zA-Z0-9]{16,256}$/.test(secret)) throw Error('API Key 或 Secret 格式无效。');
  // Fixed tokens and base64 contain no interpreter metacharacters. Secrets use stdin, never argv.
  const payload = Buffer.from(JSON.stringify({ apiKey, secret })).toString('base64');
  const input = Buffer.from(`add-generic-password -U -s ${service} -a ${identity(directory)} -w ${payload}\n`);
  try {
    run(['-i', '-q'], input);
    const saved = readMacUsdtCredentials(directory, run);
    try { if (saved.apiKey !== apiKey || saved.secret.toString() !== secret) throw Error(); }
    finally { saved.secret.fill(0); }
  } catch { throw Error('Mac 钥匙串保存未通过回读核对，请重试。'); }
  finally { input.fill(0); }
}
