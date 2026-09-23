#!/usr/bin/env node
/**
 * 生成 src/data/binanceLeverageTiers.json —— 币安合约「杠杆与保证金」分层的离线快照。
 *
 * 用法：
 *   node scripts/update-binance-leverage-tiers.mjs --from <快照目录>
 *       读目录里已保存的公开响应：um_brackets.json、cm_brackets.json、dapi_ei.json
 *   node scripts/update-binance-leverage-tiers.mjs
 *       直接请求下面三个公开 GET 地址（不需要登录、不带签名）
 *
 * 可选参数：
 *   --out <文件>          输出路径，缺省 src/data/binanceLeverageTiers.json
 *   --bapi-host <origin>  分层数据的站点，缺省 https://www.binance.info（调研时唯一能访问到的镜像）；
 *                         可换成 https://www.binance.com
 *   --fetched-at <ISO>    覆盖快照时间（缺省：在线请求取当前时间；--from 取响应里的服务器时间）
 *   --check               只校验并与现有输出比对，不写文件；不一致时退出码 1
 *
 * 为什么是离线快照、不是运行时请求：
 *   · 官方分层接口（/fapi/v1/leverageBracket、/dapi/v2/leverageBracket）是签名接口，本项目不调用；
 *   · 网页用的 bapi 公开接口不带 CORS 头，浏览器里的应用读不到；
 *   · 分层会随时间调整，快照写明日期，回放更早的日期时用的也是这一份（不是历史分层）。
 *
 * 输出（字典编码，同样的分层表只存一份）：
 *   {
 *     fetchedAt, sources,
 *     usdm:  { tables: [[[floor, cap, maxLev, mmr, cum], ...], ...], symbols: { KAITOUSDT: 表下标 } },
 *     coinm: { tables, symbols: { BTCUSD_PERP: 表下标 }, contractSizeUsd: { BTCUSD: 100, ... } },
 *     fallbackUsdmTable: 表下标
 *   }
 *   U 本位的 floor / cap / cum 以 USDT 计（名义 = 数量 × 标记价）；
 *   币本位的 floor / cap / cum 以**币**计（名义 = 张数 × 面值 ÷ 标记价）。
 *   fallbackUsdmTable 是使用最多的那张 U 本位表，快照里查不到的标的暂按它处理。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'src/data/binanceLeverageTiers.json');
const DEFAULT_BAPI_HOST = 'https://www.binance.info';
const USDM_BRACKETS_PATH = '/bapi/futures/v1/friendly/future/common/brackets';
const COINM_BRACKETS_PATH = '/bapi/futures/v1/friendly/delivery/common/brackets';
const COINM_EXCHANGE_INFO_URL = 'https://dapi.binance.com/dapi/v1/exchangeInfo';

function parseArgs(argv) {
  const args = { from: null, out: DEFAULT_OUT, bapiHost: DEFAULT_BAPI_HOST, fetchedAt: null, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`${a} 缺少参数值`);
      return v;
    };
    if (a === '--from') args.from = path.resolve(next());
    else if (a === '--out') args.out = path.resolve(next());
    else if (a === '--bapi-host') args.bapiHost = next().replace(/\/+$/, '');
    else if (a === '--fetched-at') args.fetchedAt = new Date(next()).toISOString();
    else if (a === '--check') args.check = true;
    else if (a === '--help' || a === '-h') {
      console.log('node scripts/update-binance-leverage-tiers.mjs [--from <dir>] [--out <file>] [--bapi-host <origin>] [--fetched-at <ISO>] [--check]');
      process.exit(0);
    } else throw new Error(`未知参数：${a}`);
  }
  return args;
}

/** 只允许公开 GET：任何签名接口 / 带签名参数的地址一律拒绝。 */
function assertPublicUrl(url) {
  if (/signature=|leverageBracket|\/fapi\/v\d+\/account|\/dapi\/v\d+\/account/i.test(url)) {
    throw new Error(`拒绝请求非公开接口：${url}`);
  }
}

