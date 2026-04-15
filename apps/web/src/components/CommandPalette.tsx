'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { useCommandPaletteStore } from '@/store/commandPalette.store';
import { canAccessPage } from '@/lib/roles';
import { api } from '@/lib/api';

// ─── Navigation items (label + keywords for fuzzy matching) ─────────

const NAV_ITEMS: Array<{ href: string; label: string; keywords: string[]; icon: string }> = [
  { href: '/dashboard', label: 'Dashboard', keywords: ['inicio', 'home', 'panel', 'resumen'], icon: '🏠' },
  { href: '/dashboard/mi-desempeno', label: 'Mi Desempeño', keywords: ['rendimiento', 'performance', 'puntaje', 'historial'], icon: '📊' },
  { href: '/dashboard/notificaciones', label: 'Notificaciones', keywords: ['alertas', 'mensajes', 'avisos', 'actividad'], icon: '🔔' },
  { href: '/dashboard/evaluaciones', label: 'Evaluaciones', keywords: ['ciclos', 'evaluar', 'evaluacion', 'pendientes'], icon: '📝' },
  { href: '/dashboard/calibracion', label: 'Calibración', keywords: ['ajustar', 'sesion', 'calibrar'], icon: '⚖️' },
  { href: '/dashboard/reportes', label: 'Resumen Ejecutivo', keywords: ['dashboard', 'ejecutivo', 'kpi', 'organizacional'], icon: '📈' },
  { href: '/dashboard/informes', label: 'Informes por Colaborador', keywords: ['reporte', 'individual', 'persona'], icon: '👤' },
  { href: '/dashboard/analytics', label: 'Análisis del Ciclo', keywords: ['estadisticas', 'distribucion', 'heatmap'], icon: '🔍' },
  { href: '/dashboard/insights', label: 'Análisis con IA', keywords: ['inteligencia', 'artificial', 'prediccion', 'sesgo'], icon: '🤖' },
  { href: '/dashboard/analytics-pdi', label: 'Cumplimiento PDI', keywords: ['desarrollo', 'plan', 'acciones'], icon: '📋' },
  { href: '/dashboard/analytics-ciclos', label: 'Comparativa de Ciclos', keywords: ['comparar', 'tendencia', 'historico'], icon: '📊' },
  { href: '/dashboard/analytics-uso', label: 'Uso del Sistema', keywords: ['adopcion', 'actividad', 'metricas'], icon: '📡' },
  { href: '/dashboard/analytics-rotacion', label: 'Dotación y Rotación', keywords: ['turnover', 'salidas', 'headcount'], icon: '👥' },
  { href: '/dashboard/talento', label: 'Mapa de Talento', keywords: ['nine box', '9box', 'potencial', 'desempeno'], icon: '🗺️' },
  { href: '/dashboard/desarrollo', label: 'Planes de Desarrollo', keywords: ['pdi', 'acciones', 'crecimiento', 'plan'], icon: '🌱' },
  { href: '/dashboard/competencias', label: 'Competencias', keywords: ['habilidades', 'catalogo', 'matriz'], icon: '🎯' },
  { href: '/dashboard/desarrollo-organizacional', label: 'Desarrollo Organizacional', keywords: ['iniciativas', 'estrategia'], icon: '🏗️' },
  { href: '/dashboard/objetivos', label: 'Objetivos y Metas', keywords: ['okr', 'kpi', 'smart', 'metas', 'goals'], icon: '🎯' },
  { href: '/dashboard/feedback', label: 'Feedback Continuo', keywords: ['checkin', 'retroalimentacion', '1:1', 'rapido'], icon: '💬' },
  { href: '/dashboard/reconocimientos', label: 'Reconocimientos', keywords: ['puntos', 'badges', 'insignias', 'muro'], icon: '⭐' },
  { href: '/dashboard/encuestas-clima', label: 'Encuestas de Clima', keywords: ['clima', 'enps', 'satisfaccion', 'encuesta'], icon: '🌡️' },
  { href: '/dashboard/postulantes', label: 'Selección de Personal', keywords: ['reclutamiento', 'candidatos', 'postulacion'], icon: '🔎' },
  { href: '/dashboard/firmas', label: 'Firmas Digitales', keywords: ['firma', 'documento', 'contrato'], icon: '✍️' },
  { href: '/dashboard/usuarios', label: 'Usuarios', keywords: ['colaboradores', 'personas', 'equipo', 'crear'], icon: '👥' },
  { href: '/dashboard/organigrama', label: 'Organigrama', keywords: ['estructura', 'jerarquia', 'arbol'], icon: '🏢' },
  { href: '/dashboard/dei', label: 'Diversidad e Inclusión', keywords: ['equidad', 'genero', 'dei'], icon: '🌍' },
  { href: '/dashboard/plantillas', label: 'Plantillas de Evaluación', keywords: ['formulario', 'template', 'secciones'], icon: '📄' },
  { href: '/dashboard/mantenedores', label: 'Datos Personalizados', keywords: ['configuracion', 'listas', 'opciones'], icon: '⚙️' },
  { href: '/dashboard/ajustes', label: 'Ajustes', keywords: ['configuracion', 'perfil', 'preferencias', 'idioma'], icon: '⚙️' },
  { href: '/dashboard/mi-suscripcion', label: 'Mi Suscripción', keywords: ['plan', 'factura', 'renovar'], icon: '💳' },
  { href: '/dashboard/solicitudes', label: 'Solicitudes', keywords: ['soporte', 'ticket', 'ayuda'], icon: '📩' },
  { href: '/dashboard/auditoria', label: 'Auditoría', keywords: ['log', 'registro', 'acciones', 'historial'], icon: '🔒' },
];

