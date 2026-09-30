(function () {
  var KEY = 'ghdash-theme';
  var root = document.documentElement;

  function apply(theme) {
    root.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch (e) { /* storage disabled */ }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f2f2f7' : '#000000');
    document.querySelectorAll('[data-theme-choice]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.dataset.themeChoice === theme));
    });
  }

  document.addEventListener('click', function (e) {
    var seg = e.target.closest('[data-theme-choice]');
    if (seg) {
      e.preventDefault();
      apply(seg.dataset.themeChoice);
      return;
    }
    if (e.target.classList && e.target.classList.contains('sheet-overlay')) {
      window.closeAllSheets();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') window.closeAllSheets();
  });

  window.openSheet = function (sel) {
    var el = document.querySelector(sel);
    if (!el) return;
    el.classList.remove('hidden');
    var focusable = el.querySelector('input:not([type=hidden]), button');
    if (focusable) focusable.focus();
  };

  window.closeSheet = function (sel) {
    var el = document.querySelector(sel);
    if (el) el.classList.add('hidden');
  };

  window.closeAllSheets = function () {
    document.querySelectorAll('.sheet-overlay').forEach(function (el) {
      el.classList.add('hidden');
    });
  };

  window.showCopyFallback = function (text) {
    var overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    var sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');

    var title = document.createElement('h3');
    title.className = 'sheet-title';
    title.textContent = '手动复制';
    var message = document.createElement('p');
    message.className = 'sheet-message';
    message.textContent = '当前为 HTTP 非安全环境，浏览器禁止自动复制。内容已全选，请按 Ctrl/Cmd + C 复制。';
    var field = document.createElement('div');
    field.className = 'field';
    var ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.rows = 4;
    field.appendChild(ta);
    var actions = document.createElement('div');
    actions.className = 'sheet-actions';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn primary';
    close.textContent = '关闭';
    actions.appendChild(close);

    sheet.appendChild(title);
    sheet.appendChild(message);
    sheet.appendChild(field);
    sheet.appendChild(actions);
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    ta.value = text;
    ta.focus();
    ta.select();

    function dismiss() {
      overlay.remove();
    }
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) dismiss();
    });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        dismiss();
        document.removeEventListener('keydown', onKey);
      }
    });
  };

  apply(root.dataset.theme === 'light' ? 'light' : 'dark');
})();
