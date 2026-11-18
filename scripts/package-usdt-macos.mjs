import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const out = resolve(process.argv[2] ?? 'work/veil-usdt-macos');
await mkdir(out, { recursive: true });
for (const [name, entry] of Object.entries({ 'usdt-follow-server': 'usdt-follow-server', 'macos-setup': 'usdt-macos-setup', 'macos-preload': 'usdt-macos-preload' })) {
  await build({ entryPoints: [`scripts/${entry}.ts`], outfile: join(out, name + '.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'warning' });
}
await copyFile('scripts/usdt-macos.command', join(out, '启动Mac执行器.command'));
await copyFile('scripts/usdt-macos-readme.txt', join(out, '先读我.txt'));
await writeFile(join(out, 'version.json'), JSON.stringify({ version: 'macos-executor-20261118-v1', node: '24.22.2', source: '753', executionSafety: 2 }) + '\n');
console.log('Mac 执行器已打包：' + out);
