import { buildXlsx, type XlsxCell, type XlsxSheet } from '@/lib/xlsxWorkbook';
import { formatUTC8 } from '@/lib/timeFormat';
import type { TradeSignal } from '@/lib/signalLibrary';
import { EXCHANGE_NAMES } from './exchanges';
import { fishCaughtBy } from './records';
import { fishMarketHits, type FishHitRateMode, type FishHitRateTimeWindow, type FishHitRateWindow } from './hitRate';

export interface FishHitRateExportRun {
  mode: FishHitRateMode;
  windows: readonly FishHitRateWindow[];
  samples: readonly TradeSignal[];
  window: FishHitRateTimeWindow;
  startedAt: number;
  outcome: '测试结束' | '已停止' | '测试异常';
}

const verdict = {hit:'命中',miss:'未命中',unverified:'无法判定'};
const groups = {sample:'本窗样本','other-window':'其他窗口样本',outside:'样本外'};
const timestamp = (at?: number) => Number.isFinite(at) ? formatUTC8(at!) : undefined;
const market = (signal: TradeSignal) => signal.market === 'us_stock' ? '美股合约' : '加密';
const venue = (signal: TradeSignal) => EXCHANGE_NAMES[signal.exchange ?? 'binance'];
const sheet = (name: string, headers: readonly string[], rows: readonly (readonly XlsxCell[])[]): XlsxSheet =>
  ({name,columns:headers.map(header=>({header,width:header==='说明'||header==='算法类型'||header==='涉及规则'?46:22})),rows});

