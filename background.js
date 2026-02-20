// Auto Refresh - Background Service Worker
// Supports multiple watched tabs, each with its own alarm

const MAX_HISTORY = 300;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ watches: {}, history: [] });
});

// ── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === 'addWatch') {
    addWatch(msg.watch);
    sendResponse({ success: true });

  } else if (msg.action === 'removeWatch') {
    removeWatch(msg.id);
    sendResponse({ success: true });

  } else if (msg.action === 'getWatches') {
    chrome.storage.local.get('watches', d => sendResponse(d.watches || {}));
    return true;

  } else if (msg.action === 'renameWatch') {
    chrome.storage.local.get('watches', d => {
      const watches = d.watches || {};
      if (watches[msg.id]) {
        watches[msg.id].customName = msg.name;
        chrome.storage.local.set({ watches });
      }
    });
    sendResponse({ success: true });

  } else if (msg.action === 'getHistory') {
    chrome.storage.local.get('history', d => sendResponse(d.history || []));
    return true;

  } else if (msg.action === 'clearHistory') {
    chrome.storage.local.set({ history: [] }, () => sendResponse({ success: true }));
    return true;
  }

  return true;
});

// ── Add / remove watches ─────────────────────────────────────────────────────
function addWatch(watch) {
  // watch = { id, url, tabId, title, intervalMinutes }
  chrome.storage.local.get('watches', d => {
    const watches = d.watches || {};
    watches[watch.id] = {
      ...watch,
      refreshCount: 0,
      lastAttempt: null,
      addedAt: Date.now()
    };
    chrome.storage.local.set({ watches }, () => {
      scheduleAlarm(watch.id, watch.intervalMinutes);
    });
  });
}

function removeWatch(id) {
  chrome.alarms.clear(`watch-${id}`);
  chrome.storage.local.get('watches', d => {
    const watches = d.watches || {};
    delete watches[id];
    chrome.storage.local.set({ watches });
  });
}

function scheduleAlarm(id, intervalMinutes) {
  const name = `watch-${id}`;
  chrome.alarms.clear(name, () => {
    chrome.alarms.create(name, {
      delayInMinutes: intervalMinutes,
      periodInMinutes: intervalMinutes
    });
  });
}

// ── Alarm fires ──────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith('watch-')) return;
  const id = alarm.name.replace('watch-', '');

  chrome.storage.local.get(['watches', 'history'], d => {
    const watches = d.watches || {};
    const watch = watches[id];
    if (!watch) return;

    if (watch.tabId) {
      chrome.tabs.get(watch.tabId, tab => {
        if (chrome.runtime.lastError || !tab) {
          // Tab no longer exists — reopen it (it was being watched, so refresh it)
          reopenAndRefresh(watch, watches, d.history, 'refreshed');
          return;
        }

        if (tab.active) {
          // Tab is currently focused — skip
          watches[id].lastAttempt = { status: 'skipped', timestamp: Date.now() };
          chrome.storage.local.set({ watches });
        } else {
          // Tab is in the background — refresh it
          chrome.tabs.reload(watch.tabId, () => {
            recordRefresh(watch, watches, d.history, tab.title || watch.url, 'refreshed');
          });
        }
      });
    } else {
      // No tabId stored — find by URL
      chrome.tabs.query({ url: watch.url }, tabs => {
        if (tabs && tabs.length > 0) {
          const tab = tabs[0];
          watches[id].tabId = tab.id;
          if (tab.active) {
            watches[id].lastAttempt = { status: 'skipped', timestamp: Date.now() };
            chrome.storage.local.set({ watches });
          } else {
            chrome.tabs.reload(tab.id, () => {
              recordRefresh(watch, watches, d.history, tab.title || watch.url, 'refreshed');
            });
          }
        } else {
          reopenAndRefresh(watch, watches, d.history, 'refreshed');
        }
      });
    }
  });
});

function reopenAndRefresh(watch, watches, history, attemptStatus) {
  chrome.tabs.create({ url: watch.url }, newTab => {
    watches[watch.id].tabId = newTab.id;
    recordRefresh(watch, watches, history, watch.title || watch.url, attemptStatus);
  });
}

function recordRefresh(watch, watches, history, resolvedTitle, attemptStatus) {
  watches[watch.id].refreshCount = (watch.refreshCount || 0) + 1;
  watches[watch.id].lastAttempt = { status: attemptStatus, timestamp: Date.now() };

  const entry = {
    watchId: watch.id,
    url: watch.url,
    title: resolvedTitle || watch.title || '',
    timestamp: Date.now(),
    status: attemptStatus
  };

  history = [...(history || []), entry];
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);

  chrome.storage.local.set({ watches, history });
}
