// freezer.utils.js
(function (ns) {
  'use strict';

  const S = ns.state;

  // requestIdleCallback с фоллбеком (и безопасным bind)
(function initIdle() {
  const ric = window.requestIdleCallback;
  const cic = window.cancelIdleCallback;

  if (typeof ric === 'function') {
    // bind на window — убивает Illegal invocation
    ns.myRequestIdleCallback = ric.bind(window);
  } else {
    ns.myRequestIdleCallback = function (cb, opts) {
      const timeout = (opts && typeof opts.timeout === 'number') ? opts.timeout : 50;
      return setTimeout(() => {
        const start = Date.now();
        cb({
          didTimeout: true,
          timeRemaining() {
            return Math.max(0, 50 - (Date.now() - start));
          }
        });
      }, timeout);
    };
  }

  if (typeof cic === 'function') {
    ns.myCancelIdleCallback = cic.bind(window);
  } else {
    ns.myCancelIdleCallback = function (id) { clearTimeout(id); };
  }
})();

  // Обновляет textContent только если реально изменилось
  ns.setTextIfChanged = function (el, value) {
    if (!el) return;
    const str = value != null ? String(value) : '';
    if (el.textContent !== str) el.textContent = str;
  };

  // Toast
  ns.showToast = function (message, duration = 2500) {
    try {
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
    } catch (e) {
      // ignore
    }
  };

  // Trailing-throttle (последний вызов гарантирован)
  // - корректно сохраняет последние args/this
  // - flush() выполняет немедленно последний отложенный вызов
  // - cancel() отменяет отложенный вызов
  ns.throttleTrailing = function (fn, delay) {
    let lastExec = 0;
    let timer = null;
    let lastArgs = null;
    let lastThis = null;

    function invoke(now) {
      lastExec = now;
      const args = lastArgs;
      const ctx = lastThis;
      lastArgs = null;
      lastThis = null;
      try {
        return fn.apply(ctx, args || []);
      } catch (e) {
        // не роняем расширение из-за одной ошибки в UI
        try { console.error('[LUHT] throttled fn error', e); } catch {}
      }
    }

    function scheduled() {
      timer = null;
      invoke(Date.now());
    }

    const wrapped = function (...args) {
      const now = Date.now();
      lastArgs = args;
      lastThis = this;

      const elapsed = now - lastExec;
      const remaining = delay - elapsed;

      if (remaining <= 0) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        return invoke(now);
      }

      if (!timer) {
        timer = setTimeout(scheduled, remaining);
      }
    };

    wrapped.cancel = function () {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastArgs = null;
      lastThis = null;
    };

    wrapped.flush = function () {
      if (!lastArgs) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return invoke(Date.now());
    };

    return wrapped;
  };

  // Promise delay
  ns.delay = function (ms) {
    return new Promise((res) => setTimeout(res, ms));
  };

  // Safe error logger
  ns.logError = function (message, error) {
    try {
      console.error('[LUHT]', message, error);
    } catch (e) {
      // ignore
    }
  };
})(window.LUHT.freezer);
