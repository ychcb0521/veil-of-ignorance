# DBL-5｜达瓦斯箱体下轨

DBL-5 是已收盘 **5 分钟** OHLC 的达瓦斯箱体工程改编。主值是当前有效、完整确认且冻结的下轨价格；没有有效支撑返回 `null`，从不以 0 或过期价格填补。箱底确认不等于经过后续回踩验证；本特征不执行交易、不改仓位或真实止损。默认参数尚未实证拟合，合成测试不证明收益或支撑有效率。

## 入口与输出

- **复盘中心 → Deep Dig → 达瓦斯箱体**：DBL-5、DBL·距离、DBL·箱宽、DBL·年龄。原始下轨价格研究需选择单一标的，跨品种使用基点或年龄输出。
- **盘面 → 指标 → 自制区 → 达瓦斯箱体**：DBL-5 将上下轨画在价格主图；三个派生量各按自身单位显示。只支持真实 5m 口径；其他周期和镜像合成价格不套用 72 根规则，当前不显示结果。
- Deep Dig 的变量选择、描述/推断分析、捕捞数值条件、历史重建、CSV/JSON/图片导出复用现有机制。事件筛选使用枚举名称或专门的 0/1 布尔变量，不把事件编码当连续强弱分。

|字段|单位/缺失约定|
|---|---|
|`darvas_5m_lower` / `upper`|价格，可空；内部比较为整数 tick|
|`distance_bps` / `width_bps`|bp，可空；分别为 `10000*(close-D)/D`、`10000*(U-D)/D`|
|`age_minutes`|分钟，自完整确认时间计算，可空|
|`available`|布尔值；无事件 NONE 不代表不可用|
|`event`|本根事件枚举，包含破坏、过期、行情缺口、数据无效|
|`status`|ACTIVE / SEARCHING / WARMUP / DATA_UNAVAILABLE|
|`freshness`|`2^(-floor_age_minutes/60)`，时间衰减量，**不是成功概率**|

以上实际 JSON 字段均带 `darvas_5m_` 前缀。`formation_type` 记录当前箱体接替时的分类，普通无事件 K 线不会将它改成 NONE。完整元数据包含 box/episode ID、上下轨 tick 字符串、种子/最早依赖/箱底锚点/上下轨确认/到期时刻、结束 ID、double_breach、有效参数、算法版本、源数据版本及校验值。大整数 tick 存为十进制字符串，可用 JSON 无损导出。对外价格用 JS Number 表达；极高价格精度的精确边界以元数据 tick 为准。

## 参数与状态规则

默认 `{timeframe:'5m', n:3, window_minutes:360}`。窗口可设置为 20–10080 分钟且必须是 5 的倍数。令 W=window_minutes/5，必须满足 `2*n+1<W`，n 为正整数；默认 W=72 时 n 为 1–35。在“编辑定义”中保存参数，配置与账号原有特征定义一起持久化。

1. H[p] 严格高于此前 n 根最高价才创建候选。种子位置 p 固定，origin=p−n，种子自己的最低价不进入箱底。允许相同上轨、不同种子的多个候选。
2. 候选中 H>U 取消；上轨未确认时 H=U 仅重置上轨等待，H<U 连续 n 根确认上轨。确认后再等于 U 不取消。
3. D 是种子后全部最低价的最小值，r 是最后一次达到 D 的位置。等于 D 也重置箱底等待；上轨已确认、t−r≥n、宽度至少 1 tick 且未到期才完整确认。默认最早在 p+4，确认不会回填到种子或低点时刻。
4. 同根先收集全部新确认箱体，再按最高 D、最新 p 一次选择。有效旧主线只接受更高 D 或同 D 更新 p。未选中的新确认仍保留在 `new_confirmations`；同一 box_id 的边界和全部坐标冻结。
5. 无旧有效箱体为 BASELINE；D、U 都抬高是 UP_STEP（允许区间重叠）；D 抬高但 U 不抬高是 NESTED_HIGHER_FLOOR，界面单独用琥珀标记；同 D 更新种子为 SAME_FLOOR。普通触底不产生新箱体、不续期。
6. 处理顺序：连续性 → 到期 → 旧有效支撑破坏 → 更新候选与统一选择 → 新种子 → 发布。`L<D` 即破坏，收盘回到 D 之上也无效；`L=D` 有效。破坏清空候选，当根不替代、不播种，不回落旧低箱底。H>U 且 L<D 记录 double_breach，OHLC 不推断盘中先后。
7. `current_time >= origin_time + window` 即到期。主线到期保留年轻候选，不回填旧已确认箱体；若同根新箱确认，可开启新基线/episode，并保留旧结构到期信息。
8. 缺口清空主线、候选和回看上下文，从当前真实 K 线预热。不插值。完全相同最新输入幂等；同时间冲突、乱序增量明确报错。价格不在整数 tick、缺 tick、精度规则突变等输出 DATA_INVALID 和空值。

## 时间对齐、历史与缓存

供应商 K 线时间戳为开盘时刻，DBL 统一使用 `openTime+300000` 作为收盘可用时间（供应商 `closeTime=openTime+299999` 是毫秒包含端点）。全部内部使用 Unix 毫秒，页面沿用项目 UTC+8。查询按最后一个 `available_at <= anchor`，不使用最近未来点；未结束 K 线不计算。盘面绘制落在收盘位置，十字线读取已可用的前一根结果，确认前留空，破坏/到期断线，不跨 episode 接线。

六小时限制的是几何证据年龄，**不是状态机全部记忆**。统一 `Dbl5Engine.push` 用于批算、增量、Worker、研究和回放。可恢复检查点包含完整主箱体、全部候选、最近 n 根上下文、上一根输入及指纹、episode 和事件、算法/参数/源/精度/初始化身份。仅下轨不足以恢复。

