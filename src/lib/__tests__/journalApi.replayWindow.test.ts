// @vitest-environment jsdom
/**
 * mergeCampaignReplayEvents 的等价性。
 *
 * 列表页每场战役的回放分段原来把同标的全部事件（重仓标的两万条）整个交给 buildReplaySessionFilter；
 * 现在三路归并时只留本场牵涉的那一窗。这里拿随机数据反复核对两件事：
 *   · 归并顺序与「三路拼起来整体稳定排序」逐条相同（窗内），窗是整体排序结果的一个连续切片；
 *   · 裁窗前后 buildReplaySessionFilter 的每个判断（allows / allowsOrder / stampEra / 是否为 null）相同。
 * 随机数据刻意覆盖：多次坐下来、隔了一次坐下来但模拟时刻接着走（不能切）、回落（能切）、
 * 5 秒内的钟差噪声（回落几小时也不切）、上线前 / 后的真实时刻、未盖章的老成交、
 * 开 / 平仓侧的首末锚点、进行中的战役、同一时刻三路并列、一个锚点都没有。
 * 复算 isReplayBreak 的那几行若与 campaignOrderRealTime 里的真函数漂移，这里先红。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildReplaySessionFilter,
  REPLAY_SIM_DROP_TOLERANCE_MS,
  REPLAY_SITTING_GAP_MS,
  STAMP_ROLLOUT_REAL_AT,
  type OrderClockStamp,
  type ReplayEvent,
} from '@/lib/campaignOrderRealTime';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getUser: vi.fn() }, from: vi.fn() },
}));

import { mergeCampaignReplayEvents } from '@/lib/journalApi';

const MIN = 60_000;
const HOUR = 60 * MIN;

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const order = (a: ReplayEvent, b: ReplayEvent) => a.realAt - b.realAt || a.simAt - b.simAt;

interface Lanes {
  records: { events: ReplayEvent[]; recordIds: string[]; anchorRecordIds: Set<string> };
  legs: ReplayEvent[];
  orders: ReplayEvent[];
  campaignOpen: boolean;
  realMin: number;
  realMax: number;
  simMin: number;
  simMax: number;
}

/** 一场随机的回放史：几次坐下来，每次坐下来里成交 / 腿 / 委托事件混着来。 */
function randomLanes(rand: () => number): Lanes {
  const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
  const recordPairs: Array<{ event: ReplayEvent; recordId: string }> = [];
  const legs: ReplayEvent[] = [];
  const orders: ReplayEvent[] = [];
  // 真实时刻落在盖章上线前后各十天，让「上线前证据」的规则也参与
  let realAt = STAMP_ROLLOUT_REAL_AT + (rand() - 0.5) * 20 * 24 * HOUR;
  let simAt = Date.parse('2025-03-01T00:00:00.000Z') + rand() * 30 * 24 * HOUR;
  const realMin = realAt;
  let simMin = simAt;
  let simMax = simAt;
  const sittings = 1 + Math.floor(rand() * 6);
  let recordSeq = 0;
  let previous: ReplayEvent | null = null;
  for (let sitting = 0; sitting < sittings; sitting += 1) {
    if (sitting > 0) {
      // 多数隔开一次坐下来；少数只隔半小时（仍是同一次坐下来）
      realAt += rand() < 0.8 ? REPLAY_SITTING_GAP_MS + 1 + rand() * 6 * HOUR : 30 * MIN;
      const roll = rand();
      if (roll < 0.4) simAt -= REPLAY_SIM_DROP_TOLERANCE_MS + rand() * 8 * HOUR;   // 回落：可切
      else if (roll < 0.55) simAt -= rand() * REPLAY_SIM_DROP_TOLERANCE_MS;        // 容差内的回落：不切
      else if (roll < 0.8) simAt += rand() * 6 * HOUR;                             // 接着往后走：不切
      else simAt += 3 * 24 * HOUR;                                                 // 跳到很后面：不切
    }
    const count = 2 + Math.floor(rand() * 24);
    for (let index = 0; index < count; index += 1) {
      if (previous && rand() < 0.1) {
        // 与上一条同一时刻：三路并列的顺序
        realAt = previous.realAt;
        simAt = previous.simAt;
      } else {
        if (index > 0 || sitting === 0) {
          realAt += rand() < 0.3 ? rand() * 4_000 : 5_000 + rand() * 20 * MIN;
        }
        const drop = rand();
        if (drop < 0.12) simAt -= rand() * 2 * HOUR;
        else if (drop < 0.2) simAt -= rand() * REPLAY_SIM_DROP_TOLERANCE_MS;
        else simAt += rand() * 15 * MIN;
      }
      simMin = Math.min(simMin, simAt);
      simMax = Math.max(simMax, simAt);
      const lane = rand();
      let event: ReplayEvent;
      if (lane < 0.45) {
        const close = rand() < 0.5;
        event = {
          realAt, simAt, anchor: false, kind: close ? 'record-close' : 'record-open',
          ...(close && rand() < 0.25 ? { unstampedOpen: true } : {}),
        };
        recordPairs.push({ event, recordId: `r${recordSeq += 1}` });
      } else if (lane < 0.6) {
        event = { realAt, simAt, anchor: true, kind: pick(['leg-open', 'leg-close']) };
        legs.push(event);
      } else {
        event = { realAt, simAt, anchor: false, kind: pick(['order-create', 'order-end']) };
        orders.push(event);
      }
      previous = event;
    }
  }
  // 本场选中的成交：一段连续的成交里挑几条；一成的用例一条都不选、腿也去掉（没有锚点）
  const anchorRecordIds = new Set<string>();
  const noAnchor = rand() < 0.1;
  if (!noAnchor && recordPairs.length > 0) {
    const from = Math.floor(rand() * recordPairs.length);
    const span = 1 + Math.floor(rand() * 5);
    for (let index = from; index < Math.min(recordPairs.length, from + span); index += 1) {
      if (rand() < 0.7) anchorRecordIds.add(recordPairs[index].recordId);
    }
  }
  const keptLegs = noAnchor ? [] : legs.filter(() => rand() < 0.5);
  recordPairs.sort((a, b) => order(a.event, b.event));
  return {
    records: {
      events: recordPairs.map(pair => pair.event),
      recordIds: recordPairs.map(pair => pair.recordId),
      anchorRecordIds,
    },
    legs: [...keptLegs].sort(order),
    orders: [...orders].sort(order),
    campaignOpen: rand() < 0.3,
    realMin,
    realMax: realAt,
    simMin,
    simMax,
  };
}

