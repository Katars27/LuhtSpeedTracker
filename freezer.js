'use strict';
(function () {
  console.log('[LUHT] boot', Date.now(), location.href);

  if (window.__luht_speed_v2_loaded) return;
  window.__luht_speed_v2_loaded = true;

  if (!window.LuhtSpeedCore) return;
  const Core = window.LuhtSpeedCore;

  const myRequestIdleCallback =
    window.requestIdleCallback ||
    function (cb) {
      return setTimeout(cb, 50);
    };

  const AbortControllerPoly =
    window.AbortController ||
    class {
      signal = {};
      abort() {}
    };

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
    return function (...args) {
      const now = Date.now();
      if (now - lastCall < delay) return;
      lastCall = now;
      return fn(...args);
    };
  }

  const CACHE_KEY = 'luht_freezer_tasklist_v1';
  const RETURN_URL_KEY = 'luht_freezer_return_url';
  const FINISHED_KEY = 'luht_finished_task_ids_v1';
  const MAX_CACHE_SIZE = 1000;

  let taskList = null;
  let picker = null;
  let pickerList = null;
  let isOpen = false;

  let listReady = false;
  let listBuilt = false;
  let firstSwapDone = false;

  let jumpLock = false;
  let isRefreshing = false;
  let fetchCompleted = false;
  const TASKLIST_REFRESH_TTL_MS = 5 * 60 * 1000; // 5 минут
  let lastTaskListFetchTS = 0;

  let isWorking = false;
  let workTimer = null;
  
  const WORK_TIMEOUT_MS = 5000;
  const REFRESH_FALLBACK_TIMEOUT = 30000;

  function markWorking() {
    isWorking = true;
    clearTimeout(workTimer);
    workTimer = setTimeout(() => {
      isWorking = false;
    }, WORK_TIMEOUT_MS);
  }

  function logError(message, error) {
  try { console.error('[LUHT]', message, error); } catch (e) {}
}


  class LRUCache {
    constructor(capacity) {
      this.capacity = capacity;
      this.cache = new Map();
    }
    get(key) {
      if (!this.cache.has(key)) return undefined;
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    set(key, value) {
      if (this.cache.has(key)) this.cache.delete(key);
      this.cache.set(key, value);
      if (this.cache.size > this.capacity) {
        this.cache.delete(this.cache.keys().next().value);
      }
    }
  }

  const taskIdCache = new LRUCache(MAX_CACHE_SIZE);

  function loadFinishedIds() {
    try {
      const raw = localStorage.getItem(FINISHED_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

    const finishedSync = (window.BroadcastChannel ? new BroadcastChannel('luht_finished_sync') : null);
  if (finishedSync) {
    finishedSync.onmessage = () => {
      taskList = pruneFinishedFromList(taskList || []);
      throttledUpdateList(taskList);
    };
  }


    function saveFinishedIds(ids) {
    try {
      localStorage.setItem(FINISHED_KEY, JSON.stringify(ids));
      if (finishedSync) finishedSync.postMessage('update');
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        try {
          localStorage.setItem(FINISHED_KEY, JSON.stringify(ids.slice(-100)));
          if (finishedSync) finishedSync.postMessage('update');
        } catch (e2) {}
      }
    }
  }

  function getTaskIdFromPath(path) {
    const cached = taskIdCache.get(path);
    if (cached !== undefined) return cached;
    const m = String(path || '').match(/\/v2\/task\/(\d+)\//);
    const id = m ? m[1] : null;
    taskIdCache.set(path, id);
    return id;
  }

  function pruneFinishedFromList(list) {
    if (!Array.isArray(list) || list.length === 0) return list;
    const finishedIds = loadFinishedIds();
    if (!finishedIds.length) return list;
    const finishedSet = new Set(finishedIds);
    return list.filter((t) => {
      const href = String(t?.href || '');
      const id = getTaskIdFromPath(href);
      return id && !finishedSet.has(id);
    });
  }

  function markFinishedFromUrl() {
    const m = location.pathname.match(/^\/v2\/task\/(\d+)\/queue\/continue\/?/);
    if (!m) return false;
    const id = m[1];
    const ids = loadFinishedIds();
    if (ids.includes(id)) return false;
    ids.push(id);
    saveFinishedIds(ids);
    return true;
  }

  function loadCache() {
    try {
      const v = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (!Array.isArray(v) || v.length === 0) return null;
      return v;
    } catch (e) {
      return null;
    }
  }

  function saveCache(list) {
    try {
      if (!Array.isArray(list) || list.length === 0) return;
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(list.slice(-500)));
        } catch (e2) {}
      }
    }
  }

  function removeCompletedFromCache() {
    const list = loadCache();
    if (!list) return;
    const pruned = pruneFinishedFromList(list);
    if (pruned !== list) {
      if (pruned && pruned.length) saveCache(pruned);
      else {
        try {
          localStorage.removeItem(CACHE_KEY);
        } catch (e) {}
      }
    }
  }

  function normalizeHref(href) {
    try {
      if (!href || typeof href !== 'string') return null;
      const u = new URL(href, location.origin);
      return u.href;
    } catch (e) {
      return null;
    }
  }

  function safeNavigate(href, { ignoreWorking = false } = {}) {
    if (jumpLock || (!ignoreWorking && isWorking)) return false;
    const u = normalizeHref(href);
    if (!u) return false;
    jumpLock = true;
    setTimeout(() => {
      jumpLock = false;
    }, 2000);
    location.href = u;
    return true;
  }

  function parseTaskListFromDocument(doc) {
    try {
      const links = doc.querySelectorAll('a[href*="/v2/task/"]');
      const finishedIds = loadFinishedIds();
      const finishedSet = new Set(finishedIds);
      const arr = [];
      const seenHrefs = new Set();

      links.forEach((a) => {
        const title = (a.textContent || '').trim();
        const lower = title.toLocaleLowerCase();
        if (
          lower.includes('299') ||
          lower.includes('399') ||
          lower.includes('микс желейный') ||
          lower.includes('конфеты комбинированные')
        )
          return;

        const href = normalizeHref(a.getAttribute('href') || a.href);
        if (!href || seenHrefs.has(href)) return;
        seenHrefs.add(href);

        const id = getTaskIdFromPath(href);
        if (id && finishedSet.has(id)) return;

        arr.push({ href, title });
      });

      const currentIds = new Set(arr.map((t) => getTaskIdFromPath(t.href)).filter(Boolean));
      const updatedFinished = finishedIds.filter((id) => !currentIds.has(id));
      if (updatedFinished.length !== finishedIds.length) {
        saveFinishedIds(updatedFinished);
      }

      return arr;
    } catch (e) {
      return [];
    }
  }

  async function fetchTextWithRetry(url, { tries = 3, timeoutMs = 30000 } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= tries; attempt++) {
      const ctrl = new AbortControllerPoly();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.text();
      } catch (e) {
        lastErr = e;
        await new Promise((res) => setTimeout(res, 200 * attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  async function fetchTaskList(force = false) {
  const now = Date.now();

  // если недавно уже обновляли и список есть — не долбим сервер
  if (!force && taskList?.length && (now - lastTaskListFetchTS) < TASKLIST_REFRESH_TTL_MS) {
    return taskList;
  }

  try {
    const html = await fetchTextWithRetry('/v2/tasks/list/');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const arr = parseTaskListFromDocument(doc);

    if (arr && arr.length) {
      saveCache(arr);
      taskList = arr;
      lastTaskListFetchTS = now; // только если реально получили список
      fetchCompleted = true;
      return arr;
    }

    // если пусто — не обновляем lastTaskListFetchTS, чтобы можно было повторить быстрее
    return taskList?.length ? taskList : (loadCache() || []);

  } catch (e) {
    // при ошибке — не обновляем lastTaskListFetchTS, чтобы можно было повторить
    return loadCache() || [];
  }
}

  let panel = null;
  let lcpActivated = false;
  function activateFullVibe() {
    if (!panel) return;
    if (lcpActivated) return;
    lcpActivated = true;
    document.documentElement.classList.add('lcp-done');
    panel.style.visibility = 'visible';
    if (picker) picker.style.visibility = 'visible';
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
  setTimeout(() => {
    if (!lcpActivated) activateFullVibe();
  }, 3000);

  panel = document.createElement('div');
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
  btnReset.title = 'Клик — сброс статистики\nУдержание — полный сброс';
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

  function createFreezerUI() {
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
      transition: all 0.2s ease !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    `;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePicker();
    });
    document.documentElement.appendChild(btn);
    window.luhtFreezerBtn = btn;

    picker = document.createElement('div');
    picker.className = 'luht-freezer-panel';
    picker.style.display = 'none';
    picker.style.visibility = 'hidden';
    picker.style.opacity = '0';
    picker.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    picker.style.transform = 'translateY(20px)';

    const h = document.createElement('div');
    h.className = 'luht-freezer-header';
    h.textContent = 'СПИСОК ЗАДАЧ';
    picker.appendChild(h);

    pickerList = document.createElement('div');
    pickerList.className = 'luht-freezer-list';
    pickerList.style.overflowY = 'auto';
    pickerList.style.scrollBehavior = 'smooth';
    picker.appendChild(pickerList);

    picker.setAttribute('hx-preserve', '');
    document.documentElement.appendChild(picker);
  }

  function updateTaskListSmart(newList) {
    if (!Array.isArray(newList) || !pickerList || !isOpen) return;
    try {
      const currentId = getTaskIdFromPath(location.pathname);
      const fragment = document.createDocumentFragment();

      const existing = new Map();
      pickerList.querySelectorAll('.luht-freezer-item').forEach((el) => {
        existing.set(el.href, el);
      });

      const finishedSet = new Set(loadFinishedIds());
      const visibleEnd = Math.min(70, newList.length);

      newList.slice(0, visibleEnd).forEach((t) => {
        const id = getTaskIdFromPath(t.href);
        if (id && finishedSet.has(id)) return;

        let a = existing.get(t.href);
        if (a) {
          setTextIfChanged(a, t.title);
          a.classList.toggle('active', id === currentId);
          fragment.appendChild(a);
        } else {
          a = document.createElement('a');
          a.className = 'luht-freezer-item';
          a.href = t.href;
          a.textContent = t.title;
          if (id === currentId) a.classList.add('active');
          a.addEventListener('click', () => closePicker());
          fragment.appendChild(a);
        }
      });

      pickerList.innerHTML = '';
      pickerList.appendChild(fragment);
    } catch (e) {}
  }

  function updateActiveHighlight() {
    if (!pickerList || !isOpen) return;
    try {
      const currentId = getTaskIdFromPath(location.pathname);
      pickerList.querySelectorAll('.luht-freezer-item').forEach((el) => {
        el.classList.remove('active');
        const path = new URL(el.href, location.origin).pathname;
        const id = getTaskIdFromPath(path);
        if (id && id === currentId) el.classList.add('active');
      });
    } catch (e) {}
  }

  const throttledUpdateList = throttle(updateTaskListSmart, 200);
  const throttledUpdateHighlight = throttle(updateActiveHighlight, 200);
  const throttledUpdatePanel = throttle(updatePanel, 200);

  function refreshListFromCurrentPageIfTasks() {
    if (location.pathname !== '/v2/tasks/') return false;
    try {
      const listFromDom = parseTaskListFromDocument(document);
      const pruned = pruneFinishedFromList(listFromDom);
      if (Array.isArray(pruned) && pruned.length) {
        taskList = pruned;
        saveCache(pruned);
        throttledUpdateList(pruned);
        throttledUpdateHighlight();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  let refreshFallbackTimer = null;
  function safeRefresh(forceFetch = false) {
    if (isRefreshing) return;
    isRefreshing = true;

    clearTimeout(refreshFallbackTimer);

    myRequestIdleCallback(async () => {
      try {
        let list;
        if (location.pathname === '/v2/tasks/' && !forceFetch) {
          list = parseTaskListFromDocument(document);
        } else {
          list = await fetchTaskList(forceFetch);
        }

        list = pruneFinishedFromList(list);

        if (list.length) {
          taskList = list;
          saveCache(list);
          if (isOpen) throttledUpdateList(list);
          throttledUpdateHighlight();
        }
      } catch (e) {
      } finally {
        isRefreshing = false;
      }
    });

    refreshFallbackTimer = setTimeout(async () => {
      if (!isRefreshing) return;
      isRefreshing = false;
      try {
        const list = await fetchTaskList(forceFetch);
        taskList = pruneFinishedFromList(list);
        if (taskList.length) saveCache(taskList);
        if (isOpen) throttledUpdateList(taskList);
        throttledUpdateHighlight();
      } catch (e) {}
    }, REFRESH_FALLBACK_TIMEOUT);
  }

  async function jumpCategory(offset, retried = false) {
    markWorking();
    if (jumpLock) return;
    try {
      if (!taskList || taskList.length === 0) return;

      const currentId = getTaskIdFromPath(location.pathname);

      function goFirst() {
        const first = taskList[0];
        if (first) safeNavigate(first.href, { ignoreWorking: true });
      }

      function goLast() {
        const last = taskList[taskList.length - 1];
        if (last) safeNavigate(last.href, { ignoreWorking: true });
      }

      let currentIndex = -1;
      for (let i = 0; i < taskList.length; i++) {
        const id = getTaskIdFromPath(taskList[i].href);
        if (id && id === currentId) {
          currentIndex = i;
          break;
        }
      }

      if (offset === 'first') {
        goFirst();
        return;
      }
      if (offset === 'last') {
        goLast();
        return;
      }

      if (currentIndex !== -1) {
        const targetIndex = currentIndex + offset;
        const target = taskList[targetIndex];
        if (target) safeNavigate(target.href, { ignoreWorking: true });
        else goFirst();
        return;
      }

      goFirst();

      if (!retried) {
        setTimeout(() => {
          fetchTaskList(true)
            .then((newList) => {
              if (newList && newList.length) {
                taskList = newList;
                saveCache(taskList);
                if (isOpen) throttledUpdateList(taskList);
                throttledUpdateHighlight();
              }
            })
            .catch(() => {});
        }, 100);
      }
    } catch (e) {}
  }

  function openPicker() {
    if (!picker) return;
    if (document.hidden) return;

    isOpen = true;
    picker.style.display = 'flex';

    requestAnimationFrame(() => {
      picker.style.opacity = '1';
      picker.style.transform = 'translateY(0)';
    });

    if (pickerList) {
      pickerList.innerHTML =
        '<div style="text-align:center;padding:20px;color:#aaa;">Загрузка списка...</div>';
    }

    throttledUpdateList(taskList || []);
    throttledUpdateHighlight();
    safeRefresh(true);
  }

  function closePicker() {
    if (!picker) return;
    picker.style.opacity = '0';
    picker.style.transform = 'translateY(20px)';
    setTimeout(() => {
      picker.style.display = 'none';
      isOpen = false;
    }, 300);
  }

  function togglePicker() {
    markWorking();
    if (isOpen) closePicker();
    else openPicker();
  }

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

  // если мы уже выяснили, что прокси не работает — не долбимся
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

    // UI-переключатель тоже гасим, если уже создан
    if (typeof turboToggle !== 'undefined' && turboToggle) turboToggle.checked = false;
    if (typeof turboIcon !== 'undefined' && turboIcon) {
      turboIcon.textContent = 'Недоступно (CSP/403)';
      turboIcon.style.opacity = '0.5';
    }

    // один раз, без спама
    showToast('Image Turbo недоступен (CSP/доступ). Отключил.', 2200);

    // откат на оригинал, если успели подменить
    if (img.src !== original) img.src = original;
  };

  preload.src = proxy;
}


  let resetPressTimer = null;
  let didLongPress = false;
  const LONG_PRESS_MS = 800;

  function clearResetTimer() {
    if (resetPressTimer) {
      clearTimeout(resetPressTimer);
      resetPressTimer = null;
    }
  }

  let lastStateSnapshot = null;
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

    updateSpeedColor(st.c1);
  }

  function hardReset({ withTasks = false } = {}) {
    Core.resetAll();

    if (withTasks) {
      try {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(FINISHED_KEY);
        localStorage.removeItem('luht_freezer_last_clean_ts_v1');
      } catch (e) {}
      taskList = [];
      if (isOpen && pickerList) {
        throttledUpdateList(taskList);
        throttledUpdateHighlight();
      }
    }

    try {
      localStorage.setItem('imageTurboEnabled', 'false');
    } catch (e) {}

    try { localStorage.removeItem('imageTurboProxyDead'); } catch(e) {}


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
      } catch (e) {
        img.src = img.src.split('?')[0] + '?_r=' + Date.now();
      }
    }

    lastStateSnapshot = null;
    Core.setAlreadyCounted(false);
    throttledUpdatePanel(true);
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

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearResetTimer();
  });

  function resetSpeedometerSession() {
    Core.resetAll();
    Core.setAlreadyCounted(false);
    lastSpeedClass = null;
    updateSpeedColor(0);
    lastStateSnapshot = null;
    throttledUpdatePanel(true);
    setTextIfChanged(rActive.value, Core.formatDuration(0));
    setTextIfChanged(rTotalTime.value, Core.formatDuration(0));
    showToast('Спидометр обнулён', 1000);
  }

  function hardResetCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(FINISHED_KEY);
      localStorage.removeItem('luht_freezer_last_clean_ts_v1');
    } catch (e) {}

    Core.setAlreadyCounted(false);
    taskList = [];
    if (isOpen && pickerList) {
      throttledUpdateList(taskList);
      throttledUpdateHighlight();
    }
    showToast('Кеш задач очищен', 1500);
  }

  function allowKeyPress(ev) {
    return !ev.repeat;
  }

  function isTypingField() {
    const active = document.activeElement;
    const tag = active && active.tagName && active.tagName.toLowerCase();
    return (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      (active && active.isContentEditable)
    );
  }

  let rDownAt = 0;
  let rTimer = null;
  let longRTriggered = false;

  document.addEventListener(
    'keydown',
    (ev) => {
      markWorking();
      const code = ev.code;
      const key = ev.key;
      const path = location.pathname;

      if (isTypingField()) return;

      if (code === 'KeyF') {
        ev.preventDefault();
        ev.stopPropagation();
        togglePicker();
        return;
      }

      if (code === 'Escape' && isOpen) {
        ev.preventDefault();
        ev.stopPropagation();
        closePicker();
        return;
      }

      if (key === 'F5') {
        ev.preventDefault();
        ev.stopPropagation();
        localStorage.setItem(RETURN_URL_KEY, path);
        location.href = '/v2/tasks/';
        return;
      }

      if (code === 'KeyR' && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
        ev.preventDefault();
        ev.stopPropagation();
        rDownAt = Date.now();
        longRTriggered = false;
        rTimer = setTimeout(() => {
          longRTriggered = true;
          hardResetCache();
        }, 700);
        return;
      }

      if (['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'].includes(code)) {
        ev.preventDefault();
        ev.stopPropagation();
        if (code === 'KeyW' || key === 'ArrowUp') {
          jumpCategory(+1);
          return;
        }
        if (code === 'KeyS' || key === 'ArrowDown') {
          jumpCategory(-1);
          return;
        }
      }

      if (code === 'Home') {
        ev.preventDefault();
        ev.stopPropagation();
        jumpCategory('first');
        return;
      }

      if (code === 'End') {
        ev.preventDefault();
        ev.stopPropagation();
        jumpCategory('last');
        return;
      }

      if (path === '/v2/tasks/') {
        if (code === 'KeyW' || key === 'ArrowUp') {
          if (!allowKeyPress(ev)) {
            ev.preventDefault();
            ev.stopPropagation();
            return;
          }
          ev.preventDefault();
          ev.stopPropagation();

          refreshListFromCurrentPageIfTasks();

          if (!taskList || taskList.length === 0) {
            let cached = loadCache();
            if (cached) cached = pruneFinishedFromList(cached);
            if (cached && cached.length) taskList = cached;
          }

          const first = taskList && taskList[0];
          if (first) safeNavigate(first.href, { ignoreWorking: true });
        }
        return;
      }

      if (!path.startsWith('/v2/task/')) return;

      if (code === 'KeyQ') {
        if (!allowKeyPress(ev)) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        let continueBtn = document.querySelector('a[href$="/queue/continue/"]');
        if (!continueBtn) {
          continueBtn = Array.from(document.querySelectorAll('a,button')).find(
            (el) => el.textContent && el.textContent.trim().toLowerCase() === 'continue annotation'
          );
        }
        if (continueBtn) {
          continueBtn.focus();
          continueBtn.click();
        }
        return;
      }

      const isNavKey =
        ['KeyW', 'KeyS', 'KeyA', 'KeyD'].includes(code) ||
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key);

      if (!isNavKey && !allowKeyPress(ev)) return;

      if (code === 'KeyA' || key === 'ArrowLeft') {
        ev.preventDefault();
        ev.stopPropagation();
        handleBack();
        return;
      }

      if (code === 'KeyD' || key === 'ArrowRight') {
        ev.preventDefault();
        ev.stopPropagation();
        const btnNext = document.querySelector(
          'a[href$="/next/"]:not([style*="display:none"]):not([hidden])'
        );
        if (btnNext) btnNext.click();
        return;
      }
    },
    { capture: true, passive: false }
  );

  document.addEventListener('keyup', (ev) => {
    if (ev.code !== 'KeyR') return;
    clearTimeout(rTimer);
    if (!longRTriggered) resetSpeedometerSession();
  });

  if (location.pathname === '/v2/tasks/') {
    myRequestIdleCallback(() => {
      refreshListFromCurrentPageIfTasks();
      const back = localStorage.getItem(RETURN_URL_KEY);
      if (back && typeof back === 'string' && back.startsWith('/')) {
        localStorage.removeItem(RETURN_URL_KEY);
        location.href = back;
      }
    });
  }

  let luht_backLock = false;
  let luht_prevBlock = false;

  function handleBack() {
    markWorking();
    if (luht_backLock) return;
    luht_backLock = true;
    setTimeout(() => {
      luht_backLock = false;
    }, 120);

    const h2 = document.querySelector('h2');
    const text = h2 ? h2.textContent : '';
    const isTaskFinished = /task finished|category finished|successed|completed/i.test(text);

    if (isTaskFinished) {
      const backReview =
        document.querySelector('a[href*="/queue/last/"]') ||
        Array.from(document.querySelectorAll('a')).find((a) =>
          (a.textContent || '').includes('Back to REVIEW')
        );
      if (backReview) {
        backReview.click();
        return;
      }
    }

    const btnPrev = document.querySelector('a[href$="/prev/"]');
    if (btnPrev) {
      btnPrev.click();
      luht_prevBlock = true;
      setTimeout(() => {
        luht_prevBlock = false;
      }, 150);
      return;
    }
  }

  document.addEventListener('click', (ev) => {
    markWorking();
    if (!isOpen) return;
    const isBtn = ev.target.closest('.luht-freezer-btn');
    const isPanel = ev.target.closest('.luht-freezer-panel');
    if (isBtn || isPanel) return;
    closePicker();
  });

  document.addEventListener(
    'click',
    (ev) => {
      markWorking();
      const el = ev.target.closest('a[href$="/prev/"], button[href$="/prev/"]');
      if (!el) return;
      if (luht_prevBlock) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        return false;
      }
      luht_prevBlock = true;
      setTimeout(() => {
        luht_prevBlock = false;
      }, 150);
    },
    true
  );

  document.addEventListener(
    'click',
    (ev) => {
      if (!/\/v2\/task\/.+\/queue\//.test(location.pathname)) return;

      const btn = ev.target.closest('button[name="label"]');
      if (btn) {
        markWorking();
        showInstantLabel(btn);
        if (!Core.getAlreadyCounted()) {
          Core.setAlreadyCounted(true);
          Core.addEvent();
          Core.registerClickActivity();
        }
        throttledUpdatePanel();
        return;
      }

      const prev = ev.target.closest('a[href$="/prev/"]');
      if (prev) {
        markWorking();
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
        if (
          (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) ||
          (active && active.isContentEditable)
        )
          return;

        markWorking();
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

  function mainUILoop() {
    if (!isWorking) {
      throttledUpdatePanel();
      updateLastLabelBadge();
    }
    setTimeout(() => myRequestIdleCallback(mainUILoop), 200);
  }

  function startLoops() {
    mainUILoop();
  }

  let htmxLock = false;
  function setupHtmxListener() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', setupHtmxListener);
      return;
    }

    document.body.addEventListener('htmx:afterSwap', () => {
      if (htmxLock) return;
      htmxLock = true;

      markWorking();
      Core.setAlreadyCounted(false);
      Core.notifySwap && Core.notifySwap();
      currentImg = null;
      applyImageTurbo();

      const finishedAdded = markFinishedFromUrl();
      if (finishedAdded) {
        removeCompletedFromCache();

        taskList = pruneFinishedFromList(taskList || []);
        if (taskList.length) saveCache(taskList);

        if (isOpen) throttledUpdateList(taskList);
        throttledUpdateHighlight();

        if (!taskList || taskList.length < 3) {
          fetchTaskList(true)
            .then((list) => {
              taskList = pruneFinishedFromList(list || []);
              if (taskList.length) saveCache(taskList);
              if (isOpen) throttledUpdateList(taskList);
              throttledUpdateHighlight();
            })
            .catch(() => {});
        }
      }

      throttledUpdatePanel();
      updateLastLabelBadge();
      throttledUpdateHighlight();

      firstSwapDone = true;
      if (listBuilt && firstSwapDone) listReady = true;

      if (location.pathname === '/v2/tasks/') refreshListFromCurrentPageIfTasks();

      htmxLock = false;
    });
  }

  setupHtmxListener();

  let __luht_lastPath = location.pathname;
  setInterval(() => {
  if (document.hidden) return;
  if (isOpen) return;            // чтобы не лагало при открытой панельке
  if (isWorking) return;         // не мешать во время работы
  fetchTaskList(false).then((list) => {
    if (list && list.length) {
      taskList = pruneFinishedFromList(list);
      saveCache(taskList);
    }
  }).catch(()=>{});
}, 15 * 60 * 1000);

  async function init() {
    removeCompletedFromCache();
    createFreezerUI();

    let list = loadCache();
    if (list) list = pruneFinishedFromList(list);

    if (!list || list.length < 5) {
      if (location.pathname === '/v2/tasks/') list = parseTaskListFromDocument(document);
      else list = await fetchTaskList(true);
    }

    list = pruneFinishedFromList(list) || [];
    taskList = list;

    if (taskList && taskList.length) saveCache(taskList);
    throttledUpdateList(taskList);
    throttledUpdateHighlight();

    const hasRealHtmx = document.querySelector('[hx-get]');
    if (!hasRealHtmx) firstSwapDone = true;
    listBuilt = true;
    if (listBuilt && firstSwapDone) listReady = true;

    setTimeout(() => {
      if (!taskList || taskList.length < 5) {
        fetchTaskList(true)
          .then((list) => {
            if (list && list.length) {
              taskList = pruneFinishedFromList(list);
              saveCache(taskList);
              if (pickerList && isOpen) throttledUpdateList(taskList);
              throttledUpdateHighlight();
            }
          })
          .catch(() => {});
      }
    }, 100);
  }

  setInterval(() => {
    removeCompletedFromCache();
    if (taskList) {
      taskList = pruneFinishedFromList(taskList);
      if (isOpen) throttledUpdateList(taskList);
      throttledUpdateHighlight();
    }
  }, 60000);

  window.addEventListener('beforeunload', () => {
    isRefreshing = false;
    htmxLock = false;
    jumpLock = false;
    luht_backLock = false;
    luht_prevBlock = false;
  });

    (async () => {
    await init();

    if (markFinishedFromUrl()) {
      removeCompletedFromCache();
      taskList = pruneFinishedFromList(taskList || []);
      if (taskList.length) saveCache(taskList);
      if (isOpen) throttledUpdateList(taskList);
      throttledUpdateHighlight();
    }

    throttledUpdatePanel(true);
    updateLastLabelBadge();
  })();
})();
