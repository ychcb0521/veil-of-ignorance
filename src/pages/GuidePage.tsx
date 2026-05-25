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
  { id: 's1', label: '1. 这是什么' },
  { id: 's2', label: '2. 核心理念' },
  {
    id: 's3', label: '3. 主界面分区', children: [
      { id: 's3-1', label: '3.1 时光机' },
      { id: 's3-2', label: '3.2 K 线主图' },
      { id: 's3-3', label: '3.3 订单簿与成交流水' },
      { id: 's3-4', label: '3.4 下单面板（核心：开仓快照）' },
      { id: 's3-5', label: '3.5 持仓与历史' },
      { id: 's3-6', label: '3.6 关于订单类型：主力单 vs 对冲单' },
      { id: 's3-7', label: '3.7 关于硬约束：尤利西斯契约' },
    ],
  },
  {
    id: 's4', label: '4. 复盘中心 ★', children: [
      { id: 's4-1', label: '4.1 错题集' },
      { id: 's4-1-5', label: '4.1.5 交易战役' },
      { id: 's4-1-6', label: '4.1.6 战役级 SOP 评分边界' },
      { id: 's4-2', label: '4.2 元监控' },
      { id: 's4-3', label: '4.3 规则' },
      { id: 's4-4', label: '4.4 标签字典' },
      { id: 's4-5', label: '4.5 单笔复现' },
      { id: 's4-6', label: '4.6 六步深度分析' },
      { id: 's4-7', label: '4.7 反事实回放' },
    ],
  },
  { id: 's5', label: '5. 完整学习闭环' },
  { id: 's7', label: '6. 一句话总结' },
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

