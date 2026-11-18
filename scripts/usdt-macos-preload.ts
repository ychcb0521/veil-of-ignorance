import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setGlobalProxyFromEnv } from 'node:http';
import { readMacUsdtCredentials } from './usdt-macos-credentials.ts';
import { createUsdtRequest } from './usdt-exchange.ts';

if (process.platform !== 'darwin') throw Error('此启动入口用于 Mac。');
const directory = join(homedir(), 'Library', 'Application Support', 'VeilUSDTExecutor');
const { proxy } = JSON.parse(readFileSync(join(directory, 'proxy.json'), 'utf8'));
setGlobalProxyFromEnv({ HTTPS_PROXY: proxy, HTTP_PROXY: proxy, NO_PROXY: '127.0.0.1,localhost' });
if (process.argv.includes('--live') && !existsSync(join(directory, 'usdt-follow.sqlite'))) {
  const credentials = readMacUsdtCredentials(directory);
  try {
    const positions = await createUsdtRequest(credentials)('GET', '/fapi/v3/positionRisk');
    if (!Array.isArray(positions) || positions.some(row => Number(row.positionAmt) !== 0)) {
      throw Error('账户仍有持仓，Mac 缺少原执行账本。请先完成 Windows → Mac 的账本交接，再启用实盘；当前保持只读。');
    }
  } finally { credentials.secret.fill(0); }
}
