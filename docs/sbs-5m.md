# SBS-5M｜台阶箱体支撑 v1

这是独立的工程研究原型，不是书籍原有公式，不代表加仓指令、支撑守住概率或已验证策略。

## 入口和输出单位

Deep Dig →「台阶箱体支撑」分组；盘面「指标 → 自制区 → 台阶箱体支撑」。四项共用 `Sbs5mEngine`，没有复制识别算法：

| 特征 | 输出 | 显示 |
|---|---|---|
| `sbs_5m` / SBS-5M | `support_price` | K 线主图价格轴 |
| `sbs_5m_quality` / SBS·证据 | `support_quality` | 0–100 独立副图 |
| `sbs_5m_distance` / SBS·距离 | `distance_to_support` | 有符号事前波动尺度 |
| `sbs_5m_step` / SBS·台阶 | `step_height_atr` | 新冻结尺度；首箱为空、普通有效时刻为 0 |

绝对支撑价格的描述统计遇到多品种样本会停止并提示选择单品种或标准化维度，避免混合不同币种价格。三个标准化维度的默认公式不携带绝对价格变量。台阶事件另存 `step_event_height`，不应与普通时刻的 0 混为一谈。

原有特征保持原定义、配置和版本；PRS、ATI 默认来源均未改变。`sbsSupportSource` 提供明确的支撑源合同：价格、失效参考、测试状态、质量及结构身份；无有效结构时价格为空。现有专用 PRS 结构仍由其自身算法计算。

## 公式与研究初值

仅使用 5m 已收盘 K 线。报价币成交额优先；可显式切换 `base_times_close` 近似模式，整次计算固定口径并纳入配置哈希。需要交易所真实 `tick_size`，不能用价格小数位猜测。

- `TR_i = max(H_i−L_i, |H_i−C_(i−1)|, |L_i−C_(i−1)|)`。
- `a_i` 是之前 24 根 TR、30 分钟半衰期的有限窗口指数加权均值；使用实际时间差，排除当前根。
- 形成 6 根箱体：`s=min(L)`、`u=max(H)`、`W=u−s`；`4q≤W≤2a₀`，路径效率 `ER≤0.5`，每根成交额为正，各根下针/各自事前尺度严格小于 1.5。
- 冻结 `δ=max(q,min(0.25a₀,W/4))`、`K=s−0.5a₀`，并要求冻结收盘 `C≥s+2δ`。
- 后续独立触碰须由前收盘 `≥s+2δ` 返回测试带，成交额达到之前 12 根加权基准的 0.25 倍；含触碰根最多 3 根恢复至 `s+2δ`。最后一根先检查恢复，再判超时。
- 向上突破：正式确认之后连续 2 根收盘 `>u+max(q,0.1a₀)`。新形成区间全部晚于该突破；新底至少提高 `max(2q,0.1a_new)`，新顶、新 K 各至少提高 1 tick。
- `h`：冻结后、最近 60 分钟左开右闭窗口内有真实成交的收盘守住比例，半衰期 30 分钟；零成交不增加证据。
- `p=max([s−L]₊)/a₀` 从冻结后累计且不遗忘；`d=clip(1−p/0.5)`；`f=2^(−距最近成功独立测试分钟/60)`。
- `Quality=100×cbrt(hdf)`；零值保持零，缺失分项则为空，不补 epsilon、不删掉缺失分项重新分权。
- 距离 `(C−s)/a_current` 可以为负；新台阶当根幅度 `(s_new−s_old)/a_new`。

全部默认值在 `SBS5M_DEFAULTS`，23 个数值参数的单位、边界、描述在 `SBS5M_PARAMETER_SPECS`，编辑定义中可查看并修改完整配置：

