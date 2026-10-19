> 本表2000根5m为最初准入与现场复现的核实样本。当前「渔」已改为Deep dig可选特征值：实际周期取intervalOf，历史长度N按完整程序与收敛预热决定（≤5000），不再固定2000/1454；下方原始现场证据保留。

# 「渔」交易所核实表

核实日期：2026-10-19。结论：保留币安，新增 **OKX、Bitget、Gate**；**Bybit、KuCoin 合约、MEXC 合约不接入**。未通过的交易所不显示可选入口。没有使用持仓比、涨跌方向、收盘价乘张数等替代主动买卖成交额。

## 四项准入核实

| 交易所 | 交易中的 USDT 本位永续 | 连续 2000 根已收盘 5m OHLC、USDT 成交额 Q | 同区间真实主动买卖额 B/S | 浏览器访问 | 结论 |
| --- | --- | --- | --- | --- | --- |
| Binance | `exchangeInfo`：PERPETUAL / USDT / TRADING | 原生 klines，1000 根 × 2；Q=`row[7]` | 原生 B=`row[10]`，S=Q−B，天然同口径 | 公开 REST 直连 | 保留 |
| OKX | `public/instruments?instType=SWAP`：settleCcy=USDT、ctType=linear、state=live；只取币本位面值可明确换算的 `*-USDT-SWAP` | `market/history-candles?bar=5m`，100 根反向翻页，仅 confirm=1，Q=`volCcyQuote` | **不用 Rubik 统计接口**；用 `market/history-trades` 的历史真实逐笔成交按 taker side 汇总；公开历史 3 个月 | 最新实测三个所用端点均允许生产域 Origin；优先直连，网络/CORS 失败时回退白名单 Supabase `fish-market-proxy` | 接入 |
| Bybit | `instruments-info` 可筛 linear / USDT / LinearPerpetual / Trading | `market/kline` 支持 5m，turnover 为 USDT | `recent-trade` 仅最近最多 1000 笔，无完整历史时间分页；`account-ratio` 是账户数比例。未找到覆盖 2000 根的公开真实 taker 金额来源 | 即使代理可读，也不能补足历史 B/S | **不接：第 3 项失败** |
| Bitget | `mix/market/contracts?productType=USDT-FUTURES`：quoteCoin=USDT、symbolType=perpetual、symbolStatus=normal | `history-candles`，200 根反向翻页，Q=`row[6]` | **不用 taker-buy-sell 近期统计**；`fills-history` 可查最近 90 天真实历史逐笔，start/end 单次跨度≤7天，1000 笔按 idLessThan 翻页。2000 根为 6 天 22 小时 40 分钟，符合跨度限制 | 实测正常响应 Access-Control-Allow-Origin=*，直连；网络/CORS失败可回退只读代理 | 接入 |
| Gate | `/futures/usdt/contracts`：direct、非 in_delisting、status=trading | `candlesticks`：5m、from/to，最多 2000，to 取最后一根开盘秒；Q=`sum` | **不用 contract_stats 的张数近似金额**；`trades` 的 size 正数为主动买、负数为主动卖，真实价格逐笔换算；from/to + offset 翻页 | 实测正常响应 Access-Control-Allow-Origin=*，直连；网络/CORS失败可回退只读代理 | 接入 |
| KuCoin 合约 | `contracts/active` 可列 USDT 结算、线性永续 | `kline/query` 支持 5m，最多 500 根，turnover 为报价成交额 | 公开 `trade/history` 只有最近 100 笔，无同窗口历史分页；私有 fills 仅个人成交，不能代替全市场 | 跨域或代理均不能补足历史 B/S | **不接：第 3 项失败** |
| MEXC 合约 | `contract/detail` 可列 USDT 线性永续 | `contract/kline/{symbol}` 有 OHLC、vol 与 amount | 公开 deals 仅最近成交，无完整历史时间分页；私有 order_deals 是账户成交，不能代替全市场 | 跨域或代理均不能补足历史 B/S | **不接：第 3 项失败** |

## 金额、分页与完整性

- OKX：合约每张基础币量 `c = ctVal × ctMult`，只接受 ctValCcy 等于基础币的 USDT 线性合约。逐笔基础币量=`sz × c`，USDT 金额=`sz × c × px`，依 taker `side=buy/sell` 分别加到 B/S。K 线 Q 直接用 `volCcyQuote`，不以收盘价换算。K 线基础币量=`vol × c`。首次逐笔请求 type=2、after=窗口右边界，之后 type=1、after=本页最小 tradeId，直到越过窗口左边界；tradeId 去重。
- Bitget：逐笔 size 已经是基础币量，USDT 金额=`size × price`，按 side 汇总 B/S；不再乘合约面值。K 线基础币量=`row[5]`，Q=`row[6]`。逐笔按降序 tradeId / idLessThan 翻页；显式传 startTime、endTime，避免默认查询窗口变化。
- Gate：逐笔基础币量=`abs(size) × quanto_multiplier`，USDT 金额=`abs(size) × quanto_multiplier × price`；size>0 加到 B，size<0 加到 S。K 线基础币量=`v × quanto_multiplier`，Q=`sum`。逐笔 trades 的 to 传完整右边界秒数，再按毫秒筛选 `[start,end)`；不能传 end−1 秒，否则会漏掉最后一秒内的成交。保留 create_time 的小数秒。
- 所有适配器按 openTime 去重、排序，必须逐一等于 `[tCut−2000×5m,tCut)` 的 2000 个时间点。BTC 也做同样检查；BTC 只需收盘价，不必额外下载逐笔成交。
- 每一根都校验 B+S 与 Q，容差 `max(0.000001 USDT, |Q|×10⁻⁸)`；同时校验逐笔基础币量与 K 线基础币量，容差 `max(10⁻¹⁰, |volume|×10⁻⁸)`。逐笔缺一根、分页受限、无法对账则整币跳过并计入「读数不全」。K线中间缺根计「缺口」；只有前段历史不足或全无K线计「当时未上市 / 历史不足」，不拿它们充当中间缺口。仅 Q 和基础币量都为真实零成交时，允许 B=S=0；不对缺失记录补零。
- OKX/Bitget 历史逐笔保留期限制意味着很久以前的模拟捕捞可能无完整数据；不会拿近期成交代替。活跃合约的 2000 根可包含大量逐笔成交，第一次扫描可能明显慢于币安；流式按根累加，不把全量逐笔保留在内存中。重复扫描缓存已对账的 K 线，只补新增或缺少的区间。