Deep Dig 可在“回放起点”固定 5m 开盘时刻；留空使用本次完整数据的起点，结果和导出明确记录实际起点。盘面首次初始化使用初始行情前 24 小时起点，隐藏历史尚未加载完时不发布临时结果，之后视窗缩放与补载不会移动该起点；早于起点的补载部分留空。要比较不同链路，需统一品种/市场、源数据版本、tick 和明确初始化起点；24 小时初始化**不宣称等价于任意长度持续在线历史**。源 OHLC 修订会使盘面版本递增并顺序重放；修改参数、版本、tick 或起点不会复用旧身份结果。

独立 IndexedDB `veil-dbl5m-state-v1` 保存完整检查点，按账号前缀、品种、市场、5m、算法/配置哈希、tick、源/修订版本、初始化起点隔离。保存失败不冒充已写盘；相同末时刻不同指纹单独保存修订分支，不覆盖原头。同起点批算与恢复必须一致。Deep Dig 原有结果及序列存储随定义键版本失效；历史记录不会静默改写，需要按新定义重新运行。没有新增数据库表、迁移或云服务。

## 实际接入位置

|位置|职责|
|---|---|
|`src/lib/dbl5m.ts`|唯一精确 tick 状态机、schema、参数、版本、as-of|
|`src/lib/deepDig/{features,analysis,series,export}.ts`|4项注册、计算、研究范围、单位、有效/缺失与事件统计、CSV/JSON|
|`src/components/journal/deepDig/{DefinitionPanel,FeatureView,Dbl5EvidenceView}.tsx`|配置/选择、图表/状态、折叠证据与枚举筛选、完整结构导出|
|`src/lib/{featureSource,researchIndicators,customIndicators,dbl5mChart,dbl5ChartTimeline}.ts`|指标表注册、主图价格、收盘绘制、初始化固定与修订重放|
|`src/lib/{chartComputeClient,chartCompute.worker,researchChartHistory}.ts`|Worker 调用、十进制 OHLC 旁路包、原生5m预热|
|`src/hooks/useBinanceData.ts` / `src/lib/deepRsa/window.ts`|保留供应商原始 OHLC 字符串；原有 Number 字段兼容|
|`src/lib/dbl5mPersistence.ts`|完整检查点及身份隔离|
|`src/lib/fish/{algorithm,intersection,reconstructionLoader,quality}.ts`|捕捞布尔/价格/基点输出与历史重建配置|

项目未提供独立服务端特征 HTTP API：请求/响应为前端统一计算 API 和 Worker；没有新增 Edge Function。无需数据库模式变更。指标不直接接交易执行、仓位或策略判断；非真实 5m 的跨周期/镜像行情不适用。不同数据提供方仍须提供可信的 tick/OHLC；未提供则明确不可用，不猜精度。

## 验证与复现

```sh
node_modules/.bin/vitest run src/lib/__tests__/dbl5m.test.ts src/lib/__tests__/dbl5mPersistence.test.ts src/lib/deepDig/__tests__/dbl5Integration.test.ts src/components/journal/deepDig/__tests__/dbl5Evidence.test.tsx --maxWorkers=1 --no-file-parallelism
node scripts/verify_dbl5m.mjs
node scripts/verify_dbl5m.mjs --history <Binance原始klines.json> --tick <实际tick> --symbol BTCUSDT
npm run build
```

18 根固定样例：1–7 空、8–13 下轨100、14–17 下轨102、第18根空；第8根 BASELINE、第14根 UP_STEP、第16根触底有效、第18根影线破坏。测试覆盖并行候选、同底、内部抬高、同根选择顺序、过期/破坏优先级、缺口、重复/冲突/乱序、tick精度、批算/恢复/未来追加不改历史，以及 Deep Dig → 盘面 → 筛选 → 导出一致性。

验证范围及实际结果见同目录 `dbl-5-validation.md`。本任务不声称参数拟合、真实回踩成功率或盈利能力。

## 历史报价规则修复（dbl-5-v2 / 458）

RAVEUSDT 的2026年4月历史K线不能按当前tick=0.0001验证。币安[正式公告](https://www.binance.com/en/support/announcement/detail/bb0c704f3ca344c7a8741c551dd624ce)公布其2026-04-27 06:30 UTC由0.00001变为0.0001。`dbl5mMarketRules.ts`以有出处的时间化元数据解析旧行情，统一作用于Deep Dig、盘面、Worker和捕捞；不按OHLC的小数位推测tick，不放宽整数格点检查，也不修改SBS/PRS/ATI。只在最新已登记规则仍匹配当前交易所元数据时采用该历史链；其他未知精度问题仍明确不可用。

经过实际报价规则切换时，结束旧结构、清空候选与回看，切换根记录TICK_RULE_CHANGED并留空，下一根按新精度重新预热；不会永远停留在旧规则。算法版本升为dbl-5-v2，旧检查点及研究定义键失效，历史研究需重跑。主图和副图无输出时显示准备历史、预热、无确认箱体或数据不可验证状态；派生量轴使用适合其单位的显示精度。

复现原截图：RAVEUSDT 2026-04-08 00:00 UTC至2026-04-10 04:05 UTC的625根公开5m行情，误用当前规则时625根均不合法；修复后非法根数0，有效支撑368根。独立按已核实历史tick重放与统一特征入口逐行完全一致。新增测试覆盖真实形状的冷启动元数据请求、隐藏历史加载及四个输出收敛，另覆盖官方生效边界、未知规则不猜测及跨精度检查点恢复。
