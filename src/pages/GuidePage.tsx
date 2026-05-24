/**
 * /guide — 新用户使用说明页
 * 总-分-总结构，重点突出"复盘中心"。纯展示页，无 API 调用。
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  List,
  Clock,
  BarChart3,
  BookMarked,
  Tag as TagIcon,
  ScrollText,
  Sparkles,
  GitBranch,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

interface TocItem {
  id: string;
  label: string;
  children?: TocItem[];
}

const TOC: TocItem[] = [
  { id: "s1", label: "1. 这是什么" },
  { id: "s2", label: "2. 核心理念" },
  {
    id: "s3",
    label: "3. 主界面分区",
    children: [
      { id: "s3-1", label: "3.1 时光机" },
      { id: "s3-2", label: "3.2 K 线主图" },
      { id: "s3-3", label: "3.3 订单簿与成交流水" },
      { id: "s3-4", label: "3.4 下单面板" },
      { id: "s3-5", label: "3.5 持仓与历史" },
      { id: "s3-6", label: "3.6 关于订单类型（新）" },
    ],
  },
  {
    id: "s4",
    label: "4. 复盘中心 ★",
    children: [
      { id: "s4-1", label: "4.1 错题集" },
      { id: "s4-2", label: "4.2 元监控" },
      { id: "s4-3", label: "4.3 规则" },
      { id: "s4-4", label: "4.4 标签字典" },
      { id: "s4-5", label: "4.5 单笔复现" },
      { id: "s4-6", label: "4.6 六步深度分析" },
      { id: "s4-7", label: "4.7 反事实回放" },
    ],
  },
  { id: "s5", label: "5. 完整学习闭环" },
  { id: "s6", label: "6. 三天上手指南" },
  { id: "s7", label: "7. 一句话总结" },
];

const FLAT_TOC = TOC.flatMap((t) => [t, ...(t.children ?? [])]);

function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-accent/50 border-l-2 border-[#F0B90B] pl-4 py-2 rounded-r text-[14px] leading-relaxed text-foreground">
      {children}
    </div>
  );
}

function Star() {
  return <span className="text-[#F0B90B]">★</span>;
}

function SectionTitle({ children, accent }: { children: React.ReactNode; accent?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="inline-block w-1 h-6 rounded" style={{ background: accent ?? "hsl(var(--primary))" }} />
      <h2 className="text-[20px] font-medium text-foreground">{children}</h2>
    </div>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[15px] font-medium text-foreground mt-6 mb-2">{children}</h3>;
}

function P({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[14px] leading-relaxed text-foreground/90 ${className}`}>{children}</p>;
}

function TocList({ activeId, onJump }: { activeId: string; onJump?: () => void }) {
  return (
    <nav className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">目录</div>
      {TOC.map((item) => (
        <div key={item.id}>
          <a
            href={`#${item.id}`}
            onClick={onJump}
            className={`block h-8 px-2 leading-8 text-[12px] rounded hover:bg-accent cursor-pointer ${
              activeId === item.id ? "bg-accent text-foreground border-l-2 border-[#F0B90B]" : "text-muted-foreground"
            }`}
          >
            {item.id === "s4" ? (
              <>
                4. 复盘中心 <span className="text-[#F0B90B]">★</span>
              </>
            ) : (
              item.label
            )}
          </a>
          {item.children?.map((c) => (
            <a
              key={c.id}
              href={`#${c.id}`}
              onClick={onJump}
              className={`block h-7 pl-6 pr-2 leading-7 text-[11px] rounded hover:bg-accent cursor-pointer ${
                activeId === c.id ? "bg-accent text-foreground border-l-2 border-[#F0B90B]" : "text-muted-foreground"
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

function FlowNode({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <div
      className={`bg-card border rounded p-3 text-[13px] text-center max-w-[420px] mx-auto ${
        accent ? "border-[#F0B90B]" : "border-border"
      }`}
    >
      {children}
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex justify-center my-2 text-muted-foreground">
      <svg width="14" height="20" viewBox="0 0 14 20" fill="none">
        <line x1="7" y1="0" x2="7" y2="14" stroke="currentColor" strokeWidth="1" />
        <polyline points="2,12 7,19 12,12" stroke="currentColor" strokeWidth="1" fill="none" />
      </svg>
    </div>
  );
}

export default function GuidePage() {
  const nav = useNavigate();
  const [activeId, setActiveId] = useState<string>("s1");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );
    FLAT_TOC.forEach((t) => {
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
            <Button className="h-8 bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black text-[12px]">进入交易页</Button>
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
          {/* Section 1 */}
          <section id="s1" className="scroll-mt-20">
            <SectionTitle>1. 这是什么</SectionTitle>
            <div className="space-y-3">
              <P>
                无知之幕（Veil of
                Ignorance）是一个加密货币合约交易的"时光机模拟器"。它的存在是为了让你在不损失真实资金的前提下，把交易能力训练到足以面对真实市场的程度。
              </P>
              <P>
                它不是一个"游戏"，也不是一个"沙盒"。它是一台训练机器——目标是让你每一次错误都成为可被分析、可被消除的输入信号。
              </P>
              <P>
                <strong>数据来源</strong>：完全使用币安 USDT 永续合约真实历史数据。
              </P>
              <P>
                <strong>"无知之幕"的字面含义</strong>：在回放过程中，你永远看不到未来——K 线按真实时间 1:1
                流速推进，不会暴露你尚未抵达的数据。
              </P>
            </div>
          </section>

          {/* Section 2 */}
          <section id="s2" className="scroll-mt-20">
            <SectionTitle>2. 核心理念</SectionTitle>
            <div className="space-y-3">
              <P>理念分两层。</P>
              <P>
                <strong>第一层 · 时光机</strong>：你可以选择历史上任意时间点，加载该时刻的真实币安 K 线数据，以 1x-100x
                倍速重放行情，并进行模拟下单。这让"过去 5 年的市场"变成你的训练场。
              </P>
              <P>
                <strong>第二层 · 错题集闭环</strong>
                ：交易能力的提升不在交易本身，而在复盘。本系统内置一套完整的负反馈控制系统——双时点记录 + 模式聚类 +
                反事实回放 + 规则回写——让你的每个错误都不只是事件，而是可被分析、归类、并最终被消除的系统漏洞。
              </P>
              <Highlight>"一次错误是事件，三次同模式是系统。错题集要让你的眼睛在物理上看到这种系统性。"</Highlight>
            </div>
          </section>

          {/* Section 3 */}
          <section id="s3" className="scroll-mt-20">
            <SectionTitle>3. 主界面分区</SectionTitle>
            <P>主交易页 1:1 复刻币安永续合约专业版。从上到下、从左到右介绍：</P>

            <section id="s3-1" className="scroll-mt-20">
              <SubTitle>
                <Clock className="inline w-4 h-4 mr-1" />
                3.1 时光机控制条（TIME MACHINE）
              </SubTitle>
              <div className="space-y-2">
                <P>
                  <strong>位置</strong>：顶部条
                </P>
                <P>
                  <strong>目的</strong>：选择历史时间点并控制回放速度
                </P>
                <P>
                  <strong>操作</strong>：
                </P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>输入历史时间（例如 2024-01-15 16:00:00）</li>
                  <li>点击 "启动"</li>
                  <li>系统加载该时刻的所有数据并开始按真实时间 1:1 推进</li>
                  <li>倍速可调：1x / 2x / 5x / 10x / 50x / 100x</li>
                  <li>中途可暂停 / 恢复 / 跳转</li>
                </ul>
                <P>注意："启动"后所有的盘口、持仓盈亏、订单状态都以这个模拟时间为唯一真理源。</P>
              </div>
            </section>

            <section id="s3-2" className="scroll-mt-20">
              <SubTitle>
                <BarChart3 className="inline w-4 h-4 mr-1" />
                3.2 K 线主图
              </SubTitle>
              <div className="space-y-2">
                <P>
                  <strong>位置</strong>：中央偏左
                </P>
                <P>
                  <strong>目的</strong>：还原币安专业版图表体验
                </P>
                <P>
                  <strong>支持</strong>：
                </P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>多周期切换 1m / 3m / 5m / 15m / 30m / 1h / 4h / 1d / 1w / 1M</li>
                  <li>内置技术指标</li>
                  <li>手动画线工具</li>
                  <li>多图表布局 1x1 / 1x2 / 2x2</li>
                  <li>全屏切换</li>
                </ul>
              </div>
            </section>

            <section id="s3-3" className="scroll-mt-20">
              <SubTitle>3.3 订单簿与最新成交</SubTitle>
              <div className="space-y-2">
                <P>
                  <strong>位置</strong>：图表右侧
                </P>
                <P>
                  <strong>目的</strong>：还原盘口微观结构
                </P>
                <P>让你训练对挂单分布、买卖力量对比、成交节奏的感知——这些在真实交易中很重要但常被忽略。</P>
              </div>
            </section>

            <section id="s3-4" className="scroll-mt-20">
              <SubTitle>3.4 下单面板</SubTitle>
              <div className="space-y-3">
                <P>
                  <strong>位置</strong>：最右侧
                </P>
                <P>
                  <strong>目的</strong>：模拟真实下单流程
                </P>
                <P>
                  <strong>关键功能</strong>：
                </P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>市价单 / 限价单 / 止盈止损</li>
                  <li>杠杆 1x-125x（按币种独立保存）</li>
                  <li>仓位模式：逐仓 / 全仓</li>
                  <li>持仓模式：单向 / 双向（多空对冲）</li>
                  <li>
                    <strong>每次下单前会强制弹出"开仓快照"——这是错题集系统的事前点</strong>
                  </li>
                </ul>
                <P>
                  <strong>开仓快照里要填什么</strong>：
                </P>
                <ol className="list-decimal pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>
                    <strong>订单类型</strong> <Star /> 必选——主力单 / 对冲单。两类订单的记录字段完全不同（详见 §3.6）
                  </li>
                  <li>
                    <strong>开仓理由 / 对冲理由</strong>（≥20 字）
                  </li>
                  <li>
                    <strong>预设止盈档位</strong>（仅主力单，最多 3 档）
                  </li>
                  <li>
                    <strong>仓位规模 USDT</strong>（仅主力单）
                  </li>
                  <li>
                    <strong>本次愿意承受最大亏损 USDT</strong> <Star />
                    （仅主力单）——这是手填的，不再由止损价反算
                    <ul className="list-disc pl-6 mt-1 space-y-1">
                      <li>系统会自动换算为总账户百分比，&gt;5% 时变红警示</li>
                      <li>这个数字是后续 R 倍数计算的分母</li>
                    </ul>
                  </li>
                  <li>
                    <strong>心态自评 1-5 分</strong>——所有订单都必须填；≤2 分时需勾选"仍坚持交易"才能解锁确认按钮
                  </li>
                  <li>
                    <strong>当时对风险的认识 / 当时对风险的管理方式</strong>（仅主力单）
                  </li>
                  <li>
                    <strong>Checklist 通过</strong>（仅主力单）——4 个必填项 + 至少 2 个可选项
                  </li>
                </ol>
                <Highlight>
                  "开仓快照不是负担，是这个系统区别于其他模拟器的关键。它强制把你的判断、心态、风险认识固化为不可篡改的记录。三个月后回头看，你会发现这些记录比你的盈亏数字更有价值。"
                </Highlight>
                <P>
                  <strong>关于"最大亏损"为什么是手填而不是从止损价反算</strong>：
                </P>
                <P>
                  把"具体在哪个价格止损"和"这笔我愿意亏多少"分开，是因为前者是市场结构决定的（应该根据
                  ATR、支撑位、流动性来动态判断），后者是你的心理上限（应该在你冷静时决定）。
                </P>
                <P>
                  把两者强行绑定，会让你"为了凑止损位"而违反风险预算，或者"为了凑风险预算"而把止损放在没有市场结构意义的地方。
                </P>
              </div>
            </section>

            <section id="s3-5" className="scroll-mt-20">
              <SubTitle>3.5 持仓与历史面板</SubTitle>
              <div className="space-y-2">
                <P>
                  <strong>位置</strong>：底部 Tab
                </P>
                <P>
                  <strong>目的</strong>：实时显示账户全貌
                </P>
                <P>
                  <strong>包含</strong>：
                </P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>仓位 / 当前委托 / 历史委托 / 历史成交 / 资金流水 / 仓位历史记录 / 机器人 / 资产</li>
                  <li>每笔历史交易都关联一份可复盘的 journal</li>
                  <li>历史 Tab 中未评价的交易会显示警示按钮</li>
                </ul>
              </div>
            </section>

            <section id="s3-6" className="scroll-mt-20">
              <SubTitle>3.6 关于订单类型（主力单 vs 对冲单）</SubTitle>
              <div className="space-y-3">
                <P>
                  <strong>为什么需要区分这两类订单？</strong>
                </P>
                <P>因为它们的"什么算错"的标准完全不同。</P>
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
                        <td className="px-3 py-2 border-t border-border text-foreground">
                          看错方向 / 仓位过大 / 心态驱动
                        </td>
                        <td className="px-3 py-2 border-t border-border text-foreground">
                          对冲过度 / 对冲不足 / 反向对冲
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 border-t border-border text-foreground">该不该设止盈止损</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">必须</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">
                          不应该（对冲单的"止盈"=主力仓平仓）
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 border-t border-border text-foreground">该不该过 checklist</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">必须</td>
                        <td className="px-3 py-2 border-t border-border text-foreground">不需要</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <P>
                  如果你把两类订单混在一起评价，你会看到"对冲单的 R 倍数普遍偏低"——这不是错误，
                  <strong>这是对冲单本来就该长这样</strong>。
                </P>
                <P>
                  <strong>所以在系统里</strong>：
                </P>
                <ul className="list-disc pl-6 text-[14px] text-foreground/90 space-y-1">
                  <li>开仓快照对主力单要求完整的"理由 + 风控规划 + checklist 四件套"</li>
                  <li>
                    开仓快照对对冲单<strong>只要求"对冲理由 + 心态自评"</strong>——其他全部省略
                  </li>
                  <li>错题集默认只显示主力单，避免对冲单污染模式统计</li>
                  <li>元监控页有独立卡片对比两类订单（详见 §4.2）</li>
                </ul>
                <Highlight>
                  "30
                  天后看一眼元监控页的'订单类型分布'卡片，问自己：我的对冲单总数，是不是远超过主力单总数？如果是，你的'对冲'很可能不是策略性对冲，而是焦虑情绪的延伸——用对冲单来缓解'看到亏损'的痛苦，而不是真正在管理风险敞口。这是一个隐蔽但非常常见的反模式，只有把订单类型分开统计后才能看见。"
                </Highlight>
              </div>
            </section>
          </section>

          {/* Section 4 — 复盘中心（核心） */}
          <section id="s4" className="scroll-mt-20 bg-accent/30 border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <BookOpen className="w-6 h-6 text-[#F0B90B]" />
              <h2 className="text-[20px] font-medium text-foreground">4. 复盘中心</h2>
              <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-[#F0B90B] text-black">
                核心能力
              </span>
            </div>
            <P>
              复盘中心是这个系统的真正差异化能力。它不是一个普通的"交易日记"，而是一套完整的负反馈控制系统——让错误真正成为成长的输入。
            </P>
            <P>下面 7 个模块互为表里，彼此互联。</P>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
              <section id="s4-1" className="scroll-mt-20 bg-card border border-border rounded p-4">
                <h3 className="text-[14px] font-medium text-foreground mb-2 flex items-center gap-2">
                  <BookMarked className="w-4 h-4 text-[#F0B90B]" /> 4.1 错题集（/journal）
                </h3>
                <P>
                  <strong>目的</strong>：把分散的错误归类成"模式"，让你看到自己反复犯的系统性错误。
                </P>
                <P className="mt-2">
                  <strong>三个核心特性</strong>：
                </P>
                <div className="space-y-3 mt-2 text-[13px] text-foreground/90">
                  <div>
                    <P className="text-[13px]">
                      (1) <strong>不是按时间排序，默认按错误模式聚类</strong>——这是和其他交易日记的根本区别。
                    </P>
                    <ul className="list-disc pl-6 space-y-1 mt-1">
                      <li>Severity 分级：critical / high / medium / low</li>
                      <li>30 天内 ≥3 次的模式会被红色警示</li>
                      <li>每个模式卡片可展开查看：定义、时段分布、心态分布、标的分布、所有触发该模式的交易列表</li>
                    </ul>
                  </div>
                  <div>
                    <P className="text-[13px]">
                      (2) <strong>每笔交易的元数据完整可见</strong>：
                    </P>
                    <ul className="list-disc pl-6 space-y-1 mt-1">
                      <li>开仓时间 / 平仓时间</li>
                      <li>开仓价 / 平仓价</li>
                      <li>
                        <strong>平仓方式</strong> <Star />
                        ：手动 / 止损 / 止盈 1-3 / 爆仓
                      </li>
                      <li>订单类型：主力 / 对冲</li>
                      <li>心态自评</li>
                      <li>错误标签</li>
                    </ul>
                    <P className="text-[13px] mt-2">
                      平仓方式这一列单独说一句——它能让你看见以前看不见的差异：手动平仓 vs 自动平仓的 R 分布、被止损扫出
                      vs 自己主动认错的笔数对比、爆仓笔数（这个数字应该永远是 0）。
                    </P>
                  </div>
                  <div>
                    <P className="text-[13px]">
                      (3) <strong>三个视图切换</strong>：
                    </P>
                    <ul className="list-disc pl-6 space-y-1 mt-1">
                      <li>
                        <strong>按模式</strong>（默认）——按错误模式聚类，主力单优先
                      </li>
                      <li>
                        <strong>按时间</strong>——倒序列出所有 journal
                      </li>
                      <li>
                        <strong>未评价</strong>——只列出"已平仓但未评价"的 journal，必须尽快补完才能进入模式统计
                      </li>
                    </ul>
                  </div>
                  <div>
                    <P className="text-[13px]">
                      (4) <strong>筛选条</strong>：
                    </P>
                    <ul className="list-disc pl-6 space-y-1 mt-1">
                      <li>日期范围 / 标的 / 结果 / 错误大类 / 心态范围</li>
                      <li>
                        <strong>订单类型</strong>
                        ——默认仅显示主力单（避免对冲单污染统计），用户可手动切换为"全部"或"对冲单"
                      </li>
                    </ul>
                  </div>
                </div>
              </section>

              <section id="s4-2" className="scroll-mt-20 bg-card border border-border rounded p-4">
                <h3 className="text-[14px] font-medium text-foreground mb-2 flex items-center gap-2">
                  <Target className="w-4 h-4 text-[#F0B90B]" /> 4.2 元监控（/journal/insights）
                </h3>
                <P>
                  <strong>目的</strong>：回答"我在不在变好"这个唯一重要的问题。
                </P>
                <P className="mt-2">
                  包含 7 张卡片，但你只需要关心一张：<strong>规则有效性追踪</strong>。
                </P>
                <P className="mt-2">这张表显示每条规则创建后，对应错误模式的频次是否真的下降了。</P>
                <div className="mt-3 bg-accent/50 border-l-2 border-[#F6465D] pl-3 py-2 rounded-r text-[13px]">
                  "这个系统的全部价值在这张表上。如果你的规则在 60 天内让对应 pattern
                  频次下降，系统起作用了。如果没有，那条规则需要重写——不是 pattern 有问题，是规则不够'可操作'。"
                </div>
                <div className="mt-2 text-[12px] text-muted-foreground space-y-1">
                  <P className="text-[12px] text-muted-foreground">
                    <strong>其他卡片</strong>：
                  </P>
                  <ul className="list-disc pl-6 space-y-1">
                    <li>
                      <strong>错误模式趋势</strong>——每个 pattern 的频次随时间变化（向下 = 在被你修正）
                    </li>
                    <li>
                      <strong>alpha 时段识别</strong>——找到你个人的"高胜率时间窗口"
                    </li>
                    <li>
                      <strong>心态-收益散点</strong>——定位你的"非 alpha 状态"
                    </li>
                    <li>
                      <strong>订单类型分布</strong> <Star />
                      （新增）——主力单 vs 对冲单的笔数、胜率、平均 R 对比。若对冲单平均 R
                      显著低于主力单，说明你的对冲多在情绪驱动下进行
                    </li>
                    <li>
                      <strong>平仓方式分布</strong> <Star />
                      （建议关注）——手动/止损/止盈/爆仓的笔数与 R 分布。手动平仓 R
                      系统性低于止盈触发？说明你在截断盈利尾部
                    </li>
                    <li>
                      <strong>事后合理化预警</strong>——开仓理由被事后修改的笔数
                    </li>
                    <li>
                      <strong>未评价积压</strong>——未评价 journal 数
                    </li>
                    <li>
                      <strong>元元监控</strong>——近 7 天评价数、新建模式数、激活规则数
                    </li>
                  </ul>
                  <P className="text-[12px] text-muted-foreground">
                    但记住：最重要的依然是那张"规则有效性追踪"表。其他都是辅助。
                  </P>
                </div>
              </section>

              <section id="s4-3" className="scroll-mt-20 bg-card border border-border rounded p-4">
                <h3 className="text-[14px] font-medium text-foreground mb-2 flex items-center gap-2">
                  <ScrollText className="w-4 h-4 text-[#F0B90B]" /> 4.3 规则（/journal/rules）
                </h3>
                <P>
                  <strong>目的</strong>：把错误模式转化为可执行的规则，注入下次开仓 checklist。
                </P>
                <P className="mt-2">来源有两条：</P>
                <ul className="list-disc pl-6 text-[13px] text-foreground/90 space-y-1 mt-1">
                  <li>
                    <strong>自动生成</strong>：同一 pattern 30 天 ≥3 次且亏损时，系统强制弹窗要求你写
                  </li>
                  <li>
                    <strong>手动写入</strong>：通过六步分析框架的 Step 6 主动写
                  </li>
                </ul>
                <P className="mt-2">每条规则可标记为"必填"或"可选"，参与下次开仓时的 checklist 通过判定。</P>
              </section>

              <section id="s4-4" className="scroll-mt-20 bg-card border border-border rounded p-4">
                <h3 className="text-[14px] font-medium text-foreground mb-2 flex items-center gap-2">
                  <TagIcon className="w-4 h-4 text-[#F0B90B]" /> 4.4 标签字典（/journal/tags）
                </h3>
                <P>
                  <strong>目的</strong>：管理错误模式的两层字典。
                </P>
                <P className="mt-2">
                  <strong>第一层</strong>：6 大类（固定，不可改）
                </P>
                <ul className="list-disc pl-6 text-[13px] text-foreground/90 space-y-1 mt-1">
                  <li>入场理由错</li>
                  <li>对冲/止损错</li>
                  <li>出场理由错</li>
                  <li>心态/认知状态错</li>
                  <li>该开没开错（特殊：用于记录"该开但没开"的决策）</li>
                  <li>流程错（checklist 未通过下单等）</li>
                </ul>
                <P className="mt-2">
                  <strong>第二层</strong>：用户自定义 pattern。每个 pattern 必须配可操作定义（≥10
                  字符）——不能写"心态不好"，要写"交易前心态自评 ≤2 分"。
                </P>
              </section>

              <section id="s4-5" className="scroll-mt-20 bg-card border border-border rounded p-4 lg:col-span-2">
                <h3 className="text-[14px] font-medium text-foreground mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#F0B90B]" /> 4.5 单笔复现（/journal/:id）
                </h3>
                <P>
                  <strong>目的</strong>：把一笔交易完整"重演"，五通道同步。
                </P>
                <ul className="list-disc pl-6 text-[13px] text-foreground/90 space-y-1 mt-2">
                  <li>
                    <strong>通道 ①</strong>：盘面（K 线回放 + 入场/出场标记 + 止损止盈线 +
                    三条垂直时间线锚定决策/出场/当前）
                  </li>
                  <li>
                    <strong>通道 ②</strong>：决策（你当时写的开仓理由、止损止盈、checklist 状态）
                  </li>
                  <li>
                    <strong>通道 ③</strong>：状态（心态自评、心态触发原因、历史对照）
                  </li>
                  <li>
                    <strong>通道 ④</strong>：风险认识与管理（你当时怎么想风险，事后对照实际）
                  </li>
                  <li>
                    <strong>通道 ⑤</strong>：反事实（六步深度分析 + 反事实回放）
                  </li>
                </ul>
                <P className="mt-2">可以随意拖动时间轴、按倍速回放、跳转到决策时刻或出场时刻。</P>
              </section>

              <section id="s4-6" className="scroll-mt-20 bg-card border border-border rounded p-4 lg:col-span-2">
                <h3 className="text-[14px] font-medium text-foreground mb-2 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#F0B90B]" /> 4.6 六步深度分析框架
                </h3>
                <P>
                  <strong>目的</strong>：把模糊的复盘文字升级为可分析的结构化数据。
                </P>
                <P className="mt-2">
                  <strong>六步</strong>：
                </P>
                <ol className="list-decimal pl-6 text-[13px] text-foreground/90 space-y-1 mt-1">
                  <li>
                    <strong>错误场景</strong> - 当时市场上下文 + 你的身体心态状态
                  </li>
                  <li>
                    <strong>原始假设</strong> - 你当时相信什么会发生
                  </li>
                  <li>
                    <strong>现实反馈</strong> - 市场实际怎么回应、哪里和假设不符
                  </li>
                  <li>
                    <strong>错误类型</strong> - 一句话归纳错误的类别
                  </li>
                  <li>
                    <strong>真正问题</strong> - 根因诊断，不是现象层
                  </li>
                  <li>
                    <strong>新规则</strong> - 写一条具体可勾选的规则
                  </li>
                </ol>
                <P className="mt-2">Step 6 可一键写入 checklist。这是闭环的关键一步。</P>
                <div className="mt-3">
                  <Highlight>
                    "绝大多数复盘卡在第 5 步——'我太冲动了'——从不真正到达第 6 步。系统的反脆弱价值，全部在 Step 5 到 Step
                    6 的跳跃。"
                  </Highlight>
                </div>
              </section>

              <section id="s4-7" className="scroll-mt-20 bg-card border border-border rounded p-4 lg:col-span-2">
                <h3 className="text-[14px] font-medium text-foreground mb-2 flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-[#F0B90B]" /> 4.7 反事实回放
                </h3>
                <P>
                  <strong>目的</strong>：验证你的"修正方案"是否真的有效。
                </P>
                <P className="mt-2">
                  <strong>操作</strong>：
                </P>
                <ul className="list-disc pl-6 text-[13px] text-foreground/90 space-y-1 mt-1">
                  <li>输入修正后的参数：入场价、止损、止盈、仓位、入场时间偏移</li>
                  <li>系统在已加载的 K 线数据上自动跑虚拟分支</li>
                  <li>在 K 线图上叠加紫色轨迹</li>
                  <li>显示"真实 vs 反事实"对比表</li>
                </ul>
                <P className="mt-2">
                  每笔 journal 最多保存 10 条分支（如"止损更宽 / 仓位减半 / 不开仓"），可分别对比。
                </P>
              </section>
            </div>
          </section>

          {/* Section 5 — 闭环图 */}
          <section id="s5" className="scroll-mt-20">
            <SectionTitle>5. 完整学习闭环</SectionTitle>
            <div className="bg-card border border-border rounded p-6">
              <FlowNode accent>开仓 → 强制快照（含 checklist + 你的规则）</FlowNode>
              <FlowArrow />
              <FlowNode>下单 → 持仓 → 平仓</FlowNode>
              <FlowArrow />
              <FlowNode>强制评价 → 打标签 → 六步分析</FlowNode>
              <FlowArrow />
              <FlowNode accent>critical 模式检测 → 强制规则 OR 主动 Step 6 写规则</FlowNode>
              <FlowArrow />
              <FlowNode>新规则自动注入下次 checklist</FlowNode>
              <FlowArrow />
              <FlowNode>同类错误被 checklist 拦截</FlowNode>
              <FlowArrow />
              <FlowNode accent>该模式频次下降（在元监控可见）</FlowNode>
              <FlowArrow />
              <FlowNode>回到顶端...</FlowNode>
            </div>
            <P>
              <span className="block mt-4">
                这是一个完整的负反馈控制环。每个节点都不可或缺——少了任何一环，系统会退化成普通的"交易日记"。
              </span>
            </P>
          </section>

          {/* Section 6 */}
          <section id="s6" className="scroll-mt-20">
            <SectionTitle>6. 三天上手指南</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  title: "Day 1 · 熟悉时光机",
                  items: [
                    "选一个你熟悉的标的（BTC / ETH）",
                    "选 2024 年某个明显波动的时刻作为起点",
                    "用不同倍速（5x / 50x / 100x）观察盘面",
                    '这一天不要交易，只是建立"无知之幕"的状态感',
                  ],
                  goal: '让"不知道未来"的体验成为习惯。',
                },
                {
                  title: "Day 2 · 第一笔有快照的交易",
                  items: [
                    "找一个清晰的形态信号（突破 / 反转 / 区间）",
                    "完整填写开仓快照——理由、止损止盈、风险认识、风险管理、心态、checklist",
                    "平仓后认真完成六步深度分析（不要敷衍 Step 5）",
                    "把这笔记录留到 Day 3 早上重新看",
                  ],
                  goal: '让"双时点记录"成为肌肉记忆。',
                },
                {
                  title: "Day 3 · 第一条规则",
                  items: [
                    "进入错题集查看你的第一个 pattern",
                    "用六步框架 Step 6 写出第一条规则（必须可勾选）",
                    '点击"写入 checklist"',
                    "在下一次开仓时观察这条规则如何拦截你",
                    '此时进入元监控查看"规则有效性追踪"基线',
                  ],
                  goal: "完成第一次完整闭环。",
                },
              ].map((d) => (
                <div key={d.title} className="bg-card border border-border rounded p-4 flex flex-col">
                  <div className="text-[14px] font-medium text-foreground mb-3 pb-2 border-b border-border">
                    {d.title}
                  </div>
                  <ul className="list-disc pl-5 space-y-1.5 text-[13px] text-foreground/90 flex-1">
                    {d.items.map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ul>
                  <div className="mt-3 pt-2 border-t border-border text-[12px] text-[#F0B90B]">目的：{d.goal}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Section 7 */}
          <section id="s7" className="scroll-mt-20">
            <SectionTitle>7. 一句话总结</SectionTitle>
            <div className="border-2 border-[#F0B90B] rounded-lg p-8 bg-accent/30">
              <p className="text-[20px] leading-relaxed text-foreground text-center">
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