## 实测证据与误差

统一 K 线核实截止 `tCut=1792375800000`（UTC+8 **2026-10-19 10:10:00**）；2000 根区间为 openTime `[1791775800000,1792375800000)`。BTC公开K线实测：OKX 20页、Bitget 10页、Gate 1次，各返回连续2000根（当时旧请求的右端包含形成中的根，过滤后保留2000根；本次修正请求边界），第一根1791775800000、最后一根1792375500000，均无缺口。逐笔抽样选较早的 `openTime=1791805500000`（UTC+8 **2026-10-12 19:45:00**），已经超出 OKX Rubik 的近期覆盖范围。

| 来源与合约 | 实测 B（USDT） | 实测 S（USDT） | 同根 Q（USDT） | 相对误差 abs(B+S−Q)/Q |
| --- | ---: | ---: | ---: | ---: |
| OKX NMR-USDT-SWAP，235 笔 / 3 页，ctVal=0.1、ctMult=1 | 1482.0106 | 8047.2220 | 9529.2326 | 0 |
| Bitget BTCUSDT，3282 笔 / 4 页，size 为基础币 | 5672358.35438 | 5812798.92348 | 11485157.27786 | 0 |
| Gate BTC_USDT，2152 笔 / 3 页，quanto_multiplier=0.0001 | 6301878.50561 | 7726406.07700 | 14028284.58261 | 0 |

主动方向另行实测：Bitget BTCUSDT 的 openTime=1792367100000 一根，共1853笔历史成交，buy侧基础币量24.5983、sell侧53.5400，与官方 taker-buy-sell 同一时间戳的 buyVolume=24.5983、sellVolume=53.54 分别完全一致。统计接口只用于核实方向，没有用于补历史金额。

以上为公开响应十进制汇总结果，证明抽样金额口径一致；不是声称所有合约、所有时段都天然完整。程序对每次扫描的全部 2000 根重新做完整性检查。

特别排除：同一较早 BTC K 线上，OKX Rubik 返回 B=S=0，而真实 Q=19453943.324 USDT，误差为 100%，因此不能单独接 Rubik 来声称满足 2000 根。Gate contract_stats 的 long_taker_size / short_taker_size 为张数，没有逐笔成交价格，不能直接当作 USDT 成交额。Bitget taker-buy-sell 近期数据也不足以单独覆盖 2000 根。

## 限速、隔离与去重

| 交易所 | 文档限制 / 实现预算 |
| --- | --- |
| Binance | 实现滚动每 60 秒最多 1200 权重；1000 根 K 线每次权重 5，时钟、标的表计权重 |
| OKX | history-candles / history-trades 文档各 20 次 / 2 秒；实现合并预算 20 次 / 2 秒，更保守 |
| Bitget | fills-history 10 次 / 秒、history-candles / contracts 20 次 / 秒；实现合并预算 10 次 / 秒 |
| Gate | 公共接口文档每接口 200 次 / 10 秒；实现所有端点共用 200 次 / 10 秒，更保守 |

各交易所独立预算，跨交易所合计最多 3 个并行请求。429 计请求失败并按 Retry-After（至少 60 秒）暂停该家后续请求；418 中止该家。取消中断请求、分页、排队和限速等待。当前通用算法仅在引用BTC时取参考，任一所需BTC缺根会在产出信号前中止整轮。

默认依 Binance > OKX > Bybit > Bitget > Gate > KuCoin > MEXC 优先级，只扫描所有较高优先级、已接入交易所都未上线的基础币；取消某家勾选不会把它的重复币转交给低优先级。未通过核实的交易所不参与过滤。不知道较高优先级标的表时，无法保证排重，受影响的低优先级家停止并解释原因；「含重复币」开关可明确选择各家都扫。1000PEPE / PEPE、XBT / BTC 等统一基础币，保留 1INCH 的真实数字名称。

币安历史去重键保持 `标的@时间`；其它家为 `交易所:标的@时间`。非币安行有交易所标签，同基础币在币安有盘面时跳到对应币安标的；没有时跳转禁用，仍可评分、删除、加入原信号库。

## 一手接口文档

