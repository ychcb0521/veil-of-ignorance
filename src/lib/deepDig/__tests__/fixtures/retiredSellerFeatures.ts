// Frozen former definitions for historical mathematical regression only. Never register as built-ins.
import { sellerNegativeFormula, DEFAULT_POSITIVE, DEFAULT_CONTROL, type DeepDigFeatureDef } from '../../features';

/** DSP·a 标准化版的卖方镜像：卖方主动性加权，向下位移为正；窗口、尺度、EMA 与缺值处理保持一致。 */
export const DOWNWARD_DRIFT_FORMULA = sellerNegativeFormula([
  '# DSP·b 向下推动力量：成交失衡强度 × 卖方权重 × 向下标准化涨跌，再按 hl 小时半衰期平滑',
  '# B / S = 主动买入 / 卖出成交额，Q = B + S；avgh 为基线时长（小时）；最终 b 取负：负值表示向下推动，正值表示向上推动',
  'N = abs(S - B)                 # 主动成交失衡金额',
  'f = ln(1 + N / avg(Q, avgh))   # 失衡金额相对常态成交额的强度',
  'A = (S - B) / Q                # 主动卖方优势',
  'G = 1 + max(A, 0)              # 卖方优势权重',
  'R = -ln(C / prev(C))           # 向下价格位移：下跌为正、上涨为负',
  'Rz = R / sd(R, avgh)           # 相对于本币常态波动的向下位移（均值按 0）',
  'F = nz(f * G * Rz)             # 单根向下推力；无法计算时沿用原算法记 0',
  'b = ema(F, hl, 0)              # 按 hl 小时半衰期指数平滑，从 0 起算',
].join('\n'), 'b');

export const DOWNWARD_DRIFT_DEF: DeepDigFeatureDef = {
  id: 'drift-speed-down-z',
  name: '向下推动力量',
  short: 'DSP·b',
  definition: '成交活动伴随的实际向下价格位移，相对于本币常态波动有多大：主动成交失衡强度 × 卖方优势权重 × 向下涨跌的波动率标准化值，再按半衰期指数平滑。负值表示向下推动、正值表示向上推动，数值越低表示向下推动越强；沿用 DSP·a 标准化版的窗口、平滑、显示倍数与缺值处理。',
  sellerSignVersion: 1,
  formula: DOWNWARD_DRIFT_FORMULA,
  scale: 100,
  unit: '%σ/根',
  positive: DEFAULT_POSITIVE,
  control: DEFAULT_CONTROL,
  source: 'campaigns',
  groupVars: 2,
  builtin: true,
};

/** Seller-initiated pressure only: aggressive selling accompanied by a price decline. */
export const SELLER_PUSH_FORMULA = sellerNegativeFormula([
  '# 卖方主动推动：仅计主动卖出且价格下跌；RMS 按零中心尺度归一化，不是标准 Z 分数',
  'N = abs(B - S)',
  'f = ln(1 + N / avg(Q, avgh))',
  'A = (B - S) / Q',
  'Sa = max(-A, 0)',
  'R = ln(C / prev(C))',
  'Rz = R / sqrt(avg(R * R, avgh))',
  'Dn = max(-Rz, 0)',
  'F = nz(f * Sa * Dn)',
  'bp = ema(F, hl, 0)',
].join('\n'), 'bp');
export const SELLER_PUSH_DEF: DeepDigFeatureDef = {
  id: 'seller-push', name: '卖方主动推动', short: '卖推',
  definition: '只衡量主动卖出伴随下跌的推动：失衡强度 f × 主动卖方份额 Sa × RMS 归一化下跌，再按 hl 半衰期平滑并取负。主动买方主导的下跌不计入主动推动；结果不大于 0，越负表示卖方主动推动越强。',
  formula: SELLER_PUSH_FORMULA, sellerSignVersion: 1,
  scale: 100, unit: '%σ/根', positive: DEFAULT_POSITIVE, control: DEFAULT_CONTROL,
  source: 'campaigns', groupVars: 2, builtin: true,
};

