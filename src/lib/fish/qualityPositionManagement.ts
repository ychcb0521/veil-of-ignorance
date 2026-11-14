import type { QualityGroup } from './quality';

export const QUALITY_NOTIONAL = 100;
export const QUALITY_POSITION_MANAGEMENT_VERSION = 'holding-position-management-v1' as const;

export interface QualityPositionManagement {
  version: typeof QUALITY_POSITION_MANAGEMENT_VERSION;
  leverage: number;
  notional: number;
}

export const DEFAULT_QUALITY_POSITION_MANAGEMENT: Readonly<QualityPositionManagement> = {
  version: QUALITY_POSITION_MANAGEMENT_VERSION,
  leverage: 5,
  notional: 333,
};

export function validateQualityPositionManagement(settings: QualityPositionManagement): void {
  const { version, leverage, notional } = settings;
  if (version !== QUALITY_POSITION_MANAGEMENT_VERSION) throw Error('无法识别仓位管理版本');
  if (!Number.isFinite(leverage) || leverage < 1) throw Error('杠杆须为不低于 1 的有限数字');
  if (!Number.isFinite(notional) || notional <= 0 || notional / leverage <= 0) throw Error('名义仓位须为大于 0 的有限数字');
}

export function qualityPositionIdentity(settings: QualityPositionManagement) {
  return [settings.version, settings.leverage, settings.notional] as const;
}

export function qualityPositionSize(plan: Pick<QualityGroup, 'positionManagement'>) {
  const { leverage, notional } = plan.positionManagement ?? { leverage: 1, notional: QUALITY_NOTIONAL };
  return { leverage, notional, marginUsdt: notional / leverage };
}
