#!/usr/bin/env node
/**
 * 重新生成冻结的持仓监测旧引擎 src/lib/fish/legacy/qualityEngine20261031.js（只用于核对来源，平时不要运行）。
 *
 *   node scripts/build-legacy-quality-engine.mjs            # 生成到临时目录并与仓库里的文件逐字节比较
 *   node scripts/build-legacy-quality-engine.mjs --write    # 覆盖仓库里的文件（只有确认要重建时才用）
 *
 * 做法：在临时 git worktree 里检出 bb003e0c，把 quality.ts 的 evaluateQualitySample 与加仓说明函数用 esbuild 打成一个 ES 模块。
 * 源码一律按「无副作用」处理，只留下引擎真正用到的代码（不会带进账号、存储、Supabase 客户端）。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';

const COMMIT = 'bb003e0c';
/** 文件头与正文的分界；src/lib/fish/legacy/__tests__ 按它取出正文核对 SHA-256。 */
const BODY_MARK = '// ===== 以下为打包正文（勿改）=====\n';
const header = sha => `/* eslint-disable */
// @ts-nocheck
/**
 * 【冻结文件，禁止修改】持仓监测 2026-10-31 旧引擎（quality-engine-2026-10-31）。
 *
 * 来源：提交 ${COMMIT}（2026-10-31 00:20）的 src/lib/fish/quality.ts 等源文件，由 scripts/build-legacy-quality-engine.mjs 原样打包
 * （esbuild，只保留引擎实际用到的代码；不含网络、存储、账号）。重新运行该脚本必须逐字节得到本文件。
 * 用途：2026-11-03 用户要求复原「卖出算法组合2」10-31 那次运行（RAVE +10027.38，b=2005.48）。
 *   11-01 起加仓改成箱体位置、删除入场距离、涨幅门槛改为相对成本线 S，当前引擎算不出那套结果；用这份旧引擎重跑，15 笔逐位一致。
 * K 线仍由当前代码的加载器提供（同一套限频与缓存）。
 * 正文 SHA-256：${sha}
 */
`;
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const target = path.join(repo, 'src/lib/fish/legacy/qualityEngine20261031.js');
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'veil-legacy-engine-')));
const tree = path.join(dir, 'tree');
execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', tree, COMMIT], { stdio: 'inherit' });
try {
  fs.writeFileSync(path.join(tree, 'legacy-entry.ts'), [
    "export { evaluateQualitySample } from '@/lib/fish/quality';",
    "export { additionLabel, qualityAdditionConditions, qualityAdditionAtrSettings } from '@/lib/fish/qualityAddition';", ''].join('\n'));
  const exists = p => fs.existsSync(p) && fs.statSync(p).isFile();
  const pure = { name: 'pure-src', setup(build) {
    build.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, a => ({ path: a.path, external: true }));
    // 「@/」与相对路径一律解析成同一个绝对路径并标为无副作用（只标一部分时，结果取决于先解析到哪条导入，打包不稳定）
    const resolve = base => { for (const ext of ['.ts', '.tsx', '/index.ts', '.json', '']) { const p = base + ext; if (exists(p)) return { path: p, sideEffects: false }; } return undefined; };
    build.onResolve({ filter: /^@\// }, a => resolve(path.join(tree, 'src', a.path.slice(2))));
    build.onResolve({ filter: /^\.\.?\// }, a => a.importer.startsWith(path.join(tree, 'src')) || a.importer.startsWith(tree) ? resolve(path.resolve(path.dirname(a.importer), a.path)) : undefined);
  } };
  const out = path.join(dir, 'bundle.js');
  const result = await esbuild.build({ entryPoints: ['legacy-entry.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2020',
    plugins: [pure], outfile: out, absWorkingDir: tree, metafile: true, logLevel: 'warning', legalComments: 'none', charset: 'utf8', nodePaths: [path.join(repo, 'node_modules')] });
  const imports = Object.values(result.metafile.outputs)[0].imports;
  if (imports.length) throw new Error(`旧引擎不应有外部依赖：${JSON.stringify(imports)}`);
  const body = fs.readFileSync(out, 'utf8');
  const sha = createHash('sha256').update(body).digest('hex');
  const file = header(sha) + BODY_MARK + body;
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  console.log(`正文 SHA-256：${sha}`);
  console.log(current === file ? '与仓库里的文件逐字节一致' : '与仓库里的文件不同');
  if (process.argv.includes('--write')) fs.writeFileSync(target, file);
} finally {
  execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', tree], { stdio: 'inherit' });
  fs.rmSync(dir, { recursive: true, force: true });
}
