import { createI18n } from 'vue-i18n';
import en from './en';
import ja from './ja';

const savedLocale = (() => {
  try { return localStorage.getItem('vegtab_locale') ?? undefined; } catch { return undefined; }
})();

// Detect browser language, default to English
const browserLocale = navigator.language.startsWith('ja') ? 'ja' : 'en';

export const i18n = createI18n({
  legacy: false,
  locale: savedLocale ?? browserLocale,
  fallbackLocale: 'en',
  messages: { en, ja },
});

export function setLocale(locale: 'en' | 'ja') {
  i18n.global.locale.value = locale;
  localStorage.setItem('vegtab_locale', locale);
}

