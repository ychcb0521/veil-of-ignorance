无知之幕 · Mac 独立即时交易执行器 v1（2026-11-18）

本包不含 API 密钥、配对码、交易账本或个人账号资料。
Mac 原生钥匙串与实盘账户的最终验收需要在你的 Mac 上进行；当前已经完成代码检查、凭证处理测试和打包。

1. 在 Mac 从 https://nodejs.org 安装 Node.js 24.22.2（或更新的 Node 24）。
2. 解压本文件夹。双击“启动Mac执行器.command”。
   若未按脚本打开，可打开终端，输入 bash 和一个空格，将该文件拖入终端，然后回车。
3. 选 1 首次配置。打开正式站 https://veil-of-ignorance-ten.vercel.app/ 并登录。
   在“即时交易 → 条件设置 → 币安实盘”复制账号 ID，按本机提示输入。
4. 输入 Mac 代理软件的 HTTP 代理地址；使用直连时留空。
   币安白名单须匹配执行器经该代理访问币安的实际公网出口 IP。
5. 在 Mac 本机输入 API Key 和对应的 Secret。输入不会显示；凭证存入 Mac 钥匙串。
   必须是具备读取、合约权限及受信任 IP 限制的 API。
   首次配置仅做只读验证，不下单。系统若要求钥匙串访问，请由你核对并处理。
6. 复制终端显示的本机配对码，仅粘贴到 Mac 上正式站的“本机配对码”框。
7. 在启用实盘前，先停止 Windows 执行器或关闭 Windows。
   有未平仓战役时，需先交接原执行账本；全新的 Mac 若发现现有持仓会拒绝直接启动。
   请保留 Windows 上的原账本与订单记录，联系当前任务完成交接。
8. 再次打开启动脚本，选 2 启动，确认只有 Mac 负责执行。
   在 Mac 网站中点击“连接”。网页和执行器窗口都应保持打开。

停止：执行器窗口按 Control+C。Mac 运行期间使用 caffeinate 防止空闲休眠；合盖、关机或断网仍会中断。
配置和账本目录：~/Library/Application Support/VeilUSDTExecutor/
选 3 可只读检查账户。重复配置不会覆盖已有配对、钥匙串或账本。
Windows 的 account.dpapi 受 Windows 用户保护，不能直接作为 Mac 凭证使用。

凭证处理实现参考 Apple security 工具：
https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/security.1
代理实现参考 Node.js：
https://nodejs.org/download/release/v24.22.1/docs/api/http.html#httpsetglobalproxyfromenvproxyenv
