const $ = (sel) => document.querySelector(sel);

const state = {
  tokens: [],
  statuses: {},
  revealed: {},
  editing: null
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

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function statusBadge(st) {
  if (!st) return '<span class="badge">检测中…</span>';
  if (st.valid) return '<span class="badge valid">有效</span>';
  return `<span class="badge invalid" title="${escapeAttr(st.error || '')}">无效</span>`;
}

function expireHtml(expiresAt) {
  if (!expiresAt) return '<span class="expire-ok">无过期时间</span>';
  const d = new Date(expiresAt);
  if (isNaN(d)) return escapeHtml(expiresAt);
  const days = Math.round((d - Date.now()) / 86400000);
  const tone = days < 7 ? 'expire-warn' : days < 30 ? 'expire-soon' : 'expire-ok';
  return `<span class="${tone}">${d.toLocaleString()} (剩 ${days} 天)</span>`;
}

function shortScopes(scopes) {
  if (!scopes) return '(fine-grained 或未返回)';
  const parts = scopes.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 6) return parts.join(', ');
  return `${parts.slice(0, 6).join(', ')} … (+${parts.length - 6})`;
}

async function reveal(id) {
  if (!state.revealed[id]) {
    const { token } = await fetchJSON(`/api/tokens/${encodeURIComponent(id)}/reveal`);
    state.revealed[id] = token;
  }
  return state.revealed[id];
}

function editFormHtml(t) {
  return `
    <form class="edit-form" data-id="${escapeAttr(t.id)}">
      <label class="field">
        <span class="field-label">备注名</span>
        <input name="label" value="${escapeAttr(t.label)}" />
      </label>
      <label class="field">
        <span class="field-label">新 Token（留空则不修改）</span>
        <input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="ghp_... 或 github_pat_..." />
      </label>
      <label class="field">
        <span class="field-label">用途说明</span>
        <input name="note" value="${escapeAttr(t.note || '')}" />
      </label>
      <div class="sheet-actions">
        <button class="btn" type="button" data-action="cancel-edit">取消</button>
        <button class="btn primary" type="submit">保存</button>
      </div>
    </form>`;
}

function cardHtml(t) {
  const st = state.statuses[t.id];
  const revealed = state.revealed[t.id];
  const value = revealed || t.masked;
  const isActive = t.id === 'active';

  const meta = [];
  if (st && st.valid) {
    meta.push(`登录: <b>${escapeHtml(st.login || '—')}</b>`);
    if (st.rateLimit) meta.push(`配额: ${st.rateLimit.remaining}/${st.rateLimit.limit}`);
  } else if (st && !st.valid) {
    meta.push(`<span class="expire-warn">${escapeHtml(st.error || '无效')}</span>`);
  }
  meta.push(`过期: ${expireHtml(st?.expiresAt)}`);

  return `
    <div class="pat-item" data-id="${escapeAttr(t.id)}">
      <div class="head">
        <span class="pat-name">${escapeHtml(t.label)}</span>
        <span>
          ${t.type && t.type !== 'token' ? `<span class="badge">${escapeHtml(t.type)}</span>` : ''}
          ${t.active ? '<span class="badge active">活跃</span>' : ''}
          ${statusBadge(st)}
        </span>
        <span class="btns">
          <button class="btn" data-action="toggle" data-id="${escapeAttr(t.id)}">${revealed ? '隐藏' : '显示'}</button>
          <button class="btn primary" data-action="copy" data-id="${escapeAttr(t.id)}">复制</button>
          ${t.active ? '' : `<button class="btn" data-action="activate" data-id="${escapeAttr(t.id)}">设为活跃</button>`}
          ${isActive ? '' : `<button class="btn" data-action="edit" data-id="${escapeAttr(t.id)}">编辑</button>
          <button class="btn danger" data-action="delete" data-id="${escapeAttr(t.id)}">删除</button>`}
        </span>
      </div>
      <div class="pat-value mono">${escapeHtml(value)}</div>
      <div class="pat-meta">${meta.join(' · ')}</div>
      ${st?.scopes ? `<div class="pat-scopes mono" title="${escapeAttr(st.scopes)}">scopes: ${escapeHtml(shortScopes(st.scopes))}</div>` : ''}
      ${t.note ? `<div class="pat-note">${escapeHtml(t.note)}</div>` : ''}
      ${state.editing === t.id ? editFormHtml(t) : ''}
    </div>`;
}

