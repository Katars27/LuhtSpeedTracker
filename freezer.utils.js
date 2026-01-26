// freezer.utils.js
'use strict';

(function (ns) {
  // requestIdleCallback с фоллбеком (и безопасным bind)
  (function initIdle() {
    const ric = window.requestIdleCallback;
    const cic = window.cancelIdleCallback;

    if (typeof ric === 'function') {
      // bind на window — убивает Illegal invocation
      ns.myRequestIdleCallback = ric.bind(window);
    } else {
      ns.myRequestIdleCallback = function (cb, opts) {
        const timeout = opts && typeof opts.timeout === 'number' ? opts.timeout : 50;
        return setTimeout(() => {
          const start = Date.now();
          cb({
            didTimeout: true,
            timeRemaining() {
              return Math.max(0, 50 - (Date.now() - start));
            },
          });
        }, timeout);
      };
    }

    if (typeof cic === 'function') {
      ns.myCancelIdleCallback = cic.bind(window);
    } else {
      ns.myCancelIdleCallback = function (id) {
        clearTimeout(id);
      };
    }
  })();

  // Обновляет textContent только если реально изменилось
  ns.setTextIfChanged = function (el, value) {
    if (!el) return;
    const str = value != null ? String(value) : '';
    if (el.textContent !== str) el.textContent = str;
  };

  // Toast (безопасно для document_start: если body ещё нет — вешаем на documentElement)
  ns.showToast = function (message, duration = 2500) {
    try {
      const toast = document.createElement('div');
      toast.textContent = message;

      toast.style.cssText = `
        position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
        background: #222; color: #fff; padding: 12px 24px; border-radius: 12px;
        z-index: 999999; font-size: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.6);
        opacity: 0; transition: opacity 0.3s ease;
        pointer-events: none;
      `;

      const root = document.body || document.documentElement;
      if (!root) return;

      root.appendChild(toast);

      requestAnimationFrame(() => {
        toast.style.opacity = '1';
      });

      setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
          try {
            toast.remove();
          } catch {}
        }, 320);
      }, Math.max(0, Number(duration) || 0));
    } catch {
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

    const d = Math.max(0, Number(delay) || 0);

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
        try {
          console.error('[LUHT] throttled fn error', e);
        } catch {}
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
      const remaining = d - elapsed;

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
    const t = Math.max(0, Number(ms) || 0);
    return new Promise((res) => setTimeout(res, t));
  };

  // Safe error logger
  ns.logError = function (message, error) {
    try {
      console.error('[LUHT]', message, error);
    } catch {
      // ignore
    }
  };
})(window.LUHT.freezer);
