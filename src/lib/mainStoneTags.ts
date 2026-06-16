/**
 * 主石头（Main Stone）：复盘时为"这单背后真正的恐惧或贪婪原型"打的可统计标签。
 *
 * 与 `PainTag`（开仓时的情绪自评）刻意分开：
 *   - PainTag 关注的是"下单那一刻你感觉如何"（情绪），用于事前自检；
 *   - MainStoneTag 关注的是"事后回看，主导这单的最深一层的恐惧/贪婪原型是什么"（动机），
 *     用于事后归因和"同一块石头反复出现"的体检。
 *
 * 标签 ID 沿用 `PainTag` 的命名（如 fomo / greed / sunk_cost），方便后续做交叉分析：
 *   开仓前自标的情绪 vs 事后回看的主石头，是不是同一种？
 */

export type MainStoneTag =
  // ===== 恐惧原型 =====
  | 'fear_of_loss'
  | 'fear_giveback'
  | 'fomo'
  | 'fear_missing'
  | 'panic'
  | 'anxiety'
  | 'shame'
  | 'self_pity'
  // ===== 贪婪原型 =====
  | 'greed'
  | 'jackpot_fantasy'
  | 'overconfidence'
  | 'prove_self'
  | 'deprivation'
  | 'revenge'
  // ===== 持仓后才显形的自我保护 =====
  | 'sunk_cost'
  | 'unwilling'
  | 'wishful'
  | 'denial'
  | 'stubborn_hold'
  | 'rationalization'
  // ===== 虚假掌控 =====
  | 'false_safety'
  | 'false_control'
  | 'boredom';

export type MainStoneFamily = 'fear' | 'greed' | 'self_protect' | 'false_control';

export interface MainStoneMeta {
  label: string;
  family: MainStoneFamily;
  /** 一句话点穿：这块石头通常长什么样。 */
  oneLine: string;
}

export const MAIN_STONE_META: Record<MainStoneTag, MainStoneMeta> = {
  // ===== 恐惧原型 =====
  fear_of_loss:    { label: '怕亏',         family: 'fear',         oneLine: '怕账户数字往下走，所以提前止盈或拒绝按预案承担风险。' },
  fear_giveback:   { label: '怕回吐',       family: 'fear',         oneLine: '有浮盈就怕利润消失，到手为安压倒了原计划。' },
  fomo:            { label: '踏空恐惧',     family: 'fear',         oneLine: '怕错过别人正在赚的钱，所以宁可买在不该买的位置。' },
  fear_missing:    { label: '怕落后',       family: 'fear',         oneLine: '不是这单的赔率诱人，是不做这单的"空仓焦虑"在驱动。' },
  panic:           { label: '惊慌',         family: 'fear',         oneLine: '剧烈波动时大脑直接接管动作，先了再说。' },
  anxiety:         { label: '弥散焦虑',     family: 'fear',         oneLine: '不针对这一笔，是更早就憋着的不安在借这单宣泄。' },
  shame:           { label: '羞耻',         family: 'fear',         oneLine: '怕被看见错，所以提前止盈"保住面子"，或扛单"不能承认自己错"。' },
  self_pity:       { label: '自怜',         family: 'fear',         oneLine: '"反正我总是倒霉"——把决策权交给受害者剧本。' },

  // ===== 贪婪原型 =====
  greed:           { label: '贪',           family: 'greed',        oneLine: '已经赚了还想再多一点，忽视了原本划好的边界。' },
  jackpot_fantasy: { label: '暴富幻想',     family: 'greed',        oneLine: '把这单想成翻身仗，止损被"万一是它"压住。' },
  overconfidence:  { label: '过度自信',     family: 'greed',        oneLine: '高估自己的判断力和控制力，所以加仓或砍止损。' },
  prove_self:      { label: '证明自己',     family: 'greed',        oneLine: '交易不是为了机会，是为了证明上一次判断没错。' },
  deprivation:     { label: '被剥夺感',     family: 'greed',        oneLine: '"差点到手就走了"——为了补这份被剥夺感而追单。' },
  revenge:         { label: '复仇',         family: 'greed',        oneLine: '想把上一笔亏掉的立刻赚回来，节奏交给了对手。' },

  // ===== 持仓后才显形的自我保护 =====
  sunk_cost:       { label: '沉没成本',     family: 'self_protect', oneLine: '"已经亏这么多了，再扛一下就回来"——继续投入是为了过去。' },
  unwilling:       { label: '不甘心',       family: 'self_protect', oneLine: '不是结构告诉你留，是情绪不愿意承认这单结束。' },
  wishful:         { label: '侥幸',         family: 'self_protect', oneLine: '明知结构不对，但希望行情救回来。' },
  denial:          { label: '否认',         family: 'self_protect', oneLine: '市场已经反馈错误，大脑拒绝看见。' },
  stubborn_hold:   { label: '死扛',         family: 'self_protect', oneLine: '不再基于策略，只靠忍耐持仓。' },
  rationalization: { label: '合理化',       family: 'self_protect', oneLine: '事后给一堆理由让自己"显得没错"，掩盖真实动机。' },

  // ===== 虚假掌控 =====
  false_safety:    { label: '虚假安心',     family: 'false_control', oneLine: '"大家都这么做"——用从众感替代验证。' },
  false_control:   { label: '虚假掌控',     family: 'false_control', oneLine: '用频繁操作安抚焦虑，误以为自己在掌控局面。' },
  boredom:         { label: '无聊',         family: 'false_control', oneLine: '不是机会出现，是自己想找点事做。' },
};

export const MAIN_STONE_FAMILY_META: Record<MainStoneFamily, { title: string; accent: string; intro: string }> = {
  fear:           { title: '恐惧侧',     accent: '#F6465D', intro: '动机是想"少受伤"。' },
  greed:          { title: '贪婪侧',     accent: '#F0B90B', intro: '动机是想"多拿一点"。' },
  self_protect:   { title: '自我保护',   accent: '#D89B00', intro: '持仓之后才显形：保护的是过去的自己。' },
  false_control:  { title: '虚假掌控',   accent: '#9AA0A6', intro: '不是真的看见机会，是想用动作压住不确定。' },
};

export const MAIN_STONE_ORDER: MainStoneFamily[] = ['fear', 'greed', 'self_protect', 'false_control'];

/** 把全部主石头按 family 分组，给 UI 做分块渲染。 */
export function groupMainStonesByFamily(): Array<{
  family: MainStoneFamily;
  meta: typeof MAIN_STONE_FAMILY_META[MainStoneFamily];
  stones: Array<{ id: MainStoneTag; meta: MainStoneMeta }>;
}> {
  return MAIN_STONE_ORDER.map(family => ({
    family,
    meta: MAIN_STONE_FAMILY_META[family],
    stones: (Object.entries(MAIN_STONE_META) as Array<[MainStoneTag, MainStoneMeta]>)
      .filter(([, meta]) => meta.family === family)
      .map(([id, meta]) => ({ id, meta })),
  }));
}

/** 把 tag id 列表稳健地转回标签数组（忽略未知 id，保留顺序）。 */
export function normalizeMainStoneTags(raw: unknown): MainStoneTag[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: MainStoneTag[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    if (seen.has(value)) continue;
    if (!(value in MAIN_STONE_META)) continue;
    seen.add(value);
    result.push(value as MainStoneTag);
  }
  return result;
}
