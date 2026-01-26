// freezer.scheduler.js
'use strict';

(function (ns) {
  const S = ns.state;

  // ============================
  //   THROTTLED UI HELPERS
  // ============================
  // storage.js дергает ns.throttledUpdateList / ns.throttledUpdateHighlight
  if (!ns.throttledUpdateList) {
    ns.throttledUpdateList = ns.throttleTrailing((list) => {
      try {
        ns.updateTaskListSmart(list);
      } catch {}
    }, 250);
  }
  if (!ns.throttledUpdateHighlight) {
    ns.throttledUpdateHighlight = ns.throttleTrailing(() => {
      try {
        ns.updateActiveHighlight();
      } catch {}
    }, 250);
  }

  // ============================
  //   WORK / NAV
  // ============================
  ns.markWorking = function () {
    S.isWorking = true;
    clearTimeout(S.workTimer);
    S.workTimer = setTimeout(() => {
      S.isWorking = false;
    }, ns.WORK_TIMEOUT_MS);
  };

  ns.safeNavigate = function (href, { ignoreWorking = false } = {}) {
    try {
      if (S.jumpLock || (!ignoreWorking && S.isWorking)) return false;
      const url = ns.normalizeHref(href);
      if (!url) return false;

      S.jumpLock = true;
      setTimeout(() => {
        S.jumpLock = false;
      }, 2000);

      location.href = url;
      return true;
    } catch {
      return false;
    }
  };

  // ============================
  //   REFRESH / ENSURE MIN
  // ============================
  // ВАЖНО: "обновление списка во время работы" — список в памяти обновляем всегда,
  // UI трогаем только если открыт.
  ns.safeRefresh = function (forceFetch = false) {
    if (S.isRefreshing) return false;
    S.isRefreshing = true;

    const startedAt = Date.now();

    ns.myRequestIdleCallback(
      async () => {
        try {
          let list;

          // Если мы на /v2/tasks/ — берём DOM (быстрее), если не force
          if (location.pathname === '/v2/tasks/' && !forceFetch) {
            list = ns.parseTaskListFromDocument(document);
          } else {
            list = await ns.fetchTaskList(forceFetch);
          }

          list = ns.pruneFinishedFromList(list || []);

          // ОБНОВЛЯЕМ ПАМЯТЬ ВСЕГДА (даже если пусто) — иначе рефреш "как бы был", но ничего не поменял.
          if (Array.isArray(list)) {
            S.taskList = list;

            // кэш пишем только если есть что писать
            if (list.length) {
              try {
                ns.saveCache(list);
              } catch {}
            }

            // UI обновляем только когда панель открыта
            if (S.isOpen) ns.throttledUpdateList(S.taskList);
            ns.throttledUpdateHighlight();
          }
        } catch {
          // тихий fallback (не перетираем S.taskList)
        } finally {
          // защита от гонки с fallback-таймером
          if (S.isRefreshing) S.isRefreshing = false;
        }
      },
      { timeout: 300 }
    );

    // Фоллбек на случай зависания (но не сбрасываем раньше, чем успевает отработать idle)
    setTimeout(() => {
      if (S.isRefreshing && Date.now() - startedAt >= ns.REFRESH_FALLBACK_TIMEOUT) {
        S.isRefreshing = false;
      }
    }, ns.REFRESH_FALLBACK_TIMEOUT + 50);

    return true;
  };

  ns.ensureTaskListMin = async function (min = 5) {
    try {
      const currentList = ns.pruneFinishedFromList(S.taskList || []);
      S.taskList = currentList;

      if ((S.taskList && S.taskList.length) >= min) return S.taskList;

      const fetched = await ns.fetchTaskList(true);
      const pruned = ns.pruneFinishedFromList(fetched || []);
      S.taskList = Array.isArray(pruned) ? pruned : [];

      if (S.taskList.length) {
        try {
          ns.saveCache(S.taskList);
        } catch {}
      }

      return S.taskList;
    } catch {
      return ns.pruneFinishedFromList(S.taskList || []);
    }
  };

  // ============================
  //   JUMP BETWEEN TASKS
  // ============================
  ns.jumpCategory = async function (offset, retried = false) {
    ns.markWorking();
    if (S.jumpLock) return;

    try {
      if (!S.taskList || S.taskList.length === 0) return;

      const currentId = ns.getTaskIdFromPath(location.pathname);

      const goFirst = () => {
        const first = S.taskList[0];
        if (first) ns.safeNavigate(first.href, { ignoreWorking: true });
      };
      const goLast = () => {
        const last = S.taskList[S.taskList.length - 1];
        if (last) ns.safeNavigate(last.href, { ignoreWorking: true });
      };

      if (offset === 'first') return goFirst();
      if (offset === 'last') return goLast();

      let currentIndex = -1;
      for (let i = 0; i < S.taskList.length; i++) {
        const id = ns.getTaskIdFromPath(S.taskList[i].href);
        if (id && id === currentId) {
          currentIndex = i;
          break;
        }
      }

      if (currentIndex !== -1) {
        const targetIndex = currentIndex + offset;
        const target = S.taskList[targetIndex];
        if (target) ns.safeNavigate(target.href, { ignoreWorking: true });
        else goFirst();
        return;
      }

      // Если текущая задача не найдена — прыгаем в первую
      goFirst();

      // И один раз пробуем обновить список
      if (!retried) {
        setTimeout(() => {
          ns.safeRefresh(true);
        }, 120);
      }
    } catch {}
  };

  // ============================
  //   BACKGROUND
  // ============================
  const BG = {
    prune: { every: 60_000, last: 0 },
    ensureMin: { every: 60_000, last: 0 },
    rareFetch: { every: 15 * 60_000, last: 0 },
  };

  function backgroundTick() {
    const now = Date.now();

    // ВАЖНО: мы больше НЕ блокируем фон из-за S.isWorking.
    // Мы просто не трогаем UI, если закрыто, и не делаем частых force-fetch.
    if (document.hidden) return;

    // 1) чистим кэш выполненных
    if (now - BG.prune.last >= BG.prune.every) {
      BG.prune.last = now;
      try {
        ns.removeCompletedFromCache();
        if (S.taskList && S.taskList.length) {
          S.taskList = ns.pruneFinishedFromList(S.taskList);

          if (S.isOpen) ns.throttledUpdateList(S.taskList);
          ns.throttledUpdateHighlight();
        }
      } catch {}
    }

    // 2) гарантируем минимум задач (сеть можно, UI — только если открыт)
    if (now - BG.ensureMin.last >= BG.ensureMin.every) {
      BG.ensureMin.last = now;
      if ((S.taskList && S.taskList.length) < 5) {
        ns.ensureTaskListMin(5)
          .then((list) => {
            S.taskList = Array.isArray(list) ? list : [];
            if (S.isOpen) ns.throttledUpdateList(S.taskList);
            ns.throttledUpdateHighlight();
          })
          .catch(() => {});
      }
    }

    // 3) редкий принудительный рефреш
    if (now - BG.rareFetch.last >= BG.rareFetch.every) {
      BG.rareFetch.last = now;

      // force если мало задач
      const force = (S.taskList && S.taskList.length) < 5;
      ns.safeRefresh(force);
    }
  }

  let bgIntervalId = null;

  ns.startBackground = function () {
    if (bgIntervalId) return;
    bgIntervalId = setInterval(backgroundTick, 10_000);
  };

  ns.stopBackground = function () {
    if (!bgIntervalId) return;
    clearInterval(bgIntervalId);
    bgIntervalId = null;
  };

  // ============================
  //   HANDLE BACK (Prev / Review)
  // ============================
  let prevClickBlocked = false;

  ns.handleBack = function () {
    ns.markWorking();

    const heading = document.querySelector('h2');
    const text = heading ? (heading.textContent || '').toLowerCase() : '';
    const finished = /task finished|category finished|success|completed/i.test(text);

    // 1) Если finished — Back to review
    if (finished) {
      const backReviewLink =
        document.querySelector('a[href*="/queue/last/"]') ||
        Array.from(document.querySelectorAll('a')).find((a) =>
          (a.textContent || '').toLowerCase().includes('back to review')
        );

      if (backReviewLink) {
        backReviewLink.click();
        return;
      }
    }

    // 2) Обычный prev
    const prevBtn = document.querySelector('a[href$="/prev/"]');
    if (!prevBtn) return;

    // блок двойного клика
    if (prevClickBlocked) return;
    prevClickBlocked = true;
    setTimeout(() => {
      prevClickBlocked = false;
    }, 180);

    // сначала правим счётчик
    try {
      if (ns.Core) {
        ns.Core.backEvent();
        ns.Core.setAlreadyCounted(false);
      }
    } catch (e) {
      try {
        console.warn('[LUHT] backEvent failed', e);
      } catch {}
    }

    // потом навигация
    prevBtn.click();

    // UI
    if (ns.throttledUpdatePanel) ns.throttledUpdatePanel();
  };

  // ============================
  //   EVENTS: KEYBOARD
  // ============================
  document.addEventListener(
    'keydown',
    (ev) => {
      const code = ev.code;
      const key = ev.key;
      const path = location.pathname;

      // если фокус в инпутах — не перехватываем
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

      // F — открыть/закрыть список задач
      if (code === 'KeyF') {
        ev.preventDefault();
        ev.stopPropagation();
        ns.togglePicker();
        return;
      }

      // Esc — закрыть, если открыт
      if (code === 'Escape' && S.isOpen) {
        ev.preventDefault();
        ev.stopPropagation();
        ns.closePicker();
        return;
      }

      // F5 — на /v2/tasks/
      if (key === 'F5') {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          localStorage.setItem(ns.RETURN_URL_KEY, path);
        } catch {}
        location.href = '/v2/tasks/';
        return;
      }

      // R — короткое: reset speed; длинное: очистить кэш задач
      if (code === 'KeyR' && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
        if (ev.repeat) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();

        S.longRTriggered = false;
        clearTimeout(S.rTimer);

        S.rTimer = setTimeout(() => {
          S.longRTriggered = true;
          try {
            localStorage.removeItem(ns.CACHE_KEY);
            localStorage.removeItem(ns.FINISHED_KEY);
            localStorage.removeItem('luht_freezer_last_clean_ts_v1');
          } catch {}

          S.taskList = [];
          if (S.isOpen) ns.throttledUpdateList(S.taskList);
          ns.throttledUpdateHighlight();
          ns.showToast('Кеш задач очищен', 1500);
        }, 700);

        return;
      }

      // W/S или стрелки — навигация по задачам
      if (['KeyW', 'ArrowUp', 'KeyS', 'ArrowDown'].includes(code)) {
        ev.preventDefault();
        ev.stopPropagation();
        if (code === 'KeyW' || key === 'ArrowUp') ns.jumpCategory(+1);
        else ns.jumpCategory(-1);
        return;
      }

      // Home/End
      if (code === 'Home') {
        ev.preventDefault();
        ev.stopPropagation();
        ns.jumpCategory('first');
        return;
      }
      if (code === 'End') {
        ev.preventDefault();
        ev.stopPropagation();
        ns.jumpCategory('last');
        return;
      }

      // На странице списка задач — W/Up может прыгнуть в первую задачу
      if (path === '/v2/tasks/') {
        if (code === 'KeyW' || key === 'ArrowUp') {
          if (ev.repeat) {
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          ev.preventDefault();
          ev.stopPropagation();

          // Обновим список из DOM (быстро)
          const listFromDom = ns.parseTaskListFromDocument(document);
          const pruned = ns.pruneFinishedFromList(listFromDom);

          if (pruned && pruned.length) {
            S.taskList = pruned;
            try {
              ns.saveCache(pruned);
            } catch {}
          } else {
            // если DOM пуст — подстрахуемся кэшем
            let cached = null;
            try {
              cached = ns.loadCache();
            } catch {}
            if (cached) cached = ns.pruneFinishedFromList(cached);
            if (cached && cached.length) S.taskList = cached;
          }

          const first = S.taskList && S.taskList[0];
          if (first) ns.safeNavigate(first.href, { ignoreWorking: true });
        }
        return;
      }

      // Дальше — горячие клавиши на задаче
      // Q — Continue annotation
      if (code === 'KeyQ') {
        if (ev.repeat) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();

        let continueBtn = document.querySelector('a[href$="/queue/continue/"]');
        if (!continueBtn) {
          continueBtn = Array.from(document.querySelectorAll('a,button')).find(
            (el) => (el.textContent || '').trim().toLowerCase() === 'continue annotation'
          );
        }
        if (continueBtn) {
          continueBtn.focus();
          continueBtn.click();
        }
        return;
      }

      // A / Left — Prev
      if (code === 'KeyA' || key === 'ArrowLeft') {
        if (ev.repeat) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        ns.handleBack();
        return;
      }

      // D / Right — Next
      if (code === 'KeyD' || key === 'ArrowRight') {
        if (ev.repeat) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();

        const nextBtn = document.querySelector('a[href$="/next/"]:not([hidden])');
        if (nextBtn) nextBtn.click();
        return;
      }
    },
    { capture: true, passive: false }
  );

  document.addEventListener(
    'keyup',
    (ev) => {
      if (ev.code !== 'KeyR') return;

      clearTimeout(S.rTimer);
      if (!S.longRTriggered) {
        // Сброс спидометра
        try {
          if (ns.Core) {
            ns.Core.resetAll();
            ns.Core.setAlreadyCounted(false);
          }
        } catch {}
        ns.showToast('Спидометр обнулён', 1000);
      }
    },
    { capture: true }
  );

  // ============================
  //   EVENTS: CLICKS
  // ============================
  document.addEventListener(
    'click',
    (ev) => {
      // 1) закрытие панели при клике вне
      if (S.isOpen) {
        const isBtn = ev.target && ev.target.closest ? ev.target.closest('.luht-freezer-btn') : null;
        const isPanel = ev.target && ev.target.closest ? ev.target.closest('.luht-freezer-panel') : null;
        if (!isBtn && !isPanel) ns.closePicker();
      }

      // метки разметки — считаем событие
      const labelBtn = ev.target && ev.target.closest ? ev.target.closest('button[name="label"]') : null;
      if (labelBtn) {
        ns.markWorking();

        try {
          ns.showInstantLabel(labelBtn);
        } catch {}

        try {
          if (ns.Core && !ns.Core.getAlreadyCounted()) {
            ns.Core.setAlreadyCounted(true);
            ns.Core.addEvent();
            ns.Core.registerClickActivity();
          }
        } catch {}

        if (ns.throttledUpdatePanel) ns.throttledUpdatePanel();
        return;
      }
    },
    true
  );

  // цифры 0-9, - и = на странице разметки — считаем событие разметки
  document.addEventListener(
    'keydown',
    (ev) => {
      if (!/\/v2\/task\/.+\/queue\//.test(location.pathname)) return;

      const key = ev.key;
      const isNumberKey = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='].includes(key);
      if (!isNumberKey) return;

      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;

      ns.markWorking();
      try {
        if (ns.Core && !ns.Core.getAlreadyCounted()) {
          ns.Core.setAlreadyCounted(true);
          ns.Core.addEvent();
          ns.Core.registerClickActivity();
        }
      } catch {}

      if (ns.throttledUpdatePanel) ns.throttledUpdatePanel();
    },
    true
  );

  // ============================
  //   VISIBILITY
  // ============================
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ns.stopBackground();
    else ns.startBackground();
  });
})(window.LUHT.freezer);
