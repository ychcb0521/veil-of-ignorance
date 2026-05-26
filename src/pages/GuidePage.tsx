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
      { id: 's3-1', label: '3.1 时光机与行情' },
      { id: 's3-2', label: '3.2 下单前快照' },
      { id: 's3-3', label: '3.3 持仓与历史' },
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
                <FlowNode accent>开仓前填写快照：理由、最大亏损、心态、风险管理、checklist</FlowNode>
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

            <section id="s3-1" className="scroll-mt-20">
              <SubTitle>3.1 时光机与行情</SubTitle>
              <P>
                时光机是交易页的核心训练能力。它把真实历史行情切回到你指定的某一刻，并用“模拟时钟”继续向前播放。你只能看到当时已经发生的数据，看不到未来。
              </P>
              <KeyGrid>
                <KeyCard title="选择历史时点">
                  输入日期和时间后，系统加载该时刻附近的真实历史行情。K 线、盘口、成交、持仓盈亏和订单触发都以模拟时间为准。
                </KeyCard>
                <KeyCard title="加速播放">
                  支持 1x、2x、5x、10x、50x、100x 倍速。慢速用于练决策细节，高倍速用于快速穿越等待区和重复训练同类行情。
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
                    <tr><td className="px-3 py-2 border-t border-border">倍速播放</td><td className="px-3 py-2 border-t border-border">按 1x 到 100x 推进行情</td><td className="px-3 py-2 border-t border-border">用高倍速提高训练密度，用低倍速校准执行质量</td></tr>
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
                  新手先用 1x-5x 练完整决策，熟悉后用 10x-50x 提高样本量；100x 适合穿越无交易价值的等待区。
                </KeyCard>
              </KeyGrid>
              <Highlight>
                时光机的价值不是“快进看答案”，而是在看不到未来的条件下，把同一类行情反复练到动作稳定。倍速只是提高训练密度，不能替代下单前的判断。
              </Highlight>
            </section>

            <section id="s3-2" className="scroll-mt-20">
              <SubTitle>3.2 下单前快照</SubTitle>
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
                    <tr><td className="px-3 py-2 border-t border-border">心态自评</td><td className="px-3 py-2 border-t border-border">记录决策者状态</td><td className="px-3 py-2 border-t border-border">低分时必须解释触发原因</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">Checklist</td><td className="px-3 py-2 border-t border-border">把规则前置到下单前</td><td className="px-3 py-2 border-t border-border">不能判断是否通过的条目，需要重写</td></tr>
                  </tbody>
                </table>
              </div>
              <Highlight>
                快照不是表单负担。它是事后复盘的证据链：没有快照，就只能靠记忆复盘；靠记忆复盘，最容易把理由改写成对自己有利的版本。
              </Highlight>
            </section>

            <section id="s3-3" className="scroll-mt-20">
              <SubTitle>3.3 持仓与历史</SubTitle>
              <P>底部历史区用于检查执行结果。重点关注三类记录：未评价交易、仓位历史记录、平仓方式。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>未评价交易</strong>：优先补齐，否则错题集无法形成有效样本。</li>
                <li><strong>仓位历史记录</strong>：可用于归类历史交易，组成一次交易战役。</li>
                <li><strong>平仓方式</strong>：区分手动、止损、止盈、爆仓，判断你是在执行系统还是被情绪驱动。</li>
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
            </section>

            <section id="s4-3" className="scroll-mt-20">
              <SubTitle>4.3 元监控</SubTitle>
              <P>元监控回答“系统是否真的让你变好”。不要只看漂亮图表，核心看规则创建后，对应错误模式是否下降。</P>
              <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                <li><strong>错误趋势</strong>：同一 pattern 的近期变化。</li>
                <li><strong>规则有效性</strong>：规则上线后，对应错误是否减少。</li>
                <li><strong>订单类型分布</strong>：主力单与对冲单是否失衡。</li>
                <li><strong>心态与时段</strong>：识别你的高质量状态与危险时段。</li>
              </ul>
              <RedHighlight>
                元监控不是展示页，而是审计页。如果规则没有降低错误频次，就回到规则页重写。
              </RedHighlight>
            </section>

            <section id="s4-4" className="scroll-mt-20">
              <SubTitle>4.4 规则</SubTitle>
              <P>规则是复盘闭环的输出。合格规则必须具体、可执行、可检查。</P>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">不合格</th>
                      <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">合格</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="px-3 py-2 border-t border-border">不要冲动交易</td><td className="px-3 py-2 border-t border-border">心态自评小于 3 时，不允许开主力单，除非写出外部结构证据</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">注意止损</td><td className="px-3 py-2 border-t border-border">开仓前必须填写最大亏损，且不得超过账户的既定风险上限</td></tr>
                    <tr><td className="px-3 py-2 border-t border-border">别追高</td><td className="px-3 py-2 border-t border-border">突破后若 3 根 K 线内放量滞涨，不允许在当前位置追加主力仓</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <section id="s5" className="scroll-mt-20">
            <SectionTitle accent="#F0B90B">5. 认知资产</SectionTitle>
            <P>认知资产用于保存你的交易知识体系。当前支持上传 PDF、Word、TXT，系统会自动提取正文，识别小标题层级，并生成带目录的阅读页。</P>
            <KeyGrid>
              <KeyCard title="上传">
                选择文档后系统会生成目录与正文。目录按上传文件中的标题层级编号，如 1、1.1、1.1.1。
              </KeyCard>
              <KeyCard title="替换">
                替换文档属于低频操作，默认折叠。需要更新整套知识库时再展开。
              </KeyCard>
              <KeyCard title="删除">
                上传错文件时可删除当前认知资产文档，然后重新上传。
              </KeyCard>
            </KeyGrid>
            <Highlight>
              认知资产不是资料仓库，而是交易原则的源头。错题集负责发现你哪里没做到，认知资产负责定义“正确做法”本身。
            </Highlight>
          </section>

          <section id="s6" className="scroll-mt-20">
            <SectionTitle accent="#F6465D">6. 数据边界与硬约束</SectionTitle>
            <div className="space-y-3">
              <P><strong>主力单与对冲单必须分开理解。</strong> 主力单评估方向与机会质量；对冲单评估风险管理。把两者混在一起，会污染 R 倍数、胜率和错误模式统计。</P>
              <P><strong>最大亏损是 R 倍数的分母。</strong> 它表达的是本次愿意承受的最大错误成本，不应被事后修改成更好看的数字。</P>
              <P><strong>全仓是硬阻断。</strong> 系统训练阶段只允许逐仓。全仓会把单笔错误扩散到账户整体，违背“损失有界”的底层原则。</P>
              <P><strong>历史回填不等于真实快照。</strong> 回填可以恢复交易结构，但无法恢复当时的理由、心态和风险认识。系统不会假装知道这些缺失信息。</P>
              <P><strong>缺表或云端 schema 未同步时，部分模块会降级。</strong> 例如战役成本数据不可用时，元监控仍应展示核心错题数据，不应卡在永久加载。</P>
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
