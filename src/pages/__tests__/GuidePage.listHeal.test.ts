import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 指南里「列表页后台自愈」那句话与 campaignListCache 的入队条件（storedOutcomeDiverges）必须对得上。
 * 后台自愈只排每条腿都挂着成交 id、且本地查得到这些成交记录的战役：只有复盘快照的历史战役
 * （换了浏览器、清过历史成交）拉不齐校正，排进去也是一次注定不写的读取，于是根本不排。
 * 指南不能因此许诺「所有已结束战役都不必逐场点开就会收敛」——那是一句用户会照着核对数据的承诺。
 */
const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

describe('指南：列表页后台自愈的适用范围', () => {
  const guide = read('pages/GuidePage.tsx');
  const cache = read('lib/campaignListCache.ts');

  it('入队条件仍是「结算取自成交记录、且每条腿都挂着成交 id」', () => {
    const at = cache.indexOf('function storedOutcomeDiverges');
    expect(at).toBeGreaterThan(-1);
    const body = cache.slice(at, cache.indexOf('\n}', at));
    expect(body).toContain("row.settlement.basis !== 'records'");
    expect(body).toContain('row.legs.every(leg => leg.trade_record_id)');
  });

  it('指南把后台自愈限定在这类战役上，并写明其余的仍要打开详情页', () => {
    const at = guide.indexOf('列表页本身不回写');
    expect(at).toBeGreaterThan(-1);
    const clause = guide.slice(at, at + 260);
    expect(clause).toContain('每条腿都挂着成交记录');
    expect(clause).toContain('本地查得到');
    expect(clause).toContain('复盘快照');
    expect(clause).toContain('打开详情页');
    // 不许诺整类「已结束战役」都会自己收敛
    expect(guide).not.toContain('对校正拉齐后落库结果与校正后结果不一致的已结束战役');
  });
});
