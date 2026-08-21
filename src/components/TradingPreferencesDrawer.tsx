import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { MarginMode } from '@/types/trading';
import {
  clampPrefLeverage,
  LEVERAGE_MARKS,
  MAX_PREF_LEVERAGE,
  MIN_PREF_LEVERAGE,
  type TradingPreferences,
} from '@/lib/tradingPreferences';

type Page = 'root' | 'defaults' | 'leverage';

interface Props {
  open: boolean;
  onClose: () => void;
  prefs: TradingPreferences;
  onChange: (next: TradingPreferences) => void;
}

/** 抽屉里的一行「设置项 → 下一层」。 */
function Row({ label, value, onClick }: { label: string; value?: string; onClick?: () => void }) {
  const disabled = !onClick;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? '本系统暂无对应设置' : undefined}
      className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-4 py-3 text-left text-[13px] transition-colors enabled:hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="text-foreground">{label}</span>
      <span className="flex items-center gap-1 text-muted-foreground">
        {value && <span className="text-[12px]">{value}</span>}
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted'}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-card shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  );
}

export function TradingPreferencesDrawer({ open, onClose, prefs, onChange }: Props) {
  const [page, setPage] = useState<Page>('root');
  // 杠杆页是「草稿 + 确认」：与币安一致，点确认才落盘
  const [draftLeverage, setDraftLeverage] = useState(prefs.defaultLeverage);
  const [draftMode, setDraftMode] = useState<MarginMode>(prefs.defaultMarginMode);
  const [draftUse, setDraftUse] = useState(prefs.useDefaultLeverage);

  useEffect(() => {
    if (!open) return;
    setPage('root');
    setDraftLeverage(prefs.defaultLeverage);
    setDraftMode(prefs.defaultMarginMode);
    setDraftUse(prefs.useDefaultLeverage);
  }, [open, prefs]);

  if (!open) return null;

  const title = page === 'root' ? '交易偏好' : page === 'defaults' ? '默认交易设置' : '默认杠杆和保证金模式';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        data-testid="trading-prefs-drawer"
        className="flex h-full w-full max-w-[420px] flex-col bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-3">
          {page !== 'root' && (
            <button
              type="button"
              data-testid="prefs-back"
              aria-label="返回"
              onClick={() => setPage(page === 'leverage' ? 'defaults' : 'root')}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {page === 'root' && (
            <>
              <div className="px-4 pb-1 pt-3 text-[11px] text-muted-foreground">交易配置</div>
              <Row label="下单确认" value={prefs.orderConfirm ? '开' : '关'}
                   onClick={() => onChange({ ...prefs, orderConfirm: !prefs.orderConfirm })} />
              <Row label="默认交易设置" onClick={() => setPage('defaults')} />
              {/* 以下为币安有、本系统无对应功能的项：保留位置但置灰，
                  避免让人以为漏做，也不假装可点 */}
              <Row label="账户模式" value="默认交易账户" />
              <Row label="仓位模式" value="单向持仓" />
              <Row label="资产模式" value="单一资产" />
              <Row label="价差保护" />
              <Row label="订单修改" />
              <Row label="通知设置" />
              <Row label="涨跌幅与图表时区" />
            </>
          )}

          {page === 'defaults' && (
            <>
              <Row label="默认杠杆和保证金模式" onClick={() => setPage('leverage')} />
              <Row label="默认触发类型" value="最新价格" />
            </>
          )}

          {page === 'leverage' && (
            <div className="space-y-5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-foreground">启用应用默认杠杆</span>
                <Toggle checked={draftUse} onChange={setDraftUse} label="启用应用默认杠杆" />
              </div>

              <div className={draftUse ? '' : 'pointer-events-none opacity-40'}>
                <div className="mb-2 text-[13px] font-medium text-foreground">1. 默认杠杆</div>
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <button
                    type="button"
                    aria-label="减少杠杆"
                    onClick={() => setDraftLeverage(v => clampPrefLeverage(v - 1))}
                    className="px-2 text-lg text-muted-foreground transition-colors hover:text-foreground"
                  >
                    −
                  </button>
                  <span data-testid="pref-leverage-value" className="font-mono text-[15px] font-semibold text-foreground">
                    {draftLeverage}x
                  </span>
                  <button
                    type="button"
                    aria-label="增加杠杆"
                    onClick={() => setDraftLeverage(v => clampPrefLeverage(v + 1))}
                    className="px-2 text-lg text-muted-foreground transition-colors hover:text-foreground"
                  >
                    +
                  </button>
                </div>
                <input
                  type="range"
                  min={MIN_PREF_LEVERAGE}
                  max={MAX_PREF_LEVERAGE}
                  step={1}
                  value={draftLeverage}
                  onChange={e => setDraftLeverage(clampPrefLeverage(parseInt(e.target.value, 10)))}
                  aria-label="默认杠杆"
                  className="mt-3 w-full accent-[#F0B90B]"
                />
                <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
                  {LEVERAGE_MARKS.map(m => (
                    <button key={m} type="button" onClick={() => setDraftLeverage(m)} className="hover:text-foreground">
                      {m}x
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-[13px] font-medium text-foreground">2. 默认保证金模式</div>
                <div className="grid grid-cols-2 gap-3">
                  {(['cross', 'isolated'] as MarginMode[]).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      data-testid={`pref-margin-${mode}`}
                      onClick={() => setDraftMode(mode)}
                      className={`rounded-md border py-2 text-[13px] transition-colors ${
                        draftMode === mode
                          ? 'border-foreground text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {mode === 'cross' ? '全仓' : '逐仓'}
                    </button>
                  ))}
                </div>
              </div>

              <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                <li>· 需访问该币对交易页面后，修改才会生效</li>
                <li>· 若您有未平仓位或挂单，此设置将不适用</li>
                <li>· 若您的默认设置杠杆超过该币对允许的上限，则此设置无效</li>
                <li>· 本系统训练阶段强制逐仓：选择全仓时下单仍会被硬阻断</li>
              </ul>

              <button
                type="button"
                data-testid="pref-confirm"
                onClick={() => {
                  onChange({
                    ...prefs,
                    useDefaultLeverage: draftUse,
                    defaultLeverage: clampPrefLeverage(draftLeverage),
                    defaultMarginMode: draftMode,
                  });
                  setPage('defaults');
                }}
                className="w-full rounded-md bg-primary py-2.5 text-[14px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                确认
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
