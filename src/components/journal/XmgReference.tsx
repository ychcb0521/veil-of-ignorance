import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import referenceImage from '@/assets/xmg-reference.jpg';

const formulaClass = 'overflow-x-auto rounded-lg border border-amber-500/15 bg-amber-500/[0.05] px-4 py-3 font-mono text-[13px] leading-7 text-foreground';

/** 用户提供的 xMG 推导笔记；仅作参考，不参与战役指标计算。 */
export function XmgReference() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" data-testid="campaign-xmg" className="mr-1.5 inline-flex h-7 shrink-0 items-center rounded border border-amber-500/20 bg-amber-500/[0.06] px-2 font-mono text-[11px] font-medium tracking-wide text-amber-800 transition-colors hover:bg-amber-500/[0.12] dark:text-amber-300">xMG</button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-32px)] max-w-3xl overflow-y-auto gap-5 p-5 sm:p-7">
        <DialogHeader>
          <DialogTitle className="font-mono text-xl tracking-wide">xMG</DialogTitle>
          <DialogDescription>秘密武器 · 仓位、相对涨幅与资金增长的推导笔记</DialogDescription>
        </DialogHeader>
        <div className="space-y-6 text-[13px] leading-7 text-foreground/85">
          <section className="space-y-3">
            <h3 className="font-semibold text-foreground">一、从盈亏比到资金增长</h3>
            <div className={formulaClass}>W = (1 + bx)ⁿᵖ · (1 − x)ⁿ⁽¹⁻ᵖ⁾<br />= [(1 + bx)ᵖ(1 − x)¹⁻ᵖ]ⁿ</div>
            <p>括号中的单次增长因子对应几何增长。初始最大预期亏损：</p>
            <div className={formulaClass}>L₀ = Q初 × (S₀ − K₀)</div>
            <p>L₀：预期最大亏损金额；Q初：头仓币量；S₀：头仓买入价；K₀：买入时的止损线。</p>
            <div className={formulaClass}>b最终 = [Q初/2 × (1+α₁)(1+α₂)…(1+αₘ) × (F−Kₘ)] / L₀<br />= ½ × (1+α₁)(1+α₂)…(1+αₘ) × (F−Kₘ) / (S₀−K₀)</div>
            <p>约去 Q初，令：</p>
            <div className={formulaClass}>M = (1+α₁)(1+α₂)…(1+αₘ)<br />G = (F−Kₘ) / (S₀−K₀)<br />b最终 = ½MG</div>
            <p>M 是仓位几何放大倍数；G 是相对涨幅倍数，即最终卖出价与综合成本线之间的价差，相对于初始回撤价差的比例。½ 表示镜像止盈使仓位减半。</p>
            <div className={formulaClass}>W = (1 + ½xMG)ⁿᵖ · (1−x)ⁿ⁽¹⁻ᵖ⁾</div>
          </section>
          <section className="space-y-3 border-t border-border/60 pt-5">
            <h3 className="font-semibold text-foreground">二、将减仓与损失并入 M</h3>
            <p>以上基于镜像止盈仓位减半。实际镜像止盈导致的仓位减半，也可纳入仓位币数变化倍数：减半相当于在原来基础上乘 (1−0.5)。</p>
            <p>若存在震荡造成的损失，加仓时也应扣除，统一用 ×(1−α磨损) 的逻辑。</p>
            <div className={formulaClass}>W = (1+xMG)ⁿᵖ · (1−x)ⁿ⁽¹⁻ᵖ⁾</div>
            <p>x 代表每次投入的资金占总仓位的百分比；M 代表仓位币数变化的倍数，包含镜像减半；G 代表仓位放大之后，综合成本线与最终卖出线之间的价差占最初预期回撤价差的比例；W 代表总金额放大倍数。</p>
          </section>
          <section className="space-y-3 border-t border-border/60 pt-5">
            <h3 className="font-semibold text-foreground">三、核心判断</h3>
            <p>① M 肯定是正数。</p>
            <p>② G 可正可负，因此最大的危险在于它为负。当 G 为负，而且负值很大时，两者相乘的绝对值就很大，意味着损失很大。</p>
            <p>相反，G 为正且最初预期回撤价差小时，仓位放大后的涨幅价差对最终结果的影响更明显，可以理解为：若预期回撤价差很小，一开始就能知道这是高性价比的机会。</p>
            <p>当然，要在同等安全的情况下，先保证止损线安全，再让止损线与开仓价之间的距离尽可能窄。</p>
          </section>
          <section className="space-y-3 border-t border-border/60 pt-5">
            <h3 className="font-semibold text-foreground">四、用带正负号的 G 表达实战结果</h3>
            <p>鉴于 G 有正负：正的时候为盈利结局，负的时候为亏损结局。</p>
            <div className={formulaClass}>W（实战）= (1+xMG)ⁿ</div>
            <p>只是亏损的时候，最大亏损对应的数值为：</p>
            <div className={formulaClass}>x = 0.1，M = 1，G = −1<br />W（亏损）max = 0.9</div>
            <p>盈利的时候（G &gt; 0 时），W（盈利）min &gt; 0；W（盈利）max 由 M 和 G 共同决定。</p>
            <p className="rounded-lg bg-muted/60 px-4 py-2 font-medium text-foreground">备注：x 始终视为 0.1。</p>
          </section>
          <details className="border-t border-border/60 pt-4">
            <summary className="cursor-pointer text-xs text-muted-foreground">查看原始笔记图片</summary>
            <a href={referenceImage} target="_blank" rel="noreferrer" className="mt-3 block text-xs text-muted-foreground">打开原图</a>
            <img src={referenceImage} alt="xMG 原始推导笔记" loading="lazy" className="mt-3 h-auto w-full rounded border border-border" />
          </details>
        </div>
      </DialogContent>
    </Dialog>
  );
}
