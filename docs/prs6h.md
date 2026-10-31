# PRS-6H v1：日内顺势加仓证据

入口：K线「指标 → 自制区 → 多头追加支持证据 → PRS-6H」，与 CDA 共用原生副图注册；Deep Dig 特征列表选择「日内顺势加仓证据（PRS-6H）」。它是独立特征 `prs_intraday_add_evidence_6h`，不替换 ATI-6H、CDA 或任何已有结果。所有默认参数是**研究初值**，不是原书公式，也未证明策略有效。

## 实际调用关系与文件

- `prs6h.ts`：唯一因果状态机、参数校验、逐根 push、批量回放、检查点与市场事件。
- `deepDig/features.ts`：独立注册、native 输入适配、公式变量、配置版本键、24h 预热计划。`analysis.ts` / `series.ts` / `export.ts`：描述/推断统计、双精度曲线、解释明细、CSV/JSON。
- `Prs6hEvidenceView.tsx` / `DefinitionPanel.tsx` / `FeatureView.tsx`：分数、五分项、状态/原因、固定价格图、时间游标、参数 JSON、研究诊断和导出。
- `researchIndicators.ts` / `featureSource.ts` / `customIndicators.ts` / `IndicatorMenu.tsx` / `customIndicatorGroups.ts`：盘面菜单与原生 0–100 副图；与 CDA 一样提供原值、avg、avg₂独立副图，默认原值和avg₂，普通avg可单独开启；均线N可调并保存。`chartComputeClient.ts` / `chartCompute.worker.ts`：后台计算、正式收盘遮罩、断点初态。
- `prs6hPersistence.ts`：独立 IndexedDB `veil-prs6h-state-v1`，按账号命名空间、配置、品种、周期、数据源/版本保存。只恢复不晚于输入起点的检查点；不把未来状态套在过去。无可用初态时从明确的加载起点顺序回放，解释输出记录初始化时间。
- `fish/algorithm.ts` / `fishScanner.ts` / `fish/adapters.ts` / `fish/intersection.ts` / `fish/reconstructionLoader.ts`：统一选择、捕捞、组合、冻结快照与历史复原；原生标志不会在编译筛选程序时丢失。`fish/quality.ts` 恢复捕获时的 PRS 配置，避免用今天参数解释旧鱼。
- `fish/qualityAdditionScan.ts` / `qualityAddition.ts` / `QualitySellEvidence.tsx`：现有条件加仓**模拟回放**只消费 PRS 的一次性 MARKET_READY 事件，保存信号分项、结构身份、固定坐标与门控明细。原有卖出、半仓镜像、风险覆盖计算和成交价机制保持原规则。
- `prs6hEvaluation.ts`：仅事后标签和诊断，市场引擎不导入它；未来行情与评分输入分开传递。

现有使用统一特征定义/公式的选择器、筛选、特征对照、组合研究、统计及导出自动获得该指标。Deep Dig 与 Deep RSA 共用 `collectRunEvents` 数据流水线；Deep RSA 自身预定义的特征族检验不是任意指标列表，没有把 PRS 强塞进旧检验或改写旧研究结果。

## 参数体系

Deep Dig 编辑该特征 →「PRS-6H 参数（研究初值）」可修改 JSON。未知键、非法数值、权重不合计1、非法成交模式会阻止保存。以下单位为小时、分钟或无量纲，根数由周期向上取整；默认周期5m，其他周期独立进入配置身份，不能当作相同的5m研究结果。

