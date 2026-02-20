let currentMode = 'tab';
let selectedInterval = 3;

document.addEventListener('DOMContentLoaded', () => {
  // Nav
  document.getElementById('navRefresh').addEventListener('click', () => showPage('refresh'));
  document.getElementById('navHistory').addEventListener('click', () => showPage('history'));

  // Mode toggle
  document.getElementById('modeTab').addEventListener('click', () => setMode('tab'));
  document.getElementById('modeUrl').addEventListener('click', () => setMode('url'));
  document.getElementById('btnUseCurrent').addEventListener('click', useCurrentTab);

  // Interval pills
  document.querySelectorAll('.interval-pill').forEach(btn => {
    btn.addEventListener('click', () => selectInterval(parseInt(btn.dataset.val), btn));
  });
  document.getElementById('customInterval').addEventListener('input', e => {
    const val = parseInt(e.target.value);
    if (val >= 1 && val <= 1440) {
      document.querySelectorAll('.interval-pill').forEach(b => b.classList.remove('sel'));
      selectedInterval = val;
    }
  });

  // Add button
  document.getElementById('btnAdd').addEventListener('click', addWatch);

  // History clear
  document.getElementById('btnClearHistory').addEventListener('click', clearHistory);

  loadTabs();
  refreshWatchList();
  loadHistory();

  // Poll every 8s to keep counts/status fresh
  setInterval(refreshWatchList, 8000);
});

/* ── Navigation ── */
function showPage(page) {
  ['refresh', 'history'].forEach(p => {
    document.getElementById(`page${cap(p)}`).classList.toggle('active', p === page);
    document.getElementById(`nav${cap(p)}`).classList.toggle('active', p === page);
  });
  if (page === 'history') loadHistory();
}
const cap = s => s[0].toUpperCase() + s.slice(1);

/* ── Mode ── */
function setMode(mode) {
  currentMode = mode;
  document.getElementById('modeTab').classList.toggle('active', mode === 'tab');
  document.getElementById('modeUrl').classList.toggle('active', mode === 'url');
  document.getElementById('tabMode').classList.toggle('hidden', mode !== 'tab');
  document.getElementById('urlMode').classList.toggle('hidden', mode !== 'url');
}

/* ── Tabs dropdown ── */
function loadTabs() {
  chrome.tabs.query({}, tabs => {
    const select = document.getElementById('tab-select');
    select.innerHTML = '';
    tabs.forEach(tab => {
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
      const opt = document.createElement('option');
      opt.value = tab.id;
      opt.dataset.url = tab.url;
      const title = tab.title || tab.url;
      opt.textContent = title.length > 46 ? title.slice(0, 46) + '…' : title;
      select.appendChild(opt);
    });
    chrome.tabs.query({ active: true, currentWindow: true }, active => {
      if (active[0]) select.value = active[0].id;
    });
  });
}

function useCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) document.getElementById('urlInput').value = tabs[0].url;
  });
}

/* ── Interval ── */
function selectInterval(val, btn) {
  selectedInterval = val;
  document.querySelectorAll('.interval-pill').forEach(b => b.classList.remove('sel'));
  document.getElementById('customInterval').value = '';
  if (btn) btn.classList.add('sel');
}

/* ── Add watch ── */
function addWatch() {
  let url = '', tabId = null, title = '';

  if (currentMode === 'tab') {
    const select = document.getElementById('tab-select');
    const opt = select.options[select.selectedIndex];
    if (!opt || !opt.value) { alert('Please select a tab.'); return; }
    tabId = parseInt(opt.value);
    url   = opt.dataset.url;
    title = opt.textContent.replace(/…$/, '');
  } else {
    url = document.getElementById('urlInput').value.trim();
    if (!url) { alert('Please enter a URL.'); return; }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
      document.getElementById('urlInput').value = url;
    }
  }

  const id = `w-${Date.now()}`;
  chrome.runtime.sendMessage({
    action: 'addWatch',
    watch: { id, url, tabId, title, intervalMinutes: selectedInterval }
  }, () => refreshWatchList());
}