function Star() {
  return <span className="text-[#F0B90B]">★</span>;
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
            {item.id === 's4' ? <>4. 复盘中心 <span className="text-[#F0B90B]">★</span></> : item.label}
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

function FlowNode({ children, accent, star }: { children: ReactNode; accent?: boolean; star?: boolean }) {
  return (
    <div className={`relative bg-card border rounded p-3 text-[12px] text-center max-w-[520px] mx-auto ${
      accent ? 'border-[#F0B90B]' : 'border-border'
    }`}>
      {star && <span className="absolute top-2 right-2 text-[#F0B90B] text-[12px]">★</span>}
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
            <SectionTitle accent="#F0B90B">1. 这是什么</SectionTitle>
            <div className="space-y-3">
              <P>
                无知之幕（Veil of Ignorance）是一个给合约交易者使用的"时光机模拟器"。它的意义不是给你一个可以随便点单的练习场，而是让你在不损失真实资金的前提下，把一整套交易决策流程练到足以面对真实市场的程度。
              </P>
              <P>
                如果你已经在做实盘，这一页最重要的理解是：它训练的不只是"看方向"，而是训练你在入场前如何表达理由、如何定义风险、如何识别自己的情绪、以及如何在事后把错误转成下一次可执行的规则。
              </P>
              <P>数据来源：完全使用币安 USDT 永续合约真实历史数据。</P>
              <P>
                "无知之幕"的字面含义：在回放过程中，你永远看不到未来——K 线按真实时间 1:1 流速推进，不会暴露你尚未抵达的数据。
              </P>
            </div>
          </section>

          <section id="s2" className="scroll-mt-20">
            <SectionTitle accent="#0ECB81">2. 核心理念</SectionTitle>
            <div className="space-y-3">
              <P>理念分三层，但你可以把它理解成一名交易者每天真正需要做好的三件事。</P>
              <P>
                <strong>第一层 · 时光机</strong>：你可以选择历史上任意时间点，加载该时刻的真实币安 K 线数据，以 1x-100x 倍速重放行情，并进行模拟下单。这让"过去 5 年的市场"变成你的训练场。对交易者来说，它最实用的价值是：你可以反复练同一种行情，而不是被动等待下一次市场给机会。
              </P>
              <P>
                <strong>第二层 · 错题集闭环</strong>：交易能力的提升不在交易本身，而在复盘。本系统内置一套完整的负反馈控制系统——双时点记录 + 模式聚类 + 反事实回放 + 规则回写——让你的每个错误都不只是事件，而是可被分析、归类、并最终被消除的系统漏洞。你真正要练的不是"这单赚没赚"，而是"我为什么会在这种情境下做出这种决定"。
              </P>
              <P>
                <strong>第三层 · 硬约束守卫</strong>：有些规则不能依赖你"情绪上头时仍然冷静"。系统在关键决策点上把这些规则做成无法绕过的硬约束——例如"禁止使用全仓"。这是 Ulysses Pact 的工程化实现。
              </P>
              <P>
                <strong>元认知层</strong>：系统会逼你在下单前回答四个问题: 我看到了什么？我相信什么会发生？我准备承受多少错误成本？我现在的心理状态会不会污染这笔决策？这些字段不是为了把表单做复杂，而是为了把"当下的你"暴露给"事后的你"。这正是元认知设计的核心。
              </P>
              <Highlight>
                "一次错误是事件，三次同模式是系统。错题集让你的眼睛在物理上看到这种系统性。元认知记录让你看见'是谁在下单'，硬约束则让你不需要每次都靠意志力——把意志力留给值得的战斗。"
              </Highlight>
            </div>
          </section>

          <section id="s3" className="scroll-mt-20">
            <SectionTitle accent="hsl(var(--primary))">3. 主界面分区</SectionTitle>
            <P>主交易页 1:1 复刻币安永续合约专业版。从实操角度，建议你的使用顺序是：先定时间和节奏，再读盘，再决定要不要下单，最后把结果送进复盘中心。</P>

            <section id="s3-1" className="scroll-mt-20">
              <SubTitle>3.1 时光机控制条（TIME MACHINE）</SubTitle>
              <div className="space-y-2">
                <P><strong>位置</strong>：顶部条</P>
                <P><strong>目的</strong>：选择历史时间点并控制回放速度</P>
                <P><strong>操作</strong>：</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>输入历史时间（例如 2024-01-15 16:00:00）</li>
                  <li>点击 "启动"</li>
                  <li>系统加载该时刻的所有数据并开始按真实时间 1:1 推进</li>
                  <li>倍速：1x / 2x / 5x / 10x / 50x / 100x</li>
                  <li>中途可暂停 / 恢复 / 跳转</li>
                </ul>
                <P>注意："启动"后所有的盘口、持仓盈亏、订单状态都以这个模拟时间为唯一真理源。</P>
                <P>实操建议：不要一上来就用 100x。先用 1x-5x 找节奏，再用 10x-50x 刷同类行情，最后再回到 1x 检查自己在慢节奏下是否仍然执行同一套规则。</P>
              </div>
            </section>

            <section id="s3-2" className="scroll-mt-20">
              <SubTitle>3.2 K 线主图</SubTitle>
              <div className="space-y-2">
                <P><strong>位置</strong>：中央偏左</P>
                <P><strong>目的</strong>：还原币安专业版图表体验</P>
                <P><strong>支持</strong>：</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>多周期切换 1m / 3m / 5m / 15m / 30m / 1h / 4h / 1d / 1w / 1M</li>
                  <li>内置技术指标</li>
                  <li>手动画线工具</li>
                  <li>多图表布局 1x1 / 1x2 / 2x2</li>
                  <li>全屏切换</li>
                </ul>
                <P>实操建议：把图表当作"做假设"的地方，而不是"找借口"的地方。入场前先明确你看到的是趋势延续、结构反转还是区间波动，否则后面的开仓理由很容易变成事后补作文。</P>
              </div>
            </section>

            <section id="s3-3" className="scroll-mt-20">
              <SubTitle>3.3 订单簿与最新成交</SubTitle>
              <div className="space-y-2">
                <P><strong>位置</strong>：图表右侧</P>
                <P><strong>目的</strong>：还原盘口微观结构</P>
                <P>让你训练对挂单分布、买卖力量对比、成交节奏的感知——这些在真实交易中很重要但常被忽略。</P>
                <P>实操建议：如果你的系统不依赖微观结构，就不要在这里临时找理由加仓；如果你的系统依赖微观结构，就要把盘口看到的东西写进开仓理由，而不是只停留在"感觉有承接"这种模糊表述。</P>
              </div>
            </section>

            <section id="s3-4" className="scroll-mt-20">
              <SubTitle>3.4 下单面板（核心：开仓快照）</SubTitle>
              <div className="space-y-3">
                <P><strong>位置</strong>：最右侧</P>
                <P><strong>目的</strong>：模拟真实下单流程</P>
                <P><strong>关键功能</strong>：</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>市价单 / 限价单 / 止盈止损</li>
                  <li>杠杆 1x-125x（按币种独立保存，主力/对冲共享同一杠杆）</li>
                  <li>仓位模式：逐仓 / 全仓（详见 §3.7 硬约束）</li>
                  <li>持仓模式：单向 / 双向（多空对冲）</li>
                </ul>
                <P><strong>每次下单前会强制弹出"开仓快照"——这是错题集系统的事前点。</strong></P>
                <P><strong>开仓快照里要填什么（按顺序）</strong>：</P>
                <ol className="list-decimal pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li><Star /> <strong>订单类型</strong> 必选——主力单 / 对冲单（详见 §3.6）</li>
                  <li><Star /> <strong>仓位模式</strong> 必选——必须为"逐仓"。选"全仓"时确认按钮永久置灰（详见 §3.7）</li>
                  <li><strong>开仓理由 / 对冲理由</strong>（≥20 字）</li>
                  <li><strong>预设止盈档位</strong>（仅主力单，最多 3 档）</li>
                  <li><strong>仓位规模 USDT</strong>（仅主力单）</li>
                  <li>
                    <Star /> <strong>本次愿意承受最大亏损 USDT</strong>（仅主力单）——手填，不再由止损价反算
                    <ul className="list-disc pl-6 mt-1 space-y-1">
                      <li>系统自动换算为总账户百分比，&gt;5% 时变红警示</li>
                      <li>这个数字是后续 R 倍数计算的分母</li>
                    </ul>
                  </li>
                  <li><strong>心态自评 1-5 分</strong>——所有订单必填；≤2 分时需勾选"仍坚持交易"才能解锁确认按钮</li>
                  <li><strong>心态触发原因</strong>（条件显示：心态 ≤3 时必填）</li>
                  <li><strong>当时对风险的认识</strong>（仅主力单）</li>
                  <li><strong>当时对风险的管理方式</strong>（仅主力单）</li>
                  <li><strong>Checklist 通过</strong>（仅主力单）——4 个必填项 + 至少 2 个可选项</li>
                </ol>
                <P>如果你是实盘交易者，最该认真对待的是第 3、6、7、8、9、10 项。它们共同回答的是：你为什么现在要出手、这笔最多亏多少、你的情绪有没有污染判断、以及你到底有没有想清楚风险。这些字段组合起来，就是系统的元认知快照。</P>
                <Highlight>
                  "开仓快照不是负担，是这个系统区别于其他模拟器的关键。它强制把你的判断、心态、风险认识固化为不可篡改的记录。三个月后回头看，你会发现这些记录比你的盈亏数字更有价值。"
                </Highlight>
                <P><strong>关于"最大亏损"为什么是手填而不是由止损价反算</strong>：</P>
                <P>
                  把"具体在哪个价格止损"和"这笔我愿意亏多少"分开——前者是市场结构决定的（应该根据 ATR、支撑位、流动性来动态判断），后者是你的心理上限（应该在你冷静时决定）。把两者强行绑定，会让你"为了凑止损位"而违反风险预算，或"为了凑风险预算"而把止损放在没有市场结构意义的地方。
                </P>
                <P>元认知上的意义在于：系统不是只记录"你做了什么"，而是记录"你是以什么心理和风险叙事去做这件事"。这会直接决定你事后复盘时看到的是市场问题，还是决策者自己的问题。</P>
              </div>
            </section>

            <section id="s3-5" className="scroll-mt-20">
              <SubTitle>3.5 持仓与历史面板</SubTitle>
              <div className="space-y-2">
                <P><strong>位置</strong>：底部 Tab</P>
                <P><strong>目的</strong>：实时显示账户全貌</P>
                <P><strong>包含</strong>：</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>仓位 / 当前委托 / 历史委托 / 历史成交 / 资金流水 / 仓位历史记录 / 机器人 / 资产</li>
                  <li>每笔历史交易都关联一份可复盘的 journal</li>
                  <li>历史 Tab 中未评价的交易会显示警示按钮 [立即评价]</li>
                  <li>历史 Tab 字段：开仓时间 / 平仓时间 / 开仓价 / 平仓价 / <strong>平仓方式（手动 / 止损 / 止盈 1-3 / 爆仓）</strong></li>
                </ul>
                <P>实操上，这里不是给你看"今天赚了多少"，而是给你快速抽样自己的执行质量。尤其是未评价交易，不要积压，因为拖延越久，元认知对照就越失真。</P>
              </div>
            </section>

            <section id="s3-6" className="scroll-mt-20">
              <SubTitle>3.6 关于订单类型：主力单 vs 对冲单</SubTitle>
              <div className="space-y-3">
                <P>为什么需要区分这两类订单？因为它们的"什么算错"的标准完全不同。</P>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">维度</th>
                        <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">主力单</th>
                        <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">对冲单</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="px-3 py-2 border-t border-border text-foreground">本质</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">方向性下注</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">防御性头寸</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 border-t border-border text-foreground">成功标准</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">单笔正期望</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">整体头寸的最大回撤被压缩</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 border-t border-border text-foreground">错的形式</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">看错方向 / 仓位过大 / 心态驱动</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">对冲过度 / 对冲不足 / 反向对冲</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 border-t border-border text-foreground">该不该设止盈止损</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">必须</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">不应该（对冲单的"止盈"=主力仓平仓）</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 border-t border-border text-foreground">该不该过 checklist</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">必须</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">不需要</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <P>如果把两类订单混在一起评价，你会看到"对冲单的 R 倍数普遍偏低"——这不是错误，这是对冲单本来就该长这样。</P>
                <P>所以在系统里：</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>开仓快照对主力单要求完整的"理由 + 风控规划 + checklist 四件套"</li>
                  <li>开仓快照对对冲单<strong>只要求"对冲理由 + 心态自评"</strong>——其他全部省略</li>
                  <li>错题集默认只显示主力单，避免对冲单污染模式统计</li>
                  <li>元监控页有独立卡片对比两类订单（详见 §4.2）</li>
                </ul>
                <P>元认知上的关键区别是：主力单暴露的是你的方向判断能力，对冲单暴露的是你面对浮亏时的稳定性。如果你频繁开对冲单，不一定说明你会管理风险，也可能说明你不愿意直视主力仓已经错了。</P>
                <P><strong>关于杠杆：</strong></P>
                <P>同一标的的主力单与对冲单使用同一个杠杆设置——这是系统级的设计约束，符合真实合约市场的杠杆机制。这意味着：</P>
                <P>（a）你为主力单调过的杠杆，会自动应用到对冲单；</P>
                <P>（b）你想为对冲单单独降低杠杆，必须先平掉主力仓并把杠杆改低后再开。</P>
                <P>这个约束符合真实合约市场的杠杆机制，也避免你用"对冲单"变相绕过自己设定的杠杆上限。</P>
                <Highlight>
                  "30 天后看一眼元监控页的'订单类型分布'卡片，问自己：我的对冲单总数，是不是远超过主力单总数？如果是，你的'对冲'很可能不是策略性对冲，而是焦虑情绪的延伸——用对冲单来缓解'看到亏损'的痛苦，而不是真正在管理风险敞口。这是一个隐蔽但非常常见的反模式，只有把订单类型分开统计后才能看见。"
                </Highlight>
              </div>
            </section>

            <section id="s3-7" className="scroll-mt-20">
              <SubTitle>3.7 关于硬约束：尤利西斯契约</SubTitle>
              <div className="space-y-3">
                <P>软提示（warning + 用户可勾选"我知道风险继续"）和硬约束（无绕过路径）的差异，在反脆弱里属于决策维度的本质区别。</P>
                <P><strong>软提示假设：</strong> 用户在每一次决策时都具有完整的元认知能力——能在情绪上头时仍然冷静评估"我现在是不是该绕过这条规则"。这个假设在认知心理学上是错的。情绪激动的人会系统性地高估自己绕过规则的合理性。</P>
                <P><strong>硬约束假设：</strong> 把规则定下来的是"冷静时的你"，要执行规则的是"情绪上头的你"。前者比后者聪明，所以前者写下的规则不应该被后者动态修改。</P>
                <P>这个设计哲学的根源在 Ulysses Pact（尤利西斯契约）——尤利西斯让水手把自己绑在桅杆上，并明确告诉他们：无论我之后多么哀求，都不许放开。</P>
                <P>从交易者视角看，硬约束的作用不是"限制发挥"，而是帮你把最容易在高波动里失真的部分交给系统托管。真正该靠主观能力的，是读盘、建模、等待和执行；不该靠情绪临场决定的，是仓位灾难边界。</P>
                <P><strong>本系统当前的硬约束清单：</strong></P>
                <div className="space-y-3">
                  <div>
                    <P><Star /> <strong>全仓模式硬阻断</strong></P>
                    <P>开仓快照里，如果当前标的的仓位模式为"全仓"，确认按钮永久置灰。提供"一键切换为逐仓"按钮，但不提供任何"仍坚持全仓"的绕过按钮。</P>
                    <P>原因：全仓让单笔爆仓直接拖垮整个账户。在交易训练阶段，应当一律使用逐仓——这是 Taleb 意义上"让损失有界"的最低要求。</P>
                  </div>
                  <div>
                    <P><Star /> <strong>Critical 模式强制规则</strong></P>
                    <P>同一错误模式 30 天内 ≥3 次且平均亏损时，系统弹出 MandatoryRuleDialog 强制要求你写一条新规则。该对话框不可关闭（除"写入规则"或"延后 24 小时"，每个 pattern 最多延后 1 次）。</P>
                  </div>
                </div>
                <RedHighlight>
                  "每一条软提示，都是潜在的爆仓入口。爆仓不是来自一次大错，而是来自一连串被绕过的小提醒。把最关键的几条升级为硬约束，是把意志力从'每次都要靠它'升级为'只在真正值得的战斗里用它'。"
                </RedHighlight>
              </div>
            </section>
          </section>

          <section id="s4" className="scroll-mt-20 bg-accent/30 border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <span className="inline-block px-2 py-0.5 rounded text-[10px] bg-[#F0B90B] text-black">
                核心能力
              </span>
              <div className="flex items-center gap-3">
                <span className="inline-block w-1 h-6 rounded bg-[#B080FF]" />
                <h2 className="text-[20px] font-medium text-foreground">4. 复盘中心 <Star /></h2>
              </div>
            </div>
            <P>复盘中心是这个系统的真正差异化能力。它不是普通的"交易日记"，而是一套完整的负反馈控制系统——让错误真正成为成长的输入。</P>
            <P>下面这些模块互为表里，彼此互联。对交易者来说，你可以把这里理解成"盘后真正赚钱的地方"——因为交易结果只提供样本，复盘中心才负责把样本加工成能力。</P>

            <div className="space-y-8 mt-6">
              <section id="s4-1" className="scroll-mt-20 space-y-3">
                <SubTitle>4.1 错题集（/journal）</SubTitle>
                <P><strong>目的</strong>：把分散的错误归类成"模式"，让你看到自己反复犯的系统性错误。</P>
                <P>实操上，打开错题集时不要先看哪一笔亏得最惨，而是先看哪一种错误在重复出现。单笔盈亏会放大情绪，模式统计才会暴露结构。</P>
                <P><strong>三个核心特性：</strong></P>
                <div className="space-y-3">
                  <div>
                    <P><strong>(1) 不是按时间排序，默认按错误模式聚类</strong>——这是和其他交易日记的根本区别。</P>
                    <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                      <li>Severity 分级：critical / high / medium / low</li>
                      <li>30 天内 ≥3 次的模式会被红色警示</li>
                      <li>每个模式卡片可展开查看：定义、时段分布、心态分布、标的分布、所有触发该模式的交易列表</li>
                    </ul>
                  </div>
                  <div>
                    <P><strong>(2) 每笔交易的元数据完整可见：</strong></P>
                    <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                      <li>开仓时间 / 平仓时间</li>
                      <li>开仓价 / 平仓价</li>
                      <li><Star /> <strong>平仓方式</strong>：手动 / 止损 / 止盈 1-3 / 爆仓</li>
                      <li>订单类型：主力 / 对冲</li>
                      <li>仓位模式：逐仓 / 全仓（守卫上线后应全部为逐仓）</li>
                      <li>心态自评</li>
                      <li>错误标签</li>
                    </ul>
                    <P>平仓方式这一列单独说一句——它能让你看见以前看不见的差异：</P>
                    <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                      <li>手动平仓 vs 自动平仓的 R 分布（你是不是在系统性地砍掉好仓位？）</li>
                      <li>被止损扫出 vs 自己主动认错的笔数对比（你的止损位是不是放在显眼位置？）</li>
                      <li>爆仓笔数（这个数字应该永远是 0）</li>
                    </ul>
                  </div>
                  <div>
                    <P><strong>(3) 三个视图切换 + 多维度筛选：</strong></P>
                    <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                      <li><strong>视图</strong>：按模式（默认）/ 按时间 / 未评价</li>
                      <li><strong>筛选</strong>：日期范围 / 标的 / 结果 / 错误大类 / 心态范围 / 订单类型</li>
                      <li>订单类型默认仅显示"主力单"（避免对冲单污染模式统计），用户可手动切换</li>
                    </ul>
                    <P>元认知上，这一页的真正任务是把"我最近状态不好"这种模糊感受，拆成可检验的句子，比如"当心态自评 ≤2 时，我更容易追单"。</P>
                  </div>
                </div>
              </section>

              <section id="s4-1-5" className="scroll-mt-20 space-y-3">
                <SubTitle>4.1.5 交易战役（/journal/campaigns）</SubTitle>
                <P><strong>核心概念</strong></P>
                <P>战役（Campaign）是复盘的高层单位。它由以下要素严格定义：</P>
                <ol className="list-decimal pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li><strong>同一标的</strong>：一个战役内的所有 legs 必须属于同一个 symbol（如全部是 BTCUSDT）</li>
                  <li><strong>同一方向</strong>：一个战役的主仓方向（main_long / main_short）由 main_open leg 决定，不可中途反转</li>
                  <li><strong>明确的开始与结束</strong>：每个战役有 opened_at 与 closed_at（active 战役 closed_at 为 null）</li>
                  <li><strong>结构化的 legs 组织</strong>：每条 leg 必须有明确的角色（leg_role），角色不可重复（互斥角色除外）</li>
                </ol>
                <P><strong>Legs 的角色规范</strong></P>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">角色</th>
                        <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">含义</th>
                        <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">order_kind 兼容性</th>
                        <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">战役内重复性</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="px-3 py-2 border-t border-border">main_open</td><td className="px-3 py-2 border-t border-border">主力开仓</td><td className="px-3 py-2 border-t border-border">main only</td><td className="px-3 py-2 border-t border-border"><strong>唯一</strong>（每个战役只能有 1 个）</td></tr>
                      <tr><td className="px-3 py-2 border-t border-border">hedge_initial_a / hedge_initial_b</td><td className="px-3 py-2 border-t border-border">初始双对冲</td><td className="px-3 py-2 border-t border-border">hedge only</td><td className="px-3 py-2 border-t border-border">各 1 个</td></tr>
                      <tr><td className="px-3 py-2 border-t border-border">hedge_rolling</td><td className="px-3 py-2 border-t border-border">滚动对冲</td><td className="px-3 py-2 border-t border-border">hedge only</td><td className="px-3 py-2 border-t border-border">可多次</td></tr>
                      <tr><td className="px-3 py-2 border-t border-border">mirror_tp</td><td className="px-3 py-2 border-t border-border">镜像止盈委托</td><td className="px-3 py-2 border-t border-border">hedge 或 main</td><td className="px-3 py-2 border-t border-border">通常 1 个</td></tr>
                      <tr><td className="px-3 py-2 border-t border-border">reentry_main</td><td className="px-3 py-2 border-t border-border">对冲触发后重新入场的主力</td><td className="px-3 py-2 border-t border-border">main only</td><td className="px-3 py-2 border-t border-border">可多次</td></tr>
                      <tr><td className="px-3 py-2 border-t border-border">reentry_hedge</td><td className="px-3 py-2 border-t border-border">重新入场后的新对冲</td><td className="px-3 py-2 border-t border-border">hedge only</td><td className="px-3 py-2 border-t border-border">可多次</td></tr>
                      <tr><td className="px-3 py-2 border-t border-border">standalone</td><td className="px-3 py-2 border-t border-border">独立不归属</td><td className="px-3 py-2 border-t border-border">任意</td><td className="px-3 py-2 border-t border-border">N/A</td></tr>
                    </tbody>
                  </table>
                </div>
                <P><strong>战役的两种来源</strong></P>
                <P>战役可以通过以下两种方式创建：</P>
                <P>(A) <strong>实时创建</strong>：每次开主力单时，开仓快照会自动询问“战役归属”。这种来源的战役 actual_evolution 事件最完整。</P>
                <P>(B) <strong>历史归类</strong>：通过 <code>/journal/campaigns/classify</code> 页面，把已有的 journal 手动归类。这种来源的战役会丢失部分事件（如 hedge_cancelled 与 hedge_placed 的精确时机），SOP 评分仅供参考。</P>
                <P><strong>实时归类 vs 历史归类的差异</strong></P>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] my-3 border border-border rounded overflow-hidden">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">维度</th>
                        <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">实时归类</th>
                        <th className="text-left px-3 py-2 font-medium text-foreground text-[10px]">历史归类</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td className="px-3 py-2 border-t border-border">actual_evolution 完整性</td><td className="px-3 py-2 border-t border-border">完整（含 cancel 与 place 事件）</td><td className="px-3 py-2 border-t border-border">仅含 leg 创建事件</td></tr>
                      <tr><td className="px-3 py-2 border-t border-border">SOP 评分准确性</td><td className="px-3 py-2 border-t border-border">高</td><td className="px-3 py-2 border-t border-border">中（缺少时序精度）</td></tr>
                      <tr><td className="px-3 py-2 border-t border-border">决策准确性指标</td><td className="px-3 py-2 border-t border-border">准确</td><td className="px-3 py-2 border-t border-border">准确（基于 K 线数据）</td></tr>
                      <tr><td className="px-3 py-2 border-t border-border">反事实回放</td><td className="px-3 py-2 border-t border-border">可用</td><td className="px-3 py-2 border-t border-border">可用</td></tr>
                      <tr><td className="px-3 py-2 border-t border-border">解除归属</td><td className="px-3 py-2 border-t border-border">可逆</td><td className="px-3 py-2 border-t border-border">可逆</td></tr>
                    </tbody>
                  </table>
                </div>
                <P><strong>历史归类的操作流程</strong></P>
                <P>进入 <code>/journal/campaigns/classify</code> 后：</P>
                <ol className="list-decimal pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li><strong>筛选</strong>：选择标的（必填）+ 日期范围。批量操作必须同标的，跨标的需分批处理。</li>
                  <li><strong>选择</strong>：勾选属于同一战役的 journals（多选）。</li>
                  <li><strong>决策</strong>：选择“归类为新战役”或“加入现有战役”。</li>
                  <li><strong>角色分配</strong>：在弹窗中为每条 leg 指定角色。系统会给出基于时序与 order_kind 的建议（confidence high/medium/low），用户可覆盖。</li>
                  <li><strong>校验</strong>：系统自动校验（同标的、互斥角色、时序合理性等）。</li>
                  <li><strong>提交</strong>：通过校验后写入数据库，跳转到该战役详情页。</li>
                </ol>
                <P><strong>校验规则（严格）</strong></P>
                <P>errors（必须修复）：</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>选中 journals 跨多标的</li>
                  <li>journal 当前已有 campaign_id（需先解除归属）</li>
                  <li>main_dual_hedge_mirror_tp 模板无 main_open leg</li>
                  <li>leg 角色与 journal 的 order_kind 不兼容</li>
                  <li>加入现有战役时，目标战役已有 main_open 而本次又含 main_open</li>
                </ul>
                <P>warnings（允许提交但提示）：</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>main_open 不是时间最早的 leg</li>
                  <li>缺少 hedge_initial_a 或 hedge_initial_b</li>
                  <li>legs 时间跨度 &gt; 7 天</li>
                  <li>hedge_rolling 时间早于 mirror_tp_triggered（语义异常）</li>
                </ul>
                <P><strong>解除归属</strong></P>
                <P>任何归类操作都是可逆的。在战役详情页的 legs 列表中，每条 leg 都有“解除”按钮：</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>解除后 journal.campaign_id = null</li>
                  <li>战役的 actual_evolution 保留一条 'note' 事件记录解除</li>
                  <li>其他 legs 不受影响</li>
                  <li>战役的 SOP 评分会自动重新计算</li>
                </ul>
                <P><strong>不支持的场景（明示）</strong></P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li><strong>不支持跨标的战役</strong>：BTC 和 ETH 的对冲组合无法在一个战役内表达。</li>
                  <li><strong>不支持反转主仓</strong>：主仓方向由 main_open 决定，中途不能反向。如果做了反向操作（先做多后做空），应当视为两个独立战役。</li>
                  <li><strong>不支持 standalone 与战役 leg 混合</strong>：一个 journal 要么独立（standalone）要么归属（leg），不能既是又不是。</li>
                  <li><strong>不支持手动添加非 journal 事件</strong>：如果你做了某个操作但当时没创建 journal（如手动取消委托），无法补录到 actual_evolution。</li>
                  <li><strong>不支持 mirror_tp 自动识别</strong>：系统不能从 order_kind 推断某 journal 是 mirror_tp，需用户手动指定。</li>
                </ul>
                <div className="rounded border border-[#F0B90B]/40 bg-[#F0B90B]/8 p-4 text-[14px] leading-relaxed text-foreground">
                  历史归类是补救工具，不是常规流程。最佳实践是从今天开始用“实时归类”——每次开主力单都立刻指定战役归属。
                  历史归类的 SOP 评分准确性低于实时归类，因此不要用历史归类的数据来评判“你的 SOP 执行能力”。
                  历史归类的真正价值在于：让你过去 N 个月的交易数据进入战役级复盘的视野，而不是让你为过去的执行打分。
                </div>
              </section>

              <section id="s4-1-6" className="scroll-mt-20 space-y-3">
                <SubTitle>4.1.6 战役级 SOP 评分的严谨性边界</SubTitle>
                <P>SOP 偏离度评分的有效性取决于以下前提：</P>
                <P><strong>前提 1：战役模板与你的实际策略匹配</strong></P>
                <P>如果你的实际打法不是“主仓 + 双对冲 + 镜像 TP”，请选择 <code>custom</code> 模板。custom 模板不参与 SOP 评分，避免错误信号。</P>
                <P><strong>前提 2：actual_evolution 事件完整</strong></P>
                <P>SOP 评分的扣分项之一是“mirror_tp 触发后 5 分钟内未取消任一 hedge”。这要求系统能看到 hedge_cancelled 事件。只有实时归类才会记录此事件。历史归类的战役在这一项上会得到默认分（既不加也不扣），导致评分偏高。</P>
                <P><strong>前提 3：legs 数据完整</strong></P>
                <P>每条 leg 必须有正确的 pre_simulated_time、entry_price、size。缺失任一项的 legs 会被视为异常，相关扣分项会标记 N/A。</P>
                <P><strong>前提 4：战役已结束</strong></P>
                <P>active 战役的 SOP 评分是即时快照，会随后续操作变化。最终评估应在战役结束后进行。</P>
                <RedHighlight>
                  如果你看到一个历史归类战役的 SOP 评分是 95 分 A 级，不要立刻自我表扬。
                  请打开 actual_evolution 看一眼，确认是否含完整的 cancel/place 事件。
                  如果没有，那个 A 分只是数据缺失造成的虚高，不代表你的真实执行水平。
                </RedHighlight>
              </section>

              <section id="s4-2" className="scroll-mt-20 space-y-3">
                <SubTitle>4.2 元监控（/journal/insights）</SubTitle>
                <P><strong>目的</strong>：回答"我在不在变好"这个唯一重要的问题。</P>
                <P>包含多张卡片，但你只需要关心一张：<strong>规则有效性追踪</strong>。</P>
                <P>这张表显示每条规则创建后，对应错误模式的频次是否真的下降了。</P>
                <P>如果你想把这页用到极致，一个很实操的习惯是每周只问三个问题：哪种错误下降了？哪种错误没变？哪种错误虽然少了，但换了另一种形式回来？第三个问题就是元认知监控的开始。</P>
                <RedHighlight>
                  "这个系统的全部价值在这张表上。如果你的规则在 60 天内让对应 pattern 频次下降，系统起作用了。如果没有，那条规则需要重写——不是 pattern 有问题，是规则不够'可操作'。"
                </RedHighlight>
                <P>其他卡片：</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                    <li><strong>错误模式趋势</strong>——每个 pattern 的频次随时间变化（向下 = 在被你修正）</li>
                    <li><strong>alpha 时段识别</strong>——找到你个人的"高胜率时间窗口"</li>
                    <li><strong>心态-收益散点</strong>——定位你的"非 alpha 状态"</li>
                    <li><Star /> <strong>订单类型分布</strong>——主力单 vs 对冲单的笔数、胜率、平均 R 对比。若对冲单平均 R 显著低于主力单，说明你的对冲多在情绪驱动下进行</li>
                    <li><Star /> <strong>平仓方式分布</strong>——手动/止损/止盈/爆仓的笔数与 R 分布。手动平仓 R 系统性低于止盈触发？说明你在截断盈利尾部</li>
                    <li><Star /> <strong>全仓笔数审计</strong>——守卫上线后该数字应全部为 0；非 0 即报警</li>
                    <li><strong>事后合理化预警</strong>——开仓理由被事后修改的笔数</li>
                    <li><strong>深度分析完成率</strong>——完成六步框架的 journal 占比</li>
                    <li><strong>未评价积压</strong>——未评价 journal 数</li>
                    <li><strong>元元监控</strong>——近 7 天评价数、新建模式数、激活规则数</li>
                </ul>
                <P>但记住：最重要的依然是那张"规则有效性追踪"表。其他都是辅助。</P>
              </section>

              <section id="s4-3" className="scroll-mt-20 space-y-3">
                <SubTitle>4.3 规则（/journal/rules）</SubTitle>
                <P><strong>目的</strong>：把错误模式转化为可执行的规则，注入下次开仓 checklist。</P>
                <P>写规则时最重要的实操标准只有一个：下一次开仓前，你能不能在 3 秒内判断这条规则是"已满足"还是"未满足"。如果不能，它更像口号，不像规则。</P>
                <P><strong>来源有两条：</strong></P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li><strong>自动生成</strong>：同一 pattern 30 天 ≥3 次且亏损时，系统通过 MandatoryRuleDialog 强制要求你写</li>
                  <li><strong>手动写入</strong>：通过六步分析框架的 Step 6 主动写</li>
                </ul>
                <P>每条规则可：</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>标记为"必填"或"可选"</li>
                  <li>启用/禁用切换</li>
                  <li>移出 checklist</li>
                  <li>显示来源（自动 / 六步框架）</li>
                </ul>
                <P>每次开仓快照打开时，所有"启用 + 已加入 checklist"的规则会自动出现在 checklist 列表中，需要勾选才能通过判定。</P>
              </section>

              <section id="s4-4" className="scroll-mt-20 space-y-3">
                <SubTitle>4.4 标签字典（/journal/tags）</SubTitle>
                <P><strong>目的</strong>：管理错误模式的两层字典。</P>
                <P><strong>第一层：6 大类（固定，不可改）</strong></P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>入场理由错</li>
                  <li>对冲/止损错</li>
                  <li>出场理由错</li>
                  <li>心态/认知状态错</li>
                  <li>该开没开错（特殊：用于记录"该开但没开"的决策）</li>
                  <li>流程错（checklist 未通过下单等）</li>
                </ul>
                <P><strong>第二层：用户自定义 pattern。</strong> 每个 pattern 必须配可操作定义（≥10 字符）——不能写"心态不好"，要写"交易前心态自评 ≤2 分"。</P>
              </section>

              <section id="s4-5" className="scroll-mt-20 space-y-3">
                <SubTitle>4.5 单笔复现（/journal/:id）</SubTitle>
                <P><strong>目的</strong>：把一笔交易完整"重演"，五通道同步。</P>
                <P>这不是为了回味一笔单子的好坏，而是为了让你重新站回当时那个决策节点，检查自己到底忽略了什么、脑内讲了什么故事、又是如何一步步把自己送到那个结果里的。</P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li><strong>通道 ①：盘面</strong> —— K 线回放 + 入场/出场标记 + 止盈线 + 三条垂直时间线锚定决策/出场/当前</li>
                  <li><strong>通道 ②：决策</strong> —— 你当时写的开仓理由、止盈、checklist 状态、最大亏损金额、杠杆、仓位模式</li>
                  <li><strong>通道 ③：状态</strong> —— 心态自评、心态触发原因、历史对照</li>
                  <li><strong>通道 ④：风险认识与管理</strong> —— 你当时怎么想风险，事后对照实际</li>
                  <li><strong>通道 ⑤：反事实</strong> —— 六步深度分析 + 反事实回放</li>
                </ul>
                <P>可以拖动时间轴、按倍速回放、跳转到决策时刻或出场时刻。</P>
              </section>

              <section id="s4-6" className="scroll-mt-20 space-y-3">
                <SubTitle>4.6 六步深度分析框架</SubTitle>
                <P><strong>目的</strong>：把模糊的复盘文字升级为可分析的结构化数据。</P>
                <P>这 6 步本质上是一套元认知拆解流程：它迫使你把"我觉得"拆成"我看到了什么、我推断了什么、市场实际上回应了什么、我到底错在观察、推理、执行，还是情绪"。</P>
                <P><strong>六步：</strong></P>
                <ol className="list-decimal pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li><strong>错误场景</strong> - 当时市场上下文 + 你的身体心态状态</li>
                  <li><strong>原始假设</strong> - 你当时相信什么会发生</li>
                  <li><strong>现实反馈</strong> - 市场实际怎么回应、哪里和假设不符</li>
                  <li><strong>错误类型</strong> - 一句话归纳错误的类别（同时在标签选择器打 pattern）</li>
                  <li><strong>真正问题</strong> - 根因诊断，不是现象层</li>
                  <li><strong>新规则</strong> - 写一条具体可勾选的规则</li>
                </ol>
                <P><strong>Step 6 可一键写入 checklist。</strong> 这是闭环的关键一步。</P>
                <Highlight>
                  "绝大多数复盘卡在第 5 步——'我太冲动了'——从不真正到达第 6 步。系统的反脆弱价值，全部在 Step 5 到 Step 6 的跳跃。"
                </Highlight>
              </section>

              <section id="s4-7" className="scroll-mt-20 space-y-3">
                <SubTitle>4.7 反事实回放</SubTitle>
                <P><strong>目的</strong>：验证你的"修正方案"是否真的有效。</P>
                <P><strong>操作：</strong></P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>输入修正后的参数：入场价、止损、止盈、仓位、入场时间偏移</li>
                  <li>系统在已加载的 K 线数据上自动跑虚拟分支</li>
                  <li>在 K 线图上叠加紫色轨迹</li>
                  <li>显示"真实 vs 反事实"对比表</li>
                </ul>
                <P>每笔 journal 最多保存 10 条分支（如"止损更宽 / 仓位减半 / 不开仓"），可分别对比。</P>
                <P><strong>注意：</strong> 反事实表单的"止损价"默认为空——这是反事实假设的核心问题之一："如果我用不同的止损位会怎样？"</P>
              </section>
            </div>
          </section>

          <section id="s5" className="scroll-mt-20">
            <SectionTitle accent="#F0B90B">5. 完整学习闭环</SectionTitle>
            <div className="space-y-3">
              <P>整套系统是一个完整的负反馈控制环。</P>
              <div className="bg-card border border-border rounded p-6">
                <FlowNode>开仓申请</FlowNode>
                <FlowArrow />
                <FlowNode accent star>强制快照（订单类型 → 仓位模式硬阻断 → checklist + 你的规则）</FlowNode>
                <FlowArrow />
                <FlowNode>下单 → 持仓 → 平仓</FlowNode>
                <FlowArrow />
                <FlowNode>强制评价 → 打标签 → 六步分析</FlowNode>
                <FlowArrow />
                <FlowNode accent star>critical 模式检测 → 强制规则 OR 主动 Step 6 写规则</FlowNode>
                <FlowArrow />
                <FlowNode>新规则自动注入下次 checklist</FlowNode>
                <FlowArrow />
                <FlowNode>同类错误被 checklist 拦截</FlowNode>
                <FlowArrow />
                <FlowNode>该模式频次下降（在元监控可见）</FlowNode>
                <FlowArrow />
                <FlowNode>回到顶端...</FlowNode>
              </div>
              <P>每个节点都不可或缺。少了任何一环，系统会退化成普通的"交易日记"。</P>
              <P>
                特别要注意 <Star /> 标记的硬约束节点（仓位模式 = 逐仓、心态 ≤2 额外确认、critical 模式强制规则）——它们是整个流程里"不可绕过"的关键卡口。<strong>软提示可以被情绪绕过，硬约束不能。</strong>
              </P>
              <P>如果从元认知角度看，这个闭环真正完成了三件事：记录你当时的主观模型，记录市场随后给出的客观反馈，再把两者之间的偏差强制翻译成一条下次能执行的规则。交易成长不是来自多做几单，而是来自这种偏差被反复缩小。</P>
            </div>
          </section>

          <section id="s7" className="scroll-mt-20">
            <SectionTitle accent="#B080FF">6. 一句话总结</SectionTitle>
            <div className="bg-card border-l-4 border-[#F0B90B] rounded-r p-6 my-8">
              <p className="text-[24px] leading-relaxed text-foreground text-center">
                "这不是模拟器，是训练机器。判断它是否在为你工作的唯一标准，是元监控里那张'规则有效性追踪'表——其他一切都可以欺骗你，那张表不能。"
              </p>
            </div>
            <div className="mt-8 flex flex-col items-center gap-2">
              <Link to="/">
                <button className="bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black h-10 px-6 rounded font-medium">
                  进入交易页 →
                </button>
              </Link>
              <div className="text-[11px] text-muted-foreground">
                任何时候都可以从左上角 logo 旁的"使用说明"重新打开本页。
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
