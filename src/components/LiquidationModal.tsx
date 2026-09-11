import { AlertTriangle, X } from 'lucide-react';
import { liquidationNoticeCopy, type LiquidationDetails } from '@/lib/liquidationNotice';

interface Props {
  open: boolean;
  onClose: () => void;
  details?: LiquidationDetails;
}

export function LiquidationModal({ open, onClose, details }: Props) {
  if (!open) return null;
  // 逐仓与全仓的强平是两回事：只接管一笔 vs 接管全部全仓，破产价结算 vs 市价 + 0.5% 强平费。
  const copy = liquidationNoticeCopy(details?.scope, details?.liquidatedPositions);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md mx-4 rounded-2xl border-2 border-destructive bg-card shadow-2xl overflow-hidden">
        {/* Red header */}
        <div className="bg-destructive/20 border-b border-destructive/30 px-6 py-5 text-center">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-2 animate-pulse" />
          <h2 className="text-xl font-bold text-destructive">🚨 爆仓通知</h2>
          <p className="text-sm text-destructive/80 mt-1">Liquidation Alert</p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-foreground text-center leading-relaxed">
            {copy.lead}<span className="font-bold text-destructive">{copy.emphasis}</span>{copy.tail}
          </p>

          {details && (
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="bg-destructive/10 rounded-lg p-3 text-center">
                <div className="text-muted-foreground mb-1">清算仓位</div>
                <div className="text-base font-bold text-destructive">{details.liquidatedPositions}</div>
              </div>
              <div className="bg-destructive/10 rounded-lg p-3 text-center">
                <div className="text-muted-foreground mb-1">清算损失</div>
                <div className="text-base font-bold text-destructive">
                  -{details.lostAmount.toFixed(2)} USDT
                </div>
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground text-center">
            {copy.footnote}
          </p>
        </div>

        {/* Close button */}
        <div className="px-6 pb-5">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-destructive text-destructive-foreground font-medium text-sm hover:bg-destructive/90 transition-colors"
          >
            我已知晓
          </button>
        </div>

        <button onClick={onClose} className="absolute top-3 right-3 text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
