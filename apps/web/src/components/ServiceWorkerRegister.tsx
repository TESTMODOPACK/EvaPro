'use client';

/**
 * ServiceWorkerRegister — entry point PWA para el layout raíz.
 *
 * Responsabilidades:
 *   1. Registra /sw.js via useServiceWorker (única instancia del hook).
 *   2. Renderiza InstallPrompt (banner "Instalar EVA360").
 *   3. Renderiza UpdateAvailableToast cuando hay nueva versión del SW
 *      (le pasa los valores como props para no duplicar el hook).
 */

import { useServiceWorker } from '@/hooks/useServiceWorker';
import { InstallPrompt } from './InstallPrompt';
import { UpdateAvailableToast } from './UpdateAvailableToast';

export default function ServiceWorkerRegister() {
  const { updateAvailable, applyUpdate } = useServiceWorker();

  return (
    <>
      <InstallPrompt />
      <UpdateAvailableToast updateAvailable={updateAvailable} applyUpdate={applyUpdate} />
    </>
  );
}
