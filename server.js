const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
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

function tokenType(token) {
  if (!token) return 'unknown';
  if (token.startsWith('github_pat_')) return 'fine-grained';
  if (token.startsWith('ghp_')) return 'classic';
  if (token.startsWith('gho_')) return 'oauth';
  if (token.startsWith('ghs_')) return 'server';
  return 'token';
}

async function probeToken(token) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'github-dashboard-local'
      }
    });
    const scopes = res.headers.get('x-oauth-scopes');
    const expiresAt = res.headers.get('github-authentication-token-expiration');
    const rlLimit = res.headers.get('x-ratelimit-limit');
    const rlRemaining = res.headers.get('x-ratelimit-remaining');
    const rlReset = res.headers.get('x-ratelimit-reset');
    const rateLimit = rlLimit
      ? {
          limit: Number(rlLimit),
          remaining: Number(rlRemaining),
          resetAt: rlReset ? new Date(Number(rlReset) * 1000).toISOString() : null
        }
      : null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = `GitHub API ${res.status}`;
      try { message = JSON.parse(text).message || message; } catch (_) { /* keep default */ }
      return { valid: false, status: res.status, error: message, scopes, expiresAt, rateLimit };
    }
    const user = await res.json();
    return { valid: true, login: user.login, name: user.name, scopes, expiresAt, rateLimit };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

function listTokens(cfg) {
  const activeToken = cfg.github?.token || '';
  const entries = (cfg.tokens || []).map((t) => ({
    id: t.id,
    label: t.label || '(未命名)',
    note: t.note || '',
    createdAt: t.createdAt || null,
    type: tokenType(t.token),
    masked: maskToken(t.token),
    active: !!activeToken && t.token === activeToken
  }));
  if (activeToken && !entries.some((t) => t.active)) {
    entries.unshift({
      id: 'active',
      label: '当前活跃 Token (config.json)',
      note: '来自 config.json 的 github.token，看板与 agent 正在使用',
      createdAt: null,
      type: tokenType(activeToken),
      masked: maskToken(activeToken),
      active: true
    });
  }
  return entries;
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

app.get('/api/tokens', (req, res) => {
  const cfg = loadConfig();
  res.json({ tokens: listTokens(cfg) });
});

app.get('/api/tokens/status', async (req, res) => {
  const cfg = loadConfig();
  const stored = cfg.tokens || [];
  const statuses = await Promise.all(
    listTokens(cfg).map(async (entry) => {
      let raw = null;
      if (entry.id === 'active') raw = cfg.github?.token || '';
      else raw = stored.find((t) => t.id === entry.id)?.token || '';
      if (!raw) return { id: entry.id, valid: false, error: 'token 缺失' };
      const probe = await probeToken(raw);
      return { id: entry.id, ...probe };
    })
  );
  res.json({ statuses });
});

app.get('/api/tokens/:id/reveal', (req, res) => {
  const cfg = loadConfig();
  if (req.params.id === 'active') {
    return res.json({ token: cfg.github?.token || '' });
  }
  const entry = (cfg.tokens || []).find((t) => t.id === req.params.id);
  if (!entry) return res.status(404).json({ error: '未找到该 PAT' });
  res.json({ token: entry.token });
});

app.post('/api/tokens', async (req, res) => {
  try {
    const label = (req.body?.label || '').trim();
    const token = (req.body?.token || '').trim();
    const note = (req.body?.note || '').trim();
    if (!token || token.length < 20) {
      return res.status(400).json({ error: 'token 看起来无效（长度不足）' });
    }
    const cfg = loadConfig();
    cfg.tokens = cfg.tokens || [];
    if (cfg.github?.token === token || cfg.tokens.some((t) => t.token === token)) {
      return res.status(409).json({ error: '该 token 已存在，无需重复添加' });
    }
    const probe = await probeToken(token);
    if (!probe.valid) {
      return res.status(400).json({ error: `Token 校验失败: ${probe.error}` });
    }
    const entry = {
      id: crypto.randomUUID(),
      label: label || probe.login || 'PAT',
      token,
      note,
      createdAt: new Date().toISOString()
    };
    cfg.tokens.push(entry);
    saveConfig(cfg);
    res.status(201).json({
      ok: true,
      token: { id: entry.id, label: entry.label, note, type: tokenType(token), masked: maskToken(token), createdAt: entry.createdAt, active: false },
      probe
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/tokens/:id', async (req, res) => {
  try {
    const cfg = loadConfig();
    const entry = (cfg.tokens || []).find((t) => t.id === req.params.id);
    if (!entry) return res.status(404).json({ error: '未找到该 PAT' });
    const { label, note } = req.body || {};
    const token = (req.body?.token || '').trim();
    if (typeof label === 'string') entry.label = label.trim();
    if (typeof note === 'string') entry.note = note.trim();
    if (token) {
      if (token.length < 20) return res.status(400).json({ error: 'token 看起来无效（长度不足）' });
      if (token !== entry.token && (cfg.github?.token === token || cfg.tokens.some((t) => t.token === token))) {
        return res.status(409).json({ error: '该 token 已存在，无需重复添加' });
      }
      const probe = await probeToken(token);
      if (!probe.valid) return res.status(400).json({ error: `Token 校验失败: ${probe.error}` });
      entry.token = token;
    }
    saveConfig(cfg);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tokens/:id', (req, res) => {
  const cfg = loadConfig();
  const before = (cfg.tokens || []).length;
  cfg.tokens = (cfg.tokens || []).filter((t) => t.id !== req.params.id);
  if (cfg.tokens.length === before) return res.status(404).json({ error: '未找到该 PAT' });
  saveConfig(cfg);
  res.json({ ok: true });
});

app.post('/api/tokens/:id/activate', (req, res) => {
  const cfg = loadConfig();
  if (req.params.id === 'active') return res.json({ ok: true });
  const entry = (cfg.tokens || []).find((t) => t.id === req.params.id);
  if (!entry) return res.status(404).json({ error: '未找到该 PAT' });
  cfg.github = cfg.github || {};
  cfg.github.token = entry.token;
  saveConfig(cfg);
  lastTokenExpiration = null;
  lastTokenScopes = null;
  res.json({ ok: true });
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
      const ref = `ghcr.io/${String(owner).toLowerCase()}/${p.name}${latestTag ? ':' + latestTag : ''}`;
      return {
        name: p.name,
        owner,
        visibility: p.visibility,
        html_url: p.html_url,
        updated_at: p.updated_at,
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
