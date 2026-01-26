// freezer.parser.js
'use strict';

(function (ns) {
  // Нормализует href в абсолютный URL (string) или null
  ns.normalizeHref = function (href) {
    try {
      if (!href || typeof href !== 'string') return null;
      const u = new URL(href, location.origin);
      return u.href;
    } catch {
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

    const blocked = ['299', '399', 'микс желейный', 'конфеты комбинированные'];
    for (const b of blocked) {
      if (t.includes(b)) return true;
    }
    return false;
  }

  // Парсит документ и извлекает список задач [{ href, title }]
  // ВАЖНО: НЕ дедупим, чтобы повторяющиеся категории/задачи тоже отображались.
  ns.parseTaskListFromDocument = function (doc) {
    try {
      const root = doc && doc.querySelector ? doc : document;

      const links = root.querySelectorAll('a[href*="/v2/task/"]');
      if (!links || !links.length) return [];

      const finishedIds = ns.loadFinishedIds();
      const finishedSet = new Set(Array.isArray(finishedIds) ? finishedIds : []);

      const out = [];

      links.forEach((a) => {
        try {
          const rawTitle = a.textContent || '';
          const title = normalizeTitle(rawTitle);
          if (isBlockedTitle(title)) return;

          const abs = ns.normalizeHref(a.getAttribute('href') || a.href);
          if (!abs) return;

          const id = ns.getTaskIdFromPath(abs);
          if (id && finishedSet.has(id)) return;

          out.push({ href: abs, title });
        } catch {
          // ignore single link
        }
      });

      return out;
    } catch {
      return [];
    }
  };
})(window.LUHT.freezer);