| 配置字段 | 默认 | 用途 |
|---|---:|---|
| trendHours / resistanceHours / referenceHours | 6 / 6 / 6 | 趋势、按识别时间的障碍、按测试时间的参考寿命 |
| platformMinutes / recentMinutes / supportMinutes | 30 / 60 / 60 | 平台、D/V、S近期保持窗口 |
| evidenceHalfLifeMinutes / scaleHalfLifeMinutes | 30 / 30 | 近期证据与事前尺度半衰期 |
| fastHalfLifeMinutes / slowHalfLifeMinutes / trendChangeMinutes | 15 / 60 / 30 | 趋势快慢均值与增强比较 |
| scaleMinutes / spikeMinutes | 120 / 120 | 前24根尺度 / 无衰减插针窗口 |
| candidateMinutes / testValidMinutes / recoveryMinutes | 120 / 60 / 15 | 候选、已测试、含触碰根的恢复期限 |
| breakoutBars | 2 | v1固定两根，禁止悄悄增加评分等待 |
| trendGapScale / trendAccelerationScale | .5 / .25 | T 两个 tanh 归一化尺度 |
| maxEfficiency / minPlatformTicks / maxWidthScale | .5 / 4 / 2 | 平台 ER、最小宽度、最大波动宽度 |
| testBandScale / invalidationScale | .25 / .5 | 测试带宽上限 / 冻结失效线 |
| higherSupportTicks / higherSupportScale | 2 / .1 | 支撑至少抬高 max(2tick,.1a0) |
| minTestVolumeRatio | .25 | 测试成交额相对前1h加权额下限 |
| breakoutScale / resistanceBandScale / pivotSignificanceScale | .1 / .1 / .5 | 突破缓冲、障碍冻结带宽、局部高点显著性 |
| supportPenetrationScale / volumePushScale | .5 / .5 | S最大下穿惩罚 / V下推尺度 |
| closeLocationHalfLifeMinutes | 5 | 最近两根收盘位置半衰期 |
| wickLimit / shockLimit | 2 / 3 | W/J严格小于阈值才通过 |
| spaceMultiple / minDistance / maxDistance | 2 / .5 / 3 | 前方扫描倍数 / 到K的当前尺度距离 |
| weights.T/S/D/B/V | .15/.40/.25/.15/.05 | 正权重，总和1 |
| coreMin.T/S/D/B | .35/.65/.60/.60 | 核心分项硬下限 |
| scoreThreshold | 70 | 首次市场就绪总分门槛 |
| volumeMode | quote | quote / flow / base_close_proxy（显式近似） |

基础行情含 OHLC、收盘时间、报价币成交额 Q 和真实 tick。`flow` 另需同币种主动买入额，检查 0≤buy≤Q，sell=Q−buy。`base_close_proxy` 固定用基础币成交量×收盘价，界面和导出标记近似；不逐根切换模式。缺失不是0。

## 公式与因果规则

权重 `w(t,i;h)=2^(-(t_t-t_i)/h)`；A 是指定有限窗口中的归一化加权均值，时间用真实毫秒。连续性、价格关系和数据合法性均检查。

1. `TR_i=max(H_i−L_i,|H_i−C_(i−1)|,|L_i−C_(i−1)|)`；`a_i=A(i−1,24,30m;TR)`。只用之前24根，不用异常当根扩大自身分母；a≤0返回未知。
2. `F=A(t,72,15m;C)`，`Z=A(t,72,60m;C)`，`m=F−Z`；趋势 m>0 且 Z_t>Z_(t−6)。`g=m/a_t`，`b=(m_t−m_(t−6))/a_t`；`T=tanh(g+/.5)×(.75+.25tanh(b+/.25))`。
3. 平台取最近6根：Ps=min(L)，Pu=max(H)，W=Pu−Ps，4tick≤W≤2a0，成交额全部>0，`ER=|C_end−C_start|/Σ|ΔC|≤.5`（平价分母0时ER=0）。`δ=max(tick,min(.25a0,W/4))`，冻结收盘≥Ps+2δ；`K=Ps−.5a0`。坐标、a0、带宽、前一参考快照固定。
4. 无参考的已测试候选只登记 BASELINE_ONLY；有参考时 Ps 至少抬高 max(2tick,.1a0)，K 至少提高1tick。未通过不占候选槽。后续只能在冻结后 j>τ、前收盘≥Ps+2δ、区间触及测试带、Q_j>0且≥前1h加权Q的.25时开始测试。j…j+2及时收回Ps+2δ才 VERIFIED。
5. 失效优先：任一 L≤K 或连续两根收盘<Ps 永久 INVALID，同时更新参考。候选>2h、测试完成>1h分别过期；最终突破时前一参考>6h也终止。失效、失败、过期、首次就绪后释放槽，下一平台整个形成区间必须在终止之后。
6. `S=近期收盘≥Ps的加权比例 × clip(1−冻结后最大(Ps−L)+/a0/.5)`。保持比例取冻结后且距当前<1h；最大下穿从冻结后保留，不衰减、不因反复测试加分。未测试 S=null。
7. 最近12根：`U=ΣwΔ+`，`N=Σw(−Δ)+`，`D=U/(U+N)`；平价分母0为null。
8. `η_i=clip((−Δ_i)+/(.5a_i))`；`V=1−ΣwQη/ΣwQ`。flow模式分子改成ΣwQ_sellη；零成交额分母为null，卖额本身不能取代价格损坏判断。
9. `B=A(t,2,5m;(C−L)/(H−L))`，H=L为null。测试恢复之后的两根严格收于 `Pu+max(tick,.1a0)` 上方，后一收盘不低于前一收盘才通过突破；恢复当根不计突破。
10. 最近2h无衰减检查 `max((min(O,C)−L)/a_i)<2` 且 `max((C_prev−L)+/a_i)<3`，输出最晚违规时刻和剩余等待。
11. 局部高点左2严格较低、右2不更高，且显著性≥.5a_j，仅右2收盘时 known_at 才可知。平台Pu从冻结时可知，支撑失效不删Pu。局部高点阻力带半宽 max(tick,.1a_j)、平台阻力带半宽 max(tick,.1a0)，识别后固定，按 known_at 保留6h。连续2收盘越过上带标记 broken_up，任一收盘≤上带立即重新参与检查。
12. `d=C−K>0`，阻力带与 `[C,C+2d]` **区间相交**即否决（现价在带内也否决）。历史未完整初始化为未知。`z=(C−K)/a_t`须在[.5,3]，不为通过条件移动K。
13. `raw=100×T^.15×S^.40×D^.25×B^.15×V^.05`；任一已定义分项0得到严格0，缺项不重分配。10项硬门控与核心下限全通过时score=raw，否则已知失败为0；必需数据/分母不可定义为null。没有候选、未测试等状态分数0，S/组合原始证据仍为空。`market_ready=全部门控通过且raw≥70`。

