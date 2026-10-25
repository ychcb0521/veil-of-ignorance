/** Saved cabin evidence only: never rescan, mutate fish, or infer missing outcomes from today's settings. */
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishSnapshot } from './algorithm';
import { fishMetricLabel } from './records';
import { formatUTC8 } from '@/lib/timeFormat';
import { intervalMs } from '@/lib/deepRsa/marketData';
import { buildXlsx, type XlsxCell, type XlsxSheet } from '@/lib/xlsxWorkbook';

type Hit = 0 | 1 | null;
interface Verdict { hit: Hit; reason: string }
interface Algorithm {
  id: string; snapshot: Partial<FishSnapshot>; key: string; complete: boolean;
  metric: string; records: number; hits: number; misses: number; unknown: number;
  comparableHits: number; uniqueHits: number;
}
interface Pair { a: Algorithm; b: Algorithm; recorded: number; known: number; both: number; onlyA: number; onlyB: number; neither: number }
const finite = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) ? n : null;
const at = (n: number | undefined) => finite(n) === null ? null : formatUTC8(n!);
const ratio = (n: number, d: number) => d > 0 ? n / d : null;
const rejected = new Set(['below', 'blocked', 'unknown', 'wick', 'thin']);
const unavailable = new Set(['failed', 'readings', 'gap', 'history', 'skipped', 'missing']);
const sheet = (name: string, headers: string[], rows: XlsxCell[][]): XlsxSheet => ({ name, columns: headers.map((header, i) => ({ header, ...(name === '说明' ? { width: i === 0 ? 30 : 110 } : {}) })), rows });
// Excel cells allow 32767 UTF-16 units. The complete, lossless JSON is chunked separately.
const text = (s: string | undefined): string | null => !s ? null : s.length <= 30000 ? s : Array.from(s).slice(0, 14000).join('') + '…（完整内容见原始快照）';

function verdict(root: FishSnapshot | undefined, member: Partial<FishSnapshot>, index: number): Verdict {
  if (!root) return { hit: null, reason: '未保存算法快照' };
  if (member.outcome && unavailable.has(member.outcome)) return { hit: null, reason: '历史不足、缺数、请求失败或未判定' };
  const explicit = member.outcome === 'hit' ? 1 : member.outcome && rejected.has(member.outcome) ? 0 : null;
  let stored: Hit = null;
  if (!root.algorithms?.length || root.combination !== 'or') stored = 1;
  else if (Array.isArray(root.hitAlgorithms)) stored = root.hitAlgorithms.includes(index + 1) ? 1 : 0;
  if (explicit !== null && stored !== null && explicit !== stored) return { hit: null, reason: '保存的命中标记与算法结论冲突' };
  return { hit: explicit ?? stored, reason: explicit !== null ? '保存的算法结论' : stored !== null ? '保存的单算法、交集或并集命中标记' : '未保存可确定的命中标记' };
}

function configKey(m: Partial<FishSnapshot>): string {
  return JSON.stringify([m.featureId ?? null, m.featureShort ?? null, m.algorithmKey ?? null, m.definitionKey ?? null,
    m.statistic ?? null, m.interval ?? null, m.H ?? null, m.direction ?? null, m.threshold ?? null,
    m.scale ?? null, m.unit ?? null, m.constraintKey ?? null, m.constraints ?? null]);
}
function memberStart(m: Partial<FishSnapshot>, s: TradeSignal, multi: boolean): number | undefined {
  if (finite(m.cutoffMs) !== null && finite(m.startIndex) !== null && finite(m.cutoffIndex) !== null && m.interval) {
    try { return m.cutoffMs! - (m.cutoffIndex! - m.startIndex!) * intervalMs(m.interval as Parameters<typeof intervalMs>[0]); } catch { /* Keep missing evidence empty. */ }
  }
  return multi ? undefined : s.timeMs;
}