```json
{
  "bar_interval":"5m", "volume_mode":"quote",
  "box_formation_bars":6, "volatility_lookback_bars":24, "volatility_half_life":30,
  "box_min_width_ticks":4, "box_max_width_scale":2, "box_max_efficiency_ratio":0.5,
  "formation_max_lower_wick_scale":1.5, "touch_band_scale":0.25, "touch_band_width_fraction":0.25,
  "invalidation_buffer_scale":0.5, "candidate_max_age":60, "active_box_max_age":6,
  "test_max_bars":3, "turnover_reference_bars":12, "turnover_reference_half_life":30,
  "test_min_turnover_ratio":0.25, "breakout_buffer_scale":0.1, "breakout_confirm_bars":2,
  "step_min_raise_ticks":2, "step_min_raise_scale":0.1,
  "quality_lookback":60, "quality_half_life":30, "test_freshness_half_life":60
}
```

寿命 `active_box_max_age` 单位为小时；候选、各半衰期、质量窗口单位为分钟；其余根数、tick 或尺度倍数按参数说明。配置校验拒绝未知键、越界数值和错误成交模式；修改进入哈希并重算。穿透惩罚的分母 0.5 是独立固定公式，不随失效缓冲参数变化。

## 状态及因果图线

一个身份最多一个 active、一个 pending。候选冻结后坐标不能修改；价格失效 `L≤K` 或连续两根 `C<s`，同根反弹也不撤销失效。pending 失败只取消自身，active 仍有效则继续；active 终止立即取消依赖候选。没有历史箱底自动回退。

首箱测试成功建立新 episode，仅是基准；更高新箱通过测试后立即替换旧 active，同 episode 内只水平或抬升，旧箱保存为 REPLACED。新箱不能继承父箱的突破计数。active 再次测试超时记录 FAILED，但未发生价格失效时不切断主线；必须重新离开并再次触碰才能建立独立事件。

候选默认冻结后 60 分钟过期；active 默认确认后 6 小时进入 STALE，测试成功不续期。到期优先于当根候选确认。缺根、无效价格、缺成交口径或 tick 等返回 DATA_UNAVAILABLE，结束结构，缺口后重新预热。真实零成交与缺失分开。

Deep Dig 图采用价格轴：绿色实线台阶为有效支撑、金色虚线及孤立标记为尚未确认候选、灰线为固定箱顶、红色虚线为固定失效参考。灰色价格线仅为行情背景。无有效支撑返回 null，绘图不跨 null 或 episode 连接。上方事件点可悬停看识别时点；完整冻结、测试、确认、突破、失效原因在默认折叠的事件区。滑块查看对应时点的证据、距离、幅度及 active/pending/retest 状态。候选从冻结时刻已知，实线从确认时刻生效。

## 历史、缓存和恢复

`computeSbs5m` 与 `Sbs5mEngine.push` 共用一个状态机。`resumeSbs5m` 要求显式初始化 ID，持久化检查点保存在账号隔离的 `veil-sbs5m-state-v1` IndexedDB。图表 Worker 和 Deep Dig 保存独立 SBS 检查点；读取时拒绝未来检查点和不相符的参数、品种、来源、版本、成交模式、tick 或初始化身份。不可用时从明确起点回算，不借用其他特征状态。

检查点包含 first/last time、滚动窗口、active、pending、历史和稳定事件 ID；身份包含 feature/version/config、symbol、5m、来源、数据版本和成交模式。行与冻结结构保留输入链校验和，数据修订可审计。同一时点不同内容的检查点另存修订副本，不覆盖原头。磁盘写入失败不会冒称持久化成功。

盘面至少额外请求 24h 预热；延长窗口参数时会相应增加所需历史（捕捞超过现有上限会明确提示不可扫描）；Deep Dig 会连同展示区间请求更早历史，实际初始化起点写入结果。6 小时表示结构寿命，不能声称任意截取最近 6 小时与完整历史相同。复算请使用相同原始数据版本、配置、初始化起点或此前有效检查点。历史修订应从修订前重放并使用明确的数据版本。

## 实际接通

