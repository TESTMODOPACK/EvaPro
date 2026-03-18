'use client';

const usuarios = [
  { nombre: 'María García',     email: 'maria@empresa.com',   role: 'admin',      estado: 'activo',   dept: 'Tecnología' },
  { nombre: 'Carlos López',     email: 'carlos@empresa.com',  role: 'manager',    estado: 'activo',   dept: 'Producto' },
  { nombre: 'Ana Martínez',     email: 'ana@empresa.com',     role: 'employee',   estado: 'activo',   dept: 'Diseño' },
  { nombre: 'Luis Rodríguez',   email: 'luis@empresa.com',    role: 'employee',   estado: 'inactivo', dept: 'DevOps' },
  { nombre: 'Sandra Torres',    email: 'sandra@empresa.com',  role: 'employee',   estado: 'activo',   dept: 'QA' },
  { nombre: 'Pedro Sánchez',    email: 'pedro@empresa.com',   role: 'manager',    estado: 'activo',   dept: 'Ventas' },
];

const roleLabel: Record<string, string> = { admin: 'Administrador', manager: 'Manager', employee: 'Empleado' };
const roleBadge: Record<string, string> = { admin: 'badge-danger', manager: 'badge-warning', employee: 'badge-accent' };

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  const colors   = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#38bdf8', '#a78bfa'];
  const color    = colors[name.charCodeAt(0) % colors.length];
  return (
    <div style={{
      width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
      background: `${color}30`, color, border: `1.5px solid ${color}60`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.75rem', fontWeight: 700,
    }}>
      {initials}
    </div>
  );
}

export default function UsuariosPage() {
  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Usuarios</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Gestiona empleados y sus roles en la organización
          </p>
        </div>
        <button className="btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Agregar usuario
        </button>
      </div>

      {/* Stats row */}
      <div className="animate-fade-up-delay-1" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total usuarios', value: '6', color: 'var(--accent-hover)' },
          { label: 'Activos', value: '5', color: 'var(--success)' },
          { label: 'Inactivos', value: '1', color: 'var(--text-muted)' },
          { label: 'Managers', value: '2', color: 'var(--warning)' },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card animate-fade-up-delay-2" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Departamento</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u, i) => (
                <tr key={i}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <Avatar name={u.nombre} />
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>{u.nombre}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>{u.dept}</td>
                  <td><span className={`badge ${roleBadge[u.role]}`}>{roleLabel[u.role]}</span></td>
                  <td>
                    <span className={`badge ${u.estado === 'activo' ? 'badge-success' : 'badge-warning'}`}>{u.estado}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="btn-ghost" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}>Editar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
