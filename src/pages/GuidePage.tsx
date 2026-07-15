import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ChevronDown, Download, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { toast } from 'sonner';

interface TocItem {
  id: string;
  label: string;
  children?: TocItem[];
}

const TOC: TocItem[] = [
  { id: 's1', label: '1. 系统定位' },
  {
    id: 's2',
    label: '2. 推荐使用流程',
    children: [
      { id: 's2-1', label: '2.1 交易训练闭环' },
      { id: 's2-2', label: '2.2 每周复盘闭环' },
    ],
  },
  {
    id: 's3',
    label: '3. 交易页',
    children: [
      { id: 's3-0', label: '3.1 交易模式选择' },
      { id: 's3-1', label: '3.2 时光机与行情' },
      { id: 's3-2', label: '3.3 下单前快照' },
      { id: 's3-3', label: '3.4 平仓评价复盘' },
      { id: 's3-4', label: '3.5 持仓与历史' },
    ],
  },
  {
    id: 's4',
    label: '4. 复盘中心',
    children: [
      { id: 's4-1', label: '4.1 错题集' },
      { id: 's4-2', label: '4.2 结构成熟度' },
      { id: 's4-3', label: '4.3 交易战役' },
      { id: 's4-5', label: '4.5 规则' },
    ],
  },
  { id: 's5', label: '5. 认知资产' },
  { id: 's6', label: '6. 执行力资产' },
  { id: 's7', label: '7. 数据边界与硬约束' },
  { id: 's8', label: '8. 注意事项' },
  { id: 's9', label: '9. 判断标准' },
];

const FLAT_TOC = TOC.flatMap(t => [t, ...(t.children ?? [])]);

function Highlight({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#F0B90B]/25 bg-[#F0B90B]/6 px-4 py-3 text-[14px] leading-7 text-foreground shadow-sm">
      {children}
    </div>
  );
}

function RedHighlight({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#F6465D]/25 bg-[#F6465D]/7 px-4 py-3 text-[14px] leading-7 text-foreground shadow-sm">
      {children}
    </div>
  );
}

