// freezer.ui.js
'use strict';

(function (ns) {
  const S = ns.state;

  // Нормализуем ссылку для ключей/сравнений (всегда absolute href)
  function normAbsHref(href) {
    const u = ns.normalizeHref(href);
    return u || null;
  }

  function safeAppendToRoot(el) {
    const root = document.documentElement || document;
    try {
      root.appendChild(el);
    } catch {
      const onReady = () => {
        try {
          (document.documentElement || document).appendChild(el);
        } catch {}
      };
      document.addEventListener('DOMContentLoaded', onReady, { once: true });
    }
  }

  // ============================
  //   UI CREATE
  // ============================
  ns.createFreezerUI = function () {
    // не плодим UI
    if (S.pickerButton && (document.documentElement || document).contains(S.pickerButton)) return;
    if (S.picker && (document.documentElement || document).contains(S.picker)) return;

    // Кнопка открытия панели задач
    const btn = document.createElement('button');
    btn.className = 'luht-freezer-btn';
    btn.textContent = '📋';
    btn.title = 'Открыть список задач (F)';
    btn.style.cssText = `
      position: fixed !important;
      top: calc(env(safe-area-inset-top, 20px) + 20px) !important;
      right: 20px !important;
      z-index: 1000001 !important;
      width: 56px !important;
      height: 56px !important;
      font-size: 32px !important;
      background: rgba(255, 106, 193, 0.35) !important;
      border: 2px solid #ff6ac1 !important;
      border-radius: 50% !important;
      backdrop-filter: blur(12px) !important;
      box-shadow: 0 4px 20px rgba(255, 106, 193, 0.5) !important;
      cursor: pointer !important;
      transition: transform 0.2s ease, opacity 0.2s ease !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      user-select: none !important;
    `;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ns.togglePicker();
    });

    safeAppendToRoot(btn);
    S.pickerButton = btn;

    // Панель списка задач
    const panel = document.createElement('div');
    panel.className = 'luht-freezer-panel';
    panel.style.cssText = `
      position: fixed !important;
      top: calc(env(safe-area-inset-top, 20px) + 90px) !important;
      right: 20px !important;
      width: min(420px, calc(100vw - 40px)) !important;
      max-height: min(70vh, 720px) !important;
      z-index: 1000001 !important;
      background: rgba(20, 20, 20, 0.92) !important;
      border: 1px solid rgba(255, 106, 193, 0.45) !important;
      border-radius: 18px !important;
      box-shadow: 0 18px 60px rgba(0,0,0,0.55) !important;
      backdrop-filter: blur(14px) !important;
      overflow: hidden !important;
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      transform: translateY(20px) !important;
      transition: opacity 0.25s ease, transform 0.25s ease !important;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
    `;

    // Заголовок панели
    const header = document.createElement('div');
    header.className = 'luht-freezer-header';
    header.textContent = 'СПИСОК ЗАДАЧ';
    header.style.cssText = `
      padding: 14px 16px !important;
      font-weight: 800 !important;
      letter-spacing: 0.08em !important;
      font-size: 12px !important;
      color: rgba(255,255,255,0.92) !important;
      border-bottom: 1px solid rgba(255,255,255,0.08) !important;
    `;
    panel.appendChild(header);

    // Контейнер списка задач
    const list = document.createElement('div');
    list.className = 'luht-freezer-list';
    list.style.cssText = `
      overflow-y: auto !important;
      scroll-behavior: smooth !important;
      padding: 10px !important;
      max-height: calc(min(70vh, 720px) - 48px) !important;
    `;
    panel.appendChild(list);

    panel.setAttribute('hx-preserve', '');
    safeAppendToRoot(panel);

    S.picker = panel;
    S.pickerList = list;
  };

  // ============================
  //   LIST RENDER (SMART)
  // ============================
  // ВАЖНО: поддержка дубликатов.
  // Ключ элемента = hrefAbs + '::' + occurrenceIndex (порядок появления в taskList)
  function makeKey(hrefAbs, occ) {
    return `${hrefAbs}::${occ}`;
  }

  ns.updateTaskListSmart = function (taskList) {
    if (!S.pickerList || !S.isOpen) return;
    if (!Array.isArray(taskList)) return;

    const currentId = ns.getTaskIdFromPath(location.pathname);
    const fragment = document.createDocumentFragment();

    // существующие элементы по ключу (hrefAbs::occ)
    const existing = new Map();
    S.pickerList.querySelectorAll('.luht-freezer-item').forEach((el) => {
      const key = el.getAttribute('data-key');
      if (key) existing.set(key, el);
    });

    const finishedSet = new Set(ns.loadFinishedIds());
    const visibleEnd = Math.min(70, taskList.length);

    // счётчик встречаемости hrefAbs в текущем батче
    const occCounter = new Map();

    for (let i = 0; i < visibleEnd; i++) {
      const t = taskList[i];
      const hrefAbs = normAbsHref(t && t.href);
      if (!hrefAbs) continue;

      const id = ns.getTaskIdFromPath(hrefAbs);
      if (id && finishedSet.has(id)) continue;

      const occ = (occCounter.get(hrefAbs) || 0) + 1;
      occCounter.set(hrefAbs, occ);

      const key = makeKey(hrefAbs, occ);

      let item = existing.get(key);
      if (item) {
        // обновляем текст
        ns.setTextIfChanged(item, (t && t.title) || hrefAbs);

        // актуализируем href (на всякий)
        if (item.href !== hrefAbs) item.href = hrefAbs;

        // подсветка
        const isActive = !!id && id === currentId;
        item.classList.toggle('active', isActive);

        fragment.appendChild(item);
      } else {
        item = document.createElement('a');
        item.className = 'luht-freezer-item';
        item.href = hrefAbs;
        item.textContent = (t && t.title) || hrefAbs;
        item.setAttribute('data-key', key);

        item.style.cssText = `
          display: block !important;
          padding: 10px 12px !important;
          margin: 6px 0 !important;
          border-radius: 12px !important;
          text-decoration: none !important;
          color: rgba(255,255,255,0.92) !important;
          background: rgba(255,255,255,0.06) !important;
          border: 1px solid rgba(255,255,255,0.06) !important;
          transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease !important;
          font-size: 14px !important;
          line-height: 1.25 !important;
          word-break: break-word !important;
        `;

        item.addEventListener('mouseenter', () => {
          item.style.transform = 'translateY(-1px)';
          item.style.background = 'rgba(255, 106, 193, 0.10)';
          item.style.borderColor = 'rgba(255, 106, 193, 0.25)';
        });
        item.addEventListener('mouseleave', () => {
          item.style.transform = '';
          item.style.background = 'rgba(255,255,255,0.06)';
          item.style.borderColor = 'rgba(255,255,255,0.06)';
        });

        const isActive = !!id && id === currentId;
        if (isActive) item.classList.add('active');

        item.addEventListener('click', () => ns.closePicker());
        fragment.appendChild(item);
      }
    }

    S.pickerList.replaceChildren(fragment);

    // Стили активного элемента
    S.pickerList.querySelectorAll('.luht-freezer-item.active').forEach((el) => {
      el.style.background = 'rgba(255, 106, 193, 0.20)';
      el.style.borderColor = 'rgba(255, 106, 193, 0.45)';
    });
  };

  // Подсветка активной задачи
  ns.updateActiveHighlight = function () {
    if (!S.pickerList || !S.isOpen) return;

    const currentId = ns.getTaskIdFromPath(location.pathname);
    if (!currentId) return;

    S.pickerList.querySelectorAll('.luht-freezer-item').forEach((el) => {
      const hrefAbs = normAbsHref(el.getAttribute('href') || el.href);
      const id = hrefAbs ? ns.getTaskIdFromPath(hrefAbs) : null;

      const isActive = !!id && id === currentId;
      el.classList.toggle('active', isActive);

      if (isActive) {
        el.style.background = 'rgba(255, 106, 193, 0.20)';
        el.style.borderColor = 'rgba(255, 106, 193, 0.45)';
      } else {
        el.style.background = 'rgba(255,255,255,0.06)';
        el.style.borderColor = 'rgba(255,255,255,0.06)';
      }
    });
  };

  // ============================
  //   OPEN / CLOSE / TOGGLE
  // ============================
  ns.openPicker = function () {
    if (document.hidden) return;
    if (!S.picker || !S.pickerList) return;
    if (S.isOpen) return;

    S.isOpen = true;

    S.picker.style.display = 'block';
    requestAnimationFrame(() => {
      if (!S.picker) return;
      S.picker.style.opacity = '1';
      S.picker.style.transform = 'translateY(0)';
      S.picker.style.visibility = 'visible';
    });

    // Заглушка "Загрузка..."
    const msg = document.createElement('div');
    msg.style.cssText =
      'text-align:center;padding:18px;color:rgba(255,255,255,0.65);font-size:13px;';
    msg.textContent = 'Загрузка списка...';
    S.pickerList.replaceChildren(msg);

    // Быстрый рендер текущего списка
    ns.updateTaskListSmart(S.taskList || []);
    ns.updateActiveHighlight();

    // Догрузка минимума задач (idle + timeout)
    ns.myRequestIdleCallback(
      () => {
        (async () => {
          try {
            if (!S.isOpen) return;

            const current = ns.pruneFinishedFromList(S.taskList || []);
            S.taskList = current;

            if ((S.taskList && S.taskList.length) < 5 && typeof ns.ensureTaskListMin === 'function') {
              const list = await ns.ensureTaskListMin(5);
              if (!S.isOpen) return;
              S.taskList = Array.isArray(list) ? list : [];
            }

            ns.updateTaskListSmart(S.taskList || []);
            ns.updateActiveHighlight();
          } catch {
            if (S.isOpen) {
              ns.updateTaskListSmart(S.taskList || []);
              ns.updateActiveHighlight();
            }
          }
        })();
      },
      { timeout: 150 }
    );
  };

  ns.closePicker = function () {
    if (!S.picker) return;

    S.picker.style.opacity = '0';
    S.picker.style.transform = 'translateY(20px)';

    setTimeout(() => {
      if (!S.picker) return;
      S.picker.style.display = 'none';
      S.picker.style.visibility = 'hidden';
      S.isOpen = false;
    }, 250);
  };

  ns.togglePicker = function () {
    if (typeof ns.markWorking === 'function') ns.markWorking();
    if (S.isOpen) ns.closePicker();
    else ns.openPicker();
  };
})(window.LUHT.freezer);