0不是看空或多空均衡；分数不是概率。无已识别障碍仅是本规则、该窗口内未发现，不能解释为保证2:1收益风险比。

## 输出、状态与持久化

公式数值字段：`PRS6H`、`PRS6H_evidence_raw`、`PRS6H_T/S/D/B/V`、`PRS6H_market_ready`、`PRS6H_support/platform_upper/invalidation`、冻结/测试/突破时间、事前尺度、最大下影/冲击、扫描上界、state_code。数值保持Float64，仅显示时舍入。

解释行另含 `PRS6H_state`、gates、reasons、structure、event、events、data_complete、volume_mode、config_hash、version、parameters、debug（障碍、扫描范围、违规等待、初始化时间）、data_source/data_version。

状态：SEARCHING → FROZEN → TESTING → VERIFIED → MARKET_READY；初始参考为 BASELINE_ONLY；终止状态 INVALID / TEST_FAILED / CANDIDATE_EXPIRED / TEST_EXPIRED / REFERENCE_EXPIRED；不可计算为 DATA_UNAVAILABLE。冻结形成期的最低价不能算冻结后测试；恢复不能复活旧结构。

原因：`gate_`和`unknown_`前缀分别表示已知失败和未知；键为 trend / higher / tested / valid / time_valid / breakout / spike / space / distance / core。数据原因包括 missing_tick_size、missing_or_invalid_quote_amount、missing_or_invalid_taker_amount、prior_volatility_unavailable、missing_or_noncontiguous_candle、invalid_ohlc_or_timestamp、no_directional_price_advance、incomplete_volume_evidence、zero_quote_amount、undefined_close_location、insufficient_or_invalid_required_data。

检查点v1保存必要历史点、活动结构、已测试参考、固定障碍及突破状态、终止归档、已发事件ID和最后行。单调写入防止旧标签页覆盖新状态。缓存身份包括特征v1、参数哈希、品种、周期、数据源/版本和成交模式，记录初始化/截止范围。参数/数据版本不一致拒绝恢复；修订历史须从修订前状态重新回放。

研究摘要和CSV保存检查点**元数据**，完整检查点随6h解释窗口保存在原有曲线IndexedDB记录中，面板「导出状态、结构与检查点」下载完整JSON。避免把每个样本的预热历史重复塞进localStorage。既有数据库不清空、不重建。

## 账户与执行边界

市场引擎无余额、成本、浮盈、仓位输入，同一行情/配置/初态在不同账号得到相同分数。事件包含structure_id、时间、参考价、Ps/Pu/K、分项和版本；同一结构最多一个事件，重复收盘/重试不再发事件。`prsAccountAdmission`合约要求既有持仓权限、风险预算、执行检查都明确通过，缺任一项拒绝；没有默认允许的真实账户接线。

目前实际消费入口是已有条件加仓模拟回放及加仓计算器，不是新的自动下单服务。沿用已选方案的资金/风险覆盖、止损、手续费/滑点和下一分钟成交规则。PRS 的结构K展示为市场参考，不自动替换方案或真实账户止损，也不新增浮盈过滤或仓位分配算法。真实交易继续走项目原有人工下单/风控流程，没有通过未知接口自动放行。

