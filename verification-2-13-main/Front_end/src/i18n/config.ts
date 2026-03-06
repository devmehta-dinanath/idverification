import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import th from './locales/th.json';
import ru from './locales/ru.json';
import zh from './locales/zh.json';

const STORAGE_KEY = 'opsian_lang';
const savedLanguage = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) || 'en' : 'en';

i18n
  .use(initReactI18next)
  .init({
    lng: savedLanguage,
    resources: {
      en: { translation: en },
      th: { translation: th },
      ru: { translation: ru },
      zh: { translation: zh }
    },
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

i18n.on('languageChanged', (lng) => {
  document.documentElement.setAttribute('lang', lng);
});

export default i18n;
