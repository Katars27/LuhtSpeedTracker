'use strict';

(function () {
  // ============================
  //   STORAGE KEYS
  // ============================
  const STORAGE_TS          = 'luhtV2_timestamps';
  const STORAGE_TOTAL       = 'luhtV2_total';
  const STORAGE_ACTIVE      = 'luhtV2_active';
  const STORAGE_TOTALTIME   = 'luhtV2_totaltime';
  const STORAGE_TOTALSTART  = 'luhtV2_totalstart';
  const STORAGE_STREAK_CUR  = 'luhtV2_streak_cur';
  const STORAGE_STREAK_BEST = 'luhtV2_streak_best';
  const STORAGE_LAST_CLICK  = 'luhtV2_lastclick_ts';

  const IDLE_RESET_THRESHOLD_MS = 30 * 60 * 1000; // 30 минут

  // ============================
  //   RUNTIME STATE
  // ============================
  let timestamps   = [];
  let totalCount   = 0;
  let activeTimeMs = 0;

  let totalTimeStart = parseInt(localStorage.getItem(STORAGE_TOTALSTART) || '0', 10) || 0;
  let totalTimeMs    = parseInt(localStorage.getItem(STORAGE_TOTALTIME)  || '0', 10) || 0;

  let lastActiveTS = Date.now();
  let lastClickTS  = parseInt(localStorage.getItem(STORAGE_LAST_CLICK) || '0', 10) || 0;

  let streakMs      = parseInt(localStorage.getItem(STORAGE_STREAK_CUR)  || '0', 10) || 0;
  let bestStreakMs  = parseInt(localStorage.getItem(STORAGE_STREAK_BEST) || '0', 10) || 0;
  let boostActive   = false;
  let warningActive = false;
  let wasHighTempo  = false;
  let lowTempoSince = 0;
  let paused        = true;

  let alreadyCounted  = false;
  let lastImgSrc      = null;
  let lastImgCheckTS  = 0;
  let imgEl           = null;

  // Загрузка данных
  try {
    timestamps = JSON.parse(localStorage.getItem(STORAGE_TS) || '[]');
    if (!Array.isArray(timestamps)) timestamps = [];
  } catch {
    timestamps = [];
  }
  totalCount   = parseInt(localStorage.getItem(STORAGE_TOTAL)  || '0', 10) || 0;
  activeTimeMs = parseInt(localStorage.getItem(STORAGE_ACTIVE) || '0', 10) || 0;

  // ============================
  //   SAVE (с троттлингом)
  // ============================
  let lastPersistTS = Date.now();

  function saveInternal() {
    try {
      localStorage.setItem(STORAGE_TS,          JSON.stringify(timestamps));
      localStorage.setItem(STORAGE_TOTAL,       String(totalCount));
      localStorage.setItem(STORAGE_ACTIVE,      String(activeTimeMs));
      localStorage.setItem(STORAGE_TOTALTIME,   String(totalTimeMs));
      localStorage.setItem(STORAGE_TOTALSTART,  String(totalTimeStart));
      localStorage.setItem(STORAGE_STREAK_CUR,  String(streakMs));
      localStorage.setItem(STORAGE_STREAK_BEST, String(bestStreakMs));
      localStorage.setItem(STORAGE_LAST_CLICK,  String(lastClickTS || 0));
    } catch (e) {
      console.warn('localStorage save failed:', e);
    }
  }

  // Сохраняем не чаще, чем раз в 15 секунд (или принудительно)
  function maybePersist(now, force = false) {
    if (force) {
      lastPersistTS = now;
      saveInternal();
      return;
    }
    if (now - lastPersistTS >= 15000) { // ← было 8000 → 15000 мс
      lastPersistTS = now;
      saveInternal();
    }
  }

  // При выгрузке страницы — принудительно сохраняем
  window.addEventListener('beforeunload', () => {
    maybePersist(Date.now(), true);
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
      maybePersist(now, true); // только первый клик — force
    }
  }

  function addEvent() {
    const now = Date.now();
    timestamps.push(now);
    totalCount++;

    // Жёсткий лимит: не больше 12000 элементов
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
    timestamps      = [];
    totalCount      = 0;
    activeTimeMs    = 0;
    totalTimeMs     = 0;
    totalTimeStart  = 0;
    streakMs        = 0;
    bestStreakMs    = 0;
    boostActive     = false;
    warningActive   = false;
    wasHighTempo    = false;
    lowTempoSince   = 0;
    paused          = true;
    alreadyCounted  = false;
    lastClickTS     = 0;
    lastImgSrc      = null;
    imgEl           = null;
    lastActiveTS    = Date.now();

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
      console.warn('localStorage clear failed:', e);
    }
  }

  // ============================
  //   COUNT HELPERS (оптимизировано бинарным поиском)
  // ============================
  function countIn(msWindow, now) {
    const cutoff = now - msWindow;

    // Бинарный поиск первого индекса >= cutoff
    let left = 0;
    let right = timestamps.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (timestamps[mid] >= cutoff) {
        right = mid;
      } else {
        left = mid + 1;
      }
    }

    return timestamps.length - left;
  }

  let lastPruneTS = 0;
  function pruneOldExact(now) {
    if (now - lastPruneTS < 20000) return; // Увеличено до 20000ms для снижения нагрузки
    lastPruneTS = now;

    const cutoff = now - 3_600_000; // 1 час
    let idx = 0;
    while (idx < timestamps.length && timestamps[idx] < cutoff) {
      idx++;
    }
    if (idx > 0) {
      timestamps.splice(0, idx);
    }
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
    pruneOldExact(now);

    const c1  = countIn(60_000, now);
    const c5  = countIn(300_000, now);
    const c15 = countIn(900_000, now);
    const c60 = countIn(3_600_000, now);

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
  //   MAIN LOOP (объединённый active + monitor) — Оптимизировано
  // ============================
  let lastMainLoopTS = 0;
  const MAIN_LOOP_THROTTLE_MS = 5000; // Увеличено до 5000ms для снижения нагрузки

  function mainLoop() {
    try {
      const now = Date.now();

      // Если вкладка в фоне — пропускаем всю работу
      if (document.hidden) {
        requestAnimationFrame(mainLoop);
        return;
      }

      // Throttle: не выполняем работу чаще, чем раз в 5 секунд
      if (now - lastMainLoopTS < MAIN_LOOP_THROTTLE_MS) {
        requestAnimationFrame(mainLoop);
        return;
      }
      lastMainLoopTS = now;

      const delta = now - lastActiveTS;
      lastActiveTS = now;

      // --- Image change detection (throttle + hidden check) ---
      if (!document.hidden) {
        const img = imgEl && document.body.contains(imgEl)
          ? imgEl
          : document.querySelector('img[alt="Image to annotate"]');

        if (img) {
          imgEl = img;
          const src = img.currentSrc || img.src;
          if (src && src !== lastImgSrc && now - lastImgCheckTS > 100) { // ← было 40 → 100 мс
            lastImgSrc = src;
            lastImgCheckTS = now;
            alreadyCounted = false;
            webpLogShown = false;
            optimizeLCPImageWithWebP();
          }
        }
      }

      // --- Active time / pause logic ---
      pruneOldExact(now);

      const isPaused =
        (totalTimeStart === 0) ||
        document.hidden ||
        (now - lastClickTS > 10000); // Увеличено до 10000ms (10 сек) для снижения ложных пауз

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
        requestAnimationFrame(mainLoop);
        return;
      }

      // Скорости
      const c1  = countIn(60_000, now);
      const c20 = countIn(20_000, now);

      // Стрик
      if (!isPaused && c1 >= 80) {
        streakMs += delta;
        if (streakMs > bestStreakMs) bestStreakMs = streakMs;
      } else if (!isPaused) {
        streakMs = 0;
      }

      // Буст
      if (!isPaused) {
        if (c20 >= 30) {
          boostActive = true;
        } else if (c20 <= 28) {
          boostActive = false;
        }
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
          if (now - lowTempoSince >= 3000) {
            warningActive = true;
          }
        } else {
          lowTempoSince = 0;
          warningActive = false;
        }
      } else {
        wasHighTempo = false;
        lowTempoSince = 0;
        warningActive = false;
      }

      // Периодическое сохранение (не force)
      maybePersist(now, false);
    } catch (e) {
      console.error('mainLoop error:', e);
    }

    // Используем requestIdleCallback, если доступен (более щадящий для рендера)
    if ('requestIdleCallback' in window) {
      requestIdleCallback(mainLoop);
    } else {
      requestAnimationFrame(mainLoop);
    }
  }

  // Запускаем loop
  if ('requestIdleCallback' in window) {
    requestIdleCallback(mainLoop);
  } else {
    requestAnimationFrame(mainLoop);
  }

  // =====================================================
