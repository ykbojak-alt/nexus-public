// Appearance-probe — аналог windowsAppearance у dsh-desktop: там preload
// измеряет computed-цвет скрытым зондом и подгоняет titlebar overlay под
// тему страницы. У NUE нет нативной рамки, но браузерный/PWA/pywebview хром
// слушает <meta name="theme-color"> — подставляем туда разрешённое значение
// --nexus-surface-environment, чтобы полоса браузера совпадала со сценой.

const PROBE_VAR = '--nexus-surface-environment';
const PROBE_BACKGROUND = 'background-color';

export function resolveThemeSurfaceColor(): string | null {
  if (typeof document === 'undefined') return null;
  // Зонд-элемент: color-mix/вар в токенах разрешаются только через вычисленный
  // стиль — читаем computed backgroundColor, а не сырую строку токена.
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;${PROBE_BACKGROUND}:var(${PROBE_VAR})`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).getPropertyValue(PROBE_BACKGROUND).trim();
  probe.remove();
  // 'rgba(0, 0, 0, 0)'/transparent = токен не разрешился — мету не трогаем.
  if (!resolved || resolved === 'transparent' || resolved === 'rgba(0, 0, 0, 0)') return null;
  return resolved;
}

export function applyThemeColorMeta(color: string): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta == null) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
  return meta;
}

export function syncThemeColorMeta(): string | null {
  const color = resolveThemeSurfaceColor();
  if (color == null) return null;
  applyThemeColorMeta(color);
  return color;
}

let observer: MutationObserver | null = null;

/** Идемпотентно: следит за сменой data-theme и переизмеряет цвет хрома. */
export function installThemeColorProbe(): void {
  if (observer != null || typeof document === 'undefined') return;
  // Первый замер — после первого кадра, когда токены уже применены.
  requestAnimationFrame(() => syncThemeColorMeta());
  observer = new MutationObserver(() => requestAnimationFrame(() => syncThemeColorMeta()));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-density'],
  });
}
