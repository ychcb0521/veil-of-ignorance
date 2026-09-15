// @vitest-environment jsdom
/**
 * 回放时间线影子比对的按标的共用预处理（indexCampaignTimelineActivity / SymbolLocalIndex.timelineActivity）。
 *
 * 列表页同一份本地快照下同标的几十场，原来每场都把全标的的活动重新收集、分桶、把全部现实时刻重新排序；
 * 现在与本场无关的那一半按标的只建一次，每场只并入自己的锚点。结论必须逐字不变：
 *   · 共用一份快照（列表页）与每场自己一份快照（详情页）算出的整份结果相同；
 *   · 影子比对与归属结果的投影摘要等于合并之前的 ab1fc4df 在同一份数据上算出的（GOLDEN_DIGEST，由差分工具在旧代码上取得）；
 *   · 一份索引反复给不同锚点的战役用，结论与每场从活动列表现建相同，索引本身不被改动；
 *     索引建时的登记表与本次不是同一份时按本次的登记表重建。
 */
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  campaigns: [] as Array<Record<string, unknown>>,
  journals: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let range: [number, number] | undefined;
      let order: { column: string; ascending: boolean } | undefined;
      const result = () => {
        let rows = table === 'trade_campaigns' ? state.campaigns : table === 'trade_journals' ? state.journals : [];
        rows = rows.filter(row => filters.every(filter => filter(row)));
        if (order) {
          const { column, ascending } = order;
          rows = [...rows].sort((a, b) => {
            const x = a[column] as string; const y = b[column] as string;
            return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
          });
        }
        return { data: range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000), error: null };
      };
      const builder = {
        select() { return builder; },
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return builder; },
        is(column: string, value: unknown) { filters.push(row => (row[column] ?? null) === value); return builder; },
        in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return builder; },
        order(column: string, options: { ascending: boolean }) { order = { column, ascending: options.ascending }; return builder; },
        range(from: number, to: number) { range = [from, to]; return builder; },
        single() {
          const response = result();
          return Promise.resolve({ data: response.data?.[0] ?? null, error: response.data?.length ? null : { code: 'PGRST116', message: '0 rows' } });
        },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return builder;
    },
  },
}));

import {
  buildCampaignTimelineScope,
  collectCampaignTimelineEvidence,
  indexCampaignTimelineActivity,
  type CampaignTimelineActivity,
  type CampaignTimelineAnchor,
  type CampaignTimelineOrderLike,
} from '@/lib/campaignTimelineScope';
import { getCampaignFullData, getCampaignsWithLegs, type UserLocalSnapshot } from '@/lib/journalApi';
import type { ReplayTimelineNode, ReplayTimelineRegistry } from '@/lib/replayTimeline';
import {
  buildStampedCampaignDataset,
  digestOf,
  projectTimelineResult,
  TIMELINE_PARITY_PLAN,
  type StampedDataset,
} from '@/test/fixtures/stampedCampaignDataset';

const USER = 'user-1';

/** ab1fc4df（合并列表缓存之前）在 TIMELINE_PARITY_PLAN 上的投影摘要。 */
const GOLDEN_DIGEST: string = 'd62bc24baa12169f:159090';

const localOf = (dataset: StampedDataset): UserLocalSnapshot => ({
  tradeHistory: dataset.tradeHistory,
  ordersMap: dataset.ordersMap,
  cancelledOrders: dataset.cancelledOrders,
  filledOrders: dataset.filledOrders,
  positionsMap: dataset.positionsMap,
  replayTimelines: dataset.replayTimelines,
});

