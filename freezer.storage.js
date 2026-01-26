// freezer.storage.js
'use strict';

(function (ns) {
  const S = ns.state;

  // ============================
  //   SYNC BETWEEN TABS
  // ============================
  // ВАЖНО: объявляем ДО функций, которые могут его дергать
  const finishedSync = window.BroadcastChannel ? new BroadcastChannel('luht_finished_sync') : null;

  if (finishedSync) {
    finishedSync.onmessage = () => {
      try {
        // Обновляем список в памяти (НЕ ломаем дубликаты — filter по finished сохраняет повторы)
        S.taskList = ns.pruneFinishedFromList(S.taskList || []);

        // UI обновляем только если панель открыта
        if (S.isOpen) {
          ns.updateTaskListSmart(S.taskList);
          ns.updateActiveHighlight();
        }
      } catch {}
    };
  }

  // ============================
  //   LRU CACHE
  // ============================
  ns.LRUCache = class {
    constructor(capacity) {
      this.capacity = Math.max(1, capacity | 0);
      this.cache = new Map();
    }
    get(key) {
      if (!this.cache.has(key)) return undefined;
      const value = this.cache.get(key);
      // refresh LRU order
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    set(key, value) {
      if (this.cache.has(key)) this.cache.delete(key);
      this.cache.set(key, value);
      if (this.cache.size > this.capacity) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
    }
  };

  // Кеш для быстрого получения ID задачи из пути
  ns.taskIdCache = new ns.LRUCache(ns.MAX_CACHE_SIZE);

  // Извлекает цифровой ID задачи из URL (или null)
  ns.getTaskIdFromPath = function (path) {
    const key = String(path || '');
    const cached = ns.taskIdCache.get(key);
    // cached может быть null, это валидное значение: значит "не матчится"
    if (cached !== undefined) return cached;

    const m = key.match(/\/v2\/task\/(\d+)\//);
    const id = m ? m[1] : null;
    ns.taskIdCache.set(key, id);
    return id;
  };

  // ============================
  //   FINISHED IDS (localStorage)
  // ============================
  ns.loadFinishedIds = function () {
    try {
      const raw = localStorage.getItem(ns.FINISHED_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  };

  ns.saveFinishedIds = function (ids) {
    const arr = Array.isArray(ids) ? ids : [];
    try {
      localStorage.setItem(ns.FINISHED_KEY, JSON.stringify(arr));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        try {
          localStorage.setItem(ns.FINISHED_KEY, JSON.stringify(arr.slice(-100)));
        } catch {}
      }
    }

    // синк между вкладками — best effort
    if (finishedSync) {
      try {
        finishedSync.postMessage('update');
      } catch {}
    }
  };

  // Удаляет из списка задачи, которые уже завершены
  // ВАЖНО: не пытаемся дедупить — только фильтруем finished.
  ns.pruneFinishedFromList = function (list) {
    if (!Array.isArray(list) || list.length === 0) return list;

    const finishedIds = ns.loadFinishedIds();
    if (!finishedIds || finishedIds.length === 0) return list;

    const finishedSet = new Set(finishedIds);
    return list.filter((t) => {
      const href = String(t && t.href ? t.href : '');
      if (!href) return false;
      const id = ns.getTaskIdFromPath(href);
      // если id не нашли — оставляем элемент (чтобы не потерять странные/новые ссылки)
      if (!id) return true;
      return !finishedSet.has(id);
    });
  };

  // Если URL говорит что задача завершена — добавляем в FINISHED
  ns.markFinishedFromUrl = function () {
    const m = location.pathname.match(/^\/v2\/task\/(\d+)\/queue\/continue\/?/);
    if (!m) return false;

    const id = m[1];
    const ids = ns.loadFinishedIds();
    if (ids.includes(id)) return false;

    ids.push(id);
    ns.saveFinishedIds(ids);
    return true;
  };

  // ============================
  //   TASKLIST CACHE (localStorage)
  // ============================
  ns.loadCache = function () {
    try {
      const raw = localStorage.getItem(ns.CACHE_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) ? arr : null;
    } catch {
      return null;
    }
  };

  ns.saveCache = function (list) {
    try {
      if (!Array.isArray(list) || list.length === 0) return;
      localStorage.setItem(ns.CACHE_KEY, JSON.stringify(list));
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        try {
          localStorage.setItem(ns.CACHE_KEY, JSON.stringify(list.slice(-500)));
        } catch {}
      }
    }
  };

  // Удаляет завершённые задачи из кэша
  ns.removeCompletedFromCache = function () {
    const list = ns.loadCache();
    if (!list) return;

    const pruned = ns.pruneFinishedFromList(list);
    if (pruned && pruned.length) {
      ns.saveCache(pruned);
    } else {
      try {
        localStorage.removeItem(ns.CACHE_KEY);
      } catch {}
    }
  };
})(window.LUHT.freezer);
