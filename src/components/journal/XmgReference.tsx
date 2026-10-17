import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import bFormula from '@/assets/xmg-b-formula.jpg';
import growthFormula from '@/assets/xmg-growth-formula.jpg';
import { XMG_ORIGINAL_TEXT } from './xmgOriginalText';

export function XmgReference() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" data-testid="campaign-xmg" className="mr-1.5 inline-flex h-7 shrink-0 items-center rounded border border-amber-500/20 bg-amber-500/[0.06] px-2 font-mono text-[11px] font-medium tracking-wide text-amber-800 transition-colors hover:bg-amber-500/[0.12] dark:text-amber-300">xMG</button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-32px)] max-w-3xl overflow-y-auto gap-5 p-5 sm:p-7">
        <DialogHeader>
          <DialogTitle className="font-mono text-xl tracking-wide">xMG</DialogTitle>
          <DialogDescription>秘密武器</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <img src={bFormula} alt="b_最终 = [Q初/2 (1+α1)(1+α2)…(1+α_m)(F-K_m)] / L0" className="h-auto w-full rounded border border-border bg-white" />
          <img src={growthFormula} alt="W = (1+bx)^(np) · (1-x)^[n(1-p)] = [(1+bx)^p (1-x)^(1-p)]^n" className="h-auto w-full rounded border border-border bg-white" />
        </div>
        <div data-testid="xmg-original-text" className="whitespace-pre-wrap break-words text-[13px] leading-7 text-foreground/90">{XMG_ORIGINAL_TEXT}</div>
      </DialogContent>
    </Dialog>
  );
}
