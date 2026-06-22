const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ProxyAgent, setGlobalDispatcher } = require('undici');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (PROXY) {
  setGlobalDispatcher(new ProxyAgent(PROXY));
  console.log(`[github-dashboard] using proxy: ${PROXY}`);
}

let lastTokenExpiration = null;
let lastTokenScopes = null;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('[fatal] config.json not found. Copy config.example.json to config.json and fill in your data.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

function maskToken(token) {
  if (!token || token.length < 12) return '****';
  return `${token.slice(0, 7)}••••••••${token.slice(-4)}`;
}

async function gh(pathname, token) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-dashboard-local'
    }
  });
  const exp = res.headers.get('github-authentication-token-expiration');
  if (exp) lastTokenExpiration = exp;
  const scopes = res.headers.get('x-oauth-scopes');
  if (scopes != null) lastTokenScopes = scopes;
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`GitHub API ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
  }
}));

app.get('/api/config', (req, res) => {
  const cfg = loadConfig();
  res.json({
    username: cfg.github?.username || null,
    tokenMasked: maskToken(cfg.github?.token || ''),
    emailOverride: cfg.github?.emailOverride || null,
    containerImages: cfg.containerImages || [],
    extraNotes: cfg.extraNotes || []
  });
});

app.get('/api/token', (req, res) => {
  const cfg = loadConfig();
  res.json({ token: cfg.github?.token || '' });
});

app.post('/api/token', (req, res) => {
  const newToken = (req.body && req.body.token || '').trim();
  if (!newToken || newToken.length < 20) {
    return res.status(400).json({ error: 'token 看起来无效（长度不足）' });
  }
  const cfg = loadConfig();
  cfg.github = cfg.github || {};
  cfg.github.token = newToken;
  saveConfig(cfg);
  lastTokenExpiration = null;
  lastTokenScopes = null;
  res.json({ ok: true, tokenMasked: maskToken(newToken) });
});

app.get('/api/token-info', async (req, res) => {
  try {
    const cfg = loadConfig();
    await gh('/user', cfg.github.token);
    res.json({
      masked: maskToken(cfg.github.token),
      expiresAt: lastTokenExpiration,
      scopes: lastTokenScopes,
      manageUrl: 'https://github.com/settings/tokens'
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/user', async (req, res) => {
  try {
    const cfg = loadConfig();
    const user = await gh('/user', cfg.github.token);
    let email = user.email;
    if (!email) {
      try {
        const emails = await gh('/user/emails', cfg.github.token);
        const primary = emails.find(e => e.primary) || emails[0];
        email = primary?.email || null;
      } catch (_) { /* requires user:email scope */ }
    }
    if (!email && cfg.github?.emailOverride) email = cfg.github.emailOverride;
    res.json({
      login: user.login,
      name: user.name,
      email,
      emailOverridden: !user.email && !!cfg.github?.emailOverride,
      avatar_url: user.avatar_url,
      html_url: user.html_url,
      public_repos: user.public_repos,
      followers: user.followers,
      following: user.following,
      created_at: user.created_at
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/repos', async (req, res) => {
  try {
    const cfg = loadConfig();
    const repos = await gh('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator', cfg.github.token);
    res.json(repos.map(r => ({
      name: r.name,
      full_name: r.full_name,
      private: r.private,
      description: r.description,
      html_url: r.html_url,
      clone_url: r.clone_url,
      ssh_url: r.ssh_url,
      default_branch: r.default_branch,
      updated_at: r.updated_at,
      language: r.language,
      stargazers_count: r.stargazers_count
    })));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/packages', async (req, res) => {
  try {
    const cfg = loadConfig();
    const username = cfg.github?.username;
    const packages = await gh('/user/packages?package_type=container&per_page=100', cfg.github.token);
    const enriched = await Promise.all(packages.map(async (p) => {
      let latestTag = null;
      try {
        const versions = await gh(`/user/packages/container/${encodeURIComponent(p.name)}/versions?per_page=1`, cfg.github.token);
        latestTag = versions[0]?.metadata?.container?.tags?.[0] || versions[0]?.name || null;
      } catch (_) { /* ignore */ }
      const owner = p.owner?.login || username;
      const ref = `ghcr.io/${owner}/${p.name}${latestTag ? ':' + latestTag : ''}`;
      return {
        name: p.name,
        owner,
        visibility: p.visibility,
        html_url: p.html_url,
        updated_at: p.updated_at,
        version_count: p.version_count,
        latest_tag: latestTag,
        full_ref: ref
      };
    }));
    res.json(enriched);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, hint: 'GHCR 包列表需要 token 拥有 read:packages 权限' });
  }
});

function openBrowser(url) {
  if (process.env.NO_OPEN === '1') return;
  const platform = process.platform;
  // 无图形界面的 Linux 服务器（树莓派/Jetson/DGX Spark/Graviton 等无 DE 部署）
  if (platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    console.log('[github-dashboard] headless Linux 检测到 (无 DISPLAY)，跳过自动打开浏览器');
    console.log(`[github-dashboard] 可在另一台机器执行: ssh -L ${PORT}:${HOST}:${PORT} <user>@<this-host>，然后访问 ${url}`);
    return;
  }
  try {
    let child;
    if (platform === 'darwin') child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    else if (platform === 'win32') child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', shell: false });
    else child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* 缺少 open/xdg-open 时静默 */ });
    child.unref();
  } catch (_) { /* silent */ }
}

app.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`[github-dashboard] running at ${url}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    console.warn(`[github-dashboard] ⚠ 监听非 loopback 地址 (${HOST})，任何能访问此机器的客户端都能读取你的 token，请确认网络隔离`);
  }
  openBrowser(url);
});