// ─── Quick actions ──────────────────────────────────────────────────

const QUICK_ACTIONS: Array<{ label: string; href: string; roles: string[]; icon: string }> = [
  { label: 'Ver mis evaluaciones pendientes', href: '/dashboard/evaluaciones', roles: ['tenant_admin', 'manager', 'employee', 'external'], icon: '📝' },
  { label: 'Crear nuevo objetivo', href: '/dashboard/objetivos', roles: ['tenant_admin', 'manager', 'employee'], icon: '🎯' },
  { label: 'Enviar feedback rápido', href: '/dashboard/feedback', roles: ['tenant_admin', 'manager', 'employee'], icon: '💬' },
  { label: 'Ver mi desempeño', href: '/dashboard/mi-desempeno', roles: ['tenant_admin', 'manager', 'employee'], icon: '📊' },
  { label: 'Ver reportes ejecutivos', href: '/dashboard/reportes', roles: ['tenant_admin', 'manager'], icon: '📈' },
  { label: 'Gestionar usuarios', href: '/dashboard/usuarios', roles: ['tenant_admin'], icon: '👥' },
  { label: 'Ver reconocimientos', href: '/dashboard/reconocimientos', roles: ['tenant_admin', 'manager', 'employee'], icon: '⭐' },
  { label: 'Responder encuesta de clima', href: '/dashboard/encuestas-clima', roles: ['tenant_admin', 'manager', 'employee'], icon: '🌡️' },
];

// ─── Search helpers ─────────────────────────────────────────────────

function matchQuery(text: string, keywords: string[], query: string): boolean {
  const q = query.toLowerCase();
  if (text.toLowerCase().includes(q)) return true;
  return keywords.some((kw) => kw.includes(q));
}

// ─── Result types ───────────────────────────────────────────────────

interface PaletteResult {
  id: string;
  label: string;
  href: string;
  icon: string;
  section: 'nav' | 'people' | 'actions';
}

// ─── Component ──────────────────────────────────────────────────────

