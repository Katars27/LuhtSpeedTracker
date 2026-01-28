// freezer.turbo.js
'use strict';

(function () {
  // ---- attach to LUHT namespace safely
  const root = window.LUHT = window.LUHT || {};
  const ns = root.freezer = root.freezer || {};
  const S = ns.state = ns.state || {};

  // ---- settings
  const ENABLE_KEY = 'imageTurboEnabled';

  // meta: не чистим реальный browser cache, но избегаем бесконечных повторов
  const META_KEY = 'luhtTurboMetaV4';      // { [url]: ts }
  const TTL_MS = 20 * 60 * 1000;           // 20 минут
  const MAX_TRACKED = 500;

  // behavior
  const NEXT_FETCH_TIMEOUT_MS = 3500;
  const MIN_RUN_INTERVAL_MS = 250;
  const PREFETCH_ONLY_WHEN_VISIBLE = true;
  const SKIP_ON_SAVE_DATA = true;
  const SKIP_ON_2G = true;

  // ---- "как раньше" (wsrv webp proxy)
  const PROXY_BASE = 'https://wsrv.nl/';
  const WEBP_QUALITY = 87;
  const MAX_WIDTH = 1600;                  // как раньше
  const WIDTH_FACTOR = 1.5;                // как раньше
  const FIT = 'contain';

  // Safety: если боишься сливать приватные URL наружу — поставь false.
  // (wsrv.nl видит URL оригинала, иначе он не сможет его сжать)
  const ALLOW_EXTERNAL_PROXY = true;

  // ---- utils
  function now() { return Date.now(); }

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
    const t = now();
    for (const k of Object.keys(meta)) {
      if (t - (meta[k] || 0) > TTL_MS) delete meta[k];
    }
    const keys = Object.keys(meta);
    if (keys.length > MAX_TRACKED) {
      keys.sort((a, b) => (meta[a] || 0) - (meta[b] || 0));
      for (let i = 0; i < keys.length - MAX_TRACKED; i++) delete meta[keys[i]];
    }
  }

  function canPrefetchNow() {
    try {
      if (PREFETCH_ONLY_WHEN_VISIBLE && document.visibilityState !== 'visible') return false;
      const c = navigator.connection;
      if (!c) return true;
      if (SKIP_ON_SAVE_DATA && c.saveData) return false;
      const et = (c.effectiveType || '').toLowerCase();
      if (SKIP_ON_2G && et.includes('2g')) return false;
      return true;
    } catch {
      return true;
    }
  }

  function setStatus(text, opacity = 1) {
    if (!S.turboIcon) return;
    S.turboIcon.textContent = text;
    S.turboIcon.style.opacity = String(opacity);
  }

  function computeWidth() {
    const w = Math.floor(Math.min(MAX_WIDTH, (window.innerWidth || 1200) * WIDTH_FACTOR));
    return Math.max(320, w);
  }

  function isAlreadyOptimized(url) {
    if (!url) return true;
    const u = String(url).toLowerCase();
    return u.endsWith('.webp') || u.endsWith('.svg') || u.startsWith(PROXY_BASE);
  }

  function looksSensitive(url) {
    // тупая, но полезная эвристика: токены/подписи/секретные query
    try {
      const u = new URL(url, location.href);
      const qs = u.search.toLowerCase();
      return /token=|signature=|sig=|expires=|x-amz-signature=|x-amz-credential=|auth=|session=/.test(qs);
    } catch {
      return false;
    }
  }

  function buildProxyUrl(originalUrl) {
    const width = computeWidth();
    const prox = new URL(PROXY_BASE);
    prox.searchParams.set('url', originalUrl);
    prox.searchParams.set('w', String(width));
    prox.searchParams.set('q', String(WEBP_QUALITY));
    prox.searchParams.set('output', 'webp');
    prox.searchParams.set('fit', FIT);
    return prox.toString();
  }

  // ---- find current image
  ns.getCurrentImage = function () {
    try {
      if (S.currentImg && (document.body || document.documentElement).contains(S.currentImg)) {
        return S.currentImg;
      }
    } catch {}
    S.currentImg = document.querySelector('img[alt="Image to annotate"]');
    return S.currentImg;
  };

  // ---- next link (best-effort)
  function getNextLink() {
    const byId = document.querySelector('#luht-next');
    if (byId && byId.href) return byId.href;
    const a = document.querySelector('a[href*="/next/"]');
    return a?.href || null;
  }

  function extractAnnotateImgSrc(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const img = doc.querySelector('img[alt="Image to annotate"]');
      if (!img) return null;
      return (
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-lazy-src') ||
        null
      );
    } catch {
      return null;
    }
  }

  function preloadImage(url) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
      } catch {
        resolve(false);
      }
    });
  }

  async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { credentials: 'include', signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async function prefetchNextImageViaProxy() {
    const nextHref = getNextLink();
    if (!nextHref) return { ok: false, reason: 'no-next-link' };

    const res = await fetchWithTimeout(nextHref, NEXT_FETCH_TIMEOUT_MS);
    if (!res.ok) return { ok: false, reason: 'next-fetch-not-ok' };

    const html = await res.text();
    const src = extractAnnotateImgSrc(html);
    if (!src) return { ok: false, reason: 'no-img-in-next-html' };

    const abs = new URL(src, nextHref).toString();

    // Если прокси отключён — просто прогреем оригинал (иногда тоже полезно)
    if (!ALLOW_EXTERNAL_PROXY) {
      const ok0 = await preloadImage(abs);
      return { ok: ok0, reason: ok0 ? 'preloaded-original' : 'img-onerror', url: abs };
    }

    // Если URL выглядит “чувствительным” — лучше не слать наружу
    if (looksSensitive(abs)) {
      const ok0 = await preloadImage(abs);
      return { ok: ok0, reason: ok0 ? 'preloaded-original-sensitive' : 'img-onerror', url: abs };
    }

    const proxy = buildProxyUrl(abs);
    const ok = await preloadImage(proxy);
    return { ok, reason: ok ? 'preloaded-proxy' : 'proxy-onerror', url: proxy, original: abs };
  }

  // ---- UI toggle (как у тебя)
  function findRowsContainer() {
    return (
      document.querySelector('.luht-rows') ||
      document.querySelector('.luht-stats') ||
      document.querySelector('#luht-stats') ||
      document.querySelector('aside') ||
      null
    );
  }

  ns.createTurboToggle = function (rowsContainer) {
    rowsContainer = rowsContainer || findRowsContainer();
    if (!rowsContainer) return;
    if (S.turboRow && rowsContainer.contains(S.turboRow)) return;

    const row = document.createElement('div');
    row.className = 'luht-row luht-turbo-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '10px';
    row.style.padding = '8px 0';

    const label = document.createElement('span');
    label.className = 'luht-row-label';
    label.textContent = 'Image Turbo';

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '10px';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = 'image-turbo-toggle';
    toggle.checked = isEnabled();

    const status = document.createElement('span');
    status.style.fontSize = '14px';
    status.style.transition = 'opacity 0.2s ease';
    status.textContent = toggle.checked ? '💨 WebP (proxy) + next' : 'Выключено';
    status.style.opacity = toggle.checked ? '1' : '0.5';

    let debounceTimer = null;
    toggle.addEventListener('change', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const on = !!toggle.checked;
        setEnabled(on);
        if (!on) {
          status.textContent = 'Выключено';
          status.style.opacity = '0.5';
          return;
        }
        status.textContent = '💨 WebP (proxy) + next';
        status.style.opacity = '1';
        ns.applyImageTurbo();
      }, 120);
    });

    right.appendChild(toggle);
    right.appendChild(status);
    row.appendChild(label);
    row.appendChild(right);
    rowsContainer.appendChild(row);

    S.turboRow = row;
    S.turboToggle = toggle;
    S.turboIcon = status;
  };

  // ---- core: "как раньше" + префетч next
  async function optimizeCurrentImage(img) {
    if (!img || !img.src) return { ok: false, reason: 'no-img' };

    const original = img.dataset.turboOriginal || img.src;

    if (isAlreadyOptimized(img.src)) return { ok: true, reason: 'already-optimized' };
    if (!ALLOW_EXTERNAL_PROXY) return { ok: false, reason: 'proxy-disabled' };

    // Если URL выглядит чувствительным — не шлём наружу (лучше так, чем потом “ой”)
    if (looksSensitive(original)) return { ok: false, reason: 'sensitive-url-skip' };

    const proxy = buildProxyUrl(original);

    // preload proxy -> swap
    const ok = await preloadImage(proxy);
    if (!ok) return { ok: false, reason: 'proxy-onerror' };

    img.dataset.turboOriginal = original;
    img.dataset.webpOptimized = 'true';
    img.src = proxy;
    return { ok: true, reason: 'swapped', url: proxy };
  }

  ns.applyImageTurbo = async function () {
    if (!isEnabled()) return;

    const t = now();
    if (S._turboLastRun && t - S._turboLastRun < MIN_RUN_INTERVAL_MS) return;
    S._turboLastRun = t;

    if (!canPrefetchNow()) {
      setStatus('💨 Turbo: пауза (сеть)', 0.7);
      return;
    }

    const img = ns.getCurrentImage();
    if (!img?.src) return;

    // не повторяемся на одном и том же исходнике
    const srcKey = img.dataset.turboOriginal || img.src;
    if (img.dataset.turboSeen === srcKey) return;
    img.dataset.turboSeen = srcKey;

    const meta = readMeta();
    gcMeta(meta);
    const stamp = now();

    // 1) оптимизация текущей (как раньше)
    if (!meta[srcKey]) {
      meta[srcKey] = stamp;
      writeMeta(meta);
      setStatus('💨 Turbo: webp текущей…', 0.9);
      const r1 = await optimizeCurrentImage(img);
      if (!r1.ok && r1.reason === 'sensitive-url-skip') {
        setStatus('⚠️ Turbo: пропуск (чувствит. url)', 0.7);
      }
    } else {
      // если уже недавно делали — просто статус не душим
      setStatus('💨 Turbo: активно', 1);
    }

    // 2) префетч следующей (через proxy, если можно)
    setStatus('💨 Turbo: префетч next…', 0.9);
    try {
      const r2 = await prefetchNextImageViaProxy();
      setStatus(r2.ok ? '💨 Turbo: next готов' : `⚠️ Turbo: ${r2.reason}`, r2.ok ? 1 : 0.7);
    } catch (e) {
      setStatus('⚠️ Turbo: next error', 0.7);
    }

    meta.__last = stamp;
    writeMeta(meta);
  };

  // ---- periodic meta cleanup
  if (!S._turboGcTimer) {
    S._turboGcTimer = setInterval(() => {
      if (!isEnabled()) return;
      const meta = readMeta();
      gcMeta(meta);
      writeMeta(meta);
    }, 2 * 60 * 1000);
  }

  // ---- auto init
  function init() {
    ns.createTurboToggle();
    if (isEnabled()) ns.applyImageTurbo();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})();
