'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { useDepartments } from '@/hooks/useDepartments';

function OrgNode({ node, depth = 0 }: { node: any; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth >= 3);
  const hasChildren = node.children?.length > 0;
  const totalDescendants = (n: any): number =>
    (n.children || []).reduce((s: number, c: any) => s + 1 + totalDescendants(c), 0);

  const levelColors: Record<number, string> = {
    1: '#C9933A', 2: '#6366f1', 3: '#10b981', 4: '#f59e0b',
    5: '#38bdf8', 6: '#a78bfa', 7: '#fb7185',
  };
  const color = node.level ? (levelColors[node.level] || '#94a3b8') : '#94a3b8';

  return (
    <div style={{ marginLeft: depth > 0 ? '1.5rem' : 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0.55rem 0.85rem', marginBottom: '0.2rem',
        background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)', borderLeft: `3px solid ${color}`,
      }}>
        {hasChildren ? (
          <button onClick={() => setCollapsed(!collapsed)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.65rem', padding: 0, width: 16, transition: 'transform 0.15s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            &#9660;
          </button>
        ) : <span style={{ width: 16 }} />}

        <div style={{ width: 30, height: 30, borderRadius: '50%', background: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>
          {(node.name?.[0] || '?').toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {node.position && <span>{node.position}</span>}
            {node.department && <span>· {node.department}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {node.level && (
            <span style={{ fontSize: '0.65rem', background: `${color}20`, color, borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
              Nv.{node.level}
            </span>
          )}
          {hasChildren && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {node.children.length} directo{node.children.length !== 1 ? 's' : ''}
              {totalDescendants(node) > node.children.length && ` (${totalDescendants(node)} total)`}
            </span>
          )}
        </div>
      </div>

      {hasChildren && !collapsed && (
        <div style={{ borderLeft: '2px dashed var(--border)', marginLeft: '0.85rem', paddingLeft: '0.25rem' }}>
          {node.children.map((child: any) => (
            <OrgNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrganigramaPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const { departments } = useDepartments();

  useEffect(() => {
    if (!token) return;
    api.users.orgChart(token)
      .then(setData)
      .catch((e) => setError(e.message || 'Error al cargar'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <PageSkeleton cards={2} tableRows={8} />;
  if (error) return (
    <div style={{ padding: '2rem 2.5rem' }}>
      <div className="card" style={{ padding: '2rem', textAlign: 'center', borderLeft: '4px solid var(--danger)' }}>
        <p style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('common.errorLoading')}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{error}</p>
      </div>
    </div>
  );

  // Filter tree recursively
  const filterTree = (nodes: any[]): any[] => {
    if (!search && !deptFilter) return nodes;
    const q = search.toLowerCase();
    return nodes.reduce((acc: any[], node: any) => {
      const nameMatch = !q || node.name?.toLowerCase().includes(q) || node.position?.toLowerCase().includes(q);
      const deptMatch = !deptFilter || node.department === deptFilter;
      const filteredChildren = filterTree(node.children || []);
      if ((nameMatch && deptMatch) || filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren });
      }
      return acc;
    }, []);
  };

  const filtered = filterTree(data || []);
  const totalCount = (nodes: any[]): number => nodes.reduce((s, n) => s + 1 + totalCount(n.children || []), 0);
  const total = totalCount(filtered);

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('orgChart.title')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('orgChart.subtitle')}
        </p>
      </div>

      {/* Guide toggle */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>{t('orgChart.guide.title')}</h3>
          <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '1.2rem', margin: '0 0 1rem' }}>
            <li><strong>¿Qué muestra?</strong> La estructura jerárquica de la organización en forma de árbol, basada en la relación jefe-colaborador definida en cada usuario.</li>
            <li><strong>Nodos:</strong> Cada persona muestra su nombre, cargo, departamento, nivel jerárquico y cantidad de reportes directos y totales.</li>
            <li><strong>Niveles:</strong> Los colores y números de nivel (Nv.1, Nv.2, etc.) provienen del catálogo de cargos configurado en Mantenedores. Nivel 1 es el más alto.</li>
            <li><strong>Raíces:</strong> Los usuarios sin jefatura directa asignada aparecen como raíces del árbol (nodos superiores).</li>
            <li><strong>Filtros:</strong> Puede buscar por nombre o cargo, y filtrar por departamento para ver una sección específica.</li>
            <li><strong>Colapsable:</strong> Haga clic en la flecha de cada nodo para expandir o colapsar sus subordinados. Los niveles profundos se colapsan automáticamente.</li>
          </ul>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Administradores y encargados de equipo pueden ver el organigrama completo.
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card animate-fade-up" style={{ padding: '0.75rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="text" placeholder={t('orgChart.searchPlaceholder')}
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)', flex: '1 1 180px', minWidth: '150px' }} />
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
          style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)' }}>
          <option value="">{t('common.allDepartments')}</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        {(search || deptFilter) && (
          <button onClick={() => { setSearch(''); setDeptFilter(''); }}
            style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--danger)', cursor: 'pointer', fontWeight: 600 }}>
            Limpiar
          </button>
        )}
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {total} colaborador(es)
        </span>
      </div>

      {/* Tree */}
      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {(search || deptFilter) ? 'No se encontraron resultados con los filtros aplicados' : 'No hay colaboradores activos para mostrar'}
          </p>
        </div>
      ) : (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {filtered.map((root: any) => (
            <OrgNode key={root.id} node={root} />
          ))}
        </div>
      )}
    </div>
  );
}
