#!/usr/bin/env node
/**
 * 发布不中断：新版本的产物里继续保留最近几版线上的代码文件。
 *
 * 为什么：单页应用打开后只加载一次入口；之后切页面时才去取那一页的代码块（/assets/页面-哈希.js）。
 * 每次部署后旧哈希的文件就从站点上消失了——已经开着的页面一切页面就「页面所需资源未能加载」，只能刷新，
 * 正在做的事被打断。Vercel 的同类功能（Skew Protection）不在免费套餐里，这里自己做：
 *
 *   1. 读线上那一版的 /asset-history.json（第一次没有时，从线上入口页顺着引用爬出全部代码文件）；
 *   2. 把最近几版（至少 3 版；3 天内最多 15 版）还在引用、本次构建没有的文件原样下载进 dist/assets；
 *   3. 写出本次的 /asset-history.json 和 /version.json（页面靠它得知「有新版本」，见 src/lib/versionWatch.ts）。
 *
 * 只从本项目自己的正式域名下载，文件名白名单校验；任何一步失败只告警、不让构建失败——
 * 最坏情况等同于没有这层保护，绝不挡住发布。
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist', ASSETS = join(DIST, 'assets');
const KEEP_MIN_BUILDS = 3, KEEP_MAX_BUILDS = 15, KEEP_MS = 3 * 24 * 3600_000;
const SAFE_NAME = /^[A-Za-z0-9_.-]+\.(?:js|mjs|css|wasm|woff2?|ttf|png|svg|jpe?g|webp|gif|ico|json)$/;
const REF = /assets\/([A-Za-z0-9_.-]+\.(?:js|mjs|css|wasm|woff2?|ttf|png|svg|jpe?g|webp|gif|ico|json))/g;
/** 同目录的懒加载块在代码里写成相对路径 import("./页面-哈希.js")。 */
const SIBLING = /["'`]\.\/([A-Za-z0-9_.-]+\.(?:js|mjs|css))["'`]/g;
const now = Date.now();

const warn = message => console.warn(`[retain-assets] ${message}`);
const host = (process.env.RETAIN_ASSETS_FROM || process.env.VERCEL_PROJECT_PRODUCTION_URL || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const origin = host ? `https://${host}` : '';

async function get(url, timeoutMs = 15_000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal, headers: { 'cache-control': 'no-cache' } }); }
  finally { clearTimeout(timer); }
}
/** 站点对不存在的路径会回首页 HTML（SPA 回退）；把它当成「没有」。 */
const isHtml = response => (response.headers.get('content-type') || '').includes('text/html');

function stampOf() {
  try { return readFileSync('src/lib/buildStamp.ts', 'utf8').match(/veil-build:[0-9-]+/)?.[0] ?? null; } catch { return null; }
}
function entryOf(html) {
  return html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1] ?? html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1] ?? null;
}

/** 第一次（线上还没有历史清单）：从入口页出发，顺着代码里的 assets/ 引用把那一版的全部文件找出来。 */
async function crawlLive() {
  const response = await get(`${origin}/`);
  if (!response.ok) throw new Error(`入口页 ${response.status}`);
  const html = await response.text(), seen = new Set(), queue = [...html.matchAll(REF)].map(m => m[1]);
  while (queue.length && seen.size < 2000) {
    const name = queue.shift();
    if (seen.has(name) || !SAFE_NAME.test(name)) continue;
    seen.add(name);
    if (!/\.(?:js|mjs|css)$/.test(name)) continue;
    const file = await get(`${origin}/assets/${name}`);
    if (!file.ok || isHtml(file)) { seen.delete(name); continue; }
    const text = await file.text();
    for (const m of [...text.matchAll(REF), ...text.matchAll(SIBLING)]) if (!seen.has(m[1])) queue.push(m[1]);
  }
  return { stamp: 'live-before-history', entry: entryOf(html), at: now - 1, files: [...seen].sort() };
}

async function previousBuilds() {
  if (!origin) { warn('没有正式域名（VERCEL_PROJECT_PRODUCTION_URL），只记录本次版本'); return []; }
  try {
    const response = await get(`${origin}/asset-history.json`);
    if (response.ok && !isHtml(response)) {
      const history = await response.json();
      if (history?.version === 1 && Array.isArray(history.builds)) return history.builds.filter(b => b && Array.isArray(b.files) && Number.isFinite(b.at));
    }
  } catch (error) { warn(`读取线上历史失败：${error.message}`); }
  try { return [await crawlLive()]; } catch (error) { warn(`从线上入口页收集旧文件失败：${error.message}`); return []; }
}

async function download(name) {
  const target = join(ASSETS, name);
  if (existsSync(target)) return true;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await get(`${origin}/assets/${name}`, 30_000);
      if (!response.ok || isHtml(response)) return false;
      writeFileSync(target, Buffer.from(await response.arrayBuffer()));
      return true;
    } catch { /* 再试一次 */ }
  }
  return false;
}

async function main() {
  if (!existsSync(ASSETS)) { warn('没有 dist/assets，跳过'); return; }
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const currentFiles = readdirSync(ASSETS).filter(name => SAFE_NAME.test(name)).sort();
  const current = {
    stamp: stampOf(), entry: entryOf(html), commit: process.env.VERCEL_GIT_COMMIT_SHA || null, at: now,
    id: createHash('sha256').update(html).digest('hex').slice(0, 16), files: currentFiles,
  };
  const previous = (await previousBuilds()).filter(b => b.entry !== current.entry).sort((a, b) => b.at - a.at);
  const kept = previous.filter((b, i) => i < KEEP_MIN_BUILDS - 1 || (i < KEEP_MAX_BUILDS - 1 && now - b.at <= KEEP_MS));
  const have = new Set(currentFiles), wanted = [...new Set(kept.flatMap(b => b.files))].filter(name => SAFE_NAME.test(name) && !have.has(name));
  let copied = 0, missing = 0;
  for (let i = 0; i < wanted.length; i += 8) {
    const results = await Promise.all(wanted.slice(i, i + 8).map(download));
    results.forEach((ok, j) => { if (ok) { have.add(wanted[i + j]); copied += 1; } else missing += 1; });
  }
  const builds = [current, ...kept.map(b => ({ ...b, files: b.files.filter(name => have.has(name)) }))];
  writeFileSync(join(DIST, 'asset-history.json'), JSON.stringify({ version: 1, builds }));
  writeFileSync(join(DIST, 'version.json'), JSON.stringify({ version: 1, id: current.id, entry: current.entry, stamp: current.stamp, commit: current.commit, builtAt: new Date(now).toISOString() }));
  console.log(`[retain-assets] 本次 ${currentFiles.length} 个文件；保留前 ${kept.length} 版的 ${copied} 个旧文件${missing ? `，${missing} 个已取不到` : ''}`);
}

main().catch(error => warn(`跳过：${error.message}`));