- [Binance 交易规则与合约信息](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Exchange-Information)、[K 线字段与权重](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data)。
- [OKX 官方 API](https://www.okx.com/docs-v5/en/)：Get instruments、Get candlesticks history、Get trades history、Get contract taker volume；特别注意历史成交的 3 个月覆盖与 taker side。
- [Bybit K 线](https://bybit-exchange.github.io/docs/v5/market/kline)、[近期成交](https://bybit-exchange.github.io/docs/v5/market/recent-trade)、[账户多空比例](https://bybit-exchange.github.io/docs/v5/market/long-short-ratio)。
- [Bitget 合约公开市场接口目录](https://www.bitget.com/docs/catalog/classic-contract-market/classic-contract-market)：Contracts、Get Historical Candlestick Data、Get History Transactions、Taker Buy Sell。
- [Gate 永续 REST](https://www.gate.com/docs/developers/apiv4/en/futures/)、[逐笔买卖方向定义](https://www.gate.com/docs/developers/futures/ws/en/#trades-notification)、[限速](https://www.gate.com/docs/developers/apiv4/en/)。
- [KuCoin 合约公开近期成交](https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-trade-history)、[K 线](https://www.kucoin.com/docs-new/api-3470234)。
- [MEXC 合约 API](https://mexcdevelop.github.io/apidocs/contract_v1_en/)、[新版合约接入说明](https://www.mexc.io/api-docs/futures/integration-guide)。

## 只读代理边界

部署状态：按用户本次选择先交付可直连版本。代理源码已准备，但尚未部署；已验证的 OKX 直连不依赖代理。若未来直连网络/CORS失败而代理仍未部署，会计为请求失败，不会伪造行情。

早期探测未返回跨域头，后续携带生产域 Origin 重测三个端点均返回匹配的 Access-Control-Allow-Origin。浏览器也成功直连；因此优先直连，仅网络/CORS 失败后切换到只读代理，HTTP 418/429 不会换路绕过。

`fish-market-proxy` 仅允许 OKX 的 instruments / history-candles / history-trades、Gate USDT futures 的 contracts / candlesticks / trades、Bitget mix market 的 contracts / history-candles / fills-history 公开 GET。请求参数带 `exchange`（旧 OKX URL 不带时仍默认 OKX），不接受调用者指定主机。逐项校验 USDT 永续、已支持周期、时间单位与上下界、分页游标、limit 上限；Gate K线含右端，校验 `(to-from)/周期秒数+1 ≤ 2000`；Bitget逐笔区间≤7天。拒绝外域、私有路径、重复/未知参数、负数、倒置区间及POST，不转发调用者 Authorization、Cookie。15秒超时、4MB响应上限；错误响应也有 CORS，保留真实HTTP状态及Retry-After。

OKX、Gate、Bitget只在直连抛TypeError（网络/CORS）时尝试一次代理，之后在当前页面沿用该家代理。不因HTTP错误切换路线；418中止该家，429计请求失败并按Retry-After暂停该家，不能借代理绕过。代理仍不可达时用中文显示「交易所 · 接口路径 · 浏览器拦截（网络 / 跨域）」；代理返回HTTP错误时显示真实状态与中文原因。代理代码需要随Lovable部署；仅推Git不能保证edge function已经生效。

## 2026-10-19 现场复现与 Gate 边界修复

现场截止 **2026-05-26 16:55:00 UTC+8**，tCut=1779785700000，所需开盘区间 `[1779185700000,1779785700000)`。

在隔离 Chromium 中以生产页面 Origin `https://veil-of-ignorance.lovable.app` 运行公开fetch（无登录凭据），原代码的实际请求为：

```text
https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=BTC_USDT&interval=5m&from=1779185700&to=1779785700
```

浏览器复现 `TypeError: Failed to fetch`，控制台明确报无 `Access-Control-Allow-Origin`。携带同一生产Origin用原始HTTP读取状态/响应体（浏览器无法读取被CORS隐藏的状态）：

```text
HTTP 400
Access-Control-Allow-Origin: [不存在]
Content-Type: application/json
{"label":"INVALID_PARAM_VALUE","message":"Candlestick too long ago. Maximum 10000 points recently are allowed"}
```

把旧历史请求to修成1779785400仍是相同400，说明**本次现场的直接原因是Gate K线保留范围，并非能仅靠少取一根解决**。此外，近期对照实测确证右端含端点：

| 同次测试（生产Origin） | from / to（秒） | HTTP | 跨域头 | 返回 |
| --- | --- | --- | --- | --- |
| 近期原边界 | 1791781500 / 1792381500 | 200 | `*` | **2001**根，含openTime=tCut的未收盘根 |
| 近期修正边界 | 1791781500 / 1792381200 | 200 | `*` | **2000**根，最后openTime=tCut−300秒 |

修正：每段K线查询使用 `from=段首开盘秒`、`to=段末最后一根开盘秒`，数量为含两端的 `(to−from)/300+1`，≤2000。缓存只补一根时from=to。拼接后必须为目标2000个时间点，不重复、不漏根、不包含正在形成的K线。

**逐笔边界不同于K线**：Gate trades仍传完整右边界秒，保留倒数最后一秒里的小数时间成交，然后按真实毫秒筛 `[from,to)`。不能照搬K线的to−300秒，也不能减一整秒；offset按服务器本页原始条数推进，包含边界外记录的页也不能少算offset；tradeId去重并验证分页推进。Bitget亦在读取后按 `[from,to)` 筛选，不因右端重叠改变offset/id游标。 实测同一BTC旧窗口：to=1779785700返回ID754147580/754147579（时间1779785699.535）；to减为1779785699后，第一页已退到ID754147577（1779785698.881），确实漏掉最后一秒内的成交。完整右端且offset=2返回754147578/754147577，与第一页不重叠，验证按原始页条数推进。

## 历史保留期预检（整个所需窗口）

实现常量：`src/lib/fish/retention.ts`。比较的是**所需第一根** `tCut−2000×5m` 与扫描开始时币安服务器时间推算出的保留期下界，不是只比较tCut；刚好位于下界允许，早于下界即跳过。预检在BTC及逐币请求之前执行，整家显示「已跳过」和原因，不把超期累计为读数不全/请求失败。

| 交易所 / 数据源 | 已核实范围 | 预检与出处 |
| --- | --- | --- |
| OKX `market/history-trades` | 最近3个日历月（约90天） | 按UTC日历减3个月，月末向当月最后一天收敛；[官方 Get trades history](https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-trades-history) |
| Bitget `fills-history` | 最近90天；单次起止跨度≤7天 | 按90×24小时；2000根5m约6天22小时40分，满足7天；[官方 Get History Transactions](https://www.bitget.com/docs/catalog/classic-contract-market/classic-contract-market#get-history-transactions) |
| Gate `trades` | 官方未承诺固定保留天数；本次在10月19日仍能取到5月26日的真实BTC逐笔，不能杜撰“只保留30/90天” | [官方公开trades](https://www.gate.com/docs/developers/apiv4/en/futures/#futures-market-transaction-records)；实测`from=1779785400&to=1779785700&limit=2&offset=0`为200，返回成交时间1779785699.535、IDs754147580/754147579；31天前也返回200 |
| Gate `candlesticks` | 实际上游硬限制：**最近10000个周期点**；5m约34.72天 | 由官方API现场400明确给出；[官方K线接口](https://www.gate.com/docs/developers/apiv4/en/futures/#futures-market-k-line-chart)另限定单次≤2000点。因此整家按所需窗口是否在最近10000根内预检，原因明确写“历史K线”，不误称逐笔成交到期 |
| Binance原生klines | 本任务没有新增固定天数限制 | 继续逐根检查合约自身可用历史 |

现场5月截止在10月运行：OKX、Bitget因逐笔保留期整体跳过，Gate因K线保留范围整体跳过；不会继续对几百个币做注定失败的请求。各交易所范围限制相互独立，币安仍可正常捕捞。

## 错误排查与小结

- 「当时未上市 / 历史不足」：截止前全无K线，或最早一根晚于所需起点且剩余历史连续。不是宣称一定未上市，也可能是该所的可取历史不足。没有伪造缺少的历史。
- 「缺口」：目标窗口中间或末尾真的缺K线、重复时间点、不连续；不能为了画满而补零。
- 「读数不全」：展开查看前10个币，显示主动成交接口阶段、失败时间点、B+S与Q及基础币量校验值；不会把历史超期塞进此项。
- 「请求失败」：展开查看前10个币，显示交易所、接口路径与HTTP状态（包括代理返回的400/404/500）；网络/CORS两条路都失败时写「浏览器拦截（网络 / 跨域）」，不直接显示英文Failed to fetch。
- 首先检查截止时间是否在支持范围；然后看可展开原因中的接口/HTTP状态；代理404或无法连接时检查edge function是否已部署。**到Lovable点 Publish → Update，edge function需要随发布才生效。**

## 通用算法取数补充

- 共享定义键为 `FEATURES_KEY`（lib/deepDig/features.ts），只读Deep dig的合并定义。捕捞用evaluateOnBars一次求合成程序；没有改特征值公式或Deep dig的计算。
- 缓存按适配器内的 `(instrument, interval)` 分区并保留同周期较长历史，小窗口不会清空较长窗口。每个币算完让出主线程。
- 币安K线每次≤1000，Gate也分成≤1000根，to为该段末根开盘秒；OKX遵守100根、Bitget遵守200根的原生上限。时间按特征值周期对齐。OKX/Bitget小时使用1H等标签，日线使用1Dutc；6/12小时使用UTC对齐标签。
- Gate没有3m、2h、6h、12h原生周期，分别从1m、1h、1h、4h的完整连续K线聚合；Bitget的2h从1h聚合。聚合OHLC取首开/最高/最低/末收，币量和USDT成交额相加，缺根不补。Gate10000点保留期按实际较细原生周期检查，不能靠聚合越过上游范围。
- 只有程序引用B/S时才取逐笔；Q/E直接用K线报价成交额与基础币量。逐笔时间窗口分成≤7天的相邻半开段，每段内保留分页进度与末秒小数成交，统一按逻辑周期汇总。主条件与约束采用同一输入和截止，没有使用截止之后的数据。
- 只读代理现在白名单明确列出的原生周期，不接受任意周期字符串。仍拒绝私有路径、外域、重复/未知参数、倒置区间、超量请求；Gate闭区间根数按所选原生周期验证。前述5m探测、HTTP/CORS及成交误差证据未变。

## 美股（2026-10-19 核实）

本次只纳入 **币安、Bitget 的 USDT 股票永续**。现货 NYSE/NASDAQ 不接入：本任务没有可覆盖所需区间的免费公开真实主动买卖额来源，不用 tick rule、涨跌方向或其它估计值代替 B/S。美股身份只来自合约元数据；代码像 AAPL/COIN 并不决定市场。用户手工导入的 `[美股]` 是显式市场声明。

| 来源 | 交易中合约、计价币及美股元数据 | 2000 根已收盘 5m / Q | 同区间真实 B/S 与误差 | 浏览器 / 结论 |
|---|---|---|---|---|
| 币安 | `/fapi/v1/exchangeInfo`：`status=TRADING`、`quoteAsset=USDT`、`contractType=TRADIFI_PERPETUAL`（亦兼容明确 EQUITY 的 PERPETUAL）、`underlyingType=EQUITY`。排除 CN/HK/KR_EQUITY、PREMARKET、商品、指数；`baseAsset` 保存为 underlying。本次该股票类在交易中 183 项 | TSLAUSDT 实测 2000 根，连续、无未收盘根；K线第8项 quoteAssetVolume 为真实 USDT Q | 第11项 takerBuyQuoteAssetVolume 为 B，S=Q−B，与原生 Q 同口径，误差 0（金额未用收盘价换算） | 生产 Origin 返回 HTTP200、ACAO `*`。**接入** |
| Bitget | v2 `/api/v2/mix/market/contracts` 筛 `symbolStatus=normal`、`quoteCoin=USDT`、`symbolType=perpetual`；与 v3 `/api/v3/market/instruments?category=USDT-FUTURES` 按 symbol 精确连接，**`instrumentType=stock` 且 `marketRegion=US`** 才是美股；underlying 取元数据 baseCoin。本次匹配 233 项；不拿 `symbolType` 或 `isRwa=YES` 单独判定美股 | NVSUSDT 实测连续 2000 根 history-candles，Q 为第7项报价成交额 | fills-history 的真实 side，按 `size（基础资产数量）×price` 分别累加；1534 笔、2页；最大逐根报价误差 `1.82e-12 USDT`，基础数量误差 `3.91e-14`，小于原对账容差 | v3 生产 Origin HTTP200、ACAO `*`；原K线/逐笔接口沿用已核实直连及代理回退。**接入** |
| OKX | `instCategory=3` 仅表示 Stocks；当前 SWAP 元数据没有明确美国上市地区字段。不通过严格美股识别门槛，不按 instId 名字补判；只将 `instCategory=1`（兼容旧缺字段）作为原加密范围 | 该接口机制含确认收盘标记、报价 Q；因身份门槛失败，本次不另宣称已对股票完成2000根验证 | 仍可按原历史逐笔换算，但身份不明，不进行股票准入对账 | 直连/白名单代理可用；**美股不接入**，不把股票混入加密币 |
| Gate | `contract_type=stocks` 仅表示股票，无明确美股地区字段；其它 TradFi 分类也不混入加密币 | 原 candlesticks 有 OHLC、sum（报价额），有历史限制；身份门槛失败，本次不另作股票2000根通过声明 | 原逐笔正负 size 可换算，但没有通过美股身份门槛 | 原直连/代理沿用；**美股不接入** |
| Bybit | linear 元数据 `symbolType=stock`、`marketRegion=US`、`underlyingTicker` 可明确识别，USDT LinearPerpetual、Trading 可列举 | kline 含成交额 turnover，可分页 | recent-trade 为近期有限条数，未核实有公开历史主动成交接口可覆盖同区间2000根；taker 比例不能替代真实逐根金额 | 无论是否可代理，B/S 历史未通过；**不接入** |
| KuCoin 合约 | active 元数据 `assetClass=STOCK`、`subMarketType=US.STOCK`（marketType=NASDAQ）可识别 | kline 可取价格与成交额，需遵守分页 | 公开历史成交列表只有有限近期记录，未能提供2000根5m同区间真实 B/S；不拿其它量替代 | B/S 门槛未通过；**不接入** |
| MEXC 合约 | detail 有 conceptPlate/typeLabel 等标签，但未确认可严格区分美国上市股票的合约地区字段 | kline 有价格及 amount，张数须按面值换算 | deals 为有限近期成交，未确认支持所需2000根同区间历史 B/S | 身份与 B/S 历史均未通过；**不接入** |
| Kraken（追加复核） | `/derivatives/api/v3/instruments` 实测 229 项；`category=Equities` 11 项、`xStocks` 14 项，`type=flexible_futures`、`tradeable=true`、`quote=USD`。**没有美国上市地区字段**；`tradfi=false` 也出现在股票候选上，`isin` 是衍生合约标识，`countriesBanned` 是客户限制，均不能当作标的上市地区。候选 PF_NBISUSD 不因名称或 description 被认作美股 | trade 图表实测连续 2000 根；原生 `volume` 与基础资产数量相符，trade-volume analytics 同样返回数量，**未取得独立报价额 Q**。USD 计价本身允许，不做汇率换算 | `market/{tradeable}/executions` 有真实 `takerOrder.direction`、`price`、`quantity` 和时间/游标；单根样本有金额和方向，但未完成 2000 根独立 Q 对账。旧 `/history` 有近 7 天/重启限制，本次较早样本返回空，不能只凭该接口承诺全窗覆盖 | 生产 Origin 浏览器读取 instruments / candles 均 `Failed to fetch`，HTTP 抽查 ACAO 空；若其它门槛将来通过需白名单代理。**不接：第 1 项失败，Q/全窗对账未通过**。[元数据](https://docs.kraken.com/api-reference/instrument-details/get-instruments)、[K线](https://docs.kraken.com/api-reference/candles/market-candles)、[真实成交](https://docs.kraken.com/api-reference/market-history/get-public-execution-events) |
| Hyperliquid（追加复核） | `POST /info` 的 `meta` 原生目录 234 项、`meta {dex:"xyz"}` 136 项；universe 提供 `name/szDecimals/maxLeverage/marginTableId` 等，**没有股票类别与美国上市地区字段**。`xyz:TSLA` 只是诊断候选；HIP-3 前缀、deployer、名字和保证金币种不决定上市地区 | `candleSnapshot` 的 xyz:TSLA 实测连续 2000 根；字段 `v` 是基础量、`n` 是成交次数，**不是 Q**；日成交额 `dayNtlVlm` 不能拆作逐根 Q，禁止 `close × v` | 公开 `recentTrades` 本次只有 10 笔，带 side/px/sz/time，未覆盖固定截止窗口，也不是历史时间分页；用户 fills 和实时 WS 都不能替代缺少的全市场历史。B/S、报价误差未通过核实 | 生产 Origin 实测 meta / candles 均 HTTP200、浏览器可读。**不接：第 1 项失败，第 2/3 项金额与历史未通过**。[元数据/HIP-3](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)、[K线/Info](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) |
| BingX（追加复核） | `/openApi/swap/v2/quote/contracts` 不带 Origin 实测 1267 项；候选 `NCSKTSLA2USD-USDT` 的 `asset=NCSKTSLA2USD`、`displayName=TSLA-USDT`、`currency=USDT`、`status=1`。响应及官方 schema **没有股票类别/美国上市地区字段**，不能解析名称前缀或 displayName 来补判 | v3 klines 实测 1000×2 页、连续 2000 根；响应只有 OHLC、`volume/time`，没有独立报价额 Q；不按收盘价换算 | v2 quote/trades 的 `isBuyerMaker` 可说明真实方向，`quoteQty` 为报价金额；但只提供近期最多 1000 笔，请求参数没有历史 start/end/fromId 游标。样本只覆盖约 5 分钟，且全部晚于固定截止；私有 `trade/allFillOrders` 是账户成交，不能补全市场历史。**第 3 项不通过** | 携生产 Origin 的 HTTP 为 403、无 ACAO，浏览器不可读；去掉 Origin 后元数据/行情 HTTP200。未来需代理路径/参数白名单，不能把代理当作历史补数。**不接：身份及 B/S 历史未通过**。[官方接口文档](https://bingx-api.github.io/docs-v3/)、[近期成交与限速](https://bingx.com/en/support/articles/31103871611289) |
| Coinbase International（追加复核） | `/api/v1/instruments` 返回目录 310 项，`type=PERP`、`underlying_type=EQUITY` 23 项且现场全部 `trading_state=PAUSED`，`quote_asset_name=USDC`；**没有美国上市地区字段**。`execution_exchange=COINBASE_INTERNATIONAL_EXCHANGE` 不是标的上市交易所，不能由 AAPL 等名称推断 | 官方 FIVE_MINUTE candles 单次最多 300 根；2000 根直接请求明确 HTTP400，改为合法 288 根区间后 HTTP200 返回 `{}`，没有可核对 aggregations。未通过连续 2000 根及 Q 核实；文档 volume 没有独立报价/主动买额字段 | 官方公开 REST 目录未提供已核实的全市场历史带方向逐笔；`portfolios/.../fills` 是个人成交，不可替代。实时 MATCH 不代表可回填同一历史窗口。B/S 与误差均未取得，不能当 0 | 生产 Origin 浏览器读取失败；携 Origin 的元数据 HTTP400、无 ACAO（响应体仍有目录，不算正常可用行情）。**不接：身份/交易状态和第 2/3 项未通过**。[官方 REST/OpenAPI](https://docs.cdp.coinbase.com/api-reference/international-exchange-api/rest-api/introduction)、[市场订阅](https://docs.cdp.coinbase.com/international-exchange/websocket-feed/channels) |
| Crypto.com Exchange（追加复核） | `/exchange/v1/public/get-instruments` 实测 978 项；`inst_type=PERPETUAL_SWAP`、`product_type=EQUITY`、`tradable=true`，候选 AAPLUSD-PERP 的 `quote_ccy=USD`。**没有美国上市地区字段**；不把 EQUITY、基础币名称或 underlying_symbol 当作 US 标签 | `public/get-candlestick`，300 根按时间向前翻页，共 7 页取得连续 2000 根；`v` 是数量，响应没有独立报价 Q；USD 允许，但缺 Q 的证据不能靠换算收盘价补齐 | `public/get-trades` 的 `s` 是 taker 方向（官方 2024-02-12 变更说明），`q×p` 是真实成交报价额。单根样本两笔合计 65.1966 USD，数量与 K 线吻合；**未完成 2000 根独立报价 Q 对账**，不据此宣称全窗通过 | 生产 Origin 浏览器元数据 / K线均 HTTP200 可读，ACAO 回显生产域。**不接：第 1 项失败，独立 Q/全窗对账未通过**。[元数据](https://exchange-docs.crypto.com/exchange/v1/rest-ws/index-insto-8556ea5c-4dbb-44d4-beb0-20a4d31f63a7.html#public-get-instruments)、[K线](https://exchange-developer.crypto.com/exchange/v1/docs/api/rest/public-get-candlestick)、[主动方向说明](https://exchange-developer.crypto.com/exchange/v1/docs/api/rest-change-log) |

### 实测证据与取数口径

共同样本截止为 `2026-10-19 14:05:00 UTC+8`，区间 `[tCut−2000×5分钟,tCut)`。币安 TSLAUSDT：Q=1231787746.509502，B=592638585.7287016，S=639149160.780801 USDT（汇总浮点末位可能不同，逐根 S 直接由 Q−B 得到）。Bitget NVSUSDT：Q=73827.31690000003，B=40162.427000000025，S=33664.889900000024 USDT。逐笔方向统一按 API 的 buy/sell 字段忽略大小写读取。零成交K线只有在原生Q和数量均为零且逐笔对账一致时成立；缺失K线不补。

准入样本仍是2000根5m；实际扫描沿用所选 Deep dig 特征值的周期、warm/N 与全部约束，不改公式。美股与加密币共用同一家适配器、请求预算及 BTC 永续参考（CB），**CB不是股票指数**。停盘造成中间缺根按缺口跳过，不填补、不增加交易时段规则。

美股只按元数据代码在美股内部依交易所优先级排重；不使用加密币的1000前缀归并规则，不与同名币相互屏蔽。美股信号身份是 `us:exchange:underlying@time`，鱼另含算法键；加密币旧键不变。元数据代码作为正式代码原样保留，不根据名字删掉 STOCK 后缀或猜证券别名。地区/分类缺失或 v3 请求失败时不能猜股票类别。

Bitget代理仅增加 **`instruments?category=USDT-FUTURES` → 固定 `/api/v3/market/instruments`**，不允许SPOT、额外参数、重复参数或任意主机。其它行情路径、超时、只读GET与限速逻辑沿用。推送Git后需在Lovable点 **Publish → Update**；本次edge function也须随发布部署。

主要依据：[币安公开合约元数据](https://fapi.binance.com/fapi/v1/exchangeInfo)、[币安行情API](https://developers.binance.info/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)、[Bitget v3交易产品元数据](https://www.bitget.com/zh-CN/docs/catalog/market/market-data)、[Bitget合约行情文档](https://www.bitget.com/docs/catalog/classic-contract-market/classic-contract-market)、[OKX元数据文档](https://www.okx.com/docs-v5/en/)、[Gate合约文档](https://www.gate.com/docs/developers/apiv4/en/futures/)、[Bybit合约元数据](https://bybit-exchange.github.io/docs/v5/market/instrument)、[KuCoin合约API](https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-all-symbols)、[MEXC合约API](https://mexcdevelop.github.io/apidocs/contract_v1_en/)。

### 五家追加复核：固定窗口与金额样本（2026-10-19）

本轮五家均未通过全部准入，因此没有新增交易所枚举、适配器、勾选入口或代理白名单。现有美股仍只有币安、Bitget。这里的股票候选是公开目录返回的诊断对象，**不是依据代码名字认定的美国上市股票**。USD、USDC、USDT 各用原计价币，未做汇率换算；金额门槛与原有准入相同，没有降低对账要求。

统一截止 `tCut=1792405800000`，即 **2026-10-19 18:30:00 UTC+8**；2000 根目标开盘区间 `[1791805800000,1792405800000)`，首根为 10-12 19:50，末根为 10-19 18:25，信号/截止均只用已收盘根。Kraken、Hyperliquid、BingX、Crypto.com 的价格样本均为恰好 2000 个目标时间点，无重复、缺根或截止后的根；**这只证明价格/数量连续，不能代替报价 Q 与 B/S 的完整性准入**。

| 来源 / 实测候选 | 截止与样本 | Q / B / S（该家计价币） | 对账与局限 |
|---|---|---|---|
| Kraken PF_NBISUSD | 全窗截止如上；金额抽样为 10-12 **19:50–19:55**，3 笔 public execution，trade 图表该根 `volume=3.04` | K线独立 **Q=未提供**；真实逐笔总报价额 `Q_trade=653.8704 USD`，`B=653.8704`、`S=0` | Σquantity=3.04，与原生 volume 数量误差 0；`B+S−Q_trade=0` 是同源汇总恒等式，**不是与独立报价 Q 的对账通过证明**。`usdValue` 有自身舍入，本样本用精确十进制 `price×quantity`。未把数量或收盘价换算成 Q |
| Hyperliquid xyz:TSLA | 全窗截止如上；首根 `v=43.702`、`n=36`；recentTrades 返回 10 笔 | **Q/B/S=未取得完整同窗数据**，误差不适用 | 已取到的近期记录不覆盖该固定窗口；不能用日成交额、`v×close` 或将未返回的历史记成零来补齐 |
| BingX NCSKTSLA2USD-USDT | 全窗 1000×2 根；recentTrades 为 1000 笔，时间 **10-19 18:34:57.681–18:39:56.479** | **Q/B/S=未取得完整同窗数据**，误差不适用 | 1000 笔均晚于固定截止，不能用于这 2000 根；“窗口内没有返回记录”不代表真实 B=S=0。元数据 displayName=TSLA-USDT 只做展示，不作美股身份依据 |
| Coinbase INTX AAPL-PERP | 固定全窗首次请求被最大 300 根限制拒绝；合法对照区间 **10-18 18:30–10-19 18:30**（288 根）返回 HTTP200 `{}`；元数据 PAUSED | **Q/B/S=未取得**，误差不适用 | 没有 OHLC/aggregations 可核验，不补 0，不从 24h notional 分摊；23 个 EQUITY 合约均暂停不是其它市场的股票现货样本 |
| Crypto.com AAPLUSD-PERP | 全窗 300×6+200 根；金额抽样为 10-19 **18:25–18:30**，两笔真实主动卖单，数量 0.07、0.12，价格均 343.14；K线 `v=0.19` | K线独立 **Q=未提供**；`Q_trade=65.1966 USD`、`B=0`、`S=65.1966` | Σquantity=0.19，与 K 线数量误差 0；`B+S−Q_trade=0` 仍只是同源恒等式，独立报价 Q 误差不适用；只核实这一根，未宣称全窗 B/S 已通过 |

复现入口（公开、只读、无账户凭据）：

- Kraken：[候选目录](https://futures.kraken.com/derivatives/api/v3/instruments)、[2000 根 trade K线](https://futures.kraken.com/api/charts/v1/trade/PF_NBISUSD/5m?from=1791805800&to=1792405799&count=2000)、[金额样本真实成交](https://futures.kraken.com/api/history/v3/market/PF_NBISUSD/executions?since=1791805800000&before=1791806100000&sort=asc&count=1000)。交易目录含 Equities 与 xStocks，也含其它国家/地区和资产类别；没有上市地区字段时不靠人工名单补判。
- Hyperliquid：`POST https://api.hyperliquid.xyz/info`，元数据体 `{"type":"meta","dex":"xyz"}`；K线体 `{"type":"candleSnapshot","req":{"coin":"xyz:TSLA","interval":"5m","startTime":1791805800000,"endTime":1792405799999}}`；近期成交体 `{"type":"recentTrades","coin":"xyz:TSLA"}`。5000 根蜡烛保留量不代表存在同区间真实报价额与历史主动成交。
- BingX：[元数据](https://open-api.bingx.com/openApi/swap/v2/quote/contracts)、[首 1000 根（较早页）](https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=NCSKTSLA2USD-USDT&interval=5m&startTime=1791805800000&endTime=1792105799999&limit=1000)、[后 1000 根](https://open-api.bingx.com/openApi/swap/v3/quote/klines?symbol=NCSKTSLA2USD-USDT&interval=5m&startTime=1792105800000&endTime=1792405799999&limit=1000)、[近期成交](https://open-api.bingx.com/openApi/swap/v2/quote/trades?symbol=NCSKTSLA2USD-USDT&limit=1000)。官方 v3 文档的 public `contracts` 参数只有 symbol；`quote/trades` 参数为 symbol、limit（最大1000）、timestamp、recvWindow，timestamp 是请求时间，不是历史分页时间。此次不带 Origin 的 HTTP200 与生产 Origin 的 HTTP403 分开记录。
- Coinbase INTX：[元数据](https://api.international.coinbase.com/api/v1/instruments)、[合法 288 根区间对照](https://api.international.coinbase.com/api/v1/instruments/AAPL-PERP/candles?granularity=FIVE_MINUTE&start=2026-10-18T10:30:00Z&end=2026-10-19T10:30:00Z)、[官方 OpenAPI 原文](https://docs.cdp.coinbase.com/api-reference/international-exchange-api/rest-api/intx-spec.yaml)。`underlying_type=EQUITY` 与 `EQUITY_ETF/EQUITY_INDEX` 可区分类别，但 schema 没有美股上市地区字段；不把个人 fills 或 Coinbase 其它产品线的数据接来替代 INTX 全市场历史。
- Crypto.com：[元数据](https://api.crypto.com/exchange/v1/public/get-instruments)、[末 300 根](https://api.crypto.com/exchange/v1/public/get-candlestick?instrument_name=AAPLUSD-PERP&timeframe=5m&count=300&start_ts=1791805800000&end_ts=1792405799999)、[金额样本成交](https://api.crypto.com/exchange/v1/public/get-trades?instrument_name=AAPLUSD-PERP&count=1000&start_ts=1792405500000&end_ts=1792405799999)。K线向前翻页时下一页 end_ts=本页最早 t−1，直至覆盖目标起点；按 t 去重，得到 2000 根。不能把公开历史接口的存在、单根方向正确或数量对账相符，表述为缺少独立 Q 时仍已完成 2000 根报价对账。

浏览器实测使用隔离 Chromium，页面 Origin 为 `https://veil-of-ignorance.lovable.app`，公开 fetch 使用 `credentials:omit`，不借已登录账户权限；Hyperliquid、Crypto.com 的元数据与K线可读，Kraken、BingX、Coinbase INTX 的上述直连接口均报 `Failed to fetch`。由于五家已在身份或金额/历史门槛失败，本轮没有为它们扩大 `fish-market-proxy` 白名单；代理不能补足元数据或历史证据。已有代理的安全边界与现有交易所行为不变。
