'use strict';

(function () {
  // Защита от двойной загрузки (чтобы не плодить таймеры)
  if (window.__luht_core_v2_loaded) return;
  window.__luht_core_v2_loaded = true;

  // ============================
  //   STORAGE KEYS
  // ============================
  const STORAGE_TS = 'luhtV2_timestamps';
  const STORAGE_TOTAL = 'luhtV2_total';
  const STORAGE_ACTIVE = 'luhtV2_active';
  const STORAGE_TOTALTIME = 'luhtV2_totaltime';
  const STORAGE_TOTALSTART = 'luhtV2_totalstart';
  const STORAGE_STREAK_CUR = 'luhtV2_streak_cur';
  const STORAGE_STREAK_BEST = 'luhtV2_streak_best';
  const STORAGE_LAST_CLICK = 'luhtV2_lastclick_ts';

  // 30 минут "пустого" времени = авто-сброс
  const IDLE_RESET_THRESHOLD_MS = 30 * 60 * 1000;

  // Пауза если не было активности 10 секунд
  const PAUSE_AFTER_NO_CLICK_MS = 10_000;

  // Счётчики скорости считаем по последнему часу
  const WINDOW_60M = 3_600_000;

  // Тик основного цикла (лёгкий)
  const TICK_MS = 1000;

  // ============================
  //   RUNTIME STATE
  // ============================
  let timestamps = [];
  let totalCount = 0;
  let activeTimeMs = 0;

  let totalTimeStart = parseInt(localStorage.getItem(STORAGE_TOTALSTART) || '0', 10) || 0;
  let totalTimeMs = parseInt(localStorage.getItem(STORAGE_TOTALTIME) || '0', 10) || 0;

  let lastActiveTS = Date.now();
  let lastClickTS = parseInt(localStorage.getItem(STORAGE_LAST_CLICK) || '0', 10) || 0;

  let streakMs = parseInt(localStorage.getItem(STORAGE_STREAK_CUR) || '0', 10) || 0;
  let bestStreakMs = parseInt(localStorage.getItem(STORAGE_STREAK_BEST) || '0', 10) || 0;

  let boostActive = false;
  let warningActive = false;
  let wasHighTempo = false;
  let lowTempoSince = 0;
  let paused = true;

  let alreadyCounted = false;

  // ============================
  //   LOAD
  // ============================
  try {
    timestamps = JSON.parse(localStorage.getItem(STORAGE_TS) || '[]');
    if (!Array.isArray(timestamps)) timestamps = [];
  } catch {
    timestamps = [];
  }

  totalCount = parseInt(localStorage.getItem(STORAGE_TOTAL) || '0', 10) || 0;
  activeTimeMs = parseInt(localStorage.getItem(STORAGE_ACTIVE) || '0', 10) || 0;

  // Нормализуем timestamps (на всякий)
  timestamps = timestamps
    .map((x) => (typeof x === 'number' ? x : parseInt(x, 10)))
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);

  // ============================
  //   SAVE (с троттлингом)
  // ============================
  let lastPersistTS = Date.now();

  function saveInternal() {
    try {
      localStorage.setItem(STORAGE_TS, JSON.stringify(timestamps));
      localStorage.setItem(STORAGE_TOTAL, String(totalCount));
      localStorage.setItem(STORAGE_ACTIVE, String(activeTimeMs));
      localStorage.setItem(STORAGE_TOTALTIME, String(totalTimeMs));
      localStorage.setItem(STORAGE_TOTALSTART, String(totalTimeStart));
      localStorage.setItem(STORAGE_STREAK_CUR, String(streakMs));
      localStorage.setItem(STORAGE_STREAK_BEST, String(bestStreakMs));
      localStorage.setItem(STORAGE_LAST_CLICK, String(lastClickTS || 0));
    } catch (e) {
      // Не спамим
      try { console.warn('localStorage save failed:', e); } catch {}
    }
  }

  function maybePersist(now, force = false) {
    if (force) {
      lastPersistTS = now;
      saveInternal();
      return;
    }
    if (now - lastPersistTS >= 15000) {
      lastPersistTS = now;
      saveInternal();
    }
  }

  window.addEventListener('beforeunload', () => {
    maybePersist(Date.now(), true);
  });

  document.addEventListener('visibilitychange', () => {
    // при уходе в фон — сразу сохраняем (чтобы не терять)
    if (document.hidden) {
      maybePersist(Date.now(), true);
    } else {
      // при возвращении — корректируем lastActiveTS, чтобы не прибавлять гигантский delta
      lastActiveTS = Date.now();
    }
  });

  // ============================
  //   CORE OPERATIONS
  // ============================
  function registerClickActivity() {
    const now = Date.now();
    lastClickTS = now;

    if (totalTimeStart === 0) {
      totalTimeStart = now;
      totalTimeMs = 0;
      maybePersist(now, true); // первый клик — force
    }
  }

  function addEvent() {
    const now = Date.now();
    timestamps.push(now);
    totalCount++;

    // лимит по памяти
    if (timestamps.length > 12000) {
      timestamps.splice(0, timestamps.length - 10000);
    }

    registerClickActivity();
  }

  function backEvent() {
    const now = Date.now();
    if (timestamps.length) timestamps.pop();
    if (totalCount > 0) totalCount--;
    maybePersist(now, true);
  }

  function resetAll() {
    timestamps = [];
    totalCount = 0;
    activeTimeMs = 0;
    totalTimeMs = 0;
    totalTimeStart = 0;
    streakMs = 0;
    bestStreakMs = 0;
    boostActive = false;
    warningActive = false;
    wasHighTempo = false;
    lowTempoSince = 0;
    paused = true;
    alreadyCounted = false;
    lastClickTS = 0;
    lastActiveTS = Date.now();

    try {
      localStorage.removeItem(STORAGE_TS);
      localStorage.removeItem(STORAGE_TOTAL);
      localStorage.removeItem(STORAGE_ACTIVE);
      localStorage.removeItem(STORAGE_TOTALTIME);
      localStorage.removeItem(STORAGE_TOTALSTART);
      localStorage.removeItem(STORAGE_STREAK_CUR);
      localStorage.removeItem(STORAGE_STREAK_BEST);
      localStorage.removeItem(STORAGE_LAST_CLICK);
    } catch (e) {
      try { console.warn('localStorage clear failed:', e); } catch {}
    }
  }

  // ============================
  //   COUNT HELPERS (бинарный поиск)
  // ============================
  function countIn(msWindow, now) {
    const cutoff = now - msWindow;

    let left = 0;
    let right = timestamps.length;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (timestamps[mid] >= cutoff) right = mid;
      else left = mid + 1;
    }
    return timestamps.length - left;
  }

  // чистим только раз в 20 секунд
  let lastPruneTS = 0;
  function pruneOld(now) {
    if (now - lastPruneTS < 20000) return;
    lastPruneTS = now;

    const cutoff = now - WINDOW_60M;
    let idx = 0;
    while (idx < timestamps.length && timestamps[idx] < cutoff) idx++;
    if (idx > 0) timestamps.splice(0, idx);
  }

  function formatDuration(ms) {
    if (!ms || ms <= 0) return '0 сек';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts = [];
    if (h) parts.push(h + ' ч');
    if (m) parts.push(m + ' мин');
    parts.push(s + ' сек');
    return parts.join(' ');
  }

  function getState() {
    const now = Date.now();
    pruneOld(now);

    const c1 = countIn(60_000, now);
    const c5 = countIn(300_000, now);
    const c15 = countIn(900_000, now);
    const c60 = countIn(WINDOW_60M, now);

    return {
      totalCount,
      c1, c5, c15, c60,
      activeTimeMs,
      totalTimeMs,
      streakMs,
      bestStreakMs,
      boost: boostActive,
      warning: warningActive,
      paused
    };
  }

  // ============================
  //   MAIN TICK (без DOM, без ImageTurbo)
  // ============================
  function tick() {
    try {
      const now = Date.now();
      let delta = now - lastActiveTS;
      lastActiveTS = now;

      // защита от огромных скачков (сон/переключение вкладки)
      if (delta < 0) delta = 0;
      if (delta > 30_000) delta = 0;

      pruneOld(now);

      const isPaused =
        (totalTimeStart === 0) ||
        document.hidden ||
        (now - lastClickTS > PAUSE_AFTER_NO_CLICK_MS);

      paused = isPaused;

      if (!isPaused && delta > 0) {
        activeTimeMs += delta;
      }

      if (totalTimeStart > 0) {
        totalTimeMs = now - totalTimeStart;
      }

      // Авто-ресет при долгом простое
      const idleGap = totalTimeMs - activeTimeMs;
      if (idleGap > IDLE_RESET_THRESHOLD_MS) {
        resetAll();
        return;
      }

      // Скорости
      const c1 = countIn(60_000, now);
      const c20 = countIn(20_000, now);

      // Стрик
      if (!isPaused && c1 >= 80) {
        streakMs += delta;
        if (streakMs > bestStreakMs) bestStreakMs = streakMs;
      } else if (!isPaused) {
        streakMs = 0;
      }

      // Буст (гистерезис)
      if (!isPaused) {
        if (c20 >= 30) boostActive = true;
        else if (c20 <= 28) boostActive = false;
      } else {
        boostActive = false;
      }

      // Warning
      if (!isPaused) {
        if (c1 >= 80) {
          wasHighTempo = true;
          lowTempoSince = 0;
          warningActive = false;
        } else if (c1 < 70 && wasHighTempo) {
          if (!lowTempoSince) lowTempoSince = now;
          if (now - lowTempoSince >= 3000) warningActive = true;
        } else {
          lowTempoSince = 0;
          warningActive = false;
        }
      } else {
        wasHighTempo = false;
        lowTempoSince = 0;
        warningActive = false;
      }

      maybePersist(now, false);
    } catch (e) {
      try { console.error('core tick error:', e); } catch {}
    }
  }

  // Один лёгкий интервал — и всё.
  setInterval(tick, TICK_MS);

  // ============================
  //   OPTIONAL HOOKS (для ui/freezer)
  // ============================
  function notifySwap() {
    // когда htmx свапнул новую задачу/картинку — ui/freezer может вызвать это
    alreadyCounted = false;
  }

  // ============================
  //   EXPORT
  // ============================
  window.LuhtSpeedCore = {
    addEvent,
    backEvent,
    resetAll,
    getState,
    formatDuration,
    getAlreadyCounted: () => alreadyCounted,
    setAlreadyCounted: (v) => { alreadyCounted = !!v; },
    registerClickActivity,
    notifySwap
  };
})();
