'use strict';

(function turboHacks() {
  const domains = [
    'https://luht.tp2.intropy.tech',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com'
  ];

  function addPreconnectLinks() {
    if (!document.head) return false;

    domains.forEach(domain => {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = domain;
      if (domain.includes('gstatic')) link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    });

    // Preload Geist via Google Fonts CSS (best for variable font)
    const cssLink = document.createElement('link');
    cssLink.rel = 'preload';
    cssLink.as = 'style';
    cssLink.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap';
    document.head.appendChild(cssLink);

    console.log('%c🚀 Turbo preconnect + Geist font preload (Google Fonts) injected', 'color: #ff3399; font-weight: bold;');
    return true;
  }

  if (addPreconnectLinks()) return;

  const observer = new MutationObserver(() => {
    if (document.head && addPreconnectLinks()) observer.disconnect();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', () => {
    if (document.head) addPreconnectLinks();
    observer.disconnect();
  });
})();