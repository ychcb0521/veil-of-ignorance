import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountInfo } from '@/components/AccountInfo';
import type { Position } from '@/types/trading';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { initial_capital: 10_000 } }) }));

/**
 * 顶栏的风险率 = 维持保证金 ÷ 总权益，维持保证金按仓位的风险模型取（positionMaintenanceMarginUsd）。
 * KAITOUSDT 60,000 @1.0、10x：分层 60,000 × 5% − 1,450 = 1,550；旧仓位 60,000 × 0.4% = 240。钱包 10,000、现价 1.0。
 */
const position = (over: Partial<Position> = {}): Position => ({
  id: 'p', side: 'LONG', quantity: 60_000, entryPrice: 1, leverage: 10, marginMode: 'isolated',
  settlementMode: 'usdt', settlementAsset: 'USDT', margin: 6_000, isolatedMargin: 6_000, openTime: 1,
  ...over,
} as Position);

const riskRate = () => screen.getByText('风险率').parentElement?.textContent ?? '';

describe('AccountInfo：风险率里的维持保证金按仓位的风险模型算', () => {
  it('分层仓位：1,550 ÷ 10,000 = 15.5%', () => {
    render(<AccountInfo balance={10_000} priceMap={{ KAITOUSDT: 1 }}
      positionsMap={{ KAITOUSDT: [position({ riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' })] }} />);
    expect(riskRate()).toContain('15.5%');
  });

  it('更新前的仓位：240 ÷ 10,000 = 2.4%', () => {
    render(<AccountInfo balance={10_000} priceMap={{ KAITOUSDT: 1 }} positionsMap={{ KAITOUSDT: [position()] }} />);
    expect(riskRate()).toContain('2.4%');
  });

  it('混着两种：各按各的再相加（1,550 + 240）÷ 10,000 = 17.9%', () => {
    render(<AccountInfo balance={10_000} priceMap={{ KAITOUSDT: 1 }} positionsMap={{
      KAITOUSDT: [position({ riskModel: 'binance-tiers-v1', riskSymbol: 'KAITOUSDT' }), position({ id: 'q' })],
    }} />);
    expect(riskRate()).toContain('17.9%');
  });
});

/**
 * 【复核】顶栏「可用余额」与下单面板、引擎同一个数（lib/availableBalance）：余额 − Σ全仓保证金。
 * 逐仓保证金开仓时已经从余额扣掉，不再减一次。
 */
describe('AccountInfo：可用余额与引擎同一个口径', () => {
  const available = () => screen.getByText(/可用余额/).parentElement?.textContent ?? '';

  it('钱包 10,000、逐仓仓位保证金 6,000：可用 10,000（不是 4,000）；另有 1,000 全仓保证金时 9,000', () => {
    const { unmount } = render(<AccountInfo balance={10_000} priceMap={{ KAITOUSDT: 1 }} positionsMap={{ KAITOUSDT: [position()] }} />);
    expect(available()).toContain('10,000.00');
    unmount();
    render(<AccountInfo balance={10_000} priceMap={{ KAITOUSDT: 1 }}
      positionsMap={{ KAITOUSDT: [position(), position({ id: 'c', marginMode: 'cross', margin: 1_000, isolatedMargin: undefined })] }} />);
    expect(available()).toContain('9,000.00');
  });
});