## 如何历史回算与查看完整事件

1. Deep Dig选PRS-6H，使用信号库或战役样本，按已有分组和时间范围运行「描述统计」。默认展示6h；实际向前多加载至少24h（可配置窗口变大时相应增加），顺序回放，数据中断后重新预热。不能只拿72根当作完整初态。
2. 时间序列区显示PRS专属面板，选择样本，拖动「已收盘时点」查看固定线从冻结起出现、后续测试和就绪。展开事件与参数诊断，检查原因和初始化起点。
3. 运行推断/对照流程时保持原有时间划分、控制变量和缺失覆盖处理。导出CSV查看原值，面板JSON查看完整结构和恢复状态。
4. 无需联网的完整正例在 `deepDig/__tests__/fixtures/prsBars.ts`。运行 `node node_modules/vitest/vitest.mjs run src/lib/__tests__/prs6h.test.ts`，首个用例构造：基准→更高浅平台→后续触碰并恢复→两根突破→全部门控→只一次事件。该正例最终分约84.838963，**是合成验收行情，不是投资业绩**。

## 研究评估与数据限制

已有研究数据下载同时供事后15/30/60分钟收益、MFE/MAE、失效比例标签。标签不进入评分；不完整期限为null。输出有效数据覆盖、否决频率、冻结/测试数、突破但被插针/障碍拦截数。诊断计数不冒充受控策略消融。

尚无足够的真实样本研究来报告：移除支撑测试/插针/障碍后的受控收益差异、遗漏趋势机会、同基础持仓与退出规则的完整加仓优劣。已有卖出方案回放可选择PRS做条件模拟，但不能据合成测试声称策略改善或参数优化。成本、实际可执行时点和重叠未来标签仍由既有研究框架约束。

本次真实tick适配币安公开exchangeInfo；其他交易所旧适配器没有经过核实的tick字段时，PRS/ATI返回缺数据，不猜精度、不静默放行。历史tick使用下载时交易所元数据快照；缺历史tick变更档案，不能宣称等于当时交易规则。quote默认模式无需主动买卖额；显式flow缺方向额时null。公共行情不可达或K线缺口均明确未知。

## 验证记录

实跑覆盖完整正例、固定坐标、基准/更高K关系、失效优先级、恢复期限/三类过期、平价与零/缺成交额、大小卖额与下推结果、W/J事前尺度、阻力带内部及重新进入、右2因果确认、零/缺分项与硬下限、单事件、批量/流式/JSON恢复/未来追加一致性、未收盘遮罩、缓存隔离、生产研究导出与原生指标/条件加仓接入。结果由交付时的实际测试日志补充，不把既有失败算作新功能通过。

捕捞沿用原有「截止时刻仍达标」语义。PRS在首次就绪后结束候选，因此是事件型指标；每1h自动扫描可能错过两次扫描之间的5m就绪点。Deep Dig和已有条件加仓回放逐根检查，可以查看这些历史事件；不会把已经过去的事件冒充当前可执行机会。

2026-10-31 最终验证：16个核心/接入测试文件115项通过；ATI/PRS原生菜单2项通过；真实TimeControl捕捞面板重开1项通过，合计118项针对性验证。TypeScript完整检查通过，生产构建通过（已有大分块提示保留）。浏览器实际添加PRS副图、刷新后从独立IndexedDB读取检查点、通过界面导出完整JSON均已验证；合成正例84.83896326796076分、一个事件。未宣称全库套件全绿：早期扩大回归中的既有卖方断言及TimeControl评分/删除用例在187b4f70基线同样有失败，未借本次任务改写相关业务。

## 456：与CDA一致的实际盘面显示

PRS-6H 与 ATI-6H 均可从主盘面「指标→自制区→多头追加支持证据」添加。与CDA相同：原值、avg、avg₂独立显示/隐藏，叉号只关闭对应副图，刷新后保留选择，N默认24h且可调整。图例采用紧凑样式，详细门控与结构继续在Deep Dig解释面板查看。avg/avg₂只在图表显示链路追加，不修改原始特征定义、市场分数、就绪事件和风控逻辑。加载历史时补足均值依赖，并保留已收盘遮罩、精确tick和数据版本刷新。

456验证：44项计算、原生指标及接入回归通过，2项指标菜单测试和2项真实CandlestickChart副图开关/重开测试通过。浏览器实测PRS-6H和CDA同盘面的六个副图，刷新后保留显示设置。
