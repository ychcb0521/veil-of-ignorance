import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { MarginMode } from '@/types/trading';
import {
  clampPrefLeverage,
  LEVERAGE_MARKS,
  MAX_PREF_LEVERAGE,
  MIN_PREF_LEVERAGE,
  ORDER_CONFIRM_ITEMS,
  PANEL_ITEMS,
  type PanelKey,
  type TradingPreferences,
} from '@/lib/tradingPreferences';

/**
 * 交易偏好抽屉 —— 复刻币安合约页右上角 ⋯ 的设置面板。
 *
 * 页面树与币安一致；每一页要么是**真功能**，要么明确标注本系统无对应，
 * 不做点不动的装饰。无对应的项集中在 UNAVAILABLE 里，附上原因，
 * 比悄悄省略诚实——用户能看出「不是漏做，是不适用」。
 */

type Page =
  | 'root' | 'ui'
  | 'orderConfirm' | 'positionMode' | 'defaults' | 'leverage' | 'triggerType'
  | 'orderModify' | 'notify' | 'accountMode' | 'assetMode' | 'priceProtect' | 'timezone';

interface Props {
  open: boolean;
  onClose: () => void;
  prefs: TradingPreferences;
  onChange: (next: TradingPreferences) => void;
  onOpenCoolingOff?: () => void;
  /**
   * 面板显隐的真值由交易页持有（它本来就有盘口开合、P_gap 收展这两个状态）。
   * 抽屉不另存一份——两个真值来源迟早会打架：页内点了关闭、抽屉里还显示开着。
   */
  panels?: Record<PanelKey, boolean>;
  onPanelChange?: (key: PanelKey, visible: boolean) => void;
}

/** 本系统无对应功能的页面：标题 → 原因。展示币安的内容，但说清为何不可用。 */
const UNAVAILABLE: Partial<Record<Page, { title: string; body: string[] }>> = {
  accountMode: {
    title: '账户模式',
    body: [
      '币安在此切换「经典交易」与「统一账户」：后者让现货、U 本位、币本位共享同一份保证金。',
      '本系统只有一个合约账户，不存在多产品共享保证金的场景，因此没有可切换的账户模式。',
      '资产的分布与搬运请用「资产」面板的划转功能。',
    ],
  },
  assetMode: {
    title: '资产模式',
    body: [
      '币安在此切换「单币保证金」与「联合保证金」：后者允许跨保证金资产交易 U 本位合约。',
      '本系统的保证金资产由合约自身的结算方式决定（U 本位用 USDT、币本位用标的币），',
      '不存在多资产联合抵押，因此该模式不适用。',
    ],
  },
  priceProtect: {
    title: '价差保护',
    body: [
      '币安在此开启后：止盈止损到达触发价时，若最新价与标记价的价差超过阈值，则不触发，',
      '以防异常波动误伤止盈止损策略。',
      '本系统的行情来自历史 K 线回放，最新价与标记价同源、不存在价差，该保护无从生效。',
    ],
  },
  timezone: {
    title: '涨跌幅与图表时区',
    body: [
      '币安允许切换 UTC 时区，涨跌幅与图表随之重算。',
      '本系统全局锁定 UTC+8：时间机器、信号库、战役与复盘统计都按这一条时间轴对齐，',
      '可切换时区会让各处口径打架，因此刻意不提供。',
    ],
  },
};

function Row({ label, value, onClick, disabledReason }: {
  label: string; value?: string; onClick?: () => void; disabledReason?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={disabledReason}
      className="flex w-full items-center justify-between gap-3 border-b border-border/50 px-4 py-3 text-left text-[13px] transition-colors hover:bg-secondary"
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
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-card shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function ToggleRow({ label, desc, checked, onChange }: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13px] text-foreground">{label}</div>
        {desc && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** 币安式的双卡选择（仓位模式 / 触发类型都用这个形态）。 */
function CardChoice<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; title: string; desc: string }[];
}) {
  return (
    <div className="space-y-3">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          data-testid={`card-choice-${opt.value}`}
          onClick={() => onChange(opt.value)}
          className={`w-full rounded-lg border p-4 text-left transition-colors ${
            value === opt.value ? 'border-foreground' : 'border-border hover:bg-secondary/50'
          }`}
        >
          <div className="text-[14px] font-medium text-foreground">{opt.title}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{opt.desc}</p>
        </button>
      ))}
    </div>
  );
}

