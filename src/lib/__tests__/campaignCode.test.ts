import { describe, expect, it } from 'vitest';
import {
  formatCampaignDisplayCode,
  resolveCampaignAccountName,
} from '@/lib/campaignCode';

describe('campaignCode', () => {
  it('优先使用账户显示名，并将其整理为稳定的编号片段', () => {
    expect(resolveCampaignAccountName({
      displayName: ' 主账户 Alpha ',
      email: 'desk@example.com',
      userId: '12345678-abcd',
    })).toBe('主账户-ALPHA');
  });

  it('显示名缺失时使用登录邮箱前缀，最后回退用户 ID', () => {
    expect(resolveCampaignAccountName({
      email: 'trader.one@example.com',
      userId: '12345678-abcd',
    })).toBe('TRADER-ONE');
    expect(resolveCampaignAccountName({
      userId: '12345678-abcd',
    })).toBe('USER-12345678');
  });

  it('在历史和新式唯一编号中嵌入账户名，同时保留原编号后缀', () => {
    expect(formatCampaignDisplayCode('C00000042', 'desk'))
      .toBe('C-DESK-00000042');
    expect(formatCampaignDisplayCode('C-CF92AC57', 'desk'))
      .toBe('C-DESK-CF92AC57');
  });

  it('重复格式化不会重复加入账户名', () => {
    expect(formatCampaignDisplayCode('C-DESK-CF92AC57', 'desk'))
      .toBe('C-DESK-CF92AC57');
  });

  it('缺少原编号时保留战役 ID 作为唯一后缀', () => {
    expect(formatCampaignDisplayCode(null, 'desk', 'campaign-123'))
      .toBe('C-DESK-CAMPAIGN-123');
  });
});
