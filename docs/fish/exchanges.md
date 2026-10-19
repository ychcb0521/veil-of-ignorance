# 「渔」交易所核实表

核实日期：2026-10-19。结论：保留币安，新增 **OKX、Bitget、Gate**；**Bybit、KuCoin 合约、MEXC 合约不接入**。未通过的交易所不显示可选入口。没有使用持仓比、涨跌方向、收盘价乘张数等替代主动买卖成交额。

## 四项准入核实

| 交易所 | 交易中的 USDT 本位永续 | 连续 2000 根已收盘 5m OHLC、USDT 成交额 Q | 同区间真实主动买卖额 B/S | 浏览器访问 | 结论 |
| --- | --- | --- | --- | --- | --- |
| Binance | `exchangeInfo`：PERPETUAL / USDT / TRADING | 原生 klines，1000 根 × 2；Q=`row[7]` | 原生 B=`row[10]`，S=Q−B，天然同口径 | 公开 REST 直连 | 保留 |
| OKX | `public/instruments?instType=SWAP`：settleCcy=USDT、ctType=linear、state=live；只取币本位面值可明确换算的 `*-USDT-SWAP` | `market/history-candles?bar=5m`，100 根反向翻页，仅 confirm=1，Q=`volCcyQuote` | **不用 Rubik 统计接口**；用 `market/history-trades` 的历史真实逐笔成交按 taker side 汇总；公开历史 3 个月 | 最新实测三个所用端点均允许生产域 Origin；优先直连，网络/CORS 失败时回退白名单 Supabase `fish-market-proxy` | 接入 |
| Bybit | `instruments-info` 可筛 linear / USDT / LinearPerpetual / Trading | `market/kline` 支持 5m，turnover 为 USDT | `recent-trade` 仅最近最多 1000 笔，无完整历史时间分页；`account-ratio` 是账户数比例。未找到覆盖 2000 根的公开真实 taker 金额来源 | 即使代理可读，也不能补足历史 B/S | **不接：第 3 项失败** |
| Bitget | `mix/market/contracts?productType=USDT-FUTURES`：quoteCoin=USDT、symbolType=perpetual、symbolStatus=normal | `history-candles`，200 根反向翻页，Q=`row[6]` | **不用 taker-buy-sell 近期统计**；`fills-history` 可查最近 90 天真实历史逐笔，start/end 单次跨度≤7天，1000 笔按 idLessThan 翻页。2000 根为 6 天 22 小时 40 分钟，符合跨度限制 | 实测 Access-Control-Allow-Origin=*，直连 | 接入 |
| Gate | `/futures/usdt/contracts`：direct、非 in_delisting、status=trading | `candlesticks`：5m、from/to，最多 2000；Q=`sum` | **不用 contract_stats 的张数近似金额**；`trades` 的 size 正数为主动买、负数为主动卖，真实价格逐笔换算；from/to + offset 翻页 | 实测 Access-Control-Allow-Origin=*，直连 | 接入 |
| KuCoin 合约 | `contracts/active` 可列 USDT 结算、线性永续 | `kline/query` 支持 5m，最多 500 根，turnover 为报价成交额 | 公开 `trade/history` 只有最近 100 笔，无同窗口历史分页；私有 fills 仅个人成交，不能代替全市场 | 跨域或代理均不能补足历史 B/S | **不接：第 3 项失败** |
| MEXC 合约 | `contract/detail` 可列 USDT 线性永续 | `contract/kline/{symbol}` 有 OHLC、vol 与 amount | 公开 deals 仅最近成交，无完整历史时间分页；私有 order_deals 是账户成交，不能代替全市场 | 跨域或代理均不能补足历史 B/S | **不接：第 3 项失败** |

## 金额、分页与完整性

- OKX：合约每张基础币量 `c = ctVal × ctMult`，只接受 ctValCcy 等于基础币的 USDT 线性合约。逐笔基础币量=`sz × c`，USDT 金额=`sz × c × px`，依 taker `side=buy/sell` 分别加到 B/S。K 线 Q 直接用 `volCcyQuote`，不以收盘价换算。K 线基础币量=`vol × c`。首次逐笔请求 type=2、after=窗口右边界，之后 type=1、after=本页最小 tradeId，直到越过窗口左边界；tradeId 去重。
- Bitget：逐笔 size 已经是基础币量，USDT 金额=`size × price`，按 side 汇总 B/S；不再乘合约面值。K 线基础币量=`row[5]`，Q=`row[6]`。逐笔按降序 tradeId / idLessThan 翻页；显式传 startTime、endTime，避免默认查询窗口变化。
- Gate：逐笔基础币量=`abs(size) × quanto_multiplier`，USDT 金额=`abs(size) × quanto_multiplier × price`；size>0 加到 B，size<0 加到 S。K 线基础币量=`v × quanto_multiplier`，Q=`sum`。to 传完整右边界秒数，再按毫秒筛选 `[start,end)`；不能传 end−1 秒，否则会漏掉最后一秒内的成交。保留 create_time 的小数秒。
- 所有适配器按 openTime 去重、排序，必须逐一等于 `[tCut−2000×5m,tCut)` 的 2000 个时间点。BTC 也做同样检查；BTC 只需收盘价，不必额外下载逐笔成交。
- 每一根都校验 B+S 与 Q，容差 `max(0.000001 USDT, |Q|×10⁻⁸)`；同时校验逐笔基础币量与 K 线基础币量，容差 `max(10⁻¹⁰, |volume|×10⁻⁸)`。缺一根、分页受限、无法对账则整币跳过并计入「读数不全」。仅 Q 和基础币量都为真实零成交时，允许 B=S=0；不对缺失记录补零。
- OKX/Bitget 历史逐笔保留期限制意味着很久以前的模拟捕捞可能无完整数据；不会拿近期成交代替。活跃合约的 2000 根可包含大量逐笔成交，第一次扫描可能明显慢于币安；流式按根累加，不把全量逐笔保留在内存中。重复扫描缓存已对账的 K 线，只补新增或缺少的区间。

## 实测证据与误差

统一 K 线核实截止 `tCut=1792375800000`（UTC+8 **2026-10-19 10:10:00**）；2000 根区间为 openTime `[1791775800000,1792375800000)`。BTC公开K线实测：OKX 20页、Bitget 10页、Gate 1次，各返回连续2000根，第一根1791775800000、最后一根1792375500000，均无缺口。逐笔抽样选较早的 `openTime=1791805500000`（UTC+8 **2026-10-12 19:45:00**），已经超出 OKX Rubik 的近期覆盖范围。

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

各交易所独立预算，跨交易所合计最多 3 个并行请求。429 计请求失败并按 Retry-After（至少 60 秒）暂停该家后续请求；418 中止该家。取消中断请求、分页、排队和限速等待。某家 BTC 缺根只中止该家。

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

`fish-market-proxy` 仅允许 www.okx.com 上 instruments / history-candles / history-trades 三个公开 GET 路径；参数白名单限定 SWAP、USDT 合约、5m、分页游标和最多 100 条。拒绝其它路径、外域、重复 / 未知参数、POST 等写请求；不转发调用者 Authorization、Cookie 或其它凭据。15 秒超时、4MB 响应上限、固定 CORS；无需交易 API Key。原行情盘面、时间机器和 Supabase 客户端配置不变。
