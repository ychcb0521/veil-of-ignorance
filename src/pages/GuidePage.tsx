import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowLeft, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

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
    <div className="bg-accent/50 border-l-2 border-[#F0B90B] pl-4 py-2 rounded-r text-[14px] leading-relaxed text-foreground">
      {children}
    </div>
  );
}

function RedHighlight({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[#F6465D]/10 border border-[#F6465D]/30 rounded p-4 text-[14px] leading-relaxed text-foreground">
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
  return <h3 className="text-[16px] font-medium text-foreground mt-6 mb-2">{children}</h3>;
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
  return <div className="grid md:grid-cols-3 gap-3">{children}</div>;
}

function KeyCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-border rounded bg-card p-4">
      <div className="text-[12px] font-medium text-foreground mb-2">{title}</div>
      <div className="text-[13px] leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

function FlowNode({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <div className={`relative bg-card border rounded p-3 text-[12px] text-center max-w-[520px] mx-auto ${
      accent ? 'border-[#F0B90B]' : 'border-border'
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

export default function GuidePage() {
  const nav = useNavigate();
  const [activeId, setActiveId] = useState<string>('s1');
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
                无知之幕不是普通模拟盘，而是一套交易训练与复盘系统。它用真实历史行情做训练环境，用强制快照记录下单前的判断，用错题集、交易战役、规则和元监控把错误转化为可执行约束。
              </P>
              <P>
                “无知之幕”（veil of ignorance）来自政治哲学家约翰·罗尔斯的思想实验：一个人在不知道自己未来身份、位置和利益归属的条件下，才更可能做出公正、稳健的制度选择。放到交易训练里，它对应的是一种更严格的决策状态：你不知道未来 K 线，不知道这笔会赚还是亏，也不能用事后结果反推当时理由。
              </P>
              <P>
                因此，就“决策受到什么信息影响”而言，本系统中的模拟交易与实际交易几乎等价。二者面对的关键问题相同：在未来不可见、结果不确定、情绪会干扰判断的条件下，你是否仍能按事前规则行动。
              </P>
              <Highlight>
                核心目标只有一个：让每一次亏损都能回答“哪里错了、为什么会重复、下次如何被系统拦住”。
              </Highlight>
              <KeyGrid>
                <KeyCard title="训练对象">
                  训练的不是预测能力本身，而是决策流程：入场理由、风险预算、情绪状态、执行纪律和事后修正。
                </KeyCard>
                <KeyCard title="数据原则">
                  盘面使用真实历史数据；复盘数据来自你当时写下的快照。系统不替你虚构理由，也不把历史回填伪装成完整决策。
                </KeyCard>
                <KeyCard title="最终产物">
                  不是一篇复盘文字，而是一条下次开仓前能被勾选、能被验证、能减少同类错误的规则。
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
                <FlowNode accent>开仓前填写快照：理由、最大亏损、pre-mortem、预测胜率、心态、风险管理、checklist</FlowNode>
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
              <KeyGrid>
                <KeyCard title="直接交易（默认）">
                  下单零弹窗、平仓零评价，节奏与币安 1:1。本模式下产生的交易仅进入持仓历史与交易战役归类，<strong>不进入</strong> 错题集、元监控、规则系统。适合熟悉的标的、流畅的执行、或只想观察盘面的场景。
                </KeyCard>
                <KeyCard title="决策记录">
                  完整的开仓快照（理由、最大亏损、心态、Pre-mortem、胜率预测、Lollapalooza、破产估算等）+ 平仓后强制评价 + 错题集自动归类 + 元监控统计 + 规则系统冷却。适合刻意训练同一类 setup、复盘高频错误模式、或对自己进行校准。
                </KeyCard>
              </KeyGrid>
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
                两个模式可以随时切换，但<strong>从决策记录切到直接交易前，系统会检查是否有未评价的已平仓交易</strong>——有则拦截。这是为了堵住"切个模式就能逃避评价"的后门。
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
                  支持 1x、2x、5x、10x、50x 倍速。慢速用于练决策细节，高倍速用于快速穿越等待区和重复训练同类行情。
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
                    <tr><td className="px-3 py-2 border-t border-border">倍速播放</td><td className="px-3 py-2 border-t border-border">按 1x 到 50x 推进行情</td><td className="px-3 py-2 border-t border-border">用高倍速提高训练密度，用低倍速校准执行质量</td></tr>
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
                  新手先用 1x-5x 练完整决策，熟悉后用 10x-50x 提高样本量；50x 适合穿越无交易价值的等待区。
                </KeyCard>
              </KeyGrid>
              <Highlight>
                时光机的价值不是“快进看答案”，而是在看不到未来的条件下，把同一类行情反复练到动作稳定。倍速只是提高训练密度，不能替代下单前的判断。
              </Highlight>
            </section>

            <section id="s3-2" className="scroll-mt-20">
              <SubTitle>3.3 下单前快照</SubTitle>
              <P>开仓快照是系统的核心记录点。它固定“下单前的你”看到什么、相信什么、愿意亏多少、处在什么心态。</P>
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
                    <tr><td className="px-3 py-2 border-t border-border">订单类型</td><td className="px-3 py-2 border-t border-border">区分主力单与对冲单</td><td className="px-3 py-2 border-t border-border">主力单评估方向判断；对冲单评估风险防御</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">开仓理由</td><td className="px-3 py-2 border-t border-border">记录原始假设</td><td className="px-3 py-2 border-t border-border">必须具体到结构、条件和失效点</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">最大亏损</td><td className="px-3 py-2 border-t border-border">定义本次风险预算</td><td className="px-3 py-2 border-t border-border">后续 R 倍数以此为分母</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">心态自评</td><td className="px-3 py-2 border-t border-border">记录决策者状态</td><td className="px-3 py-2 border-t border-border">≤2 分硬阻挡，不能用确认框绕过</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">Pre-mortem</td><td className="px-3 py-2 border-t border-border">强制先想“如果这单亏完，最可能的原因是什么”</td><td className="px-3 py-2 border-t border-border">平仓后用它比对真实亏损原因</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">预测胜率</td><td className="px-3 py-2 border-t border-border">Tetlock 式校准训练</td><td className="px-3 py-2 border-t border-border">平仓后进入 Calibration，计算校准分数</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">训练集划分</td><td className="px-3 py-2 border-t border-border">区分进场期与出场期</td><td className="px-3 py-2 border-t border-border">防止把训练样本误当考试成绩</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">风险组合与破产估计</td><td className="px-3 py-2 border-t border-border">显示 Lollapalooza score 与 100 次连续训练的期望破产次数</td><td className="px-3 py-2 border-t border-border">组合风险过高时硬阻挡</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">Checklist</td><td className="px-3 py-2 border-t border-border">把规则前置到下单前</td><td className="px-3 py-2 border-t border-border">不能判断是否通过的条目，需要重写</td></tr>
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
            </section>

            <section id="s4-3" className="scroll-mt-20">
              <SubTitle>4.3 元监控</SubTitle>
              <P>元监控回答“系统是否真的让你变好”。不要只看漂亮图表，核心看规则创建后，对应错误模式是否在扣除自然学习曲线与 regression to mean 后仍然下降。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>错误趋势</strong>：同一 pattern 的近期变化。</li>
                <li><strong>规则有效性</strong>：规则上线后，对应错误是否减少，并与全局基线比较。</li>
                <li><strong>置信区间</strong>：低样本下不把随机波动误读成进步。</li>
                <li><strong>Calibration</strong>：比较开仓预测胜率与平仓结果，观察判断是否过度自信。</li>
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
              <P>一条规则只有在“启用”且“加入 checklist”后，才会进入开仓快照；否则它只是记录，不会参与下单前约束。</P>
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
