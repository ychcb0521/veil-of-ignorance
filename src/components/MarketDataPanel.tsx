/**
 * 盘口模块 —— 订单簿 / 最新成交 / 市场异动 三个页签合并在一个可折叠模块里。
 *
 * 默认折叠：只留一条表头，把纵向空间让给 P_gap。点任一页签即展开到该页签，
 * 点右侧折叠键收起。币安式规范：一个模块只有一个表头，页签在左、控件在右。
 */
import { OrderBook } from '@/components/OrderBook';
import { TradeTape } from '@/components/TradeTape';

export type MarketDataTab = 'orderBook' | 'trades' | 'movers';

const TABS: { key: MarketDataTab; label: string }[] = [
  { key: 'orderBook', label: '订单簿' },
  { key: 'trades', label: '最新成交' },
  { key: 'movers', label: '市场异动' },
];

interface Props {
  symbol: string;
  currentPrice: number;
  pricePrecision: number;
  tab: MarketDataTab;
  onTabChange: (tab: MarketDataTab) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose?: () => void;
}

export function MarketDataPanel({
  symbol,
  currentPrice,
  pricePrecision,
  tab,
  onTabChange,
  collapsed,
  onToggleCollapsed,
  onClose,
}: Props) {
  return (
    <div
      data-testid="market-data-panel"
      data-collapsed={collapsed ? 'true' : 'false'}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-[#1e2329] text-[10px] font-mono select-none"
    >
      {/* 统一表头：页签在左，控件在右 */}
      <div className="group flex-none flex items-center justify-between gap-2 pl-3 pr-2 h-9 border-b border-gray-200 dark:border-[#2b3139]">
        <div className="flex items-center gap-3 h-full min-w-0">
          {TABS.map(item => {
            const active = !collapsed && tab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                data-testid={`market-tab-${item.key}`}
                aria-pressed={active}
                onClick={() => {
                  onTabChange(item.key);
                  // 折叠状态下点页签＝展开到该页签，少一次点击。
                  if (collapsed) onToggleCollapsed();
                }}
                className={`relative flex h-full shrink-0 items-center whitespace-nowrap text-[12px] font-medium transition-colors ${
                  active
                    ? 'text-gray-900 dark:text-[#EAECEF]'
                    : 'text-gray-500 dark:text-[#848e9c] hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {item.label}
                {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-[#fcd535]" />}
              </button>
            );
          })}
        </div>

        <div className="flex flex-none items-center gap-1.5 text-gray-500 dark:text-[#848e9c]">
          <button
            type="button"
            data-testid="market-collapse-toggle"
            aria-expanded={!collapsed}
            title={collapsed ? '展开盘口' : '折叠盘口'}
            onClick={onToggleCollapsed}
            className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-[#2b3139] dark:hover:text-white"
          >
            <svg
              className={`h-3 w-3 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2 4.5l4 4 4-4" />
            </svg>
          </button>
          {onClose && (
            <button
              type="button"
              title="关闭盘口"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded opacity-0 transition-all group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-[#2b3139] dark:hover:text-white"
            >
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === 'orderBook' ? (
            <OrderBook
              symbol={symbol}
              currentPrice={currentPrice}
              pricePrecision={pricePrecision}
              hideHeader
            />
          ) : tab === 'trades' ? (
            <TradeTape currentPrice={currentPrice} pricePrecision={pricePrecision} />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-gray-500 dark:text-[#848e9c]">
              市场异动 · 即将上线
            </div>
          )}
        </div>
      )}
    </div>
  );
}
