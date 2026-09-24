import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ChevronDown, Download, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { toast } from '@/lib/notificationCenter';
import './GuidePage.css';

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
      { id: 's3-1b', label: '3.3 P_gap 优势边际' },
      { id: 's3-1c', label: '3.4 宽框架与严框架' },
      { id: 's3-2', label: '3.5 下单前快照' },
      { id: 's3-3', label: '3.6 平仓评价复盘' },
      { id: 's3-4', label: '3.7 持仓与历史' },
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
    <div className="guide-callout guide-callout--amber">
      {children}
    </div>
  );
}

function RedHighlight({ children }: { children: ReactNode }) {
  return (
    <div className="guide-callout guide-callout--red">
      {children}
    </div>
  );
}

function SectionTitle({ children, accent }: { children: ReactNode; accent?: string }) {
  return (
    <div className="guide-section-title">
      <span
        className="guide-section-marker"
        style={{ background: accent ?? 'hsl(var(--primary))' }}
      />
      <h2 className="guide-section-heading">{children}</h2>
    </div>
  );
}

function SubTitle({ children, anchor }: { children: ReactNode; anchor?: boolean }) {
  return <h3 className={`guide-subtitle${anchor ? ' guide-subtitle--anchor' : ''}`}>{children}</h3>;
}

function P({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`guide-copy ${className}`}>{children}</p>;
}

