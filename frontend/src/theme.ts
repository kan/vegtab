import { ref, readonly, type Ref } from 'vue';

const STORAGE_KEY = 'vegtab_theme';

export type Theme = 'light' | 'dark';

let current: Theme = 'light';
const isDarkRef = ref(false);

function detect(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(theme: Theme) {
  current = theme;
  isDarkRef.value = theme === 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function initTheme() {
  apply(detect());
}

export function toggleTheme() {
  apply(current === 'dark' ? 'light' : 'dark');
}

/** Reactive dark-mode flag + toggle for use in Vue components */
export function useTheme(): { isDark: Readonly<Ref<boolean>>; toggle: () => void } {
  return { isDark: readonly(isDarkRef), toggle: toggleTheme };
}
