// freezer.net.js
'use strict';

(function (ns) {
  const S = ns.state;

  // Один общий in-flight запрос, чтобы не плодить параллельные fetch'и
  let inflightTaskListPromise = null;

  // ============================
  //   SMALL UTILS (LOCAL)
  // ============================
  function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  function safeListFallback() {
    // 1) память
    if (Array.isArray(S.taskList) && S.taskList.length) return S.taskList;

    // 2) кэш
    try {
      const cached = ns.loadCache();
      if (Array.isArray(cached) && cached.length) return cached;
    } catch {}

    // 3) пусто
    return [];
  }

  // ============================
  //   FETCH HELPERS
  // ============================
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

    // Без AbortController — race (fetch сеть не отменит, но код перестанет ждать)
    return await Promise.race([
      fetch(url, opts),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), t)),
    ]);
  };

  ns.fetchTextWithRetry = async function (
    url,
    { tries = 3, timeoutMs = 30000, backoffBaseMs = 180, backoffJitterMs = 90 } = {}
  ) {
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
          const wait = backoffBaseMs * attempt + Math.floor(Math.random() * backoffJitterMs);
          await sleep(wait);
        } catch {}
      }
    }

    throw lastErr || new Error('fetchTextWithRetry failed');
  };

  // ============================
  //   TASK LIST FETCH
  // ============================
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
      timeoutMs: 30000,
    });

    const doc = new DOMParser().parseFromString(html, 'text/html');
    let arr = ns.parseTaskListFromDocument(doc);

    // На всякий — убираем выполненные
    arr = ns.pruneFinishedFromList(arr || []);

    // ВАЖНО: чтобы "обновление списка во время работы" работало стабильно,
    // мы обновляем S.taskList даже если массив пустой, но только если force=true.
    // Иначе можно случайно перетереть валидный список временным пустым ответом.
    if (Array.isArray(arr) && arr.length) {
      S.taskList = arr;
      S.lastTaskListFetchTS = now;
      try {
        ns.saveCache(arr);
      } catch {}
      return arr;
    }

    if (force && Array.isArray(arr)) {
      S.taskList = arr;
      S.lastTaskListFetchTS = now;
      // пустое в кэш не пишем
      return arr;
    }

    // Если распарсилось пусто — fallback
    return safeListFallback();
  }

  // Публичная: загрузка списка задач с TTL/force + дедуп in-flight
  ns.fetchTaskList = async function (force = false) {
    const wantForce = !!force;

    // Если уже идёт запрос:
    // - если текущий запрос НЕ force, а нам нужно force — стартуем новый force-запрос
    // - иначе ждём текущий
    if (inflightTaskListPromise) {
      if (!inflightTaskListPromise.__force && wantForce) {
        // отменить нельзя, но мы "переключаемся" на новый более важный запрос
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
