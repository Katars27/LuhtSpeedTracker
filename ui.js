// ui.js
'use strict';

(function () {
  // Защита от двойной загрузки (очень важно против "двоится")
  if (window.__luht_ui_v2_loaded) return;
  window.__luht_ui_v2_loaded = true;

  if (!window.LuhtSpeedCore) {
    try { console.warn('[LUHT] LuhtSpeedCore not found'); } catch {}
    return;
  }
  const Core = window.LuhtSpeedCore;

  // =====================================================
  // УТИЛИТЫ
  // =====================================================
  function setTextIfChanged(el, value) {
    if (!el) return;
    const str = value != null ? String(value) : '';
    if (el.textContent !== str) el.textContent = str;
  }

  function showToast(message, duration = 2500) {
    try {
      const toast = document.createElement('div');
      toast.textContent = message;
      toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: #222; color: #fff; padding: 12px 24px; border-radius: 12px;
        z-index: 999999; font-size: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.6);
        opacity: 0; transition: opacity 0.3s ease;
      `;
      (document.body || document.documentElement).appendChild(toast);
      requestAnimationFrame(() => (toast.style.opacity = '1'));
      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    } catch {}
  }

  // trailing throttle (чтобы не пропускать последний апдейт)
  function throttleTrailing(fn, delay) {
    let lastExec = 0;
    let timer = null;
    let lastArgs = null;
    let lastThis = null;

    function invoke(now) {
      lastExec = now;
      const args = lastArgs;
      const ctx = lastThis;
      lastArgs = null;
      lastThis = null;
      try {
        return fn.apply(ctx, args || []);
      } catch (e) {
        try { console.error('[LUHT] throttled fn error', e); } catch {}
      }
    }

    function scheduled() {
      timer = null;
      invoke(Date.now());
    }

    const wrapped = function (...args) {
      const now = Date.now();
      lastArgs = args;
      lastThis = this;

      const elapsed = now - lastExec;
      const remaining = delay - elapsed;

      if (remaining <= 0) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        return invoke(now);
      }

      if (!timer) {
        timer = setTimeout(scheduled, remaining);
      }
    };

    wrapped.cancel = function () {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastArgs = null;
      lastThis = null;
    };

    wrapped.flush = function () {
      if (!lastArgs) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return invoke(Date.now());
    };

    return wrapped;
  }

  function inEditable() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function isQueuePage() {
    return /\/v2\/task\/.+\/queue\//.test(location.pathname);
  }

  function safeAppendToRoot(el) {
    const root = document.documentElement || document;
    try {
      root.appendChild(el);
    } catch {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          try { (document.documentElement || document).appendChild(el); } catch {}
        },
        { once: true }
      );
    }
  }

  // =====================================================
  // PANEL UI — создаём один раз, скрыта до LCP
  // =====================================================
  const panel = document.createElement('div');
  panel.className = 'luht-panel';
  panel.style.visibility = 'hidden';
  safeAppendToRoot(panel);

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

  const btnReset = document.createElement('button');
  btnReset.className = 'luht-btn';
  btnReset.textContent = '🗑';
  btnReset.title = 'Клик — сброс статистики\nУдержание — полная очистка';
  header.appendChild(btnReset);

  const rows = document.createElement('div');
  panel.appendChild(rows);

  function makeRow(label) {
    const r = document.createElement('div');
    r.className = 'luht-row';

    const l = document.createElement('span');
    l.className = 'luht-row-label';
    l.textContent = label;

    const v = document.createElement('span');
    v.className = 'luht-row-value';
    v.textContent = '0';

    r.appendChild(l);
    r.appendChild(v);
    rows.appendChild(r);

    return { row: r, value: v };
  }

  const rTotal = makeRow('Всего');
  const r1m = makeRow('За 1 мин');
  const r5m = makeRow('За 5 мин');
  const r15m = makeRow('За 15 мин');
  const r60m = makeRow('За 60 мин');
  const rStreak = makeRow('Серия > 80/мин');
  const rBest = makeRow('Лучшая серия');
  const rActive = makeRow('Активное');
  const rTotalTime = makeRow('Общее время');
  const rStatus = makeRow('Статус');

  // =====================================================
  // LCP-SAFE: полный вайб строго после LCP
  // =====================================================
  let lcpActivated = false;

  function activateFullVibe() {
    if (lcpActivated) return;
    lcpActivated = true;

    try { document.documentElement.classList.add('lcp-done'); } catch {}
    panel.style.visibility = 'visible';

    // Турбо — только после LCP
    createTurboToggle();
    applyImageTurbo();

    startLoops();
  }

  try {
    const lcpObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry && entry.entryType === 'largest-contentful-paint') {
          activateFullVibe();
          try { lcpObserver.disconnect(); } catch {}
          break;
        }
      }
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}

  // Фоллбек без вечного rAF
  (function lcpFallback() {
    const started = Date.now();
    const loop = () => {
      if (lcpActivated) return;
      const img = document.querySelector('img[alt="Image to annotate"]');
      if (img && img.complete && img.naturalHeight > 0) {
        activateFullVibe();
        return;
      }
      if (Date.now() - started > 3500) return;
      requestAnimationFrame(loop);
    };
    try { requestAnimationFrame(loop); } catch {}
  })();

  setTimeout(() => {
    if (!lcpActivated) activateFullVibe();
  }, 3000);

  // =====================================================
  // LABEL BADGE
  // =====================================================
  let labelSection = null;
  let labelBadge = null;
  let lastBadgeText = '';
  let lastBadgeVisible = false;

  function ensureLabelBadge() {
    try {
      if (!document.body) return null;

      if (!labelSection || !document.body.contains(labelSection)) {
        labelSection = document.querySelector('#ticktock section.h-full');
      }
      if (!labelSection) return null;

      if (!labelBadge || !labelSection.contains(labelBadge)) {
        labelBadge = document.createElement('div');
        labelBadge.className = 'luht-last-label';
        labelSection.appendChild(labelBadge);
      }
      return labelBadge;
    } catch {
      return null;
    }
  }

  function updateLastLabelBadge() {
    if (!isQueuePage()) {
      if (labelBadge) labelBadge.classList.remove('show');
      lastBadgeVisible = false;
      return;
    }

    const badge = ensureLabelBadge();
    if (!badge) return;

    const selectedBtn = document.querySelector('aside button[name="label"][aria-selected="true"]');
    if (!selectedBtn) {
      if (lastBadgeVisible) badge.classList.remove('show');
      lastBadgeVisible = false;
      return;
    }

    const fullText = (selectedBtn.textContent || '').trim();
    const text = fullText.includes('.') ? fullText : `Метка: ${fullText}`;

    if (text !== lastBadgeText || !lastBadgeVisible) {
      setTextIfChanged(badge, text);
      badge.classList.add('show');
      lastBadgeText = text;
      lastBadgeVisible = true;
    }
  }

  function showInstantLabel(btn) {
    if (!btn) return;

    const badge = ensureLabelBadge();
    if (!badge) return;

    const fullText = (btn.textContent || '').trim();
    const text = fullText.includes('.') ? fullText : `Метка: ${fullText}`;

    setTextIfChanged(badge, text);
    badge.style.display = 'block';
    badge.style.opacity = '1';

    setTimeout(() => {
      badge.style.opacity = '0';
      setTimeout(() => {
        if (!lastBadgeVisible) badge.style.display = 'none';
      }, 250);
    }, 1200);
  }

  // =====================================================
  // Image Turbo (совместимо с freezer.turbo.js)
  // =====================================================
  const TURBO_ENABLED_KEY = 'imageTurboEnabled';
  const TURBO_DEAD_TS_KEY = 'imageTurboProxyDeadTs'; // как в freezer.constants.js
  const TURBO_COOLDOWN_MS = 30 * 60 * 1000;

  let turboRow = null;
  let turboToggle = null;
  let turboIcon = null;

  function isTurboInCooldown() {
    try {
      const ts = Number(localStorage.getItem(TURBO_DEAD_TS_KEY) || '0');
      return ts && Date.now() - ts < TURBO_COOLDOWN_MS;
    } catch {
      return false;
    }
  }

  function setTurboCooldown() {
    try {
      localStorage.setItem(TURBO_DEAD_TS_KEY, String(Date.now()));
    } catch {}
  }

  function clearTurboCooldown() {
    try {
      localStorage.removeItem(TURBO_DEAD_TS_KEY);
    } catch {}
  }

  function createTurboToggle() {
    if (turboRow) return;

    turboRow = document.createElement('div');
    turboRow.className = 'luht-row luht-turbo-row';

    const label = document.createElement('span');
    label.className = 'luht-row-label';
    label.textContent = 'Image Turbo';

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '10px';

    turboToggle = document.createElement('input');
    turboToggle.type = 'checkbox';
    turboToggle.id = 'image-turbo-toggle';

    const enabled = localStorage.getItem(TURBO_ENABLED_KEY) === 'true';
    turboToggle.checked = enabled;

    turboIcon = document.createElement('span');
    turboIcon.style.fontSize = '14px';
    turboIcon.textContent = enabled ? '💨 Активно' : 'Выключено';
    turboIcon.style.opacity = enabled ? '1' : '0.5';
    turboIcon.style.transition = 'opacity 0.3s ease';

    let debounceTimer = null;
    turboToggle.addEventListener('change', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const on = turboToggle.checked;
        try { localStorage.setItem(TURBO_ENABLED_KEY, on ? 'true' : 'false'); } catch {}
        if (on) clearTurboCooldown();
        if (turboIcon) {
          turboIcon.textContent = on ? '💨 Активно' : 'Выключено';
          turboIcon.style.opacity = on ? '1' : '0.5';
        }
        applyImageTurbo();
      }, 100);
    });

    wrapper.appendChild(turboToggle);
    wrapper.appendChild(turboIcon);
    turboRow.appendChild(label);
    turboRow.appendChild(wrapper);
    rows.appendChild(turboRow);
  }

  let currentImg = null;
  function getCurrentImage() {
    if (currentImg && document.body && document.body.contains(currentImg)) return currentImg;
    currentImg = document.querySelector('img[alt="Image to annotate"]');
    return currentImg;
  }

  function applyImageTurbo() {
    if (!lcpActivated) return;
    if (localStorage.getItem(TURBO_ENABLED_KEY) !== 'true') return;
    if (isTurboInCooldown()) return;

    const img = getCurrentImage();
    if (!img) return;

    // не повторяем
    if (img.dataset.webpOptimized === 'true' || img.dataset.webpOptimized === 'fail') return;

    const original = img.src;
    if (!original || original.endsWith('.webp') || original.endsWith('.svg')) return;

    const width = Math.min(1600, Math.floor(window.innerWidth * 1.5));
    const proxy = `https://wsrv.nl/?url=${encodeURIComponent(original)}&w=${width}&q=87&output=webp&fit=contain`;

    const preload = new Image();
    preload.onload = () => {
      img.src = proxy;
      img.dataset.webpOptimized = 'true';
      clearTurboCooldown();
    };
    preload.onerror = () => {
      img.dataset.webpOptimized = 'fail';
      setTurboCooldown();

      if (turboIcon) {
        turboIcon.textContent = 'Недоступно (временно)';
        turboIcon.style.opacity = '0.5';
      }
      showToast('Image Turbo временно недоступен. Поставлен таймаут.', 2200);

      if (img.src !== original) img.src = original;
    };
    preload.src = proxy;
  }

  // =====================================================
  // RESET: короткий/длинный
  // =====================================================
  let resetPressTimer = null;
  let didLongPress = false;
  const LONG_PRESS_MS = 800;

  function clearResetTimer() {
    if (resetPressTimer) {
      clearTimeout(resetPressTimer);
      resetPressTimer = null;
    }
  }

  function hardReset({ withTasks = false } = {}) {
    try { Core.resetAll(); } catch {}

    if (withTasks) {
      try {
        localStorage.removeItem('luht_freezer_tasklist_v1');
        localStorage.removeItem('luht_finished_task_ids_v1');
        localStorage.removeItem('luht_freezer_last_clean_ts_v1');
      } catch {}

      try { window.LUHT && window.LUHT.freezer && window.LUHT.freezer.safeRefresh && window.LUHT.freezer.safeRefresh(true); } catch {}
    }

    // Turbo: выключаем и снимаем cooldown
    try {
      localStorage.setItem(TURBO_ENABLED_KEY, 'false');
      clearTurboCooldown();
    } catch {}

    if (turboToggle) turboToggle.checked = false;
    if (turboIcon) {
      turboIcon.textContent = 'Выключено';
      turboIcon.style.opacity = '0.5';
    }

    // сбросим флаг оптимизации картинки на текущей
    const img = getCurrentImage();
    if (img) {
      try { delete img.dataset.webpOptimized; } catch { img.dataset.webpOptimized = ''; }
    }

    lastStateSnapshot = null;
    try { Core.setAlreadyCounted(false); } catch {}
    updatePanel(true);
    updateLastLabelBadge();
  }

  btnReset.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    didLongPress = false;

    resetPressTimer = setTimeout(() => {
      didLongPress = true;
      btnReset.classList.add('luht-btn-longpress');
      hardReset({ withTasks: true });
      showToast('Полная очистка выполнена', 2500);
      btnReset.classList.remove('luht-btn-longpress');
    }, LONG_PRESS_MS);
  });

  btnReset.addEventListener('pointerup', (e) => {
    e.preventDefault();
    clearResetTimer();

    if (!didLongPress) {
      hardReset({ withTasks: false });
      showToast('Статистика сброшена', 2000);
    }

    didLongPress = false;
    btnReset.classList.remove('luht-btn-longpress');
  });

  ['pointerleave', 'pointercancel'].forEach((evt) => {
    btnReset.addEventListener(evt, () => {
      clearResetTimer();
      didLongPress = false;
      btnReset.classList.remove('luht-btn-longpress');
    });
  });

  // =====================================================
  // UPDATE PANEL — только при изменениях (+ force)
  // =====================================================
  let lastStateSnapshot = null;

  function updatePanel(force = false) {
    const st = Core.getState();

    // быстрый снапшот без JSON.stringify (меньше аллокаций)
    const snap = [
      st.totalCount,
      st.c1,
      st.c5,
      st.c15,
      st.c60,
      st.streakMs,
      st.bestStreakMs,
      st.warning ? 1 : 0,
      st.boost ? 1 : 0,
      st.paused ? 1 : 0,
      st.activeTimeMs,
      st.totalTimeMs,
    ].join('|');

    if (!force && snap === lastStateSnapshot) return;
    lastStateSnapshot = snap;

    setTextIfChanged(rTotal.value, st.totalCount);
    setTextIfChanged(r1m.value, st.c1);
    setTextIfChanged(r5m.value, st.c5);
    setTextIfChanged(r15m.value, st.c15);
    setTextIfChanged(r60m.value, st.c60);

    setTextIfChanged(rStreak.value, st.streakMs > 0 ? Core.formatDuration(st.streakMs) : '—');
    setTextIfChanged(rBest.value, st.bestStreakMs > 0 ? Core.formatDuration(st.bestStreakMs) : '—');

    setTextIfChanged(rActive.value, Core.formatDuration(st.activeTimeMs));
    setTextIfChanged(rTotalTime.value, Core.formatDuration(st.totalTimeMs));

    r1m.row.classList.toggle('luht-row-minute-good', st.c1 >= 100);
    r1m.row.classList.toggle('luht-row-minute-bad', st.c1 >= 90 && st.c1 < 100);
    r1m.row.classList.toggle('luht-row-minute-ok', st.c1 >= 80 && st.c1 < 90);
    r1m.row.classList.toggle('luht-row-warning', !!st.warning);

    boostBadge.style.display = st.boost ? '' : 'none';
    panel.classList.toggle('luht-panel-paused', !!st.paused);

    setTextIfChanged(
      rStatus.value,
      st.paused ? 'Пауза… кликни метку' : st.boost ? '⚡ Ускоренный режим' : 'Работаю'
    );
  }

  const throttledUpdatePanel = throttleTrailing(() => updatePanel(false), 200);
  const throttledUpdateBadge = throttleTrailing(updateLastLabelBadge, 200);

  // =====================================================
  // ВРЕМЯ — один setInterval
  // =====================================================
  let timeInterval = null;

  function startTimeLoop() {
    if (timeInterval) return;

    const tick = () => {
      const st = Core.getState();
      setTextIfChanged(rActive.value, Core.formatDuration(st.activeTimeMs));
      setTextIfChanged(rTotalTime.value, Core.formatDuration(st.totalTimeMs));
    };

    tick();
    timeInterval = setInterval(() => {
      if (document.hidden) return;
      tick();
    }, 1000);
  }

  function stopTimeLoop() {
    if (!timeInterval) return;
    clearInterval(timeInterval);
    timeInterval = null;
  }

  // =====================================================
  // INPUT HANDLERS
  // =====================================================
  // ВАЖНО: prev НЕ должен делать registerClickActivity(), иначе пауза/активность ломается.
  let prevClickBlocked = false;

  document.addEventListener(
    'click',
    (ev) => {
      if (!isQueuePage()) return;

      const btn = ev.target && ev.target.closest ? ev.target.closest('button[name="label"]') : null;
      if (btn) {
        showInstantLabel(btn);

        if (!Core.getAlreadyCounted()) {
          Core.setAlreadyCounted(true);
          Core.addEvent();
          Core.registerClickActivity();
        }

        throttledUpdatePanel();
        throttledUpdateBadge();
        return;
      }

      const prev = ev.target && ev.target.closest ? ev.target.closest('a[href$="/prev/"]') : null;
      if (prev) {
        if (prevClickBlocked) return;
        prevClickBlocked = true;
        setTimeout(() => { prevClickBlocked = false; }, 180);

        try {
          Core.setAlreadyCounted(false);
          Core.backEvent();
        } catch {}

        throttledUpdatePanel();
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    (ev) => {
      if (!isQueuePage()) return;

      const key = ev.key;
      if (!['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='].includes(key)) return;
      if (inEditable()) return;

      if (!Core.getAlreadyCounted()) {
        Core.setAlreadyCounted(true);
        Core.addEvent();
        Core.registerClickActivity();
      }
      throttledUpdatePanel();
    },
    true
  );

  // =====================================================
  // HTMX AFTER SWAP — debounce + фильтр целей
  // =====================================================
  let htmxDebounce = null;

  function onAfterSwap(ev) {
    // если свап внутри нашей панели/бейджа — игнор
    try {
      const target = ev && ev.detail && ev.detail.target;
      if (target && target.closest) {
        if (target.closest('.luht-panel') || target.closest('.luht-last-label')) return;
      }
    } catch {}

    clearTimeout(htmxDebounce);
    htmxDebounce = setTimeout(() => {
      try { Core.setAlreadyCounted(false); } catch {}
      currentImg = null;
      applyImageTurbo();
      updatePanel(true);
      throttledUpdateBadge();
    }, 80);
  }

  function setupHtmxListener() {
    const bind = () => {
      if (!document.body) return;
      document.body.addEventListener('htmx:afterSwap', onAfterSwap);
    };
    if (document.body) bind();
    else document.addEventListener('DOMContentLoaded', bind, { once: true });
  }
  setupHtmxListener();

  // =====================================================
  // MAIN LOOP — лёгкий
  // =====================================================
  let uiLoopTimer = null;
  let visBound = false;

  function startLoops() {
    startTimeLoop();

    if (!visBound) {
      visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopTimeLoop();
        else startTimeLoop();
      });
    }

    if (uiLoopTimer) return;
    const loop = () => {
      throttledUpdatePanel();
      throttledUpdateBadge();
      uiLoopTimer = setTimeout(loop, 800);
    };
    loop();
  }

  // Инициализация (форсим первый рендер)
  updatePanel(true);
  updateLastLabelBadge();
})();
