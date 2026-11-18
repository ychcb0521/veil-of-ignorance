#!/bin/bash
set -eu
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo '请先从 https://nodejs.org 安装 Node.js 24.22.2 或更新的 Node 24，然后重新打开。'
  read -r -p '回车退出 ' unused
  exit 1
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<24||(a===24&&b<14)){console.error("需要 Node.js 24.14 或更新版本，推荐 24.22.2。");process.exit(1)}'
directory="$HOME/Library/Application Support/VeilUSDTExecutor"
echo '无知之幕 · Mac U 本位执行器'
echo '1 首次配置（仅验证账户、保存本机凭证）'
echo '2 启动实盘（保持本窗口与本机网页打开）'
echo '3 只读检查账户连接'
echo '0 退出'
read -r -p '请选择并回车：' choice
case "$choice" in
  1) node ./macos-setup.mjs ;;
  2)
    read -r -p '确认 Windows 执行器已停止或关机？输入 YES：' confirm
    if [ "$confirm" != 'YES' ]; then exit 0; fi
    echo '关闭执行器请在此窗口按 Control+C。'
    /usr/bin/caffeinate -i node --import ./macos-preload.mjs ./usdt-follow-server.mjs "$directory" --live
    ;;
  3) node --import ./macos-preload.mjs ./usdt-follow-server.mjs "$directory" ;;
  0) exit 0 ;;
  *) echo '未选择有效操作。' ;;
esac
read -r -p '回车退出 ' unused
