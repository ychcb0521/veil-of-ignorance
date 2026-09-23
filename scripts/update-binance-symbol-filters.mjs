#!/usr/bin/env node
/**
 * 生成 src/data/binanceSymbolFilters.json —— 币安合约「单笔数量上限」的离线快照。
 *
 * 用法：
 *   node scripts/update-binance-symbol-filters.mjs
 *       直接请求下面两个公开 GET 地址（不需要登录、不带签名）
 *   node scripts/update-binance-symbol-filters.mjs --from <快照目录>
 *       读目录里已保存的公开响应：fapi_ei.json、dapi_ei.json
 *
 * 可选参数：
 *   --out <文件>          输出路径，缺省 src/data/binanceSymbolFilters.json
 *   --fetched-at <ISO>    覆盖快照时间（缺省：在线请求取当前时间；--from 取响应里的服务器时间）
 *   --include-settling    连已下架、正在结算（SETTLING）的永续也收进来（缺省只收 TRADING）
 *   --check               只校验并与现有输出比对数据（列名与每个标的的一行，不比快照时间与来源方式），不写文件；不一致时退出码 1
 *
 * 来源（exchangeInfo 的 symbols[].filters）：
 *   · MARKET_LOT_SIZE：单笔**市价单**的数量上下限与步长。超过 maxQty 币安拒单
 *     （-4005 QTY_GREATER_THAN_MAX_QTY「Quantity greater than max quantity」）。
 *   · LOT_SIZE：单笔**限价单**的数量上下限与步长（上限比市价单宽得多）。
 *   · liquidationFee：强平清算费率，先存着备用，**本次不参与任何计算**。
 * 数量单位：U 本位（fapi）以币计；币本位（dapi）以张计（面值见 contractSize，杠杆分层快照里也有）。
 *
 * 只收永续：U 本位 contractType 为 PERPETUAL 或 TRADIFI_PERPETUAL，币本位为 PERPETUAL；状态缺省只收 TRADING。
 * 交割合约不收——模拟器只交易永续。
 *
 * 输出（一行一个标的，刷新快照时 diff 可读）：
 *   {
 *     fetchedAt, sources,
 *     columns: ["marketMaxQty", "marketMinQty", "marketStepSize", "limitMaxQty", "limitMinQty", "limitStepSize", "liquidationFee"],
 *     usdm:  { "KAITOUSDT": [200000, 0.1, 0.1, 2000000, 0.1, 0.1, 0.015], ... },
 *     coinm: { "BTCUSD_PERP": [60000, 1, 1, 1000000, 1, 1, 0.015], ... }
 *   }
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(ROOT, 'src/data/binanceSymbolFilters.json');
const USDM_EXCHANGE_INFO_URL = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
const COINM_EXCHANGE_INFO_URL = 'https://dapi.binance.com/dapi/v1/exchangeInfo';
const COLUMNS = ['marketMaxQty', 'marketMinQty', 'marketStepSize', 'limitMaxQty', 'limitMinQty', 'limitStepSize', 'liquidationFee'];
const USDM_PERPETUAL_TYPES = new Set(['PERPETUAL', 'TRADIFI_PERPETUAL']);

function parseArgs(argv) {
  const args = { from: null, out: DEFAULT_OUT, fetchedAt: null, check: false, includeSettling: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`${a} 缺少参数值`);
      return v;
    };
    if (a === '--from') args.from = path.resolve(next());
    else if (a === '--out') args.out = path.resolve(next());
    else if (a === '--fetched-at') args.fetchedAt = new Date(next()).toISOString();
    else if (a === '--check') args.check = true;
    else if (a === '--include-settling') args.includeSettling = true;
    else if (a === '--help' || a === '-h') {
      console.log('node scripts/update-binance-symbol-filters.mjs [--from <dir>] [--out <file>] [--fetched-at <ISO>] [--include-settling] [--check]');
      process.exit(0);
    } else throw new Error(`未知参数：${a}`);
  }
  return args;
}

/** 只允许公开 GET：任何签名接口 / 带签名参数的地址一律拒绝。 */
function assertPublicUrl(url) {
  if (/signature=|\/account|\/order|leverageBracket/i.test(url)) {
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

const num = (v, what) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${what} 不是有限数：${v}`);
  return n;
};

/** 一个标的的一行：[市价 max, min, step, 限价 max, min, step, 强平清算费率]，顺带做结构校验。 */
function encodeSymbol(s, label, problems) {
  const where = `${label} ${s.symbol}`;
  const filter = (type) => {
    const f = (s.filters ?? []).find(x => x?.filterType === type);
    if (!f) throw new Error(`${where}：没有 ${type}`);
    return [num(f.maxQty, `${where} ${type}.maxQty`), num(f.minQty, `${where} ${type}.minQty`), num(f.stepSize, `${where} ${type}.stepSize`)];
  };
  const market = filter('MARKET_LOT_SIZE');
  const limit = filter('LOT_SIZE');
  const liquidationFee = num(s.liquidationFee, `${where} liquidationFee`);
  for (const [name, [max, min, step]] of [['MARKET_LOT_SIZE', market], ['LOT_SIZE', limit]]) {
    if (!(max > 0) || !(min > 0) || !(step > 0)) problems.push(`${where} ${name}：maxQty / minQty / stepSize 必须为正（${max} / ${min} / ${step}）`);
    if (!(max >= min)) problems.push(`${where} ${name}：maxQty ${max} < minQty ${min}`);
  }
  // 市价上限比限价上限宽的合约没见过；真出现了先停下来看一眼，别悄悄收进来
  if (market[0] > limit[0]) problems.push(`${where}：市价单上限 ${market[0]} 高于限价单上限 ${limit[0]}`);
  if (!(liquidationFee >= 0 && liquidationFee < 1)) problems.push(`${where}：liquidationFee=${liquidationFee}`);
  return [...market, ...limit, liquidationFee];
}

function collect(exchangeInfo, label, { statusKey, types, statuses }, problems) {
  const symbols = exchangeInfo?.symbols;
  if (!Array.isArray(symbols) || symbols.length === 0) throw new Error(`${label} exchangeInfo：没有 symbols`);
  const out = {};
  for (const s of symbols) {
    if (!types.has(String(s.contractType))) continue;
    if (!statuses.has(String(s[statusKey]))) continue;
    const symbol = String(s.symbol || '').toUpperCase();
    if (!symbol) continue;
    if (out[symbol]) throw new Error(`${label}：重复的标的 ${symbol}`);
    out[symbol] = encodeSymbol(s, label, problems);
  }
  if (Object.keys(out).length === 0) throw new Error(`${label}：一个永续都没收到`);
  return Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]]));
}

/** 取两个响应里较晚的服务器时间当快照时刻。 */
function serverTimeOf(...payloads) {
  const times = payloads.map(p => Number(p?.serverTime)).filter(t => Number.isFinite(t) && t > 1e12);
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

/** 一行一个标的：刷新快照时 diff 可读。 */
function formatOutput(doc) {
  const dict = (obj) => Object.entries(obj).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  return [
    '{',
    `  "fetchedAt": ${JSON.stringify(doc.fetchedAt)},`,
    `  "sources": ${JSON.stringify(doc.sources)},`,
    `  "columns": ${JSON.stringify(doc.columns)},`,
    '  "usdm": {',
    dict(doc.usdm),
    '  },',
    '  "coinm": {',
    dict(doc.coinm),
    '  }',
    '}',
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let fapi; let dapi; let fetchedAt;
  if (args.from) {
    const file = (name) => {
      const p = path.join(args.from, name);
      if (!existsSync(p)) throw new Error(`快照目录缺少 ${name}：${p}`);
      return p;
    };
    [fapi, dapi] = await Promise.all([readJson(file('fapi_ei.json')), readJson(file('dapi_ei.json'))]);
    fetchedAt = args.fetchedAt ?? serverTimeOf(fapi, dapi);
    if (!fetchedAt) throw new Error('快照里读不到服务器时间，请用 --fetched-at 指定');
  } else {
    [fapi, dapi] = await Promise.all([fetchJson(USDM_EXCHANGE_INFO_URL), fetchJson(COINM_EXCHANGE_INFO_URL)]);
    fetchedAt = args.fetchedAt ?? new Date().toISOString();
  }

  const statuses = new Set(args.includeSettling ? ['TRADING', 'SETTLING'] : ['TRADING']);
  const problems = [];
  const usdm = collect(fapi, 'U 本位', { statusKey: 'status', types: USDM_PERPETUAL_TYPES, statuses }, problems);
  const coinm = collect(dapi, '币本位', { statusKey: 'contractStatus', types: new Set(['PERPETUAL']), statuses }, problems);
  if (problems.length > 0) {
    console.error(`校验失败 ${problems.length} 处：\n  ${problems.slice(0, 30).join('\n  ')}`);
    process.exit(1);
  }

  const doc = {
    fetchedAt,
    sources: {
      usdmExchangeInfo: USDM_EXCHANGE_INFO_URL,
      coinmExchangeInfo: COINM_EXCHANGE_INFO_URL,
      statuses: [...statuses],
      mode: args.from ? 'saved-snapshot' : 'live-fetch',
    },
    columns: COLUMNS,
    usdm,
    coinm,
  };
  const text = formatOutput(doc);
  // 自检：格式化后的文本必须能原样解析回同一份数据。
  if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(doc)) throw new Error('输出格式化后与数据不一致');

  const raw = Buffer.byteLength(text);
  const gz = gzipSync(text, { level: 9 }).length;
  const sample = ['BTCUSDT', 'ETHUSDT', 'KAITOUSDT'].filter(s => usdm[s]).map(s => `${s} 市价 ${usdm[s][0]} / 限价 ${usdm[s][3]}`);
  console.log([
    `快照时间     ${fetchedAt}`,
    `U 本位       ${Object.keys(usdm).length} 个永续（${[...statuses].join(' + ')}）`,
    `币本位       ${Object.keys(coinm).length} 个永续`,
    `样例         ${sample.join('；')}`,
    `体积         ${raw} 字节，gzip ${gz} 字节`,
  ].join('\n'));

  if (args.check) {
    // 只比数据（列名与每个标的的一行），不比快照时间与来源方式：--from 读存档与在线请求拉的是同一份数据
    const current = existsSync(args.out) ? await readJson(args.out).catch(() => null) : null;
    const dataOf = (d) => JSON.stringify({ columns: d?.columns, usdm: d?.usdm, coinm: d?.coinm });
    if (!current || dataOf(current) !== dataOf(doc)) {
      const changed = current
        ? ['usdm', 'coinm'].flatMap(k => {
          const keys = new Set([...Object.keys(current[k] ?? {}), ...Object.keys(doc[k] ?? {})]);
          return [...keys].filter(sym => JSON.stringify(current[k]?.[sym]) !== JSON.stringify(doc[k]?.[sym]));
        })
        : [];
      console.error(`${path.relative(ROOT, args.out)} 与重新生成的结果不一致${changed.length ? `（${changed.length} 个标的：${changed.slice(0, 20).join('、')}）` : ''}`);
      process.exit(1);
    }
    console.log('数据与现有文件一致');
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
