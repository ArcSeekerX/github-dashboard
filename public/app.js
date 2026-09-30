const $ = (sel) => document.querySelector(sel);

const state = {
  tokenRevealed: false,
  tokenMasked: '',
  tokenFull: null,
  username: '',
  repos: [],
  packages: [],
  manualImages: []
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.remove('show'), 1500);
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function copiedFeedback(btn) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.classList.add('copied');
  btn.textContent = '已复制';
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.textContent = orig;
  }, 1200);
}

async function copy(text, btn) {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      copiedFeedback(btn);
      toast('已复制到剪贴板');
      return;
    } catch (e) { /* fall through to legacy path */ }
  }
  if (legacyCopy(text)) {
    copiedFeedback(btn);
    toast('已复制到剪贴板');
    return;
  }
  if (window.showCopyFallback) {
    window.showCopyFallback(text);
  } else {
    toast('复制失败，请手动选择复制');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(String(s)); }

function isUrl(s) { return typeof s === 'string' && /^https?:\/\//.test(s); }
function isEmail(s) { return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

function valueHtml(value) {
  if (value == null || value === '') return '<span class="value">—</span>';
  if (isUrl(value)) return `<a class="value link" href="${escapeAttr(value)}" target="_blank" rel="noopener">${escapeHtml(value)} ↗</a>`;
  if (isEmail(value)) return `<a class="value link" href="mailto:${escapeAttr(value)}">${escapeHtml(value)}</a>`;
  return `<span class="value">${escapeHtml(value)}</span>`;
}

function rowHTML(label, value, copyValue, badge) {
  const copyTarget = copyValue != null ? copyValue : (value != null ? String(value) : '');
  const btn = copyTarget ? `<button class="btn" data-copy="${escapeAttr(copyTarget)}">复制</button>` : '';
  return `
    <div class="row">
      <span class="label">${escapeHtml(label)}</span>
      ${valueHtml(value)}
      ${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ''}
      ${btn}
    </div>`;
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function loadConfig() {
  const cfg = await fetchJSON('/api/config');
  state.tokenMasked = cfg.tokenMasked;
  state.username = cfg.username || '';
  state.manualImages = cfg.containerImages || [];
  $('#tokenView').textContent = cfg.tokenMasked;
  renderManualImages();
}

async function loadTokenInfo() {
  try {
    const info = await fetchJSON('/api/token-info');
    state.tokenMasked = info.masked;
    if (!state.tokenRevealed) $('#tokenView').textContent = info.masked;
    const exp = info.expiresAt;
    if (exp) {
      const d = new Date(exp);
      const days = Math.round((d - Date.now()) / 86400000);
      const tone = days < 7 ? 'expire-warn' : days < 30 ? 'expire-soon' : 'expire-ok';
      $('#tokenExpire').innerHTML = `<span class="${tone}">${d.toLocaleString()} (剩 ${days} 天)</span>`;
    } else {
      $('#tokenExpire').textContent = '无过期时间 (经典 PAT 未设置 / fine-grained 永不到期)';
    }
    $('#tokenScopes').textContent = info.scopes || '(fine-grained 或未返回)';
  } catch (e) {
    $('#tokenExpire').textContent = '加载失败: ' + e.message;
  }
}

async function loadUser() {
  try {
    const u = await fetchJSON('/api/user');
    $('#avatar').src = u.avatar_url || '';
    $('#userFields').innerHTML =
      rowHTML('Username', u.login, u.login) +
      rowHTML('Name', u.name, u.name) +
      rowHTML('Email', u.email, u.email) +
      rowHTML('Profile', u.html_url, u.html_url) +
      rowHTML('Repos', `${u.public_repos} public · ${u.followers} followers · ${u.following} following`, null);
  } catch (e) {
    $('#userFields').innerHTML = `<div class="placeholder">加载失败: ${escapeHtml(e.message)}</div>`;
  }
}

async function loadRepos() {
  try {
    const repos = await fetchJSON('/api/repos');
    state.repos = repos;
    renderRepos();
  } catch (e) {
    $('#reposList').innerHTML = `<div class="placeholder">加载失败: ${escapeHtml(e.message)}</div>`;
  }
}

function renderRepos() {
  const q = ($('#repoSearch').value || '').toLowerCase().trim();
  const filtered = state.repos.filter(r =>
    !q || r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q) || (r.language || '').toLowerCase().includes(q)
  );
  $('#repoCount').textContent = `${filtered.length} / ${state.repos.length}`;
  if (!filtered.length) {
    $('#reposList').innerHTML = '<div class="placeholder">无匹配仓库</div>';
    return;
  }
  $('#reposList').innerHTML = filtered.map(r => `
    <div class="repo-item">
      <div class="title">
        <a class="name link" href="${escapeAttr(r.html_url)}" target="_blank" rel="noopener">
          ${escapeHtml(r.full_name)} ↗
        </a>
        <span>
          ${r.private ? '<span class="badge private">private</span>' : ''}
          ${r.language ? `<span class="badge">${escapeHtml(r.language)}</span>` : ''}
        </span>
        <span class="meta">★ ${r.stargazers_count} · ${new Date(r.updated_at).toLocaleDateString()}</span>
      </div>
      <div class="desc">${escapeHtml(r.description || '')}</div>
      <div class="btns">
        <button class="btn" data-copy="${escapeAttr(r.clone_url)}">HTTPS</button>
        <button class="btn" data-copy="${escapeAttr(r.ssh_url)}">SSH</button>
        <button class="btn" data-copy="${escapeAttr('git clone ' + r.clone_url)}">git clone</button>
        <button class="btn" data-copy="${escapeAttr(r.html_url)}">网址</button>
        <button class="btn" data-copy="${escapeAttr(r.full_name)}">全名</button>
      </div>
    </div>
  `).join('');
}

async function loadPackages() {
  $('#imagesList').innerHTML = '<div class="placeholder">加载 GHCR 包列表…</div>';
  try {
    const pkgs = await fetchJSON('/api/packages');
    state.packages = pkgs;
    renderPackages();
  } catch (e) {
    state.packages = [];
    $('#imageCount').textContent = '';
    $('#imagesList').innerHTML = `<div class="placeholder">
      加载失败: ${escapeHtml(e.message)}<br>
      <small>需要 PAT 拥有 <code>read:packages</code> 权限。请在 <a href="https://github.com/settings/tokens" target="_blank" rel="noopener">GitHub Token 设置</a> 中勾选后保存。</small>
    </div>`;
  }
}

function renderPackages() {
  const q = ($('#imageSearch')?.value || '').toLowerCase().trim();
  const filtered = state.packages.filter(p =>
    !q || p.name.toLowerCase().includes(q) || (p.latest_tag || '').toLowerCase().includes(q)
  );
  $('#imageCount').textContent = `${filtered.length} / ${state.packages.length}`;
  if (!state.packages.length) {
    $('#imagesList').innerHTML = '<div class="placeholder">GHCR 上未发布任何容器镜像</div>';
    return;
  }
  if (!filtered.length) {
    $('#imagesList').innerHTML = '<div class="placeholder">无匹配镜像</div>';
    return;
  }
  $('#imagesList').innerHTML = filtered.map(p => `
    <div class="image-item">
      <div class="image-info">
        <div class="head">
          <a class="name link" href="${escapeAttr(p.html_url)}" target="_blank" rel="noopener">${escapeHtml(p.full_ref)} ↗</a>
          <span class="badge">${escapeHtml(p.visibility)}</span>
        </div>
        <div class="desc">
          <span>更新于 ${new Date(p.updated_at).toLocaleDateString()}</span>
        </div>
      </div>
      <div class="image-actions">
        <button class="btn primary" data-copy="${escapeAttr('docker pull ' + p.full_ref)}">docker pull</button>
        <button class="btn primary" data-action="copy-pull" data-image="${escapeAttr(p.full_ref)}">pull (带 PAT)</button>
        <button class="btn primary" data-copy="${escapeAttr(p.name)}">仅 name</button>
      </div>
    </div>
  `).join('');
}

function renderManualImages() {
  const list = state.manualImages;
  if (!list.length) {
    $('#imagesManual').innerHTML = '';
    return;
  }
  $('#imagesManual').innerHTML = `<div class="section-label">手动配置 (config.json)</div>` + list.map(img => `
    <div class="image-item">
      <div class="image-info">
        <div class="head">
          <span class="name mono">${escapeHtml(img.name)}</span>
        </div>
        ${img.description ? `<div class="desc">${escapeHtml(img.description)}</div>` : ''}
        ${img.tags?.length ? `<div class="tags">${img.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="image-actions">
        <button class="btn primary" data-copy="${escapeAttr(img.name)}">复制</button>
      </div>
    </div>
  `).join('');
}

async function handleTokenAction(action, btn) {
  if (action === 'toggle-token') {
    if (state.tokenRevealed) {
      $('#tokenView').textContent = state.tokenMasked;
      btn.textContent = '显示';
      state.tokenRevealed = false;
      state.tokenFull = null;
    } else {
      const { token } = await fetchJSON('/api/token');
      state.tokenFull = token;
      $('#tokenView').textContent = token;
      btn.textContent = '隐藏';
      state.tokenRevealed = true;
    }
  } else if (action === 'copy-token') {
    const { token } = await fetchJSON('/api/token');
    await copy(token, btn);
  } else if (action === 'show-paste') {
    openSheet('#pasteModal');
  } else if (action === 'copy-pull') {
    const ref = btn.dataset.image || '';
    const { token } = await fetchJSON('/api/token');
    const user = state.username || 'USERNAME';
    const cmd = `echo '${token}' | docker login ghcr.io -u ${user} --password-stdin && docker pull ${ref}`;
    await copy(cmd, btn);
  } else if (action === 'cancel-paste') {
    closeSheet('#pasteModal');
    $('#newTokenInput').value = '';
  } else if (action === 'reload-packages') {
    loadPackages();
  }
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-copy], [data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action) {
    e.preventDefault();
    handleTokenAction(action, target).catch(err => toast('错误: ' + err.message));
    return;
  }
  const text = target.dataset.copy;
  if (text != null) {
    e.preventDefault();
    copy(text, target);
  }
});

$('#pasteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const newToken = $('#newTokenInput').value.trim();
  if (!newToken) return;
  try {
    await fetchJSON('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: newToken })
    });
    toast('Token 已保存');
    $('#newTokenInput').value = '';
    closeSheet('#pasteModal');
    await Promise.all([loadConfig(), loadTokenInfo(), loadUser(), loadRepos(), loadPackages()]);
  } catch (err) {
    toast('保存失败: ' + err.message);
  }
});

$('#repoSearch').addEventListener('input', renderRepos);
$('#imageSearch').addEventListener('input', renderPackages);
$('#refreshBtn').addEventListener('click', () => init());

// 切回标签页自动刷新（距上次加载超过 30 秒）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!state.lastLoadedAt || Date.now() - state.lastLoadedAt > 30_000) init();
  }
});

async function init() {
  $('#status').textContent = '加载中…';
  try {
    await Promise.all([
      loadConfig(),
      loadTokenInfo(),
      loadUser(),
      loadRepos(),
      loadPackages()
    ]);
    state.lastLoadedAt = Date.now();
    $('#status').textContent = '已加载 · ' + new Date().toLocaleTimeString();
  } catch (e) {
    $('#status').textContent = '加载失败: ' + e.message;
  }
}

init();
