/**
 * 【用户要求】2026-11-03「原来的模版数据非常珍贵，一定要能够复原出来」。
 * 金样本：「卖出算法组合2」10-31 09:25 那次运行的 RAVE 信号，原结果 +10027.381606311355 USDT、加仓 7 次（模板名里的 b=2005.48）。
 * K 线来自那次复算实际请求的币安原文（fixtures/*.json.gz），不联网。任何改动让旧引擎算不出这个数，这里都会失败。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FishAdapter, fishTransport } from '@/lib/fish/adapters';
import { FishWeightBudget } from '@/lib/fish/shared';
import { createFishReconstructionLoader } from '@/lib/fish/reconstructionLoader';
import { collectFishQuality, newQualityStudy, qualityResultKey, type QualityGroup, type QualityResult, type QualitySample } from '@/lib/fish/quality';
import { qualityAdditionFills } from '@/lib/fish/qualityAddition';
import { evaluateLegacyQualitySample, LEGACY_ENGINE_SHA256, LEGACY_QUALITY_ENGINE } from '@/lib/fish/qualityLegacyEngine';
import { activeQualityPlanTemplates, qualityPlanFromTemplate, type QualityPlanTemplate } from '@/lib/fish/qualityPlanTemplates';
import { backfillPlanVersions, freezeQualityPlan, planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { replaceQualitySellPlans } from '@/lib/fish/qualitySellPlans';

const here = join(process.cwd(), 'src/lib/fish/legacy/__tests__/');
const fixture = JSON.parse(gunzipSync(readFileSync(here + 'fixtures/rave-2026-04-09-combo2.json.gz')).toString('utf8')) as {
  plan: QualityGroup; observeHours: number; sample: QualitySample; responses: Record<string, string>;
  original: { pnl: number; additionQuantities: number[]; endPrice: number; endTime: number; evaluatedAt: number; entryTime: number };
};
const DAY = 86_400_000;
// 与原运行同一个评估时刻；服务器时钟也固定，日后币安的数据保留期限不影响这条测试
const now = Math.min(fixture.original.evaluatedAt, fixture.original.endTime + 3 * DAY);
const offline: typeof fetch = async input => {
  const body = fixture.responses[String(input)];
  if (body == null) throw new Error(`金样本不应请求夹具以外的数据：${String(input)}`);
  return new Response(body, { status: 200 });
};
const loader = () => createFishReconstructionLoader(new Map([['binance', new FishAdapter('binance', fishTransport('binance', offline, new FishWeightBudget()))]]) as never, async () => fixture.original.evaluatedAt);
const signal = () => new AbortController().signal;
const expectOriginal = (r: QualityResult) => {
  expect(r.status).toBe('closed');
  expect(r.pnl).toBe(fixture.original.pnl); // 逐位相等，不是近似
  expect(qualityAdditionFills(r).map(a => a.quantity)).toEqual(fixture.original.additionQuantities);
  expect(r.endPrice).toBe(fixture.original.endPrice);
  expect(r.endTime).toBe(fixture.original.endTime);
};

describe('2026-10-31 旧引擎', () => {
  it('冻结文件正文与记录的 SHA-256 一致，且没有任何外部导入', () => {
    const text = readFileSync(here + '../qualityEngine20261031.js', 'utf8');
    const mark = '// ===== 以下为打包正文（勿改）=====\n', at = text.indexOf(mark);
    expect(at).toBeGreaterThan(0);
    const body = text.slice(at + mark.length);
    expect(createHash('sha256').update(body).digest('hex')).toBe(LEGACY_ENGINE_SHA256);
    expect(text.slice(0, at)).toContain(LEGACY_ENGINE_SHA256);
    expect(body).not.toMatch(/^import /m);
    expect(body).not.toMatch(/\bfetch\(|localStorage|indexedDB|supabase/);
  });

  it('原样复算 RAVE：+10027.381606311355，7 次加仓逐笔相同；结果编号换成调用方给的', async () => {
    const r = await evaluateLegacyQualitySample(fixture.sample, fixture.plan, fixture.observeHours, now, loader(), signal(), 'current-key');
    expectOriginal(r);
    expect(r.key).toBe('current-key');
  }, 120_000);

  it('完整流程：误记版本的模板 → 打开时标为旧引擎 → 新建方案并保存 → 运行，结果与原战役逐位一致', async () => {
    // 11-03「从战役存模板」按当前代码给 10-31 的方案记了版本清单（就是用户遇到的那份）
    const wrong: QualityPlanTemplate = { id: 'tpl-mw0rw50i-n13il1', name: '算法组合3-0（b=2005.48）', savedAt: 1, updatedAt: 1, plan: freezeQualityPlan(fixture.plan) };
    const study0 = backfillPlanVersions({ ...newQualityStudy(now), planTemplates: [wrong] });
    const [template] = activeQualityPlanTemplates(study0);
    expect(template.plan.engine).toBe(LEGACY_QUALITY_ENGINE);
    expect(template.plan.frozenVersions?.map(v => v.key)).toEqual(['engine', 'legacy-params']);
    const created = qualityPlanFromTemplate(template, 'sell-legacy-test', '算法组合3-0（b=2005.48）');
    const study = replaceQualitySellPlans({ ...study0, samples: [fixture.sample], selectedRowIds: [fixture.sample.id], observeHours: fixture.observeHours }, [created]);
    const plan = study.sellPlans![0];
    expect(plan.engine).toBe(LEGACY_QUALITY_ENGINE);
    expect(planVersionChanges(plan)).toEqual([]);
    const results: QualityResult[] = [];
    await collectFishQuality({ study, task: 'monitor', signal: signal(), onProgress: () => {}, onResult: r => results.push(r) }, loader(), now);
    expect(results).toHaveLength(1);
    expectOriginal(results[0]);
    expect(results[0].key).toBe(qualityResultKey(fixture.sample, plan, fixture.observeHours));
  }, 180_000);
});
