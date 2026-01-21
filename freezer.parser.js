// freezer.parser.js
(function (ns) {
  'use strict';

  // Нормализует href в абсолютный URL (string) или null
  ns.normalizeHref = function (href) {
    try {
      if (!href || typeof href !== 'string') return null;
      const u = new URL(href, location.origin);
      return u.href;
    } catch (e) {
      return null;
    }
  };

  function normalizeTitle(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  // Фильтр нерелевантных задач/товаров по заголовку
  function isBlockedTitle(title) {
    const t = normalizeTitle(title).toLowerCase();
    if (!t) return true;

    // Твои фильтры, но аккуратнее (по подстроке)
    const blocked = [
      '299',
      '399',
      'микс желейный',
      'конфеты комбинированные'
    ];

    for (const b of blocked) {
      if (t.includes(b)) return true;
    }
    return false;
  }

  // Ключ для дедупликации ссылок: pathname + search (хвосты типа # не важны)
  function hrefKey(absHref) {
    try {
      const u = new URL(absHref, location.origin);
      return (u.pathname || '') + (u.search || '');
    } catch (e) {
      return String(absHref || '');
    }
  }

  // Парсит документ и извлекает список задач [{ href, title }]
  ns.parseTaskListFromDocument = function (doc) {
    try {
      const root = doc && doc.querySelector ? doc : document;

      const links = root.querySelectorAll('a[href*="/v2/task/"]');
      if (!links || !links.length) return [];

      const finishedIds = ns.loadFinishedIds();
      const finishedSet = new Set(finishedIds || []);

      const out = [];
      const seenHrefKeys = new Set();
      const seenIds = new Set();

      links.forEach((a) => {
        try {
          const rawTitle = a.textContent || '';
          const title = normalizeTitle(rawTitle);
          if (isBlockedTitle(title)) return;

          const abs = ns.normalizeHref(a.getAttribute('href') || a.href);
          if (!abs) return;

          const key = hrefKey(abs);
          if (seenHrefKeys.has(key)) return;

          const id = ns.getTaskIdFromPath(abs);
          // если удалось вытащить id — дедуп по id ещё жёстче
          if (id) {
            if (seenIds.has(id)) return;
            if (finishedSet.has(id)) return;
            seenIds.add(id);
          }

          seenHrefKeys.add(key);
          out.push({ href: abs, title });
        } catch (e) {
          // ignore single link
        }
      });

      return out;
    } catch (e) {
      return [];
    }
  };
})(window.LUHT.freezer);