describe('getCampaignFullData: shared per-symbol timeline activity index', () => {
  it('a shared snapshot gives every campaign the same result as its own snapshot, and matches ab1fc4df', { timeout: 30_000 }, async () => {
    const dataset = buildStampedCampaignDataset(USER, TIMELINE_PARITY_PLAN);
    state.campaigns = dataset.campaigns as unknown as Array<Record<string, unknown>>;
    state.journals = dataset.journals as unknown as Array<Record<string, unknown>>;

    const sources = await getCampaignsWithLegs(USER);
    expect(sources).toHaveLength(dataset.campaigns.length);
    const shared = localOf(dataset);
    const projections = [];
    const modes: Record<string, number> = {};
    const verdicts: Record<string, number> = {};
    let disagreements = 0;
    for (const source of [...sources].sort((a, b) => a.campaign.id.localeCompare(b.campaign.id))) {
      const id = source.campaign.id;
      const listPath = await getCampaignFullData(id, { source, local: shared, heal: false });
      // 每场一份新快照对象：按快照缓存的预处理全部重建，等价于详情页自己读一次本地存储
      const ownPath = await getCampaignFullData(id, { local: localOf(dataset), heal: false });
      expect(JSON.parse(JSON.stringify(listPath)), id).toEqual(JSON.parse(JSON.stringify(ownPath)));
      projections.push(projectTimelineResult(id, listPath));
      const diagnostics = listPath.timelineDiagnostics;
      modes[diagnostics.mode] = (modes[diagnostics.mode] ?? 0) + 1;
      for (const verdict of Object.values(diagnostics.verdicts)) verdicts[verdict.exact] = (verdicts[verdict.exact] ?? 0) + 1;
      disagreements += diagnostics.disagreements.length;
    }
    // 数据确实覆盖了三种模式与三种结论，不是全都退回启发式的空比对
    expect(modes.exact).toBeGreaterThan(0);
    expect(modes.mixed).toBeGreaterThan(0);
    expect(modes.heuristic).toBeGreaterThan(0);
    expect(verdicts.in).toBeGreaterThan(0);
    expect(verdicts.out).toBeGreaterThan(0);
    expect(verdicts.defer).toBeGreaterThan(0);
    expect(disagreements).toBeGreaterThan(0);
    const digest = digestOf(projections);
    if (GOLDEN_DIGEST === '') console.log(`GOLDEN_DIGEST=${digest} modes=${JSON.stringify(modes)} verdicts=${JSON.stringify(verdicts)} disagreements=${disagreements}`);
    else expect(digest).toBe(GOLDEN_DIGEST);
  });
});

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const SYMBOL = 'TUTUSDT';
const MIN = 60_000;