function TocList({ activeId, onJump }: { activeId: string; onJump?: () => void }) {
  return (
    <nav className="guide-toc">
      <div className="guide-toc-label">目录</div>
      {TOC.map(item => (
        <div key={item.id}>
          <a
            href={`#${item.id}`}
            onClick={onJump}
            className={`guide-toc-link ${
              activeId === item.id ? 'is-active' : ''
            }`}
          >
            {item.label}
          </a>
          {item.children?.map(c => (
            <a
              key={c.id}
              href={`#${c.id}`}
              onClick={onJump}
              className={`guide-toc-link guide-toc-link--child ${
                activeId === c.id ? 'is-active' : ''
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
  return <div className="guide-key-grid">{children}</div>;
}

function KeyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="guide-key-card">
      <div className="guide-key-card__header">
        <div className="guide-key-card__title">{title}</div>
      </div>
      <div className="guide-key-card__body">{children}</div>
    </div>
  );
}

function FlowNode({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <div className={`guide-flow-node ${
      accent ? 'guide-flow-node--accent' : ''
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
  const [charCount, setCharCount] = useState<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  /**
   * 全文字数。按「非空白字符」计：中文没有词边界，按词数算不成立；
   * 空格与换行只是排版，不该被读成内容。
   * 用克隆体来数，并把 data-guide-meta 摘掉——字数那一行自己也在 main 里，
   * 不摘就会把自己数进去（而且数完一变，下一次又不一样）。
   */
  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[data-guide-meta]').forEach(node => node.remove());
    setCharCount((clone.textContent ?? '').replace(/\s+/g, '').length);
  }, []);

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
    <div className="guide-page min-h-screen bg-background text-foreground">
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

        <main ref={mainRef} className="guide-doc min-w-0">
          <section id="s1" className="scroll-mt-20">
            <SectionTitle accent="#F0B90B">1. 系统定位</SectionTitle>
            <div className="guide-stack">
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
              <div className="guide-stack">
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
              <SubTitle anchor>2.1 交易训练闭环</SubTitle>
              <div className="bg-card border border-border rounded p-6">
                <FlowNode>选择历史时间与标的</FlowNode>
                <FlowArrow />
                <FlowNode>观看历史盘面走势，衡量是否出现下单时机；看不懂、赔率不够、超出能力圈时，允许直接空仓观望</FlowNode>
                <FlowArrow />
                <FlowNode accent>开仓前填写一个快照模块：主力单按顺序走三步——先认源头 · 机会成本（五个机制 edge + “不做更亏吗”三选），再过 ① 盈亏比目标（1R/2R/3R 目标五选、R 回撤分母效应、目标空间三问、盈亏比滑条与 1:1 锚点、具体期望值），最后过 ② 胜率轴（决策三问、二元预测概率、置信度 basis、最大亏损、心态自评、情绪标签、认知偏差自查、下注规模建议与 checklist）；机会成本不足、源头不清或目标不厚时，系统默认推荐“空仓观望 / 太难不做”</FlowNode>
                <FlowArrow />
                <FlowNode>下单、持仓、平仓；若左尾风险扩大，对冲单走独立的边界、必要性、把握性与双向预案快照</FlowNode>
                <FlowArrow />
                <FlowNode accent>平仓后评价：在居中评价弹窗里分别判断入场、持仓、离场三阶段的决策质量，再核对快照里写下的证伪信号、结构破坏信号与置信度是否被市场验证；系统自动归纳「结构 × 结果」，事实模块负责对账，叙事模块只负责解释原因</FlowNode>
                <FlowArrow />
                <FlowNode>归类到交易战役；错题集按“预测和结果之间的误差”自动汇总错误类型，重复出现的误差再写成规则，并到元监控里验证规则是否真的降低频次</FlowNode>
              </div>
              <Highlight>
                闭环的关键不是“每次都下单”，而是每次都留下可学习样本：做了的单、没做的单、对冲的单、亏损的单、合规但亏的单，都要能被事后还原。
              </Highlight>
            </section>

            <section id="s2-2" className="scroll-mt-20">
              <SubTitle anchor>2.2 每周复盘闭环</SubTitle>
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
              <SubTitle anchor>3.1 交易模式选择</SubTitle>
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
              <SubTitle anchor>3.2 时光机与行情</SubTitle>
              <P>
                时光机是交易页的核心训练能力。它把真实历史行情切回到你指定的某一刻，并用“模拟时钟”继续向前播放。你只能看到当时已经发生的数据，看不到未来。
              </P>
              <KeyGrid>
                <KeyCard title="选择历史时点">
                  输入日期和时间后，系统加载该时刻附近的真实历史行情。K 线、盘口、成交、持仓盈亏和订单触发都以模拟时间为准。
                </KeyCard>
                <KeyCard title="加速播放">
                  支持 1x、2x、5x、10x、30x、60x、180x、300x、900x、1800x、3600x 共 11 档。慢速用于练决策细节，高倍速用于快速穿越等待区和重复训练同类行情。高倍速对数据的消耗是线性的（3m 周期 180 倍速 = 1 根 K 线 / 秒，1m 周期 3600 倍速达 60 根 / 秒），系统会在接近已加载边界时自动预取下一批——预取阈值按「还剩几秒真实时间」计算，倍速越高提前量越大，取到尽头才自动暂停。
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
                    <tr><td className="px-3 py-2 border-t border-border">倍速播放</td><td className="px-3 py-2 border-t border-border">按 1x 到 3600x 推进行情</td><td className="px-3 py-2 border-t border-border">用高倍速提高训练密度，用低倍速校准执行质量</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">统一模拟时钟</td><td className="px-3 py-2 border-t border-border">订单、持仓、盈亏、历史记录同步推进</td><td className="px-3 py-2 border-t border-border">让训练接近真实交易节奏</td></tr>
                  </tbody>
                </table>
              </div>
              <KeyGrid>
                <KeyCard title="K 线主图">
                  用来建立交易假设：趋势延续、结构反转、区间波动或放弃交易。不要在持仓后用图表临时补理由。
                </KeyCard>
                <KeyCard title="盘口与成交">
                  订单簿、最新成交、市场异动合并成右栏下方的一个模块，<strong>默认折叠</strong>成一条表头，把纵向空间让给 P_gap。折叠时点任一页签即展开到该页签。用来观察微观结构；若盘口不是策略的一部分，就不要用它作为冲动加仓的借口。
                </KeyCard>
                <KeyCard title="推荐节奏">
                  新手先用 1x-5x 练完整决策，熟悉后用 10x-60x 提高样本量；180x 到 900x 适合穿越无交易价值的等待区，1800x / 3600x 用于跨越以「天」计的长等待区——但此时只适合空仓快进，不适合挂着条件单跑（原因见下条）。
                </KeyCard>
              </KeyGrid>
              <Highlight>
                时光机的价值不是“快进看答案”，而是在看不到未来的条件下，把同一类行情反复练到动作稳定。倍速只是提高训练密度，不能替代下单前的判断。
              </Highlight>

              <SubTitle>盘面指标</SubTitle>
              <P>
                主图右上角的<strong>「指标」</strong>入口打开指标面板：可搜索、可按<strong>趋势 / 动量 / 波动率 / 量能</strong>分类筛选。目录共 106 项，其中 <strong>43 项已实现</strong>可直接加载，未实现的条目在列表中灰显、点不动——<strong>不会给你一条画不出数的空线</strong>。叠加类指标（均线、通道等）画在主图上，震荡类指标各占一个副图窗格。
              </P>
              <SubTitle>衡量波动率方差：HV 历史波动率</SubTitle>
              <P>
                波动率分类下的<strong>「历史波动率(方差)」</strong>就是直接衡量收益方差的那一个。它不是看 K 线振幅，而是先取<strong>对数收益</strong> rᵢ = ln(收盘ᵢ ÷ 收盘ᵢ₋₁)，在滚动窗口内算<strong>样本方差</strong>（除以 n−1），开平方得标准差，再按周期<strong>年化</strong>成百分数：
              </P>
              <div className="my-3 rounded bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                σ<sub>年化</sub> = √( Σ(rᵢ − r̄)² ÷ (N−1) ) × √(全年毫秒数 ÷ 单根周期毫秒数) × 100%
              </div>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>年化系数自动适配周期。</strong>系数由相邻 K 线的时间戳推断（加密市场按 7×24 全年计），所以你在 1m 和 1h 之间切换，读数口径不变、可直接横向比较——这正是「年化」的意义所在。</li>
                <li><strong>两条线。</strong>主线是年化 σ%，另一条是半窗滚动均值的平滑线，用来看当前波动率是高于还是低于自己近期的常态。</li>
                <li><strong>宁缺勿假。</strong>窗口未满的前 N 根、以及被无效价格污染到的窗口，一律留空不画，不会用残缺样本凑一个数出来。</li>
                <li>默认窗口 20 根。窗口越短越跟手、噪声越大；越长越平滑、越滞后。</li>
              </ul>
              <Highlight>
                这条线回答的是「<strong>现在这段行情比平时躁动多少</strong>」。它与 P_gap 是互补的两件事：P_gap 用 K 与 T 的距离度量你<strong>主动设定</strong>的风险几何，HV 度量市场<strong>客观呈现</strong>的波动幅度。同样的止损距离，在高 HV 环境里被扫的概率要高得多——把止损放在多远才不算「送」，本就该随 HV 调整。
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

              <SubTitle>倒叙播放</SubTitle>
              <P>顶部 Header「决策记录」前方有一个<strong>倒叙播放</strong>开关，<strong>默认正序</strong>。选中后，盘面切换为<strong>镜像视图</strong>：真实时间上更晚的 K 线作为「历史」铺在图上，<strong>更早的 K 线逐帧从右侧出现</strong>，横轴时间从左到右<strong>递减</strong>——你是在把反向的市场当作一个正常盘面来看。每根蜡烛开收互换（主观上价格从真实收盘走向真实开盘），阳线阴线随之翻转，成形中的蜡烛按主观进度渐显。模拟时间与绑定其上的一切（下单时间、行情、撮合）随倒走的时钟推进；<strong>客观操作时间除外</strong>——真实世界的操作记录永远向前。</P>
              <P>盘面左侧铺的是<strong>主观历史</strong>——即倒放起点之后、真实时间上更晚的 K 线（实际上是未来数据，这是有意为之：倒放者被给予反向市场的完整历史，正如正放者被给予正向历史），<strong>深度与正放一致（约 1000 根）</strong>，向左拖动可继续加载更晚的数据。幕只遮一侧：<strong>主观未来 = 真实更早的数据，绝不提前显示</strong>。注意：既然左侧历史是真实未来，倒放过某段行情后再切回正放训练同一段，正放的无知之幕对你个人已经失效——两种方向请用不同的行情段。</P>
              <P>
                <strong>信号库的当日战役标注。</strong>信号列表里，时间后面出现一个<strong>淡绿小圆点</strong>，
                表示<strong>该标的在这条信号所属的自然日已经开过交易战役</strong>（按 UTC+8 折日，与信号时间同一口径；
                战役取其开仓日）。它与标的名前面那个绿色勾号<strong>都按信号当日判定</strong>，但问的不是同一件事：
                <strong>勾号</strong>问「那天在引擎里动过手没有」（成交记录或当前持仓，按开仓日归属，
                资金费不算一次进场）；<strong>圆点</strong>问「那天那笔交易被归类成战役了没有」——
                下了单但还没归类的日子只有勾号、没有圆点。两者都严格到「标的 + 那一天」：
                同一个币种会在很多个日期出现在信号库里，别的日期交易过<strong>不会</strong>把这一天也标上。
                标注刻意做得低调，扫视时不抢注意力，悬停才给出说明；
                战役数据拉取失败时不标注，绝不挡住信号库本身的使用。
              </P>
              <P>
                <strong>选中某个具体月份时，排序自动切成「时间 旧→新」。</strong>两种浏览方式要的顺序不同：
                看全部月份是在上千条里找某个标的，字母序才查得动；缩到一个月是在读那段时间里信号出现的先后，
                字母序会把时间线打散。这只在<strong>切换月份那一下</strong>生效，之后手动改排序不会被抢回去；
                切回「全部月份」也不动排序。
              </P>
              <P>切换瞬间时钟无跳变（起点自动对齐到 K 线开盘）；<strong>两个方向都会在接近数据边界时自动预取</strong>——正放触顶补更晚的 K 线、倒放触底补更早的，取到尽头则自动暂停并提示。方向是一种模式：暂停、停止、重新启动之间保持，直到你手动切回正序。倒放中图表不显示成交标记（按真实时间戳定位的标记在镜像轴上会错位）。</P>
              <RedHighlight>
                <strong>切换守卫（下限优先）：</strong>手里还有持仓时<strong>禁止切换</strong>，必须先平仓；从隔离切回同步、但仍有币种在独立运行时，系统会弹窗列出运行中的币种，让你先跳转查看、或<strong>一键停止所有并切换</strong>。这是为了不让“切个模式”悄悄改变正在持仓 / 运行的标的的时间口径。
              </RedHighlight>
            </section>

            <section id="s3-1b" className="scroll-mt-20">
              <SubTitle anchor>3.3 P_gap 优势边际</SubTitle>
              <P>
                P_gap 是交易页右栏最上方的常驻仪表，<strong>默认完整显示</strong>。它只回答一个问题：<strong>你自认的胜率，比市场白送的那一份高出多少。</strong>它只读不写——不落库、不记历史、不做校准统计、不给仓位建议，读数即全部功能。
              </P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">变量</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">来源与交互</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">S 现价</td><td className="px-3 py-2 border-t border-border">当前盘面价格</td><td className="px-3 py-2 border-t border-border">盘面实时数据，只读，随行情跳动</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">K 止损</td><td className="px-3 py-2 border-t border-border">你打算认错的位置</td><td className="px-3 py-2 border-t border-border">滑块 + 数字输入；滑块量程为现价 ±12%</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">T 目标</td><td className="px-3 py-2 border-t border-border">你打算兑现的位置</td><td className="px-3 py-2 border-t border-border">滑块 + 数字输入</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">P₁ 结构存活概率</td><td className="px-3 py-2 border-t border-border">当前交易结构继续存活、不被证伪的概率</td><td className="px-3 py-2 border-t border-border">滑块 + 数字输入，0–100%，由交易者自己填写</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">P₂ 存活后突破 T 的概率</td><td className="px-3 py-2 border-t border-border"><strong>条件概率</strong>：在结构存活的前提下，价格最终突破 T 的概率——不是独立的「突破 T 概率」</td><td className="px-3 py-2 border-t border-border">滑块 + 数字输入，0–100%，由交易者自己填写</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">P₃ 证伪后突破 T 的概率</td><td className="px-3 py-2 border-t border-border"><strong>条件概率</strong>：结构<strong>已被证伪</strong>，价格仍然突破 T 的概率（结构死的概率即 1 − P₁）</td><td className="px-3 py-2 border-t border-border">滑块 + 数字输入，0–100%，由交易者自己填写</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">P 最终主观胜率</td><td className="px-3 py-2 border-t border-border">P = P₁·P₂ +（1 − P₁)·P₃（全概率公式）</td><td className="px-3 py-2 border-t border-border"><strong>自动计算、只读</strong>；任一输入变化即实时重算，任一项缺失则不出数</td></tr>
                  </tbody>
                </table>
              </div>
              <SubTitle>两个读数</SubTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">指标</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">公式</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">怎么读</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-2 border-t border-border">基线概率 P₀</td>
                      <td className="px-3 py-2 border-t border-border">|S − K| ÷ |T − K|</td>
                      <td className="px-3 py-2 border-t border-border">在<strong>没有任何优势</strong>的市场里，价格先摸到 T 而不是先摸到 K 的概率。止损放得越远、目标定得越近，它越高——这是市场免费给你的胜率，<strong>P 必须高于它</strong></td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 border-t border-border">优势边际 gap</td>
                      <td className="px-3 py-2 border-t border-border">P − P₀</td>
                      <td className="px-3 py-2 border-t border-border">P 高出基线的部分，才真正属于你。gap &gt; 0 显示绿色「优势边际 +x.x%」；<strong>gap ≤ 0 转红并显示「优势已耗尽」</strong>，意味着这笔已不值得下手。gap 只做「P 对 P₀」的<strong>纯几何对比</strong>，不与持仓成本价比较——同样的 S/K/T/P，无论你此刻浮盈、浮亏还是空仓，gap 都是同一个数。持仓的盈亏状态另有其表：看 b 可落袋</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <P>
                下方的<strong>优势条</strong>把优势被价格吃掉的过程直接画出来：满格为你锚定 P 那一刻的 gap；价格越往 T 走，P₀ 越高，条就越短。改动 K、T 或 P 会重新锚定。
              </P>

              <SubTitle>b 可落袋：现在止盈能拿到几个 R</SubTitle>
              <P>
                P 行下方是 <strong>b 可落袋</strong>——只问一件事：<strong>此刻立即平掉手上的多单，能落袋几个 R。</strong>它与目标 T 无关，只看已经持有的仓位：
              </P>
              <div className="my-3 rounded bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                b<sub>可落袋</sub> = 当前未实现盈亏 ÷ 该多单的预期最大亏损 =（S − 多单开仓价）÷（开仓价 − K₀）
              </div>
              <P>
                两种写法给出<strong>同一个数</strong>：因为预期最大亏损 = 名义仓位 × 价距 ÷ 开仓价 = 数量 × 价距，而未实现盈亏 =（S − 开仓价）× 数量，<strong>数量会约掉</strong>。它与交易战役里的单场盈亏比 bᵢ 同量纲，可以直接对照——<strong>+1.00R 就是「赚到了一个你原本准备亏掉的额度」</strong>，跌到止损则恰为 −1.00R。
              </P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>分母用风险锚 K₀，不用面板上的情景 K。</strong>K₀ 默认取该多单<strong>最早设定的止损</strong>（在挂与已触发的止损委托里委托时间最早那张）——它定义了入场时承担的预期最大亏损，后来把止损上移是管理动作，不改写这个锚；与战役指标「初始风险边界不随后续修改移动」同一口径。面板上的 K 滑条只做情景推演，随手一拖不影响可落袋读数。</li>
                <li>K₀ 显示为一个小输入框，<strong>可手动修改</strong>（比如止损从未挂成委托、只在纸上）；清空即恢复默认；改过的值在切换标的时失效。找不到任何可追溯止损时才退回情景 K。</li>
                <li>持有多笔多单时用<strong>按数量加权的平均开仓价</strong>（标注「N 笔均价」）——加权均价正是让上式对总仓位成立的那个值。</li>
                <li>盈利为绿、亏损为红；<strong>没有多单时直接写「当前无多单」</strong>，不拿 0 冒充。</li>
                <li>K₀ 不在开仓价下方时不出数——那种情形下「预期最大亏损」本身就没有意义。</li>
                <li>目前只统计<strong>多单</strong>，与主仓只做多的纪律一致。</li>
              </ul>
              <Highlight>
                它和 gap 是一对：<strong>gap 说「这笔还值不值得继续持有」，b 可落袋说「现在收手能带走多少」。</strong>当 gap 已经逼近 0、而 b 可落袋是个可观的正数，那正是镜像止盈该机械执行的时刻——优势已经耗尽，但战果还在桌上。
              </Highlight>
              <P>
                P₀ 旁有一个低调的<strong>动态赔率 b =（T − S）÷（S − K）</strong>——此刻的盈亏比，随三个价格实时变动。它与基线概率是同一个数的两种算法：<strong>P₀ ≡ 1 ÷ (1 + b)</strong>。点击 b 打开<strong>盈亏平衡胜率曲线</strong>：横轴赔率、纵轴不亏所需的最低胜率，拖动滑条即是在问「若把赔率做到某个值，胜率门槛降到多少」；给出 P 后图中同时画出你与门槛的差额。曲线随赔率增大急速下降——b 从 1 到 2，门槛从 50% 掉到 33%，这正是「找赔率」比「硬提胜率」省力的原因。
              </P>
              <SubTitle>方向与守卫</SubTitle>
              <P>
                多空方向<strong>由 T 相对 K 的位置自动判定</strong>，不需要也不能手选：<strong>T 在 K 之上为多头</strong>，反之为空头。S <strong>不必</strong>落在两者之间——S 冲破止损时 P₀ 转负、越过目标时 P₀ 超过 100%，越界值<strong>如实呈现、不做截断</strong>，它告诉你价格已经跑出 K–T 区间多远。任一输入变动（包括 S 的行情跳动）立即重算。
              </P>
              <RedHighlight>
                当 <strong>T = K</strong>（分母为 0，基线概率无意义）或 <strong>S 恰好压在 K 上</strong>（风险距离为 0，赔率 b 无定义）时，面板<strong>不出任何数字</strong>，只给提示——包括 P₀ 也不显示。宁可不给数，也不给一个无意义的数。
              </RedHighlight>
              <SubTitle>触及止损后为什么不再出 gap</SubTitle>
              <P>
                <strong>现价一旦触及或越过止损 K，优势边际那一行只显示「已触及止损 K」，不再出数。</strong>
                这不是保守，而是数学要求：P₀ 的线性式只有在 K 与 T <strong>之间</strong>才是「先摸到 T 而不是先摸到 K」的概率。
                S 越过 K 意味着 <strong>K 已经被摸到、这个事件已经判负</strong>，真实概率是 <strong>0</strong>——可线性外推却给出一个负数。
              </P>
              <RedHighlight>
                负的 P₀ 一旦代进 gap = P − P₀，就变成 <strong>P + |P₀|</strong>，优势凭空虚增。
                以 <strong>K=90、T=110、S 跌到 80、P=72%</strong> 为例：硬算得到荒谬的 <strong>「+122%」</strong>——
                等于说<strong>破了止损反而优势最大</strong>，把仪表整个读反了。所以此处只出状态、不出数。
              </RedHighlight>
              <P>
                P₀ 的越界值仍然显示（−50%，它说明价格跑出区间多远），P₁/P₂/P 也照常计算，只是 P 不再参与相减。
                价格回到 K 之上，优势边际<strong>立即恢复</strong>出数。
                <strong>越过目标 T 那一侧不需要特判</strong>：P₀ 超过 100% 会让 gap 自然转负、读作「优势已耗尽」——那本就是正确的读数，因为价格已经走完你规划的空间。
              </P>
              <SubTitle>P 的三段式估法</SubTitle>
              <P>
P 不再一把手填，而是拆成三个更可回答的问题：<strong>「这个结构还活得下去吗（P₁）」</strong>、<strong>「假如它活着，价格能走到 T 吗（P₂）」</strong>、<strong>「假如它死了，价格还是走到了 T 吗（P₃）」</strong>。P₂ 与 P₃ 都必须按<strong>条件概率</strong>来估——先假定结构的死活，再问突破的把握，否则会把结构风险重复计价。
              </P>
              <RedHighlight>
                「摸到 T」有两条<strong>互斥且穷尽</strong>的路径——结构活着摸到、结构死了仍摸到。全概率公式把两条都计入：
                <strong>P = P₁·P₂ +（1 − P₁)·P₃</strong>。注意是<strong>相加</strong>：若误写成相减，P 会变成负数
                （P₁=50%、P₂=40%、P₃=80% 得 −20%，而概率不可能为负）；相加版则恒落在 0–100%，因为它本质是
                <strong>P₂ 与 P₃ 以 P₁ 为权的加权平均</strong>。
              </RedHighlight>
              <P>
                为什么必须有 P₃：<strong>形态废了不等于价格走不到目标</strong>。只算 P₁·P₂ 会漏掉「结构证伪后价格仍然触及 T」的全部路径，
                使 P 系统性低估，也让 P 与 P₀ 度量的<strong>不再是同一个事件</strong>——P₀ 问的是「价格先摸到 T 还是先摸到 K」，
                它并不关心你的形态是否还成立。补上 P₃ 之后，两者才对齐，gap = P − P₀ 的相减才是有意义的。
                举例：P₁=90%、P₂=80%、P₃=20% ⇒ P = 0.9×0.8 + 0.1×0.2 = <strong>74%</strong>（只算前一项会低估到 72%）。
                若你认为结构一死价格就绝无可能到 T，把 P₃ 填 0 即退化回纯乘积。
              </P>
              <P>
                三项都由交易者自己填写，系统不代为估算；<strong>任一项缺失时 P 不出数</strong>、gap 保持等待——不臆造。面板下方仍显示<strong>本账号战役整体胜率</strong>（已了结战役中盈利的比例，不足 5 场不显示），但它只是参考对照，不再自动填入。
              </P>
              <Highlight>
                这块表的用处不是替你决策，而是逼你把「我觉得这笔能赢」量化成一个数，再和市场免费给的那份摆在一起比。当 gap 逼近或跌破 0，说明你所谓的优势其实来自把止损放得太远、或目标定得太近，而不是来自判断本身。
              </Highlight>
              <P>
                面板上手填的 K、T、P₁、P₂ 与 K₀ <strong>按标的分别存档</strong>：刷新页面后同一标的原样恢复，换标的则各存各的、互不串味。
              </P>
              <P>
                模块表头 <strong>P_gap</strong> 右侧有一个低调的问号，点开即是这套算法的完整说明；再右侧是折叠键（同样低调）。<strong>折叠后表头会顶替显示 gap 读数</strong>，仪表不会因为收起就失声。
              </P>
            </section>

            <section id="s3-1c" className="scroll-mt-20">
              <SubTitle anchor>3.4 宽框架与严框架</SubTitle>
              <P>标的入选走哪套框架，决定了这笔仓位后续的全部待遇——<strong>建仓之前就要定，不在持仓中途换</strong>。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]"></th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">严框架 · 严进严出</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">宽松框架 · 宽进宽出</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">入选标准</td><td className="px-3 py-2 border-t border-border">高</td><td className="px-3 py-2 border-t border-border">低</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">波动容忍</td><td className="px-3 py-2 border-t border-border">高——入选够硬，扛得住震</td><td className="px-3 py-2 border-t border-border">低——入选门槛低，波动即警报</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">总仓位上限</td><td className="px-3 py-2 border-t border-border">高——允许养成重仓</td><td className="px-3 py-2 border-t border-border">低——封顶就低</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border font-medium"><strong>头仓</strong></td><td className="px-3 py-2 border-t border-border"><strong>可以大</strong>——它是分期建仓的第一期，后面还要加</td><td className="px-3 py-2 border-t border-border"><strong>必须更小</strong>——它基本就是终仓，没有后续</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border font-medium">后期加仓</td><td className="px-3 py-2 border-t border-border"><strong>需要加仓</strong>，让赢家变肥</td><td className="px-3 py-2 border-t border-border"><strong>谨慎加仓</strong>——除非该标的已被证明符合严框架（升级后按严框架对待）</td></tr>
                  </tbody>
                </table>
              </div>

              <SubTitle>不只是上限不同：头仓本身就该不同</SubTitle>
              <P>
                最常见的误读是：两套框架只差一个<strong>总仓位上限</strong>——严框架能养到更大、宽框架封顶更低——于是<strong>用同一个头仓起手</strong>，反正后面自然会被上限拦住。这个做法把两套框架的差别全部推给了「以后」，而建仓那一刻恰恰是唯一由你完全掌控的时点。
              </P>
              <P>
                两者的头仓在<strong>身份上</strong>就不一样：严框架的头仓是<strong>第一期</strong>——入选够硬，本来就打算加仓，它的任务是先建立浮盈垫、为后续加仓提供弹药；宽框架的头仓是<strong>全部</strong>——入选门槛低、原则上谨慎加仓，所以你下的这一笔基本就是终仓，不会再有第二笔来摊薄或修正它。
              </P>
              <Highlight>
                由此产生一个反直觉的后果：<strong>如果两套框架用同一个头仓，那么总上限更低的宽框架，反而在开局那一刻就顶格。</strong>本该更保守的一套，实际仓位利用率最高。「更低的总上限」在这种用法下形同虚设——因为你根本没打算用到上限，头仓已经把额度占满了。<strong>总仓位上限只约束「最多能到多大」，它约束不了「一开始就有多大」；能约束起手大小的，只有头仓本身。</strong>
              </Highlight>
              <P>
                所以宽框架的头仓必须<strong>绝对地更小</strong>——不是「相对它自己的上限更小」，而是数字上就更小。还有一层理由来自记账：<strong>头仓 × 止损距离 = 预期最大亏损 L</strong>，而 L 是 R 倍数的分母、是整套复盘记账的支点。宽框架的波动容忍本来就低（波动即警报，更容易被震出），若头仓不缩，被震出的每一次都按严框架的量级计损——<strong>低质量入选 + 高频止损 + 大头仓</strong>，是耗损最快的组合。
              </P>
              <P>
                <strong>升级不追认头仓。</strong> 宽框架标的一旦被证明符合严框架（见上表「后期加仓」一行），可升级后按严框架对待——但升级改变的是<strong>后续加仓的资格</strong>，不回头追认头仓。已经建好的小头仓就是小头仓，只能靠后续加仓把它养大，不能补一笔「本来就该更大」的仓。这条防的是把「升级」当成事后放大风险的借口。
              </P>
              <P>
                系统不替你强制头仓大小——它是<strong>建仓前的纪律</strong>，落点在下单前快照里的「本次最大亏损 USDT」：那个数字乘不乘得动，取决于你这一笔走的是哪套框架。
              </P>
              <Highlight>
                两条不可逆的线：<strong>镜像止盈位置不能轻易动</strong>——即使出现了新的支撑位，也不能以此调低镜像止盈；止损线可以上调，但前提是新位置<strong>被证明非常结实</strong>。<strong>严框架处于低预期回撤时，也不能轻易调大预期最大亏损</strong>——预期回撤小不是放大风险敞口的理由。
              </Highlight>
              <P>
                <strong>加仓量一律按 Plan B：X<sub>add,max</sub> = max(0, Y₁ + G) ÷ |S₂ − S₁|。</strong>G 是本轮落袋<strong>净额</strong>（镜像止盈 / 止盈1 的正利润 − 本轮已实现亏损，含强平，可为负）；尚无落袋且无亏损时 G = 0，Plan B 与 Plan A 同值。Plan A 只计算当前仍持有旧仓退回新止损线时的净浮盈垫 Y₁，是 Plan B 的来源拆解；本轮先前止损出局的亏损不会因为「还没止盈」就被跳过。每次加仓都用<strong>当下仍持有仓位的 X₁ 与最新综合成本 S̄</strong>重算，因此前一笔仍持有的加仓不会消失：它在新 S₁ 上的浮盈或浮亏会自动进入本轮垫子。三个价格定义一个区间：<strong>S̄ 当前综合成本 · S₁ 新止损线 · S₂ 本次加仓价</strong>。
              </P>
              <div className="my-3 rounded bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground">
                Plan A：Y₁ = X₁ (S₁ − S̄)；X₂ᴬ = Y₁ ÷ |S₂ − S₁| = X₁ ÷ b<br />
                Plan B：X<sub>add,max</sub> = max(0, Y₁ + G) ÷ |S₂ − S₁| = max(0, X₂ᴬ + X<sub>G</sub>)；Y₁、G 都可为负<br />
                U 本位 X<sub>G</sub> = G ÷ |S₂ − S₁|；币本位 G 以结算币计、按 S₁ 折算：X<sub>G</sub> = G × S₁ ÷ |S₂ − S₁|（等价于 Y₁、G、新腿亏损都换成币、在 S₁ 估值）<br />
                赔率式：b = (S₂ − S₁) ÷ (S₁ − S̄)；1 ÷ (1 + b) = 新腿占比 X₂ ÷ (X₁ + X₂)<br />
                读数：X₁ = 名义总仓位 ÷ 开仓均价（U 本位即「数量」；币本位 = 张数 × 面值 ÷ 开仓均价）
              </div>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>例：10 币 @100，止损上移到 110，价格到 120 加仓 → b = 10 ÷ 10 = 1，X₂ = <strong>10 币</strong>；跌回 110 时头仓 +100、新腿 −100，合计 0。止损线落在 [S̄, S₂] <strong>正中</strong>时 b = 1、加仓量 = 头仓；越贴近现价 b 越小、能加越多，离成本线越近则几乎加不动。</li>
                <li><strong>多轮加仓不必逐腿算。</strong>S̄ 取开仓均价、X₁ 取名义 ÷ 开仓均价，与逐腿求和 Σ X<sub>j</sub>(S₁ − P<sub>j</sub>) <strong>恒等</strong>。名义与均价必须来自同一批腿——拿总名义配头仓那一笔的价格，垫子会被算大近一倍。别用持仓卡的「≈ ×× 币」：那是按<strong>标记价</strong>折算、随价格缩水的当前币当量；X₁ 按<strong>开仓均价</strong>折算，开仓即定。</li>
                <li><strong>Plan A 无解，不代表可以单独使用 X<sub>G</sub>。</strong>若 S₁ 仍在当前综合成本的亏损侧，Y₁ 是负数；Plan B 必须先用 G 补掉这块旧仓缺口，只有剩余部分才能覆盖新加仓。Y₁ + G ≤ 0 时没有加仓额度。反过来，只要 G 足够大，Plan B 仍可成立——不能把「Plan A 无解」误写成「Plan B 永远禁止」。</li>
                <li><strong>这是上限，不是目标。</strong>G = 0（Plan A）取等号时综合成本线恰好落在 S₁；G &gt; 0 的 Plan B 取等号时成本线越过 S₁ 恰好 G ÷ (X₁ + X₂)（币本位 G 先乘 S₁），这一段由已落袋 G 覆盖——R0 复核只在 S₁ 处的亏损超出 Y₁ + G 时报红；G &lt; 0 时成本线停在 S₁ 安全侧。R0 由<strong>两套独立算法</strong>各算一遍再对账：垫子式（Y₁ + G 对 X₂·|S₂ − S₁|）与成本线式（加仓后综合成本线越过 S₁ 的那一段折成钱、再减 G），并按当前各腿开仓价逐笔重算 X₁ / Y₁ 核对手填值。两套算法守的是算术本身，逐笔重算守的是 X₁ / S̄——S₁ 另由盘口对冲线偏差核对，S₂ 与 G 没有第二来源，单位与符号仍要自己核；成本线只准越过 S₁ 到 G 能覆盖的程度，没有额外余量。任一算法对不上，计算器只报「自检不一致」、Legs 校验只给「—」，都不给「通过」。要留余量，实际加仓取<strong>小于</strong>上限。止损线每上移一次都要重算——b 由这三个价格定义，换一组就变。</li>
                <li><strong>这个 b 不是盘面 P_gap 的 b。</strong>同一时刻两者取值无关：加仓的 b 往<strong>回</strong>看（成本线 → 止损线 → 现价，用的是已经赚到的），P_gap 的 b 往<strong>前</strong>看（现价 → 目标，赌的是还没赚的）。记笔记时带上锚点，别只写一个「b」。</li>
                <li><strong>币本位照用。</strong>锁定点的定义是盈亏归零，零乘任何价格仍是零——线性与反向合约在锁定点给出同一个币量（这一句只对 Plan A 成立；Plan B 的 G 以结算币计，须按 S₁ 折算，见上式）；下单时折成名义 N₂ = X₂ × S₂ USD 再除以面值得张数。多腿的正确合并均价是 Σ张<sub>j</sub> ÷ Σ(张<sub>j</sub> ÷ P<sub>j</sub>)（调和平均，与币安 COIN-M 一致）；持仓卡当前按张数算术加权，多腿且价差大时略偏高、据此算出的 X₂ 偏小（欠锁，方向保守），要精确时请按上式自行折算。</li>
                <li><strong>对冲要扛起它保护的全部仓位：X_h = X₁ + X₂</strong>，挂在 S₁；锁死时 S₁ 恰是加仓后质心，于是 X_h·S₁ = N₁ + N₂——等币量就是等张数。只护头仓、尚未加仓时，等币量（X₁ 币 @ S₁，冻住 USD 盈亏）与等张数（名义 = N₁，冻住币盈亏）相差一个浮盈垫；本系统记账在 USD 上，与之自洽的是等币量。</li>
              </ul>
              <P>
                <strong>顶栏「加仓」按钮就是这套公式的计算器</strong>（在「倒叙播放」左侧）。X₁ / S̄ 按当前仍持有各腿的开仓价折算后读入、S₂ 从<strong>引擎市价成交的基准价</strong>读入并在弹窗开着时跟着它走（不是顶栏那个平滑后的显示价；市价档永远跟着它，限价档手改即锁定，复位图标回到市价并重新跟随），三者都可手改并一键复位；S₁ 必须手填——那是你的判断。<strong>所有派生量都按预计成交价 S₂′ 算，不按 S₂</strong>——见下方红框。币本位 / U 本位的口径跟<strong>被加仓的那条仓位</strong>走，不跟下单面板——面板每次打开都回到币本位，而 U 本位仓位重开后仍按 U 本位折算 G 与每币风险。界面把来源拆成两块，但不是让你二选一：<strong>Plan A · 旧仓浮盈垫</strong>显示 Y₁ 与其折算量 X₂ᴬ——G = 0 时它就是上限；G ≠ 0（正负都算）时它降为一行中性芯片，只解释旧仓贡献，Y₁ 为负也只显示负数、不再报红。真正下单看<strong>Plan B · 浮盈垫 + 落袋净额</strong>的「加仓上限」<span className="font-mono">max(0, Y₁ + G) ÷ 每币风险</span>（U 本位每币风险 = |S₂ − S₁|；币本位 Y₁、G 以币计，每币风险 = |S₂ − S₁| ÷ S₁）。这个上限<strong>只由规则决定</strong>，系统把 Y₁、G 的正数加进来、负数扣出去，绝不能绕过它单独照 X<sub>G</sub> 下单——X<sub>G</sub> 一格标着「仅拆解」、不给张数。K<sub>B</sub> / 定仓是 G &gt; 0 时可选的旋钮，留空即取 S₁（此时 <span className="font-mono">X<sub>G</sub> = G ÷ |S₂ − S₁|</span>，币本位 <span className="font-mono">G × S₁ ÷ |S₂ − S₁|</span>，跌回 S₁ 恰好花掉 G）；拧了旋钮，推出来的量另起一格叫<strong>「计划加仓」</strong>，上限那一格纹丝不动，R0 复核拿计划加仓与上限比对。把 K<sub>B</sub> 拖到 S₁ 的更保守一侧，计划加仓小于上限、在 S₁ 还剩一部分垫子；定仓填得比上限大，R0 直接报红。对冲必须扛起全部实际仓位：<span className="font-mono">对冲 @ S₁ = X₁ + 实际加仓量</span>（不拧旋钮时就是 X₁ + 上限），无论 K<sub>B</sub> 放在哪都照常显示。
              </P>
              <RedHighlight>
                <strong>S₁ 必须就是盘口上那张对冲单的触发价——整套「锁死」全押在这一个数上。</strong>
                实测（SCRTUSDT 2026-04-20，已实现 −7,930.74）：计算器被喂的 S₁ 是 0.114572，
                而盘口挂着的对冲线是 <span className="font-mono">0.114401</span>，两者差 0.000171（<strong>0.149%</strong>）。
                公式照算不误，但「锁死」的前提已经不成立：加仓量因此多下 <strong>9.1%</strong>
                （15,052,198 而不是 13,799,517），价格走到 0.114401 那一刻账面不是设计的 0，而是
                <strong> −3,247 USDT</strong>。<strong>0.15% 的输入偏差被 1/险 放大成四位数的亏损</strong>——
                险越小（S₁ 越贴近 S₂），这个放大倍数越大，这正是加仓量能开得那么大的同一个杠杆在反向作用。
                <br /><br />
                现在计算器会读盘口：<strong>把真实挂着的对冲线摆成候选芯片</strong>，点一下即填入 S₁。
                挂着多条时，偏差比对用<strong>亏损侧离 S₂ 最近的那条</strong>（价格回落时先被打到的那张）——与 Legs「加仓校验」读 S₁ 同一条规则，同一笔加仓在两处不会得出相反的结论。
                它<strong>不会替你预填、也不会锁死输入框</strong>——系统分不出「对冲单」和「试单 / 上一场遗留的挂单」，
                用一个可能错的值占住你唯一需要判断的输入，等于让确定性最低的一方拿走决定权。
                跟踪委托与 TWAP 没有事前确定的线，会单独列出但不作候选；早于本场主力开仓 5 分钟之前的挂单直接排除。
                一旦你填的 S₁ 与盘口线不是同一条，警示会<strong>按 USDT 明码标出代价</strong>
                （多下多少币、走到那条线时账面多少钱），并给一个「按盘口重算」的一键改正；两个加仓量都在 0 处截断，
                按盘口线 Y₁ + G ≤ 0 时直接说明「没有加仓额度」，而不是「锁死本应是 0」。
                <br /><br />
                <strong>另一个同源的坑</strong>：G ≠ 0 时，A 段不再是最终下单答案。
                真正要下的是 <span className="font-mono">Plan B 加仓上限 = max(0, Y₁ + G) ÷ 每币风险</span>、
                真正要挂的是 <span className="font-mono">合计对冲 = X₁ + 实际加仓量</span>——
                这两个数现在都以大字呈现，A 段明确标为「来源拆解」。尤其当 Y₁ 为负时，照 X<sub>G</sub> 单独下单会把旧仓亏损漏掉，直接制造本金缺口。
              </RedHighlight>
              <RedHighlight>
                <strong>S₂ 必须是预计成交价，不是下单前看到的现价——上限对 S₂ 的弹性有十几倍。</strong>
                实测（COMMONUSDT，加仓 1 / 加仓 2）：用户按计算器的上限下单（下的是 653,602 张、1,380,961 张，比计算器按现价给出的 653,615 / 1,380,978 张还略少），
                Legs「加仓校验」却判超限 <strong>1.57% / 3.70%</strong>。两边规则、G、S₁ 全部一致，只差一个 S₂：
                计算器读的是下单前的盘面价，而<strong>市价单在本模拟器里按 Taker 滑点成交：0.01% + 名义 ÷ 50 亿</strong>
                （引擎的滑点函数里还有一档「传入的 K 线区间（最高 − 最低，函数不限定周期）超过收盘价 2% 时滑点率翻倍」，但本模拟器没有任何成交路径把 K 线区间传给它，这一档今天从不生效），
                6.5M / 13.8M 名义就是 <span className="font-mono">+0.14% / +0.29%</span>；校验读的是成交价。
                币数上限 = 垫子 ÷ (S₂ − S₁)，对 S₂ 的弹性是 <span className="font-mono">S₂ ÷ (S₂ − S₁)</span>；
                币本位按张下单，张数 / 名义上限 = 币数 × S₂，弹性少 1，是 <span className="font-mono">S₁ ÷ (S₂ − S₁)</span>（以主多写；主空把 S₂ − S₁ 换成 S₁ − S₂，张数弹性反而比币数多 1）——险距只有价格的 8% 时就是 11–13 倍，
                零点几的滑点于是变成百分之几的超限，缺口 8,420 / 36,574 USD 由本金支付。
                <br /><br />
                现在计算器<strong>按预计成交价 S₂′ 定量</strong>：上限的名义决定滑点、滑点决定成交价、成交价决定上限——市价档解的是
                「这个量在<strong>它自己的</strong>成交价上跌回 S₁ 的亏损恰好等于垫子」。亏损随量单调增加，无滑点的上限一定已经超了，
                所以用<strong>二分</strong>在 0 与无滑点上限之间夹出来，<strong>取不超的那一端</strong>——永远收敛；止损贴得越近、名义越大，
                老式的几步迭代越容易在根两侧来回跳（险距 0.2% 的 BTC：迭代给 179 币，真上限 177.19，取满就超 1.67%）。
                空头名义大到滑点把成交价压到 0 附近时，上限停在还能成交的那一边。
                X₂ 上限、张数（<strong>向下取整</strong>，绝不进一）、对冲量、R0 复核、快照与「按上限下单」<strong>读的是同一个数</strong>；
                界面并排写出「现价 S₂ → 预计成交 S₂′ (+0.14%)」，另给一行敏感度：「成交每不利 0.1%，上限少约 N 币（M 张）」
                （按成交价再不利 0.1% 精确重算，不用一阶近似——止损贴得近时一阶式会大出几倍，甚至比整个上限还大），
                并把倍数写在旁边（币本位按张下单，写张数的 S₁/(S₂′ − S₁)；U 本位按币下单，写币数的 S₂′/(S₂′ − S₁)）。
                <strong>市价单只能在引擎基准价上成交</strong>：市价档的 S₂ 永远是基准价——手填一个离基准价超过一格的 S₂，那只能是一张限价单或条件单：
                计算器自动切到限价并写明「手填 S₂ 只能按限价或条件单成交，已切到限价 @S₂；点复位回到市价」，旁边一键「突破加仓改按条件单」；
                点「市价」或复位图标，S₂ 回到基准价。否则按手填价定的量会变成一张在基准价上成交的市价单，上限差出几倍。
                <strong>「条件单 @S₂」</strong>是第三档，突破加仓用它：S₂ 是触发价，触发后引擎在<strong>触发价</strong>上按同一个 Taker 滑点成交，
                所以它与市价档同一个模型，只是参考价换成触发价。按「限价 @S₂」定的量挂成条件单，COMMONUSDT 的超限原样重演——
                触发价 0.0077015：限价档给 653,579 张，触发后 +0.14% 成交、超 1.57%；条件单档给 643,614 张，在自己的成交价上不超。
                触发价同样按价格精度向有利侧取整；离现价不到一格不给计划（引擎会当成立即成交的单拒掉），「按上限下单」预填的是一张以 S₂ 为触发价的条件委托。
                要计算器的数分毫不差地成立，切到<strong>「限价 @S₂」</strong>档：限价 / 只做 Maker 在本模拟器里按挂单价原价成交，S₂′ = S₂——
                挂单价先按下单面板的价格精度<strong>向有利侧取整</strong>（多头向下、空头向上）再定量，挂出去的价与定量用的价是同一个数；
                四舍五入把多头的价抬高一格，就等于在比定量更差的价上成交。
                翻倍那一档计算器同样不计，与引擎今天的实际行为一致；行情剧烈时基准价在点下单之前还会跳，按敏感度那一行自己留余量。
                <br /><br />
                <strong>成交之后还会再判一遍。</strong>预计终究是预计：基准价在关掉计算器到点下单之间还会跳，量也可能没按计划下。
                <strong>带着计算器计划</strong>的吃单加仓成交时——市价、最优价，以及触发后按市价成交的条件委托（盘面上、后台标的上触发都算，参考价取触发价）——
                （给对冲加码、没开计算器的那一刀不判——那不是计算器授权的加仓；挂单价原价成交的限价单没有滑点，也不在这里判），
                系统按<strong>实际成交价</strong>、用成交前的 X₁ / S̄ / 盘口对冲线 S₁ / 本场 G 把 Plan B 重算一次，超限就进「历史消息」（告警一级，不拦单）：
                成交价、参考价、滑点、超出多少币 / 多少张、减掉多少即回到上限之内，以及超出从哪来——成交比计划预计的更差、计算后价格变了，还是量本身超了计划；
                按「限价 @S₂」定的量却是吃单成交的，消息会直接点明该改用「市价」或「条件单 @S₂」档定量。
                <strong>计算器算出的计划会钉在单子上</strong>：弹窗里有可用上限时，接下来同标的、同方向、同结算方式的开仓单（市价、限价、只做 Maker、条件委托）
                带着一份快照——计算时的参考价 S₂（市价计划是现价、限价计划是手填的限价、条件委托是触发价）、预计成交价、滑点、S₁、X₁、S̄、G、上限、张数、下单方式，外加这张单自己的下单参考价（市价取引擎基准价、限价取委托价、条件委托取触发价）——
                随委托、成交、平仓一路进成交记录，战役页的加仓校验据此说清计算时、下单时与成交时各是多少。一份计划只钉一张单，计算器关掉后保留半小时。
                计划在<strong>点「开多 / 开空」那一刻</strong>就随单子取走（决策模式的下单前快照填得再久，也不会半路过期），单子真的挂出 / 成交才消费；
                <strong>重新打开计算器</strong>会从仍在保鲜期的计划种回 S₁ 与下单方式（限价 / 条件单计划连同锁住的价），不会把面板里预填好的那张单的计划清掉；
                但计划只记得它算出来那一刻：X₁ / S̄ 按<strong>计划那一侧</strong>的持仓重读（主空战役带着多头对冲腿也不会读成对冲腿的数），
                G 按本场落袋重读——计划之后又止损了一笔，G 换成本场的并注明上次计划里是多少，上限随之重算；
                计划早于当前持仓的开仓（停止回放后同一段历史又放了一遍、平掉又重开）就整个不认，照空白打开。
                开始回放、跳到信号时刻、停止回放、合并时间轴、彻底清除标的数据时，没下出去的计划一并清掉，不跨场；
                <strong>撤掉带计划的限价 / 条件单</strong>（包括成交时保证金不足、触发时超过杠杆分层上限被撤），计划仍在保鲜期、又没有更新的计划、这个标的也仍持有同方向仓位时会放回去，紧接着追价的同向单照样带上（停止回放先平仓再撤单，计划不会漏到下一场）；
                但计划必须属于<strong>这一场、这条仓位</strong>：跳到信号时刻把旧挂单带进新的一场后再撤（计划早于分场、或挂单与撤单不在同一场回放里），或平掉又重开之后再撤上一轮的计划单（同方向的仓位晚于计划开出），都不放回；<strong>正放 ↔ 倒放翻转不算分场</strong>——仓位、挂单与没下出去的计划都原样带过去，翻转前挂的计划单翻转后撤掉照样放回。
                「<strong>按上限下单</strong>」按钮把整张的可下单量（Plan B 上限，再按下面的分层余量封顶）连同下单方式直接预填进下单面板（U 本位的币数按数量精度向下取整；面板的结算方式与计划不同就先切过去），
                省掉手抄币数、再让面板按另一个价折一次张。下单面板的市价单也会先写出预计成交价与滑点（3,000 万名义就是 0.6%）。
                <strong>可下单量还要过币安分层</strong>（见「杠杆分层与仓位上限」）：按这个合约当前的杠杆，这一侧还能再开多少——持仓多空相加、非只减仓挂单都算，
                与下单面板的「可开」是同一个判定；<strong>计划自己的对冲也占这个上限</strong>——S₁ 上合计 X₁ + X₂ 的反向条件单是开仓委托，与加仓共用同一张合约的上限，
                所以分层余量取的是「加仓、以及加仓之后还要补挂的对冲（X₁ + X₂ 减去已挂在 S₁ 这条线上的、已成交的反向对冲）都放得下，也不让已挂的触发单注定被拒」的最大量，
                单看加仓的余量只是它的上界（KAITOUSDT 15x、现价 1.0、多 10,000、S₁ = 0.9：单看加仓还能开 39,900，加满之后连 X₁ 的对冲都挂不上；留出对冲的位置是 16,263。这两个数随现价变）。
                判对冲时按<strong>价格走到 S₁ 那一刻</strong>算：回调加仓的限价单、落在这段路上的加仓条件单到那时已经成交，是按 S₁ 估值的持仓，不是还挂在 S₂ 上的委托；
                已经穿价的限价加仓当作立即成交、按现价估值；挂着的限价加仓在补挂对冲之后，到 S₂ 成交那一刻也要放得下（S₁ 夹在现价与 S₂ 之间时，那时对冲已经是持仓；条件单加仓挂在 S₁ 之外也一样，到 S₂ 触发时对冲已经成交）；另一侧还挂着开仓单时，「它先成交、价格再折回 S₂」也要放得下。
                <strong>S₂ 与 S₁ 在现价两侧时，两张单谁先到都算</strong>（突破加仓在上、止损对冲在下，或反过来）：先突破、加仓成交再跌回 S₁，对冲按已成交的加仓判；
                先跌到 S₁、对冲成交再涨到 S₂，加仓按已成交的对冲判——按给出的量挂上这两张单，之后不另下开仓单、不改杠杆的话，价格不论先走哪边，两张单到各自的触发价都不会被分层拒掉，
                已挂的、触发时会再判的单也按这几种先后算，不会被这两张单弄得注定被撤（预判把路上会触发的条件单一律当作已经开出来，其中自己就注定被撤的那张到时让出的位置不算在内）（KAITOUSDT 15x、现价 1.0、多 10,000、突破加仓 @1.2、S₁ = 0.9：
                只算「先突破」是 13,809，「先跌到 0.9、再涨到 1.2」那一种更紧，给 10,833）。
                大字、张数、合计对冲与「按上限下单」都取 Plan B 上限与分层余量的<strong>较小者</strong>，
                下面一行写明「分层上限：当前 Lx 最多再开 X」以及卡住的是哪一个，给对冲留了位置时附上单看加仓还能开多少；S₁ 上的对冲本身已经放不下时直说，可下单量为 0，并给出对冲这一侧还能挂多少。
                钉在单子上的快照仍记 Plan B 上限，成交后复判与战役页的加仓校验照旧只判 Plan B。
                <br /><br />
                <strong>Plan B 不覆盖什么。</strong>它只锁「新腿跌回 S₁ 的亏损」这一件事：手续费不计（开、平各 0.05% Taker）；
                对冲单触发后成交在触发价之下（同一个滑点模型，30M 名义的对冲空单会低 0.6% 成交）；
                多头没有平在 S₁ 而是平在它下面；对冲先于多头被解掉；以及大单平仓本身的 Taker 滑点——
                <strong>两笔 3,000 万名义的平仓在本模拟器里各吃约 0.6%，一来一回就是 1.2%</strong>。
                COMMONUSDT 那一场 −565K 里，超限的仓位只解释了约 45K，其余几乎全部来自这些执行成本。
                锁死锁的是几何，不是钱；钱要另外算。
              </RedHighlight>
              <P>
                定线推仓、定仓推线两个旋钮互为反函数；K<sub>B</sub> 拖到 S₁ 之下即「零风险线更低」，跌到 S₁ 只吃掉 G 的一部分，界面会标出吃掉多少、剩多少。
                G 留空按 0，此时 Plan B 与 Plan A 同值。系统会检测本场「止盈1」利润，并扣掉本轮（不论在止盈之前还是之后）已经实现的亏损——平仓与强平都算——作为可用净额，净额可以是负数、负数照扣；普通减仓或手动平仓的正利润不会混进来。当前持仓每一笔成交都有真实开仓时刻、且净额不为 0 时，这个净额会在打开计算器时自动带入（缺操作时间的止盈直接不计并在下方注明；落袋后又加过仓也照样带入，按钮转黄提示；净额为负时按钮标红）；旧数据缺真实时间戳、无法排除别次回放时只给建议按钮，必须由你确认后点入。「本场」同时看两只钟：模拟平仓时间不早于当前持仓开仓，且<strong>操作时间（真实平仓时刻）不早于当前仍持有仓位最早一笔成交的真实开仓时刻</strong>——同一段历史重放多遍时，别的重放在同一模拟时刻落袋的止盈不会混进 G，被排除的笔数（含没有操作时间的老记录）在下方以小字注明（持仓里只要有一笔成交没有真实开仓时刻——老仓位，或在老仓位上新加的一刀——起点无从确定，仍只看模拟时间）。落袋之后又加过仓（按成交笔数算，合并进同一仓位的加仓也算）时，按钮转黄：仍持有部分已经进入当前 X₁ / S̄，会在新 S₁ 上重新计入浮盈或浮亏；已经平仓的亏损则已从建议 G 中扣掉。计算器右上角那个几乎看不见的「?」展开公式速览并链回本节。<strong>Plan B 是上限，不是目标</strong>；S₁ 每次变化、仓位每次变化都要重算。输入区下方的价格阶梯把 S̄ / S₁ / S₂ 按比例画在一条轴上；若 S₁ 仍在成本线亏损侧，旧仓垫会显示为负，只有 G 补完缺口后 Plan B 才会给出可下单量。S₁ 还没填时 Plan B 一栏提示「填入 S₁ 后计算」——K<sub>B</sub> 可以留空，缺的是 S₁。
              </P>

            </section>

            <section id="s3-2" className="scroll-mt-20">
              <SubTitle anchor>3.5 下单前快照</SubTitle>
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

              <SubTitle>第二步 · 机会质量判断</SubTitle>
              <P>开仓快照会把已有的<strong>预期盈亏比 b</strong>与<strong>预期最大回撤 d</strong>同步到机会质量模块，也可以直接输入两个数字。系统自动计算 <strong>Q = b ÷ d</strong>；其中 d 按百分点使用，回撤 2% 就填 2，不填 0.02。例如预期盈亏比 5:1、预期回撤 2%，机会质量为 2.50。</P>
              <P>这个数字表示：在预期盈亏比不变时，结构性回撤越小，同一最大亏损预算可以承载的头仓越厚，机会质量越高。它不是预期利润，也不受杠杆数字本身影响；回撤必须来自真实的结构失效位，不能为了抬高 Q 人为缩小分母。</P>

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
                    <tr><td className="px-3 py-2 border-t border-border">仓位模式</td><td className="px-3 py-2 border-t border-border">强制使用逐仓，<strong>新标的即默认逐仓</strong></td><td className="px-3 py-2 border-t border-border">全仓是硬阻断，必须切换到逐仓才能提交；默认值因此就设为逐仓，免得每开一个新标的都要先手动切一次</td></tr>
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
              <SubTitle anchor>3.6 平仓评价复盘</SubTitle>
              <P>决策记录模式下，平仓会打开一个与开仓快照同规格的<strong>居中评价弹窗</strong>，不完成评价不能离开。评价的重心不是重新讲一遍故事，而是把快照时的预测和最终实际结果对上：预设的证伪信号兑现没有，结构破坏信号出现没有，进场时钉下的置信度有没有被验证。</P>
              <P>弹窗按这条主线展开：<strong>事实模块</strong>逐条核验快照里押的<strong>反 / 止 / 结构 / 置信</strong>四条腿 → <strong>决策质量</strong>（入场 / 持仓 / 离场三栏）→ 系统自动归纳<strong>结构 × 结果四象限</strong> → <strong>路径</strong>（滚仓 / 镜像止盈 + 交易主动权）→ <strong>体检模块</strong>（过程纠结度 / 小机会仓位记账 / 踏空高盈亏比结构）→ <strong>反对者陈述追踪</strong>（条件触发）→ <strong>情绪侧七问</strong>。先对账，再判读，最后翻动机，避免复盘变成事后重新叙述。</P>
              <P><strong>机会质量评估</strong>会在平仓时再输入当时可见的 b 与 d，并自动计算 Q。它默认带入开仓判断，但允许你根据复盘修正并保存；评估要回到当时的信息集，不能用最终盈亏倒推一个完美预测。</P>

              <SubTitle>事实模块 · 逐条核验闭环的四条腿（反 / 止 / 结构 / 置信）</SubTitle>
              <P>弹窗会把开仓快照里写下的<strong>反（亏损剧本）</strong>、<strong>止（失效信号）</strong>、<strong>结构（目标空间）</strong>、<strong>置信（开仓预测胜率）</strong>逐条原样回显，问你这四个假设在持仓过程中分别被市场怎么对待。这里<strong>只核验差值、不写事后故事</strong>，避免把"发生了什么"和"为什么"压成一个自洽的完美闭环。</P>
              <P><strong>"止"这条腿</strong>是其中最关键的子项：如果开仓时写过失效信号，这里会把它原样回显，再让你选三种状态之一：<strong>触发了，我及时反应了 / 触发了，但我反应晚了 / 没触发，我是主观平仓</strong>。这一步专治"写了止损条件却没执行"。</P>

              <SubTitle>决策质量：入场 / 持仓 / 离场三栏</SubTitle>
              <P>决策质量不再用一个总判断覆盖整笔交易，而是把过程拆成三个可定位、可修改、可导出的阶段。每一栏都只按<strong>当时可见的信息与规则</strong>评价，分别选择<strong>正当</strong>或<strong>错误</strong>；最终盈亏不能反过来替过程洗白或定罪。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">阶段</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">判断焦点</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">可选答案</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">入场</td><td className="px-3 py-2 border-t border-border">建仓依据、机会判断与风险边界是否成立</td><td className="px-3 py-2 border-t border-border">正当 / 错误</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">持仓</td><td className="px-3 py-2 border-t border-border">持仓判断、加减仓与过程动作是否成立</td><td className="px-3 py-2 border-t border-border">正当 / 错误</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">离场</td><td className="px-3 py-2 border-t border-border">止盈、止损与退出判断是否成立</td><td className="px-3 py-2 border-t border-border">正当 / 错误</td></tr>
                  </tbody>
                </table>
              </div>
              <P><strong>归纳规则：</strong>三栏全部正当，整笔过程才归为正当；任意一栏为错误，整笔过程即归为错误。系统再把这个过程结论与本笔赢 / 亏结果组合，自动生成四象限，不需要你重复手动选择象限。</P>

              <SubTitle>系统自动归纳：结构 × 结果四象限</SubTitle>
              <P>"结构 × 结果"仍是平仓评价的核心结论，但它现在由三阶段决策质量自动推导：<strong>结构轴 = 入场、持仓、离场合并后的过程质量（与盈亏无关）</strong>，<strong>结果轴 = 这单赢 / 亏</strong>。一句话锚点：<strong>好结果不等于好过程，坏结果不等于坏过程</strong>。</P>
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
              <P className="mt-2">如果结果是保本，不强行归入四象限；如果是赢或亏，完成三栏后系统立即显示对应象限。未入场记录不要求填写这三栏，也不会制造一个虚假的过程归类。</P>
              <Highlight>
                历史记录仍然兼容：旧评价只有一个总决策质量时，系统会把该值作为入场、持仓、离场三栏的回填依据；打开、编辑和导出旧战役时不会出现三栏空白。以后重新保存，会按三栏结构持续记录。
              </Highlight>

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
              <SubTitle anchor>3.7 持仓与历史</SubTitle>
              <P>底部历史区用于检查执行结果。重点关注三类记录：未评价交易、仓位历史记录、平仓方式。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>未评价交易</strong>：优先补齐。已平仓未评价会硬阻塞下一次开仓。</li>
                <li><strong>仓位历史记录</strong>：可用于归类历史交易，组成一次交易战役；误点“跳过”的主力多单可从“评价状态”列重新发起评价，已评价记录可直接打开原评价。</li>
                <li><strong>平仓方式</strong>：区分手动、止损、止盈、爆仓，判断你是在执行系统还是被情绪驱动。</li>
                <li><strong>克制记录</strong>：记录“我忍住没下的单”，它和实际下单一样进入元监控。</li>
              </ul>
            </section>
          </section>

          <section id="s4" className="scroll-mt-20">
            <SectionTitle accent="#B080FF">4. 复盘中心</SectionTitle>
            <P>复盘中心负责把交易样本加工成能力。它的正确使用顺序是：先补评价，再看预测误差与错误类型（并在结构成熟度里看哪些结构已经建好），再归类战役，再写规则，最后用元监控验证。</P>

            <section id="s4-1" className="scroll-mt-20">
              <SubTitle anchor>4.1 错题集</SubTitle>
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
              <P>汇总由字段 spec 自动覆盖完整的开仓快照与平仓评价，不再依赖容易过时的固定题目数量。平仓侧会把<strong>决策质量 · 入场 / 持仓 / 离场</strong>作为三个独立字段统计，同时保留事实核验、证伪触发、过程体检、路径与情绪题；历史记录只有单一决策质量时会自动回填三栏。以后新增题目，只需加入字段 spec 就会进入汇总。</P>
              <SubTitle>提交永不丢：本机镜像兜底</SubTitle>
              <P>
                平仓评价提交后，<strong>一定会成功落库、并立即出现在「汇总」里</strong>，不存在"提交了却看不到"的情况。即使远程数据库还没建某些扩展列（你没跑最新迁移），提交也<strong>不会整笔失败</strong>——基础字段照常写远程，缺列的字段写入<strong>本机镜像</strong>，汇总同样读得到。所以右上角若提示"其中 N 项暂未同步到远程库（缺列）"，那不是报错：你填的内容已经在本机、汇总看得见，只是这几项还没同步到云端。
              </P>
              <RedHighlight>
                本机镜像只兜<strong>当前这台设备</strong>的可见性，是过渡方案、非最终解。换设备或清浏览器缓存前，务必去 Supabase 跑最新 safety net 迁移把缺列补齐；否则那几项不会跟着账号跨设备走。
              </RedHighlight>
            </section>

            <section id="s4-2" className="scroll-mt-20">
              <SubTitle anchor>4.2 结构成熟度</SubTitle>
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
              <SubTitle anchor>4.3 交易战役</SubTitle>
              <P>战役是比单笔交易更高一层的复盘单位。一次战役由同一标的、同一主方向、明确开始结束、多个 leg 组成。每场战役都会生成一个全局唯一的<strong>战役编号</strong>；编号与生成过程绑定，不会因标题、备注或规则文字被修改而改变。</P>
              <SubTitle>Legs 的认知与风险分工</SubTitle>
              <P>交易战役里的每一个 leg 都不是对价格涨跌的情绪表达，而是在不同证据阶段购买优势、限制误差或回收成本。判断一个动作是否合理，应先问它承担了什么认知与风险职能，而不是只看动作之后价格是否上涨。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">动作</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">核心职能</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">不应被误解为</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-2 border-t border-border font-medium">M 底仓</td>
                      <td className="px-3 py-2 border-t border-border">以有限成本购买观察权和参与权，让初始认知差进入可验证状态。</td>
                      <td className="px-3 py-2 border-t border-border">单纯表达「我看多」。</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 border-t border-border font-medium">A1–A3 加仓</td>
                      <td className="px-3 py-2 border-t border-border">购买已经被新证据验证、但尚未被价格完全兑现的后验优势。</td>
                      <td className="px-3 py-2 border-t border-border">因为价格上涨而奖励自己，或机械追涨。</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 border-t border-border font-medium">Ha / Hb / Hr 对冲</td>
                      <td className="px-3 py-2 border-t border-border">给模型误差、跳跃风险和错误路径定价，限制判断出错时的代价。</td>
                      <td className="px-3 py-2 border-t border-border">另起一套独立的看空观点。</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 border-t border-border font-medium">镜像止盈</td>
                      <td className="px-3 py-2 border-t border-border">回收试验成本、改善生存率，同时保留仍可参与右尾行情的仓位。</td>
                      <td className="px-3 py-2 border-t border-border">害怕浮盈回吐而提前结束判断。</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 border-t border-border font-medium">退出</td>
                      <td className="px-3 py-2 border-t border-border">在优势归零或转负时终止风险暴露，把资本释放给下一次机会。</td>
                      <td className="px-3 py-2 border-t border-border">承认自己失败，或对自我判断作身份评价。</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                <strong>总纲：</strong>底仓购买认知差；加仓购买经过验证且尚未兑现的认知差；对冲限制模型误差；镜像止盈回收试验成本；退出处理优势消失。
              </Highlight>
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
              <SubTitle>归类历史交易</SubTitle>
              <P>进入「归类历史交易」后，搜索框会在获得焦点或鼠标移入时展开<strong>全部可选标的</strong>；也可以继续输入文字缩小范围。选择标的后，系统才加载该币种所有可归类的 journal 与仓位历史记录，避免无关信息铺满页面。</P>
              <P>记录表<strong>每行一行高</strong>，完整显示合约、方向与杠杆、<strong>主力 / 对冲</strong>、开平仓价格、数量、开平仓时间（MM-DD HH:mm:ss，秒留在列内——加仓腿常在同一分钟连开两刀，先后只能靠秒判定；年份悬停可见）、<strong>真实操作时间</strong>、平仓方式、盈亏和 ROE。尚无成交的行把平仓侧几格折成一句话——「挂单中 · 尚未平仓」「未触发取消 · 无成交」「已成交 · 成交记录未载入」——与归类弹窗的三态同一套措辞；未平仓的行不会显示 +0.00（0 是没有数据，不是打平）。<strong>默认只列成交过的记录</strong>——没有 trade_record_id 的行是挂单被撤或从未触发，不是一笔交易；「已成交 · 成交记录未载入」仍会列出（本地查不到记录不等于这笔没发生）。隐藏了几条写在汇总行上，点一下即可放出来，过滤不静默吞数据。<strong>开仓时间 / 平仓时间 / 盈亏 / 操作时间四列的表头可点排序</strong>，默认按<strong>操作时间倒序</strong>——事后归类时，真实动手的先后比模拟开仓时间更贴近回忆；点同一列翻转升降序，换一列则回到倒序。最右列的<strong>角色建议</strong>按标的分组计算、只数未归类的腿：别的币做过几次加仓，不会把这个币的「加仓 N」推高；建议全称与推断理由悬停可见。勾选相关记录后，可以「归类为新战役」，也可以「加入现有战役」；新建完成后会直接进入对应战役详情。被选中的记录共同构成一次交易战役。</P>
              <P>裸记录的角色自动建议与实盘策略对齐：<strong>以「止盈1」平仓的记录建议为镜像止盈</strong>（镜像多单挂止盈先落袋）；<strong>同向记录中留到最后平掉的那笔建议为主力 main_open</strong>——主力按定义比镜像活得久，仍持有的记录视为最晚平掉，因此主力不再默认「第一条记录」。其余同向记录按开仓先后建议为主力加仓，反向记录仍建议滚动对冲。建议只是预填，逐条可改。</P>
              <P>实时战役与历史归类战役必须隔离。实时战役在开仓时归属；历史归类只加入历史战役，不把回填数据混进实时训练口径。</P>

              <SubTitle>战役列表与折叠卡片</SubTitle>
              <P>战役卡片默认只保留两层核心信息：第一层是标题、方向、标的、杠杆倍数、唯一编号、<strong>真实操作时间</strong>、重要性与结束状态；第二层是八项指标，<strong>顺序与排序行一致</strong>：镜像止盈状态、预期回撤、涨幅、涨幅效率、盈亏比、加仓效率、单场几何期望、单场算术期望。第二层<strong>左对齐、紧凑排开</strong>：每项上方一行淡色的指标名、下方一行等宽数字，从左往右依次排列，右侧留白、不把整行均分；每项的宽度按它自己最长的真实读数定（如盈亏比「76740.80%（767.41）」、几何期望连同「仓位击穿」徽标），所有卡片用同一套宽度，<strong>同名的项在上下各张卡片上落在同一条竖线上</strong>。手机上放不下一行，改成每行两项。更极端的读数在本项内以省略号收住，悬停可看完整数值。<strong>当前排序项在封面上高亮</strong>：按哪一项排序，每张卡片上对应的那一项就加一层淡琥珀底与细描边、指标名变成琥珀色；按操作时间、杠杆倍数、重要性排序时亮的是标题行里的操作时间、杠杆徽标与重要性，按字母排序时标题下面多一道琥珀下划线；DSI / USI 贡献不在封面上，没有可亮的。高亮只换底色，切换排序时文字不会挪动。「机会质量」已删掉：它用 max（b, 1）÷ 预期回撤把亏损场一律抹成同一个数，涨幅效率（主力涨幅 ÷ 预期回撤）衡量同一件事更直接。指标为正时使用绿色、为负时使用红色，无法计算时显示「—」。</P>
              <P>点击卡片右侧的小箭头，会在卡片内部展开战役时间、结构与时长、已实现盈亏和完整 Legs 标签；再次点击即收起。点击卡片其他区域会进入战役详情，详情始终从页面顶部打开；从详情左上角返回时，会恢复进入前的排序参数、方向和列表滚动位置——若你是从散点图点进去的，则回到那张散点图。</P>

              <SubTitle>统计概览与排序</SubTitle>
              <P>「统计概览」最前面是<strong>操作时间段</strong>筛选，默认<strong>全部</strong>：它决定后面每一个数的取样范围，按<strong>客观操作时间</strong>切（不受时间机器的模拟时钟影响），起止两天都算在内；可用「近 7 / 30 / 90 天、今年」等预设，也可以自己填起止日期，所选范围写进地址栏，从详情页返回时会跟着回来。<strong>统计概览、战役卡片与散点图读的是同一批战役</strong>，所以会一起跟着收窄——不会出现「统计说 45 场、下面却躺着 230 张卡片」。一旦设了范围，缺少客观操作时间的战役无从安放，会被排除并在浮层里报出场数；批量结束进行中战役等写库操作不受筛选影响，仍然针对全部战役。概览本身汇总有效战役、镜像止盈、胜率、平均盈亏比、期望值、几何期望与不对称风险，每一项写成「名称 + 数值」：名称淡、数值用等宽数字加粗，期望值与几何期望按正负着色（正绿负红）；浮层打开时对应那一项保持按下态。排序行只负责改变战役顺序，避免统计与操作混在一起。展开散点图后，这两行在图表滚动时吸在页眉下方，与页眉严丝合缝。</P>
              <P>统计指标<strong>单击一次</strong>展开公式、有效样本和当前代入值，再单击一次关闭。排序按钮<strong>单击</strong>只执行排序；再次单击同一按钮，在升序与降序之间切换。需要查看排序指标公式时，使用<strong>双击或右键</strong>，不会因为查看说明而误改排序方向。</P>
              <P>默认按<strong>真实操作时间</strong>从新到旧排序。排序行依次是操作时间、镜像止盈，一条短分隔线之后是<strong>预期回撤、涨幅、涨幅效率、盈亏比、加仓效率、几何期望、算术期望</strong>七项排在一起（与封面上镜像止盈之后的七格同序），再一条短分隔线之后是 DSI 贡献、USI 贡献、杠杆倍数、重要性与字母（重要性放在后面，排在字母之前）；每一项都可双向排序。排序行<strong>左对齐</strong>、按钮依次排开、间距均匀，放不下时整行换行。选中的那一项在 Σ 的位置换成方向箭头；没有公式的操作时间、杠杆倍数、字母平时也留着同样宽的空位，切换排序时按钮不会换位。涨幅、涨幅效率、加仓效率与其他公式指标一样，<strong>双击或右键</strong>打开公式浮层：公式、每个符号的含义、一个代入数字的例子、哪些战役不参与，底部是「查看散点图」入口。<strong>涨幅</strong>取主力的涨跌幅——与详情页 Legs 表「涨跌幅」列同一个数：同一对开平价（含平仓价校正）、按主力方向计，空单价格跌了为正；<strong>主力有几笔时取涨幅最大的那笔</strong>（不按名义大小挑），还没平仓的主力不参与；主力都还没平仓的战役不进入这一档排序，卡片第二行常驻显示这个数（紧跟「预期回撤」）。<strong>涨幅效率 = 主力涨幅 ÷ 预期回撤</strong>（两者都是价格层面的百分数，结果是倍数）：主力涨了 12%、入场到对冲边界 4%，效率就是 +3.00——价格走出了 3 个「预期回撤」。主力未平仓或算不出预期回撤的战役不进入这一档排序；卡片上紧跟「涨幅」显示，悬停给出代入值。<strong>加仓效率 = 盈亏比 ÷ 涨幅效率</strong>：只拿主力、不加仓时，盈亏比大致就是主力的涨幅效率（最大预期亏损按入场到对冲边界的距离定），比值约为 1；大于 1 说明加仓把同一段行情放大成了更多的 R，小于 1 说明加仓、对冲或止盈吃掉了行情。<strong>只在做过加仓、且涨幅效率为正时计算</strong>（有一条成交过的加仓腿；没有加仓时这个比值恒在 1 附近，没有信息量；涨幅效率为负时亏损战役负负得正会排到最前，接近 0 时分母过小会把主力几乎没动的战役放大成十几倍，所以按显示到两位小数的值判，0.00 也不算），其余战役不进入这一档排序与散点图；卡片上紧跟「盈亏比」显示，算不出时显示「—」。这里的操作时间是客观发生时间，不是无知之幕时间机器里的模拟时间。</P>

              <SubTitle>镜像止盈汇总</SubTitle>
              <P>概览行「有效战役」旁的<strong>镜像止盈</strong>统计整表的镜像止盈达成情况。判定口径是「该战役里有一条 <strong>mirror_tp</strong> 腿真正成交」，与单场决策准确度里的 <code>mirror_tp_capture</code> 同源，但不依赖 K 线、可对整表批量统计。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">读数</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">实现 / 未实现</td><td className="px-3 py-2 border-t border-border">两侧各给场数与占全表的百分比，合计 100%</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">六档：未实现 / 已实现 × 亏损 / 持平 / 盈利</td><td className="px-3 py-2 border-t border-border">先看镜像止盈委托有没有成交，再按实际盈亏比 b 分盈亏；<strong>|b| ≤ 0.1 记持平</strong>，与未结束一起归入「持平 / 进行中」。缺少有效初始最大预期亏损时退回按 final_realized_pnl 的正负判。<strong>未实现那一侧同样按盈亏拆开</strong>——「没触发但照样赚了」与「没触发且亏了」是两件事</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">达成盈利率</td><td className="px-3 py-2 border-t border-border">实现·盈利 ÷ 全部已实现镜像止盈的战役</td></tr>
                  </tbody>
                </table>
              </div>
              <P>按镜像止盈排序时使用的权重为六档升序：<strong>未实现·亏损 &lt; 未实现·持平 &lt; 未实现·盈利 &lt; 已实现·亏损 &lt; 已实现·持平 &lt; 已实现·盈利</strong>。先按成交与否分成两组、组内再按盈亏排——这套动作首先要考核的是「镜像止盈到底有没有生效」，赚亏是在那之后的事。盈亏三分统一走 ±0.1 的持平带：赚回 0.03R 与亏掉 0.03R 在决策上是同一件事，按金额符号切会把这类噪声战役硬塞进盈利或亏损。降序把「镜像止盈生效且赚钱」的战役排在最前，升序则把未实现的排在最前。每张战役卡片也有一列「镜像止盈」状态，盈利绿、亏损红。</P>

              <SubTitle>交易战役列表：期望值系列</SubTitle>
              <P><strong>战役级统计统一使用同一个有效样本口径：</strong>战役已经结束，并且存在大于 0 的初始最大预期亏损。计算如下：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">指标</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">公式</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">有效口径</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">初始最大预期亏损 Lᵢ</td><td className="px-3 py-2 border-t border-border">主力开仓名义仓位 × max（|开仓价 − 初始对冲 A 价|，|开仓价 − 初始对冲 B 价|）÷ 开仓价</td><td className="px-3 py-2 border-t border-border">主力开仓名义仓位为入场时 M 加镜像的真实全暴露，采用镜像 TP 落袋前口径；后续加仓、重入与反向对冲不计入。历史战役从成交、Leg 与事件流去重还原</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">单场盈亏比 bᵢ</td><td className="px-3 py-2 border-t border-border">已实现盈亏ᵢ ÷ Lᵢ</td><td className="px-3 py-2 border-t border-border">盈利为正，亏损为负；页面同时显示百分数和括号内数字</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">胜率 P(赢)</td><td className="px-3 py-2 border-t border-border">有效盈利战役数 ÷（有效盈利战役数 + 有效亏损战役数）</td><td className="px-3 py-2 border-t border-border">只统计有效且非盈亏平衡的已结束战役</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">平均盈亏比（概览显示值）b̄<sub>盈</sub></td><td className="px-3 py-2 border-t border-border">Σ 盈利战役 bᵢ ÷ 盈利战役数</td><td className="px-3 py-2 border-t border-border">概览那一项只报盈利侧——「赢的时候平均赢多少 R」；亏损侧与混合均值在它的浮层里</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">混合均值 b̄</td><td className="px-3 py-2 border-t border-border">Σ 单场盈亏比 bᵢ ÷ 有效战役数 N</td><td className="px-3 py-2 border-t border-border">亏损的负盈亏比原样参与求和。它不再作为概览标题数字，但期望值读的就是它</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">分组均值 b̄<sub>盈</sub> / b̄<sub>亏</sub></td><td className="px-3 py-2 border-t border-border">各自组内 Σbᵢ ÷ 该组场数</td><td className="px-3 py-2 border-t border-border">「赢时平均赢多少 R」与「亏时平均亏多少 R」，按已实现盈亏正负切分，打平两侧都不计入（但仍在 N 里）。b̄<sub>盈</sub> 就是概览上「平均盈亏比」显示的那个数，b̄<sub>亏</sub> 与混合均值在同一个浮层里。恒等式 b̄ =（n<sub>盈</sub>·b̄<sub>盈</sub> + n<sub>亏</sub>·b̄<sub>亏</sub>）÷ N 仍然成立</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">期望值 E</td><td className="px-3 py-2 border-t border-border">Σ bᵢ ÷ N = b̄，等价于（n<sub>赢</sub>·b̄<sub>赢</sub> + n<sub>亏</sub>·b̄<sub>亏</sub>）÷ N</td><td className="px-3 py-2 border-t border-border">统计期望就是有效战役盈亏比的平均值。课本式 P(赢) × b −（1 − P(赢)）里的 b 是赢时均值、亏损按恰好 −1R 计；b̄ 已含亏损的负值，再减（1 − P）会把亏损扣两遍，故不采用</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">预期回撤 dᵢ</td><td className="px-3 py-2 border-t border-border">max（|主力开仓价 − 初始对冲 A 价|，|主力开仓价 − 初始对冲 B 价|）÷ 主力开仓价 × 100%</td><td className="px-3 py-2 border-t border-border">至少存在一个有效初始对冲价格；支持列表双向排序，缺少价格的战役不参与排序</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">单场算术期望 Eᵢ</td><td className="px-3 py-2 border-t border-border">P(赢) × bᵢ −（1 − P(赢)），P(赢) 统一取 50%，即 Eᵢ = (bᵢ − 1) ÷ 2</td><td className="px-3 py-2 border-t border-border">胜率<strong>统一取 50%</strong>、不随账户实时胜率变动，同一场战役的读数只由它自己的带符号盈亏比 bᵢ 决定（bᵢ = +3 → +1.00R，bᵢ = −1 → −1.00R）；战役封面、排序、详情页盈亏概览与反事实概览同一口径。账户级的期望值与汇总几何期望仍按实时胜率</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">单场几何期望 Gᵢ</td><td className="px-3 py-2 border-t border-border">Gᵢ = 1 + bᵢ·x，x 每场统一取 10%；列里<strong>直接显示这个倍数</strong>（bᵢ = +2 → 1.20，bᵢ = −1 → 0.90）</td><td className="px-3 py-2 border-t border-border"><strong>1.00 是本金不增不减的分界</strong>，线下为亏损场。不乘胜率：单场结果已经发生，bᵢ 就是它的全部。1+bᵢ·x ≤ 0（bᵢ ≤ −10）代表本金被打穿，记 0.00</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">汇总几何期望 G</td><td className="px-3 py-2 border-t border-border">(1+b·x)^p × (1−x)^(1−p) − 1；x 统一取 10%，b 取盈利战役的平均实际盈亏比，p 取有效战役胜率</td><td className="px-3 py-2 border-t border-border">表示在历史总体参数、每笔固定投入 10% 资金比例下的理论每笔复利率；固定仓位后它的变化只反映 edge 本身，可以纵向比较</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">n 场累计因子 W（推演）</td><td className="px-3 py-2 border-t border-border">W = (1+b·x)^(n·p) × (1−x)^(n·(1−p)) = G^n，n 取有效战役数</td><td className="px-3 py-2 border-t border-border">把每笔复利率按有效战役场数复利到底的理论总倍数；它是模型推演，不是账户真实收益</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">实际复利结果 ∏（1+bᵢ·x）</td><td className="px-3 py-2 border-t border-border">把每一场的单场增长因子 1 + bᵢ×0.1 依次相乘</td><td className="px-3 py-2 border-t border-border">不用胜率、也不用平均值，照真实发生的 bᵢ 一场一场走：同样按 10% 的比例下注，本金实际变成几倍。任一场 bᵢ ≤ −10 会把整条路径归零</td></tr>
                  </tbody>
                </table>
              </div>
              <RedHighlight>
                没有初始最大预期亏损，就没有可用分母，因此该战役的盈亏比显示「—」。它不会进入盈亏比排序，也不会进入胜率、平均盈亏比和期望值。统计概览中的指标可单击查看公式；排序行中的公式指标需双击或右键查看，单击只负责排序。
              </RedHighlight>
              <P>单场几何期望只由 bᵢ 决定：按固定 <strong>10%</strong> 的资金比例下这一注，赚 bᵢ 个 R 就等于本金乘上 1 + bᵢ×0.1 倍。它<strong>不再</strong>使用该场真实的「最大预期亏损 ÷ 开仓时账户总资产」——真实 xᵢ 会把「这场赔率结构好不好」和「当时账户有多大」搅在一起，同样一场 +2R，早期小账户算出来像重仓豪赌、后期大账户算出来几乎没下注，两个数没法横向比。改成固定 x 之后，场与场之间只剩 bᵢ 在动，也不再依赖开仓时的账户资产快照，老战役同样算得出来。</P>

              <SubTitle>不对称风险指标</SubTitle>
              <P>本策略刻意让左尾受控、右尾开放，因此不直接用标准差或夏普把右尾也当作风险扣分。「不对称风险」与实时胜率、平均盈亏比和期望值使用完全相同的账户级有效战役池：每场以 <strong>b = 已实现 P&amp;L ÷ 最大预期亏损</strong>计量，b &gt; 0 为盈利战役，b ≤ 0 为亏损战役。系统不做截尾，b &lt; −1 的超额实亏会完整进入下行统计。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-border rounded-lg overflow-hidden">
                  <thead className="bg-muted"><tr><th className="text-left px-3 py-2">指标</th><th className="text-left px-3 py-2">计算</th><th className="text-left px-3 py-2">阅读方式</th></tr></thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">DSI 下行纪律系数</td><td className="px-3 py-2 border-t border-border">√（Σ亏损 b² ÷ n_loss）</td><td className="px-3 py-2 border-t border-border">越小越好；≤1.05 绿，1.05–1.15 黄，&gt;1.15 红</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">USI 上行保留系数</td><td className="px-3 py-2 border-t border-border">√（Σ盈利 b² ÷ n_win）÷（Σ盈利 b ÷ n_win）</td><td className="px-3 py-2 border-t border-border">越大越好；≥1.80 绿，1.50–1.80 黄，&lt;1.50 红</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">上行标准差 σ_u</td><td className="px-3 py-2 border-t border-border">√（Σmax（b,0）² ÷ N）</td><td className="px-3 py-2 border-t border-border">以全部有效战役 N 为分母；观察右尾是否被保留</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">下行标准差 σ_d</td><td className="px-3 py-2 border-t border-border">√（Σmin（b,0）² ÷ N）</td><td className="px-3 py-2 border-t border-border">越小越好；这是 Sortino 全样本口径，不可与 DSI 的条件口径混用</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">UPR 上行潜力比</td><td className="px-3 py-2 border-t border-border">U1 ÷ σ_d；U1 = Σmax（b,0）÷ N</td><td className="px-3 py-2 border-t border-border">主指标；上行只进分子、下行只进分母，越大越好</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">Omega 比率</td><td className="px-3 py-2 border-t border-border">U1 ÷ D1；D1 = Σmax（−b,0）÷ N</td><td className="px-3 py-2 border-t border-border">越大越好；Omega = 1 为盈亏平衡线</td></tr>
                  </tbody>
                </table>
              </div>
              <P>Sortino 作为对照项显示：<strong>Sortino =（U1 − D1）÷ σ_d</strong>。系统同时校验恒等式 <strong>Sortino ≡ UPR − D1 ÷ σ_d</strong>，用于发现口径漂移。没有亏损样本时 DSI、σ_d、UPR、Omega、Sortino 显示「—」；没有盈利样本时 USI、σ_u、U1、UPR、Omega 显示「—」。对应盈利或亏损样本少于 5 场时仍给出数值，但标注「样本不足」。</P>
              <P>盈亏比未回填的已结束战役不会进入这些指标，模块脚注会注明排除数量。进入单场战役后，「盈亏概览」会显示本场 <strong>b² ÷ n</strong> 对 DSI 或 USI 组内均方的贡献，以及本场 b² 占对应组 Σb² 的比例，用来快速定位拉高左尾风险或支撑右尾保留的具体战役；该项也会自动进入一键导出图片。</P>

              <SubTitle>DSI 贡献率与 USI 贡献率</SubTitle>
              <P>排序行里另有两档指标，把上面那个「单场贡献」提到整表维度，用来看<strong>风险与盈利的集中度</strong>。DSI 与 USI 都建立在组内均方（b² 的平均）之上，因此一场战役的边际影响，就是它的 <strong>b² 占本组平方和的比例</strong>：</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">指标</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">公式</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">样本与读法</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-2 border-t border-border">DSI 贡献率</td>
                      <td className="px-3 py-2 border-t border-border">bᵢ² ÷ Σ（亏损战役 b²）× 100%</td>
                      <td className="px-3 py-2 border-t border-border">只有<strong>亏损战役</strong>（b ≤ 0，含盈亏持平）参与。点越高，这一场对下行风险的拉动越大</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 border-t border-border">USI 贡献率</td>
                      <td className="px-3 py-2 border-t border-border">bᵢ² ÷ Σ（盈利战役 b²）× 100%</td>
                      <td className="px-3 py-2 border-t border-border">只有<strong>盈利战役</strong>（b &gt; 0）参与。若极少数战役占掉大半，说明盈利高度依赖偶发大赚</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <P>盈亏两组互斥，因此两张图天然各自只收一侧样本，<strong>组内贡献率合计恰为 100%</strong>。平方会放大大额盈亏——这正是要看见的东西：少数几场往往就占掉大半。只对已了结且 b 有效的战役计算；未了结的战役本就不在 DSI / USI 的分母里，给它算占比会与口径不一致。</P>
              <Highlight>
                USI 贡献率必须与 <strong>U1</strong> 联合判读：贡献率只描述「盈利来自谁」，不描述「盈利有多少」。集中度高本身不是错——右尾开放的策略天然如此；真正要警惕的是集中度高<em>且</em> U1 偏低，那意味着仅有的几次大赚还不足以撑起整体上行。
              </Highlight>

              <SubTitle>指标散点图</SubTitle>
              <P>盈亏比、预期回撤、涨幅、涨幅效率、加仓效率、算术期望、几何期望、重要性、镜像止盈、DSI 贡献、USI 贡献都各自配有一张散点图。在排序行上<strong>双击或右键</strong>对应指标打开公式浮层，浮层底部的「查看散点图」即可展开；再点一次「收起散点图」关闭。<strong>盈亏比、涨幅、涨幅效率、加仓效率、算术期望与几何期望默认展开的是分布图、镜像止盈默认展开的是柱状图</strong>，其余指标以及这几项切回「时序」后，横轴都是按<strong>客观操作时间</strong>排列的战役序号，与列表当前排序无关——改排序不会让点位移动。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>颜色分两类。</strong>本身带盈亏方向的指标（盈亏比、涨幅、涨幅效率、加仓效率、算术期望、几何期望）按数值正负着色：正绿、负红、零灰。不带方向的纯量级指标用单色，避免暗示盈亏：重要性琥珀、DSI 贡献红、USI 贡献绿。</li>
                <li><strong>涨幅、涨幅效率、加仓效率、算术期望默认看分布</strong>，与盈亏比同一套画法：横轴就是指标本身（涨幅 %、涨幅效率与加仓效率「倍」、算术期望 R，线性刻度），纵轴是落在该值附近的战役数量——点按档从底线向上堆叠，灰色曲线是密度估计，不考虑时间先后。灰色 0 线分开正负：涨幅与涨幅效率的 0 叫「不涨不跌」，摘要条报「顺向」占比（价格朝主力方向走的场数）；算术期望的 0R 是盈亏平衡（对应 b = +1R），摘要条报「正期望」占比；加仓效率另有一条<strong>琥珀色 1.00 虚线</strong>「加仓没有额外放大」，摘要条多报一项「放大（&gt; 1）」占比。0 与 1.00 都是档边界，点不会吸附到线的另一侧，恰好落在线上的归右侧；窗口取 p2–p98 并一定把 0（和 1.00）圈进来，超出的极端值贴边画成三角并计数。用面板右上角的「时序 | 分布」切回时序：纵轴是同一个数，横轴按客观操作时间排列。与排序同一组函数取数：主力未平仓的不进涨幅图，还算不出预期回撤的不进涨幅效率图，<strong>没有加仓、或涨幅效率不为正的战役不进加仓效率图</strong>，算不出盈亏比的不进算术期望图；未进图的场数写在图下脚注里。</li>
                <li><strong>预期回撤是个例外。</strong>它的纵轴只表达风险距离、本身不含盈亏方向，所以颜色改由<strong>该战役最终盈亏</strong>决定：盈利绿、亏损红、打平或未结束灰。这样同一张图上既能看到风险空间，又能看到它最后换来了什么结果。</li>
                <li><strong>几何期望默认看对数分布。</strong>正值按 ln(Gᵢ) 排布，刻度和提示框仍显示原始倍数：<strong>0.5 → 1 → 2 等距</strong>，本金减半与翻倍可用同一尺度比较，小于 1 的点不会被极端盈利挤成一列。竖线画在 <strong>1.00</strong>（盈亏分界），点按对数空间分区等宽分档堆叠，密度曲线也在对数空间计算，并换算成每档期望场数。<strong>Gᵢ = 0 单独显示在「本金归零」栏</strong>，不取对数、不纳入密度曲线，但仍计入样本总数、胜率和摘要统计。正值窗口在对数空间稳健取值，超出窗口的点贴边标记并计数；没有 −1R 止损墙或 +10R 封顶。原始指标计算不变，不能仅凭分布偏斜判断风控是否合格。用「时序 | 分布」切回时序。</li>
                <li><strong>几何图的归零黄线。</strong>有归零样本时，左侧独立栏以黄色竖线和「归零界限」标注。固定 10% 下注时，bᵢ ≤ −10 对应 Gᵢ = 0（收益率 −100%）；收益率 −0.9 对应 Gᵢ = 0.1（本金剩 10%），不是归零。这条黄线分隔归零样本与正值对数轴，不是有限的 ln(0) 坐标。</li>
                <li><strong>0.90 参考黄线。</strong>几何期望分布在 Gᵢ = 0.90 处另加黄色竖线，按 ln(0.90) 定位，与 1.00 盈亏平衡线、左侧归零栏分别标注。分档以 0.90 和 1.00 为边界，散点不会因吸附到档中心而跨线；0.90 不是归零界限。窄屏必要时可横向滚动，保持对数比例和点位间距。</li>
                <li><strong>镜像止盈默认看柱状。</strong>四个结果档位（未实现 / 亏损 / 持平 / 盈利）各一根柱，柱由该档的战役自底向上码成方阵——场数多时一行并排放几个点，左侧场数刻度已按每行点数同比折算，精确场数另写在柱脚下。点位悬停或聚焦会报出该场的实际盈亏比 b：档位只有四种，b 才说明这一场赚亏了多少个 R。用面板右上角的「时序 | 柱状」切回时序，选择记进地址栏。</li>
                <li><strong>盈亏比默认看分布。</strong>要判断的是这套打法的形状——右尾够不够长、亏损有没有被止损墙挡住——形状与战役先后无关，所以展开盈亏比时先给分布图；用面板右上角的「时序 | 分布」随时切回时序，选择记进地址栏。分布图横轴是盈亏比 b 本身（单位 R，线性刻度），纵轴是落在该 b 附近的战役数量——点按档从底线向上堆叠，每档至少 14px 宽，堆得越高出现得越多，不考虑时间先后。琥珀色 −1R 虚线是止损墙，灰色 0 线是盈亏平衡；默认每 1R 等分，−1R 与 0 不跨档。存在 <strong>b ≤ −10</strong> 时额外显示黄色 <strong>−10R 归零线</strong>，含等号的风险点用红色方点和黄色描边区分：按固定 10% 下注，1 + 0.1b ≤ 0，本金归零；<strong>这不是实际账户的强平判定</strong>。此时按 −10、−1、0 分区再分档，−10 归左侧，避免风险点被排到线右侧；窄屏必要时允许横向滚动。灰色曲线是核密度估计按标准档宽换算的「每档期望场数」，硬边界附近为近似值。显示区间通常取 p2–p98、右侧封顶 +10R；存在归零样本时左界为 −12R，保证归零线可见。超出窗口的极端值贴边画成三角并计数，极端亏损仍带黄色描边，提示框、统计与点击跳转保留原始数据。</li>
                <li><strong>点进去还能回得来。</strong>点任一散点即进入该战役详情；从详情左上角返回时，会<strong>落回同一张散点图</strong>，而不是掉回卡片列表。选中的图表与所选视图（时序 / 分布）都记在地址栏里，刷新与浏览器前进 / 后退都能复原。</li>
                <li><strong>颜色之外还有形状。</strong>同一张图里，圆点、菱形、空心圈各代表一类，色觉差异或黑白打印时靠形状也能分辨；图例里的形状与图上的点位完全一致。绿与红在红绿色觉模拟下 ΔE 只有 7.9，属于必须配次编码的地板band，所以盈亏两色一律绑定形状。</li>
                <li><strong>镜像止盈图是一张交叉表。</strong>六根柱 = 成交与否 × 亏损 / 持平 / 盈利，颜色报的仍是那一场的盈亏。这样既读得出「镜像止盈生效了没有」，也读得出「没生效的那些最后赚没赚到钱」。口径与分档一致：|b| ≤ 0.1 记持平，与尚未结束的战役同为灰色空心圈。</li>
                <li><strong>点位大小固定 8px，不会因为战役变多而缩小。</strong>时序图里战役数量超过图区宽度时，图区改为<strong>左右滚动</strong>并默认停在最右端（最新的战役），左右两侧的渐隐提示还有更多点位；右侧 n= 始终是全域计数，可用来读出被长尾压扁的中段密度。分布图不滚动，柱高就是计数：堆得比图高还高时先把图盒撑高，撑到上限仍放不下的那一截在柱顶合成一个三角并在脚注报数。</li>
                <li>浮层里的说明会列出该图纵轴含义、点位读法、颜色图例与参考线；分布图的说明还会解释止损墙、盈亏平衡线与密度曲线的读法。缺少有效值的战役不进图，脚注会注明排除数量。</li>
              </ul>

              <SubTitle>算术期望与几何期望怎么读</SubTitle>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">指标</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">回答的问题</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">不能说明什么</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">汇总算术期望 E</td><td className="px-3 py-2 border-t border-border">按当前胜率与<strong>混合均值 b̄</strong>（不是概览显示的盈利侧均值），每承担 1R 风险的平均加法收益是多少</td><td className="px-3 py-2 border-t border-border">不反映仓位大小、波动拖累与复利路径</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">汇总几何期望 G</td><td className="px-3 py-2 border-t border-border">若每笔固定按 10% 的资金比例重复同类战役，理论资本每笔按什么速度复利</td><td className="px-3 py-2 border-t border-border">不是实际历史收益率，也不是对下一笔的保证</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">实际复利结果 ∏（1+bᵢ·x）</td><td className="px-3 py-2 border-t border-border">同样按 10% 下注，这批战役真实走下来把本金变成了几倍</td><td className="px-3 py-2 border-t border-border">它按的是固定 10% 的假设仓位，不等于账户的真实收益曲线</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">单场算术期望 Eᵢ</td><td className="px-3 py-2 border-t border-border">把该场事后实际 bᵢ 放回当前总体胜率后，得到怎样的 R 值</td><td className="px-3 py-2 border-t border-border">不是该场建仓时已经知道的事前期望</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">单场几何期望 Gᵢ</td><td className="px-3 py-2 border-t border-border">若按固定 10% 的资金比例下这一注，这一场把本金乘成了多少（1.00 = 不增不减）</td><td className="px-3 py-2 border-t border-border">不能仅凭一场结果判断策略未来必然盈利或亏损</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                单场 Eᵢ 与 Gᵢ 使用的是事后实际盈亏比 bᵢ，因此它们是复盘指标，不是纯粹的事前预测。真正的事前期望需要使用建仓当时估计的胜率、预期盈利倍数和预期最大亏损比例。
              </Highlight>

              <P><strong>「几何期望」那一项里其实是两个口径，浮层已经分成两块</strong>：上半是<strong>理论几何期望</strong>——把盈利战役压成一个平均 b，配上胜率 p 推演「重复下注 n 次会怎样」；下半是<strong>实际复利结果</strong>——不用胜率也不用平均值，照真实发生的每一个 bᵢ 逐场连乘。两者之差就是真实样本的分布相对「按均值推演」的代价或红利：理论那条抹掉了顺序与离散度，实测这条保留了每一场的原样。</P>

              <SubTitle>几何期望为负意味着什么</SubTitle>
              <P>几何期望小于 0，表示相应的复利增长因子小于 1：如果在相同胜率、盈亏结构和风险比例下反复执行，理论账户资产会随次数按复利方式缩水。例如几何期望为 −5%/笔，对应的理论路径约为「初始资产 × 0.95ⁿ」。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>单场 Gᵢ 与 bᵢ 同向：</strong>固定 x 之后 Gᵢ = 1 + bᵢ×0.1 是 bᵢ 的线性变换，赚的场在 1.00 以上、亏的场在 1.00 以下，不会出现「bᵢ 为正而 Gᵢ 低于 1」。也正因为是线性变换，<strong>按几何期望排序与按盈亏比排序的次序完全一致</strong>——它换的是单位（资本倍数），不是次序。会出现「正负背离」的是<strong>汇总</strong>几何期望：它要按胜率把赢腿与亏腿加权，波动拖累体现在那里。</li>
                <li><strong>bᵢ 为负导致 Gᵢ 为负：</strong>主要描述这场历史结果确实侵蚀了资本；它不等于同类策略未来必然是负期望。</li>
                <li><strong>算术期望为正但几何期望为负：</strong>表示方向上可能仍有平均优势，但下注过重，长期路径仍可能缩水甚至归零。</li>
                <li><strong>1+bᵢ·x ≤ 0（即 bᵢ ≤ −10）：</strong>这一场亏掉了十倍于计划最大亏损的钱，按 10% 的下注比例足以打穿本金，Gᵢ 记 0.00。</li>
              </ul>
              <RedHighlight>
                几何期望为正不是“这场交易正确”的证明，几何期望为负也不是对未来的判决。它首先是一把检查赔率、胜率与仓位是否共同支持长期复利的尺子。
              </RedHighlight>

              <P>删除战役采用可恢复模式：战役会从正常列表和统计中移出，但 Legs 与交易记录不会随之消失。列表标题栏右侧的低对比度回收图标可打开“已删除战役”，从中恢复原战役；只有在回收区再次选择“永久删除”时，战役归档才会真正移除。</P>
              <SubTitle>战役详情页：K 线时间轴标注</SubTitle>
              <P>
                打开一次战役，上方是贯穿整段的 K 线回放，下方是 <strong>Legs 列表</strong>。两者共用同一条时间轴，对照着看就能还原整条战役的进出场节奏：
              </P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>战役列表的加载。</strong>首屏只取各场战役的明细（数据库并发查询）即刻渲染；「平仓价校正」需要按每条腿回查客观 1 分钟 K 线，请求量是「场数 × 腿数」，因此改为<strong>后台补齐、逐场静默替换</strong>——首屏不再被它阻塞，数字随后自行收敛到与详情页完全一致的口径，功能一项不减。</li>
                <li><strong>「Δb」列与持仓阶段拆解。</strong>Δb = 该腿盈亏 ÷ 战役初始最大预期亏损 L——这条腿把整场盈亏比 b <strong>推高或拉低了多少个单位</strong>，Σ(各腿 Δb) 恰为战役已实现 b，「b 是如何被增加、如何被削减」由此逐腿可见。更进一步，<strong>一笔持仓不是铁板一块：对冲开仓或平仓都会改变净暴露状态</strong>。主力与其他多单（包括加仓）下方有浅色的<strong>阶段子行</strong>，<strong>默认折叠</strong>：对应角色标签右边有一个小开关——朝右的箭头加阶段数（如「› 5」，悬停显示「展开 5 个阶段」），点一下展开、箭头转向下，再点收起；各行的开关落在同一条竖线上，每条腿各自记着开合，刷新后回到折叠。阶段子行以每笔对冲的开仓和平仓为边界，按实际暴露依次标为<strong>「纯多头阶段」「对冲1阶段」「对冲2阶段」……再回到「纯多头阶段」</strong>；纯多头沿用普通表格底色与文字，对冲阶段只使用淡蓝色背景和阶段名称，连续或重叠对冲按正在生效的编号标明。<strong>不再把最后一段叫作「收尾」</strong>；因多空腿在同一次平仓操作中成交有先后而产生的<strong>不足 1 分钟临时阶段</strong>会并入相邻阶段，不单独呈现，恰好 1 分钟及以上仍保留。每段给出时间区间、起止价、分摊盈亏、贡献率与 Δb，合并前后的阶段盈亏之和始终严格等于整条腿盈亏；分摊按整条腿的价差权重进行，绝不臆造数字。滚动 / 回场对冲腿按开仓先后编号为「滚动对冲 1、2……」，初始对冲 A/B 保留固有名称。完全没有对冲参与时不重复显示整腿，也没有阶段开关。PNG 导出同源同列、使用相同配色；PNG 导出不跟着折叠，始终画出全部可见阶段子行。</li>
                <li><strong>「盈亏 / 贡献」列</strong>给出每条腿<strong>各自的已实现盈亏（USDT）</strong>与它对整场战役的<strong>贡献率</strong>。盈亏优先取成交记录（引擎撮合的真账），没有才退回复盘时填的快照；未平仓或无数据显示「—」而非 0——0 会被读成「打平」。贡献率的分母是<strong>本场各腿盈亏绝对值之和</strong>，不是战役净盈亏：一场主力 +1000、对冲 −200 的战役，按净额 800 算主力会是 125%（超过 100%、且对冲变成 −25%，读起来别扭）；按绝对值之和 1200 算，主力 +83.3%、对冲 −16.7%，各腿份额之和恒为 100%，「谁占多大分量」一目了然，符号保留因此正负一眼可分。该列与 PNG 导出同源，两处读数不会打架。</li>
                <li><strong>Legs 列表每条腿都标明开仓/平仓时间、开仓价/平仓价、仓位与状态</strong>；还没平仓的腿，平仓时间与平仓价显示「—」。<strong>第一列只有「角色」</strong>：一枚角色标签，不印腿的序号，也不挂「回填」标签（历史回填的腿，鼠标停在角色标签上可见说明）；横向滚动时这一列冻结在左缘，滚出去之后右缘才出现一道分隔线。状态不单独占一列，也不再写成文字标签，而是画在角色标签上：已平仓是常态，标签照常是实心淡底；<strong>「挂单中」</strong>（对冲 / 镜像腿<strong>还没有成交</strong>）的标签画成同色虚线的空心标签——<strong>按成交判定，不按有没有平仓记录判</strong>：系统只在平仓时写成交记录，已经成交、还拿着的对冲 / 镜像腿是一笔真实持仓，显示为「进行中」并照常计入占比；判据按先后是 ① 本地委托证明它从未成交（还挂着或已撤单）→ 挂单中，② 腿上记的就是某张反向委托：已触发 → 进行中、仍挂着或已撤 → 挂单中，③ 腿上没有任何成交 id：事件流里有它的触发事件 → 进行中、否则挂单中，④ 有成交 id 又查不到没成交的证据（换了浏览器时常见）→ 进行中，与归类页「已成交 · 成交记录未载入」同一口径，<strong>「进行中」</strong>（还没平仓）的标签文字后面多一枚同色实心小圆点，<strong>「爆仓」</strong>（这条腿是交易所强制平掉的，按成交记录的强平标记判，与时间线、仓位面板的红色「爆仓」同一条判据）的标签文字后面多一枚红色的「爆仓」小字；三种都能悬停看到说明，读屏也会念出状态。爆仓仍是<strong>已平仓的一种</strong>，照常计入占比与多空合计，只是平仓的是交易所、不是这条腿的决策。没有角色的腿是一枚写着「—」的灰色标签（悬停说明它还没有归类），状态的画法相同。PNG 导出的第一列同样只有角色标签，挂单中空心、进行中带圆点、爆仓带红字；开仓快照与平仓评价两份 TXT 的「仓位」那一行也会写出「· 爆仓」。<strong>爆仓那一行的三个价格格子解释不了它的盈亏</strong>：逐仓强平按破产价结算——整笔仓位亏掉的恰好是它的隔离保证金（一个仓位由几笔成交并成时，这笔钱按各刀分摊，各刀相加正是保证金），与开仓价 / 平仓价的价差无关，差额是平仓费与强平清算费（平仓价格子的悬停说明会把这句话与这一刀的金额写出来）；全仓强平没有保证金封顶，亏损 = 强平价上的浮亏 + 平仓费 + 强平清算费。强平记录<strong>一律不按平仓时刻的 1 分钟 K 线重新定价</strong>（不论带不带破产价结算标记），<strong>显示的平仓价也不换</strong>：价确实不在那一刻的 K 线里时仍标「强平异常」，但那只是警示——盈亏保持交易所结算的那个数、平仓价与涨跌幅仍按记录里的强平价算，一行之内只用这一对价（K 线区间写在悬停说明里）。以前只挡了破产价结算的那一种，全仓强平与老的逐仓强平会被 K 线改写（实际亏 4253 的 BTC 多单读成 −1653），这个数还会流进合计、Δb、b、R 与战役状态。平仓价右侧的<strong>「涨跌幅」</strong>按持仓方向计（多单 =（平仓价 − 开仓价）÷ 开仓价，空单 =（开仓价 − 平仓价）÷ 开仓价），正数即这条腿在价格上占优、按所示的这一对开平价看与盈亏同号；与左边两格用同一对价（含 K 线平仓价校正），未平仓显示「—」；一个仓位分几刀平掉时平仓价取最后一刀、盈亏是各刀合计，两者符号可能不同；主力及其他多单（含加仓）的阶段子行按各自方向、各自起止价计算，所有角色都不呈现「收尾」阶段，合计行留空。PNG 导出同列。「币量 / 仓位」右侧是<strong>「占比」</strong>一列，<strong>按战役主方向取一侧</strong>：<strong>主多战役看多单</strong>（列头挂一枚绿色「多」标签，读屏念「多单占比」），<strong>主空战役看空单</strong>（列头挂一枚红色「空」标签，读屏念「空单占比」）——主力那一侧才是要读的仓位分布，另一侧是对冲。分组按这条腿实际的持仓方向（与「涨跌幅」同一个方向），同方向的各腿只和同方向比——对冲通常是空单，主空战役里的对冲则是多单，分组跟方向走、不跟角色走。<strong>另一侧（对冲那一侧）的行这一列留空</strong>，也不进它的分母——对冲不单独算占比，只在合计行给出总量；百分数本身是中性色，悬停可见「多单合计里的占比」（主空战役写「空单合计里的占比」）。上行是这条腿的币量占本侧币量合计的百分比、下行是名义仓位占本侧名义仓位合计的百分比，两个分母各算各的，用的是「币量 / 仓位」列每行背后的同一组数，按未舍入的原值相加（各行与合计行各自取两位小数，把各行印出来的数手工相加，末位可能与合计行对不上）；状态为「挂单中」的对冲 / 镜像腿（还没有成交）不计入合计，属于本侧时这一列两行都显示「—」；缺开仓价的腿上行显示「—」、不进本侧的币量合计；各行分别取一位小数，逐行相加不一定恰好是 100.0%（腿越多、舍入差可能越大，如六条等额的多单各印 16.7%，加起来是 100.2%）；阶段子行这一列留空。<strong>点击列头排序</strong>：点一下按本列占比降序（占比大的在上），再点一下升序，第三下回到默认顺序（降序 → 升序 → 默认顺序）；按上行的币量占比排，缺币量时按下行的名义仓位占比；这一列没有数的行（另一侧的腿、挂单中的腿、没有仓位数据的腿）不论升降序都留在最下面，彼此保持原来的先后，占比相同的也保持原来的先后；阶段子行跟着所属腿走，合计行始终在最后；排序后表格回到最上面（横向位置不变），排在最前的行直接看得见；排序不保存，刷新或重新打开这场战役后回到默认顺序。合计行的「币量 / 仓位」格按方向各写一组 Σ（以同样的「多 / 空」标签开头，上行 Σ币量、下行 Σ名义仓位，挂单中的腿不计入）：<strong>战役主方向那一侧的那组是本列的分母</strong>，占比的合计格写那一侧的「100.0%」，与这组落在同一行（Σ 固定先多后空，主空战役看空单时先垫一组空白才对齐）；<strong>另一侧那组是对冲各腿的合计</strong>，看对冲一共开了多大，不作任何占比的分母；没有计入腿的方向不列（例如主多战役里唯一的对冲还挂单中时只剩多单一组；本侧的腿都还挂单中时占比的合计格留空）；一条腿都不计入时这两格都显示「—」（某方向计入的腿都缺开仓价时，该方向只有上行是「—」）。PNG 导出同样只有这一列占比、同样按战役主方向取一侧（表头写「多单占比」或「空单占比」），留空与合计行对齐的规则相同；PNG 导出不跟着排序，始终按默认顺序画出全部腿。「委托」列按真实业务归属呈现：委托先按挂出时刻归到当时开着的那笔主力；<strong>加仓之后挂出的委托放在加仓那一行的后面，再加仓就放到最新那次加仓的行后面</strong>（按开仓时刻排，不看「加仓1 / 加仓2」的编号；加仓开出前 5 分钟内预挂、且加仓开出时仍挂着的也算这次加仓；主力开仓前预挂的仍归主力；加仓先平掉之后挂出的回到主力；反过来主力先平、加仓还开着时仍接在加仓后面；全部平完之后才挂出的，与收尾前一刻挂出的落在同一行）。这只是 Legs 表与导出 PNG 的<strong>展示位置</strong>，初始暴露、预期最大亏损等风险指标仍以主力为锚。对冲触发后的反向委托放在对应的对冲 leg；镜像止盈行则显示止盈挂单时间与触发时间，避免把主力委托误记到镜像腿。</li>
                <li><strong>「加仓校验」列</strong>（紧跟「币量 / 仓位」与占比列之后）只在加仓行打标：每笔加仓只按<strong>它自己那一刻</strong>的客观状态判定（马尔可夫式）：当时仍持有的全部腿按开仓价入账——更早的加仓在当时止损线上的浮盈加进垫子、浮亏扣减垫子——加上当时挂着的止损线与当时已落袋的 G；不继承上一笔加仓的对错，上一笔判 ✗ 不会让这一笔自动判 ✗，上一笔的浮亏尚未兑现、而当下已出现可加仓的优势时，照当下判。以加仓那一刻挂着（或加仓后 5 分钟内补挂）、在亏损侧离加仓价最近的反向委托价为止损线 S₁（加仓计算器比对盘口线用同一规则），<strong>旧仓浮盈垫 X₁(S₁ − S̄) + 已落袋 G ≥ 新加仓最大预期亏损 X₂(S₂ − S₁)</strong>（主空符号翻转，不计手续费；币本位 G 按 S₁ 折成 U）即合规——X₁ 只算加仓那一刻还拿着的币（加仓前已减掉、已止盈的不算）；G 的正向来源只认成交记录上退出方式为止盈1 的那几刀（镜像止盈），普通减仓、手动或止损平仓的盈利不混入——哪怕合并仓位按成交占比分到了镜像腿上；先前已经实现的亏损（含强平）则从 G 中扣掉，G 可以是负数；再入场之前那一轮也不算。与加仓计算器同一个 G。合规时显示一枚几乎隐形的淡灰对号；抹不平就是<strong>红色放大的叉</strong>，下方直接写出 Plan B 的<strong>正确加仓上限</strong>：X₂ 是币量，同时给出按 S₂ 折算的 U 名义仓位，两个数是同一仓位的两种单位，不可相加。<strong>点击红叉</strong>会展开计算框，逐步列出 Y₁、G、可用覆盖额、每币风险、正确币量上限、U 名义仓位以及实际超出量；读不到 S₁ 等无法判断时显示淡灰「—」。PNG 导出也会写明币量上限与 U 折算额。<strong>S₂ 一律按成交价判</strong>——市价单含引擎滑点（0.01% + 名义 ÷ 50 亿）的那个价，不是下单前看到的现价；真正的风险就在成交价上，判定不为计算器让步。成交记录带着加仓计算器当时的计划时，计算框与 PNG 会并排写出「计算时 现价 …，预计成交 …，上限 … 币；实际成交 …，上限 … 币」（括号里是相对这张单下单价的滑点；「现价」只用于市价计划——限价计划的参考价是手填的限价，写「计算时 限价 …，挂单价 …」，条件委托计划写「计算时 触发价 …」），再说清超出从哪来：
                只有按这张单下单时的价、计入计划预计的滑点，这个量本来仍在上限之内，才点名<strong>「超出部分全部来自成交滑点 +x%」</strong>——x 是比计划预计多出来的那一截，那是执行结论，不是仓位算错；
                计算后价格已经变了，多写一行「下单时 参考价 …（计算后价格变动 +y%）」，说超出来自价格变动、下单前该按新价重算
                （限价 / 条件单挂的价不是计划里的价时，写「下单价偏离计划挂单价」/「触发价偏离计划触发价」）；
                量本身超过了计算器的上限，就直接说比计算时的上限多了多少——不拿滑点顶罪。没有快照的老记录只给判定，不猜下单前的价（腿上的 pre_entry_price 已被成交价改写，不能当它用）。</li>
                <li><strong>镜像止盈即使没有触发，也会作为一条 leg 列出</strong>（角色标签画成虚线空心，悬停显示「挂单中」）。未触发意味着没有成交记录、因而没有对应的成交行，但「这场战役到底挂没挂过镜像止盈、挂在什么价位」本身就是复盘要看的事实——不能因为它没成交就在列表里消失。</li>
                <li><strong>一场战役出现两笔及以上主仓时，以名义金额最大的那笔为准</strong>。M 底仓 + 镜像多单本就是两笔，再加上回填、残仓、试单，主仓多于一笔是常态；此时开仓价、杠杆跟着<strong>金额最大的那笔</strong>走（「委托」列先按时间找挂出时开着的主力，同一时刻开着多笔时才按金额定），而不是序号或时间排在最前的那笔——否则一笔几千 U 的残仓会把上千万 U 的真正主力挤掉，让整份复盘的开仓价与委托归属全部挂错。金额并列时退回最早开仓的那笔，保证结果稳定可复现。</li>
                <li><strong>K 线默认按三段式窗口自适应</strong>：首次打开时，战役内容占中间 1/3，开始前与结束后各显示一段同等长度的行情。底层同时预载战役左右各 25 倍的行情，完整可浏览范围为 51 倍；盘面顶部的小型倍率按钮可一键切换 1.1、2、3、5、11、21、31、41、51 倍，所有倍率都围绕战役持仓段居中，2 倍时左右各保留半段上下文。历史战役同样适用。</li>
                <li>内容区间会囊括 Legs、委托空单和当前反事实分支的最早 / 最晚事件，保证所有开平仓与挂单信息都落在默认可视范围内。</li>
                <li>时间轴上用<strong>彩色竖线</strong>标注每条腿的开单 / 平单时刻——颜色区分方向、线型区分动作（见下表）。</li>
                <li>主力开始只做一个简洁标记与较醒目的竖线，不额外绘制主力水平线；即使战役跨度很长，这条开始线也会保留。</li>
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

              <SubTitle>战役详情页：盈亏概览与高清 PNG</SubTitle>
              <P><strong>已实现盈亏的口径全系统只有一个</strong>：本场战役所归类仓位产生的每一条结算记录（平仓 / 爆仓）之和，按成交 id 去重、每条恰好计一次。一个仓位分几刀平掉时每一刀都算，镜像止盈落袋也算（它就是主力仓位上的一刀）；资金费不并入任何腿。战役状态、标题、列表卡片、Legs 表合计行、导出 PNG 与复盘 TXT 全部读同一个函数，且这个函数吃的是<strong>同一份平仓价校正</strong>（按每条腿平仓时刻的客观 1 分钟 K 线校验，平仓价落在 K 线区间之外时按该分钟收盘价重算）——详情页页眉、导出图的「方向 / 状态」与文件名里的 profit / loss、结束战役对话框里的状态，都由<strong>校正后</strong>的已实现盈亏推出（已结算的战役在对话框里只能写推出的那个状态，「放弃」只留给还有腿没平的战役），因此<strong>「亏损结束」配一个绿色正数在构造上不可能再出现</strong>。Legs 表底部的<strong>合计行</strong>按构造恒等于盈亏概览的已实现 P&L，旁边标注这笔数取自成交记录、复盘快照还是落库缓存。落库的状态与 final_realized_pnl 只是这份现算值的缓存：打开战役详情时，若校正拉齐且与库中值实质不同，系统回写一次收敛；校正拉不齐时不回写——K 线限流、断网、拉取超过 5 秒未返回，以及本地查不到某条腿的成交记录（换了浏览器、清过历史成交：查不到只是校验不了，不等于无需校正）都算拉不齐。列表页本身不回写；列表页开着时，对每条腿都挂着成交记录、且本地查得到这些成交的已结束战役，若校正拉齐后落库结果与校正后结果仍不一致，它会在后台逐场、一次一场地跑一遍与打开详情页相同的自愈，元监控等读落库值的统计因此不必逐场点开就会收敛；只有复盘快照、本地查不到成交记录的战役不在其中（校验不了就不判偏离），仍要打开详情页才收敛。所以缓存只会朝校正后的值收敛、不会在两个值之间来回翻转。本地没有成交记录的浏览器按各腿的复盘快照显示（快照不带校正），与现算值不一致期间以现算值为准，并在盈亏概览里显示与落库缓存的差额。详情页的<strong>盈亏概览</strong>统一展示已实现盈亏、主力开仓杠杆倍数、主力开仓名义仓位、峰值浮盈、最大预期亏损、预期回撤、<strong>涨幅、涨幅效率</strong>、盈亏比、<strong>加仓效率</strong>、单场算术期望与单场几何期望（「今日账户总资产」不在概览里单列——它只作几何期望缺开仓快照时的估算分母，脚注会写明）。涨幅、涨幅效率、加仓效率与战役列表卡片同一套函数：涨幅就是 Legs 表主力那一行的「涨跌幅」，涨幅效率 = 涨幅 ÷ 预期回撤（排在预期回撤正下方），加仓效率 = 盈亏比 ÷ 涨幅效率（排在盈亏比右边）。反事实盈亏概览同样有这三项：主力的开平价与方向没改时沿用上方的涨幅（原样重跑逐位相同），改过就按副本里改后的价算；SOP 推演没有逐腿开平价，这三项为「—」。主力开仓名义仓位按入场时 M 加镜像的全暴露计算，不混入后续加仓；峰值浮盈按每个时点的<strong>未实现盈亏 + 累计已落袋盈亏</strong>取最高值，镜像止盈落袋也包含在内；已平腿的落袋盈亏与已实现 P&L 用<strong>同一份平仓价校正</strong>、认领同一批成交记录，不会一边按校正后的价、一边按错记的价；本地有成交记录时，一条腿分几刀平掉（M 减仓、并仓后的镜像止盈），每一刀都计入峰值浮盈，各按自己的数量与平仓时刻进出；本地没有成交记录时（换了浏览器、清过历史成交），主力 / 镜像腿按 Leg 快照整条还原——按计划仓位从开仓持有到最后一刀，先平掉的几刀还原不出来，这台浏览器上的峰值浮盈可能高于实际峰值。已结束的战役从开仓扫到结束时间，但<strong>不早于最后一次平仓</strong>：结束时间记得比最后一次平仓还早的老战役（旧版结束对话框在东八区会把结束时间记早 8 小时；现在没动过「结束时间」一格就按确切的模拟时钟写入），扫到最后一次平仓为止，平仓时刻不明的腿也持有到那一刻——这类老战役的峰值浮盈、最大回撤与对冲精度会因此与之前显示的不同。<strong>逐仓爆仓的腿在权益路径上按保证金封顶</strong>：交易所是在破产价上把仓位收走的，账户在这笔仓位上亏掉的恰好是它的隔离保证金，破产价之下的价格从来不属于这条腿。封顶取<strong>这一刀自己结算掉的那笔钱</strong>（一个仓位由几笔成交并成时按各刀分摊，各刀相加正是整仓保证金）——不按「开仓名义 ÷ 开仓杠杆」估：合并仓位逐片估会超报（主力 0.3@100,000 + 加仓 0.2@110,000 的整仓保证金 2600，逐片估出 3740），持仓中途提过杠杆的仓位也会超报（记录里的杠杆恒为开仓杠杆）。不封顶时强平那根 K 线的影线会被算成好几倍于保证金的「最大回撤」（20 倍、保证金 1000 的多单在 0.8000 的影线上读出 4000，而钱包只少了 1000），这个数还会写进战役落库的最大回撤与 SOP 扣分。封顶<strong>只在强平所在的那根 K 线内生效</strong>：它是按仓位最终结构（杠杆、保证金、并进来的各刀）结算出来的数，对更早的 K 线不成立——中途提过杠杆、加仓之前的回撤都按真实浮亏算，不会被截浅。<strong>全仓强平不封顶</strong>：全仓拿整个钱包兜底，这条腿在更早的价位上确实可能亏得比最后结算的那一笔多（被别的标的拖爆时它甚至可能是盈利的），按结算值去封会把真实浮亏截掉。未实现部分会同时检查每根 K 线的最高价与最低价，并以同一价格重估当时仍持有的完整多空组合；分批平仓、镜像落袋和对冲拆除按各自时点切换状态，历史战役则从关联成交、Leg 快照与事件快照还原，同一个仓位只持有一次（按事件还原的腿已经以快照上了路径，描述同一笔成交的事件快照不再重复计入）；事件快照是归类那一刻的样子，按它还原的腿，平仓时刻与落袋盈亏取腿上的（归类时还没平、之后才补上，或归类之后改过成交记录的，都按腿上的，与已实现 P&L 同一份），腿上没有时才取事件里的；归类时还挂着、事件快照里既没有成交 id 也没有已实现的保护单从未成交，不持有；通过「记录决策」挂出的保护单，腿与事件里存的 id 其实是委托 id，本地委托记录显示它已撤单或仍挂着时同样按从未成交处理，本地查不到这张委托（换了浏览器）时无法判定，历史归类的仍按事件快照从挂出时刻持有到战役结束。杠杆优先读取主力 Leg，历史记录缺失时再从关联成交、战役初始字段或主力开仓事件回填。每个指标名旁的低透明度 <strong>i</strong> 图标都可点击，会折叠展开该指标的含义、公式和数据口径，不会挤压页面布局。这些数据与战役列表使用同一套公式：注意系统里有两个都叫「回撤」但含义不同的量：列表与详情显示的<strong>预期回撤</strong>是<strong>价格层面</strong>的（主力入场到对冲边界的距离 ÷ 入场价），而几何期望公式里的 <strong>x</strong> 是<strong>账户层面</strong>的下注比例，现已每场统一取 10%。卡片上的「仓位击穿」徽标仍按该场<strong>真实</strong>的下注比例（最大预期亏损 ÷ 账户总资产）判定：≥ 100% 代表这一注押上了全部本金。它评判的是当时的仓位大小，<strong>不进几何期望公式</strong>，也与本场实际盈亏无关，所以会和一个正的算术期望并排出现，这不是显示错误。预期回撤支持双向排序；算术期望的胜率统一取 50%；单场几何期望只看 bᵢ 与固定的 10%，不再需要开仓资产快照。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>点击 Legs 列表右上角的 <strong>PNG</strong>，会把<strong>战役原数据、盈亏概览、当前 K 线周期、已经拖动 / 缩放好的 K 线视图，以及完整 Legs 列表</strong>导出到同一张高清图片。周期会以「1分钟线」「5分钟线」「15分钟线」或「1小时线」写入图片。</li>
                <li><strong>盈亏概览分左右两栏，各自从上往下读</strong>：左栏是结果与仓位——已实现 P&amp;L、峰值浮盈、杠杆倍数、主力开仓名义仓位、最大预期亏损、本场 b 对 DSI/USI 的贡献；右栏是<strong>层层递进的一列</strong>——预期回撤、涨幅、涨幅效率、盈亏比、加仓效率、几何期望、算术期望，与战役封面、列表排序栏同序，上一项是下一项的分母或来源（涨幅效率 = 涨幅 ÷ 预期回撤，加仓效率 = 盈亏比 ÷ 涨幅效率，两个期望都由盈亏比推出）。左右同一行的两项始终齐平；屏幕窄时并成一栏，先左栏、再右栏。</li>
                <li>图片中的<strong>盈亏概览</strong>与详情页共用同一份指标清单与同样的两栏次序；以后详情页新增盈亏指标时，导出图会自动同步收录，并随指标数量自动增加高度。</li>
                <li>Legs 导出不受页面滚动区域限制；未滚动出来的腿、时间、价格、仓位、状态与委托信息也会完整展开。图片高度随内容自动增长。</li>
                <li>文件名采用「标的 + 战役日期 + profit / loss + 战役编号」，例如 <strong>BTCDOMUSDT 2025-07-24 loss 编号 C-…</strong>，便于批量交给 AI 分析时保持唯一对应。</li>
              </ul>

              <SubTitle>战役详情页：快照、评价与情绪 TXT</SubTitle>
              <P>战役详情页会按实际数据决定是否显示三个低对比度导出按钮；按钮不要求每条 leg 都有记录，只要本战役至少一条符合条件就会出现：</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>快照 TXT：</strong>只要任一 leg 有开仓快照，就导出该战役全部已记录的开仓问题与答案；一题一答，不因页面折叠或字段较多而截断。</li>
                <li><strong>评价 TXT：</strong>只要任一 leg 已完成平仓评价，就导出该战役所有已评价 leg 的完整题目与答案，包括决策质量的入场 / 持仓 / 离场三栏；每组题目与答案之间空一行，便于直接交给 AI 批量分析。</li>
                  <li><strong>情绪 TXT：</strong>战役操作日存在情绪日记时，导出当天事件记录及 POMS、PANAS、PI-7、HADS 量表结果，并和客观操作日期绑定。PI-7 报告 7–49 总分及 1.00–7.00 题目均分，全部正向计分，不设临床分界。</li>
                  <li><strong>情绪日记折叠：</strong>战役详情页的「操作日情绪日记」可以点标题左侧的箭头折叠。折叠状态记在本机浏览器、对所有战役生效，并且<strong>会带进 PNG 导出</strong>——折叠时导出图片只保留标题栏与「已折叠」标记，不画日记正文与量表，适合要分享盘面又不想附上私人记录的时候。情绪 TXT 导出不受折叠影响。</li>
              </ul>
              <Highlight>
                TXT 导出读取的是保存后的完整评价数据，而不是屏幕当前展开的几项。历史评价只有单一决策质量时，会按兼容规则回填三阶段后再导出，因此旧战役也不会漏掉决策质量答案。
              </Highlight>

              <SubTitle>战役详情页：盘面叠加层（可显示/隐藏）</SubTitle>
              <P>盘面下方有几个<strong>很隐形的小图标</strong>，用来按需开关叠加层，默认显示、可一键隐藏，避免信息互相打架：</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>
                  <span style={{ color: '#F0B90B' }}>黄色「委托空单」层</span>（眼睛图标）：只呈现这段战役里<strong>真正用于对冲的委托空单</strong>，不包含维多的多单，也不包含委托止盈挂单。挂单从委托时间开始画虚线；撤单时以 <strong>×</strong> 结束，仍挂单时虚线延续。若被触发，触发前保持虚线，触发后改为实线；实线只延续到这条对冲被手动拆掉的时间点，期间没有手动拆掉时才延续到战役平仓时间。每条委托空单都可单独隐藏，并可从「恢复」入口重新显示；原始盘面与反事实编辑器共用同一套委托数据。<strong>盘面以 Legs 为准</strong>：在同一根 K 线里挂出又撤掉（甚至同一秒挂撤）的委托也照画，至少占一根 K 线宽（起点在最后一根时往前让一根）——Legs 与委托管理区列出的每一张，盘面上都找得到。<span style={{ color: '#848E9C' }}>灰色淡虚线「他场委托」</span>是<strong>别的回放留下、在本场期间仍挂着（可能被触发）</strong>的委托空单：不进黄色层、不计入本场任何指标与 Legs 合计，同样受眼睛开关与管理区隐藏控制（管理区里单独列在「来自另一次回放」一组，标题分开数仍挂着与本场期间已了结的张数）；Legs 表下方与导出 PNG 各写一行淡注列出它们（每张各带仍挂着 / 已撤 / 已触发），不放进任何腿的行。
                </li>
                <li>
                  <span style={{ color: '#B080FF' }}>紫色「补齐 / Pure SOP」对照层</span>（眼睛图标）：把当前选中的反事实分支按标准 SOP 推演出的虚拟轨迹叠在真实盘面上；旁边的 <strong>ⓘ</strong> 图标展开标记说明（CF-M 主力、CF-A1~A6 加仓、CF-Ha/CF-Hb 初始对冲、CF-Hr 滚动对冲、CF-TP 镜像止盈、CF-Exit 平仓）。每个分支独立记忆显示 / 隐藏状态：隐藏某一条分支不会连带隐藏其他分支；早期自动生成的「补齐 X」修正分支不再出现在已保存列表里，也不会被默认选中。紫色是<strong>虚拟推演、不是真实成交</strong>。
                </li>
              </ul>
              <Highlight>
                黄色对冲层同时包含反向委托与已实际开出的手动对冲；手动对冲从实际开仓价、开仓时间画到平仓时间，与 Legs 共用编号，也能独立选中、隐藏和恢复。两类都没有时不显示开关。
              </Highlight>

              <SubTitle>战役详情页：反事实推演与偏离代价</SubTitle>
              <P>
                战役详情页可以做<strong>「如果当时换一种打法会怎样」</strong>的反事实推演。在「Legs 副本 · 手动反事实」里改任意一条腿（开 / 平时间、价格、仓位，删除或增添），点<strong>「一键运行」</strong>，系统用这段战役的真实 K 线、按主图当前的 K 线周期把调整后的 Legs 跑一遍。
              </P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>结果以<strong>「反事实盈亏概览」</strong>面板呈现：与上方「盈亏概览」同一份 13 项指标（左栏：已实现 P&L、峰值浮盈、杠杆倍数、主力开仓名义仓位、最大预期亏损、本场 b 对 DSI/USI 的贡献；右栏：预期回撤、涨幅、涨幅效率、盈亏比、加仓效率、几何期望、算术期望）、同一条期望口径脚注。结果占一行，与上方「战役元数据 | 盈亏概览」同一套分栏：<strong>右栏的面板与上方「盈亏概览」同样大小、内部排布逐项相同</strong>（两栏并排时同宽，面板里只有标题、12 项与脚注）；左栏是<strong>「相对原始的变化情况」</strong>，列出「相对实际 ±… USDT」、逐腿改动说明（没改就写「与原始 Legs 无差异」）与这次运行的 K 线信息（运行时刻、周期与根数、起止时间），卡片顶部放操作按钮（宽屏时在标题右侧，窄屏时折到标题下方）——未保存时是分支名、「保存」「丢弃」，已保存分支是「载入到 Legs 副本」「删除」。屏幕窄时两栏上下叠放，「相对原始的变化情况」在上。<strong>不改一格直接运行，面板复现上方「盈亏概览」</strong>：已实现 P&L、最大预期亏损、预期回撤、杠杆、主力开仓名义仓位、盈亏比（以及由它推出的各项）都相同，相对实际 +0.00；峰值浮盈在同一 K 线周期下也相同，只有一个例外——<strong>进行中的战役</strong>，上方的权益路径只扫到最晚一条成交记录为止（本地一条成交记录都没有时——换了浏览器——只到开仓那一刻），在那之后的持仓（还没平的腿、只剩复盘快照或事件快照且在那之后才平的腿）上方看不到，副本照常持有（还没平的腿持有到最后一根 K 线），两边峰值可能不同。做法是副本里每条腿都带着它的实际成交：没改过的腿直接取实际结算值——与上方同一份平仓价校正、同一份手续费（成交记录的盈亏已扣平仓手续费；开仓手续费开仓时从钱包扣走，两边都不在已实现里扣），只剩复盘快照的腿取快照（手续费已含在快照里、金额未知，说明里单列；改过这些腿时，平仓手续费的变化按模拟器 Taker 费率扣进它们的盈亏，同样不计入「已扣平仓手续费」那个数），实际结算没有计入的腿（既无成交记录也无复盘快照，如尚未平仓）记 0；本地有成交记录时，<strong>分几刀平掉的腿按每一刀还原</strong>（M 减仓、主力与镜像并仓后镜像止盈按比例减仓，都是一条腿好几刀），每一刀按自己的成交价、数量与平仓时刻进出权益路径（本地没有成交记录时与上方一样按 Leg 快照整条持有）；Legs 表里这条腿显示的那笔成交被另一条腿认领了的（例如主力的最后一刀后来又作为回填的加仓腿归进同一场），开平时间与价格取这条腿自己认领到的收盘那一刀，与上方同一段；主力开仓名义仓位与上方同一份——按同一笔开仓成交并组、只计一次（含市价滑点），并进主力仓位却没有腿的加仓不算（它的盈亏照样算进已实现与峰值），「仓位」一格仍显示 Legs 表的委托名义；止损线也与上方同一份——初始对冲按委托价、不按滑点后的成交价，同一角色挂了几张时按挂出时刻取第一张，并读这场战役的反向保护委托（历史归类的战役只认委托快照）与事件流里带价的初始对冲事件；几笔主力先后开时，每张保护单归哪一笔主力也与上方相同（有成交记录的腿按成交时刻、没有的按挂出时刻，主力按各自的持仓窗口）；本地没有成交记录、事件流里也没有触发时刻或历史快照的对冲，与上方一样不进权益路径（已实现照计）；有触发事件的按触发时刻持有，触发后又撤单的老对冲按撤单时刻放下；历史归类的战役在本地没有成交记录时，主力 / 镜像按 Leg 快照持有，其余只在事件快照里的腿按事件里的成交价、数量与开仓时刻持有（不取腿上的委托快照），平仓时刻与已实现取腿上的（归类之后补上或改过的也算），与上方同一段。<strong>一条腿都结算不了</strong>（换了浏览器、云端水化没跑完，上方的已实现取自事件流或落库缓存）时，副本把这个总额摊到成交过的腿上（先按各腿开平价估一份，余差记在主力上），原样重跑同样复现，改一格仍只挪这一格的钱。<strong>改过的腿从实际结算值出发，只加上这次改动本身值的钱</strong>：按改后的开平价、仓位重算这一刀的毛盈亏与平仓手续费（费率用这笔成交记录自己的，老记录按当时实收的费率），减去按原开平价算的同一个数；平仓价、平仓时间两格改的是最后那一刻平掉的全部（与收盘那一刀同一时刻平掉的刀——比如并进同一个仓位、一起平掉的加仓——一起平移），更早平掉的刀维持实际成交（副本在平仓价下方列出「另有 N 刀先平」）。新增的腿、切成「已成交」的挂单，以及改过的未平仓腿，按调整后的价格算毛盈亏，再按模拟器的 Taker 费率扣平仓手续费（币本位战役里新增的腿按币本位收费）。所以<strong>「相对实际」只反映你的改动</strong>，不会把引擎的口径差、滑点或老费率当成原始错误的代价。<strong>被交易所强平的腿</strong>在副本里挂一枚红色「爆仓」标记、平仓价与平仓时间两格锁死（那是交易所在强平价上的动作，不是决策），逐仓强平的盈亏按各刀在破产价上结算掉的那笔钱封顶（改「仓位」一格时按同比例缩放，全仓强平不封顶）——与上方权益路径同一条封顶；本次改动之前存下的分支载回来时也按当前 Legs 补上这件事。原本<strong>从未成交的腿</strong>（与上方峰值浮盈同一条判据：没有成交记录、没有复盘快照、事件流里也没有触发时刻——历史归类时还挂着的保护单，事件快照里只有委托价、既没有成交 id 也没有已实现，同样算；腿上存的是委托 id、本地委托记录显示它已撤单或仍挂着的，也算，本地查不到这张委托时与上方一样按成交处理；初始对冲、滚动对冲在 Legs 表里显示为「挂单中」，回场对冲、独立单在 Legs 表里显示为「进行中」，判据相同；只有从日志归类时还挂着的保护单，页面装配时给它补上了战役结束时刻作平仓时间，Legs 表会显示「已平仓」，副本仍按从未成交标「挂单中」）在副本里带一枚「挂单中」小标签：它不计入持仓与已实现（与上方峰值浮盈一致），但仍留在推演里当止损线，最大预期亏损、预期回撤照样由它定义；旁边的「未成交 / 已成交」开关可以模拟它成交（盈亏按你填的开平价与模拟器费率算），切换算一次改动，写进改动摘要；挂单的平仓时间只是兜底，不算改动（已结束的战役里，平仓时间只是兜底的腿收在上方扫描窗口的终点——结束时间，但不早于最后一次平仓）。<strong>本次口径统一之前保存的分支</strong>，已实现是未扣手续费的毛盈亏、挂单也按成交计入、分几刀平掉的腿按整条腿平在最后一刀，指标说明里会标出来，相对实际因此多出手续费；载回 Legs 副本时，每条腿都按当前原始 Legs 补上实际成交结果（含分刀）与「挂单中」状态——换了 K 线周期也认得出没动过的挂单与未平仓腿的兜底平仓时间，老分支把有触发事件的对冲记成挂出时刻开仓的，也换回触发时刻；进行中的战役 K 线窗口往后长了，未平仓腿、切成「已成交」的挂单的兜底平仓时间同样跟着换，不算改动——这靠分支运行时记下的改动摘要（摘要里没改平仓时间，就按当前的值）；更早、没有记下运行时 K 线周期与改动摘要的分支，在进行中的战役里仍可能把未平仓腿的兜底平仓时间读成一次改动；老分支里改过价的挂单仍按成交处理，开关停在「已成交」，可以随时切回——重新运行即可得到同一口径的读数。三处口径差异要记住：峰值浮盈在手动 Legs 分支与上方「盈亏概览」同一算法（每根 K 线内按各腿开平时点逐个还原持仓状态，再用最高 / 最低价重估），但只按本次运行时的 K 线周期算，换了周期读数就可能不同，SOP 推演分支则只在每根 K 线收盘价上重估、峰值可能偏低；手动 Legs 里没有初始对冲 A/B 时读不到止损线，最大预期亏损、预期回撤、涨幅效率、盈亏比、加仓效率、算术 / 几何期望这些由 L 派生的项留空「—」而不是印 0；DSI/USI 贡献是假设值，本场反事实并不在账户样本内。</li>
                <li>刚运行的结果<strong>未保存</strong>：面板标题带「未保存」，在左栏「相对原始的变化情况」里起个名字（≤ 20 字，默认由改动摘要 + 运行时刻生成，如「主力开仓 平仓价 09-16 14:30」）点「保存」才落库；「丢弃」则什么都不写。</li>
                <li>已保存分支逐行列出名字、改了什么、保存时间、分支 P&L 与相对实际；点一行就在下方展开同样的一行：右栏「反事实盈亏概览 · 名字」是同一套指标，左栏「相对原始的变化情况」另写分支类型（推演分支带 SOP 分数）与保存时刻。概览下方会直接显示该次运行自己的<strong>「反事实 Legs」</strong>只读表；它与页面上方未经反事实的「Legs 列表」复用同一张表，列序、列宽、冻结角色列、阶段展开、贡献 / 盈亏、Δb、开平价、涨跌幅、币量 / 仓位、占比、加仓校验、手续费、委托、操作及合计行完全一致，只替换成该反事实分支的数据；反事实没有的真实操作时刻或真实委托保持空白，不伪造。未保存的运行结果同样立即显示。可以在那里「删除」，也可以「载入到 Legs 副本」把那条分支的腿载回编辑器继续调整、再次运行。载入或手改的腿只在战役的 Legs、成交记录或平仓价校正变化时才会被重置回原始腿，点「保存备注」不会。分支与对应战役永久绑定，刷新或重新进入仍会出现，只有主动删除分支或删除整场战役才会消失。</li>
                <li>反事实的主力锚点<strong>以你的真实成交价 / 成交时间为准</strong>；被选中的 Pure SOP / What-if 推演分支仍以紫色轨迹叠在真实盘面上对照。</li>
                <li>反事实盘面以原始战役的 K 线、真实事件标记、竖线、区间线和委托空单为只读背景，再叠加紫色虚拟轨迹；不会为了显示反事实而丢掉原始盘面信息。它与原始盘面共用完整的 51 倍数据范围和快捷档位，但默认从 <strong>1.1 倍</strong>开始，在完整战役内容外保留少量上下文。</li>
                <li>下方「Legs 副本 · 手动反事实」是<strong>可编辑</strong>的：像原始 Legs 一样先把全部腿纵向展开，不在表内再做一层竖向滚动；辅助盘面放在 Legs 之后。表格逐格可改，盘面竖线也可拖动并同步回写，改完直接「一键运行」；「还原 Legs」回到原始战役的腿。</li>
              </ul>
              <P>原始与反事实 Legs 在「平仓价」右侧都有<strong>操作方式</strong>：上行开仓、下行最后一笔平仓，以「手动（开）」「自动（平）」等形式对齐显示，括号弱化。<strong>只突出手动对冲的开仓</strong>，其他操作保留但使用中性色。主力开仓（含再入场主力）按业务约定显示手动；真实成交缺少操作方式时，也按你确认的口径显示手动，但不改写原始来源字段，已有自动委托记录不会因此改成手动。镜像止盈按专门规则：<strong>开仓显示自动，实际平仓比例严格为 60% 时显示自动，非 60% 时显示手动</strong>。比例以该镜像所属开仓组的成交数量为分母，不以整场战役为分母，不把 59.99% 四舍五入成 60%；缺少可靠分组或数量时不猜比例，沿用成交方式或上述手动显示口径。反事实新增腿、未成交委托、修改后的模拟成交不套用真实成交的缺记录口径；未改动的实际成交沿用原始规则，镜像数量改动后也不冒用实际开平方式。</P>
              <P><strong>复盘总结</strong>位于偏离明细上方，可自由填写并保存到本战役，重新进入仍可查看。四条可点击提示分别涉及加仓后硬拆已触发对冲、止损线太浅、无视负向信息强行入场持有或加仓、对冲触发后疏于处理导致爆仓；它们仅帮助回忆，不自动认定本场有这些问题，也不自动生成规则。</P>
              <P><strong>偏离代价明细（手动调整 vs 原始）</strong>默认折叠，点击标题展开；折叠不会清空已经填写的备注。它把你手动调整后的 Legs 与原始战役逐腿对比，把原始错误折算成钱：</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li>每行 = 一条盈亏有差异的腿：代价 = 调整后腿盈亏 − 原始腿盈亏，两边都是与已实现 P&L 同一口径的净额（没改过的腿都取实际结算值，代价恰为 0；改过的腿代价恰是这次改动值的钱，不夹带滑点、分刀或老费率的差额；挂单中的腿两边都记 0，老分支换了 K 线周期也不会把没动过的挂单读成改动）；新增的腿按调整后盈亏计，删除 / 停用的腿按 −原始盈亏计。合计 = 手动调整总盈亏 − 原始总盈亏 = 原始错误的总代价。</li>
                <li><strong>代价 (USDT)</strong> 与 <strong>占本场盈亏 %</strong>（以本战役实际总盈亏的绝对值为分母）由引擎自动算出。</li>
                <li>「违规阶段 / 违规描述 / 修正后」三列<strong>可手动改写</strong>，点「保存备注」后写入该战役记录；再次进入这场战役仍会保留。</li>
                <li>只要填写了「修正后」，保存时系统会把这条内容连同「违规阶段 / 违规描述」汇总成一条<strong>战役偏离规则</strong>，自动写入复盘中心的「规则」页；重复保存同一条规则不会重复创建。</li>
              </ul>
              <Highlight>
                这张表是系统对执行最锋利的一刀：总代价很小说明这场偏离基本无害；一旦很大（例如超过账户的 1%），就该把对应违规升级成开仓前 checklist 的强制规则。系统会先把它写成核心 checklist 规则；你再到规则页判断是否需要升级为必填或硬规则。
              </Highlight>
            </section>

            <section id="s4-5" className="scroll-mt-20">
              <SubTitle anchor>4.5 规则</SubTitle>
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
                  <tr><td className="px-3 py-2 border-t border-border">自然日未练习</td><td className="px-3 py-2 border-t border-border font-mono text-[#F6465D]">-2000</td><td className="px-3 py-2 border-t border-border"><strong>头号大罪</strong>：一整天没有任何练习动作；无正向镜像、<strong>永久不可逆</strong>——后续再练也不退这笔，按模拟时间的自然日结算</td></tr>
                </tbody>
              </table>
            </div>
            <P>四个类目里，前三个都是<strong>奖励</strong>：完成评价 +1000、决策记录 +600、建战役 +300。做了给分，<strong>没做不倒扣</strong>——原先与它们成对的三项扣分（未做评价 −1000、直接交易 −600、未建战役 −300）已经取消，历史记录也一并撤销退分。唯一的扣分是第四项「自然日未练习 −2000」：它没有正向镜像、独占一档且最重，因为练习是一切样本的源头，<strong>断更是头号大罪</strong>。</P>
            <P>为什么只留这一条扣分：其余三项罚的都是「这一次做得不够好」，而那种事后再补就能补回来的缺口，用<strong>拿不到奖励</strong>来表达就够了，再倒扣一次是重复计价。断更不一样——它罚的是「这一天根本没发生」，那是补不回来的。所以这页想拉高的不是总分，而是让每次「做」都落到加分那侧、且<strong>每天至少留一次练习</strong>。</P>

            <SubTitle>什么算、什么不算</SubTitle>
            <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
              <li><strong>只记做多开仓。</strong>做空都是辅助对冲单，属于风险管理动作，不计执行力分。</li>
              <li><strong>挂单成交才计分。</strong>挂出限价单只是意图，真正成交才算“做”——意图不计分，执行才计分。</li>
              <li><strong>“当天已练习” = 下单 / 弃单（太难不做）/ 完成复盘，任一即可。</strong>只要当天留下其中任一动作，就清掉当天的“未练习 −2000”——练的是决策周期，不是必须下注。</li>
              <li><strong>平仓评价：做 +1000，不做不扣。</strong>系统按 journal ID 识别，反复编辑不重复计分。没做的那些不再挂 −1000——待复盘清单本身就是提醒，扣一次分只是把同一件事再说一遍。</li>
              <li><strong>“未练习”扣分永久不可逆、且最重（−2000）。</strong>某个自然日没有任何练习，就永久记一笔 −2000，后面再怎么练、再盈利都不退这笔——单笔亏损能被后续盈利覆盖，断更不能。按模拟时间的自然日结算。</li>
              <li><strong>直接交易不再扣分。</strong>它只是<strong>拿不到</strong>决策记录那 +600，而不是倒扣 600。直接交易的笔数仍然统计，用来算「决策记录占比」——那是给你看的诊断，不是罚单。</li>
              <li><strong>四项各自独立计分、互不联动。</strong>战役是「计划层」结构、决策记录是「每单层」结构，两者分别度量，不互相抵扣。</li>
              <li><strong>历史按同一把尺重算。</strong>旧数据首次加载会按当前权重重算一次；<strong>已取消的三项扣分会从流水里整条删除、总分同步退回</strong>——不是记成 0 分留在明细里，否则你会以为系统还在算那笔账。</li>
            </ul>
            <RedHighlight>
              执行力资产不判<strong>单笔对错</strong>——一笔亏损的决策单照样 +600；但它判你做得<strong>有没有结构</strong>：带着快照 / 战役 / 评价去做加分，无结构地乱下则拿不到分，干脆不练才扣分。对错（质量）交给复盘中心（错题集 / 结构成熟度 / 规则）去判，这里管的是<strong>做得够多 × 做得有结构</strong>。它专治的是那种更隐蔽的失败——<strong>因为怕错而不做</strong>：在一个下限已被焊死的系统里，不做，往往才是最贵的那个错误。
            </RedHighlight>
          </section>

          <section id="s7" className="scroll-mt-20">
            <SectionTitle accent="#F6465D">7. 数据边界与硬约束</SectionTitle>
            <P className="mb-3">这一节的每一条硬约束，本质上都在做同一件事：把<strong>下限</strong>钉死。它们不决定你能赚多少，只确保最坏情况发生时，你依然亏得起、活得下来——上限可以敞开，正是因为下限不会被击穿。<strong>别把它们读成“风控”或“防守”：恰恰相反，下限被焊死，才是你敢多下、敢让每个赢家跑得更肥的前提——纪律的终极目的是进攻，不是防守。</strong></P>
            <div className="guide-stack">
              <P><strong>主力单与对冲单必须分开理解。</strong> 主力单评估方向与机会质量；对冲单评估风险管理。把两者混在一起，会污染 R 倍数、胜率和错误类型统计。</P>
              <P><strong>最大亏损是 R 倍数的分母。</strong> 它表达的是本次愿意承受的最大错误成本，不应被事后修改成更好看的数字。</P>
              <P><strong>全仓是硬阻断。</strong> 系统训练阶段只允许逐仓。全仓会把单笔错误扩散到账户整体，违背“损失有界”的底层原则。</P>
              <P><strong>平仓评价是硬阻断。</strong> 已平仓交易未完成入场 / 持仓 / 离场三阶段决策质量、证伪核对与必要叙事前，不能开下一笔新仓；结构 × 结果四象限由三阶段结论与最终结果自动归纳。</P>
              <P><strong>低心态是硬阻断。</strong> 心态 ≤2 分时不能开仓，不提供“我知道但继续”的后门。</P>
              <P><strong>后见偏差必须隔离。</strong> 复现页在归因完成前隐藏后续走势，归因完成后才揭示行情路径。</P>
              <P><strong>历史回填不等于真实快照。</strong> 回填可以恢复交易结构，但无法恢复当时的理由、心态和风险认识。系统不会假装知道这些缺失信息。</P>
              <P><strong>账户资产与钱包划转。</strong>顶部「预估总资产」是<strong>三个钱包的合计</strong>：合约（Futures）、现货（Spot）、资金（Funding）。合约钱包的<strong>可用</strong>是自由现金，被持仓占用的保证金与未实现盈亏计入「冻结」，<strong>划不走</strong>——这与币安一致。点「划转」按币安的逻辑在三个钱包之间搬钱：选来源与目标（选成同一个会自动交换）、可一键「最大」、即时到账、不收手续费。<strong>划转不改变账户总资产</strong>，它只改变钱分布在哪个钱包，因此不会影响资产曲线、今日盈亏与任何战役指标。「添加资金」「转出」对应真实出入金，模拟盘不提供，按钮置灰。</P>
              <P><strong>账号数据跟人走，不跟浏览器走。</strong><strong>持仓、成交历史（含资金流水）、挂单与已撤单、余额、各币时间线、杠杆 / 保证金模式 / 结算模式、图表画线与指标、信号库、认知盲区、情绪日记本地镜像</strong>等全部引擎状态，除本地存储外还会<strong>自动镜像到账号的云端存档</strong>：操作后约 1.5 秒内推送（时间线心跳类合并到 20 秒一批），切走页面或关闭标签时立即冲刷。换一个浏览器登录同一账号，进入交易页前会先看到「同步账号数据」——云端存档水化完成后，所有记录原样恢复。两边都用过的浏览器以<strong>更新的一方为准</strong>，不会用旧数据回滚新操作。离线或同步失败时照常可用，数据仍在本地，恢复联网后自动补推。<strong>账户资产</strong>不单独存储——它由初始资金（服务端）＋余额＋持仓＋成交历史实时推导，这四项都在同步范围内，因此资产总额、今日盈亏与资产曲线换浏览器后自动一致。</P>
              <P><strong>K 线是流式供给的，有边界就会停。</strong> 开局先取锚点前 1000 根历史 + 1000 根前瞻缓冲，播放接近边界时自动预取下一批（正放取更晚、倒放取更早）。取到尽头会<strong>自动暂停并提示</strong>，而不是让时钟继续空跑——盘面停住时看一眼提示，那是数据到头，不是卡顿。高倍速消耗很快：3m 周期 180 倍速恰为 <strong>1 根 / 秒</strong>，1m 周期 3600 倍速达 <strong>60 根 / 秒</strong>。因此预取阈值不再是固定根数，而是按<strong>余量秒数</strong>算（正放留 16 秒、倒放留 8 秒），倍速越高提前量越大；在所有旧倍速下算出来的仍是原来的 240 / 120 根，一根不差。</P>
              <P><strong>1800x / 3600x 有两个看不见的代价，先知道再用。</strong> 其一，<strong>强平判据是按真实时间采样的，不看 K 线高低点</strong>：每 250 毫秒真实时间取一次标量价，1800 倍速下相邻两次相隔 7.5 模拟分钟，3600 倍速下相隔 15 模拟分钟（1m 周期即 15 根 K 线）。止盈止损与条件单是逐根撮合的，强平不是，所以极高倍速下可能出现「止损按影线成交、强平没看到同一根影线」。其二，<strong>每次「启动」都会把倍速重置回 1x</strong>，需要重新选择——这是为了避免上次的 3600x 在你还没看清盘面时就跑起来。</P>
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
                    <td className="px-3 py-2 border-t border-border font-medium">交易偏好（右上角 ⋯）</td>
                    <td className="px-3 py-2 border-t border-border">下单面板右上角的 <strong>⋯</strong> 打开抽屉，页面树与币安一致，分 <strong>交易偏好</strong> / <strong>界面设置</strong> 两个页签。<br />· <strong>默认交易设置 → 默认杠杆和保证金模式</strong>：可开启「应用默认杠杆」并设定 1–50x 与默认保证金模式，点「确认」才生效（草稿式，与币安相同）。默认杠杆超过某个币对的最高杠杆时，在该币对上按它的最高杠杆生效（币安按合约分层；同一个币的 U 本位与币本位各按各的上限）。<strong>只对尚未访问过、且当前无持仓无挂单的币对生效</strong>——已建仓的标的不会在背后被改动风险参数。注意即便这里选了全仓，下单时仍会被硬阻断：训练阶段强制逐仓。<br />· <strong>默认交易设置 → 默认触发类型</strong>：最新价格 / 标记价格，改完即同步到下单面板的触发价判定。<br />· <strong>下单确认</strong>：按八种订单类型分别开关二次确认弹窗。决策记录模式本就强制下单前快照，不受此开关影响。<br />· <strong>仓位模式</strong>：本系统默认双向持仓——主仓做多 + 对冲做空必须能并存，切成单向会让对冲腿无处安放。<br />· <strong>界面设置 → 模块显隐</strong>：只列真能藏的两个（订单簿、P_gap 优势边际），与页内的关闭按钮是同一个状态，刷新后保留。图表 / 下单 / 仓位是交易页骨架不可隐藏，「最新成交」「保证金比率」本系统没有对应模块，因此不列。配色全局锁定绿涨红跌，以免历史截图与复盘记录里的红绿含义前后不一致。<br />· <strong>冷静期</strong>在「高级设置」里（原先挂在面板顶部，已收进抽屉）。<br />· <strong>历史消息</strong>在抽屉首页最下方：成交、触发、资金费结算、报错等提示<strong>默认不再弹出</strong>（原先弹在屏幕右上角，会盖住时间机器的倍速条与模拟时钟），一律记在这里，按真实时间倒序，最多保留最近 300 条，点开即视为已读。未读条数显示在 <strong>⋯</strong> 按钮的角标上，有未读报错时为红色。想恢复弹出，到「通知设置」打开「在屏幕上弹出提示」。爆仓仍以独立弹窗告知，不受此开关影响。<br />· 账户模式 / 资产模式 / 价差保护 / 涨跌幅与图表时区等本系统无对应功能的页面照样能打开，里面写清了币安在此做什么、以及本系统为何不适用——不是漏做。</td>
                    <td className="px-3 py-2 border-t border-border">与币安同构，便于迁移习惯。注意本系统训练阶段<strong>强制逐仓</strong>：即便把默认保证金模式设为全仓，下单仍会被硬阻断。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">订单类型（币安式三槽）</td>
                    <td className="px-3 py-2 border-t border-border">常驻 <strong>限价 | 市价 | 高级槽</strong> 三个标签；高级槽显示当前选中的高级类型，下拉五项（条件委托 / 跟踪委托 / 只做Maker / TWAP / 分段订单）对当前项打勾。止盈止损不占标签位，用限价 / 市价表单里的勾选组合。<strong>五种高级类型都是真实执行</strong>：条件委托触发价成交；<strong>跟踪委托</strong>按币安语义——卖出方向追踪最高价、从峰值回撤「回调率」即市价成交，买入方向对称追踪最低价，可设激活价（触及后才开始追踪）；<strong>TWAP</strong> 在总时长内按模拟时间均匀分批市价成交（切片间隔自动 ≈ 总时长 ÷ 20，最短 1 分钟）；<strong>分段订单</strong>在起始价与终止价之间均匀铺出指定张数的限价单。</td>
                    <td className="px-3 py-2 border-t border-border">与币安的下单区同构，训练动作可以直接迁移。跟踪委托同一根 K 线内先按有利端点推进极值、再用不利端点判触发——宁可早触发，不做乐观回测。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">数量单位</td>
                    <td className="px-3 py-2 border-t border-border">点数量框右侧的单位即弹出<strong>单位偏好</strong>浮层（贴着数量框，与币安同位置），两张卡片：<strong>卡片一</strong>是标的自身的计量单位（U 本位 → 币，币本位 → <strong>张</strong>，1 张 = 固定 USD 面值）；<strong>卡片二</strong>是保证金资产（U 本位 → USDT，币本位 → 该币），内含常驻的<strong>「订单金额 / 初始保证金」</strong>两个子选项。默认落在<strong>卡片二的「订单金额」</strong>——币本位即该币的订单金额、U 本位即 USDT 订单金额，量纲与该模式的保证金资产一致；「张」与「初始保证金」留给需要时手动切换。换标的或切结算方式时自动回到这个默认并清空输入。</td>
                    <td className="px-3 py-2 border-t border-border">币本位下把数量默认成 USD 会让单位与标的脱节。另需留意：单位下拉里还有「<strong>◯◯ 保证金</strong>」一项，那是<strong>按保证金输入</strong>而非按数量——标签特意带上「保证金」三字，避免与数量混淆（在该模式下输入 500 万，意思是投入 500 万枚币作保证金，按杠杆放大后名义可达数千万）。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">持仓卡的「持仓数量」</td>
                    <td className="px-3 py-2 border-t border-border">币本位持仓在张数后面补一个<strong>按标记价折算的持币数量</strong>，形如 <strong>13291 张 ≈ 284,702.0065 RAVE</strong>；U 本位不变（它的数量本来就是币量）。悬停给出折算式：名义 USD ÷ 标记价。价格暂时取不到时只显示张数，不编一个币量出来。</td>
                    <td className="px-3 py-2 border-t border-border">反向合约的面值锁死在 USD 上，<strong>持币数量随价格浮动</strong>——只显示张数的话，「我现在到底拿着多少币」每次都得自己心算。折算口径与同一张卡上的标记价、保证金比率一致。<strong>持仓按标记价、挂单按它自己会成交的价</strong>——两者不同源，这是刻意的：持仓已经在市场里，挂单还没有。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">当前委托的「数量」</td>
                    <td className="px-3 py-2 border-t border-border">币本位挂单的币数，按<strong>这一单真正会成交的那个价</strong>折算，并在张数那一行写明口径（按<strong>委托价</strong> / <strong>触发价</strong> / <strong>现价</strong>折算）。逐型：限价 / 限价止盈止损 / 只做Maker / 分段子单 → 委托价；<strong>条件委托（含止盈止损单）→ 触发价</strong>；<strong>跟踪委托 / TWAP / 市价止盈止损 → 现价</strong>。减仓单还会写出<strong>成数</strong>（如「100% 仓位」）：它按触发价折，主读数会比按标记价折的持仓卡小一截，不写成数容易被误读成部分平仓。<strong>TWAP 按剩余量显示</strong>，并单列「剩余 X / 总 Y」——切片引擎只累加已成交量、从不递减挂单量，此前一张走完九成的 TWAP 与一张还没开始的长得一模一样。下单面板的「实际下单 N 张 ≈ …」用的是同一个价，所以输入框、提示、委托列表三处永远是同一个数。</td>
                    <td className="px-3 py-2 border-t border-border">此前一律按<strong>下单那一刻的市价</strong>折算：触发价 0.010344、市价 0.011199 的那张条件单，屏幕上写 892.96 NOM，而它成交时给你的是 966.744006 NOM——差 8.27%，且永不收敛，因为它是拿一个<strong>永不发生的价</strong>算出来的。张数也一样被它定：填 3600 个币会下出 4 张，那 4 张到触发价上是 3866.98 个币，多出的 267 个你从没批准过。<strong>跟踪委托那行输入是「激活价」不是触发价</strong>（成交价 = 极值 ×(1∓回调率)，挂单时不可知），TWAP 的两个价都是 0，所以这两类如实退回<strong>现价并标注</strong>——标签只声称「按此刻的市价，这一单相当于多少币」，不假装那是成交价；拿激活价去折出来的数才会被读成成交价，而它永远不是。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">「止盈/止损」勾选框</td>
                    <td className="px-3 py-2 border-t border-border">勾上它<strong>不改变订单类型</strong>：市价单仍然当场成交、限价单仍然挂在你写的委托价上、条件单的触发价仍然是你填的那个。两个保护价随单带着，<strong>成交那一刻</strong>才变成挂在这笔仓位上的减仓单（与持仓卡上的「止盈/止损」按钮造出的是同一种东西）。方向校验参照的是<strong>这笔仓位的开仓价</strong>，不是此刻的盘口，并且<strong>在下单时就拦</strong>——那是你还能改的最后一刻；成交时再查一遍作兜底，若某一腿方向不对，<strong>只丢那一腿</strong>并弹出提示，另一腿照挂。<strong>分段订单 / TWAP / 跟踪委托不支持</strong>随单保护单，勾选框在这三类下直接置灰。</td>
                    <td className="px-3 py-2 border-t border-border">此前勾上它会把类型改写成「限价TP/SL」「市价TP/SL」，并把<strong>止盈价塞进开仓触发价</strong>——触发价那行输入在市价/限价标签下根本不渲染（类型是提交那一刻才合成的），所以一定会兜到止盈价上。后果是：<strong>市价单不再立刻成交，而是挂在止盈价上开仓</strong>；限价单则要等价格先摸到止盈价才肯激活。开仓价与保护价从此分开存，不再共用一个字段。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">保证金不足时的委托</td>
                    <td className="px-3 py-2 border-t border-border">挂单<strong>不预留</strong>保证金（与真实交易所不同），所以下单时那道「可用余额不足」是一次<strong>检查</strong>、不是一次<strong>冻结</strong>。成交那一刻会再查一次：付不起就<strong>当场撤销并留痕</strong>（进「已撤销」记录，战役页照样看得到这条腿），并弹出提示写明差多少。绝不缩量成交——填进去的数是授权上限，缩量还会把绑在这笔仓位上的减仓单和战役的初始风险锚一起弄脏。</td>
                    <td className="px-3 py-2 border-t border-border">此前成交点<strong>一次都不查</strong>：余额 100,000 配两条各需 60,120 的条件单，下单时各自都过，同时触发就扣成 <strong>−20,480</strong>。负余额之后没有任何东西把它捞回来——<strong>有全仓仓位</strong>时它会把全仓权益自己拖到 0 以下，下一跳强平所有标的的全仓仓位并清空全部挂单；<strong>只有逐仓仓位</strong>时那一支根本不跑，负余额永久留在账上、还同步进云端，此后每一笔下单都被「可用余额不足」永久拒掉。分段订单与 TWAP 更是连下单时那道检查都绕过了，现在一并补上。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">合并持仓卡的强平价与追加保证金</td>
                    <td className="px-3 py-2 border-t border-border">同标的同方向的多笔仓位会并成一张卡。卡上的<strong>强平价格（最先）</strong>写的是这组里<strong>最先被强平</strong>的那一笔的价格——多单取各笔中最高的，空单取最低的；逐仓的多笔卡上，<strong>保证金比率（最高）</strong>写的是同一笔（比率最高 = 离强平最近），悬停里给出整组合计那个数，并说明逐仓保证金不在各笔之间共用。全仓照旧写合计——那本来就是一个共用的保证金池。<strong>「+」调整保证金在合并卡上一直可用，合并几笔都一样</strong>：追加按各笔名义等比摊分，减少按各笔<strong>还能减多少</strong>等比摊分，减到各自的开仓保证金为止。整组一次写完，按仓位 id 定位。分组只按标的+方向、<strong>不含保证金模式</strong>，所以全仓腿会并进同一张卡——此时按钮照常可用，<strong>只对其中的逐仓腿生效</strong>，并在弹窗里写明有几笔全仓未计入。整张卡都是全仓时按钮置灰保留并给出原因：全仓共用一个保证金池，单仓位追加在机制上不存在。</td>
                    <td className="px-3 py-2 border-t border-border">逐仓爆仓是<strong>逐仓位</strong>判的，先死的是最弱的那一笔。此前卡上显示的是把总量、总保证金、加权均价拼成一笔<strong>虚构仓位</strong>算出来的价，既不是最先也不是最后：一张 104,933 张、均价 0.147257、现价 0.154646 的卡显示 0.134361，而真正先爆的一腿在 <strong>0.142494</strong>——卡说还有 13.1% 空间，<strong>实际只有 7.9%</strong>，低估的余量是现价的 5.26%。另外两件一并修掉：币本位的「减少保证金」<strong>从开仓那一刻起就是死的</strong>（可减额恒为 0，地板取错了字段），以及模态框里的「预估强平价」<strong>对币本位恒等于当前值</strong>（它只改了一个强平公式根本不读的字段）。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">同向仓位合并</td>
                    <td className="px-3 py-2 border-t border-border">同标的、同方向、<strong>同杠杆同保证金模式同结算方式</strong>的成交会并成<strong>一个</strong>仓位（与币安单向持仓一致）：加权开仓价按<strong>币量</strong>加权，张数与保证金相加，保留最早那一笔的 id 与开仓时刻，每笔成交仍留在仓位的 fills 里。强平因此按合并后的整体判。四项有任一不同则<strong>不合并</strong>，并弹出提示说明原因；<strong>维持保证金口径</strong>另有一条<strong>有方向</strong>的规则：按旧 0.4% 的一笔不并进按币安分层的仓位（会把现有的分层仓位推进更高的档、当场强平），反过来分层的加仓照常并进按旧 0.4% 的仓位、整仓仍按 0.4%——仓位开出来之后不换强平模型，见下面的杠杆分层与仓位上限。多单与空单<strong>永远不合并</strong>——那是主力与对冲。并入现有仓位时，随单勾选的止盈止损<strong>不挂出</strong>并提示，避免悄悄覆盖仓位上已有的止损；挂在被并入那一笔上的减仓单会自动改指到存活仓位，不撤销。<strong>不合并时</strong>（四项任一不同、或按旧 0.4% 的一笔碰上分层仓位）新的那一笔身上没有任何减仓单，提示里会说明；持仓卡上的<strong>「止盈/止损」与「平仓」都按整张卡生效</strong>：止盈止损是卡上有几笔就各挂一张，平仓是弹窗里挑的成数摊到卡上每一笔（各按自己的数量平）——同一个触发价 / 同一个成数，所以「100%」盖住的是整张卡，一张有两笔的卡照样能按成数减仓。两个弹窗里的开仓价都是这张卡的加权开仓价；止盈止损弹窗里的强平价是逐仓里最先被强平的那一笔，平仓弹窗只写加权开仓价与标记价（不写强平价）；卡上多于一笔时弹窗会写明笔数，平仓弹窗的可用数量按此刻还活着的几笔算，弹窗开着时有一笔被强平，可用数量与预计盈亏跟着变、挑好的成数不变。</td>
                    <td className="px-3 py-2 border-t border-border">此前每一笔成交各建一个仓位，逐仓强平按「<strong>任一腿</strong>净值 ≤ 维持保证金」判——于是加仓会被<strong>自己的</strong>强平价单独打掉，而健康的主力明明还有盈余可以扛住它。实盘 COAIUSDT 2026-06-13：主力开仓 0.538058（强平 0.491100）、加仓 0.604447（强平 <strong>0.551695</strong>），价格触及 0.542220 把<strong>加仓整条打掉</strong>，主力毫发无损；合并后加权开仓价 0.581748、强平价 <strong>0.530977</strong>，0.542220 根本不该触发任何强平。单向持仓的正确判据是「<strong>各腿净值之和</strong> ≤ 维持保证金之和」，健康腿的盈余本来就该拿来扛住加仓。另注：反向合约的强平价是 E·L(1+mmr)/(L+1)，与线性的 E(1−1/L+mmr) 在 10x 上差 0.9%。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">调整杠杆</td>
                    <td className="px-3 py-2 border-t border-border">持仓卡上的<strong>「杠杆」</strong>按钮与下单面板的杠杆按钮是<strong>同一个对话框</strong>，改动会<strong>同时重述该标的的持仓、挂单与余额</strong>——所以「下单模块改了杠杆，持仓也跟着改」是结构上成立的，不存在只改一边的路径。提杠杆 = 降低保证金地板 = <strong>释放保证金回余额</strong>（释放额 = 名义 ×(1/L₁ − 1/L₂)，按<strong>开仓价</strong>折算）。名义、张数、开仓价一概不动。确认前会显示保证金与<strong>强平价的前后对比</strong>、释放额，以及滑块所在杠杆的「<strong>当前杠杆倍数最高可持有头寸</strong>」（按该合约的单位：U 本位 USDT、币本位的币、合成币本位 USD）。滑块上限是<strong>该合约的最高杠杆</strong>（KAITOUSDT 75x、BTCUSDT 150x、BTCUSD 125x），不再一律 125x。四道守卫：立即触发强平则拒绝、逐仓有持仓时<strong>只能升不能降</strong>（滑块下限直接卡死）、持仓和当前委托的总价值超过目标杠杆的最高可持有头寸则拒绝（提示「请调低杠杆倍数至 Nx 以下」，与下单面板是同一个判定，见下一行「杠杆分层与仓位上限」）、取不到标记价则拒绝。</td>
                    <td className="px-3 py-2 border-t border-border">这正是上文「用提杠杆换加仓弹药」的机制：释放出来的保证金就是新增的可用资金。三件事必须在同一次写入里完成，否则任一交错都是缺陷——<strong>只改杠杆不退钱</strong>会让保证金地板下降而钱还在仓位里，凭空多出一笔「可减保证金」，用户能从调整保证金弹窗里提走、每提一档再来一次；<strong>只退钱不改杠杆</strong>则让用户自己追加的保证金变得取不出来；<strong>不改挂单</strong>则下一笔成交按旧杠杆建仓，而合并键把杠杆算在内，拖一下滑块就多出一张卡。另：平仓记录写的是<strong>开仓时</strong>的杠杆快照，否则中途提一次杠杆再平仓，战役的「初始杠杆」会被追溯改写、R 倍数虚高。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">杠杆分层与仓位上限</td>
                    <td className="px-3 py-2 border-t border-border">杠杆上限<strong>按合约分层</strong>，数据取自币安公开的分层快照（<strong>2026-09-16</strong>）。这份快照<strong>不是历史分层</strong>：回放更早的日期也按它判。规则与币安一致：<br />· <strong>判的是下单之后的总量</strong>：该合约的持仓 + 当前委托（只减仓单不算，TWAP 只算没成交的部分）+ 这一单。双向持仓下<strong>多空按绝对值相加</strong>，共用一个上限。持仓按标记价估值，挂单按各自的委托价（没有委托价的按触发价，跟踪委托按激活价，市价单与 TWAP 按标记价）估值，正要下的这一单也一样；<strong>已经穿价的限价单</strong>（买价 ≥ 现价、卖价 ≤ 现价，下一根 K 线就按委托价成交）按标记价估值——成交之后它就是按标记价估值的持仓；U 本位以 USDT 计（数量 × 价），币本位以币计（张数 × 面值 ÷ 价，如 BTC）——折币同样是持仓按标记价、挂单与这一单按各自的价：一张低于现价的买入限价单成交时就是按委托价折的币，按标记价折会少算，100% 下出去的单成交后就超了。同一个币的 U 本位与币本位是两张合约，各算各的。<br />· <strong>某个杠杆下最多能持有多少</strong>：最后一个「最高杠杆不低于它」的档位的上限。例：KAITOUSDT 15x 最高 50,000 USDT，75x 只有 5,000。<br />· <strong>某个规模最高能用几倍</strong>：它所在档位的最高杠杆。例：1,635,780 落在 1,000,000–7,500,000 那一档，最高 2x。<br />· 超过<strong>最高一档的上限</strong>，任何杠杆都不能开（KAITOUSDT 为 12,500,000）。<br />· 超限时下单按钮置灰，并提示「持仓和当前委托价值超过当前杠杆倍数最高可持有头寸……按这个规模最高可用 Nx」。引擎下单时再判一次，绕过面板也下不出去。条件单与跟踪委托下单时还会按触发价（跟踪委托按激活价）再判一道——持仓按那个价估值，价格走过去的路上会成交的限价单、会触发的条件单也算作那个价上的持仓——触发时注定过不去的单当场就挂不出去，面板同样标红。<strong>没有穿价的限价单</strong>（分段订单取离现价最远的那笔子单）同样再按委托价判一道「成交那一刻」：持仓、路上会先成交的限价单与会先触发的条件单、这一单都按委托价估值——真币本位低于现价的买单、U 本位高于现价的卖单，成交之后总量会比下单时按标记价算的大，100% 下出去的单成交后就超了、账户从此连对冲都开不出去。币安下单时只判一次（持仓按标记价），这是与币安刻意不同的一处（宁可下单时少给一点，也不让成交把人卡住），第二道的提示以「按委托价 X 成交那一刻估值」开头。「可开」与仓位比例按钮取两道里较小的那个。<strong>本次更新之后下的条件单与跟踪委托</strong>在<strong>触发那一刻</strong>再判一次（币安在触发时才真正下单），过不去就撤单留痕；TWAP 的每一片执行时也按「持仓 + 其余委托 + 这一片」再判，过不去就停掉整张 TWAP 并留痕。更新前挂出的委托触发时不再判：它们是按旧规则放行的，与它们成交后仍按旧模型是同一条规则，升级不会在触发那一刻悄悄撤掉早就挂好的对冲单。挂在盘口的限价单成交时不再判（与币安一致）——只靠下文对冲豁免挂出的限价单除外，它成交那一刻要再判豁免是否仍成立。同一轮里两张 TWAP 各切一片时，前一张刚成交的那一片不会被后一张再算一遍。<br />· <strong>已挂触发单的预警</strong>：下单与改杠杆时，已挂的触发单只按触发价（跟踪委托按激活价）算进敞口，不会替它们预演触发那一刻的判定——那一刻的判定在触发时才做（持仓按那时的价、那时的挂单与杠杆）。所以一张新单、一次提杠杆，可能让本次更新之后挂出的条件单或跟踪委托到触发时注定被撤——止损换对冲的那张对冲单恰恰在该触发时没了。下单面板与杠杆对话框会在确认之前说「这张单下出去后（杠杆调到 Nx 后），已挂的做多条件单 X 触发时会因超出当前杠杆最高可持有头寸被拒」，下出去 / 改完之后消息中心再记一条；<strong>只提醒，不拦</strong>。当前委托里，按此刻的持仓与挂单到时就会被拒的单标着「<strong>触发时将超限</strong>」（靠下文对冲豁免挂出的限价单标「<strong>成交时将超限</strong>」，悬停看原因）。预判按「<strong>价格走到触发价</strong>（跟踪委托为激活价，豁免限价单为委托价）那一刻」算：持仓按那个价估值；走过的路上会成交的限价单（买单委托价不低于走过的最低价、卖单不高于走过的最高价，含已经穿价的，也含正要下的这一单）与会触发的条件单到时已是持仓、按那个价估值——一张回调加仓的限价单会让 S₁ 上的对冲单到时放不下，下单前就会说；路上的条件单触发时自己还要再判，这里按「开出来了」算，宁严勿松；其余挂单按各自的价（跟踪委托单边走过去只会激活、不会成交，按激活价算作挂单）。价格也可能<strong>先去现价另一侧、再折回来</strong>：另一侧的开仓挂单（限价单、条件单）先成交，再走到这张单的价——这几种走法都算，任何一种会被拒都标出来；预警只说这一步新弄坏的那几种（这一步之前就放不下的走法不重复说，直接走过去本来就放不下的单整张不再说——它早就标着）：突破加仓在上、止损对冲在下时，「先突破再跌回来」对冲按已成交的加仓判，「先跌到对冲再涨回来」加仓按已成交的对冲判。正要下的这一单若是触发类单，「另一侧的挂单先成交、再折回来触发它」会被拒时也会说（直接走过去就会被拒的，下单时就已经拦下）。行情再变、之后又下了别的单或改了杠杆，触发时的结果还会不同——这是预警，不是保证。决策记录模式下，引擎拒单时开仓快照照存，但不会再提示「已提交订单」，而是明说没有下单。「可开」与仓位比例按钮同样以这个上限封顶（向下取整）；「可开」按输入框当前的单位报（张、币金额、币保证金、币数、USDT 金额或 USDT 保证金），开多、开空各一列——两列可能不同：同一个限价对一个方向已经穿价（按现价估值），或更新前仓位的对冲豁免让一侧更大。仓位比例按钮的 100%：同一个限价只对一个方向穿价时，取<strong>挂得住的那一列</strong>（穿价的那个方向等于市价单；那一列是 0 才取另一列）——U 本位低于现价的买单、真币本位高于现价的卖单按穿价那一列会少开一截；对冲豁免让两列不同时取<strong>较大的那一列</strong>：往超限的旧仓位那一侧本来就开不了，100% 给的是整份对冲，拿这个量去点另一侧的按钮会标红并说明。估值跟着标记价浮动时，会在上限前留 0.2% 余量——面板显示的是平滑后的价，引擎按最新价估值，差一个 tick 就会把恰好卡线的单拒掉。具体是：按现价成交的单（市价、最优价、已经穿价或离现价不到 0.2% 的限价单——面板与引擎可能对「穿没穿价」看法不同）、挂着这样的限价单、这一单或挂单按标记价估值（TWAP、没有激活价的跟踪委托），或已有持仓时留，U 本位与真币本位都一样；除此之外（离现价更远的限价 / 触发价单、没有持仓，挂单也都按各自的价估值）不留——估值不随现价漂；第二道钉在委托价 / 触发价上，也不留；合成币本位（如 KAITOUSD）按 USD 面值计、与价格无关，从不留。分段订单按各子单的委托价、跟踪委托按激活价估值，面板与引擎同一个口径。下单面板底部的「<strong>杠杆分层</strong>」可查看该合约的全部档位（持仓价值区间、最高杠杆、维持保证金率、速算额、单位、快照日期）。<br />· <strong>现有敞口自己就超过上限</strong>时（行情把持仓的价值推过了线，或更新前按旧规则开的大仓位——旧通用表比币安宽），这个杠杆下再小的同向加仓都开不出去；行情把新仓位推过了线时，对冲单也一样（与币安一致；更新前的旧仓位见下文的对冲豁免）。能把杠杆降到放得下的倍数时，提示照币安的话说「请调低杠杆倍数至 Nx 以下」；逐仓有持仓时不能降杠杆，只能先减仓或撤单，把总量降到上限以下——下单提示与杠杆对话框都照实这么说（对话框停在当前杠杆时也会摆出来），不再叫人去调一个调不了的杠杆。仓位杠杆高过合约现在最高杠杆的旧仓位（如 LUMIAUSDT 上按 35x 开的，该合约最高 10x），平仓前杠杆无法调整，新单最高只能用该合约的最高杠杆。<br />· 保存过的杠杆若超过该合约的最高杠杆（旧版本可存到 125x），按最高杠杆生效并提示一次。杠杆按标的只存一份：偏好里的默认杠杆存的是它与两张合约（U 本位、币本位）里较高那个上限的较小者，读的时候再按各自的结算方式夹——面板刷新后停在币本位，也不会把 U 本位那张合约压到币本位的上限（BNB：偏好 50x → U 本位 50x、币本位 20x）。挂单上若还留着超过上限的旧杠杆，在杠杆对话框里按上限确认一次，挂单即被拉回上限。<br />· 同一个币的 U 本位与币本位上限可能不同（如 BNB 75x / 20x、SOL 100x / 50x、BTC 150x / 125x）：下单面板按它当前的结算方式取分层；持仓卡上的「杠杆」按该仓位自己的结算方式取分层，确认时引擎按同一种结算方式判定与保存。<br />· <strong>币安没有的币本位合约</strong>（如 KAITOUSD）借同一个币的 U 本位分层，按 USD 面值（张数 × 面值）比较，界面上注明「币安无 KAITO 币本位合约，按 U 本位 KAITOUSDT 分层折算」。快照里查不到的合约暂按最常见的那张 U 本位分层（113 个合约共用），同样会注明。<br />· <strong>真正的平仓从不被拦</strong>：持仓卡上的平仓、止盈止损等只减仓单不受这道上限约束。币安在挂单把总量顶过上限时也会拒绝平仓，训练器里拦住平仓只会把人困在仓位里——这是刻意的差别。注意下单面板的「平仓」档并不平仓，而是反向开一笔新仓位，所以它照常受上限约束。<br />· <strong>维持保证金也按档位算</strong>：维持保证金 = 持仓价值 × 档位维持保证金率 − 速算扣除额，与所选杠杆无关；强平价用币安的逐仓公式，算出的价位落进别的档位时换档重算。这只适用于<strong>本次更新之后新开</strong>的仓位——准确地说，是更新之后下的委托成交开出的仓位（往它上面的加仓也一样；只靠下一条的对冲豁免下出去的除外）；更新前开的仓位，以及<strong>更新前挂出、更新后才成交</strong>的委托开出的仓位，仍按旧的统一 0.4% 计算，直到平掉（往它上面的分层加仓会并进这个仓位，整仓仍按 0.4%，见下文的合并规则）。那些旧委托是按旧规则放行的（旧通用表、滑块到 125x、默认 35x），套上分层会一成交就在开仓价上被强平。升级本身不会让任何现有仓位或现有委托开出的仓位被强平或改变强平价。<br />· <strong>更新前的仓位超过新上限时，对冲照常开得出去</strong>：更新前按旧规则开的仓位（旧通用表放行的，如 20x 的 200,000 USD KAITO，新规则 20x 只到 50,000）可能已经超过它的新上限。<strong>反向开仓不受上限约束</strong>，只要反方向的总量（已有持仓与挂单 + 这一单）不超过这些旧仓位的大小——比的是仓位大小：旧仓位、这一单与反方向已有的持仓和挂单<strong>一律按标记价</strong>折算（U 本位比币数，真币本位比张数），一张远离现价的限价单不能因为委托价低就比它要对冲的旧仓位大；<strong>往旧仓位那一侧加仓照常受上限约束</strong>，提示里写明「反向开仓对冲更新前的仓位不受此限，最多 X」。<br />· <strong>谁算「更新前的仓位」，按记下来的来源判，不靠猜</strong>：每张委托、每个仓位都带着来源——分层（本次更新之后正常过了分层判定的）、<strong>对冲豁免</strong>（只靠上一条豁免放行的）、更新前（什么都没有：升级前开的仓位、升级前挂出的委托及它们之后成交开出的仓位）。<strong>只有更新前的仓位是豁免的底</strong>，某一侧的额度 = 反方向上更新前仓位<strong>冻结的底</strong>（见下面的规则四：分层加仓并进来不会把它做大）− 这一侧已有的全部持仓与挂单（已经靠豁免开出 / 挂出的对冲占着额度）。<strong>靠这条豁免下出去的单按旧模型开</strong>：与它对冲的旧仓位一样按统一 0.4% 计维持保证金——这样的对冲往往远超当前杠杆在分层里允许的大小，套上分层维持保证金会高过它自己的保证金，价格不动也会一成交就被强平；下单面板在按钮前会说明。但它<strong>不是</strong>更新前的仓位：不能再给别的单当豁免的底——否则旧仓位减掉一半后又能加回去，旧仓位平掉后还能开出新的超限仓位，一轮轮接下去。<strong>挂着的豁免单到触发 / 成交那一刻再判一次</strong>（条件单、跟踪委托、限价单都是）：旧仓位还在、额度没被别的对冲占掉，就按旧模型开；否则按普通的分层判——放得下就开分层仓位，放不下就撤单留痕、计划单照常放回。旧仓位先平掉之后，那张对冲单不会再开出一个远超上限的裸仓位。本次更新之后挂的条件单若到触发那一刻才靠这条豁免放行，那一笔同样按旧模型开，带豁免标记。旧仓位平掉之后还留着的豁免仓位就是一个超过上限的普通仓位：只能减仓，不能再往任何一侧开新单（与行情把仓位推过线同样处理）。下单面板里开多、开空两个按钮因此可能一个能点、一个不能，「可开」两列也不同。触发时再判、已挂触发单的预警也按同一条豁免。这是与币安刻意不同的又一处：升级不该拿走现有仓位的对冲（止损换对冲）；本次更新之后开的仓位没有这条豁免。<br />· <strong>加仓合并：仓位开出来之后不换强平模型</strong>（规则一）——合并之后存活的仓位一律沿用<strong>被加仓的那个仓位</strong>的维持保证金模型与来源，与并进来的这一笔是什么来源无关。没有任何一笔成交能改动一个现有仓位的维持保证金、强平价或是否还活着。由此分成三条：<br />　· <strong>分层的加仓可以并进按旧 0.4% 的仓位</strong>（更新前的仓位、靠对冲豁免开的仓位，规则二）：并进去之后<strong>整个仓位仍按旧的统一 0.4%</strong>，一个数都不重新定价，也不会多出一条只靠自己那点保证金硬扛的新腿——加仓照旧被旧仓位的权益扛着（上面 COAIUSDT 那次事故正是为此）。加仓在<strong>下单</strong>那一刻照样要过分层上限，这一条没变；上限限的是总敞口，所以靠一路加仓把按 0.4% 的仓位堆到上限之上是做不到的。合并会把两笔的保证金与均价汇到一起，顺带把强平价<strong>推远或拉近</strong>——加到<strong>亏损</strong>的旧仓位上推远，加到<strong>浮盈</strong>的旧仓位上拉近（新的一刀在更高的价上开、拉高了均价）；面板在按钮前把前后两个数摆出来。推远的例子：KAITOUSDT 20x 逐仓、更新前的多仓 40,000 @1.0、保证金 2,000，在 0.96 上加满一刀，整仓强平价 <strong>0.954000 → 0.945206</strong>（推远 0.92%）；只加 1 个币则 0.954000 → 0.953999（几乎不动）。拉近的例子、也是这个体系里最常见的画面（往浮盈的头仓上加）：同一个盘面若旧多仓是 40,000 @0.50、保证金 1,000（标记价 0.96 即 +92%），在 0.96 上加 10,000 USDT，旧仓位自己的强平价从 <strong>0.477000 变成 0.567669</strong>（拉近 9.44%）——这是往浮盈头仓上加仓的人该读的那一个数；而那一刀若单独成仓只有 <strong>0.923452</strong>（离标记价 3.81%），一次 4% 的回撤就把加仓单独打掉，并进去之后它被整仓 18,400 的浮盈扛着。<br />　· <strong>反过来不并</strong>（规则三）：按旧 0.4% 的一笔（更新前挂出的旧委托成交、靠对冲豁免开的成交）<strong>不会</strong>并进按币安分层的同方向仓位。存活的会是分层仓位，它要把并进来的那一截名义也按档位定价、跨进更高的档，足以把现有的分层仓位当场强平（KAITOUSDT 5x：分层空 9,000 的维持保证金是 9,000 × 1.5% − 25 = 110，并进一笔 230,000 的豁免对冲后按分层是 239,000 × 10% − 7,700 = <strong>16,200</strong>，而两笔各算各的只要 110 + 920 = 1,030）。这一格两笔各成一个仓位、各算各的强平价，现有仓位的维持保证金与强平价一个数都不动；下单面板在按钮前会说，成交时消息中心也会记一条「未与现有仓位合并」。<br />　· <strong>加进去的名义不会把对冲豁免的额度做大</strong>（规则四）：更新前的仓位单独记着一个<strong>冻结的底</strong>——分层加仓并进来只把仓位做大、底不动；部分平仓按比例缩，平光就没了；只有<strong>更新前挂出、更新后才成交</strong>的旧委托并进来才会把底做大（那些单子是按旧规则放行的，用户没法再挂新的）。对冲额度、触发 / 成交那一刻的再判、面板的「可开」读的都是这个冻结的底，<strong>不是仓位当前的大小</strong>——否则一笔分层加仓就能把额度顶大一截，反向再开出一笔同样大的超限裸仓位，一轮轮接下去。靠豁免开的仓位与分层仓位一概不是底，这一条没变。<br />　· <strong>口径相同的两笔照常合并</strong>（都按分层、都按旧 0.4%），存活的仍是被加仓那个仓位的来源，维持保证金与强平价不变；豁免成交并进更新前的仓位后整个仓位仍按 0.4%，但并进去的那一截不算底。<br />　· 规则三那一格<strong>没有合并</strong>时，新的那一笔身上<strong>没有任何减仓单</strong>：挂在旧仓位上的止盈止损只认那一笔，盖不住新的这一笔；持仓卡上按一次「止盈/止损」会给卡上每一笔各挂一张（同一个触发价、成数按各笔自己的数量算），成交时的提示也会说这句。<strong>「平仓」同样按整张卡生效</strong>：弹窗里挑的成数摊到卡上每一笔、各按自己的数量平，所以一张有两笔的卡照样能按成数减仓，「100%」盖住整张卡——不再是一按就把两笔全部市价平掉。旧仓位贴着强平价、这一笔又并不进去时，要救只能用持仓卡上的「+」追加保证金；<strong>「+」是卡级的</strong>，卡上多于一笔时这笔钱按名义等比摊到每一笔，旧仓位只拿到其中一部分，面板在按钮前会连这一点一起说。<br />· <strong>加仓计算器</strong>给出的可下单量同样过这道上限（见 3.4）。</td>
                    <td className="px-3 py-2 border-t border-border">此前所有合约共用一张通用表（≤5 万 125x、≤25 万 50x、≤100 万 20x、其余 10x），单位写死 USDT，而且<strong>只看这一单自己</strong>的名义：KAITO 币本位 163,578 张（1,635,780 USD）在 15x 下被提示「最高 10x」，而币安对 KAITOUSDT 这个规模最高只给 <strong>2x</strong>（15x 最多 50,000）——旧表在这里反而过松。它也不看已有持仓与挂单，把一单拆成几单就能绕过去；引擎下单与挂单触发从不检查；「手续费等级」链接显示的其实是这张杠杆表。维持保证金一律 0.4%，没有速算扣除额，大仓位的强平价因此偏乐观。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">单笔数量上限（市价单）</td>
                    <td className="px-3 py-2 border-t border-border">与币安一致，<strong>一笔市价单</strong>的数量有上限（币安 exchangeInfo 的 MARKET_LOT_SIZE，快照 <strong>2026-09-23</strong>）：BTCUSDT 120 BTC、ETHUSDT 2,000 ETH、KAITOUSDT 200,000 KAITO、TUTUSDT 4,000,000 TUT、ORDIUSDT 20,000 ORDI、ASTERUSDT 400,000 ASTER；币本位按张计，如 BTCUSD 60,000 张。限价单按宽得多的 LOT_SIZE 判（KAITOUSDT 2,000,000、BTCUSDT 1,000）。上限管的是<strong>一笔单子</strong>，不是仓位：仓位可以比它大，分几笔下就是了。<br />· <strong>哪些单按市价上限判</strong>：市价单（开仓、加仓、下单面板的「平仓」档）、条件委托与跟踪委托（触发后按市价成交）、TWAP 的<strong>每一片</strong>、持仓卡上的市价平仓、按成数（不足 100%）挂的止盈止损；分段订单的<strong>每张子单</strong>按限价上限判。超过就下不出去：下单面板把按钮置灰并标红说明，引擎下单时再判一次（币安的 -4005「数量超过最大值」）。提示写明上限与出路，出路按单子的类型说：市价单拆成几笔或改用限价单；条件单、跟踪委托拆成几张同类的单（每张不超过上限）——不建议改用限价单：止损方向的单子（S₁ 下方卖出的对冲、现价上方买入的突破加仓）换成同价的限价单会立刻按现价成交；委托列表里已经挂着的，说的是撤单后拆开重挂。<br />· <strong>下单面板</strong>：市价类订单在数量框下常驻一行「单笔市价上限 200,000 KAITO」（币本位写张数）；仓位比例按钮的 100% 与「可开」按这个上限封顶（TWAP 按每一片乘片数，分段按每张子单乘张数）。U 本位按 USDT 下单（订单金额 / 初始保证金，面板默认的单位）时，框里的 USDT 按现价折成币：上限以币计、与价无关，折出来的币数却跟着现价走，恰好填到「上限 × 现价」的单跌一个 tick 就又超了——市价、TWAP、跟踪委托的 100% 在上限前同样留 0.2% 余量；条件委托按触发价折币，不留。加仓计算器的「按上限下单」只预填一笔上限、说明剩下的还要再分几笔下；S₁ 上的合计对冲超过上限时，提示要拆成几张条件单。<br />· <strong>币安没有的币本位合约</strong>（如 KAITOUSD）借同一个币的 U 本位上限，按这一单成交的价把币数折成整张（向下取整）：KAITO 在 1.0905 上 200,000 KAITO = 21,810 张，价格越低能下的张数越少。所以这类合约的条件单、跟踪委托、TWAP 在触发 / 执行那一刻按那一刻的价再判一次。跟踪委托的成交价是回调线（极值 × (1 ∓ 回调幅度)），下单时按<strong>激活价（没有激活价按现价）下方一个回调幅度</strong>折张。<strong>有激活价</strong>时，卖出方向的峰值从激活价起算、只会更高，成交价不会低于它——挂得出去就不会在触发时被拒；<strong>没有激活价</strong>时挂出即开始追踪，峰值从挂出之后第一段行情算起，可能低于下单时的现价（回放按 K 线的高低点撮合），成交价也就可能低于下单时判的那个价。这种单与买入方向一样在触发那一刻再判一次，过不去就撤单留痕：买入方向从谷底反弹成交，谷底再深时上限更小。委托列表按此刻的回调线提前标出，但同一段行情里刚摸到极值就回撤触发的，来不及提前标。TWAP 每一片按执行那一刻的价折张，<strong>价格下跌时每片上限随之变小</strong>，面板小字会说。下单面板的 100% 与持仓卡的「按上限平」在按现价折的上限前留 0.2% 余量（现价每一帧都在变，恰好卡线的数量跌一个 tick 就又超了）。快照里查不到的合约<strong>不设上限</strong>。<br />· <strong>触发时再判，但不悄悄丢掉保护</strong>：本次更新之后挂的、按市价成交的单在触发 / 执行时再判；过不去就撤单留痕，并在消息中心说清（止盈止损会写明「这个仓位此刻没有这张止损的保护」）。委托列表里到时会被拒的单提前标着「<strong>触发时将超单笔上限</strong>」（TWAP 标「执行时将超单笔上限」，悬停看原因）。更新前挂出的委托触发时不再判。<br />· <strong>不受这个上限约束</strong>：引擎强平；平掉整个仓位（100%）的止盈止损——相当于币安不带数量的「平仓」止盈止损（closePosition）；「一键平仓」与停止回放时的收尾平仓。币安文档对 closePosition 只说触发时平掉整个仓位、不能带数量，没有说它受单笔上限约束，这里按不受约束处理；币安 FAQ 对仓位超过市价单上限时的「一键平仓」说的是可能延迟成交，不是拒单。<br />· <strong>仓位比上限大，怎么平</strong>：持仓卡上的「平仓」一次最多平一个上限，超过时按钮置灰并给出「按上限平」，分几次市价平仓即可；或者设 100% 的止盈止损。按成数挂的止盈止损最小一格是 10%：仓位是上限的 10 倍以上时，连这一格都放不下，弹窗会直说只能选 100%。仓位比上限大 100 倍以上也一样（CYPHUSDT 一笔最多 2,000 CYPH，250,000 的仓位按 0.8% 平）：平仓弹窗填多少就平多少（此前不到 1% 的量一律按 1% 平），确认按钮上写的就是真正平掉的成数（0.8%），不四舍五入成 1% 或 0%。连最小的一笔都超过上限时（合成币本位在极低的价上，1 张就超过借来的币数上限），只能设 100% 的止盈止损或用「一键平仓」。本模拟器没有只减仓的限价平仓单——下单面板的「平仓」档是反向开一笔新仓位，照常受上限约束。</td>
                    <td className="px-3 py-2 border-t border-border">此前任何规模的市价单都一口成交，币安却会拒单：KAITO 币本位 163,578 张（1,635,780 USD）这样的单子，按 KAITOUSDT 的上限一笔最多 200,000 KAITO（在 1.0905 上约 21,810 张、218,100 USD）。在这里练出来的「一笔市价吃满、一笔市价平光」到真实账户上会被拒——最要命的是止损换对冲那一刻：S₁ 上的对冲条件单超过上限，在币安一张都挂不出去（-4005），要事先拆成几张。数据取自币安公开的 exchangeInfo（不需要登录），用 scripts/update-binance-symbol-filters.mjs 刷新；强平清算费率一并存下，暂不参与计算。</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 border-t border-border font-medium">默认结算方式</td>
                    <td className="px-3 py-2 border-t border-border">新标的下单<strong>默认币本位</strong>；下单面板顶部那颗「U本位 / 币本位」标签可随时切换，但切到 U本位<strong>只对当前会话有效</strong>——页面每次刷新或重新打开，面板一律回到币本位，不记住上次的选择；已开的 U本位仓位不受影响，它本来就是另一张合约（如 RUNEUSDT 与 RUNEUSD）。</td>
                    <td className="px-3 py-2 border-t border-border">本系统的主仓打法以币本位为主。<strong>已有的历史记录不受影响</strong>——缺少该字段的旧单子一律仍按 U 本位解读，否则等于事后改写过去交易的含义，连带污染战役的保证金、R 倍数与统计。</td>
                  </tr>
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
            <div className="guide-stack">
              <P>一周后看未评价是否清零；一个月后看高频错误是否收敛；两个月后看新规则是否真的降低对应错误频次。能做到这三点，系统就在工作。</P>
              <div className="guide-outro flex flex-col items-center gap-2">
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

          {charCount != null && (
            <div data-guide-meta className="guide-wordcount" title={`全文 ${charCount.toLocaleString('en-US')} 字（不含空白）`}>
              （{charCount.toLocaleString('en-US')} 字）
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
