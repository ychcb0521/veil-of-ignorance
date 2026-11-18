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
// The server enforces durable handoff ownership even for a flat account.
