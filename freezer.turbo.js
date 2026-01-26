// freezer.turbo.js
'use strict';

(function (ns) {
  const S = ns.state;

  const ENABLE_KEY = 'imageTurboEnabled';

  function isEnabled() {
    try {
      return localStorage.getItem(ENABLE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function setEnabled(on) {
    try {
      localStorage.setItem(ENABLE_KEY, on ? 'true' : 'false');
    } catch {}
  }

  // Проверяет, находится ли Image Turbo в режиме временного отключения (cooldown)
  ns.isTurboInCooldown = function () {
    try {
      const ts = Number(localStorage.getItem(ns.TURBO_DEAD_TS_KEY) || '0');
      return ts && Date.now() - ts < ns.TURBO_COOLDOWN_MS;
    } catch {
      return false;
    }
  };

  // Устанавливает метку времени начала cooldown (текущее время)
  ns.setTurboCooldown = function () {
    try {
      localStorage.setItem(ns.TURBO_DEAD_TS_KEY, String(Date.now()));
    } catch {}
  };

  // Сбрасывает (отменяет) состояние cooldown
  ns.clearTurboCooldown = function () {
    try {
      localStorage.removeItem(ns.TURBO_DEAD_TS_KEY);
    } catch {}
  };

  // Возвращает текущий элемент изображения задания (которое нужно размечать)
  ns.getCurrentImage = function () {
    try {
      if (S.currentImg && (document.body || document.documentElement).contains(S.currentImg)) {
        return S.currentImg;
      }
    } catch {}

    S.currentImg = document.querySelector('img[alt="Image to annotate"]');
    return S.currentImg;
  };

  // Создаёт переключатель (чекбокс) для режима Image Turbo в панели статистики
  ns.createTurboToggle = function (rowsContainer) {
    if (!rowsContainer) return;

    // чтобы не создать второй раз (если панель пересобирается)
    if (S.turboRow && rowsContainer.contains(S.turboRow)) return;

    // Обертка для строки переключателя
    const turboRow = document.createElement('div');
    turboRow.className = 'luht-row luht-turbo-row';

    const label = document.createElement('span');
    label.className = 'luht-row-label';
    label.textContent = 'Image Turbo';

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '10px';

    // Чекбокс переключения
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.id = 'image-turbo-toggle';
    const enabled = isEnabled();
    toggle.checked = enabled;

    // Подпись-состояние (вкл/выкл)
    const status = document.createElement('span');
    status.style.fontSize = '14px';
    status.style.transition = 'opacity 0.3s ease';

    function setStatusText(on, mode) {
      // mode: 'ok' | 'off' | 'cooldown' | 'fail'
      if (!status) return;
      if (!on) {
        status.textContent = 'Выключено';
        status.style.opacity = '0.5';
        return;
      }
      if (mode === 'cooldown') {
        status.textContent = 'Недоступно (таймаут)';
        status.style.opacity = '0.6';
        return;
      }
      if (mode === 'fail') {
        status.textContent = 'Недоступно (временно)';
        status.style.opacity = '0.6';
        return;
      }
      status.textContent = '💨 Активно';
      status.style.opacity = '1';
    }

    setStatusText(enabled, ns.isTurboInCooldown() ? 'cooldown' : 'ok');

    // Обработчик изменения чекбокса
    let debounceTimer = null;
    toggle.addEventListener('change', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const on = !!toggle.checked;
        setEnabled(on);
        if (on) ns.clearTurboCooldown();
        setStatusText(on, ns.isTurboInCooldown() ? 'cooldown' : 'ok');
        ns.applyImageTurbo();
      }, 120);
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(status);
    turboRow.appendChild(label);
    turboRow.appendChild(wrapper);
    rowsContainer.appendChild(turboRow);

    // Сохраняем ссылки на элементы для использования при обновлениях
    S.turboRow = turboRow;
    S.turboToggle = toggle;
    S.turboIcon = status;
  };

  // Применяет Turbo-оптимизацию к текущему изображению (замена на WebP через прокси)
  ns.applyImageTurbo = function () {
    if (!isEnabled()) return;

    // если в cooldown — обновим статус и выйдем
    if (ns.isTurboInCooldown()) {
      if (S.turboIcon) {
        S.turboIcon.textContent = 'Недоступно (таймаут)';
        S.turboIcon.style.opacity = '0.6';
      }
      return;
    }

    const img = ns.getCurrentImage();
    if (!img) return;

    // не трогаем уже обработанное
    if (img.dataset.webpOptimized === 'true' || img.dataset.webpOptimized === 'fail') return;

    const originalSrc = img.src;
    if (!originalSrc || originalSrc.endsWith('.webp') || originalSrc.endsWith('.svg')) return;

    // Формируем URL через прокси wsrv.nl (WebP формат, с ресайзом)
    const width = Math.min(1600, Math.floor(window.innerWidth * 1.5));
    const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(originalSrc)}&w=${width}&q=87&output=webp&fit=contain`;

    const preload = new Image();

    preload.onload = () => {
      // если за время загрузки картинка сменилась — не ломаем новую
      const current = ns.getCurrentImage();
      if (!current || current !== img) return;

      img.src = proxyUrl;
      img.dataset.webpOptimized = 'true';

      ns.clearTurboCooldown();

      if (S.turboIcon) {
        S.turboIcon.textContent = '💨 Активно';
        S.turboIcon.style.opacity = '1';
      }
    };

    preload.onerror = () => {
      img.dataset.webpOptimized = 'fail';
      ns.setTurboCooldown();

      if (S.turboIcon) {
        S.turboIcon.textContent = 'Недоступно (временно)';
        S.turboIcon.style.opacity = '0.6';
      }

      if (typeof ns.showToast === 'function') {
        ns.showToast('Image Turbo временно недоступен. Поставлен таймаут.', 2200);
      }

      // Возвращаем оригинальный src, если был изменён (на всякий)
      if (img.src !== originalSrc) img.src = originalSrc;
    };

    preload.src = proxyUrl;
  };
})(window.LUHT.freezer);
