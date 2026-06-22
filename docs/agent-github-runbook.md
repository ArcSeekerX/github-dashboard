# Agent Runbook: 新建仓库 / Push / 提 PR

> 写给 AI Agent 直接执行的操作手册。所有命令均可复制粘贴运行。
> 每条命令都按「**前置信息 → 命令 → 期望输出 → 失败兜底**」的结构组织。

---

## 0. 前置信息收集

执行任何操作前，**必须先从下面的位置读到这些值**：

| 变量 | 来源（按优先级） | 必填 |
|---|---|---|
| `GH_TOKEN` | 1) 环境变量 `GITHUB_TOKEN` / `GH_TOKEN`<br>2) `d:/desktop/AIOS/github-dashboard/config.json` 中 `github.token`<br>3) 调用本地 `curl http://127.0.0.1:3000/api/token`（看板服务运行时）| ✅ |
| `GH_USER` | 1) `config.json` 中 `github.username`<br>2) `git config --global user.name`<br>3) `curl -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/user` 取 `login` | ✅ |
| `GH_EMAIL` | `git config --global user.email`（确认非空再 commit） | ✅ |
| `HTTPS_PROXY` | 若在公司内网：`http://your-proxy:port`；家用网络留空 | 视环境 |
| `REPO_NAME` | 用户指定，例如 `my-new-project` | ✅ |
| `REPO_VISIBILITY` | `private` 或 `public`，默认 `private` | ✅ |
| `REPO_DESC` | 用户指定或自动从 README 第一段提炼 | 可空 |

**Token 必需 scopes（缺一不可）**：
- `repo`（含 create repo + push + 读私有仓 + 创建 PR）
- 如果要操作 GitHub Pages / Actions / Packages，按需追加 `workflow` / `write:packages`

校验 token 是否有效：
```bash
curl -fsS -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/user | grep -E '"login"'
```
返回 `"login": "xxx"` 即有效；返回 401 / 403 则停止流程并提示用户重新生成 token。

---

## 1. 新建仓库（POST /user/repos）

### 1.1 调用 API

```bash
curl -fsS -X POST https://api.github.com/user/repos \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d "$(cat <<EOF
{
  "name": "$REPO_NAME",
  "description": "$REPO_DESC",
  "private": $( [ "$REPO_VISIBILITY" = "private" ] && echo true || echo false ),
  "has_issues": true,
  "has_wiki": false,
  "auto_init": false
}
EOF
)"
```

> `auto_init: false` **必须**，否则远端会先生成 README，导致本地首次 push 出现「non-fast-forward」冲突。

### 1.2 期望输出

HTTP 201 + JSON 含：
- `"full_name": "$GH_USER/$REPO_NAME"`
- `"private": true`
- `"clone_url": "https://github.com/$GH_USER/$REPO_NAME.git"`

### 1.3 失败兜底

| HTTP / 错误 | 含义 | 处理 |
|---|---|---|
| `422 name already exists` | 同名仓库已存在 | 询问用户是否换名 / 删除旧仓 / 直接 push 到现有仓 |
| `403 / 401` | token 无效或缺 `repo` scope | 停止，提示用户去 <https://github.com/settings/tokens> 重新生成并粘贴到看板 |
| `curl: schannel ...` (Windows) | curl 证书检查失败 | 换用 Node 替代：见下方「附录 A」 |
| 连接超时 | 公司代理未设置 | 加 `-x $HTTPS_PROXY` 重试 |

### 1.4 Windows / 公司网络的备选实现（Node 走 undici proxy）

```bash
HTTPS_PROXY=http://your-proxy:port node -e "
const { ProxyAgent, setGlobalDispatcher } = require('undici');
if (process.env.HTTPS_PROXY) setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
fetch('https://api.github.com/user/repos', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + process.env.GH_TOKEN,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'agent-runbook'
  },
  body: JSON.stringify({
    name: process.env.REPO_NAME,
    description: process.env.REPO_DESC || '',
    private: process.env.REPO_VISIBILITY !== 'public',
    auto_init: false
  })
}).then(r => r.json()).then(j => console.log(JSON.stringify(j, null, 2)));
"
```

