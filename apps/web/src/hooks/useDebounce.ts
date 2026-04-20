'use client';

import { useEffect, useState } from 'react';

/**
 * useDebounce — retrasa la actualización del valor hasta que pase `delay` ms
 * sin que cambie el input.
 *
 * Uso típico: cajas de búsqueda que filtran listas grandes o hacen fetch.
 * Sin debounce, cada keystroke dispara un re-render o request — con usuarios
 * tipeando 5–10 caracteres por segundo esto causa lag perceptible y costo
 * en backend.
 *
 * Ejemplo:
 *   const [search, setSearch] = useState('');
 *   const debouncedSearch = useDebounce(search, 300);
 *   // Usa debouncedSearch para .filter() / fetch, no search.
 *
 * Default 300ms — buen balance entre responsividad y ahorro.
 *
 * LIMITACIÓN: el hook compara por referencia (Object.is). Si pasas un
 * objeto/array que se re-crea en cada render (ej: useDebounce({a: search}))
 * el effect dispara en cada render y el debounce no funciona. Úsalo solo
 * con primitivos (string, number, boolean) o referencias estables
 * (useMemo del objeto).
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

export default useDebounce;
