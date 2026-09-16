import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import type {
  CampaignCounterfactualChangeSummary,
  CampaignCounterfactualLegChange,
  CampaignCounterfactualManualLeg,
  LegRole,
} from '@/types/journal';

/**
 * 「这次运行到底改了什么」——把编辑器基线（buildManualLegs 的输出）与本次送进引擎的手动腿逐腿对比。
 *
 * 之前每一次运行都叫「手动调整」，两次运行只差一个 created_at 的分钟数，列表上根本分不出谁是谁；
 * 这里在运行那一刻把差异算出来随 params 落库（jsonb，不加列），默认分支名也从它来。
 *
 * 四种改动：
 *   · edited   基线里有、本次也跑了，但某些字段不同（changedFields 列出字段名）；
 *   · added    基线里没有、本次新增的腿；
 *   · removed  基线里有、编辑器里已经删掉的腿；
 *   · disabled 基线里有、编辑器里还在但被停用（没送进引擎）。
 * 停用与删除要分开，就得看编辑器里的全部腿（含停用），只看 params.manual_legs（仅启用）分不出来。
 * 「挂单中」的保护单被切成「已成交」（或切回）也是一次 edited：字段名 filled，缺省按已成交比。
 */

/** 分支名与改动摘要短句的上限（与 createCounterfactual 的 label.slice(0, 20) 同一条线）。 */
export const COUNTERFACTUAL_NAME_MAX_LENGTH = 20;

/** 用户在编辑器里能改的字段；结算方式、面值、实际成交结果是 buildManualLegs 抄来的，不算改动。 */
type ComparableField = Exclude<
  keyof CampaignCounterfactualManualLeg,
  'id' | 'enabled' | 'settlement_mode' | 'contract_size_usd' | 'actual'
>;

const FIELD_ORDER: ComparableField[] = [
  'filled',
  'leg_role',
  'direction',
  'open_time',
  'close_time',
  'entry_price',
  'exit_price',
  'size_usdt',
  'leverage',
];

const FIELD_LABELS: Record<ComparableField, string> = {
  filled: '成交',
  leg_role: '角色',
  direction: '方向',
  open_time: '开仓时间',
  close_time: '平仓时间',
  entry_price: '开仓价',
  exit_price: '平仓价',
  size_usdt: '仓位',
  leverage: '杠杆',
};

const NUMBER_EPSILON = 1e-9;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