需要 `cd` 到 `d:/desktop/AIOS/github-dashboard` 才能找到 `undici` 模块。

---

## 2. 推送代码

### 2.1 前置检查（避免泄密）

```bash
cd <project-dir>
# 必须存在 .gitignore 且至少包含：
cat .gitignore
# - config.json 或 .env 等含密文件
# - node_modules/ / dist/ / build/ / __pycache__/ 等大目录
```

若 `.gitignore` 缺失或不完整，**先补全再继续**。**绝不**用 `git add -A` 之前不检查 `git status`。

```bash
git init -b main
git add -A
git status --short | head -40         # 人工/Agent 核对：无 token、无大文件
```

发现可疑文件（`.env`, `*.pem`, `id_rsa`, `config.json`, `*.sqlite`, `*.zip` > 10MB）→ **停止**，加入 `.gitignore` 后 `git rm --cached <file>` 再继续。

### 2.2 提交

```bash
git commit -m "feat: initial commit

<2-4 行说明项目用途与关键能力>
"
```

### 2.3 设代理（若在公司内网）

```bash
git config http.proxy http://your-proxy:port
git config https.proxy http://your-proxy:port
```

### 2.4 Push（token-in-URL 模式，最简单）

```bash
git remote add origin "https://$GH_USER:$GH_TOKEN@github.com/$GH_USER/$REPO_NAME.git"
git push -u origin main
```

### 2.5 ⚠️ 立刻清掉 URL 里的 token

```bash
git remote set-url origin "https://github.com/$GH_USER/$REPO_NAME.git"
# 验证：
grep -i "ghp_\|github_pat_\|token" .git/config && echo "[FAIL] token 仍在 .git/config" || echo "[OK] cleaned"
```

> **更安全的替代**：让 Git Credential Manager (Windows 自带) 或 macOS Keychain 持有 token。第一次 push 时弹窗输入，之后透明使用，URL 永远干净。
> ```bash
> git config --global credential.helper manager   # Windows
> git config --global credential.helper osxkeychain   # macOS
> ```

---

## 3. 创建 PR

> 适用于：仓库已存在 → 切新分支 → push → 提 PR 合并回主分支。
> 仓库刚 init 还没有 base 分支可对比时，**不要**创建 PR。

### 3.1 切分支并推送

```bash
git checkout -b feature/<short-slug>
# ... 修改代码 ...
git add -A && git status --short
git commit -m "<类型>: <一句话动机>"
git push -u origin feature/<short-slug>
```

### 3.2 调 API 创建 PR

```bash
curl -fsS -X POST "https://api.github.com/repos/$GH_USER/$REPO_NAME/pulls" \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d "$(cat <<EOF
{
  "title": "<简短标题，<= 70 字符>",
  "head": "feature/<short-slug>",
  "base": "main",
  "body": "## Summary\n- <要点1>\n- <要点2>\n\n## Test plan\n- [ ] <验证项1>\n- [ ] <验证项2>",
  "draft": false,
  "maintainer_can_modify": true
}
EOF
)"
```

### 3.3 期望输出

HTTP 201 + JSON 含：
- `"html_url": "https://github.com/$GH_USER/$REPO_NAME/pull/<N>"`
- `"number": <N>`
- `"state": "open"`

**把 `html_url` 回报给用户**。

### 3.4 失败兜底

| 错误 | 处理 |
|---|---|
| `422 No commits between main and feature/xxx` | 分支未 push 或没有新提交 |
| `422 A pull request already exists` | 同 head→base 已有 PR；用 `GET /repos/.../pulls?head=$GH_USER:feature/xxx&state=open` 查到现有 PR 号，回传给用户 |
| `404` | 仓库名或分支名拼错 |

---

## 4. 后续常用操作速查

