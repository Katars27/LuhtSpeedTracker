// injector.js
'use strict';

(function turboHacks() {
  // защита от двойной инъекции (htmx/повторные вставки/реинжект контент-скрипта)
  if (window.__luht_injector_loaded) return;
  window.__luht_injector_loaded = true;

  const domains = [
    'https://luht.tp2.intropy.tech',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
  ];

  const PRECONNECT_MARK = 'data-luht-preconnect';
  const PRELOAD_MARK = 'data-luht-preload-geist';

  function ensureHeadReady() {
    return !!(document.head && document.head.appendChild);
  }

  function alreadyHasLink(rel, href, markAttr) {
    if (!document.head) return false;
    const sel = markAttr
      ? `link[rel="${rel}"][${markAttr}="1"]`
      : `link[rel="${rel}"][href="${CSS.escape(href)}"]`;
    if (document.head.querySelector(sel)) return true;

    // fallback: если не нашли по маркеру — ищем по rel+href (на случай старых версий)
    return !!document.head.querySelector(`link[rel="${rel}"][href="${CSS.escape(href)}"]`);
  }

  function addLink({ rel, href, as, crossOrigin, mark }) {
    if (!document.head) return;
    if (alreadyHasLink(rel, href, mark)) return;

    const link = document.createElement('link');
    link.rel = rel;
    link.href = href;

    if (as) link.as = as;
    if (crossOrigin) link.crossOrigin = crossOrigin;

    if (mark) link.setAttribute(mark, '1');
    document.head.appendChild(link);
  }

  function inject() {
    if (!ensureHeadReady()) return false;

    // preconnect (без дублей)
    for (const domain of domains) {
      addLink({
        rel: 'preconnect',
        href: domain,
        crossOrigin: domain.includes('gstatic') ? 'anonymous' : undefined,
        mark: PRECONNECT_MARK,
      });
    }

    // preload CSS Google Fonts (Geist)
    addLink({
      rel: 'preload',
      href: 'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap',
      as: 'style',
      mark: PRELOAD_MARK,
    });

    // ВАЖНО: preload не применяет стиль сам по себе.
    // Чтобы реально ускорить и применить шрифт — добавим stylesheet, если его ещё нет.
    addLink({
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap',
      mark: PRELOAD_MARK,
    });

    return true;
  }

  // Пытаемся сразу
  if (inject()) return;

  // Если head ещё нет — наблюдаем за деревом до первого успеха
  const observer = new MutationObserver(() => {
    if (inject()) observer.disconnect();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // На всякий: после DOMContentLoaded тоже попробуем (и отцепимся)
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      inject();
      observer.disconnect();
    },
    { once: true }
  );
})();
