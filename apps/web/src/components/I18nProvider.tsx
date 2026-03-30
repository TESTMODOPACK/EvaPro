'use client';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/lib/i18n';
import { useLocaleStore } from '@/store/locale.store';
import { useAuthStore } from '@/store/auth.store';

export default function I18nProvider({ children }: { children: React.ReactNode }) {
  const { locale, setLocale } = useLocaleStore();
  const user = useAuthStore((s) => s.user);

  // Sync locale from user profile on login
  useEffect(() => {
    const userLang = (user as any)?.language as string | undefined;
    if (userLang && ['es', 'en', 'pt'].includes(userLang) && userLang !== locale) {
      setLocale(userLang as SupportedLocale);
    }
  }, [user?.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep i18next in sync with Zustand store
  useEffect(() => {
    if (i18n.language !== locale) i18n.changeLanguage(locale);
  }, [locale]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

// Re-export type for use in the effect above
type SupportedLocale = 'es' | 'en' | 'pt';