function SectionTitle({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span
        className="inline-block w-1 h-6 rounded"
        style={{ background: accent ?? 'hsl(var(--primary))' }}
      />
      <h2 className="text-[20px] font-medium text-foreground">{children}</h2>
    </div>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 mb-3 text-[16px] font-semibold tracking-[0.01em] text-foreground">{children}</h3>;
}

function P({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-[14px] leading-relaxed text-foreground/90 ${className}`}>{children}</p>;
}

function TocList({ activeId, onJump }: { activeId: string; onJump?: () => void }) {
  return (
    <nav className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">目录</div>
      {TOC.map(item => (
        <div key={item.id}>
          <a
            href={`#${item.id}`}
            onClick={onJump}
            className={`block h-8 px-2 leading-8 text-[12px] rounded hover:bg-accent cursor-pointer ${
              activeId === item.id ? 'bg-accent text-foreground border-l-2 border-[#F0B90B]' : 'text-muted-foreground'
            }`}
          >
            {item.label}
          </a>
          {item.children?.map(c => (
            <a
              key={c.id}
              href={`#${c.id}`}
              onClick={onJump}
              className={`block h-7 pl-6 pr-2 leading-7 text-[11px] rounded hover:bg-accent cursor-pointer ${
                activeId === c.id ? 'bg-accent text-foreground border-l-2 border-[#F0B90B]' : 'text-muted-foreground'
              }`}
            >
              {c.label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

function KeyGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-3">{children}</div>;
}

function KeyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card/95 p-5 shadow-sm">
      <div className="border-b border-border/50 pb-3">
        <div className="text-[13px] font-semibold tracking-[0.01em] text-foreground">{title}</div>
      </div>
      <div className="pt-3 text-[13px] leading-7 text-muted-foreground">{children}</div>
    </div>
  );
}

function FlowNode({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <div className={`relative mx-auto max-w-[520px] rounded-xl border bg-card/95 px-4 py-3 text-center text-[12px] leading-6 shadow-sm ${
      accent ? 'border-[#F0B90B]/55' : 'border-border/70'
    }`}>
      {children}
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex justify-center my-3 text-muted-foreground">
      <ArrowDown className="w-4 h-4" />
    </div>
  );
}

function normalizeExportText(text: string) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildGuideExport(items: TocItem[]): string {
  const lines: string[] = ['# 使用说明 · 无知之幕', ''];

  const appendItems = (nodes: TocItem[], depth: number) => {
    for (const node of nodes) {
      const section = document.getElementById(node.id);
      const clone = section?.cloneNode(true) as HTMLElement | undefined;
      clone?.querySelectorAll('section[id]').forEach(child => child.remove());
      const body = normalizeExportText(clone?.innerText ?? '');

      lines.push(`${'#'.repeat(Math.min(depth + 1, 6))} ${node.label}`, '');
      if (body) {
        lines.push(body, '');
      }
      if (node.children?.length) appendItems(node.children, depth + 1);
    }
  };

  appendItems(items, 1);
  return `${lines.join('\n').trim()}\n`;
}

export default function GuidePage() {
  const nav = useNavigate();
  const [activeId, setActiveId] = useState<string>('s1');
  const [exportOpen, setExportOpen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );
    FLAT_TOC.forEach(t => {
      const el = document.getElementById(t.id);
      if (el) obs.observe(el);
    });
    observerRef.current = obs;
    return () => obs.disconnect();
  }, []);

  const handleExportGuide = () => {
    try {
      const content = buildGuideExport(TOC);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `veil-of-ignorance-guide-${stamp}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('使用说明已导出');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1280px] mx-auto flex items-center gap-3">
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => nav(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> 返回
          </Button>
          <div className="md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 px-2">
                  <List className="h-4 w-4 mr-1" /> 目录
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[260px] bg-card border-border">
                <div className="mt-4">
                  <TocList activeId={activeId} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
          <h1 className="text-[14px] font-medium">使用说明 · 无知之幕</h1>
          <div className="flex-1" />
          <Collapsible open={exportOpen} onOpenChange={setExportOpen}>
            <div className="flex items-center gap-1">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  aria-label="展开导出使用说明"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground/35 transition-all hover:bg-accent hover:text-muted-foreground/90"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={handleExportGuide}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  导出说明
                </Button>
              </CollapsibleContent>
            </div>
          </Collapsible>
          <Link to="/">
            <Button className="h-8 bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black text-[12px]">
              进入交易页
            </Button>
          </Link>
        </div>
      </header>

      {/* 使用说明开篇即点题：纪律的终极目的是进攻，不是防守。 */}
      <div className="border-b border-[#F0B90B]/20 bg-gradient-to-b from-[#F0B90B]/10 to-transparent">
        <div className="max-w-[1280px] mx-auto px-6 py-10 text-center">
          <p className="text-[12px] tracking-wide text-muted-foreground">封住下限，不是为了少亏，而是为了敢赢——</p>
          <p className="mt-2 text-[26px] md:text-[34px] font-bold leading-tight tracking-tight text-[#F0B90B]">
            纪律的终极目的是进攻，不是防守！
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            别把这里的硬约束读成“风控”或“防守”。下限被焊死，正是你<strong className="text-foreground">敢多下、敢把仓位放到该放的位置、敢让每个赢家一路跑得更肥</strong>的前提。
          </p>
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-6 py-8 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-8">
        <aside className="hidden md:block">
          <div className="sticky top-[72px] bg-card border border-border rounded p-3">
            <TocList activeId={activeId} />
          </div>
        </aside>

        <main className="space-y-12 min-w-0">
          <section id="s1" className="scroll-mt-20">
            <SectionTitle accent="#F0B90B">1. 系统定位</SectionTitle>
            <div className="space-y-3">
              <P>
                无知之幕不是普通模拟盘，也不是单纯的交易日志。它是一套把<strong>训练、决策记录、复盘、规则演化、元监控</strong>接成闭环的交易系统。
              </P>
              <P>
                它用真实历史行情作为训练环境，把你放回“未来不可见”的状态里：你不知道下一根 K 线，不知道这笔最终赚亏，也不能用事后走势替当时的自己补写理由。系统的核心不是帮你“猜对”，而是逼你在未知里做出更诚实、更可复盘的决定。
              </P>
              <P>
                当前系统实际上有两条工作路径：<strong>直接交易</strong>用于贴近真实执行节奏，<strong>决策记录</strong>用于刻意训练。同一套行情引擎之上，前者允许你像普通交易软件一样快速下单，后者则要求你在开仓前留下快照、在平仓后完成评价，并把样本送进错题集、交易战役、规则系统与元监控。
              </P>
              <P>
                “无知之幕”（veil of ignorance）来自约翰·罗尔斯的思想实验：当你不知道未来结果和自身位置时，更可能选择稳健、公正的规则。放到交易里，它对应的是一种严格的训练姿态：在看不到未来的前提下，只允许自己基于当时真正拥有的信息行动。
              </P>
              <P>
                因此，就“决策受到什么信息影响”而言，这里的模拟训练与真实交易几乎等价。两者面对的是同一个问题：在未来不可见、结果不确定、情绪和偏差会干扰判断的条件下，你能不能仍然按事前规则行动；如果做不到，系统能不能留下足够证据，帮你找出为什么做不到。它的底层方法不是“精确规划未来”，而是承认世界不可知，用试错替代规划，让自己做到“小错误不断，大错误不犯”。
              </P>
              <SubTitle>封住下限，敞开上限：系统的不对称</SubTitle>
              <P>
                站在“无知之幕”背后，你并不知道这一笔会赢还是会输——于是系统做的第一件事，是优化下限、放开上限：它追求的不是每一笔都对，而是即使在最坏的情况下，也能拿到一个“还可以”的结果，亏得起，活得下来。
              </P>
              <P>
                这不是保守。在一个你无法预测的市场里，最坏情况不是会不会来，而是迟早会来——所以你必须先把它兜住。下限兜死之后，才谈上限：而上限要尽可能放开，因为乐观情况可遇不可求，可一旦真的遇到，你必须有底气、也有仓位，去抓住那个高赔率。
              </P>
              <P>
                这就是它的不对称——下限是封住的，上限是敞开的。亏损被锁在一个你受得起的数字里，盈利却可以一路放大。而你之所以敢让赢的单子奔跑，正是因为输的那一端，早已被钉死。
              </P>
              <div className="bg-card border-l-4 border-[#F0B90B] rounded-r p-6 my-8">
                <p className="text-[24px] leading-relaxed text-foreground text-center">
                  封住下限，不是为了少亏，而是为了敢赢。
                </p>
                <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground text-center">
                  所以别把这些硬约束读成“风控”或“防守”。它们是<strong className="text-foreground">进攻的前提</strong>：正因为下限被焊死，你才敢多下、敢把仓位放到该放的位置，也才敢让每一个赢家一路跑得更肥。
                </p>
                <p className="mt-5 text-[20px] font-semibold leading-relaxed text-[#F0B90B] text-center">
                  纪律的终极目的是进攻，不是防守！
                </p>
              </div>
              <P>这一句把“保守”和“反脆弱”彻底分开：保守的人两端都收着；反脆弱的人锁死一端、敞开另一端。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">取向</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">下限（最坏情况）</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">上限（最好情况）</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">保守</td><td className="px-3 py-2 border-t border-border">收着、回避风险</td><td className="px-3 py-2 border-t border-border">也收着，盈利过早兑现</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><strong>反脆弱（本系统）</strong></td><td className="px-3 py-2 border-t border-border">锁死，封在受得起的数字</td><td className="px-3 py-2 border-t border-border">敞开，让盈利一路放大</td></tr>
                  </tbody>
                </table>
              </div>
              <P>
                这套不对称不是态度，而是被写进机制的：开仓前的“本次最大亏损”把单笔风险钉成 R 的分母，“下注规模 · 毁灭概率封顶”用毁灭概率给仓位设顶，逐仓、全仓硬阻断与致命单笔损失弹窗共同把下限焊死；而盈利端，系统从不设上限——当赔率够高、战役级样本也支持时，下注建议反而鼓励你把仓位放到该放的位置；当你已经通过上移对冲止损线把结构推进到“数学上先赢”的阶段，它还会给出加仓或滚仓的软性建议。
              </P>
              <SubTitle>五层闭环：从信念到动作，再用数据反写信念</SubTitle>
              <P>
                这套系统不是用来记录盈亏的，而是用来训练你的判断。它按五层闭环运转：底层信念生成规则，规则被带进每一笔交易现场，交易结束后被复盘诊断，最后由长期数据反过来检查——这整套方法，到底有没有让你变好。从上到下，越来越快、越来越具体；从下到上，真实数据一点点改写你最底层的信念。
              </P>
              <div className="space-y-3">
                <P><strong>L1，原则层。</strong> 它保存系统最底层的信念：市场不可完全预测，但你可以靠小步试错、控制风险、持续校准慢慢往前走。它变化最慢，几年才动一次，是所有规则和动作的源头。</P>
                <P><strong>L2，操作层。</strong> 它把 L1 的原则翻译成具体的规则和自查问题，回答的始终是同一件事：下次再遇到类似情况，我该问自己什么、该做什么、又绝对不能做什么。</P>
                <P><strong>L3，现场决策层——也是整套系统的核心。</strong> 它不是单纯的记录，而是两种过程的结合：交易前，它带着 L2 的规则帮你做出这一笔的判断；与此同时，它又提前把未来复盘要用的数据钉下来——原始假设、置信度、情绪状态、认知偏差、风险暴露、执行依据。换句话说，它把本该盘后才做的诊断（L4），搬到了结果还没揭晓的这一刻。这正是它对抗事后美化的关键：当时写下的，才是当时的你，而不是那个已经知道结果、忍不住重新解释的你。</P>
                <P><strong>L4，反思诊断层。</strong> 交易结束后，它负责拆解结果。它不只问这笔赚了还是亏了，而是追问：我做了什么动作？为什么这样做？这是规则的问题、执行的问题、情绪的问题，还是认知偏差的问题？</P>
                <P><strong>L5，元监控层。</strong> 它不看单笔，只看整套方法是否真的有效。它用校准曲线、偏差光谱、规则有效性追踪、结构 × 结果这些工具，回答最根本的问题：你的规则有没有真的改善决策？复盘有没有真的减少重复错误？这套系统，有没有在真正进化？</P>
              </div>
              <P>
                这五层不是一条自上而下的命令链，而是一个闭环。往下走是约束：原则生成规则，规则进入现场，结果被诊断，诊断再汇进监控——这条线让你有纪律。往上走才是进化：真实交易数据暴露出问题，复盘把问题提炼成模式，模式沉淀为新规则，新规则最终反过来修正你最底层的信念。当 L5 的数据改写了 L1 的信念，这个环就闭合了一次——而每闭合一次，你就比上一次更接近市场真实的样子。
              </P>
              <P>
                它最重要的用途，是把“亏损”这个单一结果拆开归因。一笔亏损，可能是 L1 的世界观错了，可能是 L2 的规则设计错了，可能是 L3 的现场执行错了，也可能是 L5 发现——每一层单看都没问题，合起来却长期没让你变好。只有先分清问题出在哪一层，你才知道该修哪里。
              </P>
              <Highlight>
                一句话：L1 定信念，L2 定规则，L3 做现场决策，L4 做复盘诊断，L5 判断系统是否进化。它真正的目标，不是让你避免每一次错误——而是让每一次错误，都能被归因、被修正、被系统吸收。
              </Highlight>
              <KeyGrid>
                <KeyCard title="训练对象">
                  训练的不是“猜涨跌”的直觉，而是完整决策流程：证据、证伪点、风险预算、情绪轨、认知轨、执行纪律和事后修正。
                </KeyCard>
                <KeyCard title="数据原则">
                  盘面使用真实历史数据；复盘数据优先来自你当时写下的快照。系统允许历史回填和裸 record 归类，但不会把回填数据伪装成完整决策。
                </KeyCard>
                <KeyCard title="最终产物">
                  最终产物不是一篇“写给自己看的复盘”，而是一条下次开仓前能被勾选、能被验证、能真正减少同类错误的规则。
                </KeyCard>
              </KeyGrid>
            </div>
          </section>

          <section id="s2" className="scroll-mt-20">
            <SectionTitle accent="#0ECB81">2. 推荐使用流程</SectionTitle>
            <P>如果只记一条路径，就按“筛掉坏结构 → 记录一笔决策 → 评价一笔结果 → 看见预测误差与错误类型 → 归类战役 → 写入规则 → 用元监控验证”执行。</P>

            <section id="s2-1" className="scroll-mt-20">
              <SubTitle>2.1 交易训练闭环</SubTitle>
              <div className="bg-card border border-border rounded p-6">
                <FlowNode>选择历史时间与标的</FlowNode>
                <FlowArrow />
                <FlowNode>观看历史盘面走势，衡量是否出现下单时机；看不懂、赔率不够、超出能力圈时，允许直接空仓观望</FlowNode>
                <FlowArrow />
                <FlowNode accent>开仓前填写一个快照模块：主力单按顺序走三步——先认源头 · 机会成本（五个机制 edge + “不做更亏吗”三选），再过 ① 盈亏比目标（1R/2R/3R 目标五选、R 回撤分母效应、目标空间三问、盈亏比滑条与 1:1 锚点、具体期望值），最后过 ② 胜率轴（决策三问、二元预测概率、置信度 basis、最大亏损、心态自评、情绪标签、认知偏差自查、下注规模建议与 checklist）；机会成本不足、源头不清或目标不厚时，系统默认推荐“空仓观望 / 太难不做”</FlowNode>
                <FlowArrow />
                <FlowNode>下单、持仓、平仓；若左尾风险扩大，对冲单走独立的边界、必要性、把握性与双向预案快照</FlowNode>
                <FlowArrow />
                <FlowNode accent>平仓后评价：在居中评价弹窗里先完成「结构 × 结果」，再核对快照里写下的证伪信号、结构破坏信号与置信度是否被市场验证；事实模块负责对账，叙事模块只负责解释原因</FlowNode>
                <FlowArrow />
                <FlowNode>归类到交易战役；错题集按“预测和结果之间的误差”自动汇总错误类型，重复出现的误差再写成规则，并到元监控里验证规则是否真的降低频次</FlowNode>
              </div>
              <Highlight>
                闭环的关键不是“每次都下单”，而是每次都留下可学习样本：做了的单、没做的单、对冲的单、亏损的单、合规但亏的单，都要能被事后还原。
              </Highlight>
            </section>

            <section id="s2-2" className="scroll-mt-20">
              <SubTitle>2.2 每周复盘闭环</SubTitle>
              <ol className="list-decimal pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>打开错题集，优先处理“未评价”交易；评价完成后，重点看快照预测与最终结果之间的误差。</li>
                <li>查看错误类型目录，也查看空仓观望、小机会仓位、踏空高盈亏比结构、edge 源头的盈亏同源、过程纠结度与胜率校准是否出现系统偏差。</li>
                <li>对重复出现且造成亏损的模式做六步分析。</li>
                <li>把结论写成下一次开仓前能判断的规则。</li>
                <li>在元监控里检查：规则创建后，对应错误频次是否下降，期望值、置信度校准和战役级胜率是否改善。</li>
              </ol>
              <RedHighlight>
                如果一条规则不能让后续同类错误减少，它不是有效规则。要么写得太抽象，要么没有进入真实的开仓检查点。
              </RedHighlight>
            </section>
          </section>

          <section id="s3" className="scroll-mt-20">
            <SectionTitle accent="hsl(var(--primary))">3. 交易页</SectionTitle>
            <P>交易页负责训练和记录，所有后续复盘都依赖这里产生的数据。关键不是多点几笔单，而是每次出手前把判断写清楚。</P>

            <section id="s3-0" className="scroll-mt-20">
              <SubTitle>3.1 交易模式选择</SubTitle>
              <P>
                交易页<strong>顶部 Header</strong>（标的选择器与右侧「复盘中心」之间）有一对开关：<strong>决策记录</strong> 与 <strong>直接交易</strong>。这是进入交易页后你做的第一个决定，也是整套系统里最大的一个分叉——它决定本次会话产生的数据是否进入复盘体系。系统默认 <strong>直接交易</strong>，需要训练时手动切换到决策记录。紧挨着它右侧那个极小、近乎隐形的符号，是另一组「<strong>同步 / 隔离</strong>」<strong>时间模式</strong>开关（点开才展开，详见 3.2）——那是切换币种时的时间推进方式，别和这里的交易模式混为一谈。
              </P>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card/95 p-5 shadow-sm">
                  <div className="border-b border-border/50 pb-3">
                    <div className="text-[13px] font-semibold tracking-[0.01em] text-foreground">直接交易（默认）</div>
                  </div>
                  <div className="pt-3 text-[13px] leading-7 text-muted-foreground">
                    下单零弹窗、节奏与币安 1:1；<strong>平仓后弹一个轻量「跳过 / 去评价」提示</strong>，由你决定要不要把这一笔送进复盘。选「跳过」就只进入持仓历史与交易战役归类，<strong>不进入</strong>错题集、元监控、规则系统；选「去评价」会即时回填一条最小化记录，走和决策记录模式同一套平仓评价流程，从此进入同套统计。适合熟悉的标的、流畅的执行、或只想观察盘面的场景。
                  </div>
                </div>
                <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card/95 p-5 shadow-sm">
                  <div className="border-b border-border/50 pb-3">
                    <div className="text-[13px] font-semibold tracking-[0.01em] text-foreground">决策记录</div>
                  </div>
                  <div className="pt-3 text-[13px] leading-7 text-muted-foreground">
                    完整的开仓快照（主力单按 <strong>源头 · 机会成本 → ① 盈亏比目标 → ② 胜率轴</strong> 三步：源头五选 + 机会成本三选；1R/2R/3R 目标五选 + R 回撤分母效应 + 目标空间三问 + 盈亏比滑条；决策三问、二元预测概率、最大亏损、心态自评、情绪标签、checklist 等）+ 平仓后强制评价 + 错题集自动归类 + 元监控统计 + 规则系统冷却。适合刻意训练同一类 setup、复盘高频错误类型、或对自己进行校准。
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">触发点</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">直接交易</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">决策记录</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">点 Long / Short</td><td className="px-3 py-2 border-t border-border">立即成交，无弹窗</td><td className="px-3 py-2 border-t border-border">弹完整开仓快照</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">平仓</td><td className="px-3 py-2 border-t border-border">成交后弹「跳过 / 去评价」轻提示，每次都问；选评价即时回填走完整流程</td><td className="px-3 py-2 border-t border-border">弹出居中评价弹窗，不填完不能关</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">交易战役归类</td><td className="px-3 py-2 border-t border-border">可走"裸 record 回填"事后归类</td><td className="px-3 py-2 border-t border-border">实时归类，事件链完整</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">错题集 / 元监控</td><td className="px-3 py-2 border-t border-border">跳过 = 不收录；去评价 = 进入和决策记录同套统计</td><td className="px-3 py-2 border-t border-border">全量收录、自动聚类、CI 与基线对比</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">高频错误强制写规则</td><td className="px-3 py-2 border-t border-border">不触发</td><td className="px-3 py-2 border-t border-border">同一错误类型 30 天 ≥3 次自动弹窗</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">致命单笔损失弹窗</td><td className="px-3 py-2 border-t border-border">不触发</td><td className="px-3 py-2 border-t border-border">单笔实亏 ≥2× 预设最大亏损时弹窗</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">心态 ≤2 / 非逐仓 / 未完成评价</td><td className="px-3 py-2 border-t border-border">不出现（无快照）</td><td className="px-3 py-2 border-t border-border">硬阻挡，不能下单</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                两个模式可以随时切换，<strong>无任何门槛、无任何确认弹窗</strong>。切到直接交易后，之前在决策记录模式下产生的未评价 journal 仍然保留在错题集，你可以稍后在 /journal 主动复盘——但系统不会再追着你跑。
              </Highlight>
              <RedHighlight>
                <strong>判断标准：</strong>你要回答的是"这一笔的目的是产数据，还是去执行已经训练过的动作？"。前者用决策记录，后者用直接交易。混用本身没问题，但不要在同一个 setup 上反复横跳——那会让错题集只能看到你想被看到的那一半。
              </RedHighlight>
            </section>

            <section id="s3-1" className="scroll-mt-20">
              <SubTitle>3.2 时光机与行情</SubTitle>
              <P>
                时光机是交易页的核心训练能力。它把真实历史行情切回到你指定的某一刻，并用“模拟时钟”继续向前播放。你只能看到当时已经发生的数据，看不到未来。
              </P>
              <KeyGrid>
                <KeyCard title="选择历史时点">
                  输入日期和时间后，系统加载该时刻附近的真实历史行情。K 线、盘口、成交、持仓盈亏和订单触发都以模拟时间为准。
                </KeyCard>
                <KeyCard title="加速播放">
                  支持 1x、2x、5x、10x、50x、60x、180x、300x 倍速。慢速用于练决策细节，高倍速用于快速穿越等待区和重复训练同类行情。
                </KeyCard>
                <KeyCard title="暂停与恢复">
                  可随时暂停、继续或跳转。暂停时适合写交易计划、检查 checklist、复盘刚才为什么想出手。
                </KeyCard>
              </KeyGrid>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">能力</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">训练价值</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">历史回放</td><td className="px-3 py-2 border-t border-border">从任意历史时刻重新进入市场</td><td className="px-3 py-2 border-t border-border">把过去行情变成可反复练习的样本</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">未来不可见</td><td className="px-3 py-2 border-t border-border">只显示模拟时间以前的数据</td><td className="px-3 py-2 border-t border-border">避免用已知结果污染判断</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">倍速播放</td><td className="px-3 py-2 border-t border-border">按 1x 到 300x 推进行情</td><td className="px-3 py-2 border-t border-border">用高倍速提高训练密度，用低倍速校准执行质量</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">统一模拟时钟</td><td className="px-3 py-2 border-t border-border">订单、持仓、盈亏、历史记录同步推进</td><td className="px-3 py-2 border-t border-border">让训练接近真实交易节奏</td></tr>
                  </tbody>
                </table>
              </div>
              <KeyGrid>
                <KeyCard title="K 线主图">
                  用来建立交易假设：趋势延续、结构反转、区间波动或放弃交易。不要在持仓后用图表临时补理由。
                </KeyCard>
                <KeyCard title="盘口与成交">
                  用来观察微观结构。若盘口不是策略的一部分，就不要用它作为冲动加仓的借口。
                </KeyCard>
                <KeyCard title="推荐节奏">
                  新手先用 1x-5x 练完整决策，熟悉后用 10x-60x 提高样本量；180x 和 300x 适合穿越无交易价值的等待区。
                </KeyCard>
              </KeyGrid>
              <Highlight>
                时光机的价值不是“快进看答案”，而是在看不到未来的条件下，把同一类行情反复练到动作稳定。倍速只是提高训练密度，不能替代下单前的判断。
              </Highlight>

              <SubTitle>多币种时间模式：同步 / 隔离</SubTitle>
              <P>
                在多个标的之间切换训练时，时光机有两种推进时间的方式。开关收在顶部 Header 那个极小、近乎隐形的符号里，<strong>点开才展开</strong>；系统默认 <strong>同步</strong>。
              </P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">模式</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">适用场景</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">同步（默认）</td><td className="px-3 py-2 border-t border-border">所有标的共用同一个模拟时钟，切换币种时间不变</td><td className="px-3 py-2 border-t border-border">横向对比同一时刻的多个标的，维持统一盘面节奏</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">隔离</td><td className="px-3 py-2 border-t border-border">每个标的有各自独立的时间轴与播放状态，互不影响</td><td className="px-3 py-2 border-t border-border">对单一标的反复回放，切走时不打断其它币种的推进</td></tr>
                  </tbody>
                </table>
              </div>
              <P>隔离模式下，时光机标题旁会显示<strong>「独立时间轴」</strong>角标，提醒你当前币种走的是自己的时钟。</P>
              <RedHighlight>
                <strong>切换守卫（下限优先）：</strong>手里还有持仓时<strong>禁止切换</strong>，必须先平仓；从隔离切回同步、但仍有币种在独立运行时，系统会弹窗列出运行中的币种，让你先跳转查看、或<strong>一键停止所有并切换</strong>。这是为了不让“切个模式”悄悄改变正在持仓 / 运行的标的的时间口径。
              </RedHighlight>
            </section>

            <section id="s3-2" className="scroll-mt-20">
              <SubTitle>3.3 下单前快照</SubTitle>
              <P>开仓快照是系统的核心记录点。它固定“下单前的你”看到什么、相信什么、愿意亏多少、处在什么心态。但这里有一个必须先讲清的底层原则：<strong>主力单与对冲单不是同一类决策，不能用同一套问题去问。</strong> 主力单是在分布右尾下注，核心是“这次机会为什么值得押”；对冲单是在分布左尾买保险，核心是“什么时候裸拿已经变成负期望，应该让保险接管”。</P>

              <SubTitle>零号关 · Stop Doing List：开仓前先过这张「我决心不做」</SubTitle>
              <P>无论主力单还是对冲单，<strong>开仓快照打开后看到的第一块</strong>是一张红框的 <strong>Stop Doing List</strong>——你长期维护的「<strong>我决心不再做的事</strong>」清单。它的逻辑顺序在所有快照内容之前：<strong>先确认这一笔不会犯你已经决心戒掉的错，再谈结构、源头、赔率与胜率</strong>。</P>
              <P>它的设计取自芒格的一句话：<strong>要确认自己不该做什么，往往比想清楚该做什么更重要</strong>。系统里有两张性质相反的清单：<strong>规则系统</strong>记录的是“我应该做 X”（积极指令），<strong>Stop Doing List</strong>记录的是“我决心不做 Y”（消极戒律）。两者刻意分开存放、互不污染，避免“应该做”和“不要做”混进同一张表后语义模糊。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">组成</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">写什么</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">作用</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">全局清单</td><td className="px-3 py-2 border-t border-border">长期维护的「决心不做」条目，例如「不在心态 ≤ 3 时开仓」「不追刚跑出去的单」「不在 22:00 后下任何破位单」</td><td className="px-3 py-2 border-t border-border">每条都<strong>必须在本次勾选确认</strong>「这单不会犯」，少勾一条都开不了仓——<span style={{ color: '#F6465D' }}>硬阻挡</span></td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">本次临时一条</td><td className="px-3 py-2 border-t border-border">这次特别要防的，例如「今天身体不舒服，避免追任何破位单」</td><td className="px-3 py-2 border-t border-border">可选，留作给自己定向加码的当下提醒</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">维护清单按钮</td><td className="px-3 py-2 border-t border-border">右上「维护清单」按钮打开一个小窗口</td><td className="px-3 py-2 border-t border-border">在那里集中增 / 改 / 删条目；已写过的开仓记录不受影响</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                这是<strong>零号关</strong>：它放在排除性清单（一票否决）之上，比心态分、仓位模式更早出现。它筛的不是“此刻能不能交易”，而是“你这一刀会不会重复犯你已经决心戒掉的那类错”。
              </Highlight>
              <P><strong>降级行为：</strong>如果你的全局清单还是空的（或服务端表还没建），这一块会显示「清单为空」，<strong>不阻挡开仓</strong>，等价于退回原有流程。建议第一次进入时点「维护清单」加几条，把你最常踩的坑先固定下来。</P>

              <SubTitle>主力单快照：先判断结构（第 0 步），再走三步（源头 → 盈亏比目标 → 胜率）</SubTitle>
              <P><strong>主力单</strong>的第一性原理是：你是在押一段右尾收益，真正要回答的是<strong>这笔是否有正期望</strong>，而不是“我有多想下单”。但在押注之前，必须先回答一个更底层的问题——<strong>现在是什么市场</strong>。系统因此把主力单快照先收进<strong>第 0 步 · 市场结构</strong>（判断单边 / 震荡 / 转换、你在哪个阶段入场，计数 2/2），再把下注本身拆成三步，<strong>顺序本身就是纪律</strong>：第一步<strong>源头 · 机会成本</strong>（这一单靠什么机制赚钱、值不值得占用你的行动力，计数 2/2），第二步<strong>① 盈亏比目标</strong>（结构给的收益空间够不够厚，计数 6/6），第三步<strong>② 胜率轴</strong>（方向判断，只用于事后校准，计数 3/3）。</P>
              <P>这一前置步回答的是四个<strong>不能互相替代</strong>的问题：市场结构说“现在能不能用这种打法”，源头说“靠什么赚钱”，盈亏比目标说“能赚多厚”，胜率轴说“方向凭什么会对”。先有结构、再有源头与空间，最后才轮到胜率——这正是和“先挑一个看起来胜率高的单”相反的次序。</P>
              <P>贯穿三步的核心公式是 <strong>E = P(赢) × b − (1 − P)</strong>，其中 <strong>b</strong> 是盈亏比。E 以 R 为单位显示；填入“本次最大亏损 USDT”后，系统同步折算<strong>单笔期望 USDT</strong>。E ≤ 0 时这笔没有下注资格，除非你能解释赔率被市场明显错误定价。</P>
              <Highlight>
                顺序不能颠倒：源头不清就别问空间，空间不够就别谈胜率。胜率不能弥补坏源头或坏结构；空仓观望是正向选择，不是“没做事”。
              </Highlight>

              <SubTitle>两层清单：排除性（一票否决）在前，评估性（慢思考脚手架）在后</SubTitle>
              <P>主力单快照按<strong>芒格的两层清单</strong>组织：一张<strong>极短、刚性的排除性清单（一票否决）</strong>放在最前面，一张<strong>较长的评估性清单</strong>收在后面。把已有的硬阻挡显式标成“一票否决层”，正是为了<strong>在最不想用清单的时候，仍然被迫先过这张清单</strong>。</P>
              <P><strong>第一层 · 排除性清单（快速生死筛）</strong>用红框前置：<strong>任意一项不过 = 直接否决、不能开单</strong>——① 强制逐仓；② 心态 ≥3（即<strong>心态 ≤2 硬阻挡</strong>，不给“我知道但继续”的后门）。它只筛“此刻能不能交易”，不评估这单好不好。</P>
              <P><strong>第二层 · 评估性清单（慢思考脚手架）</strong>把第 0 步结构、源头、盈亏比目标、胜率三问等较长内容收进一个可折叠区，行为随心态分变化：</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>心态非满分</strong>（可交易档但未到 5 分）：评估层<strong>强制展开、不能收起</strong>，逐项填完才能开单——维持“前面是快速生死筛、后面才是慢思考脚手架”的原始体验，也避免把“必填却被折叠隐藏”的字段藏起来造成无法提交。</li>
                <li><strong>心态满分（5 分）</strong>：评估层<strong>降级为可选并默认折叠</strong>——点开可填、不填也能开单（对应样本列会缺失）。这是对“状态最好时往往最不想走流程”的让步，但排除层那张一票否决清单依然挡在前面。</li>
              </ul>
              <Highlight>
                这一层只动主力单：对冲单不出现评估层触发器；未入场（“太难，不做这单”）时，第一层显示为“心态自评 · 一票否决”，先稳住状态再谈该不该开。
              </Highlight>

              <SubTitle>第一步 · 源头：这一单靠什么赚钱（五选一）</SubTitle>
              <P>第一步先认领这一单的不对称优势来自哪种<strong>市场机制</strong>。这里<strong>只识别 edge 来源，不判断值不值得下注</strong>。它在<strong>开仓当时</strong>固定下来，作为“盈亏同源”的归类标签，避免事后归因。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">edge / 源头</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">靠什么机制赚钱</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">顺势延续</td><td className="px-3 py-2 border-t border-border">趋势已经成立，靠惯性继续释放空间——用低成本支点参与尚未结束的方向惯性</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">突破扩张</td><td className="px-3 py-2 border-t border-border">关键结构被打开，靠波动率扩张赚钱——在旧结构失效、新空间打开但还没充分释放时入场</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">均值回归</td><td className="px-3 py-2 border-t border-border">偏离过度，靠价格回到合理区间赚钱——等边际动能衰竭再用短止损博修复</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">挤压释放</td><td className="px-3 py-2 border-t border-border">多空一方过度拥挤，靠被迫平仓推动行情——站在被迫交易流的上游，而不是情绪释放后的末端</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>无明确 edge</span></td><td className="px-3 py-2 border-t border-border">看不出来源，只是想交易——标红警告，盈亏同源里它通常只贡献亏损，多半在填补无聊</td></tr>
                  </tbody>
                </table>
              </div>
              <P>源头卡片 hover 时显示详细说明；折叠区只保留<strong>入场口诀</strong>：<strong>顺势看支点、突破看接受、均值回归看衰竭、挤压释放看触发</strong>。</P>

              <SubTitle>第一步 · 机会成本：不做更亏吗（三选一）</SubTitle>
              <P>认完源头紧接着问一句<strong>动机</strong>题——<strong>“不做更亏吗？是在浪费机会吗？”</strong> 它筛的不是赔率，而是你下这一单到底是因为机会，还是因为手痒。三选一：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">回答</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义与后果</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">是 · 不做更亏</td><td className="px-3 py-2 border-t border-border">有真实机会成本，放行</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>否 · 不做也不亏</span></td><td className="px-3 py-2 border-t border-border">本质在<strong>填补无聊</strong>，典型“小机会仓位”——系统视同坏结构，默认建议空仓观望，仍要下单进入<strong>二次确认</strong></td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#D89B00' }}>说不清 / 凭感觉</span></td><td className="px-3 py-2 border-t border-border">没有可解释的机会成本优势，<strong>同样按小机会仓位处理</strong>——别用行动力去填补模糊感，触发空仓建议与二次确认</td></tr>
                  </tbody>
                </table>
              </div>
              <RedHighlight>
                持有小机会仓位是一等负向状态，<strong>比空仓更糟</strong>：它占用行动力，让你在大机会来时犹豫，错过后还会心理懈怠。只要答案不是“是 · 不做更亏”，系统就默认推荐空仓观望。
              </RedHighlight>

              <SubTitle>第二步 · 盈亏比目标：结构给的空间够不够厚（五选一）</SubTitle>
              <P>源头说清“靠什么赚钱”之后，第二步只回答一件事：<strong>结构给出的收益空间够不够厚</strong>。它不问 edge 来源、不预测能涨多少，只让你判断<strong>目标空间</strong>属于哪一档。空间不够时，最优动作不是勉强下小仓，而是空仓观望。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">盈亏比目标</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">系统态度</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">1R 容易到达</td><td className="px-3 py-2 border-t border-border">最近目标清晰，正常波动即可触达</td><td className="px-3 py-2 border-t border-border">可做，适合基础试仓</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">2R 有结构支撑</td><td className="px-3 py-2 border-t border-border">上方空间打开，阻力不密集</td><td className="px-3 py-2 border-t border-border">可做，值得正常暴露</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">3R 以上打开</td><td className="px-3 py-2 border-t border-border">趋势、动能、环境共振，具备大波段潜力</td><td className="px-3 py-2 border-t border-border">可做，鼓励放到建议上沿</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>盈亏比不足</span></td><td className="px-3 py-2 border-t border-border">止损太远或目标太近，即使方向对也不值得做</td><td className="px-3 py-2 border-t border-border">标红，默认建议空仓观望，仍要下单进入二次确认</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>目标不清楚</span></td><td className="px-3 py-2 border-t border-border">看不出有效止盈区，不能计算计划盈亏比</td><td className="px-3 py-2 border-t border-border">标红，默认建议空仓观望，仍要下单进入二次确认</td></tr>
                  </tbody>
                </table>
              </div>
              <P>选完目标档位，<strong>① 盈亏比目标</strong>这一步内部还内置三块必答内容，凑齐才算完成 5/5：<strong>R 回撤滑条 · 成本分母效应</strong>、<strong>盈亏比滑条</strong>、以及<strong>目标空间三问</strong>。</P>

              <SubTitle>第二步 · R 回撤滑条 · 成本分母效应（把回撤画出来）</SubTitle>
              <P>这是回撤非对称的第一处<strong>可视化</strong>，键在<strong>回撤价相对成本价</strong>：手动输入<strong>预期最大回撤价格</strong>（做多应低于成本价、做空应高于成本价），系统自动换算这段回撤占成本价的比例（<strong>R / 成本</strong>），并把“下坠”与“爬回”画成两条对照的条形：</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><span style={{ color: '#F6465D' }}>下坠</span>（红条）= 这段回撤 <strong>-X%</strong>；<span style={{ color: '#0ECB81' }}>爬回</span>（绿条）= 回到成本价所需的 <strong>+Y%</strong>。两条同尺对照，让“分母变小后回本更陡”一眼可见。</li>
                <li>条上标注 <strong>“亏 X% 后，回本要 +Y%”</strong> 与 <strong>“回本路程是下坠的 N×”</strong>——这就是<strong>成本分母效应</strong>：亏损让分母变小，同样的价格距离对应更大的回本百分比。</li>
                <li>回撤逼近极端时显示 <strong>“几乎无法回本”</strong>，把“损失有界”这条硬约束变成体感。</li>
              </ul>

              <SubTitle>第二步 · 目标空间三问</SubTitle>
              <P>画完分母效应，<strong>① 盈亏比目标</strong> 还要写三问。它和胜率轴的决策三问<strong>结构平行，但只问“空间”不问“方向”</strong>——专门逼你把“目标空间”这件事写成可校准证据：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">题号</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">问题</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">怎么答</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#D89B00' }}>① 来源</span></td><td className="px-3 py-2 border-t border-border">这笔的收益空间来自哪？</td><td className="px-3 py-2 border-t border-border">写清目标在哪里、阻力 / 支撑密度如何、为什么空间足够厚。说不清＝目标不清楚</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#D89B00' }}>② 预演</span></td><td className="px-3 py-2 border-t border-border">如果这个目标判断错了，最可能的原因是什么？</td><td className="px-3 py-2 border-t border-border">写清你可能误判了目标位、波动率、阻力密度，或环境其实不支持延展</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#D89B00' }}>③ 失效</span></td><td className="px-3 py-2 border-t border-border">哪些具体信号出现，意味着目标空间不成立？</td><td className="px-3 py-2 border-t border-border">写可被盘面验证的目标失效信号，而不是主观感觉</td></tr>
                  </tbody>
                </table>
              </div>
              <P>只有<strong>盈亏比目标五选、R 回撤价、目标空间三问</strong>全部完成，① 盈亏比目标 才会显示 5/5；否则会提示“必须先完成盈亏比目标五选、R 回撤价与目标空间三问”。</P>

              <SubTitle>第三步 · 胜率轴：决策三问（正—反—止）</SubTitle>
              <P>走到第三步<strong>② 胜率轴</strong>，才开始问方向。它把一次方向判断拆成“证成、反证、证伪”三步，逼你同时看见收益剧本和失败剧本。注意这套三问<strong>只问方向</strong>，胜率本身只用于事后校准，不是用来挑“看起来胜率高”的单。对冲单不会复用这套问题，因为对冲不是在赌方向，而是在记录边界、必要性和保险质量。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">题号</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">问题</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">回答方式</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#0ECB81' }}>① 正</span></td><td className="px-3 py-2 border-t border-border">这笔为什么会对？</td><td className="px-3 py-2 border-t border-border">结构、量能、宏观、规则整合写一段；不要拆成多个论据框</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F0B90B' }}>② 反</span></td><td className="px-3 py-2 border-t border-border">假设这笔亏完，最可能的原因是？</td><td className="px-3 py-2 border-t border-border">用 pre-mortem 写出最可能让你输的剧本，平仓后用它比对真实亏损原因</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>③ 止</span></td><td className="px-3 py-2 border-t border-border">什么信号一旦触发，你就提前止损 / 拆仓？</td><td className="px-3 py-2 border-t border-border">失效信号必须<strong>可观测、可触发</strong>——写成盘面会自己触发的事件（价位 / 形态 / 量能 / 时间，如“跌破 4h 关键支撑且 1h 放量”），不能是“感觉要跌了”这种感受；平仓复盘时对它做闭环校验</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                三问的意义不是“写满表单”，而是让胜率判断留下可校准证据。前两步（源头 + 盈亏比目标）已经决定这笔是否值得做；这一步只负责记录你为什么认为方向会对，以及哪里证明你错。
              </Highlight>

              <SubTitle>太难篮子（No Trade）</SubTitle>
              <P>快照底部现在有三个按钮：<strong>取消</strong>、<strong>太难，不做这单</strong>、<strong>确认下单</strong>。其中“太难”不是误关弹窗，而是一种被正式记录、被尊重、并进入元监控统计的决定。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">按钮</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">后果</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">取消</td><td className="px-3 py-2 border-t border-border">误开弹窗或暂时不处理</td><td className="px-3 py-2 border-t border-border">关闭快照，不留下记录</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">太难，不做这单</td><td className="px-3 py-2 border-t border-border">结构看不懂、赔率不够、超出能力圈、状态不对</td><td className="px-3 py-2 border-t border-border">写入 <code>journal_kind='no_trade'</code>，记录当时方向、价格和原因，不真正下单</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">确认下单</td><td className="px-3 py-2 border-t border-border">正常进入交易</td><td className="px-3 py-2 border-t border-border">写入 trade journal，并继续真实模拟成交流程</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                “太难”与“未下单但全程观察”不是一回事。“未下单但全程观察”是你全程盯盘、当场没下单、事后才记录的中性快照——它既可能是“该开没开”（遗漏机会），也可能是“正确避开”（不该开），到底哪种留到复盘再判定；“太难”则是在开仓弹窗里当场作出的放弃决定。
              </Highlight>

              <SubTitle>对冲单快照：风险工具，不是方向下注</SubTitle>
              <P>当你把订单类型切到<strong>对冲单</strong>时，快照会切换成完全不同的一套问题。顶部先提醒第一性原理：<strong>对冲不是下注，是把“未知、不可控的无限风险”，换成“已知、可衡量的极小摩擦成本”。</strong></P>
              <P>对冲单的底层问题不是“市场会不会往我想的方向走”，而是<strong>左尾风险是不是已经大到，继续裸拿变成了负期望</strong>。它对应的是另一条公式：<strong>风险期望 = P(尾部风险) × |风险绝对值|。</strong> 两者越大，这份保险兜住的东西越大，对冲就越值得做、也越应该做得更足。</P>
              <P>因此，对冲路径不再出现主力单的“为什么会对 / pre-mortem / 证伪信号”、二元置信度、最大亏损与 Checklist；取而代之的是三组专属记录：<strong>先选对冲类型</strong>，再写<strong>边界与双向预案</strong>，最后把<strong>必要性</strong>和<strong>把握性</strong>拆开分别记录。</P>
              <P><strong>必要性</strong>只回答“这份保险该买多大”，按<strong>尾部风险概率 × 风险绝对值</strong>来估。前者由“行情强劲程度 + 历史规则程度”近似，后者由“下行烈度 / 跳空风险”单独评分；<strong>把握性</strong>只回答“我多确定这个风险估计是对的”，它只影响校准镜子，不允许反向缩小对冲仓位。</P>
              <P><strong>对冲边界</strong>的第一性原理也要单独理解：对冲腿出发的位置 = 主力腿的生存底线 = <strong>预期风险开始盖过预期盈利的交叉点</strong>。ATR 线、中枢下沿、阻力位只是三种行情里寻找同一个交叉点的方法。快照还会额外问你这条线放得<strong>偏早 / 大致在交叉点 / 偏晚</strong>，用来照出你的机会成本门槛。</P>
              <Highlight>
                主力单在问“为什么值得押右尾”；对冲单在问“什么时候必须封左尾”。两者都重要，但绝不能混成一套语言。
              </Highlight>

              <SubTitle>情绪标签（三类）</SubTitle>
              <P>情绪标签包括三类：<strong>正向情绪</strong>帮助执行规则，<strong>负向情绪</strong>容易破坏规则，<strong>中性情绪</strong>本身不一定坏，但必须被校准，否则会滑向失控。标签可多选，也可全不选；鼠标悬停在标签上，会显示它的<strong>核心含义</strong>与<strong>可能导致的行为倾向</strong>。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">分组</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">原则</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">典型标签</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#0ECB81' }}>正向情绪</span></td><td className="px-3 py-2 border-t border-border">可放行，但不能替代规则</td><td className="px-3 py-2 border-t border-border">冷静、专注、耐心</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F0B90B' }}>中性情绪</span></td><td className="px-3 py-2 border-t border-border">本身不坏，但必须校准</td><td className="px-3 py-2 border-t border-border">害怕亏损、犹豫、不安/怀疑、困惑、后悔、兴奋、疲惫、分心</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>负向情绪</span></td><td className="px-3 py-2 border-t border-border">默认黄灯或红灯</td><td className="px-3 py-2 border-t border-border">FOMO、复仇交易、证明自己、贪婪、恐慌、压力过载、虚假掌控感等</td></tr>
                  </tbody>
                </table>
              </div>
              <P>负向情绪标签会同步写入 <code>pain_log_entries</code> 痛苦日志，元监控里会按标签统计后续平均 R，识别<strong>最危险的心理入口</strong>。正向与中性标签同样进入这条管线，用来检验“自认为状态好”时是否真的有正期望。</P>

              <SubTitle>认知偏差自查（信息 / 判断 / 执行）</SubTitle>
              <P>痛苦/情绪标签是“情绪轨”，认知偏差是另一条“认知轨”。前者你能感觉到，后者你往往意识不到，所以快照在情绪标签下方增加了<strong>认知偏差自查</strong>。它同样支持 hover 解释，但不阻塞提交。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">分组</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">你在查什么</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">典型偏差</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">信息偏差</td><td className="px-3 py-2 border-t border-border">我是不是只看见了想看的信息？</td><td className="px-3 py-2 border-t border-border">确认偏误、社会认同、权威偏误、光环效应、群体极化、峰终定律</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">判断偏差</td><td className="px-3 py-2 border-t border-border">我是不是把噪音当成规律？</td><td className="px-3 py-2 border-t border-border">叙事谬误、小样本偏差、黑天鹅盲区、零风险偏误、线性外推</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">执行偏差</td><td className="px-3 py-2 border-t border-border">我是不是被盈亏和自尊绑架了？</td><td className="px-3 py-2 border-t border-border">锚定、沉没成本、现状偏差、承诺升级、拖延偏误、多重偏差叠加</td></tr>
                  </tbody>
                </table>
              </div>
              <P>这部分写入 <code>pre_cognitive_bias_tags</code>，并在元监控里和情绪标签一起汇总成你的<strong>个人偏差光谱</strong>。</P>

              <SubTitle>置信度安全边际与下注规模</SubTitle>
              <P>二元预测概率滑块仍然保留，但它不是下单筛子，而是校准工具。第一层是<strong>芒格折扣</strong>：先把你主观输入的置信度，按个人历史校准或默认 15 个百分点做折扣，只用于显示，不写库。第二层是<strong>具体期望值</strong>：系统用 <strong>E = P × b − (1 − P)</strong> 展示本次期望 R，并在填写最大亏损后折算 USDT。第三层是<strong>下注规模 · 毁灭概率封顶</strong>：在有正期望的前提下，用 Kelly 与毁灭概率给出建议单笔最大亏损。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">模块</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">作用</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">边界</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">芒格折扣</td><td className="px-3 py-2 border-t border-border">把主观置信度先打折，提醒你“真实可能”没有自己感觉的那么高</td><td className="px-3 py-2 border-t border-border">只显示，不写库；写库仍保存原始置信度，供后续校准</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">具体期望值</td><td className="px-3 py-2 border-t border-border">显示 E = 胜率 × 盈亏比 − 亏损概率，并给出 E 的 R 值</td><td className="px-3 py-2 border-t border-border">最大亏损已填写时，同时显示单笔期望 USDT；E ≤ 0 时标记为无正期望</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">下注规模建议</td><td className="px-3 py-2 border-t border-border">用 Kelly + 毁灭概率封顶，给出建议单笔最大亏损</td><td className="px-3 py-2 border-t border-border">胜率优先使用战役口径或折扣后胜率；盈亏比优先使用战役口径，样本不足时用本次滑条</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">盈利端建议</td><td className="px-3 py-2 border-t border-border">当高赔率且战役级样本支持时，鼓励把仓位放到建议上沿，而不是因模糊恐惧过度缩仓</td><td className="px-3 py-2 border-t border-border">仍然受毁灭概率封顶约束；不是鼓励无限加杠杆</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">提示性质</td><td className="px-3 py-2 border-t border-border">帮助你诚实面对仓位问题</td><td className="px-3 py-2 border-t border-border">软提示，不替你自动改单</td></tr>
                  </tbody>
                </table>
              </div>

              <SubTitle>回撤的非对称（账户层面）：把最大亏损画出来，不只给一个百分数</SubTitle>
              <P>这是回撤非对称的第二处可视化，和 ① 盈亏比目标里的“R 回撤滑条 · 成本分母效应”是<strong>同一把尺、两个口径</strong>：那处键在<strong>回撤价相对成本价</strong>，这里键在<strong>最大亏损相对账户净值</strong>。填入<strong>本次最大亏损 USDT</strong> 后，除了显示“占总账户 X%”，系统会在下方把<strong>回撤的非对称</strong>直接<strong>可视化成一组条形图</strong>——因为“亏 50%”这个数字本身不痛，痛的是它要 <strong>+100%</strong> 才能回来。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>上行红条 = 这次的回撤幅度（亏 X%）；下行绿条 = 回到盈亏平衡所需的涨幅（回本）。两条等长的视觉对照，让“回本永远比回撤更陡”一眼可见。</li>
                <li>条上标注 <strong>“回本需 +Y%（N×）”</strong>：Y 永远大于 X，且越深越离谱——<strong>-10% → +11.1%；-25% → +33.3%；-50% → +100%；-90% → +900%</strong>。</li>
                <li>跌幅逼近 100% 时显示<strong>“几乎无法回本”</strong>，对应“损失有界”这条硬约束的直觉化。</li>
              </ul>
              <RedHighlight>
                这块可视化不是装饰：它把“再赚回来就行”的侥幸，换成“这一刀下去要用几倍的涨幅才能填平”的体感。深度回撤的真正代价是<strong>复利被打断</strong>，不是账面上那个负号。
              </RedHighlight>

              <SubTitle>其它快照字段</SubTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">字段</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">用途</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">判断标准</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">订单类型</td><td className="px-3 py-2 border-t border-border">区分主力单与对冲单</td><td className="px-3 py-2 border-t border-border">主力单评估方向判断；对冲单改成对冲类型、边界、必要性、把握性与双向预案</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">仓位模式</td><td className="px-3 py-2 border-t border-border">强制使用逐仓</td><td className="px-3 py-2 border-t border-border">全仓是硬阻断，必须切换到逐仓才能提交</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">edge / 源头（主力单）</td><td className="px-3 py-2 border-t border-border">第一步：认领靠什么机制赚钱，作为“盈亏同源”标签</td><td className="px-3 py-2 border-t border-border">主力单必填；五选一：顺势延续 / 突破扩张 / 均值回归 / 挤压释放 / 无明确 edge（标红）</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">机会成本问句（主力单）</td><td className="px-3 py-2 border-t border-border">第一步：认完源头再问“不做更亏吗”</td><td className="px-3 py-2 border-t border-border">主力单必答；三选一：是·不做更亏（放行）/ 否·不做也不亏 / 说不清·凭感觉（后两者＝小机会仓位，触发二次确认）</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">盈亏比目标（主力单）</td><td className="px-3 py-2 border-t border-border">第二步：判断结构给的收益空间够不够厚</td><td className="px-3 py-2 border-t border-border">五选一：1R / 2R / 3R 为可做；盈亏比不足、目标不清楚标红，触发空仓建议与二次确认</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">R 回撤滑条 · 成本分母效应（主力单）</td><td className="px-3 py-2 border-t border-border">第二步：输入预期最大回撤价，可视化下坠 / 爬回</td><td className="px-3 py-2 border-t border-border">做多回撤价低于成本、做空高于成本；显示 R / 成本、回本 +Y% 与“回本是下坠的 N×”</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">目标空间三问（主力单）</td><td className="px-3 py-2 border-t border-border">第二步：把目标空间写成可校准证据</td><td className="px-3 py-2 border-t border-border">来源 / 预演 / 失效信号三问；与 R 回撤价一起决定 ① 盈亏比目标 是否完成 5/5</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">盈亏比滑条</td><td className="px-3 py-2 border-t border-border">记录本次预期盈利 / 预期亏损</td><td className="px-3 py-2 border-t border-border">1:1 是需特别确认的基准线；战役盈亏样本不足时作为期望值和定仓计算的回落口径</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">本次最大亏损 USDT</td><td className="px-3 py-2 border-t border-border">定义本次风险预算，并可视化回撤的非对称</td><td className="px-3 py-2 border-t border-border">后续 R 倍数以此为分母；占总账户 ≥10% 会触发提醒；下方用条形图显示“回本需 +Y%（N×）”（-50% 要 +100%，-90% 要 +900%）</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">心态自评 (1–5)</td><td className="px-3 py-2 border-t border-border">记录决策者状态</td><td className="px-3 py-2 border-t border-border">≤2 分硬阻挡，不能用确认框绕过</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">二元预测概率</td><td className="px-3 py-2 border-t border-border">Tetlock / Good Judgment 式校准训练</td><td className="px-3 py-2 border-t border-border">用“做对/做错”互补滑杆给出具体概率，并写下你为什么有资格给这个置信度；下方显示芒格折扣，但写库仍保存原始值</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">下注规模 · 毁灭概率封顶</td><td className="px-3 py-2 border-t border-border">显示具体期望值，并把仓位上限从“我很有信心”改成“别把账户打穿”</td><td className="px-3 py-2 border-t border-border">E ≤ 0 标记无正期望；E &gt; 0 时再用 Kelly 与毁灭概率封顶给建议上限</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">对冲必要性 / 把握性</td><td className="px-3 py-2 border-t border-border">一个决定保险大小，一个记录决策成色</td><td className="px-3 py-2 border-t border-border">必要性只由客观锚点驱动；把握性只做“值回成本”校准，二者完全解耦</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">对冲边界 / 下单方式</td><td className="px-3 py-2 border-t border-border">记录保险从哪里接管，以及这次是不是计划内执行</td><td className="px-3 py-2 border-t border-border">边界用于定义生存底线；市价追会被标记为纪律风险，预挂限价更接近计划内对冲</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">持仓反馈体检</td><td className="px-3 py-2 border-t border-border">识别向下摊平、报复交易、杠杆螺旋，也识别顺势加仓与已实现数学盈利后的加仓/滚仓窗口</td><td className="px-3 py-2 border-t border-border">只给软性建议；新增部分仍必须受毁灭概率封顶约束</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">开仓 Checklist</td><td className="px-3 py-2 border-t border-border">把规则前置到下单前</td><td className="px-3 py-2 border-t border-border">必填项必须全勾；不能判断是否通过的条目，需要回到规则页重写</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                快照不是表单负担。它是事后复盘的证据链：没有快照，就只能靠记忆复盘；靠记忆复盘，最容易把理由改写成对自己有利的版本。
              </Highlight>
            </section>

            <section id="s3-3" className="scroll-mt-20">
              <SubTitle>3.4 平仓评价复盘</SubTitle>
              <P>决策记录模式下，平仓会打开一个与开仓快照同规格的<strong>居中评价弹窗</strong>，不完成评价不能离开。评价的重心不是重新讲一遍故事，而是把快照时的预测和最终实际结果对上：预设的证伪信号兑现没有，结构破坏信号出现没有，进场时钉下的置信度有没有被验证。</P>
              <P>弹窗按这条主线展开：<strong>事实模块</strong>逐条核验快照里押的<strong>反 / 止 / 结构 / 置信</strong>四条腿 → <strong>结果归类</strong>（结构 × 结果四象限）→ <strong>路径</strong>（滚仓 / 镜像止盈 + 交易主动权）→ <strong>体检模块</strong>（过程纠结度 / 小机会仓位记账 / 踏空高盈亏比结构）→ <strong>反对者陈述追踪</strong>（条件触发）→ <strong>情绪侧七问</strong>。先对账，再判读，最后翻动机，避免复盘变成事后重新叙述。</P>

              <SubTitle>事实模块 · 逐条核验闭环的四条腿（反 / 止 / 结构 / 置信）</SubTitle>
              <P>弹窗会把开仓快照里写下的<strong>反（亏损剧本）</strong>、<strong>止（失效信号）</strong>、<strong>结构（目标空间）</strong>、<strong>置信（开仓预测胜率）</strong>逐条原样回显，问你这四个假设在持仓过程中分别被市场怎么对待。这里<strong>只核验差值、不写事后故事</strong>，避免把"发生了什么"和"为什么"压成一个自洽的完美闭环。</P>
              <P><strong>"止"这条腿</strong>是其中最关键的子项：如果开仓时写过失效信号，这里会把它原样回显，再让你选三种状态之一：<strong>触发了，我及时反应了 / 触发了，但我反应晚了 / 没触发，我是主观平仓</strong>。这一步专治"写了止损条件却没执行"。</P>

              <SubTitle>选择本笔归类（结构 × 结果四象限）</SubTitle>
              <P>"结构 × 结果"是平仓评价的核心判断，不再把同一个判断拆成额外问题。你只需要把这笔交易放进一张 2×2：<strong>结构轴 = 这一笔的过程是不是正当的（与盈亏无关）</strong>，<strong>结果轴 = 这单赢 / 亏</strong>。一句话锚点：<strong>好结果不等于好过程，坏结果不等于坏过程</strong>。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">象限</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">过程 · 结果</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">该学到什么</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#0ECB81' }}>正当过程好结果</span></td><td className="px-3 py-2 border-t border-border">正当过程 · 好结果</td><td className="px-3 py-2 border-t border-border">可复制——记住你做对了什么，而不是记住你赚了多少</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F0B90B' }}>正当过程的坏结果</span></td><td className="px-3 py-2 border-t border-border">正当过程 · 坏结果</td><td className="px-3 py-2 border-t border-border">这种亏损是这个 edge 的成本，别因一次亏损改掉对的做法</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>错误过程的好结果</span></td><td className="px-3 py-2 border-t border-border">错误过程 · 好结果</td><td className="px-3 py-2 border-t border-border">最危险的一格：市场替你的错误买了单。别把市场的能力当成自己的——这次的赢会教你错误的经验</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#D89B00' }}>错误过程的坏结构</span></td><td className="px-3 py-2 border-t border-border">错误过程 · 坏结果</td><td className="px-3 py-2 border-t border-border">结果诚实反映过程。要修正的是结构，不是运气</td></tr>
                  </tbody>
                </table>
              </div>
              <RedHighlight>
                命中<strong>"错误过程的好结果"</strong>时，评价弹窗会给出强警示。这是系统唯一要对你"喊"的一格：盈利会强化你刚刚犯的错，下次仓位更大、错得更狠。
              </RedHighlight>
              <P className="mt-2">如果结果是保本或未入场，不强行归入四象限；如果是赢或亏，就先选一格——按 UI 里"选择本笔归类"那 2×2 的可点格子，系统会自动只让你选与本笔结果一致的两格（赢的一行 / 亏的一行）。</P>

              <SubTitle>路径 · 滚仓 vs 镜像止盈 + 交易主动权</SubTitle>
              <P>归类之后追问一句：<strong>这一笔最终走的是哪条路径</strong>，以及<strong>你在这条路径里有多大主动权</strong>。它只记录这单实际的路径，不评对错。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">路径选择</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#0ECB81' }}>滚仓</span></td><td className="px-3 py-2 border-t border-border">顺着优势路径推进，把赢家继续养肥，而不是在第一段波动里急着收掉</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F0B90B' }}>1:1 镜像止盈</span></td><td className="px-3 py-2 border-t border-border">按风险镜像先兑现 1R，把主动权和心理带宽收回来</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">交易主动权（1–4）</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>1 · 完全被动</span></td><td className="px-3 py-2 border-t border-border">价格推着你走，离场主要来自疼痛、慌乱或被动触发</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#D89B00' }}>2 · 勉强可控</span></td><td className="px-3 py-2 border-t border-border">有计划，但执行时明显被波动牵着走</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F0B90B' }}>3 · 主动可控</span></td><td className="px-3 py-2 border-t border-border">基本按路径执行，关键动作没有被情绪接管</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#0ECB81' }}>4 · 完全主动</span></td><td className="px-3 py-2 border-t border-border">节奏、止盈、离场都由预案主导，市场只是触发条件</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                这两项必选，仅对主力单且已入场出现。它和结果归类一起把"你的过程"刻画得更立体：<strong>同样赢一笔，被动滚出来 vs 主动按预案止盈，含金量完全不同</strong>。
              </Highlight>

              <SubTitle>过程纠结度（先行指标）</SubTitle>
              <P>仅主力单出现。用 1–5 记录<strong>这一单做得有多纠结 / 多轻松</strong>：<strong>1 极度煎熬 → 2 纠结 → 3 一般 → 4 轻松 → 5 行云流水</strong>。它锚定一句话：<strong>交易最重要的不是赚钱，是轻松。</strong></P>
              <RedHighlight>
                高纠结<strong>即使结果对</strong>，过程也已经亮黄灯——它是亏损的<strong>先行指标</strong>。全程煎熬、反复想平仓的赢单，是高风险过程，别因为这次赢了就重复它。
              </RedHighlight>

              <SubTitle>小机会仓位记账</SubTitle>
              <P>每一笔主力单都会让你自评一次「这一单的隐性成本」——四选一：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">拖累程度</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">无明显拖累</td><td className="px-3 py-2 border-t border-border">干净的仓位，没有影响别的判断或机会——这一档就代表"这不是小机会仓"</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">占用注意力</td><td className="px-3 py-2 border-t border-border">占用了注意力 / 心力，但没错过大机会</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">错过更大机会</td><td className="px-3 py-2 border-t border-border">钝化了敏感度，做小了 / 错过了真正更大的机会</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">引发连锁乱做</td><td className="px-3 py-2 border-t border-border">引发后续乱做（无聊 → 乱做 → 复仇等连锁负向）</td></tr>
                  </tbody>
                </table>
              </div>
              <P><strong>设计上不再依赖开仓时的字段触发</strong>——以前要满足"不做也不亏 / 无明确 edge / 盈亏比不足"等条件这一块才出现，导致很多用户从来没看到过它。现在每一笔主力单平仓后都自评一次，"无明显拖累"自然兜底"这不是小机会"的情形。</P>
              <RedHighlight>
                持有小机会仓位是<strong>一等负向状态：它比空仓更糟</strong>——在悄悄损耗你的行动力与对大机会的敏感度。把它的成本记成账，下次才舍得空仓。
              </RedHighlight>

              <SubTitle>踏空高盈亏比结构 / 该重没重（小机会仓位的对称负态）</SubTitle>
              <P>当开仓时被识别为<strong>厚结构</strong>（盈亏比目标落在「2R 支撑 / 3R 打开 / 逆群未释放」，或机会成本明确"不做更亏 + 便宜机会"）时，平仓后追加这一块——它和"小机会仓位"<strong>互为对称</strong>：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">状态</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#0ECB81' }}>没有明显踏空</span></td><td className="px-3 py-2 border-t border-border">结构厚度与实际暴露基本匹配，没有明显错过或做轻</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#D89B00' }}>该做没做</span></td><td className="px-3 py-2 border-t border-border">高盈亏比结构被识别出来，但最后没有参与</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#D89B00' }}>该重没重</span></td><td className="px-3 py-2 border-t border-border">结构足够厚，但仓位过轻，收益没有覆盖判断质量</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>错过后补票</span></td><td className="px-3 py-2 border-t border-border">错过好位置后用差位置追回，等于把厚结构做薄</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                小机会仓位惩罚的是"<strong>不该占用却占用了</strong>"；这一项惩罚的是"<strong>该暴露却没有充分暴露</strong>"。两边都在保护行动力。
              </Highlight>

              <SubTitle>反对者陈述追踪（仅当开仓写过反对者时出现）</SubTitle>
              <P>如果开仓快照里写下了一句<strong>反对者陈述</strong>（"如果我看错了，反对者会说什么"），平仓后这块会把它原样回显，再让你<strong>二选一</strong>：</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong style={{ color: '#F6465D' }}>反对者命中</strong>：他当时说的那句话，事后真的应验了。这一笔本质上是没听反方话的代价。</li>
                <li><strong style={{ color: '#0ECB81' }}>原方案成立</strong>：你的原始判断在这一笔上压过了反对者的担心。</li>
              </ul>
              <P>这块是<strong>事前反方意见的事后兑现</strong>：把"是不是有人会反对"和"反对者后来说对了没有"统计出来，避免下次又把反方意见当噪音过滤掉。</P>

              <SubTitle>情绪侧复盘 · 七问：把这单底下真正动你的那块石头翻出来</SubTitle>
              <P>评价弹窗最后一块是<strong>情绪侧七问</strong>。它不分析盘面，<strong>分析你自己</strong>：这一刀真正动你的不是图形，是你心里那块石头。前面几块都是在对账（事实是什么 / 归到哪一格 / 体检指标），到这里转向<strong>翻底层动机</strong>——先看清这单背后真正在驱动你的东西，再写下次再遇到时具体准备怎么做。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">问题</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">指向</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">写法约束</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">① 这单最起波澜的事情是什么？</td><td className="px-3 py-2 border-t border-border">情绪触发点</td><td className="px-3 py-2 border-t border-border">只写让你心里一震 / 一紧 / 一急的那个具体时刻</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">② 我的第一反应是什么？</td><td className="px-3 py-2 border-t border-border">未经大脑的本能动作</td><td className="px-3 py-2 border-t border-border">写最原始的那一下冲动，而不是事后整理过的“合理动作”</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">③ 我其实想得到什么？</td><td className="px-3 py-2 border-t border-border">贪婪本质</td><td className="px-3 py-2 border-t border-border">不是“赚钱”这种正确答案——是被认可、扳回上一笔、证明自己看对了等更底层的东西</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">④ 我其实在害怕什么？</td><td className="px-3 py-2 border-t border-border">恐惧本质</td><td className="px-3 py-2 border-t border-border">也不是“亏钱”这种表层答案——是被打脸、错过、回吐、不能再翻身等更底层的东西</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">⑤ 我自己给自己找了一个什么样的理由？</td><td className="px-3 py-2 border-t border-border">合理化（采证而非审判）</td><td className="px-3 py-2 border-t border-border">把当时骗自己的那句话<strong>原样写下来</strong>：“这次不一样”“再等等就回来了”“破位需要确认”</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">⑥ 这单我捞起的<strong>主石头</strong>是什么？</td><td className="px-3 py-2 border-t border-border">恐惧 / 贪婪的具体原型</td><td className="px-3 py-2 border-t border-border">22 个标签按四族分组（恐惧 / 贪婪 / 自我保护 / 虚假掌控），允许多选 + 一句话补刀——<span style={{ color: '#F6465D' }}>至少选一个标签或写一句话</span></td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">⑦ 如果明天同样遇到一样的事情，我准备怎么选？</td><td className="px-3 py-2 border-t border-border">动作级预案（不是口号）</td><td className="px-3 py-2 border-t border-border">不要写“我下次会冷静”——写触发什么信号、做什么动作、不做什么动作（例：再遇到这种快速跳价，先离开屏幕 5 分钟再加减仓）</td></tr>
                  </tbody>
                </table>
              </div>
              <P><strong>主石头</strong>是这块的核心，因为它是<strong>可统计的标签</strong>：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">族</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">动机</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">代表性原型</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>恐惧</span></td><td className="px-3 py-2 border-t border-border">想“少受伤”</td><td className="px-3 py-2 border-t border-border">怕亏 / 怕回吐 / 踏空恐惧 / 怕落后 / 惊慌 / 弥散焦虑 / 羞耻 / 自怜</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F0B90B' }}>贪婪</span></td><td className="px-3 py-2 border-t border-border">想“多拿一点”</td><td className="px-3 py-2 border-t border-border">贪 / 暴富幻想 / 过度自信 / 证明自己 / 被剥夺感 / 复仇</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#D89B00' }}>自我保护</span></td><td className="px-3 py-2 border-t border-border">持仓后才显形：保护的是过去的自己</td><td className="px-3 py-2 border-t border-border">沉没成本 / 不甘心 / 侥幸 / 否认 / 死扛 / 合理化</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">虚假掌控</td><td className="px-3 py-2 border-t border-border">不是真的看见机会，是想用动作压住不确定</td><td className="px-3 py-2 border-t border-border">虚假安心 / 虚假掌控 / 无聊</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                标签 ID 沿用情绪标签体系的命名（fomo / greed / sunk_cost……），方便日后做<strong>交叉分析</strong>：开仓前自标的情绪 vs 事后回看的主石头，是不是同一种？
              </Highlight>
              <RedHighlight>
                七问<strong>全部必填</strong>（主石头允许“至少选一个标签或写一句话”满足其一）——它和评价的其他部分一样，<strong>不写完不能保存离开</strong>。这是逼自己面对底层动机，而不是停在“盘面分析”那一层假装收口。
              </RedHighlight>
              <P className="mt-2">底层逻辑：这一笔会成为样本，进入<strong>结构 × 结果四象限</strong>与<strong>小机会仓位记账</strong>等结构层的统计；同时也会进入<strong>主石头统计</strong>——同一块石头反复出现，就是在告诉你下一步该针对的是这块石头本身，而不是再讲一遍盘面。</P>
            </section>

            <section id="s3-4" className="scroll-mt-20">
              <SubTitle>3.5 持仓与历史</SubTitle>
              <P>底部历史区用于检查执行结果。重点关注三类记录：未评价交易、仓位历史记录、平仓方式。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>未评价交易</strong>：优先补齐。已平仓未评价会硬阻塞下一次开仓。</li>
                <li><strong>仓位历史记录</strong>：可用于归类历史交易，组成一次交易战役；误点“跳过”的主力多单可从“评价状态”列重新发起评价，已评价记录可直接打开原评价。</li>
                <li><strong>平仓方式</strong>：区分手动、止损、止盈、爆仓，判断你是在执行系统还是被情绪驱动。</li>
                <li><strong>克制记录</strong>：记录“我忍住没下的单”，它和实际下单一样进入元监控。</li>
              </ul>
            </section>
          </section>

          <section id="s4" className="scroll-mt-20 bg-accent/30 border border-border rounded-lg p-6">
            <SectionTitle accent="#B080FF">4. 复盘中心</SectionTitle>
            <P>复盘中心负责把交易样本加工成能力。它的正确使用顺序是：先补评价，再看预测误差与错误类型（并在结构成熟度里看哪些结构已经建好），再归类战役，再写规则，最后用元监控验证。</P>

            <section id="s4-1" className="scroll-mt-20">
              <SubTitle>4.1 错题集</SubTitle>
              <P>错题集的单位不是<strong>一笔笔交易</strong>，也不是抽象的"错误类型代码"，而是<strong>开仓快照与平仓评价里每一个具体问题的历史答案分布</strong>。它要回答的是：所有历史主力单加起来，<strong>这道题我都填过些什么</strong>，分布在哪几格，命中过几次坑。</P>
              <P>它一共有 <strong>4 个 tab</strong>：</P>
              <KeyGrid>
                <KeyCard title="汇总（默认）">
                  上半「开仓快照汇总」+ 下半「平仓评价汇总」。每个问题独立折叠，展开看到的不是单笔，是所有历史主力单在这道问题上的答案汇总。
                </KeyCard>
                <KeyCard title="结构成熟度">
                  按 edge 源头切面看哪一条结构闭环已经收敛到能复用的程度（详见 4.2）。
                </KeyCard>
                <KeyCard title="盲区">
                  手动补充系统暂时算不出来、但你明显反复踩到的东西——它和"汇总"互补。
                </KeyCard>
                <KeyCard title="待复盘">
                  只汇总拥有客观操作时间的主力多单，并覆盖全部历史记录（包括旧 position ID 关联）。顶部按标的列出未评价笔数；列表显示未经时间机器移位的操作时间，可一键切换从新到旧 / 从旧到新，并直接补做评价。
                </KeyCard>
              </KeyGrid>
              <P>下面只展开「汇总」这个核心 tab——它直接对接你在开仓快照与平仓评价里填的每一个问题，做了三种不同的渲染：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">问题类型</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">展开后看到的形式</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">怎么读</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">单选 / 多选</td><td className="px-3 py-2 border-t border-border">每个选项一条进度条，附计数 + 百分比</td><td className="px-3 py-2 border-t border-border">看哪几个选项占比最高；危险选项（如「无明确 edge」「按百分比拍止损」）会标红，重在看高占比的危险项</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">数值（心态分 / 纠结度 / 预测胜率 / 最大亏损）</td><td className="px-3 py-2 border-t border-border">均值 · 中位 · 极值 + 分桶分布条</td><td className="px-3 py-2 border-t border-border">看你在这个数值上的常住区，以及尾巴有没有失控</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">文本（这笔为什么会对 / 亏完最可能原因 / 情绪七问等）</td><td className="px-3 py-2 border-t border-border">所有历史回答的完整列表，按时间倒序，带 symbol / 方向 / 时间 / 平仓结果着色</td><td className="px-3 py-2 border-t border-border">点击任意一条直接跳到那笔的 K 线回放页，看见"我当时说什么 + 行情后来怎么走"</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                统计口径只看<strong>主力单</strong>（非对冲、非"太难"）——对冲单字段路径完全不同，混进来会让答案分布失真。
              </Highlight>
              <P>汇总当前覆盖 <strong>17 个开仓字段</strong>（心态自评、市场结构、入场阶段、edge 源头、机会成本、便宜机会、盈亏比目标、止损质量、预测胜率、最大亏损、情绪标签、认知偏差、这笔为什么会对、亏完最可能原因、提前止损信号、反对者陈述、Stop Doing 临时一条）和 <strong>15 个平仓字段</strong>（结构归类、纠结度、证伪触发状态、小机会拖累、主石头标签 + 情绪七问的 7 个文字题 + 反 / 止 / 结构三个事实题）。新增字段只需要往字段 spec 里加一行就会自动出现。</P>
              <SubTitle>提交永不丢：本机镜像兜底</SubTitle>
              <P>
                平仓评价提交后，<strong>一定会成功落库、并立即出现在「汇总」里</strong>，不存在"提交了却看不到"的情况。即使远程数据库还没建某些扩展列（你没跑最新迁移），提交也<strong>不会整笔失败</strong>——基础字段照常写远程，缺列的字段写入<strong>本机镜像</strong>，汇总同样读得到。所以右上角若提示"其中 N 项暂未同步到远程库（缺列）"，那不是报错：你填的内容已经在本机、汇总看得见，只是这几项还没同步到云端。
              </P>
              <RedHighlight>
                本机镜像只兜<strong>当前这台设备</strong>的可见性，是过渡方案、非最终解。换设备或清浏览器缓存前，务必去 Supabase 跑最新 safety net 迁移把缺列补齐；否则那几项不会跟着账号跨设备走。
              </RedHighlight>
            </section>

            <section id="s4-2" className="scroll-mt-20">
              <SubTitle>4.2 结构成熟度</SubTitle>
              <P>结构成熟度和错题集用的是<strong>同一份预测误差</strong>，只是换一个切面：错题集按“错误<strong>种类</strong>”切，这里按“<strong>结构</strong>（edge 源头）”切。它回答的是另一个问题——<strong>哪一个结构我已经建好</strong>：误差低、而且稳，稳到可以拿它当过滤器去捕捉匹配的标的。</P>
              <P><strong>你押的从来不是一个数，是一个结构闭环。</strong>期望值 <strong>E = P×b −(1−P)</strong> 只是这个闭环在“胜率×赔率”这一个切面上的标量投影——它必要，但只占一部分。结构本身是一套自洽的交易闭环：<strong>正</strong>（最大概率的正向走势预期）、<strong>反</strong>（与正向预期不符的判断准则）、<strong>止</strong>（什么具体信号一出就意味着正向预期开始失效）。这三件事，正是开仓快照里 <strong>正 / 反 / 止</strong> 三问在当时写下的。所以<strong>成熟 = 闭环成熟</strong>：不只胜率要校准，止损也要走“前门”。</P>
              <P>这正是你给自己定的纪律的正面：<strong>纪律就是“建模”，从混沌中抽象出结构</strong>。它是错题集那条“错误 → 拦截规则”负向回路的<strong>正向镜像</strong>——负向回路把反复出现的错误升级成规则去<strong>封杀</strong>；这里把误差收敛的结构毕业成模型去<strong>复用</strong>。一个收口，一个放大。</P>
              <KeyGrid>
                <KeyCard title="按结构分桶">
                  把已复盘、标了 edge 源头的真实主力单，按 edge 源头归集成一个个“结构”，各自算出独立的预测-误差画像。
                </KeyCard>
                <KeyCard title="成熟度阶梯">
                  每个结构落在三档之一：混沌 → 成形中 → 成熟。判档只看校准误差是否低且稳，不看单笔盈亏。
                </KeyCard>
                <KeyCard title="成熟即过滤器">
                  误差收敛到“低且稳”的结构毕业到「我的成熟结构」清单，连同它的模型模板（等什么 / 好位置 / 不做），当作下一步捕捉标的的清单。
                </KeyCard>
              </KeyGrid>
              <P>每个结构卡片给出四个核心读数，外加误差趋势与止损死法门：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">读数</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">怎么读</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">预测 → 实际胜率</td><td className="px-3 py-2 border-t border-border">该结构的平均预测胜率，对照真实命中率</td><td className="px-3 py-2 border-t border-border">差距大 = 这个结构上你系统性高估或低估自己</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">Brier（越低越准）</td><td className="px-3 py-2 border-t border-border">预测概率与结果之间的均方误差，0.25 是永远拍 50% 的基线</td><td className="px-3 py-2 border-t border-border">≤0.18 明显优于基线 = 准；&gt;0.25 = 还不如乱猜</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">R 兑现缺口</td><td className="px-3 py-2 border-t border-border">事前定的目标 R 减去实际打到的 R</td><td className="px-3 py-2 border-t border-border">正且大 = 结构看对了却没拿住，盈亏比目标落空</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">校准样本</td><td className="px-3 py-2 border-t border-border">进入胜率校准的样本数 / 该结构总下注数</td><td className="px-3 py-2 border-t border-border">不足 5 笔不判成熟——孤例不是数据</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">误差趋势</td><td className="px-3 py-2 border-t border-border">新半段平均误差减旧半段（与错题集相反，这里误差越小越好）</td><td className="px-3 py-2 border-t border-border">收敛 = 在建模；发散 = 在退化；样本不足不下结论</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">止 · 死法门</td><td className="px-3 py-2 border-t border-border">亏损是怎么死的：前门（按预案触发并止损）/ 晚门（看见了却晚动）/ 后门（死法不在预案内）</td><td className="px-3 py-2 border-t border-border">前门为主 = 失败模式已建模；后门多 = 没设防的尾巴</td></tr>
                  </tbody>
                </table>
              </div>
              <P>由这几项判出成熟度档位：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">档位</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">判定</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">成熟 · 可作过滤器</td><td className="px-3 py-2 border-t border-border">≥5 校准样本，Brier ≤0.18，误差不发散，且亏损多从前门走（后门死法不过半）</td><td className="px-3 py-2 border-t border-border">已建好的、可复用的模型，毕业进「我的成熟结构」</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">成形中</td><td className="px-3 py-2 border-t border-border">Brier 在基线附近（≤0.25），或误差正在收敛</td><td className="px-3 py-2 border-t border-border">有苗头但还没稳，继续攒同结构样本</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">混沌</td><td className="px-3 py-2 border-t border-border">样本不足，或误差大且不在收敛</td><td className="px-3 py-2 border-t border-border">结构还没建好，先别当它是 edge</td></tr>
                  </tbody>
                </table>
              </div>
              <P>每个结构卡片还会标出它<strong>最常栽的那一类错</strong>（直接复用错题集的错误类型，scope 到本结构），告诉你这个结构现在卡在哪——是过度自信、还是止损没执行、还是结构判错。点开卡片能看到押注该结构的每一笔证据，最近在前。</P>
              <Highlight>
                成熟结构清单是错题集的镜像产物：错题集把反复的错误收成规则去封杀，结构成熟度把收敛的结构毕业成过滤器去复用。<strong>误差做得够多，你才看得清哪个结构已经建好</strong>——把它挑出来，去过滤、去捕捉匹配它的标的。这就是从混沌里抽象出结构的全过程。
              </Highlight>
              <RedHighlight>
                毕业有两道闸，少一道都不算成熟。其一，<strong>发散就退档</strong>：一个结构即使曾经成熟，一旦近期误差重新发散，就自动跌回成形中或混沌，成熟清单只保留当下仍然低且稳的那些。其二，<strong>后门死法一票压档</strong>：只要亏损里“死法不在预案内”过半，胜率再准也不给毕业——一个靠运气赢、却每次都死在预案外的结构，是没建模的尾巴，迟早爆。真正的成熟是：<strong>它怎么赢你知道，它怎么死你也提前知道，而且真死的时候你是按预案死的。</strong>
              </RedHighlight>
            </section>

            <section id="s4-3" className="scroll-mt-20">
              <SubTitle>4.3 交易战役</SubTitle>
              <P>战役是比单笔交易更高一层的复盘单位。一次战役由同一标的、同一主方向、明确开始结束、多个 leg 组成。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">来源</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">适用场景</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">边界</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">实时归类</td><td className="px-3 py-2 border-t border-border">开主力单时直接指定战役</td><td className="px-3 py-2 border-t border-border">事件链最完整，优先使用</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">历史归类</td><td className="px-3 py-2 border-t border-border">把已有 journal 或仓位历史记录组成战役</td><td className="px-3 py-2 border-t border-border">可补结构，不能补回当时的真实心态</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">裸 record 回填</td><td className="px-3 py-2 border-t border-border">旧数据没有 journal 时使用</td><td className="px-3 py-2 border-t border-border">只用于进入战役视野，不参与完整 SOP 评价</td></tr>
                  </tbody>
                </table>
              </div>
              <P>归类历史交易时，先输入或选择标的，再从该币种所有时间段的仓位历史记录中勾选一组相关交易。被选中的记录共同构成一次交易战役。</P>
              <P>实时战役与历史归类战役必须隔离。实时战役在开仓时归属；历史归类只加入历史战役，不把回填数据混进实时训练口径。</P>
              <P>战役列表顶部有一组很轻的排序入口，默认按<strong>真实操作时间</strong>排序；也可以按重要性、盈亏金额、盈亏百分比、字母顺序切换，并支持从大到小 / 从小到大双向排序。这里的操作时间指客观发生时间，不是时间机器里的模拟时间。</P>
              <P>互关账户可以打开彼此的战役详情，并留下带可信度权重的留言评价。外部校验只评价当时结构、证伪与执行是否自洽，不用后续走势倒推对错。</P>

              <SubTitle>战役详情页：K 线时间轴标注</SubTitle>
              <P>
                打开一次战役，上方是贯穿整段的 K 线回放，下方是 <strong>Legs 列表</strong>。两者共用同一条时间轴，对照着看就能还原整条战役的进出场节奏：
              </P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>Legs 列表每条腿都标明开仓/平仓时间、开仓价/平仓价、仓位与状态</strong>；还没平仓的腿，平仓时间与平仓价显示「—」。每条腿还单独列出<strong>该腿期间挂的反向对冲空单</strong>（委托价 / 委托时间 / 取消时间）。</li>
                <li><strong>K 线前后区间自动囊括</strong> Legs 列表里最早的开单与最晚的平单，保证每条腿的进出场都落在可视范围内，不会被裁到屏幕外。</li>
                <li>时间轴上用<strong>彩色竖线</strong>标注每条腿的开单 / 平单时刻——颜色区分方向、线型区分动作（见下表）。</li>
                <li>同一时间出现多个事件时，标注会在垂直方向错开并对齐，且会跟随对应 K 线一起移动；缩放或拖动画面时不会丢失事件信息。</li>
              </ul>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">维度</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">取值</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">颜色</td><td className="px-3 py-2 border-t border-border"><span style={{ color: '#2B80FF' }}>蓝色</span></td><td className="px-3 py-2 border-t border-border">多单（long）</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">颜色</td><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F7931A' }}>橘色</span></td><td className="px-3 py-2 border-t border-border">空单（short）</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">线型</td><td className="px-3 py-2 border-t border-border">实线</td><td className="px-3 py-2 border-t border-border">开单时刻</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">线型</td><td className="px-3 py-2 border-t border-border">虚线</td><td className="px-3 py-2 border-t border-border">平单时刻</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                竖线只管"什么方向、什么时候进出"，价格线与三角标记管"在什么价位"。三者叠在同一张图上，整条战役的开、平、对冲、加仓节奏一眼看清。
              </Highlight>

              <SubTitle>战役详情页：盘面叠加层（可显示/隐藏）</SubTitle>
              <P>盘面下方有几个<strong>很隐形的小图标</strong>，用来按需开关叠加层，默认显示、可一键隐藏，避免信息互相打架：</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>
                  <span style={{ color: '#F0B90B' }}>黄色「委托空单」层</span>（眼睛图标）：只呈现这段战役里<strong>真正用于对冲的委托空单</strong>，不包含维多的多单，也不包含委托止盈挂单。委托价画成水平线，委托 / 撤单都有对应竖线；<strong>虚线 + ×</strong> = 已撤销 / 仍挂单中，<strong>实线</strong> = 已触发成交。触发后的线段只延续到这条对冲被手动拆掉的时间点；如果期间没有手动拆掉，就延续到战役平仓时间。原始盘面与反事实编辑器盘面共用同一套数据、同一个开关。
                </li>
                <li>
                  <span style={{ color: '#B080FF' }}>紫色「补齐 / Pure SOP」对照层</span>（眼睛图标）：把所选反事实分支按标准 SOP 推演出的虚拟轨迹叠在真实盘面上；旁边的 <strong>ⓘ</strong> 图标展开标记说明（CF-M 主力、CF-A1~A6 加仓、CF-Ha/CF-Hb 初始对冲、CF-Hr 滚动对冲、CF-TP 镜像止盈、CF-Exit 平仓）。紫色是<strong>虚拟推演、不是真实成交</strong>。
                </li>
              </ul>
              <Highlight>
                委托空单层只在该战役确实有反向委托时才出现；没有就不显示开关，保持盘面干净。
              </Highlight>

              <SubTitle>战役详情页：反事实推演与 SOP 偏离代价</SubTitle>
              <P>
                战役详情页可以做<strong>「如果当时按标准 SOP 走会怎样」</strong>的反事实推演。点<strong>「一键运行」</strong>用这段战役的真实行情、按标准参数（双向对冲 + 镜像止盈）跑一遍 Pure SOP，结果存成一个分支，叠在盘面上对照。
              </P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>反事实的主力锚点<strong>以你的真实成交价 / 成交时间为准</strong>，紫色轨迹会精确贴合你实际开仓那根 K 线，对冲 / 止盈再从真实成交价按 SOP 偏移推算。</li>
                <li>下方「Legs 副本 · 手动反事实」保留可视化编辑（盘面竖线 + 可编辑表格），用于查看与对照。</li>
              </ul>
              <P><strong>SOP 偏离代价明细</strong>把「标准 SOP 要求、但你这场缺的每条建仓腿」逐条折算成钱：</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>每行 = 一条缺失的 SOP 腿（如缺初始对冲 A / B、缺 mirror_tp）。该模板要求主力 + 对冲 A + 对冲 B + mirror_tp 四条建仓腿，缺几条就列几行——和「你下了几个单」无关。</li>
                <li><strong>代价 (USDT)</strong> 与 <strong>占本场盈亏 %</strong>（以本战役实际总盈亏的绝对值为分母）由引擎自动算出。</li>
                <li>「违规阶段 / 违规描述 / 修正后」三列<strong>可手动改写</strong>，点「保存备注」存下；存在战役记录上，<strong>互关者也能读到</strong>，但只有本人能改。</li>
                <li>只要填写了「修正后」，保存时系统会把这条内容连同「违规阶段 / 违规描述」汇总成一条<strong>战役偏离规则</strong>，自动写入复盘中心的「规则」页；重复保存同一条规则不会重复创建。</li>
              </ul>
              <Highlight>
                这张表是系统对执行最锋利的一刀：总代价很小说明这场偏离基本无害；一旦很大（例如超过账户的 1%），就该把对应违规升级成开仓前 checklist 的强制规则。系统会先把它写成核心 checklist 规则；你再到规则页判断是否需要升级为必填或硬规则。
              </Highlight>
            </section>

            <section id="s4-5" className="scroll-mt-20">
              <SubTitle>4.5 规则</SubTitle>
              <P>规则不是独立写出来的口号，而是复盘系统的输出。它来自已发生的交易错误，并被写回下一次开仓前的 checklist。</P>
              <P>规则生成有四条来源：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">来源</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">触发条件</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">生成方式</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">六步深度分析</td><td className="px-3 py-2 border-t border-border">用户完成一笔交易的根因分析</td><td className="px-3 py-2 border-t border-border">Step 6 将结论转写为可检查规则，并可加入 checklist</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">Critical 错误类型</td><td className="px-3 py-2 border-t border-border">同一错误类型近期多次出现且平均亏损</td><td className="px-3 py-2 border-t border-border">系统强制弹出规则写入流程，避免重复错误继续裸奔</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">交易战役偏离明细</td><td className="px-3 py-2 border-t border-border">反事实分支里填写了「修正后」</td><td className="px-3 py-2 border-t border-border">保存偏离备注时，系统把「违规操作 + 修正后的规则」写成核心 checklist 规则，并按规则文本去重</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">手动补充</td><td className="px-3 py-2 border-t border-border">用户发现某条原则需要前置到开仓前</td><td className="px-3 py-2 border-t border-border">在规则页直接写入，并决定是否启用、是否进入 checklist</td></tr>
                  </tbody>
                </table>
              </div>
              <P>生成原理是：先用错题集看见重复误差，或用交易战役反事实看见某个偏离动作真实付出了多少钱；再把原因压缩成可操作的防错条件，最后写成下次开仓前必须检查的规则。</P>
              <P>规则分四类：硬规则违反即阻断交易；核心规则必须进入 checklist；观察规则只记录不阻断；失效规则由元监控证明无效后归档。规则有权重，权重高的规则在 checklist 和元监控中优先展示。</P>
              <P>每条规则都有 0-5 的演化等级：0 是直觉，1 是已表述，2 是模式确认，3 是规则化，4 是算法化，5 是已证伪或已升级。升级必须依赖样本证据，不能靠当下感觉。</P>
              <P>规则修改属于“设计者-我”的工作。有进行中战役时，系统会锁定规则编辑，防止执行者-我在持仓压力下把规则重写成合理化借口。</P>
              <P>规则激活后会进入 7 天冷却期。冷却期内不能关闭、删除、移出 checklist 或降级为非必填，避免刚写下的规则被下一次情绪波动立即废掉。</P>
              <Highlight>
                规则的价值不在于写得完整，而在于能否前置到下一次决策点，并在元监控中看到对应错误频次下降。
              </Highlight>
            </section>
          </section>

          <section id="s5" className="scroll-mt-20">
            <SectionTitle accent="#F0B90B">5. 认知资产</SectionTitle>
            <Highlight>
              你可以在自己的账号里上传自己总结的交易规则、SOP 或复盘原则，作为个人认知资产保存。
            </Highlight>
            <P>这部分不影响交易训练主流程。把它当成你的个人规则库即可，需要时再上传或更新。</P>
          </section>

          <section id="s6" className="scroll-mt-20">
            <SectionTitle accent="#0ECB81">6. 执行力资产</SectionTitle>
            <P>认知资产记的是<strong>你知道什么</strong>，执行力资产记的是<strong>你做了多少</strong>——同一枚硬币的<strong>知</strong>与<strong>行</strong>两面。系统的底层方法是“用试错替代规划”，而试错的样本只能从“做”里长出来：不做，账户数字不会变红，你却永远停在原地。这笔看不见的机会成本，必须被系统看见、被定价、被累积成一份负债。</P>
            <Highlight>
              重复次数的加速器：<strong>做，比想更贵重。</strong>没去做带来的损失，必须被系统看见。
            </Highlight>
            <P>它和“封住下限”是同一件事的两面：正因为单笔亏损被锁死在受得起的数字里，你才<strong>敢多下、敢把该做的单真的做出来</strong>。执行力资产奖励的是<strong>有结构地敢做</strong>——带着决策快照 / 战役 / 复盘去做；同时把“无结构地乱下”和“因为怕错而不做”的代价，一起摆到台面上。</P>

            <SubTitle>怎么计分</SubTitle>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">事件</th>
                    <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">积分</th>
                    <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">为什么是这个分</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="px-3 py-2 border-t border-border">完成平仓评价</td><td className="px-3 py-2 border-t border-border font-mono text-[#B080FF]">+1000</td><td className="px-3 py-2 border-t border-border">把一次交易闭合成可复盘的评价样本——错题集 / 结构成熟度的数据全从这里来；同一笔后续编辑不重复计分</td></tr>
                  <tr><td className="px-3 py-2 border-t border-border">决策记录模块交易</td><td className="px-3 py-2 border-t border-border font-mono text-[#0ECB81]">+600</td><td className="px-3 py-2 border-t border-border">走决策模块下单，留下完整样本：开仓快照 → 平仓评价 → 错题集 / 结构成熟度 / 规则 / 元监控</td></tr>
                  <tr><td className="px-3 py-2 border-t border-border">创建交易战役</td><td className="px-3 py-2 border-t border-border font-mono text-[#5BA3FF]">+300</td><td className="px-3 py-2 border-t border-border">按“自然日 × 标的”计分；同日同标的建一场或多场都只奖励一次</td></tr>
                  <tr><td className="px-3 py-2 border-t border-border">未做平仓评价</td><td className="px-3 py-2 border-t border-border font-mono text-[#F6465D]">-1000</td><td className="px-3 py-2 border-t border-border">已平仓、有成交记录的主力单没做复盘就扣；<strong>可翻转</strong>——事后补做复盘，这 −1000 撤销并翻成 +1000（2000 分摆动，催你清空待复盘）</td></tr>
                  <tr><td className="px-3 py-2 border-t border-border">直接交易（每标的）</td><td className="px-3 py-2 border-t border-border font-mono text-[#F6465D]">-600</td><td className="px-3 py-2 border-t border-border">未走决策模块、无结构地下单；按当日标的去重（同标的多笔只扣一次）</td></tr>
                  <tr><td className="px-3 py-2 border-t border-border">标的未建战役（每标的）</td><td className="px-3 py-2 border-t border-border font-mono text-[#D89B00]">-300</td><td className="px-3 py-2 border-t border-border">当天交易过但没建战役；与同日同标的“建战役 +300”互斥，后补战役会自动撤罚翻转</td></tr>
                  <tr><td className="px-3 py-2 border-t border-border">自然日未练习</td><td className="px-3 py-2 border-t border-border font-mono text-[#F6465D]">-2000</td><td className="px-3 py-2 border-t border-border"><strong>头号大罪</strong>：一整天没有任何练习动作；无正向镜像、<strong>永久不可逆</strong>——后续再练也不退这笔，按模拟时间的自然日结算</td></tr>
                </tbody>
              </table>
            </div>
            <P>七个类目里，前六个是<strong>三对镜像（做 vs 不做，同额反号）</strong>：完成评价 +1000 ↔ 未做评价 −1000、决策 +600 ↔ 直接 −600、建战役 +300 ↔ 未建战役 −300。每一对都在问同一件事——<strong>这一步你做了没有、做得有没有结构</strong>。第七个「自然日未练习 −2000」没有正向镜像、独占一档且最重：练习是一切样本的源头，<strong>断更是头号大罪</strong>。所以这页想拉高的不是总分，而是让每次「做」都落到加分那侧、且<strong>每天至少留一次练习</strong>。</P>

            <SubTitle>什么算、什么不算</SubTitle>
            <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
              <li><strong>只记做多开仓。</strong>做空都是辅助对冲单，属于风险管理动作，不计执行力分。</li>
              <li><strong>挂单成交才计分。</strong>挂出限价单只是意图，真正成交才算“做”——意图不计分，执行才计分。</li>
              <li><strong>“当天已练习” = 下单 / 弃单（太难不做）/ 完成复盘，任一即可。</strong>只要当天留下其中任一动作，就清掉当天的“未练习 −2000”——练的是决策周期，不是必须下注。</li>
              <li><strong>平仓评价：做 +1000、不做 −1000，可翻转。</strong>已平仓的主力单没复盘挂 −1000；<strong>事后补做复盘，这 −1000 撤销并翻成 +1000</strong>（2000 分摆动，催你清空待复盘）。系统按 journal ID 识别，反复编辑不重复计分。之所以可翻转而非永久：复盘价值随时可回收，不像断更不可逆。</li>
              <li><strong>“未练习”扣分永久不可逆、且最重（−2000）。</strong>某个自然日没有任何练习，就永久记一笔 −2000，后面再怎么练、再盈利都不退这笔——单笔亏损能被后续盈利覆盖，断更不能。按模拟时间的自然日结算。</li>
              <li><strong>六项各自独立计分、互不联动。</strong>直接交易 −600 只看「这笔有没有走决策模块」，与是否建战役无关——战役是「计划层」结构、决策记录是「每单层」结构，两者分别度量，不互相抵扣。</li>
              <li><strong>历史按同一把尺重算。</strong>旧数据首次加载会按当前权重重算一次（直接交易按当日标的去重），让新旧记录可比。</li>
            </ul>
            <RedHighlight>
              执行力资产不判<strong>单笔对错</strong>——一笔亏损的决策单照样 +600；但它判你做得<strong>有没有结构</strong>：带着快照 / 战役 / 评价去做加分，无结构地乱下、或干脆不练，扣分。对错（质量）交给复盘中心（错题集 / 结构成熟度 / 规则）去判，这里管的是<strong>做得够多 × 做得有结构</strong>。它专治的是那种更隐蔽的失败——<strong>因为怕错而不做</strong>：在一个下限已被焊死的系统里，不做，往往才是最贵的那个错误。
            </RedHighlight>
          </section>

          <section id="s7" className="scroll-mt-20">
            <SectionTitle accent="#F6465D">7. 数据边界与硬约束</SectionTitle>
            <P className="mb-3">这一节的每一条硬约束，本质上都在做同一件事：把<strong>下限</strong>钉死。它们不决定你能赚多少，只确保最坏情况发生时，你依然亏得起、活得下来——上限可以敞开，正是因为下限不会被击穿。<strong>别把它们读成“风控”或“防守”：恰恰相反，下限被焊死，才是你敢多下、敢让每个赢家跑得更肥的前提——纪律的终极目的是进攻，不是防守。</strong></P>
            <div className="space-y-3">
              <P><strong>主力单与对冲单必须分开理解。</strong> 主力单评估方向与机会质量；对冲单评估风险管理。把两者混在一起，会污染 R 倍数、胜率和错误类型统计。</P>
              <P><strong>最大亏损是 R 倍数的分母。</strong> 它表达的是本次愿意承受的最大错误成本，不应被事后修改成更好看的数字。</P>
              <P><strong>全仓是硬阻断。</strong> 系统训练阶段只允许逐仓。全仓会把单笔错误扩散到账户整体，违背“损失有界”的底层原则。</P>
              <P><strong>平仓评价是硬阻断。</strong> 已平仓交易未完成结构 × 结果、证伪核对与必要叙事前，不能开下一笔新仓。</P>
              <P><strong>低心态是硬阻断。</strong> 心态 ≤2 分时不能开仓，不提供“我知道但继续”的后门。</P>
              <P><strong>后见偏差必须隔离。</strong> 复现页在归因完成前隐藏后续走势，归因完成后才揭示行情路径。</P>
              <P><strong>历史回填不等于真实快照。</strong> 回填可以恢复交易结构，但无法恢复当时的理由、心态和风险认识。系统不会假装知道这些缺失信息。</P>
            </div>
          </section>

          <section id="s8" className="scroll-mt-20">
            <SectionTitle accent="#F0B90B">8. 注意事项</SectionTitle>
            <P>这里专门记录与币安界面不完全一致的特殊口径。遇到这类差异时，以本系统说明为准；原因通常是为了让训练样本、复盘统计和 U本位 / 币本位之间保持可比较。</P>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">事项</th>
                    <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">本系统口径</th>
                    <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">为什么这样做</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">ROE 分母</td>
                    <td className="px-3 py-2 border-t border-border">U本位与币本位合约的 ROE 分母统一固定为开仓时的初始保证金；后续追加保证金不计入 ROE 分母，只影响保证金余额、强平风险和保证金比率。</td>
                    <td className="px-3 py-2 border-t border-border">追加保证金是延长生存时间的动作，不是降低这笔交易原始收益率的动作。看 ROE 时，读的是这笔交易相对初始风险资本的效率；看爆仓风险时，再看保证金余额和保证金比率。</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="s9" className="scroll-mt-20">
            <SectionTitle accent="#B080FF">9. 判断标准</SectionTitle>
            <div className="bg-card border-l-4 border-[#F0B90B] rounded-r p-6 my-8">
              <p className="text-[24px] leading-relaxed text-foreground text-center">
                “系统是否有效，不看你复盘写得多长，而看同一类错误是否越来越少。”
              </p>
            </div>
            <div className="space-y-3">
              <P>一周后看未评价是否清零；一个月后看高频错误是否收敛；两个月后看新规则是否真的降低对应错误频次。能做到这三点，系统就在工作。</P>
              <div className="mt-8 flex flex-col items-center gap-2">
                <Link to="/">
                  <button className="bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black h-10 px-6 rounded font-medium">
                    进入交易页 →
                  </button>
                </Link>
                <div className="text-[11px] text-muted-foreground">
                  任何时候都可以从左上角的“使用说明”重新打开本页。
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
