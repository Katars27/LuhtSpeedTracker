'use strict';

(function () {
  // Защита от двойной загрузки (очень важно против "двоится")
  if (window.__luht_ui_v2_loaded) return;
  window.__luht_ui_v2_loaded = true;

  if (!window.LuhtSpeedCore) {
    console.warn('LuhtSpeedCore not found');
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
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: #222; color: #fff; padding: 12px 24px; border-radius: 12px;
      z-index: 999999; font-size: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.6);
      opacity: 0; transition: opacity 0.3s ease;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => (toast.style.opacity = '1'));
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function throttle(fn, delay) {
    let lastCall = 0;
    let lastArgs = null;
    let scheduled = false;

    return function (...args) {
      const now = Date.now();
      lastArgs = args;

      if (now - lastCall >= delay) {
        lastCall = now;
        return fn.apply(this, args);
      }

      if (!scheduled) {
        scheduled = true;
        const wait = Math.max(0, delay - (now - lastCall));
        setTimeout(() => {
          scheduled = false;
          lastCall = Date.now();
          fn.apply(this, lastArgs);
        }, wait);
      }
    };
  }

  // =====================================================
  // LCP-SAFE: Полный вайб строго после LCP
  // =====================================================
  let lcpActivated = false;

  function activateFullVibe() {
    if (lcpActivated) return;
    lcpActivated = true;
    document.documentElement.classList.add('lcp-done');
    panel.style.visibility = 'visible';
    createTurboToggle();
    applyImageTurbo();
    startLoops();
  }

  const lcpObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'largest-contentful-paint') {
        activateFullVibe();
        lcpObserver.disconnect();
      }
    }
  });

  try {
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}

  // Fallback через rAF — моментально ловит готовую картинку
  function lcpFallbackLoop() {
    if (lcpActivated) return;
    const img = document.querySelector('img[alt="Image to annotate"]');
    if (img && img.complete && img.naturalHeight > 0) {
      activateFullVibe();
    } else {
      requestAnimationFrame(lcpFallbackLoop);
    }
  }
  requestAnimationFrame(lcpFallbackLoop);

  // Timeout fallback — если LCP не сработал (редко, но бывает)
  setTimeout(() => {
    if (!lcpActivated) activateFullVibe();
  }, 3000);

  // =====================================================
  // PANEL UI — создаём один раз, скрыта до LCP
  // =====================================================
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
  // LABEL BADGE
  // =====================================================
  let labelSection = null;
  let labelBadge = null;
  let lastBadgeText = '';
  let lastBadgeVisible = false;

  function ensureLabelBadge() {
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
  }

  function updateLastLabelBadge() {
    if (!/\/v2\/task\/.+\/queue\//.test(location.pathname)) {
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

    const fullText = selectedBtn.textContent.trim();
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

    const fullText = btn.textContent.trim();
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
  // Image Turbo (унификация с freezer.js)
  // =====================================================
  let turboRow = null;
  let turboToggle = null;
  let turboIcon = null;

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

    const enabled = localStorage.getItem('imageTurboEnabled') === 'true';
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
        localStorage.setItem('imageTurboEnabled', on ? 'true' : 'false');
        // если руками включили — даём шанс снова
        if (on) {
          try { localStorage.removeItem('imageTurboProxyDead'); } catch (e) {}
        }
        turboIcon.textContent = on ? '💨 Активно' : 'Выключено';
        turboIcon.style.opacity = on ? '1' : '0.5';
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
    if (currentImg && document.body.contains(currentImg)) return currentImg;
    currentImg = document.querySelector('img[alt="Image to annotate"]');
    return currentImg;
  }

  function applyImageTurbo() {
    if (!lcpActivated) return;

    // если уже выяснили, что прокси не работает — не долбимся
    if (localStorage.getItem('imageTurboProxyDead') === 'true') return;

    if (localStorage.getItem('imageTurboEnabled') !== 'true') return;

    const img = getCurrentImage();
    if (!img) return;

    // если уже оптимизировали/провалили — не повторяем
    if (img.dataset.webpOptimized === 'true' || img.dataset.webpOptimized === 'fail') return;

    const original = img.src;
    if (!original || original.endsWith('.webp') || original.endsWith('.svg')) return;

    const width = Math.min(1600, Math.floor(window.innerWidth * 1.5));
    const proxy = `https://wsrv.nl/?url=${encodeURIComponent(original)}&w=${width}&q=87&output=webp&fit=contain`;

    const preload = new Image();

    preload.onload = () => {
      img.src = proxy;
      img.dataset.webpOptimized = 'true';
    };

    preload.onerror = () => {
      img.dataset.webpOptimized = 'fail';

      // гасим навсегда (пока ты сам не включишь снова / не сбросишь)
      try {
        localStorage.setItem('imageTurboProxyDead', 'true');
        localStorage.setItem('imageTurboEnabled', 'false');
      } catch (e) {}

      if (turboToggle) turboToggle.checked = false;
      if (turboIcon) {
        turboIcon.textContent = 'Недоступно (CSP/403)';
        turboIcon.style.opacity = '0.5';
      }

      showToast('Image Turbo недоступен (CSP/доступ). Отключил.', 2200);

      if (img.src !== original) img.src = original;
    };

    preload.src = proxy;
  }

  // =====================================================
  // Hard Reset
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
    Core.resetAll();

    if (withTasks) {
      localStorage.removeItem('luht_freezer_tasklist_v1');
      localStorage.removeItem('luht_finished_task_ids_v1');
      localStorage.removeItem('luht_freezer_last_clean_ts_v1');
      // freezer.js может иметь safeRefresh — если есть, ок
      window.safeRefresh?.(true);
    }

    // сбрасываем turbo полностью
    localStorage.setItem('imageTurboEnabled', 'false');
    try { localStorage.removeItem('imageTurboProxyDead'); } catch (e) {}

    if (turboToggle) turboToggle.checked = false;
    if (turboIcon) {
      turboIcon.textContent = 'Выключено';
      turboIcon.style.opacity = '0.5';
    }

    const img = getCurrentImage();
    if (img) {
      delete img.dataset.webpOptimized;
      try {
        const url = new URL(img.src, location.href);
        url.searchParams.set('_r', Date.now());
        img.src = url.toString();
      } catch {
        img.src = img.src.split('?')[0] + '?_r=' + Date.now();
      }
    }

    lastStateSnapshot = null;
    Core.setAlreadyCounted(false);
    updatePanel(true);
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
    const snap = JSON.stringify({
      totalCount: st.totalCount,
      c1: st.c1,
      c5: st.c5,
      c15: st.c15,
      c60: st.c60,
      streakMs: st.streakMs,
      bestStreakMs: st.bestStreakMs,
      warning: st.warning,
      boost: st.boost,
      paused: st.paused,
    });

    if (!force && snap === lastStateSnapshot) return;
    lastStateSnapshot = snap;

    setTextIfChanged(rTotal.value, st.totalCount);
    setTextIfChanged(r1m.value, st.c1);
    setTextIfChanged(r5m.value, st.c5);
    setTextIfChanged(r15m.value, st.c15);
    setTextIfChanged(r60m.value, st.c60);

    setTextIfChanged(rStreak.value, st.streakMs > 0 ? Core.formatDuration(st.streakMs) : '—');
    setTextIfChanged(rBest.value, st.bestStreakMs > 0 ? Core.formatDuration(st.bestStreakMs) : '—');

    r1m.row.classList.toggle('luht-row-minute-good', st.c1 >= 100);
    r1m.row.classList.toggle('luht-row-minute-bad', st.c1 >= 90 && st.c1 < 100);
    r1m.row.classList.toggle('luht-row-minute-ok', st.c1 >= 80 && st.c1 < 90);
    r1m.row.classList.toggle('luht-row-warning', st.warning);

    boostBadge.style.display = st.boost ? '' : 'none';
    panel.classList.toggle('luht-panel-paused', st.paused);
    setTextIfChanged(
      rStatus.value,
      st.paused ? 'Пауза… кликни метку' : st.boost ? '⚡ Ускоренный режим' : 'Работаю'
    );
  }

  const throttledUpdatePanel = throttle(updatePanel, 200);
  const throttledUpdateBadge = throttle(updateLastLabelBadge, 200);

  // =====================================================
  // ВРЕМЯ — rAF, но обновляем раз в секунду (без setInterval)
  // =====================================================
  let lastTimeUpdate = 0;
  function updateTimeRAF() {
    const now = Date.now();
    if (now - lastTimeUpdate >= 1000) {
      const st = Core.getState();
      setTextIfChanged(rActive.value, Core.formatDuration(st.activeTimeMs));
      setTextIfChanged(rTotalTime.value, Core.formatDuration(st.totalTimeMs));
      lastTimeUpdate = now;
    }
    requestAnimationFrame(updateTimeRAF);
  }
  updateTimeRAF();

  // =====================================================
  // INPUT HANDLERS
  // =====================================================
  document.addEventListener(
    'click',
    (ev) => {
      if (!/\/v2\/task\/.+\/queue\//.test(location.pathname)) return;

      const btn = ev.target.closest('button[name="label"]');
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

      const prev = ev.target.closest('a[href$="/prev/"]');
      if (prev) {
        Core.setAlreadyCounted(false);
        Core.backEvent();
        Core.registerClickActivity();
        throttledUpdatePanel();
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    (ev) => {
      if (!/\/v2\/task\/.+\/queue\//.test(location.pathname)) return;

      const key = ev.key;
      if (['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='].includes(key)) {
        const active = document.activeElement;
        if ((active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) || active?.isContentEditable) return;

        if (!Core.getAlreadyCounted()) {
          Core.setAlreadyCounted(true);
          Core.addEvent();
          Core.registerClickActivity();
        }
        throttledUpdatePanel();
      }
    },
    true
  );

  // =====================================================
  // HTMX AFTER SWAP — debounce + фильтр целей
  // =====================================================
  let htmxDebounce = null;
  function onAfterSwap(ev) {
    // фильтрация: если свап вообще не про наш экран — не делаем тяжелые штуки
    // (часто htmx меняет мелкие куски, а мы дергаем всё)
    try {
      const target = ev?.detail?.target;
      if (target && target.closest) {
        // игнорим свапы внутри нашей панели/бейджа
        if (target.closest('.luht-panel') || target.closest('.luht-last-label')) return;
      }
    } catch (e) {}

    // debounce: слепляем пачку свапов в один апдейт
    clearTimeout(htmxDebounce);
    htmxDebounce = setTimeout(() => {
      Core.setAlreadyCounted(false);
      currentImg = null;
      applyImageTurbo();
      throttledUpdatePanel();
      throttledUpdateBadge();
    }, 80);
  }

  function setupHtmxListener() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', setupHtmxListener);
      return;
    }
    document.body.addEventListener('htmx:afterSwap', onAfterSwap);
  }
  setupHtmxListener();

  // =====================================================
  // MAIN LOOP — редкий и спокойный (без бесконечного ric)
  // =====================================================
  function mainUILoop() {
    throttledUpdatePanel();
    throttledUpdateBadge();

    // раз в ~800мс достаточно: UI не должен жрать CPU
    setTimeout(mainUILoop, 800);
  }

  function startLoops() {
    mainUILoop();
  }

  // Инициализация (форсим первый рендер)
  updatePanel(true);
  updateLastLabelBadge();
})();
