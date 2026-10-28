# MBI 迈克尔买方优势

Deep Dig 内置键 `mbi`，公式输出名 `MBI`，紧接 CBI2。配置 `MBI_N = 25`、`MBI_Z0 = 1.25`，定义、图表、捕捞、过滤和监测共用同一份计算。

## 计算与窗口

只用所选周期的已收盘正收盘价。`x = ln(C)`、`alpha = 1/n`、`kappa = 1/sqrt(alpha*(2-alpha))`；初始 M 为首根 x，初始 S 为前 n 个对数涨跌平方的平均。每根先用更新前的 M、S 计算 `z = (x-M)/(kappa*sqrt(S))`、`MBI = tanh(z/z0)`，再更新 M、S。S 为 0 时 z 与 MBI 都为 0。

前 5n 根输出为空，不参与平均、平滑或评估。默认 5m 取锚点前 701 根：125 根预热 + 576 根（48 小时）分析窗。K 线由原 `extractWindow` 升序、去重并过滤到锚点前已收盘；缺线沿用 95% 覆盖率规则，不填价、不补零。公式编辑增加 n 或嵌套依赖时自动扩展历史。未使用的 hl 不改变 MBI 取数窗口。

原始 MBI 与 CBI2 一样取公式末值，**不额外再对末值加权**。`avg_MBI_2` 复用现有 `researchChartFormula` 的共享构造器：对四个 6 小时段的平均，近到远按 4:3:2:1 加权。`avg_MBI` 为同一函数生成的 24 小时均值。原有 CBI2 及其他特征的公式、参数、窗口与数值不变。

## 接入和存储

- `deepDig/features.ts`：内置定义、可编辑参数、公式与历史依赖；参数进入定义键和快照，旧结果会按原机制标记过期。
- `mbi.ts`：双精度递推；公式语言函数 `mbiz(C,n)` 和图表共用。
- `researchAverageFormula.ts`：从原函数原样提取的共享均值构造器，保留账号已有均值表达式。
- 特征目录、指标菜单、主图副图、捕捞和过滤指标列表均包含 MBI 与命名均值；正绿负红，显示两位小数。回放复用既有已收盘标记，成形根不发布 MBI 读数。
- 定义沿用账号键 `deep_dig_features_v1`；描述与推断沿用 `veil.deepDig.data.v2` / `veil.deepDig.infer.v2`；MBI 曲线使用 Float64Array 存入原 IndexedDB，其余特征保留原缓存格式。
- JSON 保留全部公式变量与参数；CSV 输出全部变量的全精度值、锚点和取样偏移；PNG 同时展示 MBI、avg_MBI_2 的分组描述。删除、暂时排除、选取曲线时点均沿用现有逻辑。

## 评估

沿用现有 `collectDeepDigRun`、描述统计、推断统计和规律提取。战役实验组 `Bₜ > 3 or b > 3`，对照 `Bₜ < 0.5 or b < 0.5`；信号实验组星级至少 3、对照少于 3，未评级仍为其他。随机时点、合簇、发现/确认划分、排除、缺失处理及检验算法均未修改。

MBI 默认推断命令在同一份报告中分别检验原值与 avg_MBI_2（Welch、排名比较、相关和五分位），也可继续使用原有回归、RSA、机器学习命令。既有研究文件中未定稿的“买方优势延续”标签不由本次新增特征擅自重定义。

## 验证

`src/lib/__tests__/mbi.test.ts` 实测 A–E：A、B 所有点误差小于 1e-6；20 万根随机游走（种子 20261029）z 标准差 1.0084312159895714，MBI > 0.8 比例 0.08571357098186366；400 根单边涨/跌结果分别为 ±0.9999726519559868，横盘为 0；截断与追加未来数据的最大差为 0。

`mbiIntegration.test.ts` 用 origin/main `998a7339` 的原版引擎生成的固定指纹核对原有 13 个特征：每个特征 900 根、全部中间变量和两种均值的 SHA-256、定义键、窗口完全一致。另验证 701 根窗口、只依赖价格、平滑复用、双精度缓存、快照恢复、不同周期、成形根、导出和同报告评估。

真实信号验证可读取用户本地冻结行情，不上传或改写研究源数据：

```bash
MBI_REAL_INPUT=/absolute/path/to/closed-bars.json \
MBI_REAL_OUTPUT=/private/tmp/mbi-real-result.json \
npm test -- src/lib/deepDig/__tests__/mbiRealSignal.test.ts --maxWorkers=1
```

输入结构为 `{metadata:{symbol,anchorMs,quality},bars:ResearchBar[]}`；应覆盖该真实信号的特征预热窗及前后曲线时段。默认不提供本地输入时此项跳过，CI 不访问或修改账号数据。
