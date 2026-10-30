# 卖方成交保留增强副本 v1

复制范围为现有卖方注册表中除 CDA 外的七项。CDA、买方指标、状态 S/S2 原样保留。

| 原特征 ID | 独立副本 ID | 新核心序列 |
|---|---|---|
| cdi2 | cdi2-retain | CDI2_retained |
| seller-control | seller-control-retain | bc_retained |
| dss | dss-retain | DSS_retained |
| mbi-bear | mbi-bear-retain | MBI_bear_retained |
| ctba-bear | ctba-bear-retain | CTBA_bear_retained |
| mbi2-bear | mbi2-bear-retain | MBI2_bear_retained |
| ctba_12h-bear | ctba_12h-bear-retain | CTBA_12H_bear_retained |

首次创建使用账号当前有效公式及参数，深复制后冻结到副本；已有副本不重复创建、不跟随原特征后续修改。无效原公式保留为待修正，不偷偷回退到默认公式。副本名称追加「成交保留增强」，目录和指标菜单单列「卖方成果保留（独立副本）」。

## 数学定义

输入先冻结，防止原 CTBA 等公式的 T/F/M 等变量重命名污染新增计算。B、S 是主动买入/卖出成交额，Q=B+S，E=成交均价，P=max(E,C)，r=ln(E/prev(E))。

- 基线成交额 Vbar=上一根及以前 avgh 小时的 Q 均值。
- sigma=上一根及以前 avgh 小时 r 的样本标准差；sigma_eff=max(sigma,1e-6)+1e-12。
- flow=(B-S)/Q；卖方占优为负。
- support=ln[1+(|B-S|+eta·(Q-|B-S|))/Vbar]，eta=0.5。
- impact=-max(-r,0)/[sigma_eff·(|flow|+flow_floor)]，flow_floor=0.05。这是K线级单位成交失衡的下行价格冲击代理，不是完整订单簿 OFI，也不是识别出来的因果冲击系数。
- K=support·[1+alpha·max(-flow,0)]·[1+impact_weight·max(-flow,0)·tanh(-impact)]；alpha=1，impact_weight=0.25。
- retention_z=retain(K,P,prev(E),hl,W)/sigma_eff。
- price_z=retain(1,P,prev(E),hl,W)/sigma_eff。
- anomaly_z=ln[P/prev(E)]/sigma_eff。

retain 沿用现有通用函数：在过去 W 小时对每个时点 i，用**当前** P_t 重新计算 ln(P_t/E_(i-1))/(t-i+1)，乘指数时间权重与 K_i 后归一化加总。因此，过去下移仍未收复时为负；当前价格收复时所有历史位移被重估，不把旧下跌贡献永久保留。

新增窗口 W 默认48小时；CTBA-12H 卖方副本为12小时。原算法的窗口、衰减参数、周期和预热均保留。新增项有自己的完整窗口检查，需要另外读取基线及滚动预热历史，不拿原特征数值改名冒充结果。

## 合成与参数

对原始有界输出 b（原始幅度上界 s），副本使用 s·tanh[atanh(clip(b/s,-1+eps,1-eps))+gain·retention_z]，gain 默认0.5。

对原始无界的 DSP·bc，使用 b+gain·retention_z，保持原显示倍率100。gain=0 时逐根直接返回原算法读数，便于消融对照。

有界原算法越界时保持缺失。gain、alpha、impact_weight 要求非负，eta 在0～1内，三个数值下限要求大于0；不合法参数不生成增强结果。不同历史时点的正负位移可能抵消，0不意味着所有历史跌幅都已收复。零点为公式综合中性基准，不按样本均值、中位数重新定心。新增证据有正负，失守为负、收复后回升；原算法与新增证据可能抵消。该值不是下跌概率，也不保证降低误报。gain、eta、alpha、impact_weight、flow_floor、sigma_floor、epsilon、window_h 集中写在各副本公式的 sr_ 参数段，可分别修改；名称冲突时自动使用独立前缀。

## 数据与接入

只使用已完成K线。缺成交额、零成交、无效价格、时间缺口或原算法/新增窗口未预热，保持缺失；不补零。波动率分母只用上一根及以前；当前K线允许作为当次失守证据，不能看下一根。

Deep Dig、图表、捕捞、挖掘、买前过滤、动态卖出与持仓否决均通过原有特征定义机制选择和计算。每个副本具有自己的公式、参数、ID、定义版本、均值序列、缓存与研究结果；不复制原特征历史结果，不替换现有策略选项或门槛。图表固定零参考线、正负分色，悬停显示原值及六个诊断分量；原始值、均值和近端加权均值可分别展示。

成交失衡/价格冲击的理论背景：[Cont、Kukanov、Stoikov，The Price Impact of Order Book Events](https://arxiv.org/abs/1011.6402)。该研究不构成本副本在加密资产上的有效性证明；须在共同样本、镜像前后分开、样本外验证中检验新增贡献。
