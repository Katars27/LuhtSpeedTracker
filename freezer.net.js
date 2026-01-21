// freezer.net.js
(function (ns) {
  'use strict';

  const S = ns.state;

  // Один общий in-flight запрос, чтобы не плодить параллельные fetch'и
  let inflightTaskListPromise = null;

  // Fetch с таймаутом
  ns.fetchWithTimeout = async function (url, opts = {}, timeoutMs) {
    const t = Math.max(1, Number(timeoutMs || 0) || 0);

    if (ns.HAS_ABORT) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), t);

      try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    // Без AbortController — race
    return await Promise.race([
      fetch(url, opts),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), t))
    ]);
  };

  // GET text с ретраями
  ns.fetchTextWithRetry = async function (url, { tries = 3, timeoutMs = 30000 } = {}) {
    const maxTries = Math.max(1, Number(tries) || 1);
    const t = Math.max(1000, Number(timeoutMs) || 30000);

    let lastErr = null;

    for (let attempt = 1; attempt <= maxTries; attempt++) {
      try {
        const res = await ns.fetchWithTimeout(
          url,
          { method: 'GET', credentials: 'include', cache: 'no-store' },
          t
        );

        if (!res || !res.ok) {
          throw new Error(`HTTP ${res ? res.status : 'NO_RESPONSE'}`);
        }

        return await res.text();
      } catch (e) {
        lastErr = e;
        // небольшая пауза с ростом
        try {
          await ns.delay(150 * attempt + Math.floor(Math.random() * 80));
        } catch (_) {}
      }
    }

    throw lastErr || new Error('fetchTextWithRetry failed');
  };

  function safeListFallback() {
    // 1) память
    if (Array.isArray(S.taskList) && S.taskList.length) return S.taskList;
    // 2) кэш
    const cached = ns.loadCache();
    if (Array.isArray(cached) && cached.length) return cached;
    // 3) пусто
    return [];
  }

  async function doFetchTaskList(force) {
    const now = Date.now();

    // TTL: если не force и список свежий — отдаём как есть
    if (
      !force &&
      Array.isArray(S.taskList) &&
      S.taskList.length &&
      now - (S.lastTaskListFetchTS || 0) < ns.TASKLIST_REFRESH_TTL_MS
    ) {
      return S.taskList;
    }

    // Пытаемся скачать и распарсить
    const html = await ns.fetchTextWithRetry('/v2/tasks/list/', {
      tries: 3,
      timeoutMs: 30000
    });

    const doc = new DOMParser().parseFromString(html, 'text/html');
    let arr = ns.parseTaskListFromDocument(doc);

    // На всякий — убираем выполненные
    arr = ns.pruneFinishedFromList(arr || []);

    if (Array.isArray(arr) && arr.length) {
      S.taskList = arr;
      S.lastTaskListFetchTS = now;
      ns.saveCache(arr);
      return arr;
    }

    // Если распарсилось пусто — fallback
    return safeListFallback();
  }

  // Публичная: загрузка списка задач с TTL/force + дедуп in-flight
  ns.fetchTaskList = async function (force = false) {
    const wantForce = !!force;

    // Если уже идёт запрос:
    // - если текущий запрос НЕ force, а нам нужно force — подменяем на новый force-запрос
    // - иначе ждём текущий
    if (inflightTaskListPromise) {
      if (!inflightTaskListPromise.__force && wantForce) {
        // отменить нельзя, но мы просто стартуем новый "важный" запрос
        inflightTaskListPromise = null;
      } else {
        return inflightTaskListPromise;
      }
    }

    const p = doFetchTaskList(wantForce)
      .catch(() => safeListFallback())
      .finally(() => {
        // Сброс in-flight только если это всё ещё текущий промис
        if (inflightTaskListPromise === p) inflightTaskListPromise = null;
      });

    // метка, был ли этот запрос force
    p.__force = wantForce;

    inflightTaskListPromise = p;
    return p;
  };
})(window.LUHT.freezer);
