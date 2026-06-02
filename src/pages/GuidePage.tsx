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
      { id: 's3-3', label: '3.4 持仓与历史' },
    ],
  },
  {
    id: 's4',
    label: '4. 复盘中心',
    children: [
      { id: 's4-1', label: '4.1 错题集' },
      { id: 's4-2', label: '4.2 交易战役' },
      { id: 's4-3', label: '4.3 元监控' },
      { id: 's4-4', label: '4.4 规则' },
    ],
  },
  { id: 's5', label: '5. 认知资产' },
  { id: 's6', label: '6. 数据边界与硬约束' },
  { id: 's7', label: '7. 判断标准' },
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
                <P><strong>L5，元监控层。</strong> 它不看单笔，只看整套方法是否真的有效。它用校准曲线、偏差光谱、规则有效性追踪、D-score vs R 这些工具，回答最根本的问题：你的规则有没有真的改善决策？复盘有没有真的减少重复错误？这套系统，有没有在真正进化？</P>
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
            <P>如果只记一条路径，就按“训练一笔 → 评价一笔 → 归类一类 → 写入一条规则 → 观察规则是否生效”执行。</P>

            <section id="s2-1" className="scroll-mt-20">
              <SubTitle>2.1 交易训练闭环</SubTitle>
              <div className="bg-card border border-border rounded p-6">
                <FlowNode>选择历史时间与标的</FlowNode>
                <FlowArrow />
                <FlowNode>回放行情，等待符合策略的机会</FlowNode>
                <FlowArrow />
                <FlowNode accent>开仓前填写快照：决策三问（正/反/止）、最大亏损、心态自评、三类情绪标签、认知偏差自查、置信度折扣、下注规模建议、checklist；也可选择“太难，不做这单”</FlowNode>
                <FlowArrow />
                <FlowNode>下单、持仓、平仓</FlowNode>
                <FlowArrow />
                <FlowNode accent>平仓后评价：结果、错误标签、复盘结论</FlowNode>
              </div>
            </section>

            <section id="s2-2" className="scroll-mt-20">
              <SubTitle>2.2 每周复盘闭环</SubTitle>
              <ol className="list-decimal pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>打开错题集，优先处理“未评价”交易。</li>
                <li>查看按模式聚类的错误，而不是只看单笔盈亏。</li>
                <li>对重复出现且造成亏损的模式做六步分析。</li>
                <li>把结论写成下一次开仓前能判断的规则。</li>
                <li>在元监控里检查：规则创建后，对应错误频次是否下降。</li>
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
                时光机工具条右侧有一对开关：<strong>决策记录</strong> 与 <strong>直接交易</strong>。这是进入交易页后你做的第一个决定，也是整套系统里最大的一个分叉——它决定本次会话产生的数据是否进入复盘体系。系统默认 <strong>直接交易</strong>，需要训练时手动切换到决策记录。
              </P>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card/95 p-5 shadow-sm">
                  <div className="border-b border-border/50 pb-3">
                    <div className="text-[13px] font-semibold tracking-[0.01em] text-foreground">直接交易（默认）</div>
                  </div>
                  <div className="pt-3 text-[13px] leading-7 text-muted-foreground">
                    下单零弹窗、平仓零评价，节奏与币安 1:1。本模式下产生的交易仅进入持仓历史与交易战役归类，<strong>不进入</strong> 错题集、元监控、规则系统。适合熟悉的标的、流畅的执行、或只想观察盘面的场景。
                  </div>
                </div>
                <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card/95 p-5 shadow-sm">
                  <div className="border-b border-border/50 pb-3">
                    <div className="text-[13px] font-semibold tracking-[0.01em] text-foreground">决策记录</div>
                  </div>
                  <div className="pt-3 text-[13px] leading-7 text-muted-foreground">
                    完整的开仓快照（<strong>决策三问</strong>：为什么对 / 亏完最可能原因 / 证伪信号；最大亏损、心态自评、<strong>情绪标签</strong>（三类）、二元预测胜率、checklist 等）+ 平仓后强制评价 + 错题集自动归类 + 元监控统计 + 规则系统冷却。适合刻意训练同一类 setup、复盘高频错误模式、或对自己进行校准。
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
                    <tr><td className="px-3 py-2 border-t border-border">平仓</td><td className="px-3 py-2 border-t border-border">静默成交</td><td className="px-3 py-2 border-t border-border">弹评价抽屉，不填完不能关</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">交易战役归类</td><td className="px-3 py-2 border-t border-border">可走"裸 record 回填"事后归类</td><td className="px-3 py-2 border-t border-border">实时归类，事件链完整</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">错题集 / 元监控</td><td className="px-3 py-2 border-t border-border">不收录</td><td className="px-3 py-2 border-t border-border">全量收录、自动聚类、CI 与基线对比</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">高频错误强制写规则</td><td className="px-3 py-2 border-t border-border">不触发</td><td className="px-3 py-2 border-t border-border">同一 pattern 30 天 ≥3 次自动弹窗</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">致命单笔损失弹窗</td><td className="px-3 py-2 border-t border-border">不触发</td><td className="px-3 py-2 border-t border-border">单笔实亏 ≥2× 预设最大亏损时弹窗</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">心态 ≤2 / Lollapalooza 风险阻挡</td><td className="px-3 py-2 border-t border-border">不出现（无快照）</td><td className="px-3 py-2 border-t border-border">硬阻挡，不能下单</td></tr>
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
            </section>

            <section id="s3-2" className="scroll-mt-20">
              <SubTitle>3.3 下单前快照</SubTitle>
              <P>开仓快照是系统的核心记录点。它固定“下单前的你”看到什么、相信什么、愿意亏多少、处在什么心态。但这里有一个必须先讲清的底层原则：<strong>主力单与对冲单不是同一类决策，不能用同一套问题去问。</strong> 主力单是在分布右尾下注，核心是“这次机会为什么值得押”；对冲单是在分布左尾买保险，核心是“什么时候裸拿已经变成负期望，应该让保险接管”。</P>

              <SubTitle>主力单快照：先看盈亏比，再校准胜率</SubTitle>
              <P><strong>主力单</strong>的第一性原理是：你是在押一段右尾收益，真正要回答的是<strong>这笔是否有正期望</strong>，而不是“我有多想下单”。系统因此把主力单快照拆成两条轴：<strong>盈亏比轴</strong>决定做不做，<strong>胜率轴</strong>校准你的方向判断。</P>
              <P>主力单使用的核心公式是：<strong>E = P(赢) × b − (1 − P)</strong>，其中 <strong>b</strong> 是盈亏比。E 以 R 为单位显示；当你填入“本次最大亏损 USDT”后，系统会同步折算这一笔的<strong>单笔期望 USDT</strong>。如果 E ≤ 0，这笔没有下注资格，除非你能解释为什么赔率被市场明显错误定价。</P>
              <P><strong>盈亏比轴</strong>先问结构，不问方向、不问涨幅。你要先判断这笔属于三种结构之一：逆拥挤但未释放、中性震荡、顺情绪追价且已释放。随后用盈亏比滑条给出当前结构下的预期盈亏比，滑条上的 <strong>1:1</strong> 是显式锚点：低于或接近它时，胜率必须非常高才可能有正期望。</P>
              <P><strong>胜率轴</strong>再问方向。它保留决策三问和二元置信度滑块，但它不是让你挑一个“看起来胜率高”的单，而是把你当时的判断写成可校准样本。平仓后，系统会用结果反查：你当时给出的概率是否过度自信，失败剧本是否命中，证伪信号是否被尊重。</P>
              <Highlight>
                主力单的顺序是：先用盈亏比轴决定“这笔值不值得做”，再用胜率轴记录“我为什么认为方向会对”。胜率不能弥补坏结构；空仓观望是正向选择。
              </Highlight>

              <SubTitle>主力单的盈亏比轴（先决定做不做）</SubTitle>
              <P>盈亏比轴是主力单快照的第一层筛子。它不是让你预测能涨多少，而是让你判断<strong>结构是否给了足够好的赔率形状</strong>。结构不好时，最优动作不是勉强下小仓，而是空仓观望。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">结构</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">系统态度</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">逆拥挤</td><td className="px-3 py-2 border-t border-border">向量纯净，但还未释放；可能是结构性高盈亏比</td><td className="px-3 py-2 border-t border-border">允许继续填写，但必须写清结构来源、失败原因与破坏信号</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">中性震荡</td><td className="px-3 py-2 border-t border-border">多空力量胶着；盈亏比取决于止损纪律是否封死下限</td><td className="px-3 py-2 border-t border-border">提示“持有小机会仓位”风险，默认推荐空仓观望</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">顺情绪 / 追价</td><td className="px-3 py-2 border-t border-border">向量纯净但已经释放；反向回吐空间大</td><td className="px-3 py-2 border-t border-border">提示坏结构，主按钮转为“空仓观望 / 太难不做”；仍要下单需二次确认</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">盈亏比滑条</td><td className="px-3 py-2 border-t border-border">给出预期盈利 / 预期亏损；1:1 是显式锚点</td><td className="px-3 py-2 border-t border-border">战役盈亏样本不足时，下注规模模块会用滑条值计算期望值与建议上限</td></tr>
                  </tbody>
                </table>
              </div>

              <SubTitle>主力单的决策三问（正—反—止）</SubTitle>
              <P>下面这组三问属于主力单的<strong>胜率轴</strong>。它的作用是把一次方向判断拆成“证成、反证、证伪”三步，逼你同时看见收益剧本和失败剧本。对冲单不会复用这套问题，因为对冲不是在赌方向，而是在记录边界、必要性和保险质量。</P>
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
                    <tr><td className="px-3 py-2 border-t border-border"><span style={{ color: '#F6465D' }}>③ 止</span></td><td className="px-3 py-2 border-t border-border">什么 K 线 / 盘面信号会让你提前止损或拆仓？</td><td className="px-3 py-2 border-t border-border">证伪点必须是可被盘面客观验证的事件（破支撑、量能背离、收盘价等）</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                三问的意义不是“写满表单”，而是让胜率判断留下可校准证据。盈亏比轴已经决定这笔是否值得做；三问负责记录你为什么认为方向会对，以及哪里证明你错。
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
                “太难”与“该开没开”不是一回事。“该开没开”是机会过去了才记录；“太难”是在开仓弹窗里当场作出的放弃决定。
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
                    <tr><td className="px-3 py-2 border-t border-border">执行偏差</td><td className="px-3 py-2 border-t border-border">我是不是被盈亏和自尊绑架了？</td><td className="px-3 py-2 border-t border-border">锚定、沉没成本、现状偏差、承诺升级、拖延偏误、Lollapalooza 复合效应</td></tr>
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
                    <tr><td className="px-3 py-2 border-t border-border">盈亏比轴</td><td className="px-3 py-2 border-t border-border">先判断这笔是否值得做</td><td className="px-3 py-2 border-t border-border">三态结构必选；中性震荡与顺情绪追价会强化空仓观望提示</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">盈亏比滑条</td><td className="px-3 py-2 border-t border-border">记录本次预期盈利 / 预期亏损</td><td className="px-3 py-2 border-t border-border">1:1 是显式锚点；战役盈亏样本不足时作为期望值和定仓计算的回落口径</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">本次最大亏损 USDT</td><td className="px-3 py-2 border-t border-border">定义本次风险预算</td><td className="px-3 py-2 border-t border-border">后续 R 倍数以此为分母；占总账户 ≥10% 会触发提醒</td></tr>
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
              <SubTitle>3.4 持仓与历史</SubTitle>
              <P>底部历史区用于检查执行结果。重点关注三类记录：未评价交易、仓位历史记录、平仓方式。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>未评价交易</strong>：优先补齐。已平仓未评价会硬阻塞下一次开仓。</li>
                <li><strong>仓位历史记录</strong>：可用于归类历史交易，组成一次交易战役。</li>
                <li><strong>平仓方式</strong>：区分手动、止损、止盈、爆仓，判断你是在执行系统还是被情绪驱动。</li>
                <li><strong>克制记录</strong>：记录“我忍住没下的单”，它和实际下单一样进入元监控。</li>
              </ul>
            </section>
          </section>

          <section id="s4" className="scroll-mt-20 bg-accent/30 border border-border rounded-lg p-6">
            <SectionTitle accent="#B080FF">4. 复盘中心</SectionTitle>
            <P>复盘中心负责把交易样本加工成能力。它的正确使用顺序是：先补评价，再打标签，再归类战役，再写规则，最后用元监控验证。</P>

            <section id="s4-1" className="scroll-mt-20">
              <SubTitle>4.1 错题集</SubTitle>
              <P>错题集按错误模式组织交易，而不是只按时间陈列交易。这里要解决的问题是：同一类错误是否在重复发生。</P>
              <KeyGrid>
                <KeyCard title="按模式">
                  默认视图。用于发现高频、近期、亏损严重的错误模式。
                </KeyCard>
                <KeyCard title="按时间">
                  用于追踪最近交易质量，适合补评价和逐笔检查执行。
                </KeyCard>
                <KeyCard title="标签字典">
                  入口在错题集内部。用于维护错误大类和具体 pattern，避免复盘标签越来越散。
                </KeyCard>
              </KeyGrid>
            </section>

            <section id="s4-2" className="scroll-mt-20">
              <SubTitle>4.2 交易战役</SubTitle>
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
              <P>互关账户可以打开彼此的战役详情，并留下带可信度权重的留言评价。外部校验只评价“按当时信息看是否是好决策”，不是用后续走势倒推对错。</P>
            </section>

            <section id="s4-3" className="scroll-mt-20">
              <SubTitle>4.3 元监控</SubTitle>
              <P>元监控回答“系统是否真的让你变好”。不要只看漂亮图表，核心看规则创建后，对应错误模式是否在扣除自然学习曲线与 regression to mean 后仍然下降。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>错误趋势</strong>：同一 pattern 的近期变化。</li>
                <li><strong>规则有效性</strong>：规则上线后，对应错误是否减少，并与全局基线比较。</li>
                <li><strong>置信区间</strong>：低样本下不把随机波动误读成进步。</li>
                <li><strong>Calibration</strong>：比较开仓预测胜率与平仓结果，观察判断是否过度自信。</li>
                <li><strong>可信度向量</strong>：分别追踪方向判断、决策质量、反对者命中、快照完整度和校准能力。</li>
                <li><strong>决策质量 vs 结果</strong>：用 D-score 与 R 的散点关系判断规则是否真有预测性。</li>
                <li><strong>情绪日志</strong>：按正向/中性/负向三类分组统计后续平均 R，识别最危险的心理入口；正向/中性标签同样进入对比，用来检验“自认为状态好”是否真的有正期望。</li>
                <li><strong>规则演化地图</strong>：查看规则从直觉、表述、模式确认、规则化到算法化的证据等级。</li>
                <li><strong>订单类型分布</strong>：主力单与对冲单是否失衡。</li>
                <li><strong>心态与时段</strong>：识别你的高质量状态与危险时段。</li>
              </ul>
              <RedHighlight>
                元监控不是展示页，而是审计页。如果规则没有降低错误频次，就回到规则页重写。
              </RedHighlight>
            </section>

            <section id="s4-4" className="scroll-mt-20">
              <SubTitle>4.4 规则</SubTitle>
              <P>规则不是独立写出来的口号，而是复盘系统的输出。它来自已发生的交易错误，并被写回下一次开仓前的 checklist。</P>
              <P>规则生成有三条来源：</P>
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
                    <tr><td className="px-3 py-2 border-t border-border">Critical 错误模式</td><td className="px-3 py-2 border-t border-border">同一 pattern 近期多次出现且平均亏损</td><td className="px-3 py-2 border-t border-border">系统强制弹出规则写入流程，避免重复错误继续裸奔</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">手动补充</td><td className="px-3 py-2 border-t border-border">用户发现某条原则需要前置到开仓前</td><td className="px-3 py-2 border-t border-border">在规则页直接写入，并决定是否启用、是否进入 checklist</td></tr>
                  </tbody>
                </table>
              </div>
              <P>生成原理是：先用错题集把单笔错误归入 pattern，再用复盘分析找出可操作的防错条件，最后把这个条件写成下次开仓前必须检查的规则。</P>
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
            <SectionTitle accent="#F6465D">6. 数据边界与硬约束</SectionTitle>
            <P className="mb-3">这一节的每一条硬约束，本质上都在做同一件事：把<strong>下限</strong>钉死。它们不决定你能赚多少，只确保最坏情况发生时，你依然亏得起、活得下来——上限可以敞开，正是因为下限不会被击穿。</P>
            <div className="space-y-3">
              <P><strong>主力单与对冲单必须分开理解。</strong> 主力单评估方向与机会质量；对冲单评估风险管理。把两者混在一起，会污染 R 倍数、胜率和错误模式统计。</P>
              <P><strong>最大亏损是 R 倍数的分母。</strong> 它表达的是本次愿意承受的最大错误成本，不应被事后修改成更好看的数字。</P>
              <P><strong>全仓是硬阻断。</strong> 系统训练阶段只允许逐仓。全仓会把单笔错误扩散到账户整体，违背“损失有界”的底层原则。</P>
              <P><strong>平仓评价是硬阻断。</strong> 已平仓交易未完成评价、标签与归因前，不能开下一笔新仓。</P>
              <P><strong>低心态是硬阻断。</strong> 心态 ≤2 分时不能开仓，不提供“我知道但继续”的后门。</P>
              <P><strong>后见偏差必须隔离。</strong> 复现页在归因完成前隐藏后续走势，归因完成后才揭示行情路径。</P>
              <P><strong>历史回填不等于真实快照。</strong> 回填可以恢复交易结构，但无法恢复当时的理由、心态和风险认识。系统不会假装知道这些缺失信息。</P>
            </div>
          </section>

          <section id="s7" className="scroll-mt-20">
            <SectionTitle accent="#B080FF">7. 判断标准</SectionTitle>
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
