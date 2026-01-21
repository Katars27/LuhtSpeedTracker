// freezer.turbo.js
(function(ns) {
  const S = ns.state;

  // Проверяет, находится ли Image Turbo в режиме временного отключения (cooldown)
  ns.isTurboInCooldown = function() {
    try {
      const ts = Number(localStorage.getItem(ns.TURBO_DEAD_TS_KEY) || '0');
      return ts && (Date.now() - ts < ns.TURBO_COOLDOWN_MS);
    } catch (e) {
      return false;
    }
  };

  // Устанавливает метку времени начала cooldown (текущее время)
  ns.setTurboCooldown = function() {
    try {
      localStorage.setItem(ns.TURBO_DEAD_TS_KEY, String(Date.now()));
    } catch (e) {}
  };

  // Сбрасывает (отменяет) состояние cooldown
  ns.clearTurboCooldown = function() {
    try {
      localStorage.removeItem(ns.TURBO_DEAD_TS_KEY);
    } catch (e) {}
  };

  // Возвращает текущий элемент изображения задания (которое нужно размечать)
  ns.getCurrentImage = function() {
    if (S.currentImg && document.body.contains(S.currentImg)) {
      return S.currentImg;
    }
    S.currentImg = document.querySelector('img[alt="Image to annotate"]');
    return S.currentImg;
  };

  // Создаёт переключатель (чекбокс) для режима Image Turbo в панели статистики
  ns.createTurboToggle = function(rowsContainer) {
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
    const enabled = localStorage.getItem('imageTurboEnabled') === 'true';
    toggle.checked = enabled;

    // Подпись-состояние (вкл/выкл)
    const status = document.createElement('span');
    status.style.fontSize = '14px';
    status.textContent = enabled ? '💨 Активно' : 'Выключено';
    status.style.opacity = enabled ? '1' : '0.5';
    status.style.transition = 'opacity 0.3s ease';

    // Обработчик изменения чекбокса
    let debounceTimer = null;
    toggle.addEventListener('change', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const on = toggle.checked;
        localStorage.setItem('imageTurboEnabled', on ? 'true' : 'false');
        status.textContent = on ? '💨 Активно' : 'Выключено';
        status.style.opacity = on ? '1' : '0.5';
        if (on) ns.clearTurboCooldown();
        ns.applyImageTurbo();
      }, 100);
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(status);
    turboRow.appendChild(label);
    turboRow.appendChild(wrapper);
    rowsContainer.appendChild(turboRow);

    // Сохраняем ссылки на элементы для использования при обновлениях
    S.turboToggle = toggle;
    S.turboIcon = status;
  };

  // Применяет Turbo-оптимизацию к текущему изображению (замена на WebP через прокси)
  ns.applyImageTurbo = function() {
    if (localStorage.getItem('imageTurboEnabled') !== 'true') return;
    if (ns.isTurboInCooldown()) return;
    const img = ns.getCurrentImage();
    if (!img) return;
    if (img.dataset.webpOptimized === 'true' || img.dataset.webpOptimized === 'fail') return;
    const originalSrc = img.src;
    if (!originalSrc || originalSrc.endsWith('.webp') || originalSrc.endsWith('.svg')) return;

    // Формируем URL через прокси wsrv.nl (WebP формат, с ресайзом)
    const width = Math.min(1600, Math.floor(window.innerWidth * 1.5));
    const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(originalSrc)}&w=${width}&q=87&output=webp&fit=contain`;

    const preload = new Image();
    preload.onload = () => {
      img.src = proxyUrl;
      img.dataset.webpOptimized = 'true';
      ns.clearTurboCooldown();
    };
    preload.onerror = () => {
      img.dataset.webpOptimized = 'fail';
      ns.setTurboCooldown();
      if (S.turboIcon) {
        S.turboIcon.textContent = 'Недоступно (временно)';
        S.turboIcon.style.opacity = '0.5';
      }
      ns.showToast('Image Turbo временно недоступен. Поставлен таймаут.', 2200);
      // Возвращаем оригинальный src, если был изменён
      if (img.src !== originalSrc) {
        img.src = originalSrc;
      }
    };
    preload.src = proxyUrl;
  };

})(window.LUHT.freezer);