/** 不裁窗的口径：三路按 成交 → 腿 → 委托 拼起来整体稳定排序。 */
function fullMerge(lanes: Lanes): ReplayEvent[] {
  const records = lanes.records.events.map((event, index) => (
    lanes.records.anchorRecordIds.has(lanes.records.recordIds[index]) ? { ...event, anchor: true } : event
  ));
  return [...records, ...lanes.legs, ...lanes.orders].sort(order);
}

/** symbolLocalIndex 里按标的预归并好的成交 + 委托（同一时刻成交在前、未标锚点；委托的 recordId 为 null）。 */
function symbolLane(records: { events: ReplayEvent[]; recordIds: string[] }, orders: ReplayEvent[]) {
  const tagged = [
    ...records.events.map((event, index) => ({ event, recordId: records.recordIds[index] as string | null })),
    ...orders.map(event => ({ event, recordId: null })),
  ].sort((a, b) => order(a.event, b.event));
  return { events: tagged.map(item => item.event), recordIds: tagged.map(item => item.recordId) };
}

function randomProbe(rand: () => number, lanes: Lanes): OrderClockStamp {
  const roll = rand();
  const realAt = roll < 0.7
    ? lanes.realMin - HOUR + rand() * (lanes.realMax - lanes.realMin + 2 * HOUR)
    : roll < 0.85 ? (rand() < 0.5 ? null : undefined)
      : lanes.realMax + 10 * 24 * HOUR;
  const simAt = rand() < 0.85 ? lanes.simMin - HOUR + rand() * (lanes.simMax - lanes.simMin + 2 * HOUR) : null;
  const endRoll = rand();
  const endRealAt = endRoll < 0.35 ? null
    : endRoll < 0.65 ? (typeof realAt === 'number' ? realAt : lanes.realMin) + rand() * 5 * HOUR
      : endRoll < 0.85 ? Number.POSITIVE_INFINITY
        : (typeof realAt === 'number' ? realAt : lanes.realMin) - rand() * HOUR;
  const endSimAt = rand() < 0.5 || simAt == null ? null : simAt + (rand() - 0.4) * 2 * HOUR;
  const stampRoll = rand();
  return {
    realAt,
    simAt,
    endRealAt,
    endSimAt,
    endedByFill: rand() < 0.2,
    ...(stampRoll < 0.5 ? {} : { preStampSimAt: stampRoll < 0.75 ? null : lanes.simMin + rand() * (lanes.simMax - lanes.simMin) }),
  };
}

