/**
 * 持仓监测耗时基准（默认跳过；要真实取币安公开行情，只在本机手动跑）。
 *
 *   VEIL_QUALITY_BENCH=/path/to/study.json VEIL_BENCH_ROWS=4 VEIL_BENCH_PLAN=<方案 id> \
 *     npx vitest run src/lib/fish/__tests__/qualityRunBench.test.ts --testTimeout=0
 *
 * VEIL_BENCH_CONCURRENCY=4 可比较并行行数（默认 1，即逐行）。
 * study.json 是一份鱼质量总表（不含结果即可）。输出每笔的取数 / 计算耗时、请求数与 K 线根数，以及合计拆分。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FishScanner } from '@/lib/fishScanner';
import { createFishReconstructionLoader } from '../reconstructionLoader';
import { collectFishQuality, qualityRunSamples, type FishQualityStudy, type QualityResult, type QualityRunTiming } from '../quality';
import type { FishReconstructionLoader } from '../reconstruction';

const path = process.env.VEIL_QUALITY_BENCH;
describe.skipIf(!path)('持仓监测耗时基准', () => {
  it('splits wall time into market-data requests, bar loading and computation', async () => {
    const study = JSON.parse(readFileSync(path!, 'utf8')) as FishQualityStudy;
    const planId = process.env.VEIL_BENCH_PLAN, rows = Number(process.env.VEIL_BENCH_ROWS ?? 3);
    const plans = (study.sellPlans ?? []).filter(p => !planId || p.id === planId);
    const samples = qualityRunSamples(study).slice(0, rows);
    const frozen: FishQualityStudy = { ...study, sellPlans: plans, results: [], selectedRowIds: samples.map(s => s.id) };
    let requests = 0, requestMs = 0;
    // jsdom 的 AbortSignal 不被 Node 的 fetch 接受（会报 TypeError，被当成「浏览器拦截」）：基准里不传取消信号
    const timedFetch: typeof fetch = async (input, init) => { const t = performance.now(); requests++; try { return await fetch(input, { ...init, signal: undefined }); } finally { requestMs += performance.now() - t; } };
    const scanner = new FishScanner(timedFetch);
    const adapters = (scanner as unknown as { adapters: Parameters<typeof createFishReconstructionLoader>[0] }).adapters;
    const now = Date.now();
    const base = createFishReconstructionLoader(adapters, async () => now);
    const perRow = new Map<string, { loadMs: number; bars: number; calls: number; requests: number }>();
    const load: FishReconstructionLoader = async (row, from, cut, plan, signal) => {
      const key = row.symbol, t = performance.now(), r0 = requests;
      const bars = await base(row, from, cut, plan, signal);
      const s = perRow.get(key) ?? { loadMs: 0, bars: 0, calls: 0, requests: 0 };
      s.loadMs += performance.now() - t; s.bars += bars.length; s.calls++; s.requests += requests - r0; perRow.set(key, s);
      return bars;
    };
    const results: { r: QualityResult; at: number }[] = [], timings: QualityRunTiming[] = [];
    const t0 = performance.now();
    let last = t0;
    await collectFishQuality({ study: frozen, signal: new AbortController().signal, task: 'monitor', mode: 'restart', concurrency: Number(process.env.VEIL_BENCH_CONCURRENCY ?? 1), onTiming: t => timings.push(t), onProgress: () => {}, onResult: r => { const at = performance.now(); results.push({ r, at: at - last }); last = at; } }, load, now);
    const wall = performance.now() - t0, loadMs = [...perRow.values()].reduce((n, s) => n + s.loadMs, 0);
    const lines = samples.map(s => { const st = perRow.get(s.source.symbol); const done = results.filter(x => x.r.sampleId === s.id);
      return `${s.source.symbol.padEnd(14)} 持有 ${done.map(x => (((x.r.endTime ?? x.r.evaluatedAt) - (x.r.entryTime ?? 0)) / 3.6e6).toFixed(0) + 'h').join('/')} · 取数 ${(st?.loadMs ?? 0).toFixed(0)}ms（${st?.requests ?? 0} 次请求，${st?.calls ?? 0} 次读取，${st?.bars ?? 0} 根）· 单笔用时 ${timings.filter(t => t.sampleId === s.id).map(t => t.ms.toFixed(0)).join('/')}ms · ${done.map(x => x.r.status + (x.r.status === 'error' ? '：' + x.r.reason : '')).join('/')}`; });
    console.log(['', `并行 ${process.env.VEIL_BENCH_CONCURRENCY ?? 1} 行`, ...lines, `合计 ${wall.toFixed(0)}ms：取数 ${loadMs.toFixed(0)}ms（其中网络请求 ${requestMs.toFixed(0)}ms，${requests} 次）· 计算约 ${(wall - loadMs).toFixed(0)}ms`].join('\n'));
    expect(results.length).toBeGreaterThan(0);
  });
});
