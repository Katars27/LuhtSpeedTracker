// injector.js
'use strict';

(function turboHacks() {
  // защита от двойной инъекции (htmx/повторные вставки/реинжект контент-скрипта)
  if (window.__luht_injector_loaded) return;
  window.__luht_injector_loaded = true;

  // безопасный bootstrap неймспейсов (чтобы другие файлы могли опираться на это без сюрпризов)
  window.LUHT = window.LUHT || {};
  window.LUHT.freezer = window.LUHT.freezer || {};

  const domains = [
    'https://luht.tp2.intropy.tech',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
  ];

  const FONT_CSS_HREF =
    'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap';

  const PRECONNECT_MARK = 'data-luht-preconnect';
  const PRELOAD_MARK = 'data-luht-preload-geist';

  const escapeCss = (s) => {
    try {
      if (typeof CSS !== 'undefined' && CSS && typeof CSS.escape === 'function') return CSS.escape(String(s));
    } catch (e) {}
    // минимальный фоллбек: экранируем кавычки и обратные слэши
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  };

  function ensureHeadReady() {
    return !!(document.head && document.head.appendChild);
  }

  function alreadyHasLink(rel, href, markAttr) {
    if (!document.head) return false;

    const relSel = `link[rel="${escapeCss(rel)}"]`;
    const hrefSel = `href="${escapeCss(href)}"`;
    const markSel = markAttr ? `[${markAttr}="1"]` : '';

    // ВАЖНО: даже если есть маркер — всё равно проверяем href,
    // иначе один preconnect с маркером заблокирует добавление остальных доменов.
    const sel = `${relSel}[${hrefSel}]${markSel}`;
    if (document.head.querySelector(sel)) return true;

    // fallback: на случай старых версий без маркера
    return !!document.head.querySelector(`${relSel}[${hrefSel}]`);
  }

  function addLink({ rel, href, as, crossOrigin, mark }) {
    if (!document.head) return;
    if (!href || !rel) return;
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

    // preconnect (без дублей, но с поддержкой нескольких доменов)
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
      href: FONT_CSS_HREF,
      as: 'style',
      mark: PRELOAD_MARK,
    });

    // preload не применяет стиль — добавляем stylesheet (без дублей)
    addLink({
      rel: 'stylesheet',
      href: FONT_CSS_HREF,
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

  try {
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {
    // если observe упал — попробуем ещё раз на DOMContentLoaded
  }

  // На всякий: после DOMContentLoaded тоже попробуем (и отцепимся)
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      try { inject(); } catch (e) {}
      try { observer.disconnect(); } catch (e) {}
    },
    { once: true }
  );

  // страховка: не держим наблюдатель вечно
  setTimeout(() => {
    try { observer.disconnect(); } catch (e) {}
  }, 10_000);
})();