/** 随机的一棵（几棵）时间线树、全标的活动、若干场各自的锚点与待判委托。 */
function randomScopeCase(rand: () => number) {
  const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
  const nodes: ReplayTimelineNode[] = [];
  const count = 3 + Math.floor(rand() * 10);
  for (let i = 0; i < count; i += 1) {
    const parent = i > 0 && rand() < 0.8 ? pick(nodes) : null;
    const direction = (rand() < 0.2 ? -1 : 1) as ReplayTimelineNode['direction'];
    const forkSimTime = 1_000 * MIN + Math.floor(rand() * 600) * MIN;
    nodes.push({
      id: `n${i}`,
      scope: rand() < 0.5 ? 'synced' : `coin:${SYMBOL}`,
      parentId: parent ? parent.id : (rand() < 0.1 ? 'ghost-parent' : null),
      cause: parent ? (direction === -1 ? 'flip' : 'jump') : (rand() < 0.3 ? 'bootstrap' : 'start'),
      direction,
      forkSimTime,
      startedRealAt: 50_000 * MIN + i * Math.floor(rand() * 200) * MIN,
      endSimTime: rand() < 0.3 ? forkSimTime + direction * 90 * MIN : null,
      endedRealAt: rand() < 0.3 ? 50_000 * MIN + (i + 1) * 90 * MIN : null,
      carried: rand() < 0.8 ? {
        [SYMBOL]: {
          positionIds: ['p0', 'p1', 'p2'].filter(() => rand() < 0.5),
          fillIds: ['p0', 'f1'].filter(() => rand() < 0.5),
          orderIds: ['o0', 'o1', 'o2', 'o3'].filter(() => rand() < 0.4),
        },
      } : {},
      lastSimTime: rand() < 0.7 ? forkSimTime + direction * Math.floor(rand() * 300) * MIN : null,
      lastRealAt: rand() < 0.7 ? 50_000 * MIN + i * 150 * MIN : null,
    } as ReplayTimelineNode);
  }
  const ids = [...nodes.map(node => node.id), 'ghost'];
  const clock = () => (rand() < 0.08 ? (rand() < 0.5 ? null : 0) : 1_000 * MIN + Math.floor(rand() * 900) * MIN);
  const realClock = () => (rand() < 0.08 ? null : 50_000 * MIN + Math.floor(rand() * 3_000) * MIN);
  const activity: CampaignTimelineActivity[] = Array.from({ length: Math.floor(rand() * 200) }, () => ({
    timelineId: pick(ids), simAt: clock(), realAt: realClock(),
  }));
  const campaigns = Array.from({ length: 4 }, () => ({
    campaignOpen: rand() < 0.3,
    campaignPositionIds: ['p0', 'p1', 'p2', 'f1', 'o0'].filter(() => rand() < 0.5),
    anchors: Array.from({ length: 1 + Math.floor(rand() * 5) }, (): CampaignTimelineAnchor => ({
      kind: pick(['record-open', 'record-close', 'position-fill', 'leg-open', 'leg-close', 'event'] as const),
      timelineId: rand() < 0.15 ? null : pick(ids),
      realAt: realClock(),
      simAt: clock(),
    })),
  }));
  const orders: CampaignTimelineOrderLike[] = Array.from({ length: 30 }, (_, i) => {
    const createdAt = clock() ?? 0;
    const ended = rand();
    return {
      id: `o${i % 6}`,
      createdAt,
      createdRealAt: realClock(),
      createdTimelineId: rand() < 0.2 ? null : pick(ids),
      ...(ended < 0.4 ? { cancelledAt: createdAt + Math.floor(rand() * 60) * MIN, cancelledRealAt: realClock(), cancelledTimelineId: rand() < 0.3 ? null : pick(ids) } : {}),
      ...(ended >= 0.4 && ended < 0.7 ? { filledAt: createdAt + Math.floor(rand() * 60) * MIN, filledRealAt: realClock(), filledTimelineId: rand() < 0.3 ? null : pick(ids), positionId: pick(['p0', 'p1', 'f1', 'x']) } : {}),
    };
  });
  const registry: ReplayTimelineRegistry = { v: 1, nodes: Object.fromEntries(nodes.map(node => [node.id, node])), current: {} };
  return { registry, activity, campaigns, orders };
}

const scopeResult = (scope: ReturnType<typeof buildCampaignTimelineScope>, orders: CampaignTimelineOrderLike[]) => (
  scope && {
    mode: scope.mode,
    timelineIds: scope.timelineIds,
    anchorTimelineIds: scope.anchorTimelineIds,
    unstampedAnchors: scope.unstampedAnchors,
    missingAnchorNodes: scope.missingAnchorNodes,
    verdicts: orders.flatMap(order => [scope.verdict(order), scope.verdict(order, { live: true })]),
  }
);