- `deepDig/features.ts`：四个注册项、配置验证、原生数值输入、定义与缓存版本。
- `sbs5m.ts`、`sbs5mPersistence.ts`：独立计算、状态、原因码、检查点与恢复合同。
- `deepDig/analysis.ts`、`series.ts`、`export.ts`：真实行情研究、分组/对照、时间曲线、原始双精度明细和 CSV；沿用 Deep RSA 行情与研究管线。已有组合研究和规则通过统一特征定义选择对应输出。
- `researchIndicators.ts`、`featureSource.ts`、`customIndicators.ts`、`sbs5mChart.ts`、图表 Worker/客户端：盘面、价格轴台阶和独立副图。
- `IndicatorMenu`、`DefinitionPanel`、`FeatureView`、`Sbs5mEvidenceView`：入口、参数、状态图、事件、JSON 导出。
- 捕捞 intersection/reconstruction/algorithm/quality：严格成交元数据、数值筛选、捕获结构证据及准确配置快照重建；不新增订单、仓位或真实止损动作。

JSON 结构导出包括完整窗口行、版本、哈希、原因、事件和检查点；CSV 每个研究事件保留终点明细与完整检查点。账号原有研究结果持久化继续使用原机制，SBS 不覆盖旧特征结果。

## 可复现正反例和验证

在仓库根目录运行（已安装锁定依赖，无需升级）：

```sh
node scripts/verify_sbs5m.mjs
```

输入与逐根预期位于 `docs/examples/sbs-5m-cases.json`。正例北京时间 2026-10-30：

| 时间 | 已知事件 | 主支撑 |
|---|---|---:|
| 11:00 | 第一箱冻结 | null |
| 11:05 | 冻结后浅测试、恢复、建立基准 | 100 |
| 11:15 | 两根收盘突破箱顶 | 100 |
| 11:45 | 突破之后形成更高新箱并冻结 | 100 |
| 11:50 | 新箱独立测试成功、正式抬升 | 104 |
| 12:00 | 重新离开后的再次测试成功 | 104 |
| 12:05 | 当根低点触及固定 K，虽收回高位仍失效 | null |

反例建立基准后持续单向上涨，仍保持原支撑 100，不因高点创新或旧低点移出窗口抬升。脚本校验两例的逐根预期、批量/流式一致及中断恢复一致。

真实 BTCUSDT 回放：UTC 2026-10-28 至 10-31 共 864 根连续 5m；交易所 tick=0.1。原始文件 SHA-256 `ab9a5252a35b0d4df01abdc2114e117b2baee0e1e5e6b898952eaba16065249b`。批量、流式及第 400 根检查点恢复相同；9 个基准、1 次台阶抬升，140 根 ACTIVE、716 根 NO_STRUCTURE、8 根 active 失效时点。箱体事件中的 INVALID 同时包含 pending 失效，不能混称为 active 失效次数。汇总在 `docs/examples/sbs-5m-btc-replay.json`，完整公开行情与回放留在本地 generated/sbs5m-validation/。

可以对独立 Binance 原始 K 线 JSON 文件复算：

```sh
node scripts/verify_sbs5m.mjs --history generated/sbs5m-validation/BTCUSDT-20261028-30-curl.json --symbol BTCUSDT --tick 0.1
```

评价严格从确认之后开始，排除确认本身的恢复根；记录确认后 15/30/60 分钟最大下穿、触及 K 比例、独立再测试恢复、新台阶比例、失效、覆盖率、确认延迟，以及有明确行情的未再抬阶上涨段。连续未来数据不足则标签 null。

当前只完成三日单品种工程回放和合成验收，未做多品种、时间外验证、参数寻优或与滚动最低价的匹配对照。对照需控制确认距离、事前尺度及趋势，按时间划分训练和验证，不能用支撑较远解释为更准确。不能据此宣称盈利或预测优势。

最终验收：61 项核心/状态/实际研究流水线/PRS与ATI回归/菜单与UI测试通过，TypeScript及生产构建通过。原生K线菜单已实际添加SBS-5M，价格主图已显示基准100、抬升104及失效断线；辅助证据与事件区按需展开。
