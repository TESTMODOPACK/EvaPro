'use client';

/**
 * DynamicCharts — re-export de componentes Recharts con code-splitting.
 *
 * Recharts pesa ~150 kB gzipped. Cargarlo en cada página que importe
 * "from 'recharts'" agranda el bundle compartido incluso en páginas que
 * no lo usan (Next federa chunks por ruta, pero el tree-shaking no siempre
 * funciona con las re-exports de recharts).
 *
 * Cómo usarlo:
 *   ANTES:
 *     import { BarChart, Bar, XAxis } from 'recharts';
 *   DESPUÉS:
 *     import { BarChart, Bar, XAxis } from '@/components/DynamicCharts';
 *
 * Los componentes se cargan solo en client, cuando el componente padre
 * se monta. El primer render muestra un placeholder liviano, y luego se
 * hidrata con la librería real. En páginas analíticas este approach
 * reduce el FCP (first contentful paint) sustancialmente.
 *
 * IMPORTANTE: Next.js exige que el segundo argumento de `dynamic()` sea
 * un object literal — no se puede extraer a una constante compartida.
 * Por eso cada export duplica `{ ssr: false, loading: ... }` inline.
 */

import dynamic from 'next/dynamic';
// Re-export directo de los "props-carriers" — components de Recharts que
// NO se renderizan por si mismos sino que son leidos por su padre via
// `Children.map` para extraer props (fill, stroke, etc). Si los envolvemos
// en `dynamic()` el wrapper de Next rompe la introspeccion del padre y los
// colores/etiquetas se ignoran (e.g., todos los slices de un PieChart
// salen grises pese a tener Cell con fill explicito). Importarlos
// directo no agrega bundle real porque el chunk de recharts ya se carga
// via los containers dinamicos del primer chart de la pagina.
export { Cell } from 'recharts';

// Loading placeholder — alto consistente para evitar layout shift (CLS).
function ChartFallback() {
  return (
    <div
      style={{
        height: '260px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: '0.82rem',
      }}
    >
      Cargando gráfico…
    </div>
  );
}

// ─── Charts containers (con fallback visual) ─────────────────────────
export const BarChart = dynamic(() => import('recharts').then((m) => m.BarChart), { ssr: false, loading: () => <ChartFallback /> });
export const LineChart = dynamic(() => import('recharts').then((m) => m.LineChart), { ssr: false, loading: () => <ChartFallback /> });
export const PieChart = dynamic(() => import('recharts').then((m) => m.PieChart), { ssr: false, loading: () => <ChartFallback /> });
export const RadarChart = dynamic(() => import('recharts').then((m) => m.RadarChart), { ssr: false, loading: () => <ChartFallback /> });
export const AreaChart = dynamic(() => import('recharts').then((m) => m.AreaChart), { ssr: false, loading: () => <ChartFallback /> });
export const ScatterChart = dynamic(() => import('recharts').then((m) => m.ScatterChart), { ssr: false, loading: () => <ChartFallback /> });
export const ComposedChart = dynamic(() => import('recharts').then((m) => m.ComposedChart), { ssr: false, loading: () => <ChartFallback /> });
export const ResponsiveContainer = dynamic(() => import('recharts').then((m) => m.ResponsiveContainer), { ssr: false, loading: () => <ChartFallback /> });

// ─── Primitives (sin fallback — se dibujan dentro del container) ───
export const Bar = dynamic(() => import('recharts').then((m) => m.Bar), { ssr: false });
export const Line = dynamic(() => import('recharts').then((m) => m.Line), { ssr: false });
export const Area = dynamic(() => import('recharts').then((m) => m.Area), { ssr: false });
export const Pie = dynamic(() => import('recharts').then((m) => m.Pie), { ssr: false });
export const Radar = dynamic(() => import('recharts').then((m) => m.Radar), { ssr: false });
export const Scatter = dynamic(() => import('recharts').then((m) => m.Scatter), { ssr: false });
export const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis), { ssr: false });
export const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis), { ssr: false });
export const ZAxis = dynamic(() => import('recharts').then((m) => m.ZAxis), { ssr: false });
export const CartesianGrid = dynamic(() => import('recharts').then((m) => m.CartesianGrid), { ssr: false });
export const PolarGrid = dynamic(() => import('recharts').then((m) => m.PolarGrid), { ssr: false });
export const PolarAngleAxis = dynamic(() => import('recharts').then((m) => m.PolarAngleAxis), { ssr: false });
export const PolarRadiusAxis = dynamic(() => import('recharts').then((m) => m.PolarRadiusAxis), { ssr: false });
export const Tooltip = dynamic(() => import('recharts').then((m) => m.Tooltip), { ssr: false });
export const Legend = dynamic(() => import('recharts').then((m) => m.Legend), { ssr: false });
// `Cell` se exporta arriba directamente desde 'recharts' (ver comentario
// al top). NO envolver en `dynamic()` — rompe la lectura de fill por Pie.
export const ReferenceLine = dynamic(() => import('recharts').then((m) => m.ReferenceLine), { ssr: false });
export const LabelList = dynamic(() => import('recharts').then((m) => m.LabelList), { ssr: false });
export const Label = dynamic(() => import('recharts').then((m) => m.Label), { ssr: false });