async function fetchJson(url) {
  assertPublicUrl(url);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function bracketList(payload, label) {
  const list = payload?.data?.brackets;
  if (payload?.success === false || !Array.isArray(list) || list.length === 0) {
    throw new Error(`${label}：响应里没有 data.brackets`);
  }
  return list;
}

const num = (v, what) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${what} 不是有限数：${v}`);
  return n;
};

/** 一个标的的分层 → [[floor, cap, maxLev, mmr, cum], ...]，顺带做结构校验。 */
function encodeTiers(entry, label, problems) {
  const rows = [...(entry.riskBrackets ?? [])].sort((a, b) => a.bracketSeq - b.bracketSeq);
  if (rows.length === 0) throw new Error(`${label} ${entry.symbol}：没有分层`);
  const out = rows.map((t, i) => {
    const where = `${label} ${entry.symbol} 第 ${i + 1} 档`;
    if (t.bracketSeq !== i + 1) throw new Error(`${where}：bracketSeq=${t.bracketSeq}`);
    const row = [
      num(t.bracketNotionalFloor, `${where} floor`),
      num(t.bracketNotionalCap, `${where} cap`),
      num(t.maxOpenPosLeverage, `${where} maxOpenPosLeverage`),
      num(t.bracketMaintenanceMarginRate, `${where} mmr`),
      num(t.cumFastMaintenanceAmount, `${where} cum`),
    ];
    if (!(row[1] > row[0])) throw new Error(`${where}：cap ≤ floor`);
    if (!(row[2] >= 1) || !Number.isInteger(row[2])) throw new Error(`${where}：maxOpenPosLeverage=${row[2]}`);
    if (!(row[3] > 0 && row[3] < 1)) throw new Error(`${where}：mmr=${row[3]}`);
    return row;
  });
  if (out[0][0] !== 0) throw new Error(`${label} ${entry.symbol}：第 1 档不是从 0 开始`);
  for (let i = 1; i < out.length; i++) {
    const [prev, cur] = [out[i - 1], out[i]];
    const where = `${label} ${entry.symbol} 第 ${i + 1} 档`;
    if (cur[0] !== prev[1]) throw new Error(`${where}：floor ${cur[0]} ≠ 上一档 cap ${prev[1]}`);
    if (cur[2] > prev[2]) problems.push(`${where}：最高杠杆比上一档高（${cur[2]} > ${prev[2]}）`);
    if (cur[3] < prev[3]) problems.push(`${where}：维持保证金率比上一档低`);
    // 速算扣除额（cum）必须让维持保证金在档位边界上连续：floor×mmr₍ₙ₋₁₎ − cum₍ₙ₋₁₎ = floor×mmrₙ − cumₙ
    const left = cur[0] * prev[3] - prev[4];
    const right = cur[0] * cur[3] - cur[4];
    if (Math.abs(left - right) > Math.max(1e-6, Math.abs(left) * 1e-9)) {
      problems.push(`${where}：维持保证金在边界不连续（${left} vs ${right}）`);
    }
  }
  return out;
}

/** 字典编码：同样的分层表只存一份；表按使用次数降序、再按首个标的名排序，保证输出稳定。 */
function dictionaryEncode(entries, label, problems) {
  const byKey = new Map();
  const sorted = [...entries].sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  const seen = new Set();
  for (const entry of sorted) {
    if (seen.has(entry.symbol)) throw new Error(`${label}：重复的标的 ${entry.symbol}`);
    seen.add(entry.symbol);
    const tiers = encodeTiers(entry, label, problems);
    const key = JSON.stringify(tiers);
    const slot = byKey.get(key) ?? { tiers, symbols: [] };
    slot.symbols.push(entry.symbol);
    byKey.set(key, slot);
  }
  const slots = [...byKey.values()].sort((a, b) =>
    (b.symbols.length - a.symbols.length) || (a.symbols[0] < b.symbols[0] ? -1 : 1));
  const symbols = {};
  slots.forEach((slot, index) => { for (const s of slot.symbols) symbols[s] = index; });
  const orderedSymbols = Object.fromEntries(Object.keys(symbols).sort().map(s => [s, symbols[s]]));
  return { tables: slots.map(s => s.tiers), symbols: orderedSymbols, usage: slots.map(s => s.symbols.length) };
}

function contractSizes(exchangeInfo) {
  const out = {};
  const symbols = exchangeInfo?.symbols;
  if (!Array.isArray(symbols) || symbols.length === 0) throw new Error('dapi exchangeInfo：没有 symbols');
  for (const s of symbols) {
    const size = num(s.contractSize, `${s.symbol} contractSize`);
    const pair = String(s.pair || '').toUpperCase();
    if (!pair) continue;
    if (out[pair] != null && out[pair] !== size) throw new Error(`${pair}：不同交割期的面值不一致（${out[pair]} vs ${size}）`);
    out[pair] = size;
  }
  return Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]));
}

/** 从响应里的服务器时间推快照时刻：bapi 的 data.version 以毫秒时间戳开头，dapi 带 serverTime。 */
function serverTimeOf(um, ei) {
  const candidates = [];
  const v = Number(String(um?.data?.version ?? '').split('_')[0]);
  if (Number.isFinite(v) && v > 1e12) candidates.push(v);
  const t = Number(ei?.serverTime);
  if (Number.isFinite(t) && t > 1e12) candidates.push(t);
  return candidates.length > 0 ? new Date(Math.max(...candidates)).toISOString() : null;
}

/** 一行一张表 / 一行一个标的：刷新快照时 diff 可读，体积只多几 KB。 */
function formatOutput(doc) {
  const tables = (list) => list.map(t => `      ${JSON.stringify(t)}`).join(',\n');
  const dict = (obj, indent) => Object.entries(obj).map(([k, v]) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  return [
    '{',
    `  "fetchedAt": ${JSON.stringify(doc.fetchedAt)},`,
    `  "sources": ${JSON.stringify(doc.sources)},`,
    '  "usdm": {',
    '    "tables": [',
    tables(doc.usdm.tables),
    '    ],',
    '    "symbols": {',
    dict(doc.usdm.symbols, '      '),
    '    }',
    '  },',
    '  "coinm": {',
    '    "tables": [',
    tables(doc.coinm.tables),
    '    ],',
    '    "symbols": {',
    dict(doc.coinm.symbols, '      '),
    '    },',
    `    "contractSizeUsd": ${JSON.stringify(doc.coinm.contractSizeUsd)}`,
    '  },',
    `  "fallbackUsdmTable": ${doc.fallbackUsdmTable}`,
    '}',
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const usdmUrl = `${args.bapiHost}${USDM_BRACKETS_PATH}`;
  const coinmUrl = `${args.bapiHost}${COINM_BRACKETS_PATH}`;

  let um; let cm; let ei; let fetchedAt;
  if (args.from) {
    const file = (name) => {
      const p = path.join(args.from, name);
      if (!existsSync(p)) throw new Error(`快照目录缺少 ${name}：${p}`);
      return p;
    };
    [um, cm, ei] = await Promise.all([
      readJson(file('um_brackets.json')),
      readJson(file('cm_brackets.json')),
      readJson(file('dapi_ei.json')),
    ]);
    fetchedAt = args.fetchedAt ?? serverTimeOf(um, ei);
    if (!fetchedAt) throw new Error('快照里读不到服务器时间，请用 --fetched-at 指定');
  } else {
    [um, cm, ei] = await Promise.all([fetchJson(usdmUrl), fetchJson(coinmUrl), fetchJson(COINM_EXCHANGE_INFO_URL)]);
    fetchedAt = args.fetchedAt ?? new Date().toISOString();
  }

  const problems = [];
  const usdm = dictionaryEncode(bracketList(um, 'U 本位'), 'U 本位', problems);
  const coinm = dictionaryEncode(bracketList(cm, '币本位'), '币本位', problems);
  const sizes = contractSizes(ei);
  // 每个币本位永续都必须查得到面值，否则张数与名义之间没有换算。
  for (const s of Object.keys(coinm.symbols)) {
    if (!s.endsWith('_PERP')) continue;
    const pair = s.slice(0, -'_PERP'.length);
    if (sizes[pair] == null) problems.push(`币本位 ${s}：exchangeInfo 里没有 ${pair} 的面值`);
  }
  if (problems.length > 0) {
    console.error(`校验失败 ${problems.length} 处：\n  ${problems.slice(0, 30).join('\n  ')}`);
    process.exit(1);
  }

  const doc = {
    fetchedAt,
    sources: {
      usdmBrackets: usdmUrl,
      coinmBrackets: coinmUrl,
      coinmExchangeInfo: COINM_EXCHANGE_INFO_URL,
      usdmVersion: um?.data?.version ?? null,
      mode: args.from ? 'saved-snapshot' : 'live-fetch',
    },
    usdm: { tables: usdm.tables, symbols: usdm.symbols },
    coinm: { tables: coinm.tables, symbols: coinm.symbols, contractSizeUsd: sizes },
    fallbackUsdmTable: 0,
  };
  const text = formatOutput(doc);
  // 自检：格式化后的文本必须能原样解析回同一份数据。
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(doc)) throw new Error('输出格式化后与数据不一致');

  const boundaries = (enc) => Object.values(enc.symbols).reduce((s, i) => s + enc.tables[i].length - 1, 0);
  const raw = Buffer.byteLength(text);
  const gz = gzipSync(text, { level: 9 }).length;
  console.log([
    `快照时间     ${fetchedAt}`,
    `U 本位       ${Object.keys(usdm.symbols).length} 个标的 / ${usdm.tables.length} 张表 / ${boundaries(usdm)} 个档位边界`,
    `币本位       ${Object.keys(coinm.symbols).length} 个标的 / ${coinm.tables.length} 张表 / ${boundaries(coinm)} 个档位边界`,
    `面值         ${Object.keys(sizes).length} 个交易对`,
    `兜底表       #0，${usdm.usage[0]} 个标的使用（第二多的表 ${usdm.usage[1] ?? 0} 个）`,
    `体积         ${raw} 字节，gzip ${gz} 字节`,
  ].join('\n'));

  if (args.check) {
    const current = existsSync(args.out) ? await readFile(args.out, 'utf8') : null;
    if (current !== text) {
      console.error(`${path.relative(ROOT, args.out)} 与重新生成的结果不一致`);
      process.exit(1);
    }
    console.log('与现有文件一致');
    return;
  }
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, text);
  console.log(`已写入 ${path.relative(ROOT, args.out)}`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
