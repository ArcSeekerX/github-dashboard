# GitHub 个人账户看板

一个本地化的 GitHub 信息看板，集中展示并一键复制 Access Token、用户信息、仓库列表、GHCR 容器镜像等关键信息，方便在与 Agent 协作时快速粘贴使用，无需每次重新生成或手动查找。

## 功能

- **用户信息卡**：头像、username、name、email、profile 链接，每项一键复制
- **Access Token 卡**：默认掩码显示，可临时显示/隐藏；显示过期时间（剩 <30 天橙色 / <7 天红色）与 scopes；支持「在 GitHub 生成新 Token ↗」一键跳转 + 「粘贴新 Token」直接写回 `config.json`
- **仓库列表卡**：搜索过滤；每个仓库提供 HTTPS / SSH / `git clone` 命令 / 网址 / 全名 5 个复制按钮，标题可点击跳转
- **GHCR 容器镜像卡**：自动拉取 GitHub Container Registry 中的所有镜像，显示完整 `ghcr.io/owner/name:tag`，支持复制镜像名 / `docker pull` 命令
- **自动刷新**：切回浏览器标签页时若距上次加载超过 30 秒会自动重新拉取；点击右上角「刷新」可强制刷新
- **跨平台**：macOS / Linux (x86_64 & ARM aarch64) / Windows 均可运行；启动时自动打开默认浏览器（headless 服务器自动跳过）

## 快速开始

### macOS / Linux

```bash
cd github-dashboard
cp config.example.json config.json
# 编辑 config.json，填入 GitHub PAT、username
chmod +x start.sh
./start.sh
```

或手动：
```bash
npm install
npm start            # 自动打开 http://127.0.0.1:3000
```

如果在公司网络环境，需要走代理：
```bash
export HTTPS_PROXY=http://your-proxy:port
./start.sh
```

### Windows

双击 `start.cmd`，或在 PowerShell / cmd 中：
```cmd
cd github-dashboard
copy config.example.json config.json
REM 编辑 config.json
start.cmd
```

如果在公司网络环境需要走代理：`set HTTPS_PROXY=http://your-proxy:port`。

### Linux ARM (树莓派 / Jetson / DGX Spark / AWS Graviton 等)

完全兼容，Node.js 官方提供 aarch64 二进制。安装 Node：

```bash
# 推荐：用 nvm（适用所有 ARM Linux 发行版）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22

# 或 Debian/Ubuntu 系：
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

然后：
```bash
cd github-dashboard
cp config.example.json config.json   # 编辑填入 token
./start.sh
```

**Headless 服务器（无 DE/无显示器）**：脚本会自动检测 `$DISPLAY` 缺失并跳过开浏览器。在本机笔记本上做 SSH 端口转发后访问：

```bash
# 在本机笔记本执行
ssh -L 3000:127.0.0.1:3000 user@<arm-host>
# 然后浏览器访问 http://127.0.0.1:3000
```

> 不建议把服务直接监听 `0.0.0.0` — 任何能访问该机器的人都能读取你的 token。SSH 隧道更安全。
> 确需监听其他地址（例如内网信任环境）：`HOST=0.0.0.0 PORT=3000 ./start.sh`，server 启动时会有警告。

### 不希望自动打开浏览器

```bash
NO_OPEN=1 npm start
```

## 配置文件 (`config.json`)

```json
{
  "github": {
    "token": "ghp_xxxxxxxxxxxxxxxxxxxx",
    "username": "your-name",
    "emailOverride": "you@example.com"
  },
  "containerImages": [
    {
      "name": "registry.example.com/team/app:v1.0",
      "description": "外部 registry 的镜像（GHCR 之外）",
      "tags": ["prod"]
    }
  ]
}
```

- `emailOverride`：当 GitHub API 拿不到 email（token 缺 `user:email` 权限）时用此覆盖
- `containerImages`：手动维护的额外镜像列表，会显示在 GHCR 自动拉取列表之下（GHCR 已覆盖大多数场景，此字段可留空 `[]`）

## 创建 GitHub Personal Access Token

1. 访问 <https://github.com/settings/tokens?type=beta>（fine-grained，推荐）或 <https://github.com/settings/tokens>（classic）
2. 创建 token，建议最小权限：
   - **classic**：`repo`、`read:user`、`user:email`、`read:packages`
   - **fine-grained**：`Repository: Contents (Read)` + `Metadata (Read)` + `Account: Email addresses (Read)` + `Packages (Read)`
3. 复制 token 填入 `config.json` 的 `github.token`，或直接在看板的「粘贴新 Token」框里粘贴保存

## 关于「上传新仓库/镜像后是否自动同步」

**是的**：服务端不缓存任何 GitHub 数据，每次请求都直连 GitHub API。
- 主动刷新：点右上角「刷新」或按 `F5` / `Cmd+R`
- 自动刷新：切回浏览器标签时若距上次加载超过 30 秒会自动重新拉取
- 新建仓库 / `docker push ghcr.io/...` 完成后，刷新页面即可看到新条目

## 安全说明

> 此工具仅供**本地单机**使用。

- `config.json` 已写入 `.gitignore`，**禁止提交**到任何代码仓库
- 服务绑定 `127.0.0.1:3000`，不对局域网开放
- Token 通过本地后端代理转发至 GitHub API，不会写入浏览器历史
- 建议 PAT 设置过期时间，并使用最小必要权限

## 项目结构

```
github-dashboard/
├── package.json
├── config.example.json
├── config.json            # 你的本地配置 (gitignored)
├── server.js              # Express 后端 + GitHub API 代理
├── start.sh               # macOS / Linux 启动脚本
├── start.cmd              # Windows 启动脚本
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── docs/                  # 项目文档
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 返回脱敏后的 token、镜像、备注 |
| GET | `/api/token` | 返回完整 token（供前端复制按钮使用） |
| POST | `/api/token` | 写入新 token 到 `config.json` |
| GET | `/api/token-info` | 探测 token 过期时间与 scopes |
| GET | `/api/user` | 代理 `GET /user` + `GET /user/emails` |
| GET | `/api/repos` | 代理 `GET /user/repos`（owner + collaborator） |
| GET | `/api/packages` | 代理 `GET /user/packages?package_type=container` |

## 环境要求

- Node.js ≥ 18（内置 `fetch`；推荐 v20 或 v22）
- 支持的架构：x86_64、arm64 / aarch64（Apple Silicon、树莓派 4/5、NVIDIA Jetson、DGX Spark/GB10、AWS Graviton）
- 操作系统：macOS / Linux / Windows

## 故障排查

- **`config.json not found`**：从 `config.example.json` 拷贝并填写
- **GitHub API 401**：token 失效或权限不足，重新生成
- **GHCR 列表 403**：token 缺 `read:packages` 权限
- **Email 为空**：检查 token 是否包含 `user:email` 权限，或填 `emailOverride`
- **公司网络访问失败**：导出 `HTTPS_PROXY=http://your-proxy:port` 后重启
- **浏览器没有自动打开**：手动访问 <http://127.0.0.1:3000>，或检查是否设置了 `NO_OPEN=1`
- **headless Linux 启动后浏览器没开**：这是预期行为（自动检测无 DISPLAY 时跳过），用 SSH 端口转发访问
- **ARM Linux 安装 Node 报 GLIBC 太旧**：用 nvm 安装预编译版本，而不是 apt（apt 在老旧 Debian 上可能装到 Node 12）