export function TradingPreferencesDrawer({ open, onClose, prefs, onChange, onOpenCoolingOff, panels, onPanelChange }: Props) {
  const [page, setPage] = useState<Page>('root');
  const [draftLeverage, setDraftLeverage] = useState(prefs.defaultLeverage);
  const [draftMode, setDraftMode] = useState<MarginMode>(prefs.defaultMarginMode);
  const [draftUse, setDraftUse] = useState(prefs.useDefaultLeverage);

  // 只在「打开」的那一刻回到首页并播种草稿。
  // prefs 不能进依赖数组：抽屉自己就是 prefs 的写方，拨一个开关就会把用户弹回首页。
  // 时机认 open 的边沿，取值走 ref 拿最新的 prefs，两者分开。
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    if (!open) return;
    const p = prefsRef.current;
    setPage('root');
    setDraftLeverage(p.defaultLeverage);
    setDraftMode(p.defaultMarginMode);
    setDraftUse(p.useDefaultLeverage);
  }, [open]);

  if (!open) return null;

  const isTab = page === 'root' || page === 'ui';
  const unavailable = UNAVAILABLE[page];
  const title = page === 'orderConfirm' ? '下单确认'
    : page === 'positionMode' ? '仓位模式'
    : page === 'defaults' ? '默认交易设置'
    : page === 'leverage' ? '默认杠杆和保证金模式'
    : page === 'triggerType' ? '默认触发类型'
    : page === 'orderModify' ? '订单修改'
    : page === 'notify' ? '通知设置'
    : unavailable?.title ?? '';

  const back = () => {
    setPage(page === 'leverage' || page === 'triggerType' ? 'defaults' : 'root');
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        data-testid="trading-prefs-drawer"
        className="flex h-full w-full max-w-[440px] flex-col bg-card shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-none items-center gap-3 border-b border-border px-4 py-3">
          {!isTab && (
            <button
              type="button"
              data-testid="prefs-back"
              aria-label="返回"
              onClick={back}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {isTab ? (
            <div className="flex items-center gap-5">
              {([['root', '交易偏好'], ['ui', '界面设置']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`prefs-tab-${key}`}
                  onClick={() => setPage(key)}
                  className={`relative pb-1 text-[15px] transition-colors ${
                    page === key ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                  {page === key && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-primary" />}
                </button>
              ))}
            </div>
          ) : (
            <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          )}
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
          {/* ===== 交易偏好 ===== */}
          {page === 'root' && (
            <>
              <div className="px-4 pb-1 pt-3 text-[11px] text-muted-foreground">交易配置</div>
              <Row label="账户模式" value="单一合约账户" onClick={() => setPage('accountMode')} />
              <Row label="下单确认" onClick={() => setPage('orderConfirm')} />
              <Row label="仓位模式" value={prefs.positionMode === 'hedge' ? '双向持仓' : '单向持仓'} onClick={() => setPage('positionMode')} />
              <Row label="资产模式" value="随结算方式" onClick={() => setPage('assetMode')} />
              <Row label="默认交易设置" onClick={() => setPage('defaults')} />
              <Row label="价差保护" onClick={() => setPage('priceProtect')} />
              <Row label="订单修改" onClick={() => setPage('orderModify')} />
              <Row label="通知设置" onClick={() => setPage('notify')} />
              <Row label="涨跌幅与图表时区" value="UTC+8" onClick={() => setPage('timezone')} />

              <div className="px-4 pb-1 pt-4 text-[11px] text-muted-foreground">高级设置</div>
              {onOpenCoolingOff && (
                <Row label="冷静期" onClick={() => { onClose(); onOpenCoolingOff(); }} />
              )}
            </>
          )}

          {/* ===== 界面设置 ===== */}
          {page === 'ui' && (
            <>
              <div className="px-4 pb-1 pt-3 text-[11px] text-muted-foreground">模块显隐</div>
              {PANEL_ITEMS.map(item => (
                <ToggleRow
                  key={item.key}
                  label={item.label}
                  desc={item.desc}
                  checked={panels?.[item.key] ?? true}
                  onChange={v => onPanelChange?.(item.key, v)}
                />
              ))}
              <div className="p-4">
                <button
                  type="button"
                  data-testid="reset-layout"
                  onClick={() => PANEL_ITEMS.forEach(item => onPanelChange?.(item.key, true))}
                  className="w-full rounded-md border border-border py-2.5 text-[13px] text-foreground transition-colors hover:bg-secondary"
                >
                  重置为默认布局
                </button>
              </div>
              <div className="border-t border-border/50 px-4 py-4">
                <div className="text-[13px] text-foreground">颜色偏好设置</div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  币安可在此切换「绿涨红跌 / 红涨绿跌」。本系统全局锁定<span className="text-foreground">绿涨红跌</span>：
                  K 线、持仓盈亏、战役复盘与执行力积分的配色是同一套语义，
                  半途换向会让历史截图与复盘记录的红绿含义前后不一致。
                </p>
              </div>
              <p className="px-4 pb-4 text-[11px] leading-relaxed text-muted-foreground">
                * 币安在此还可隐藏图表、下单、仓位、最新成交、保证金比率等模块。
                本系统的图表 / 下单 / 仓位是交易页骨架，藏了就无法交易；
                「最新成交」「保证金比率」本系统没有对应模块，因此都不列出。
              </p>
            </>
          )}

          {/* ===== 下单确认 ===== */}
          {page === 'orderConfirm' && (
            <>
              {ORDER_CONFIRM_ITEMS.map(item => (
                <ToggleRow
                  key={item.key}
                  label={item.label}
                  checked={prefs.orderConfirm[item.key]}
                  onChange={v => onChange({ ...prefs, orderConfirm: { ...prefs.orderConfirm, [item.key]: v } })}
                />
              ))}
              <p className="p-4 text-[11px] leading-relaxed text-muted-foreground">
                * 开启订单确认功能后，每次提交该类型订单时都会跳出确认弹窗。
                注意：<span className="text-foreground">决策记录模式</span>下每笔下单本就强制走下单前快照，不受此设置影响。
              </p>
            </>
          )}

          {/* ===== 仓位模式 ===== */}
          {page === 'positionMode' && (
            <div className="space-y-4 p-4">
              <CardChoice
                value={prefs.positionMode}
                onChange={v => onChange({ ...prefs, positionMode: v })}
                options={[
                  { value: 'oneway', title: '单向持仓', desc: '单向持仓模式下，一个合约只允许持有一个方向的仓位。' },
                  { value: 'hedge', title: '双向持仓', desc: '双向持仓模式下，一个合约可允许同时持有多空两个方向的仓位，并且同一合约下不同方向仓位风险对冲。' },
                ]}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                * 当您有未平仓位或未结订单时，无法调整持仓模式。
                本系统的<span className="text-foreground">主仓做多 + 对冲做空</span>打法依赖双向持仓，
                切成单向会让对冲腿无法与主力共存。
              </p>
            </div>
          )}

          {/* ===== 默认交易设置 ===== */}
          {page === 'defaults' && (
            <>
              <Row label="默认杠杆和保证金模式" onClick={() => setPage('leverage')} />
              <Row
                label="默认触发类型"
                value={prefs.defaultTriggerType === 'LAST' ? '最新价格' : '标记价格'}
                onClick={() => setPage('triggerType')}
              />
            </>
          )}

          {/* ===== 默认触发类型 ===== */}
          {page === 'triggerType' && (
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                {([['LAST', '最新价格'], ['MARK', '标记价格']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    data-testid={`trigger-type-${v}`}
                    onClick={() => onChange({ ...prefs, defaultTriggerType: v })}
                    className={`rounded-md border py-2.5 text-[13px] transition-colors ${
                      prefs.defaultTriggerType === v ? 'border-foreground text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
                <p>* 触发类型决定了止损单何时被触发：</p>
                <p><span className="text-foreground">最新价格</span>：订单基于最新市场价格触发。适合希望订单紧跟实际市场价格的用户。</p>
                <p><span className="text-foreground">标记价格</span>：订单基于标记价格触发。触发时间可能与最新市场价格不同，特别是在市场波动较大时，这有助于避免因异常价格波动而导致的误触发。</p>
                <p>请注意，系统使用标记价格来触发清算。</p>
              </div>
            </div>
          )}

          {/* ===== 默认杠杆和保证金模式 ===== */}
          {page === 'leverage' && (
            <div className="space-y-5 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-foreground">启用应用默认杠杆</span>
                <Toggle checked={draftUse} onChange={setDraftUse} label="启用应用默认杠杆" />
              </div>

              <div className={draftUse ? '' : 'pointer-events-none opacity-40'}>
                <div className="mb-2 text-[13px] font-medium text-foreground">1. 默认杠杆</div>
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <button type="button" aria-label="减少杠杆" onClick={() => setDraftLeverage(v => clampPrefLeverage(v - 1))}
                          className="px-2 text-lg text-muted-foreground transition-colors hover:text-foreground">−</button>
                  <span data-testid="pref-leverage-value" className="font-mono text-[15px] font-semibold text-foreground">{draftLeverage}x</span>
                  <button type="button" aria-label="增加杠杆" onClick={() => setDraftLeverage(v => clampPrefLeverage(v + 1))}
                          className="px-2 text-lg text-muted-foreground transition-colors hover:text-foreground">+</button>
                </div>
                <input
                  type="range" min={MIN_PREF_LEVERAGE} max={MAX_PREF_LEVERAGE} step={1}
                  value={draftLeverage}
                  onChange={e => setDraftLeverage(clampPrefLeverage(parseInt(e.target.value, 10)))}
                  aria-label="默认杠杆"
                  className="mt-3 w-full accent-[#F0B90B]"
                />
                <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
                  {LEVERAGE_MARKS.map(m => (
                    <button key={m} type="button" onClick={() => setDraftLeverage(m)} className="hover:text-foreground">{m}x</button>
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
                        draftMode === mode ? 'border-foreground text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
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

          {/* ===== 订单修改 ===== */}
          {page === 'orderModify' && (
            <>
              <ToggleRow
                label="K线改单"
                desc="启用 K 线改单即可通过图表修改当前委托的价格或数量以及止盈/止损。"
                checked
                onChange={() => {}}
              />
              <p className="p-4 text-[11px] leading-relaxed text-muted-foreground">
                本系统的 K 线改单一直开启：盘面上的委托线可直接拖动改价。
                「改单确认」暂无对应设置。
              </p>
            </>
          )}

          {/* ===== 通知设置 ===== */}
          {page === 'notify' && (
            <p className="p-4 text-[11px] leading-relaxed text-muted-foreground">
              币安在此配置止盈止损触发、资金费用、追加保证金的邮件与推送通知。
              本系统是单机训练环境，触发与成交以页面内的即时提示呈现，不发送外部通知，
              因此该页无可配置项。
            </p>
          )}

          {/* ===== 本系统无对应的页面：展示币安内容 + 说明原因 ===== */}
          {unavailable && (
            <div className="space-y-3 p-4">
              {unavailable.body.map((line, i) => (
                <p key={i} className="text-[12px] leading-relaxed text-muted-foreground">{line}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