// IMAGE TURBO: WebP-сжатие изображений для ускорения загрузки
// Активируется только если включено в панели (localStorage)
// =====================================================
let webpLogShown = false;

function optimizeLCPImageWithWebP() {
  if (localStorage.getItem('imageTurboEnabled') === 'false') return;

  const img = document.querySelector('img[alt="Image to annotate"]');
  if (!img || !img.src || img.dataset.webpOptimized === 'true') return;

  // Skip если это placeholder
  if (img.src.includes('placeholder.svg')) return;

  const canvas = document.createElement('canvas');
  const supportsWebP = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  if (!supportsWebP) return;

  const originalUrl = img.src;
  const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(originalUrl)}&w=1600&q=87&output=webp&fit=contain`;

  if (img.src === proxyUrl) return;

  img.src = proxyUrl;
  img.dataset.webpOptimized = 'true';

  img.onerror = () => {
    if (img.src !== originalUrl) {
      console.warn('Image Turbo: ошибка прокси → фолбэк на оригинал');
      img.src = originalUrl;
    }
    img.onerror = null;
  };

  // Лог ТОЛЬКО ОДИН РАЗ
  if (!webpLogShown) {
    console.log('%cImage Turbo: WebP применено 💨', 'color: #ff3399; font-weight: bold;');
    webpLogShown = true;
  }
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
    registerClickActivity
  };
})();