/* ── Watch list rendering ── */
function refreshWatchList() {
  chrome.runtime.sendMessage({ action: 'getWatches' }, watches => {
    const list   = document.getElementById('watchList');
    const countEl = document.getElementById('watchCount');
    const entries = Object.values(watches || {});

    countEl.textContent = entries.length;

    if (entries.length === 0) {
      list.innerHTML = `
        <div class="empty-watches">
          <div class="icon">👀</div>
          <p>No tabs being watched yet.<br>Add one above to get started.</p>
        </div>`;
      return;
    }

    list.innerHTML = entries.map(w => {
      const shortUrl = (w.url || '').replace(/^https?:\/\//, '').slice(0, 46);
      const displayTitle = w.customName || w.title || shortUrl;
      const intervalLabel = w.intervalMinutes === 1 ? '1m' : `${w.intervalMinutes}m`;
      const attempt = renderAttemptBadge(w.lastAttempt);

      return `
        <div class="watch-card" data-id="${w.id}">
          <div class="wc-top">
            <div class="wc-pulse"></div>
            <div class="wc-info">
              <div class="wc-title" data-id="${w.id}" title="Click to rename">
                <span class="wc-title-text">${displayTitle}</span>
                <span class="rename-hint">✎</span>
              </div>
              <input class="wc-rename-input" data-id="${w.id}" value="${displayTitle}" placeholder="Enter a name…" />
              <div class="wc-url" title="${w.url}">${shortUrl}</div>
            </div>
            <button class="btn-remove" data-id="${w.id}" title="Stop watching">✕</button>
          </div>
          <div class="wc-meta">
            <span class="wc-interval">↻ ${intervalLabel}</span>
            <span class="wc-stat">Refreshed <strong>${w.refreshCount || 0}×</strong></span>
            ${attempt}
          </div>
        </div>`;
    }).join('');

    // Wire remove buttons
    list.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'removeWatch', id: btn.dataset.id }, () => refreshWatchList());
      });
    });

    // Wire rename: click title → show input
    list.querySelectorAll('.wc-title').forEach(titleEl => {
      titleEl.addEventListener('click', () => {
        const id = titleEl.dataset.id;
        const input = list.querySelector(`.wc-rename-input[data-id="${id}"]`);
        titleEl.style.display = 'none';
        input.classList.add('visible');
        input.focus();
        input.select();
      });
    });

    // Wire rename: blur or Enter → save
    list.querySelectorAll('.wc-rename-input').forEach(input => {
      const save = () => {
        const id = input.dataset.id;
        const newName = input.value.trim();
        const titleEl = list.querySelector(`.wc-title[data-id="${id}"]`);
        const titleText = titleEl.querySelector('.wc-title-text');

        input.classList.remove('visible');
        titleEl.style.display = '';

        if (!newName) return;
        titleText.textContent = newName;

        chrome.runtime.sendMessage({ action: 'renameWatch', id, name: newName });
      };

      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = input.defaultValue; input.blur(); }
      });
    });
  });
}

function renderAttemptBadge(attempt) {
  if (!attempt) return '';
  const map = {
    refreshed: { cls: 'refreshed', label: 'refreshed' },
    locked:    { cls: 'locked',    label: 'locked'    },
    skipped:   { cls: 'skipped',   label: 'tab was active' },
  };
  const c = map[attempt.status] || map.refreshed;
  const ago = timeAgo(attempt.timestamp);
  return `<span class="wc-attempt">
    <span class="attempt-dot ${c.cls}"></span>
    <span class="attempt-label ${c.cls}">${c.label} ${ago}</span>
  </span>`;
}

/* ── History ── */
function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getHistory' }, history => renderHistory(history || []));
}

function renderHistory(history) {
  const list  = document.getElementById('historyList');
  const count = document.getElementById('historyCount');
  const badge = document.getElementById('historyBadge');

  count.textContent = `${history.length} refresh${history.length !== 1 ? 'es' : ''} logged`;

  if (history.length === 0) {
    badge.classList.add('hidden');
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🕐</div><p>No refreshes yet.<br>Add a tab to watch to see history here.</p></div>`;
    return;
  }

  badge.textContent = history.length;
  badge.classList.remove('hidden');

  list.innerHTML = [...history].reverse().map(entry => {
    const shortUrl = entry.url.replace(/^https?:\/\//, '').slice(0, 50);
    const tagMap = {
      refreshed: { cls: 'refreshed', label: '✓ refreshed' },
      skipped:   { cls: 'locked',    label: '⏸ tab was active' },
    };
    const tag = tagMap[entry.status] || tagMap.refreshed;

    return `
      <div class="history-item">
        <div class="hi-url"><a href="${entry.url}" title="${entry.url}">${shortUrl}</a></div>
        <div class="hi-meta">
          <span class="hi-time">${formatTime(new Date(entry.timestamp))}</span>
          <span class="hi-tag ${tag.cls}">${tag.label}</span>
          ${entry.title ? `<span class="hi-title">${entry.title.slice(0, 28)}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

function clearHistory() {
  chrome.runtime.sendMessage({ action: 'clearHistory' }, () => loadHistory());
}

/* ── Time helpers ── */
function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function formatTime(date) {
  const diff = Date.now() - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    + ' ' + date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
