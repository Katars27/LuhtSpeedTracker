// @ts-nocheck
'use strict';

(function () {
  if (window.LuhtWatchDog) return;
  window.LuhtWatchDog = true;

  // =====================================================
  // WATCHDOG PRO — Панель мониторинга в стиле Speed Panel
  // Кнопка снизу справа, панель вверх, красивый розовый вайб
  // =====================================================

  let toggleBtn = null;
  let panel = null;
  let logBody = null;
  let logs = [];
  let observer = null;
  let lastDomLog = 0;
  const DOM_LOG_THROTTLE = 500; // Увеличено для снижения нагрузки
  const MAX_LOGS = 300;

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
      transition: 'all 0.3s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      userSelect: 'none'
    });

    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleWatchDog();
    });

    document.documentElement.appendChild(toggleBtn);
  }

  function createPanel() {
    if (panel) return;

    panel = document.createElement('div');
    panel.className = 'luht-watchdog-panel';
    panel.id = '__luht_watchdog_root__';
    panel.style.display = 'none';

    Object.assign(panel.style, {
      position: 'fixed',
      bottom: 'calc(env(safe-area-inset-bottom, 20px) + 86px)',
      right: '20px',
      width: '460px',
      maxHeight: '70vh',
      background: 'rgba(26, 18, 24, 0.95)',
      border: '2px solid #cc4488',
      borderRadius: '16px',
      color: '#ffd1e6',
      fontFamily: 'GeistVariable, monospace',
      fontSize: '13px',
      zIndex: '1000001',
      boxShadow: '0 8px 32px rgba(0,0,0,0.8), 0 0 40px rgba(255,51,153,0.3)',
      backdropFilter: 'blur(14px)',
      opacity: '0',
      transform: 'translateY(20px)',
      transition: 'all 0.3s ease',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
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
      userSelect: 'none'
    });
    header.textContent = '🛠 WATCHDOG PRO';

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.style.fontSize = '24px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.userSelect = 'none';
    closeBtn.onclick = deactivate;
    header.appendChild(closeBtn);

    // Controls
    const controls = document.createElement('div');
    Object.assign(controls.style, {
      padding: '8px 16px',
      background: '#1a1218',
      display: 'flex',
      gap: '12px',
      flexWrap: 'wrap'
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
      fontWeight: 'bold'
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
      cursor: 'pointer'
    });
    clearBtn.onclick = () => {
      logs = [];
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
      maxHeight: 'calc(70vh - 100px)'
    });

    panel.appendChild(header);
    panel.appendChild(controls);
    panel.appendChild(logBody);

    document.documentElement.appendChild(panel);
  }

  function addLog(type, message) {
    if (!logBody) return;

    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const entry = document.createElement('div');
    entry.style.marginBottom = '6px';
    entry.innerHTML = `<span style="color:#ff99cc">[${time}]</span> <span style="color:#ff66aa;font-weight:bold">[${type.toUpperCase()}]</span> ${message}`;

    logBody.prepend(entry);
    logs.unshift(`[${time}] [${type.toUpperCase()}] ${message}`);

    // Лимит логов
    if (logs.length > MAX_LOGS) {
      logs.pop();
      logBody.lastChild?.remove();
    }
  }

  function exportLog() {
    if (logs.length === 0) {
      alert('Лог пуст');
      return;
    }

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const time = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
    const filename = `watchdog_${date}_${time}.txt`;
    const text = 'WATCHDOG PRO LOG\nURL: ' + location.href + '\n\n' + logs.join('\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // MutationObserver с фильтрацией своих элементов и htmx-активности
  const domObserver = new MutationObserver(mutations => {
    let count = 0;
    for (const mut of mutations) {
      // Игнорируем свои элементы
      if (mut.target.closest && mut.target.closest('#__luht_watchdog_root__')) continue;

      // Игнорируем типичные htmx-свапы (можно расширить)
      if (mut.target.closest && mut.target.closest('[hx-swap]')) continue;

      if (mut.type === 'childList' && mut.addedNodes.length) {
        count += mut.addedNodes.length;
      }
    }

    if (count > 0) {
      const now = performance.now();
      if (now - lastDomLog > DOM_LOG_THROTTLE) {
        lastDomLog = now;
        addLog('dom', `+${count} узлов`);
      }
    }
  });

  function activate() {
    if (window.LuhtWatchDogActive) return;
    window.LuhtWatchDogActive = true;

    createToggleButton();
    createPanel();

    // Наблюдаем только за body, но с фильтрами
    domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    panel.style.display = 'flex';
    requestAnimationFrame(() => {
      panel.style.opacity = '1';
      panel.style.transform = 'translateY(0)';
    });

    toggleBtn.style.transform = 'scale(1.1)';
    toggleBtn.style.boxShadow = '0 0 30px rgba(255,106,193,0.8)';

    addLog('info', 'WatchDog PRO активирован');
  }

  function deactivate() {
    if (!window.LuhtWatchDogActive) return;
    window.LuhtWatchDogActive = false;

    if (panel) {
      panel.style.opacity = '0';
      panel.style.transform = 'translateY(20px)';
      setTimeout(() => {
        panel.style.display = 'none';
      }, 300);
    }

    if (toggleBtn) {
      toggleBtn.style.transform = 'scale(1)';
      toggleBtn.style.boxShadow = '0 4px 20px rgba(136, 136, 255, 0.5)';
    }

    domObserver.disconnect();
    logs = [];
    if (logBody) logBody.innerHTML = '';
  }

  function toggleWatchDog() {
    window.LuhtWatchDogActive ? deactivate() : activate();
  }

  // Клик вне панели — закрываем
  document.addEventListener('click', (e) => {
    if (window.LuhtWatchDogActive && panel && !panel.contains(e.target) && e.target !== toggleBtn) {
      deactivate();
    }
  }, { capture: true });

  // Глобальные функции
  window.activateLuhtWatchDog = activate;
  window.deactivateLuhtWatchDog = deactivate;
  window.toggleLuhtWatchDog = toggleWatchDog;

  // Хоткей Ctrl+Shift+D
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') {
      e.preventDefault();
      toggleWatchDog();
    }
  });

  // Автоактивация по параметру ?watchdog=1
  if (location.search.includes('watchdog=1')) {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(activate);
    } else {
      setTimeout(activate, 100);
    }
  }

  // Авто-выключение при уходе со страницы
  window.addEventListener('beforeunload', deactivate);

  // Инициализация (кнопка и панель создаются только при активации, но кнопка всегда видна)
  createToggleButton();
  // Панель создаём лениво при первом открытии (в activate)

})();