export function buildFishHitRateSheets(run: FishHitRateExportRun): XlsxSheet[] {
  const rows = run.windows.flatMap(window=>window.rows.map(row=>({row,window})));
  const hits = rows.filter(({row})=>row.status==='hit').length;
  const misses = rows.filter(({row})=>row.status==='miss').length;
  const decided = hits + misses;
  const prefix = (sample: TradeSignal, window: FishHitRateWindow) =>
    [sample.symbol,venue(sample),market(sample),timestamp(sample.timeMs),timestamp(window.anchorMs)];
  const context = ['标的','交易所','市场','样本时间（北京时间）','扫描截止（北京时间）'];
  const sheets = [
    sheet('运行摘要',['项目','值'],[
      ['开始时间（北京时间）',timestamp(run.startedAt)],['运行状态',run.outcome],
      ['扫描范围',run.mode==='market'?'扫描窗口内全部标的':'只扫描给定标的'],
      ['样本前（小时）',run.window.beforeHours],['样本后（小时）',run.window.afterHours],
      ['本轮样本数',run.samples.length],['本轮窗口数',new Set(run.samples.map(sample=>sample.timeMs)).size],
      ['已完成窗口数',run.windows.length],['命中',hits],['未命中',misses],['无法判定',rows.length-decided],
      ['已判定样本数',decided],['命中率（%）',decided ? 100*hits/decided : null],
    ]),
    sheet('样本结果',['标的','交易所','市场','评分','样本时间（北京时间）','窗口起点（北京时间）','扫描截止（北京时间）','判定','算法数量','算法类型','命中起点（北京时间）','相对样本（分钟）','说明'],
      rows.map(({row,window})=>{
        const algorithms = row.hit ? fishCaughtBy(row.hit) : [];
        return [row.sample.symbol,venue(row.sample),market(row.sample),row.sample.quality,timestamp(row.sample.timeMs),
          timestamp(window.startMs),timestamp(window.anchorMs),verdict[row.status],row.hit ? algorithms.length : null,algorithms.join('、'),
          timestamp(row.hit?.timeMs),row.hit ? (row.hit.timeMs-row.sample.timeMs)/60_000 : null,
          [row.reason,...(row.rejections??[]).map(item=>item.label)].filter(Boolean).join('；')];
      })),
    sheet('测试窗口',['窗口起点（北京时间）','扫描截止（北京时间）','样本数','窗口命中记录数','说明'],
      run.windows.map(window=>[timestamp(window.startMs),timestamp(window.anchorMs),window.rows.length,window.hits.length,window.notice])),
  ];
  const evidence = [
    sheet('算法门槛',[...context,'算法','结果序列','窗口内最大值','最大值时间（北京时间）','截止读数','读数时间（北京时间）','比较方向','门槛','单位'],
      rows.flatMap(({row,window})=>(row.thresholds??[]).map(item=>[...prefix(row.sample,window),item.algorithm,item.statistic,
        item.maximum?.value,timestamp(item.maximum?.timeMs),item.cutoffReading,timestamp(item.cutoffMs),item.direction,item.threshold,item.unit]))),
    sheet('信号起点超窗',[...context,'算法','结果序列','连续达标起点（北京时间）','窗口边界','相对边界（分钟）','截止读数','读数时间（北京时间）','比较方向','门槛','单位'],
      rows.flatMap(({row,window})=>(row.outside??[]).map(item=>{
        const early = item.startMs < window.startMs;
        return [...prefix(row.sample,window),item.algorithm,item.statistic,timestamp(item.startMs),early?'起点':'截止',
          (item.startMs-(early?window.startMs:window.anchorMs))/60_000,item.cutoffReading,timestamp(item.cutoffMs),item.direction,item.threshold,item.unit];
      }))),
    sheet('成交额门槛',[...context,'检查阶段','检查时间（北京时间）','回看（小时）','实际成交额（USDT）','门槛（USDT）','判定','涉及规则'],
      rows.flatMap(({row,window})=>(row.turnover??[]).flatMap(item=>item.checks.map(check=>[...prefix(row.sample,window),
        item.stage==='cutoff'?'扫描截止前':'信号起点前',timestamp(item.at),check.hours,check.value,check.min,check.ok?'达标':'未达标',item.algorithms.join('、')])))),
    sheet('插针过滤',[...context,'触发开盘（北京时间）','回看截止（北京时间）','回看（小时）','开盘价','最高价','最低价','收盘价','实际跌幅','此前 ATR','门槛倍数','跌幅门槛'],
      rows.flatMap(({row,window})=>{
        const wick=row.wick;
        return wick ? [[...prefix(row.sample,window),timestamp(wick.openTime),timestamp(wick.cutoffMs),wick.rule.hours,wick.open,wick.high,wick.low,wick.close,
          wick.drop,wick.atr,wick.rule.atrMultiple,wick.atr*wick.rule.atrMultiple]] : [];
      })),
    sheet('插针附近K线',[...context,'5 分钟线开盘（北京时间）','开盘价','最高价','最低价','收盘价','触发'],
      rows.flatMap(({row,window})=>(row.wick?.candles??[]).map(bar=>[...prefix(row.sample,window),timestamp(bar.openTime),bar.open,bar.high,bar.low,bar.close,
        bar.openTime===row.wick?.openTime?'是':null]))),
  ];
  if (run.mode==='market') sheets.push(sheet('全市场命中',['标的','交易所','市场','样本归类','信号起点（北京时间）','扫描截止（北京时间）','算法数量','算法类型'],
    fishMarketHits(run.windows,run.samples).map(({signal,anchorMs,group})=>{
      const algorithms=fishCaughtBy(signal);
      return [signal.symbol,venue(signal),market(signal),groups[group],timestamp(signal.timeMs),timestamp(anchorMs),algorithms.length,algorithms.join('、')];
    })));
  return [...sheets,...evidence.filter(tab=>tab.rows.length)];
}

export function downloadFishHitRate(run: FishHitRateExportRun) {
  const blob = buildXlsx(buildFishHitRateSheets(run));
  const filename = '捕捞质量-漏报测试-' + formatUTC8(run.startedAt).replace(/\D/g,'').slice(0,14) + '.xlsx';
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  try { link.href=url;link.download=filename;document.body.appendChild(link);link.click(); }
  finally { link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60000); }
}