export function CommandPalette() {
  const router = useRouter();
  const { isOpen, close, toggle } = useCommandPaletteStore();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const role = user?.role || 'employee';

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [userResults, setUserResults] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Ctrl+K / Cmd+K global listener ─────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  // ─── Focus input on open ────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setUserResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // ─── Debounced user search ──────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !token || query.length < 2) {
      setUserResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.users.list(token, 1, 8, { search: query });
        const data = Array.isArray(res) ? res : (res as any)?.data || [];
        setUserResults(data.filter((u: any) => u.id !== user?.userId));
      } catch {
        setUserResults([]);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, isOpen, token, user?.userId]);

  // ─── Build results ─────────────────────────────────────────────
  const results = useMemo<PaletteResult[]>(() => {
    const items: PaletteResult[] = [];
    const q = query.trim();

    // Navigation
    const navMatches = q
      ? NAV_ITEMS.filter((n) => canAccessPage(role, n.href) && matchQuery(n.label, n.keywords, q))
      : NAV_ITEMS.filter((n) => canAccessPage(role, n.href)).slice(0, 6);
    for (const n of navMatches.slice(0, 8)) {
      items.push({ id: `nav-${n.href}`, label: n.label, href: n.href, icon: n.icon, section: 'nav' });
    }

    // People
    for (const u of userResults.slice(0, 5)) {
      const name = `${u.firstName || ''} ${u.lastName || ''}`.trim();
      items.push({
        id: `user-${u.id}`,
        label: `${name}${u.department ? ` · ${u.department}` : ''}`,
        href: `/dashboard/organigrama`,
        icon: '👤',
        section: 'people',
      });
    }

    // Quick actions
    const actionMatches = q
      ? QUICK_ACTIONS.filter((a) => a.roles.includes(role) && matchQuery(a.label, [], q))
      : QUICK_ACTIONS.filter((a) => a.roles.includes(role)).slice(0, 4);
    for (const a of actionMatches.slice(0, 5)) {
      items.push({ id: `action-${a.href}-${a.label}`, label: a.label, href: a.href, icon: a.icon, section: 'actions' });
    }

    return items;
  }, [query, role, userResults]);

  // ─── Keyboard navigation ───────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      router.push(results[selectedIndex].href);
      close();
    } else if (e.key === 'Escape') {
      close();
    }
  }, [results, selectedIndex, router, close]);

  // Reset selection when results change
  useEffect(() => { setSelectedIndex(0); }, [results.length]);

  if (!isOpen) return null;

  // ─── Section labels ────────────────────────────────────────────
  const sectionLabels: Record<string, string> = { nav: 'Navegación', people: 'Personas', actions: 'Acciones rápidas' };

  // Group results by section
  const sections: Array<{ key: string; label: string; items: PaletteResult[] }> = [];
  let currentSection = '';
  for (const r of results) {
    if (r.section !== currentSection) {
      currentSection = r.section;
      sections.push({ key: r.section, label: sectionLabels[r.section] || r.section, items: [] });
    }
    sections[sections.length - 1].items.push(r);
  }

  let globalIdx = -1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Búsqueda rápida (Ctrl+K)"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
      }}
      onClick={close}
    >
      <div
        className="animate-fade-up"
        style={{
          width: '100%', maxWidth: '560px',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md, 12px)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Buscar páginas, personas o acciones..."
            aria-label="Buscar páginas, personas o acciones"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: '0.95rem', color: 'var(--text-primary)',
            }}
          />
          <kbd style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: '360px', overflowY: 'auto', padding: '0.35rem 0' }}>
          {results.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {query ? 'Sin resultados para esta búsqueda' : 'Escribe para buscar...'}
            </div>
          ) : (
            sections.map((sec) => (
              <div key={sec.key}>
                <div style={{ padding: '0.4rem 1rem 0.25rem', fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {sec.label}
                </div>
                {sec.items.map((item) => {
                  globalIdx++;
                  const idx = globalIdx;
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => { router.push(item.href); close(); }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.6rem',
                        padding: '0.55rem 1rem', cursor: 'pointer',
                        background: isSelected ? 'rgba(201,147,58,0.08)' : 'transparent',
                        borderLeft: isSelected ? '2px solid var(--accent)' : '2px solid transparent',
                        transition: 'background 0.1s',
                      }}
                    >
                      <span style={{ fontSize: '1rem', width: '24px', textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: isSelected ? 600 : 400 }}>{item.label}</span>
                      {isSelected && (
                        <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-muted)' }}>Enter ↵</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.5rem 1rem', borderTop: '1px solid var(--border)',
          display: 'flex', gap: '1rem', fontSize: '0.68rem', color: 'var(--text-muted)',
        }}>
          <span>↑↓ navegar</span>
          <span>↵ seleccionar</span>
          <span>esc cerrar</span>
        </div>
      </div>
    </div>
  );
}
