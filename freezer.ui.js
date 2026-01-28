// freezer.ui.js
'use strict';

(function (ns) {
  const S = ns.state;

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
    const root = document.documentElement || document;
    if (S.pickerButton && root.contains(S.pickerButton)) return;
    if (S.picker && root.contains(S.picker)) return;

    // Button
    const btn = document.createElement('button');
    btn.className = 'luht-freezer-btn';
    btn.type = 'button';
    btn.textContent = '📋';
    btn.title = 'Открыть список задач (F)';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ns.togglePicker();
    });
    safeAppendToRoot(btn);
    S.pickerButton = btn;

    // Panel
    const panel = document.createElement('div');
    panel.className = 'luht-freezer-panel';
    panel.setAttribute('hx-preserve', '');
    panel.setAttribute('aria-hidden', 'true');

    const header = document.createElement('div');
    header.className = 'luht-freezer-header';
    header.textContent = 'СПИСОК ЗАДАЧ';
    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'luht-freezer-list';
    panel.appendChild(list);

    // hidden by default: управляем классом is-open, а не inline
    safeAppendToRoot(panel);

    S.picker = panel;
    S.pickerList = list;
  };

  // ============================
  //   LIST RENDER (SMART)
  // ============================
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
      if (!item) {
        item = document.createElement('a');
        item.className = 'luht-freezer-item';
        item.setAttribute('data-key', key);
        item.addEventListener('click', () => ns.closePicker());
      }

      // sync href + text
      if (item.href !== hrefAbs) item.href = hrefAbs;
      ns.setTextIfChanged(item, (t && t.title) || hrefAbs);

      // active
      const isActive = !!id && id === currentId;
      item.classList.toggle('active', isActive);

      fragment.appendChild(item);
    }

    S.pickerList.replaceChildren(fragment);
  };

  ns.updateActiveHighlight = function () {
    if (!S.pickerList || !S.isOpen) return;

    const currentId = ns.getTaskIdFromPath(location.pathname);
    if (!currentId) return;

    S.pickerList.querySelectorAll('.luht-freezer-item').forEach((el) => {
      const hrefAbs = normAbsHref(el.getAttribute('href') || el.href);
      const id = hrefAbs ? ns.getTaskIdFromPath(hrefAbs) : null;
      el.classList.toggle('active', !!id && id === currentId);
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
    S.picker.classList.add('is-open');
    S.picker.setAttribute('aria-hidden', 'false');

    // Заглушка
    const msg = document.createElement('div');
    msg.className = 'luht-freezer-empty';
    msg.textContent = 'Загрузка списка...';
    S.pickerList.replaceChildren(msg);

    ns.updateTaskListSmart(S.taskList || []);
    ns.updateActiveHighlight();

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

    S.picker.classList.remove('is-open');
    S.picker.setAttribute('aria-hidden', 'true');

    // важно: даём CSS анимации отыграть (если .lcp-done), но state закрываем сразу
    S.isOpen = false;
  };

  ns.togglePicker = function () {
    if (typeof ns.markWorking === 'function') ns.markWorking();
    if (S.isOpen) ns.closePicker();
    else ns.openPicker();
  };
})(window.LUHT.freezer);