export function buildFishCabinSheets(input: readonly TradeSignal[], exportedAt = Date.now()): XlsxSheet[] {
  const signals = input.filter(s => !s.freshCatch);
  const algorithms = new Map<string, Algorithm>();
  const pairs = new Map<string, Pair>();
  const signalRows: XlsxCell[][] = [], memberRows: XlsxCell[][] = [], rawRows: XlsxCell[][] = [];
  signals.forEach((s, rowIndex) => {
    const rowId = 'F' + String(rowIndex + 1).padStart(6, '0'), root = s.fish;
    const members: Partial<FishSnapshot>[] = root?.algorithms?.length ? root.algorithms : [root ?? {}];
    const observed = new Map<string, { algorithm: Algorithm; hit: Hit }>();
    members.forEach((m, index) => {
      const key = configKey(m);
      let algorithm = algorithms.get(key);
      if (!algorithm) {
        algorithm = { id: 'A' + String(algorithms.size + 1).padStart(3, '0'), snapshot: m, key,
          complete: !!m.algorithmKey && !!m.definitionKey && !!m.statistic && !!m.interval && finite(m.threshold) !== null && finite(m.scale) !== null,
          metric: fishMetricLabel(m), records: 0, hits: 0, misses: 0, unknown: 0, comparableHits: 0, uniqueHits: 0 };
        algorithms.set(key, algorithm);
      }
      const v = verdict(root, m, index), previous = observed.get(algorithm.id);
      // Repeating the same card cannot multiply its statistical weight; contradictory copies stay unknown.
      observed.set(algorithm.id, { algorithm, hit: previous && previous.hit !== v.hit ? null : v.hit });
      const scale = finite(m.scale), reading = finite(m.average);
      memberRows.push([rowId, s.id, s.symbol, s.exchange ?? 'binance', s.market ?? 'crypto', at(s.timeMs), index + 1,
        algorithm.id, m.featureId ?? null, m.featureShort ?? m.featureName ?? null, m.statistic ?? null, algorithm.metric,
        v.hit, m.outcome ?? null, v.reason, m.algorithmKey ?? null, m.interval ?? null, m.direction ?? null,
        finite(m.threshold), finite(m.thresholdRaw), scale, m.unit ?? null, reading,
        reading !== null && scale !== null ? reading * scale : null, at(memberStart(m, s, !!root?.algorithms?.length)),
        at(m.cutoffMs), finite(m.cutoffMs), finite(m.startAverage), finite(m.previousAverage), finite(m.runExtreme),
        finite(m.aboveBars), text(JSON.stringify(m.constraints ?? null)), text(m.definitionKey),
        text(JSON.stringify(m.stateHold ?? null))]);
    });
    const values = [...observed.values()];
    const known = values.filter(v => v.hit !== null), hits = values.filter(v => v.hit === 1);
    for (const { algorithm, hit } of values) {
      algorithm.records++;
      if (hit === 1) algorithm.hits++; else if (hit === 0) algorithm.misses++; else algorithm.unknown++;
      if (hit === 1 && values.length >= 2 && known.length === values.length) {
        algorithm.comparableHits++;
        if (hits.length === 1) algorithm.uniqueHits++;
      }
    }
    const ordered = values.sort((a, b) => a.algorithm.id.localeCompare(b.algorithm.id));
    for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i], b = ordered[j], key = a.algorithm.id + '|' + b.algorithm.id;
      const pair = pairs.get(key) ?? { a: a.algorithm, b: b.algorithm, recorded: 0, known: 0, both: 0, onlyA: 0, onlyB: 0, neither: 0 };
      pair.recorded++;
      if (a.hit !== null && b.hit !== null) {
        pair.known++;
        if (a.hit && b.hit) pair.both++; else if (a.hit) pair.onlyA++; else if (b.hit) pair.onlyB++; else pair.neither++;
      }
      pairs.set(key, pair);
    }
    signalRows.push([rowId, s.id, s.symbol, s.underlying ?? null, s.exchange ?? 'binance', s.market ?? 'crypto',
      at(s.timeMs), s.timeMs, finite(s.quality), at(s.caughtAt), finite(s.caughtAt), s.fishArchive?.id ?? null,
      at(s.fishArchive?.at), finite(s.fishArchive?.at), root?.algorithms?.length ? root.combination ?? 'and' : 'single',
      at(root?.cutoffMs), values.length, hits.length, values.length - known.length,
      hits.map(v => v.algorithm.id).join(' · '), values.filter(v => v.hit === 0).map(v => v.algorithm.id).join(' · '),
      values.filter(v => v.hit === null).map(v => v.algorithm.id).join(' · '), text(root?.algorithmKey)]);
    const chars = Array.from(JSON.stringify(s));
    for (let offset = 0; offset < chars.length; offset += 14000) rawRows.push([rowId, Math.floor(offset / 14000) + 1, chars.slice(offset, offset + 14000).join('')]);
  });
  const algorithmRows: XlsxCell[][] = [...algorithms.values()].map(a => {
    const m = a.snapshot;
    return [a.id, m.featureId ?? null, m.featureShort ?? m.featureName ?? null, a.metric, m.statistic ?? null,
      m.interval ?? null, m.direction ?? null, finite(m.threshold), finite(m.H), finite(m.scale), m.unit ?? null,
      a.complete ? '配置字段完整' : '配置字段不完整；不可当作已核实的相同版本', a.records, a.hits, a.misses, a.unknown,
      a.comparableHits, a.uniqueHits, ratio(a.uniqueHits, a.comparableHits), text(m.algorithmKey), text(m.definitionKey),
      text(JSON.stringify(m.constraints ?? null)), text(a.key)];
  });
  const pairRows: XlsxCell[][] = [...pairs.values()].map(p => [p.a.id, p.a.metric, p.b.id, p.b.metric, p.recorded,
    p.known, p.recorded - p.known, p.both, p.onlyA, p.onlyB, p.neither, p.both + p.onlyA + p.onlyB,
    ratio(p.both, p.both + p.onlyA + p.onlyB), ratio(p.both, p.both + p.onlyA), ratio(p.both, p.both + p.onlyB)]);
  return [
    sheet('说明', ['项目', '口径'], [
      ['导出时间(UTC+8)', at(exportedAt)], ['范围', '全部已加载鱼舱记录，不受月份、算法或标的筛选影响；不含新鱼。'],
      ['记录数', signals.length], ['算法配置数', algorithms.size], ['数据版本', 1],
      ['统计单位', '一条保存的鱼舱记录。同一记录中相同配置的重复卡只计一次；不同记录、不同起点或不同轮次不强行合并。F编号为本文件连接键。'],
      ['算法编号', 'A编号仅在本文件内有效。按保存的算法键、公式、指标、阈值、周期、倍率和约束分配置；原值、avg、avg_2分别保留。缺项明确标注，不读取当前账号公式补写历史。'],
      ['是否命中', '1=已记录命中；0=已记录明确未命中/被规则过滤；空白=缺数、失败、历史不足、无标记或证据冲突。空白不是0。'],
      ['两两重叠', '仅比较同一鱼舱记录中共同出现的两个配置；比率只用两者都可判定的记录。未共同出现的配置不输出比较行。'],
      ['Jaccard(0-1)', '共同命中数 / (仅A命中数 + 仅B命中数 + 共同命中数)。分母为0留空。'],
      ['覆盖率(0-1)', 'A被B覆盖率=共同命中/该共同可判定样本中A命中；B同理。不能用另一批样本的总命中数作分母。'],
      ['同记录内独有命中', '至少两个不同配置且全部可判定时，只有本配置命中的记录数；独有率分母为本配置在这类记录中的命中数。不是对全部市场或全部算法的唯一贡献。'],
      ['样本边界', '鱼舱仅保留捕获记录，缺少全市场未入舱样本；手动删除、跨轮去重及交集/并集筛选会改变样本。交集样本本身要求全部命中，不能据其高重叠率判断算法冗余。不同候选集合的独有率不可直接排名。'],
      ['使用建议', '优先比较同一时期、同一候选集合和相同参数版本；结合算法判定中的市场、截止时间和各自起点核对。重叠/独有命中只能说明当前样本的覆盖关系，不能单独证明算法收益价值或删除某算法后的实际效果。'],
      ['原始快照', '按F编号、片段序号拼接JSON即可恢复导出时完整记录。为满足Excel单元格长度限制分片；非有限数字按JSON规则写为null。其他表超长文本仅作预览，以此表为准。'],
      ['数值', '数值单元格不取整、不附单位；倍率后的读数仅在保存了倍率时计算。时间字符串为UTC+8，时间戳为epoch毫秒。'],
    ]),
    sheet('信号明细', ['记录编号','原记录ID','标的','底层标的','交易所','市场','信号时间(UTC+8)','信号时间戳(ms)','评分','捕获时间(UTC+8)','捕获时间戳(ms)','入舱轮次ID','入舱时间(UTC+8)','入舱时间戳(ms)','组合方式','组合截止时间(UTC+8)','不同配置数','已知命中配置数','未知配置数','命中配置编号','未命中配置编号','未知配置编号','组合算法键'], signalRows),
    sheet('算法判定', ['记录编号','原记录ID','标的','交易所','市场','组合信号时间(UTC+8)','卡片序号','算法编号','特征ID','算法名称','选择的指标','实际指标','是否命中(1/0/空)','原始结论','判定依据','算法键','周期','方向','阈值(显示单位)','阈值(原值)','倍率','单位','截止读数(原值)','截止读数(显示值)','本算法起点(UTC+8)','截止时间(UTC+8)','截止时间戳(ms)','起点读数(原值)','前根读数(原值)','保持区间极值(原值)','连续根数','约束JSON','公式定义快照','持续条件核验JSON'], memberRows),
    sheet('算法汇总', ['算法编号','特征ID','算法名称','实际指标','选择的指标','周期','方向','阈值','旧版外层均值小时','倍率','单位','配置完整性','参与记录数','命中记录数','未命中记录数','未知记录数','多算法全部可判定时本算法命中数','同记录内独有命中数','同记录内独有率(0-1)','算法键','公式定义快照','约束JSON','配置连接键JSON'], algorithmRows),
    sheet('两两重叠', ['算法A','A指标','算法B','B指标','共同出现记录数','共同可判定记录数','含未知的记录数','共同命中数','仅A命中数','仅B命中数','均未命中数','命中并集数','Jaccard(0-1)','A被B覆盖率(0-1)','B被A覆盖率(0-1)'], pairRows),
    sheet('原始快照', ['记录编号','片段序号','原始记录JSON片段'], rawRows),
  ];
}

export function downloadFishCabin(input: readonly TradeSignal[], exportedAt = Date.now()): string {
  if (!input.some(s => !s.freshCatch)) throw new Error('鱼舱暂无可导出的数据');
  const blob = buildXlsx(buildFishCabinSheets(input, exportedAt));
  const filename = '鱼舱统计-' + formatUTC8(exportedAt).replace(/\D/g, '').slice(0, 14) + '.xlsx';
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  try { link.href = url; link.download = filename; document.body.appendChild(link); link.click(); }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return filename;
}
