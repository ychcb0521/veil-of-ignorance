import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import calculatorHtml from '@/assets/reductionCalculator.html?raw';

/** 原始本地文件直接嵌入：样式、双向计算和本地保存均不改写。 */
export function ReductionCalculator({ open, onClose, seed }: { open: boolean; onClose: () => void; seed?: { T?: number; S?: number; K?: number; pricePrecision?: number } }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="flex h-[94vh] max-h-[94vh] w-[96vw] max-w-[1120px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1120px]">
        <DialogTitle className="sr-only">减仓计算器</DialogTitle>
        <iframe title="减仓计算器 · X / T 双向计算" srcDoc={calculatorHtml} className="h-full w-full flex-1 border-0"
          onLoad={(event) => {
            const child = event.currentTarget.contentWindow as (Window & { ReductionCalculator?: { setSeed: (value: typeof seed) => void } }) | null;
            if (seed) child?.ReductionCalculator?.setSeed(seed);
          }} />
      </DialogContent>
    </Dialog>
  );
}