function render() {
  $('#patCount').textContent = `${state.tokens.length} 个`;
  syncRevealAllBtn();
  if (!state.tokens.length) {
    $('#patList').innerHTML = '<div class="placeholder">暂无 PAT，点击右上角「新增 PAT」登记</div>';
    return;
  }
  $('#patList').innerHTML = state.tokens.map(cardHtml).join('');
}

function syncRevealAllBtn() {
  const btn = $('#revealAllBtn');
  if (!btn) return;
  const ids = state.tokens.map(t => t.id);
  const allRevealed = ids.length > 0 && ids.every(id => state.revealed[id]);
  btn.textContent = allRevealed ? '全部隐藏' : '全部显示';
}

async function toggleRevealAll(btn) {
  const ids = state.tokens.map(t => t.id);
  const allRevealed = ids.length > 0 && ids.every(id => state.revealed[id]);
  if (allRevealed) {
    state.revealed = {};
    render();
    return;
  }
  btn.disabled = true;
  try {
    const pairs = await Promise.all(ids.map(async (id) => {
      const { token } = await fetchJSON(`/api/tokens/${encodeURIComponent(id)}/reveal`);
      return [id, token];
    }));
    pairs.forEach(([id, token]) => { state.revealed[id] = token; });
    render();
  } finally {
    btn.disabled = false;
  }
}

async function load() {
  const data = await fetchJSON('/api/tokens');
  state.tokens = data.tokens;
  render();
}

async function checkAll() {
  $('#status').textContent = '检测中…';
  try {
    const data = await fetchJSON('/api/tokens/status');
    state.statuses = Object.fromEntries(data.statuses.map(s => [s.id, s]));
    render();
    $('#status').textContent = '状态已更新 · ' + new Date().toLocaleTimeString();
  } catch (e) {
    $('#status').textContent = '检测失败: ' + e.message;
  }
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;
  e.preventDefault();

  (async () => {
    if (action === 'toggle') {
      if (state.revealed[id]) delete state.revealed[id];
      else await reveal(id);
      render();
    } else if (action === 'copy') {
      await copy(await reveal(id), target);
    } else if (action === 'activate') {
      if (!confirm('确定将该 Token 设为活跃？看板与 agent 将立即使用它。')) return;
      await fetchJSON(`/api/tokens/${encodeURIComponent(id)}/activate`, { method: 'POST' });
      toast('已切换活跃 Token');
      await load();
      await checkAll();
    } else if (action === 'edit') {
      state.editing = id;
      render();
    } else if (action === 'cancel-edit') {
      state.editing = null;
      render();
    } else if (action === 'delete') {
      const t = state.tokens.find(x => x.id === id);
      if (!confirm(`确定删除「${t ? t.label : id}」？此操作只删除本地记录，不会吊销 GitHub 上的 Token。`)) return;
      await fetchJSON(`/api/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('已删除');
      delete state.revealed[id];
      await load();
    }
  })().catch(err => toast('错误: ' + err.message));
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!form.classList.contains('edit-form')) return;
  e.preventDefault();
  const id = form.dataset.id;
  const fd = new FormData(form);
  const token = (fd.get('token') || '').trim();
  const body = { label: fd.get('label') || '', note: fd.get('note') || '' };
  if (token) body.token = token;
  fetchJSON(`/api/tokens/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(() => {
    toast('已保存');
    state.editing = null;
    delete state.revealed[id];
    return load();
  }).then(() => checkAll()).catch(err => toast('保存失败: ' + err.message));
});

$('#addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const label = $('#addLabel').value.trim();
  const token = $('#addToken').value.trim();
  const note = $('#addNote').value.trim();
  if (!token) return toast('请粘贴 Token');
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  fetchJSON('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, token, note })
  }).then(() => {
    toast('已添加并校验通过');
    $('#addForm').reset();
    closeSheet('#addModal');
    return load();
  }).then(() => checkAll())
    .catch(err => toast('添加失败: ' + err.message))
    .finally(() => { if (btn) btn.disabled = false; });
});

$('#showAddBtn').addEventListener('click', () => {
  openSheet('#addModal');
});
$('#addCancel').addEventListener('click', () => {
  $('#addForm').reset();
  closeSheet('#addModal');
});
$('#checkAllBtn').addEventListener('click', () => checkAll().catch(err => toast('错误: ' + err.message)));
$('#revealAllBtn').addEventListener('click', (e) => {
  toggleRevealAll(e.currentTarget).catch(err => toast('错误: ' + err.message));
});

async function init() {
  try {
    await load();
    await checkAll();
  } catch (e) {
    $('#patList').innerHTML = `<div class="placeholder">加载失败: ${escapeHtml(e.message)}</div>`;
  }
}

init();
