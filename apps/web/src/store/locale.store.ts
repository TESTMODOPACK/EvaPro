'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SupportedLocale = 'es' | 'en' | 'pt';

interface LocaleState {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: 'es',
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'evapro-locale' },
  ),
);
