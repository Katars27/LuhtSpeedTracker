// watchdog.js
// @ts-nocheck
'use strict';

(function () {
  // Защита от двойной загрузки
  if (window.LuhtWatchDog) return;
  window.LuhtWatchDog = true;

  const ROOT_ID = '__luht_watchdog_root__';

  const DOM_LOG_THROTTLE_MS = 700;
  const MAX_LOGS = 300;
  const MAX_DOM_BATCH = 9999;

  const MAX_PENDING_ENTRIES = 80; // чтобы не раздувало очередь
  const MAX_FLUSH_PER_FRAME = 60; // чтобы не забивать один кадр
  const CLOSE_ANIM_MS = 250;

  let toggleBtn = null;
  let panel = null;
  let logBody = null;

  /** @type {string[]} */
  let logs = [];

  /** @type {{html:string, text:string}[]} */
  let pendingEntries = [];
  let flushScheduled = false;

  let lastDomLog = 0;
  let domObserver = null;

  function nowTimeStr() {
    try {
      return new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }

  function ensureBody(cb) {
    if (document.body) return cb();
    const onReady = () => cb();
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function safeAppendToRoot(el) {
    const root = document.documentElement || document;
    try {
      root.appendChild(el);
    } catch (e) {
      ensureBody(() => {
        try {
          (document.body || root).appendChild(el);
        } catch (_) {}
      });
    }
  }

  function createToggleButton() {
    if (toggleBtn) return;

    toggleBtn = document.createElement('button');
    toggleBtn.className = 'luht-watchdog-toggle';
    toggleBtn.textContent = '🛠';
    toggleBtn.title = 'WatchDog PRO (Ctrl+Shift+D)';

    Object.assign(toggleBtn.style, {
      position: 'fixed',
      bottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)',
      right: '20px',
      zIndex: '1000002',
      width: '56px',
      height: '56px',
      fontSize: '28px',
      background: 'rgba(136, 136, 255, 0.35)',
      border: '2px solid #8888ff',
      borderRadius: '50%',
      backdropFilter: 'blur(12px)',
      boxShadow: '0 4px 20px rgba(136, 136, 255, 0.5)',
      cursor: 'pointer',
      transition: 'all 0.25s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    });

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleWatchDog();
    });

    safeAppendToRoot(toggleBtn);
  }

  function createPanel() {
    if (panel) return;

    panel = document.createElement('div');
    panel.className = 'luht-watchdog-panel';
    panel.id = ROOT_ID;

    Object.assign(panel.style, {
      position: 'fixed',
      bottom: 'calc(env(safe-area-inset-bottom, 20px) + 86px)',
      right: '20px',
      width: 'min(460px, calc(100vw - 40px))',
      maxHeight: '70vh',
      background: 'rgba(26, 18, 24, 0.95)',
      border: '2px solid #cc4488',
      borderRadius: '16px',
      color: '#ffd1e6',
      fontFamily:
        'GeistVariable, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: '13px',
      zIndex: '1000001',
      boxShadow: '0 8px 32px rgba(0,0,0,0.8), 0 0 40px rgba(255,51,153,0.3)',
      backdropFilter: 'blur(14px)',
      opacity: '0',
      transform: 'translateY(20px)',
      transition: 'opacity 0.25s ease, transform 0.25s ease',
      overflow: 'hidden',
      display: 'none',
      flexDirection: 'column',
    });

    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      padding: '12px 16px',
      background: 'linear-gradient(90deg, #cc4488, #ff3399, #ff66aa)',
      fontWeight: 'bold',
      fontSize: '15px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      userSelect: 'none',
      WebkitUserSelect: 'none',
    });

    const headerTitle = document.createElement('div');
    headerTitle.textContent = '🛠 WATCHDOG PRO';
    header.appendChild(headerTitle);

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
      fontSize: '24px',
      cursor: 'pointer',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      lineHeight: '1',
      padding: '0 4px',
    });
    closeBtn.onclick = deactivate;
    header.appendChild(closeBtn);

    // Controls
    const controls = document.createElement('div');
    Object.assign(controls.style, {
      padding: '8px 16px',
      background: '#1a1218',
      display: 'flex',
      gap: '12px',
      flexWrap: 'wrap',
    });

    const exportBtn = document.createElement('button');
    exportBtn.textContent = 'Экспорт';
    Object.assign(exportBtn.style, {
      background: '#ff66aa',
      color: '#000',
      border: 'none',
      padding: '8px 14px',
      borderRadius: '10px',
      cursor: 'pointer',
      fontWeight: 'bold',
    });
    exportBtn.onclick = exportLog;
    controls.appendChild(exportBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Очистить';
    Object.assign(clearBtn.style, {
      background: '#444',
      color: '#fff',
      border: 'none',
      padding: '8px 14px',
      borderRadius: '10px',
      cursor: 'pointer',
    });
    clearBtn.onclick = () => {
      logs = [];
      pendingEntries = [];
      flushScheduled = false;
      if (logBody) logBody.innerHTML = '';
      addLog('info', 'Лог очищен');
    };
    controls.appendChild(clearBtn);

    // Log body
    logBody = document.createElement('div');
    Object.assign(logBody.style, {
      padding: '12px',
      flex: '1',
      overflowY: 'auto',
      maxHeight: 'calc(70vh - 100px)',
      overscrollBehavior: 'contain',
    });

    panel.appendChild(header);
    panel.appendChild(controls);
    panel.appendChild(logBody);

    safeAppendToRoot(panel);
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;

    requestAnimationFrame(() => {
      flushScheduled = false;
      if (!logBody || pendingEntries.length === 0) return;

      const frag = document.createDocumentFragment();

      // вставляем сверху батчем
      const take = Math.min(MAX_FLUSH_PER_FRAME, pendingEntries.length);
      for (let i = 0; i < take; i++) {
        const it = pendingEntries[i];
        const entry = document.createElement('div');
        entry.style.marginBottom = '6px';
        entry.innerHTML = it.html;
        frag.appendChild(entry);
      }

      // удаляем использованные элементы
      pendingEntries.splice(0, take);

      logBody.insertBefore(frag, logBody.firstChild);

      // лимит DOM-нод
      while (logBody.childNodes.length > MAX_LOGS) {
        if (!logBody.lastChild) break;
        logBody.removeChild(logBody.lastChild);
      }

      // если ещё есть — дожмём следующими кадрами
      if (pendingEntries.length > 0) scheduleFlush();
    });
  }

  function addLog(type, message) {
    const time = nowTimeStr();

    const safeType = escapeHtml(String(type || 'info').toUpperCase());
    const safeMsg = escapeHtml(String(message || ''));

    const html =
      `<span style="color:#ff99cc">[${time}]</span> ` +
      `<span style="color:#ff66aa;font-weight:bold">[${safeType}]</span> ` +
      `${safeMsg}`;

    const text = `[${time}] [${safeType}] ${String(message || '')}`;

    logs.unshift(text);
    if (logs.length > MAX_LOGS) logs.pop();

    // панель может быть ещё не создана — ок
    if (!logBody) return;

    pendingEntries.unshift({ html, text });
    if (pendingEntries.length > MAX_PENDING_ENTRIES) pendingEntries.length = MAX_PENDING_ENTRIES;

    scheduleFlush();
  }

  function exportLog() {
    if (logs.length === 0) {
      alert('Лог пуст');
      return;
    }

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const time = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
    const filename = `watchdog_${date}_${time}.txt`;

    const text =
      'WATCHDOG PRO LOG\n' +
      'URL: ' + location.href + '\n' +
      'UA: ' + (navigator.userAgent || '-') + '\n\n' +
      // в файл — по времени сверху вниз
      logs.slice().reverse().join('\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';

    ensureBody(() => {
      const root = document.body || document.documentElement || document;
      try {
        root.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {}
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  function isInsideOwnUI(node) {
    try {
      if (!node) return false;
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el || !el.closest) return false;
      return !!el.closest('#' + ROOT_ID) || !!el.closest('.luht-watchdog-toggle');
    } catch {
      return false;
    }
  }

  function ensureObserver() {
    if (domObserver) return;

    domObserver = new MutationObserver((mutations) => {
      if (!window.LuhtWatchDogActive) return;

      let count = 0;

      for (const mut of mutations) {
        if (isInsideOwnUI(mut.target)) continue;

        // htmx и большие куски — часто шумят, пропускаем
        if (
          mut.target &&
          mut.target.closest &&
          mut.target.closest('[hx-swap], [hx-get], [hx-post], [hx-trigger], [hx-boost]')
        ) {
          continue;
        }

        if (mut.type === 'childList' && mut.addedNodes && mut.addedNodes.length) {
          count += mut.addedNodes.length;
          if (count >= MAX_DOM_BATCH) {
            count = MAX_DOM_BATCH;
            break;
          }
        }
      }

      if (count > 0) {
        const now = performance.now();
        if (now - lastDomLog >= DOM_LOG_THROTTLE_MS) {
          lastDomLog = now;
          addLog('dom', `+${count} узлов`);
        }
      }
    });
  }

  function startObserving() {
    ensureObserver();
    ensureBody(() => {
      if (!document.body) return;
      try {
        domObserver.observe(document.body, { childList: true, subtree: true });
      } catch {
        addLog('warn', 'Не удалось запустить MutationObserver');
      }
    });
  }

  function stopObserving() {
    try {
      if (domObserver) domObserver.disconnect();
    } catch {}
  }

  function openPanel() {
    if (!panel) return;
    panel.style.display = 'flex';
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(20px)';
    requestAnimationFrame(() => {
      panel.style.opacity = '1';
      panel.style.transform = 'translateY(0)';
    });
  }

  function closePanel() {
    if (!panel) return;
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(20px)';
    setTimeout(() => {
      if (!window.LuhtWatchDogActive && panel) panel.style.display = 'none';
    }, CLOSE_ANIM_MS);
  }

  function activate() {
    if (window.LuhtWatchDogActive) return;
    window.LuhtWatchDogActive = true;

    createToggleButton();
    createPanel();

    if (toggleBtn) {
      toggleBtn.style.transform = 'scale(1.08)';
      toggleBtn.style.boxShadow = '0 0 30px rgba(255,106,193,0.8)';
      toggleBtn.setAttribute('aria-pressed', 'true');
    }

    openPanel();
    startObserving();

    addLog('info', 'WatchDog PRO активирован');
    addLog('info', `URL: ${location.pathname}`);
  }

  function deactivate() {
    if (!window.LuhtWatchDogActive) return;
    window.LuhtWatchDogActive = false;

    stopObserving();
    closePanel();

    if (toggleBtn) {
      toggleBtn.style.transform = 'scale(1)';
      toggleBtn.style.boxShadow = '0 4px 20px rgba(136, 136, 255, 0.5)';
      toggleBtn.setAttribute('aria-pressed', 'false');
    }

    // DOM-лог чистим, но текстовый logs оставляем (можно экспортнуть после закрытия)
    pendingEntries = [];
    flushScheduled = false;
    if (logBody) logBody.innerHTML = '';
  }

  function toggleWatchDog() {
    window.LuhtWatchDogActive ? deactivate() : activate();
  }

  // Клик вне панели — закрываем
  document.addEventListener(
    'click',
    (e) => {
      if (!window.LuhtWatchDogActive) return;
      if (!panel || !toggleBtn) return;

      const target = e.target;
      if (panel.contains(target)) return;
      if (toggleBtn === target) return;
      if (target && target.closest && target.closest('.luht-watchdog-toggle')) return;

      deactivate();
    },
    { capture: true }
  );

  // Хоткей Ctrl+Shift+D (и защита от ввода в поля)
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.repeat) return;

      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

      if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault();
        toggleWatchDog();
      }
    },
    { capture: true }
  );

  // Автоактивация по ?watchdog=1
  if (location.search.includes('watchdog=1')) {
    const kick = () => activate();
    if ('requestIdleCallback' in window) {
      try {
        requestIdleCallback(kick, { timeout: 1000 });
      } catch {
        setTimeout(kick, 150);
      }
    } else {
      setTimeout(kick, 150);
    }
  }

  // Авто-выключение при уходе со страницы
  window.addEventListener('beforeunload', () => {
    try {
      deactivate();
    } catch {}
  });

  // Глобальные хелперы
  window.activateLuhtWatchDog = activate;
  window.deactivateLuhtWatchDog = deactivate;
  window.toggleLuhtWatchDog = toggleWatchDog;

  // Кнопка видна всегда
  createToggleButton();
})();
