// freezer.turbo.js
'use strict';

(function (ns) {
  const S = ns.state;

  const ENABLE_KEY = 'imageTurboEnabled';
  const META_KEY = 'luhtTurboMetaV3';   // { [url]: ts }
  const TTL_MS = 20 * 60 * 1000;        // 20 минут
  const MAX_TRACKED = 500;              // только учёт, не реальный кеш

  function isEnabled() {
    try { return localStorage.getItem(ENABLE_KEY) === 'true'; } catch { return false; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(ENABLE_KEY, on ? 'true' : 'false'); } catch {}
  }

  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}') || {}; } catch { return {}; }
  }
  function writeMeta(meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
  }

  function gcMeta(meta) {
    const now = Date.now();
    // TTL
    for (const k of Object.keys(meta)) {
      if (now - (meta[k] || 0) > TTL_MS) delete meta[k];
    }
    // size
    const keys = Object.keys(meta);
    if (keys.length > MAX_TRACKED) {
      keys.sort((a,b) => (meta[a]||0) - (meta[b]||0));
      for (let i = 0; i < keys.length - MAX_TRACKED; i++) delete meta[keys[i]];
    }
  }

  function canPrefetchNow() {
    try {
      if (document.visibilityState !== 'visible') return false;
      const c = navigator.connection;
      if (!c) return true;
      if (c.saveData) return false;
      const et = (c.effectiveType || '').toLowerCase();
      if (et.includes('2g')) return false;
      return true;
    } catch { return true; }
  }

  ns.getCurrentImage = function () {
    try {
      if (S.currentImg && (document.body || document.documentElement).contains(S.currentImg)) return S.currentImg;
    } catch {}
    S.currentImg = document.querySelector('img[alt="Image to annotate"]');
    return S.currentImg;
  };

  // UI toggle оставь свой; главное — чтобы ns.applyImageTurbo вызывался.
  // Я тут только статус обновляю, если он есть:
  function setStatus(text, opacity=1) {
    if (!S.turboIcon) return;
    S.turboIcon.textContent = text;
    S.turboIcon.style.opacity = String(opacity);
  }

  function extractAnnotateImgSrc(html) {
    const m = html.match(/<img[^>]+alt="Image to annotate"[^>]+src="([^"]+)"/i);
    return m?.[1] || null;
  }

  function getNextLink() {
    const a = document.querySelector('a[href*="/next/"]');
    return a?.href || null;
  }

  // ВАЖНО: preload через Image, а не CacheStorage
  function preloadImage(url) {
    return new Promise((resolve) => {
      try {
        const u = new URL(url, location.href);
        if (u.origin !== location.origin) return resolve(false);

        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = u.toString();
      } catch {
        resolve(false);
      }
    });
  }

  async function prefetchNextImage() {
    const nextHref = getNextLink();
    if (!nextHref) return false;

    const res = await fetch(nextHref, { credentials: 'include' });
    if (!res.ok) return false;

    const html = await res.text();
    const src = extractAnnotateImgSrc(html);
    if (!src) return false;

    const abs = new URL(src, location.href).toString();
    return await preloadImage(abs);
  }

  ns.applyImageTurbo = async function () {
    if (!isEnabled()) return;

    if (!canPrefetchNow()) {
      setStatus('💨 Turbo: пауза (сеть)', 0.7);
      return;
    }

    const img = ns.getCurrentImage();
    if (!img?.src) return;

    // не повторяемся на одном и том же изображении
    if (img.dataset.turboSeen === img.src) return;
    img.dataset.turboSeen = img.src;

    const meta = readMeta();
    gcMeta(meta);

    const now = Date.now();

    // 1) preload текущей (часто уже загружена, но пусть)
    if (!meta[img.src]) {
      meta[img.src] = now;
      writeMeta(meta);
      setStatus('💨 Turbo: preload current…', 0.9);
      await preloadImage(img.src);
    }

    // 2) preload next (главный буст)
    setStatus('💨 Turbo: preload next…', 0.9);
    const ok = await prefetchNextImage();
    setStatus(ok ? '💨 Turbo: next готов' : '⚠️ Turbo: next не вышел', ok ? 1 : 0.7);

    // записываем “я это уже пробовал недавно”
    meta['__last'] = now;
    writeMeta(meta);
  };

})(window.LUHT?.freezer || {});