describe('buildCampaignTimelineScope: one activity index reused across campaigns', () => {
  it('equals building from the activity list for every campaign, never mutates the index, and rebuilds on another registry', { timeout: 30_000 }, () => {
    let built = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const rand = mulberry32(seed);
      const { registry, activity, campaigns, orders } = randomScopeCase(rand);
      const index = indexCampaignTimelineActivity(registry, activity);
      const frozen = JSON.stringify({ sims: [...index.simsByNode], real: index.realTimes, children: [...index.childrenOf].map(([id, list]) => [id, list.map(node => node.id)]) });
      let lazyCalls = 0;
      for (const campaign of campaigns) {
        const input = { registry, symbol: SYMBOL, ...campaign };
        const expected = scopeResult(buildCampaignTimelineScope({ ...input, activity }), orders);
        expect(scopeResult(buildCampaignTimelineScope({ ...input, activityIndex: index }), orders), `seed ${seed}`).toEqual(expected);
        expect(scopeResult(buildCampaignTimelineScope({ ...input, activityIndex: () => { lazyCalls += 1; return index; } }), orders)).toEqual(expected);
        if (expected) built += 1;
        // 另一份登记表：同一份活动、换了节点（父子关系、时刻都不同）——按本次的登记表重建，而不是沿用索引里的树
        const other = randomScopeCase(mulberry32(seed + 10_000)).registry;
        expect(scopeResult(buildCampaignTimelineScope({ ...input, registry: other, activityIndex: index }), orders))
          .toEqual(scopeResult(buildCampaignTimelineScope({ ...input, registry: other, activity }), orders));
      }
      // 本场没有盖了章的锚点时根本不建索引
      const unstampedCampaigns = campaigns.filter(campaign => campaign.anchors.every(anchor => !anchor.timelineId)).length;
      expect(lazyCalls).toBe(campaigns.length - unstampedCampaigns);
      expect(JSON.stringify({ sims: [...index.simsByNode], real: index.realTimes, children: [...index.childrenOf].map(([id, list]) => [id, list.map(node => node.id)]) })).toBe(frozen);
    }
    expect(built).toBeGreaterThan(1_000);
  });

  it('collectCampaignTimelineEvidence still returns the same anchors, activity and position ids', () => {
    const dataset = buildStampedCampaignDataset(USER, TIMELINE_PARITY_PLAN);
    const campaign = dataset.campaigns.find(item => item.symbol === 'BBBUSDT')!;
    const evidence = collectCampaignTimelineEvidence({
      symbol: campaign.symbol,
      campaignEvents: campaign.actual_evolution ?? [],
      legs: dataset.journals.filter(leg => leg.campaign_id === campaign.id),
      selectedRecords: dataset.tradeHistory.filter(record => record.symbol === campaign.symbol),
      tradeHistory: dataset.tradeHistory,
      openPositions: dataset.positionsMap[campaign.symbol] ?? [],
      pendingOrders: dataset.ordersMap[campaign.symbol] ?? [],
      cancelledOrders: dataset.cancelledOrders,
      filledOrders: dataset.filledOrders,
    });
    expect(evidence.anchors.length).toBeGreaterThan(0);
    expect(evidence.activity.length).toBeGreaterThan(0);
    // 活动只收本标的的；腿引用的成交快照按 id 查时不分标的（cross-dup 最后写在 AAAUSDT 上，它开出的仓位算本场）
    expect(evidence.activity.length).toBe(
      (dataset.ordersMap[campaign.symbol] ?? []).filter(order => order.createdTimelineId).length
      + dataset.cancelledOrders.filter(order => order.symbol === campaign.symbol)
        .reduce((sum, order) => sum + (order.createdTimelineId ? 1 : 0) + (order.cancelledTimelineId ? 1 : 0), 0)
      + dataset.filledOrders.filter(order => order.symbol === campaign.symbol)
        .reduce((sum, order) => sum + (order.createdTimelineId ? 1 : 0) + (order.filledTimelineId ? 1 : 0), 0)
      + dataset.tradeHistory.filter(record => record.symbol === campaign.symbol && record.action !== 'FUNDING')
        .reduce((sum, record) => sum + (record.openedTimelineId ? 1 : 0) + (record.closedTimelineId ? 1 : 0), 0),
    );
    const crossTarget = dataset.journals.find(leg => leg.trade_record_id === 'cross-dup');
    if (crossTarget?.campaign_id === campaign.id) {
      const donor = dataset.filledOrders.filter(order => order.id === 'cross-dup').at(-1)!;
      expect(evidence.campaignPositionIds.has(donor.positionId as string)).toBe(true);
    }
  });
});
