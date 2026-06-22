#!/usr/bin/env bash
# 跨平台启动脚本 (macOS / Linux x86_64+ARM / Git Bash on Windows)
set -e
cd "$(dirname "$0")"

# 检查 Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[start] 未检测到 node，请先安装 Node.js ≥ 18"
  case "$(uname -s)" in
    Darwin) echo "[start]   brew install node" ;;
    Linux)
      case "$(uname -m)" in
        aarch64|arm64) echo "[start]   ARM Linux 推荐用 nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 22" ;;
        *)             echo "[start]   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs" ;;
      esac
      ;;
  esac
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[start] Node $NODE_MAJOR 太旧，需要 ≥ 18 (推荐 22)"
  exit 1
fi

if [ ! -f config.json ]; then
  echo "[start] config.json 不存在，从 config.example.json 拷贝"
  cp config.example.json config.json
  echo "[start] 请先编辑 config.json 填入 GitHub token 与 username，然后重新执行 ./start.sh"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "[start] 首次运行，正在安装依赖…"
  npm install --no-audit --no-fund
fi

# 公司网络代理（按需）
if [ -z "$HTTPS_PROXY" ] && [ -n "$DASHBOARD_PROXY" ]; then
  export HTTPS_PROXY="$DASHBOARD_PROXY"
fi

echo "[start] platform=$(uname -s) arch=$(uname -m) node=$(node --version)"
exec node server.js
