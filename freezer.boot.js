// freezer.boot.js
(function (ns) {
  'use strict';

  const S = ns.state;

  // ============================
  //   CORE GUARD
  // ============================
  if (!window.LuhtSpeedCore) {
    try { console.warn('LuhtSpeedCore not found, aborting freezer initialization.'); } catch {}
    return;
  }
  ns.Core = window.LuhtSpeedCore;
  const Core = ns.Core;

  if (S.__booted) return;
  S.__booted = true;

  // ============================
  //   PANEL UI (SPEEDOMETER)
  // ============================
  const panel = document.createElement('div');
  panel.className = 'luht-panel';
  panel.style.visibility = 'hidden';
  document.documentElement.appendChild(panel);

  const header = document.createElement('div');
  header.className = 'luht-header';
  panel.appendChild(header);

  const title = document.createElement('div');
  title.className = 'luht-title';
  title.textContent = 'LUHT SPEED V2';
  header.appendChild(title);

  const boostBadge = document.createElement('span');
  boostBadge.className = 'luht-boost-badge';
  boostBadge.textContent = '⚡ BOOST';
  boostBadge.style.display = 'none';
  title.appendChild(boostBadge);

  const rows = document.createElement('div');
  panel.appendChild(rows);

  const makeRow = (label) => {
    const row = document.createElement('div');
    row.className = 'luht-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'luht-row-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'luht-row-value';
    valueEl.textContent = '0';

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    rows.appendChild(row);

    return { row, value: valueEl };
  };

  const rTotal     = makeRow('Всего');
  const r1m        = makeRow('За 1 мин');
  const r5m        = makeRow('За 5 мин');
  const r15m       = makeRow('За 15 мин');
  const r60m       = makeRow('За 60 мин');
  const rStreak    = makeRow('Серия > 80/мин');
  const rBest      = makeRow('Лучшая серия');
  const rActive    = makeRow('Активное');
  const rTotalTime = makeRow('Общее время');
  const rStatus    = makeRow('Статус');

  // Turbo toggle inside panel
  try { ns.createTurboToggle(rows); } catch (e) {}

  // ============================
  //   SPEED COLOR
  // ============================
  let lastSpeedClass = null;
  function updateSpeedColor(speed) {
    const el = r1m.row;
    if (!el) return;

    let cls = null;
    if (speed >= 110) cls = 'speed-110';
    else if (speed >= 100) cls = 'speed-100';
    else if (speed >= 90) cls = 'speed-90';
    else if (speed >= 80) cls = 'speed-80';

    if (cls === lastSpeedClass) return;

    el.classList.remove('speed-80', 'speed-90', 'speed-100', 'speed-110');
    if (cls) el.classList.add(cls);
    lastSpeedClass = cls;
  }

  // ============================
  //   PANEL UPDATE (FAST + DIFF)
  // ============================
  let lastStateSnapshot = '';
  ns.updatePanel = function (force = false) {
    const st = Core.getState();

    const snapshot = [
      st.totalCount, st.c1, st.c5, st.c15, st.c60,
      st.streakMs, st.bestStreakMs,
      st.warning ? 1 : 0, st.boost ? 1 : 0, st.paused ? 1 : 0,
    ].join('|');

    if (!force && snapshot === lastStateSnapshot) return;
    lastStateSnapshot = snapshot;

    ns.setTextIfChanged(rTotal.value, st.totalCount);
    ns.setTextIfChanged(r1m.value, st.c1);
    ns.setTextIfChanged(r5m.value, st.c5);
    ns.setTextIfChanged(r15m.value, st.c15);
    ns.setTextIfChanged(r60m.value, st.c60);

    ns.setTextIfChanged(
      rStreak.value,
      st.streakMs > 0 ? Core.formatDuration(st.streakMs) : '—'
    );
    ns.setTextIfChanged(
      rBest.value,
      st.bestStreakMs > 0 ? Core.formatDuration(st.bestStreakMs) : '—'
    );

    r1m.row.classList.toggle('luht-row-minute-good', st.c1 >= 100);
    r1m.row.classList.toggle('luht-row-minute-bad', st.c1 >= 90 && st.c1 < 100);
    r1m.row.classList.toggle('luht-row-minute-ok', st.c1 >= 80 && st.c1 < 90);
    r1m.row.classList.toggle('luht-row-warning', !!st.warning);

    boostBadge.style.display = st.boost ? '' : 'none';
    panel.classList.toggle('luht-panel-paused', !!st.paused);

    ns.setTextIfChanged(
      rStatus.value,
      st.paused ? 'Пауза… кликни метку' : (st.boost ? '⚡ Ускоренный режим' : 'Работаю')
    );

    updateSpeedColor(st.c1);
  };

  ns.throttledUpdatePanel = ns.throttleTrailing(ns.updatePanel, 200);

  // ============================
  //   LAST LABEL BADGE
  // ============================
  ns.ensureLabelBadge = function () {
    if (!S.labelSection || !document.body.contains(S.labelSection)) {
      S.labelSection = document.querySelector('#ticktock section.h-full');
    }
    if (!S.labelSection) return null;

    if (!S.labelBadge || !S.labelSection.contains(S.labelBadge)) {
      S.labelBadge = document.createElement('div');
      S.labelBadge.className = 'luht-last-label';
      S.labelSection.appendChild(S.labelBadge);
    }
    return S.labelBadge;
  };

  ns.updateLastLabelBadge = function () {
    if (!/\/v2\/task\/.+\/queue\//.test(location.pathname)) {
      if (S.labelBadge) S.labelBadge.classList.remove('show');
      S.lastBadgeVisible = false;
      return;
    }

    const badge = ns.ensureLabelBadge();
    if (!badge) return;

    const selectedBtn = document.querySelector('aside button[name="label"][aria-selected="true"]');
    if (!selectedBtn) {
      if (S.lastBadgeVisible) badge.classList.remove('show');
      S.lastBadgeVisible = false;
      return;
    }

    const fullText = (selectedBtn.textContent || '').trim();
    const text = fullText.includes('.') ? fullText : `Метка: ${fullText}`;

    if (text !== S.lastBadgeText || !S.lastBadgeVisible) {
      ns.setTextIfChanged(badge, text);
      badge.classList.add('show');
      S.lastBadgeText = text;
      S.lastBadgeVisible = true;
    }
  };

  ns.showInstantLabel = function (btn) {
    if (!btn) return;

    const badge = ns.ensureLabelBadge();
    if (!badge) return;

    const fullText = (btn.textContent || '').trim();
    const text = fullText.includes('.') ? fullText : `Метка: ${fullText}`;

    ns.setTextIfChanged(badge, text);
    badge.style.display = 'block';
    badge.style.opacity = '1';

    setTimeout(() => {
      badge.style.opacity = '0';
      setTimeout(() => {
        if (!S.lastBadgeVisible) badge.style.display = 'none';
      }, 250);
    }, 1200);
  };

  // ============================
  //   LOOPS (UI + TIME)
  // ============================
  let loopsStarted = false;
  let uiIntervalId = null;
  let timeIntervalId = null;

  function tickTimeOnce() {
    const st = Core.getState();
    ns.setTextIfChanged(rActive.value, Core.formatDuration(st.activeTimeMs));
    ns.setTextIfChanged(rTotalTime.value, Core.formatDuration(st.totalTimeMs));
  }

  function startLoops() {
    if (loopsStarted) return;
    loopsStarted = true;

    // Время обновляем раз в секунду
    tickTimeOnce();
    timeIntervalId = setInterval(() => {
      if (document.hidden) return;
      tickTimeOnce();
    }, 1000);

    // UI (панель + бейдж) — ~5 раз/сек, но только если это имеет смысл
    uiIntervalId = setInterval(() => {
      if (document.hidden) return;
      if (S.isWorking) return; // пользователь кликает/переходит — не мешаем
      ns.throttledUpdatePanel();
      ns.updateLastLabelBadge();
    }, 200);
  }

  function stopLoops() {
    if (timeIntervalId) { clearInterval(timeIntervalId); timeIntervalId = null; }
    if (uiIntervalId) { clearInterval(uiIntervalId); uiIntervalId = null; }
    loopsStarted = false;
  }

  // при уходе/возврате вкладки: экономим
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoops();
    else startLoops();
  });

  // ============================
  //   ACTIVATE AFTER LOAD (LCP-ish)
  // ============================
  let activated = false;

  function activateFullUI() {
    if (activated) return;
    activated = true;

    document.documentElement.classList.add('lcp-done');
    panel.style.visibility = 'visible';

    if (S.picker) S.picker.style.visibility = 'visible';

    // Фоновые процессы у тебя стартуют в scheduler.startBackground(),
    // но loops UI — здесь.
    startLoops();
  }

  // PerformanceObserver (если доступен)
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // достаточно факта LCP-энтри
        if (entry) {
          activateFullUI();
          try { lcpObserver.disconnect(); } catch {}
          break;
        }
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}

  // Фоллбек: ждём картинку, либо таймер
  (function lcpFallback() {
    if (activated) return;
    const img = document.querySelector('img[alt="Image to annotate"]');
    if (img && img.complete && img.naturalHeight > 0) activateFullUI();
    else requestAnimationFrame(lcpFallback);
  })();

  setTimeout(() => {
    if (!activated) activateFullUI();
  }, 3000);

  // ============================
  //   HTMX AFTER SWAP
  // ============================
  function setupHtmxListener() {
    if (S.__htmxListener) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', setupHtmxListener, { once: true });
      return;
    }
    S.__htmxListener = true;

    document.body.addEventListener('htmx:afterSwap', () => {
      ns.markWorking();

      try { ns.Core.setAlreadyCounted(false); } catch {}
      try { if (ns.Core.notifySwap) ns.Core.notifySwap(); } catch {}

      S.currentImg = null;
      try { ns.applyImageTurbo(); } catch {}

      // Если URL показывает "задача завершена" — отметим и подчистим
      const finishedAdded = ns.markFinishedFromUrl();
      if (finishedAdded) {
        try { ns.removeCompletedFromCache(); } catch {}

        S.taskList = ns.pruneFinishedFromList(S.taskList || []);
        if (S.taskList.length) ns.saveCache(S.taskList);

        if (S.isOpen && ns.throttledUpdateList) ns.throttledUpdateList(S.taskList);
        if (ns.throttledUpdateHighlight) ns.throttledUpdateHighlight();

        // Если задач мало — дотягиваем минимум
        if ((S.taskList?.length || 0) < 5) {
          ns.ensureTaskListMin(5).then((list) => {
            S.taskList = list || [];
            if (S.taskList.length) ns.saveCache(S.taskList);
            if (S.isOpen && ns.throttledUpdateList) ns.throttledUpdateList(S.taskList);
            if (ns.throttledUpdateHighlight) ns.throttledUpdateHighlight();
          }).catch(() => {});
        }
      }

      // Если мы на странице списка задач — парсим DOM сразу
      if (location.pathname === '/v2/tasks/') {
        const listFromDom = ns.parseTaskListFromDocument(document);
        const pruned = ns.pruneFinishedFromList(listFromDom);
        if (Array.isArray(pruned) && pruned.length) {
          S.taskList = pruned;
          ns.saveCache(pruned);
          if (S.isOpen && ns.throttledUpdateList) ns.throttledUpdateList(pruned);
          if (ns.throttledUpdateHighlight) ns.throttledUpdateHighlight();
        }
      }

      ns.throttledUpdatePanel(true);
      ns.updateLastLabelBadge();

      S.firstSwapDone = true;
      if (S.listBuilt && S.firstSwapDone) S.listReady = true;
    });
  }
  setupHtmxListener();

  // ============================
  //   INIT
  // ============================
  ns.init = async function () {
    if (S.__initStarted) return;
    S.__initStarted = true;

    // 1) подчистим кэш от выполненных
    try { ns.removeCompletedFromCache(); } catch {}

    // 2) UI списка задач
    try { ns.createFreezerUI(); } catch {}

    // 3) базово применим turbo на текущую картинку (если включено)
    try { ns.applyImageTurbo(); } catch {}

    // 4) загрузка taskList
    let list = null;

    try {
      list = ns.loadCache();
      if (list) list = ns.pruneFinishedFromList(list);

      if (!list || list.length < 5) {
        if (location.pathname === '/v2/tasks/') {
          list = ns.parseTaskListFromDocument(document);
        } else {
          list = await ns.fetchTaskList(true);
        }
      }
    } catch (e) {}

    list = ns.pruneFinishedFromList(list || []) || [];
    S.taskList = list;

    if (S.taskList.length) {
      try { ns.saveCache(S.taskList); } catch {}
    }

    // UI обновляем только если панель реально открыта
    try { ns.updateTaskListSmart(S.taskList); } catch {}
    try { ns.updateActiveHighlight(); } catch {}

    // 5) flags ready
    const hasRealHtmx = !!document.querySelector('[hx-get]');
    if (!hasRealHtmx) S.firstSwapDone = true;
    S.listBuilt = true;
    if (S.listBuilt && S.firstSwapDone) S.listReady = true;

    // 6) через 100мс ещё раз добьём минимум (без агрессии)
    setTimeout(() => {
      if ((S.taskList?.length || 0) < 5) {
        ns.ensureTaskListMin(5).then((newList) => {
          S.taskList = newList || [];
          if (S.taskList.length) ns.saveCache(S.taskList);
          if (S.isOpen && ns.throttledUpdateList) ns.throttledUpdateList(S.taskList);
          if (ns.throttledUpdateHighlight) ns.throttledUpdateHighlight();
        }).catch(() => {});
      }
    }, 100);
  };

  // DOM ready
  document.addEventListener('DOMContentLoaded', async () => {
    await ns.init();

    // Если уже на finished URL — обработаем
    if (ns.markFinishedFromUrl()) {
      try { ns.removeCompletedFromCache(); } catch {}
      S.taskList = ns.pruneFinishedFromList(S.taskList || []);
      if (S.taskList.length) ns.saveCache(S.taskList);

      if (S.isOpen && ns.throttledUpdateList) ns.throttledUpdateList(S.taskList);
      if (ns.throttledUpdateHighlight) ns.throttledUpdateHighlight();

      if ((S.taskList?.length || 0) < 5) {
        try {
          const newList = await ns.ensureTaskListMin(5);
          S.taskList = newList || [];
          if (S.taskList.length) ns.saveCache(S.taskList);
          if (S.isOpen && ns.throttledUpdateList) ns.throttledUpdateList(S.taskList);
          if (ns.throttledUpdateHighlight) ns.throttledUpdateHighlight();
        } catch (e) {}
      }
    }

    // Первичное обновление UI
    ns.updatePanel(true);
    ns.updateLastLabelBadge();
  });

})(window.LUHT.freezer);
