# 空方特征版本2：最近2小时加权

本次按用户确认的口径执行：**保留原窗口，最近2小时相对更早观察的权重为3倍**。这是历史计算核中的相对权重，不是将最终负分乘3，也不保证每根结果都比原版更负。

## 副本与入口

Deep Dig 目录和指标菜单新增“空方特征 · 版本2”分组。每项名称以“版本2”结尾，可以与原版分别选择和比较；捕捞、挖掘、买前过滤、持仓监测沿用同一套账号特征注册和计算机制。

2026-10-30补入状态S，分组共16项。S的副本继续使用0–1刻度、0.5均衡和原0.6图表参考线；较低读数代表较强卖方状态，不做负号转换。

| 原 feature_id | 独立副本 feature_id |
|---|---|
| state | state-v2 |
| cdi2 | cdi2-v2 |
| seller-control | seller-control-v2 |
| dss | dss-v2 |
| cda | cda-v2 |
| mbi-bear | mbi-bear-v2 |
| ctba-bear | ctba-bear-v2 |
| mbi2-bear | mbi2-bear-v2 |
| ctba_12h-bear | ctba_12h-bear-v2 |
| cdi2-retain | cdi2-retain-v2 |
| seller-control-retain | seller-control-retain-v2 |
| dss-retain | dss-retain-v2 |
| mbi-bear-retain | mbi-bear-retain-v2 |
| ctba-bear-retain | ctba-bear-retain-v2 |
| mbi2-bear-retain | mbi2-bear-retain-v2 |
| ctba_12h-bear-retain | ctba_12h-bear-retain-v2 |

另外识别已有卖方 chartCore / chartTemplate 的账号自定义副本，生成 `seller-focus-v2--原ID`。不单凭中文名称猜测方向。已有版本2（含隐藏项）不会重复创建，也不会在原版修改后重新覆盖。

复制先调用现有 `copyFeatureDefinition`，冻结创建时的有效账号公式、周期、原窗口、半衰期、MBI 参数、研究窗口与分组规则，再改写副本公式的时间聚合调用。原版定义及历史结果不修改；新 ID、新公式定义键、行情计算缓存、研究状态、扫描设置和递推状态分开。

## 参数与计算

在副本“编辑公式”顶部修改：

```text
focus2_h = 2
focus2_weight = 3
```

命名冲突时自动使用独立前缀（如 `focus2__h`）。`weight = 1` 逐根恢复复制时的原公式计算。小时数须为正数，权重须为至少1的有限数。以原周期换算近2小时根数，5分钟为24根；根数取法与现有小时窗口相同。权重作用于每次时间聚合的最近时段，含该采样根；无数据仍遵守原公式的缺失处理，不补出新观察。

令 a(j)=3（0≤j<L）或1（j≥L），L=round(120/周期分钟)。在原核 w(j) 上乘 a(j)：

- 均值、回归、稳健中位数及MAD使用新的相对观察权重。样本标准差使用可靠性权重分母 `W − W2/W`，W=Σw、W2=Σw²；统一乘常数不会改变标准差。参考 [NumPy weighted covariance normalization](https://numpy.org/doc/stable/reference/generated/numpy.cov.html)。
- EMA/Wilder 保留原半衰期或 n，将原递推核的近2小时部分乘3后归一化；初值、有效观察的跳过规则和ATR预热不变。
- 求和类、wsum 在重加权后归一回原核总质量，保留原来的和的量纲，避免全窗口都在2小时内时凭空变成3倍。
- retain 保留原时间衰减、窗口和逐根位移重估，仅调整相对时间权重并归一化。
- MBI / MBI2 保留 n、原5n预热和先计算后更新；均价及历史收益平方的核分别重加权，κ用重加权均价核的收益尾系数平方和重新计算，避免假装原κ仍然适用。
- CTBA 保留 N、f/s、m、λ、ε、α/β/γ和预热、缺根门控。重加权对数VWAP EMA、波动率和主动买卖金额。正权重不改变历史最高/最低价，所以T的区间定义保持原样。
- prev / ago / highest / lowest / peak / full / 状态机保持原定义，避免把价格极值、时间滞后或连续性检测误改成平均。

负向响应函数、非线性压缩位置、分量权重和各自均衡参考保持原样。嵌套聚合均按自己的采样时点重加权，不把最终分数直接缩放。新阈值保持空白，由用户设定；原版捕捞/卖出门槛不自动复制为已验证的新门槛。

## 验证范围

专项测试覆盖全部16项副本：独立ID与配置、账号公式冻结、重复加载和隐藏项、权重1逐根与原版一致、原参数与历史预热不缩短、前缀无未来数据、增量及当根修改与全量一致、图表与扫描读数一致，以及CTBA零点/缺失处理。

这些是计算和接入验证；本轮不执行历史策略优化，不改研究数据，不把原历史结果改名作为版本2结果。版本2的历史研究需要在各自特征下按新公式重新运行。
