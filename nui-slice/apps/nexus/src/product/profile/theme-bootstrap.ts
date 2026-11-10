/** Runs in the document head before the first paint and before React loads. */
export const THEME_BOOTSTRAP_SCRIPT = `(() => {
  const root = document.documentElement;
  const themes = ['nexus', 'alice', 'mech', 'forge', 'codex', 'arch', 'aurum-dark'];
  const densities = ['calm', 'standard', 'dense'];
  let theme = 'nexus';
  let density = 'standard';

  try {
    const profile = JSON.parse(localStorage.getItem('nexus.profile.v1') || 'null');
    if (profile && themes.includes(profile.themeId)) theme = profile.themeId;
    if (profile && densities.includes(profile.density)) density = profile.density;
  } catch {}

  root.dataset.theme = theme;
  root.dataset.density = density;
  root.style.colorScheme = theme === 'alice' ? 'light' : 'dark';
})();`;
