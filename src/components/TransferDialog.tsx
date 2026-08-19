import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUpDown, X } from 'lucide-react';
import {
  WALLET_IDS,
  WALLET_LABELS,
  maxTransferable,
  validateTransfer,
  type WalletBalances,
  type WalletId,
} from '@/lib/walletTransfer';

interface Props {
  open: boolean;
  onClose: () => void;
  balances: WalletBalances;
  onTransfer: (from: WalletId, to: WalletId, amount: number) => boolean;
}

const fmt = (v: number) =>
  v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });

/** 币安式钱包选择行：左标题、右下拉。 */
function WalletSelect({
  label, value, exclude, onChange,
}: {
  label: string;
  value: WalletId;
  exclude?: WalletId;
  onChange: (next: WalletId) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <select
        data-testid={`transfer-${label === '从' ? 'from' : 'to'}`}
        value={value}
        onChange={event => onChange(event.target.value as WalletId)}
        className="min-w-0 flex-1 bg-transparent text-right text-sm font-medium text-foreground outline-none"
      >
        {WALLET_IDS.map(id => (
          <option key={id} value={id} disabled={id === exclude}>
            {WALLET_LABELS[id].zh}（{WALLET_LABELS[id].en}）
          </option>
        ))}
      </select>
    </div>
  );
}

export function TransferDialog({ open, onClose, balances, onTransfer }: Props) {
  const [from, setFrom] = useState<WalletId>('futures');
  const [to, setTo] = useState<WalletId>('spot');
  const [amount, setAmount] = useState('');

  // 每次打开都回到初始态，避免残留上一次的输入
  useEffect(() => {
    if (open) {
      setFrom('futures');
      setTo('spot');
      setAmount('');
    }
  }, [open]);

  const max = maxTransferable(balances, from);
  const parsed = Number.parseFloat(amount);
  const check = useMemo(
    () => validateTransfer(balances, { from, to, amount: parsed }),
    [balances, from, to, parsed],
  );
  // 未输入时不报错，只是按钮不可用——刚打开就飘红很难看
  const showError = amount.trim() !== '' && !check.ok;

  if (!open) return null;

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const pick = (next: WalletId, side: 'from' | 'to') => {
    // 选中与另一侧相同的钱包时自动交换，而不是弹错误——币安就是这个手感
    if (side === 'from') {
      if (next === to) setTo(from);
      setFrom(next);
    } else {
      if (next === from) setFrom(to);
      setTo(next);
    }
  };

  const submit = () => {
    if (!check.ok) return;
    if (onTransfer(from, to, check.amount)) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        data-testid="transfer-dialog"
        className="w-full max-w-[380px] rounded-lg border border-border bg-card shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">划转</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2 p-4">
          <WalletSelect label="从" value={from} exclude={to} onChange={next => pick(next, 'from')} />

          <div className="flex justify-center">
            <button
              type="button"
              data-testid="transfer-swap"
              onClick={swap}
              aria-label="交换方向"
              className="rounded-full border border-border bg-background p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <WalletSelect label="到" value={to} exclude={from} onChange={next => pick(next, 'to')} />

          {/* 币种：本平台只有 USDT，固定展示但保留位置，与币安布局一致 */}
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <span className="text-xs text-muted-foreground">币种</span>
            <span className="text-sm font-medium text-foreground">USDT</span>
          </div>

          <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">数量</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                可用 <span data-testid="transfer-available">{fmt(max)}</span> USDT
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                data-testid="transfer-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                placeholder="0.00"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                className="min-w-0 flex-1 bg-transparent font-mono text-base text-foreground outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                data-testid="transfer-max"
                onClick={() => setAmount(String(max))}
                className="shrink-0 text-xs font-semibold text-primary transition-opacity hover:opacity-80"
              >
                最大
              </button>
            </div>
          </div>

          {showError && !check.ok && (
            <p data-testid="transfer-error" className="text-[11px] trading-red">{check.message}</p>
          )}

          <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
            <ArrowDown className="h-3 w-3 shrink-0" />
            <span>账内划转即时到账、不收手续费，不改变账户总资产。</span>
          </div>

          <button
            type="button"
            data-testid="transfer-submit"
            disabled={!check.ok}
            onClick={submit}
            className="mt-1 w-full rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            确认划转
          </button>
        </div>
      </div>
    </div>
  );
}