### 4.1 给 PR 加 reviewer
```bash
curl -X POST "https://api.github.com/repos/$GH_USER/$REPO_NAME/pulls/<N>/requested_reviewers" \
  -H "Authorization: Bearer $GH_TOKEN" \
  -d '{"reviewers": ["github-handle-1", "github-handle-2"]}'
```

### 4.2 合并 PR（squash）
```bash
curl -X PUT "https://api.github.com/repos/$GH_USER/$REPO_NAME/pulls/<N>/merge" \
  -H "Authorization: Bearer $GH_TOKEN" \
  -d '{"merge_method": "squash"}'
```

### 4.3 删除已合并的 feature 分支
```bash
curl -X DELETE "https://api.github.com/repos/$GH_USER/$REPO_NAME/git/refs/heads/feature/<short-slug>" \
  -H "Authorization: Bearer $GH_TOKEN"
```

### 4.4 用 `gh` CLI 一行做完（若已安装并登录）
```bash
gh repo create $GH_USER/$REPO_NAME --private --source=. --remote=origin --push
gh pr create --title "..." --body "..." --base main
gh pr merge --squash --delete-branch
```

---

## 附录 A：环境检测脚本（Agent 启动时先跑一次）

```bash
echo "[env]"
echo "  OS:       $(uname -s 2>/dev/null || echo Windows)"
echo "  Arch:     $(uname -m 2>/dev/null || echo unknown)"
echo "  Node:     $(node --version 2>/dev/null || echo MISSING)"
echo "  Git:      $(git --version 2>/dev/null || echo MISSING)"
echo "  gh CLI:   $(gh --version 2>/dev/null | head -1 || echo MISSING)"
echo "  Proxy:    ${HTTPS_PROXY:-<none>}"
echo "  git user: $(git config --global user.name) <$(git config --global user.email)>"
```

任一关键工具缺失（Node、Git）→ 停止，提示用户安装。

---

## 附录 B：禁忌清单（违反即停止）

1. ❌ 在 `commit` 前不看 `git status` 就 `git add -A`
2. ❌ 把 token 写进 `.git/config` 后不清理
3. ❌ 把 `config.json` / `.env` / `id_rsa` 提交
4. ❌ 强推 `main`/`master`（`--force`），除非用户明确说"force push"
5. ❌ 用 `--no-verify` 跳过 pre-commit hook
6. ❌ 把 token 打印到非临时日志或 stdout 共享给第三方
7. ❌ 监听 `0.0.0.0` 时不警告用户
8. ❌ 仓库刚创建就 PR（没有 base commit 可比）

---

## 附录 C：复制粘贴模板（最常见组合）

**A. 新建私有仓 + 首推**：
```bash
GH_TOKEN=<paste>; GH_USER=ArcSeekerX; REPO_NAME=<paste>; REPO_DESC="<paste>"
# 1. 建仓
curl -fsS -X POST https://api.github.com/user/repos \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d "{\"name\":\"$REPO_NAME\",\"description\":\"$REPO_DESC\",\"private\":true,\"auto_init\":false}"
# 2. 推
cd <project-dir>
git init -b main && git add -A && git commit -m "feat: initial commit"
git remote add origin "https://$GH_USER:$GH_TOKEN@github.com/$GH_USER/$REPO_NAME.git"
git push -u origin main
git remote set-url origin "https://github.com/$GH_USER/$REPO_NAME.git"
```

**B. 已存在仓 + 新分支 + PR**：
```bash
git checkout -b feature/$SLUG
# ... edits ...
git add -A && git commit -m "<msg>"
git push -u origin feature/$SLUG
curl -fsS -X POST "https://api.github.com/repos/$GH_USER/$REPO_NAME/pulls" \
  -H "Authorization: Bearer $GH_TOKEN" \
  -d "{\"title\":\"<title>\",\"head\":\"feature/$SLUG\",\"base\":\"main\",\"body\":\"<body>\"}"
```