/** 反事实分支统一用「MM-DD HH:mm」（本地时区）：默认分支名、列表行与运行时刻共用。 */
export function formatCounterfactualStamp(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function roleLabel(role: string): string {
  return LEG_ROLE_LABELS[role as LegRole] ?? role;
}

function directionLabel(direction: CampaignCounterfactualManualLeg['direction']): string {
  return direction === 'short' ? '空' : '多';
}

function timeMs(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** filled 缺省 = 已成交（老行、成交过的腿都不写这个字段）。 */
function isFilled(leg: CampaignCounterfactualManualLeg): boolean {
  return leg.filled !== false;
}

function fieldEqual(field: ComparableField, a: CampaignCounterfactualManualLeg, b: CampaignCounterfactualManualLeg): boolean {
  if (field === 'filled') return isFilled(a) === isFilled(b);
  const left = a[field];
  const right = b[field];
  if (field === 'open_time' || field === 'close_time') {
    const leftMs = timeMs(String(left));
    const rightMs = timeMs(String(right));
    if (leftMs == null || rightMs == null) return String(left) === String(right);
    return leftMs === rightMs;
  }
  if (typeof left === 'number' && typeof right === 'number') {
    if (!Number.isFinite(left) || !Number.isFinite(right)) return Object.is(left, right);
    return Math.abs(left - right) <= NUMBER_EPSILON;
  }
  return left === right;
}

function formatFieldValue(field: ComparableField, leg: CampaignCounterfactualManualLeg): string {
  switch (field) {
    case 'filled': return isFilled(leg) ? '已成交' : '未成交';
    case 'leg_role': return roleLabel(leg.leg_role);
    case 'direction': return directionLabel(leg.direction);
    case 'open_time': return formatCounterfactualStamp(leg.open_time);
    case 'close_time': return formatCounterfactualStamp(leg.close_time);
    case 'entry_price': return String(leg.entry_price);
    case 'exit_price': return String(leg.exit_price);
    case 'size_usdt': return `${leg.size_usdt} USDT`;
    case 'leverage': return `${leg.leverage}x`;
    default: return String(leg[field]);
  }
}

function changedFieldsBetween(before: CampaignCounterfactualManualLeg, after: CampaignCounterfactualManualLeg): ComparableField[] {
  // 两边都是没成交的挂单时，平仓时间只是副本给的兜底（不持有、不计钱），不算改动。
  const bothUnfilled = !isFilled(before) && !isFilled(after);
  return FIELD_ORDER
    .filter(field => !(bothUnfilled && field === 'close_time'))
    .filter(field => !fieldEqual(field, before, after));
}

function describeAddedLeg(leg: CampaignCounterfactualManualLeg): string {
  return `增 ${roleLabel(leg.leg_role)}：${directionLabel(leg.direction)} `
    + `${formatCounterfactualStamp(leg.open_time)} → ${formatCounterfactualStamp(leg.close_time)}，`
    + `${leg.entry_price} → ${leg.exit_price}，${leg.size_usdt} USDT`;
}

function describeEditedLeg(
  before: CampaignCounterfactualManualLeg,
  after: CampaignCounterfactualManualLeg,
  fields: ComparableField[],
): string {
  const parts = fields.map(field => `${FIELD_LABELS[field]} ${formatFieldValue(field, before)} → ${formatFieldValue(field, after)}`);
  return `改 ${roleLabel(before.leg_role)}：${parts.join('；')}`;
}

function countPart(prefix: string, count: number): string | null {
  return count > 0 ? `${prefix}${count}腿` : null;
}

/** ≤ 20 字的一句话：单腿改动写「角色 字段」，多腿写「改2腿·增1腿」。 */
function buildShortLine(
  changes: Array<CampaignCounterfactualLegChange & { fields: ComparableField[] }>,
): string {
  if (changes.length === 0) return '未改动';
  if (changes.length === 1) {
    const [change] = changes;
    const role = roleLabel(change.role);
    const candidate = change.kind === 'edited'
      ? `${role} ${change.fields.map(field => FIELD_LABELS[field]).join('·')}`
      : change.kind === 'added'
        ? `增 ${role}`
        : change.kind === 'removed'
          ? `删 ${role}`
          : `停用 ${role}`;
    if (candidate.length <= COUNTERFACTUAL_NAME_MAX_LENGTH) return candidate;
  }
  const counts = {
    edited: changes.filter(change => change.kind === 'edited').length,
    added: changes.filter(change => change.kind === 'added').length,
    removed: changes.filter(change => change.kind === 'removed').length,
    disabled: changes.filter(change => change.kind === 'disabled').length,
  };
  const summary = [
    countPart('改', counts.edited),
    countPart('增', counts.added),
    countPart('删', counts.removed),
    countPart('停', counts.disabled),
  ].filter((part): part is string => part != null).join('·');
  return summary.slice(0, COUNTERFACTUAL_NAME_MAX_LENGTH);
}

/**
 * @param baselineLegs 编辑器重置时的基线（buildManualLegs 输出）。
 * @param editorLegs   编辑器当前的全部腿（含停用），用来区分「停用」与「删除」；拿不到时传 runLegs。
 * @param runLegs      真正送进引擎的腿（params.manual_legs，仅启用）。
 */
export function buildCounterfactualChangeSummary(
  baselineLegs: CampaignCounterfactualManualLeg[],
  editorLegs: CampaignCounterfactualManualLeg[],
  runLegs: CampaignCounterfactualManualLeg[],
): CampaignCounterfactualChangeSummary {
  const editorById = new Map(editorLegs.map(leg => [leg.id, leg]));
  const runById = new Map(runLegs.map(leg => [leg.id, leg]));
  const baselineIds = new Set(baselineLegs.map(leg => leg.id));
  const changes: Array<CampaignCounterfactualLegChange & { fields: ComparableField[]; line: string }> = [];

  for (const baseline of baselineLegs) {
    const ran = runById.get(baseline.id);
    if (ran) {
      const fields = changedFieldsBetween(baseline, ran);
      if (fields.length === 0) continue;
      changes.push({
        id: baseline.id,
        role: baseline.leg_role,
        kind: 'edited',
        changedFields: fields,
        fields,
        line: describeEditedLeg(baseline, ran, fields),
      });
      continue;
    }
    const inEditor = editorById.get(baseline.id);
    if (inEditor && !inEditor.enabled) {
      changes.push({
        id: baseline.id,
        role: baseline.leg_role,
        kind: 'disabled',
        changedFields: [],
        fields: [],
        line: `停用 ${roleLabel(baseline.leg_role)}`,
      });
      continue;
    }
    changes.push({
      id: baseline.id,
      role: baseline.leg_role,
      kind: 'removed',
      changedFields: [],
      fields: [],
      line: `删 ${roleLabel(baseline.leg_role)}`,
    });
  }

  for (const ran of runLegs) {
    if (baselineIds.has(ran.id)) continue;
    changes.push({
      id: ran.id,
      role: ran.leg_role,
      kind: 'added',
      changedFields: [],
      fields: [],
      line: describeAddedLeg(ran),
    });
  }

  return {
    short: buildShortLine(changes),
    lines: changes.map(change => change.line),
    legs: changes.map(({ id, role, kind, changedFields }) => ({ id, role, kind, changedFields })),
  };
}

/** 默认分支名：改动短句 + 空格 + 运行时刻「MM-DD HH:mm」，整体截到 20 字。 */
export function defaultCounterfactualName(
  summary: Pick<CampaignCounterfactualChangeSummary, 'short'> | null | undefined,
  ranAt: Date | string | number,
): string {
  const short = summary?.short?.trim() || '手动调整';
  return `${short} ${formatCounterfactualStamp(ranAt)}`.trim().slice(0, COUNTERFACTUAL_NAME_MAX_LENGTH);
}
