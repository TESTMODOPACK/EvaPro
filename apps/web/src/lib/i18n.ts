import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from '@/locales/es.json';
import en from '@/locales/en.json';
import pt from '@/locales/pt.json';

i18n.use(initReactI18next).init({
  lng: 'es',
  fallbackLng: 'es',
  resources: {
    es: { translation: es },
    en: { translation: en },
    pt: { translation: pt },
  },
  interpolation: { escapeValue: false },
});

export default i18n;
