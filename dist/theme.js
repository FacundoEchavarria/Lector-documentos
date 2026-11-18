(function () {
  const storageKey = 'hoja-theme';
  const preferences = ['system', 'light', 'dark'];
  const root = document.documentElement;
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  const native = window.HojaAndroid;
  let preference = 'system';

  try {
    const saved = localStorage.getItem(storageKey);
    if (preferences.includes(saved)) preference = saved;
  } catch {}

  function applyTheme() {
    const systemDark = native?.isSystemDarkTheme ? native.isSystemDarkTheme() : colorScheme.matches;
    const dark = preference === 'dark' || (preference === 'system' && systemDark);
    root.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]').content = dark ? '#20233b' : '#f9faff';
    native?.setDarkTheme?.(dark);
  }

  applyTheme();
  window.hojaSystemThemeChanged = applyTheme;
  if (colorScheme.addEventListener) colorScheme.addEventListener('change', applyTheme);
  else colorScheme.addListener(applyTheme);

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    const dialog = document.querySelector('#themeDialog');
    for (const button of document.querySelectorAll('[data-theme-control]')) {
      button.addEventListener('click', () => {
        dialog.querySelector(`input[value="${preference}"]`).checked = true;
        dialog.showModal();
      });
    }
    dialog.addEventListener('change', event => {
      if (event.target.name !== 'theme' || !preferences.includes(event.target.value)) return;
      preference = event.target.value;
      try { localStorage.setItem(storageKey, preference); } catch {}
      applyTheme();
    });
  });
})();