describe('mergeCampaignReplayEvents', () => {
  it('窗是整体稳定排序的连续切片，且分段的每个判断与不裁窗时相同（随机 600 场 × 40 张委托）', () => {
    const rand = mulberry32(20260915);
    let pruned = 0;
    let withoutAnchor = 0;
    for (let round = 0; round < 600; round += 1) {
      const lanes = randomLanes(rand);
      const full = fullMerge(lanes);
      const merged = mergeCampaignReplayEvents(
        symbolLane(lanes.records, lanes.orders), lanes.records.anchorRecordIds, lanes.legs, { campaignOpen: lanes.campaignOpen },
      );
      const context = `round ${round}`;
      const hasAnchor = full.some(event => event.anchor);
      if (!hasAnchor) {
        withoutAnchor += 1;
        expect(merged, context).toEqual([]);
      } else {
        // 窗是 full 的一个连续切片
        const start = full.findIndex((event, index) => (
          index + merged.length <= full.length && merged.every((item, offset) => {
            const candidate = full[index + offset];
            return candidate.realAt === item.realAt && candidate.simAt === item.simAt && candidate.kind === item.kind
              && Boolean(candidate.anchor) === Boolean(item.anchor) && Boolean(candidate.unstampedOpen) === Boolean(item.unstampedOpen);
          })
        ));
        expect(start, context).toBeGreaterThanOrEqual(0);
        if (merged.length < full.length) pruned += 1;
      }
      const expected = buildReplaySessionFilter(full, { campaignOpen: lanes.campaignOpen });
      const actual = buildReplaySessionFilter(merged, { campaignOpen: lanes.campaignOpen });
      expect(actual === null, context).toBe(expected === null);
      if (!expected || !actual) continue;
      expect(actual.stampEra, context).toBe(expected.stampEra);
      for (let probe = 0; probe < 40; probe += 1) {
        const stamp = randomProbe(rand, lanes);
        const label = `${context} probe ${JSON.stringify(stamp)}`;
        expect(actual.allowsOrder(stamp), label).toBe(expected.allowsOrder(stamp));
        if (typeof stamp.realAt === 'number') expect(actual.allows(stamp.realAt), label).toBe(expected.allows(stamp.realAt));
      }
    }
    // 随机数据确实让两条路都走到了：有裁掉的、有没锚点的
    expect(pruned).toBeGreaterThan(60);
    expect(withoutAnchor).toBeGreaterThan(20);
    // 600 场 × 40 张委托各判两遍：单跑两秒多，整个测试集并行时会超过默认的 5 秒
  }, 60_000);

  it('隔了一次坐下来且回落才从那里切；接着走的坐下来不切；已结束且末锚点是平仓侧才裁掉后面', () => {
    const real = STAMP_ROLLOUT_REAL_AT + 24 * HOUR;
    const sim = Date.parse('2025-03-01T00:00:00.000Z');
    const at = (realOffset: number, simOffset: number, kind: ReplayEvent['kind']): ReplayEvent => (
      { realAt: real + realOffset, simAt: sim + simOffset, anchor: false, kind }
    );
    // 坐下来 A（回放到 2h）→ 隔 3h 的坐下来 B 从 0 重来（回落：硬切点）→ 隔 3h 的坐下来 C 接着 B 往后走（不切）→ 隔 3h 的坐下来 D
    const orders = [
      at(0, 0, 'order-create'), at(10 * MIN, HOUR, 'order-end'), at(20 * MIN, 2 * HOUR, 'order-create'),
      at(3 * HOUR + 20 * MIN, 0, 'order-create'), at(3 * HOUR + 30 * MIN, 30 * MIN, 'order-end'),
      at(6 * HOUR + 30 * MIN, 40 * MIN, 'order-create'), at(6 * HOUR + 40 * MIN, 50 * MIN, 'order-end'),
      at(10 * HOUR, 3 * HOUR, 'order-create'),
    ];
    const lane = symbolLane({
      events: [at(6 * HOUR + 35 * MIN, 45 * MIN, 'record-open'), at(6 * HOUR + 38 * MIN, 48 * MIN, 'record-close')],
      recordIds: ['open', 'close'],
    }, orders);
    const anchors = new Set(['open', 'close']);
    const closed = mergeCampaignReplayEvents(lane, anchors, [], { campaignOpen: false });
    // 从 B 起（A 之后回落），到 C 结束（D 之前隔了一次坐下来、末锚点是平仓侧）
    expect(closed.map(event => event.realAt - real)).toEqual([
      3 * HOUR + 20 * MIN, 3 * HOUR + 30 * MIN, 6 * HOUR + 30 * MIN, 6 * HOUR + 35 * MIN, 6 * HOUR + 38 * MIN, 6 * HOUR + 40 * MIN,
    ]);
    expect(closed.filter(event => event.anchor).map(event => event.kind)).toEqual(['record-open', 'record-close']);
    // 进行中的战役：D 也留
    const open = mergeCampaignReplayEvents(lane, anchors, [], { campaignOpen: true });
    expect(open.map(event => event.realAt - real).at(-1)).toBe(10 * HOUR);
    // 末锚点不是平仓侧：D 也留
    const opening = mergeCampaignReplayEvents(lane, new Set(['open']), [], { campaignOpen: false });
    expect(opening.map(event => event.realAt - real).at(-1)).toBe(10 * HOUR);
    // 没有锚点：空
    expect(mergeCampaignReplayEvents(lane, new Set(), [], { campaignOpen: false })).toEqual([]);
  });
});
