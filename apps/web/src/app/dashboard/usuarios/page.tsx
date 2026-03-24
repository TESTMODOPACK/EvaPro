'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUsers, useCreateUser, useUpdateUser, useRemoveUser } from '@/hooks/useUsers';
import { useAuthStore } from '@/store/auth.store';
import { getRoleLabel, getRoleBadge, ASSIGNABLE_ROLES } from '@/lib/roles';
import { api } from '@/lib/api';

function Avatar({ name }: { name: string }) {
  const initials = name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase();
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#38bdf8', '#a78bfa'];
  const color = colors[name.charCodeAt(0) % colors.length];
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

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const emptyForm = {
  email: '',
  firstName: '',
  lastName: '',
  password: '',
  role: 'employee',
  department: '',
  position: '',
  managerId: '',
};

export default function UsuariosPage() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const currentUserRole = useAuthStore((s) => s.user?.role || '');
  const isAdmin = currentUserRole === 'super_admin' || currentUserRole === 'tenant_admin';
  const { data: paginated, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const removeUser = useRemoveUser();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Bulk import state
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [maxEmployees, setMaxEmployees] = useState<number>(0);
  const [planName, setPlanName] = useState<string>('');

  // Fetch subscription limits
  useEffect(() => {
    if (!token || currentUserRole === 'super_admin') return;
    api.subscriptions.mySubscription(token)
      .then((sub: any) => {
        if (sub?.plan) {
          setMaxEmployees(sub.plan.maxEmployees || 0);
          setPlanName(sub.plan.name || '');
        }
      })
      .catch(() => {});
  }, [token, currentUserRole]);

  const users = paginated?.data || [];

  // Extract unique departments and positions for dropdown suggestions
  const departments = Array.from(new Set(users.map((u: any) => u.department).filter(Boolean))).sort() as string[];
  const positions = Array.from(new Set(users.map((u: any) => u.position).filter(Boolean))).sort() as string[];

  const totalUsers = users.length;
  const activeUsers = users.filter((u: any) => u.isActive).length;
  const inactiveUsers = totalUsers - activeUsers;
  const managersCount = users.filter((u: any) => u.role === 'manager' || u.role === 'tenant_admin').length;

  // Helper to get manager name from id
  const getManagerName = (managerId: string | null) => {
    if (!managerId) return null;
    const mgr = users.find((u: any) => u.id === managerId);
    if (!mgr) return null;
    return `${mgr.firstName || ''} ${mgr.lastName || ''}`.trim() || mgr.email;
  };

  // Users who can be managers
  const managerOptions = users.filter((u: any) =>
    u.isActive && (u.role === 'manager' || u.role === 'tenant_admin'),
  );

  const handleCreate = async () => {
    if (!form.email || !form.firstName || !form.lastName || (!editingId && !form.password)) return;
    setErrorMsg('');

    // Check limit before creating
    if (!editingId && maxEmployees > 0 && activeUsers >= maxEmployees) {
      setErrorMsg(`Limite de usuarios alcanzado para el plan "${planName}". Maximo: ${maxEmployees}. Contacte al administrador del sistema para ampliar su plan.`);
      return;
    }

    setCreating(true);
    try {
      if (editingId) {
        const data: any = {
          firstName: form.firstName,
          lastName: form.lastName,
          role: form.role,
          department: form.department || undefined,
          position: form.position || undefined,
          managerId: form.managerId || null,
        };
        if (form.password) data.password = form.password;
        await updateUser.mutateAsync({ id: editingId, data });
      } else {
        await createUser.mutateAsync({
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
          password: form.password,
          role: form.role,
          department: form.department || null,
          position: form.position || null,
          managerId: form.managerId || undefined,
        });
      }
      setForm(emptyForm);
      setShowCreateForm(false);
      setEditingId(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al guardar usuario');
    } finally {
      setCreating(false);
    }
  };

  const handleEdit = (u: any) => {
    setEditingId(u.id);
    setForm({
      email: u.email,
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      password: '',
      role: u.role || 'employee',
      department: u.department || '',
      position: u.position || '',
      managerId: u.managerId || '',
    });
    setShowCreateForm(true);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`¿Eliminar a ${name}?`)) return;
    try {
      await removeUser.mutateAsync(id);
    } catch (err: any) {
      alert(err.message || 'Error al eliminar usuario');
    }
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  // Download CSV template (Spanish column names mapped to backend English names)
  const downloadTemplate = () => {
    const header = 'correo,nombre,apellido,contrasena,rol,departamento,cargo,fecha_ingreso';
    const example1 = 'juan.perez@empresa.cl,Juan,Perez,Clave123!,colaborador,Tecnologia,Desarrollador,15-01-2024';
    const example2 = 'maria.garcia@empresa.cl,Maria,Garcia,Clave123!,encargado_equipo,Ventas,Jefa de Ventas,01-06-2023';
    const example3 = 'carlos.lopez@empresa.cl,Carlos,Lopez,,colaborador,RRHH,Analista,';
    const csv = [header, example1, example2, example3].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'plantilla_usuarios_evapro.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // Map Spanish CSV columns to English backend columns
  const COLUMN_MAP: Record<string, string> = {
    correo: 'email', email: 'email',
    nombre: 'first_name', first_name: 'first_name',
    apellido: 'last_name', last_name: 'last_name',
    contrasena: 'password', password: 'password',
    rol: 'role', role: 'role',
    departamento: 'department', department: 'department',
    cargo: 'position', position: 'position',
    fecha_ingreso: 'hire_date', hire_date: 'hire_date',
  };

  // Map Spanish role names to backend codes
  const ROLE_MAP: Record<string, string> = {
    colaborador: 'employee', employee: 'employee',
    encargado_equipo: 'manager', manager: 'manager',
    encargado_sistema: 'tenant_admin', tenant_admin: 'tenant_admin',
    asesor_externo: 'external', external: 'external',
  };

  // Validate CSV content and return errors + converted content
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvPreviewRows, setCsvPreviewRows] = useState<string[][]>([]);

  const validateAndParseCSV = (text: string): { valid: boolean; errors: string[]; converted: string; previewRows: string[][] } => {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const errors: string[] = [];
    const previewRows: string[][] = [];

    if (lines.length < 2) {
      return { valid: false, errors: ['El archivo debe tener al menos el encabezado y una fila de datos.'], converted: '', previewRows: [] };
    }

    // Parse header
    const rawHeader = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const mappedHeader = rawHeader.map(h => COLUMN_MAP[h] || h);

    // Check required columns
    const requiredCols = ['email', 'first_name', 'last_name'];
    for (const col of requiredCols) {
      if (!mappedHeader.includes(col)) {
        const spanishName = col === 'email' ? 'correo' : col === 'first_name' ? 'nombre' : 'apellido';
        errors.push(`Columna requerida faltante: "${spanishName}" (o "${col}").`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors, converted: '', previewRows: [] };
    }

    const emailIdx = mappedHeader.indexOf('email');
    const fnIdx = mappedHeader.indexOf('first_name');
    const lnIdx = mappedHeader.indexOf('last_name');
    const roleIdx = mappedHeader.indexOf('role');
    const dateIdx = mappedHeader.indexOf('hire_date');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const validRoles = ['employee', 'manager', 'tenant_admin', 'external', 'colaborador', 'encargado_equipo', 'encargado_sistema', 'asesor_externo'];

    const convertedLines: string[] = [mappedHeader.join(',')];
    const seenEmails = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
      const rowNum = i + 1;

      // Basic field count check
      if (cols.length < 3) {
        errors.push(`Fila ${rowNum}: Muy pocos campos (${cols.length}). Se esperan al menos 3 (correo, nombre, apellido).`);
        continue;
      }

      // Validate email
      const email = cols[emailIdx] || '';
      if (!email) {
        errors.push(`Fila ${rowNum}: Correo electronico vacio.`);
      } else if (!emailRegex.test(email)) {
        errors.push(`Fila ${rowNum}: Correo electronico invalido: "${email}".`);
      } else if (seenEmails.has(email.toLowerCase())) {
        errors.push(`Fila ${rowNum}: Correo duplicado en el archivo: "${email}".`);
      } else {
        seenEmails.add(email.toLowerCase());
      }

      // Validate name
      if (!cols[fnIdx]) errors.push(`Fila ${rowNum}: Nombre vacio.`);
      if (!cols[lnIdx]) errors.push(`Fila ${rowNum}: Apellido vacio.`);

      // Validate role if provided
      if (roleIdx >= 0 && cols[roleIdx]) {
        const rawRole = cols[roleIdx].toLowerCase();
        if (!validRoles.includes(rawRole)) {
          errors.push(`Fila ${rowNum}: Rol invalido: "${cols[roleIdx]}". Valores permitidos: colaborador, encargado_equipo, encargado_sistema, asesor_externo.`);
        } else {
          // Map to backend code
          cols[roleIdx] = ROLE_MAP[rawRole] || rawRole;
        }
      }

      // Validate and convert date if provided (DD-MM-YYYY to YYYY-MM-DD)
      if (dateIdx >= 0 && cols[dateIdx]) {
        const dateVal = cols[dateIdx];
        if (dateRegex.test(dateVal)) {
          const [dd, mm, yyyy] = dateVal.split('-');
          const d = parseInt(dd), m = parseInt(mm), y = parseInt(yyyy);
          if (m < 1 || m > 12) errors.push(`Fila ${rowNum}: Mes invalido en fecha: "${dateVal}".`);
          else if (d < 1 || d > 31) errors.push(`Fila ${rowNum}: Dia invalido en fecha: "${dateVal}".`);
          else cols[dateIdx] = `${yyyy}-${mm}-${dd}`;
        } else if (!isoDateRegex.test(dateVal)) {
          errors.push(`Fila ${rowNum}: Formato de fecha invalido: "${dateVal}". Use DD-MM-AAAA (ej: 15-01-2024).`);
        }
      }

      convertedLines.push(cols.join(','));
      if (previewRows.length < 5) previewRows.push(cols);
    }

    return {
      valid: errors.length === 0,
      errors,
      converted: convertedLines.join('\n'),
      previewRows,
    };
  };

  // Handle file upload with validation
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (!text) return;
      const result = validateAndParseCSV(text);
      setCsvErrors(result.errors);
      setCsvPreviewRows(result.previewRows);
      // Store the converted (English columns + ISO dates) version
      setCsvContent(result.valid ? result.converted : '');
      setBulkResult(null);
    };
    reader.readAsText(file);
  };

  // Submit bulk import
  const handleBulkImport = async () => {
    if (!token || !csvContent.trim()) return;
    setBulkLoading(true);
    setBulkResult(null);
    setErrorMsg('');
    try {
      const result = await api.users.bulkImport(token, csvContent);
      setBulkResult(result);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al importar usuarios');
    } finally {
      setBulkLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    fontSize: '0.85rem',
    outline: 'none',
    width: '100%',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.72rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    marginBottom: '0.25rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Usuarios</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Gestiona empleados, roles y jerarquías de la organización
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-ghost"
              onClick={() => { setShowBulkImport(!showBulkImport); setShowCreateForm(false); setBulkResult(null); setCsvContent(''); }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              Carga masiva
            </button>
            <button
              className="btn-primary"
              onClick={() => { setShowCreateForm(!showCreateForm); setShowBulkImport(false); if (showCreateForm) { setEditingId(null); setForm(emptyForm); } }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Agregar usuario
            </button>
          </div>
        )}
      </div>

      {/* Create/Edit form */}
      {showCreateForm && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>
            {editingId ? 'Editar usuario' : 'Nuevo usuario'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={labelStyle}>Email *</label>
              <input
                style={{ ...inputStyle, ...(editingId ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
                placeholder="usuario@empresa.com"
                type="email"
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                readOnly={!!editingId}
              />
            </div>
            <div>
              <label style={labelStyle}>{editingId ? 'Nueva contraseña (opcional)' : 'Contraseña *'}</label>
              <input
                style={inputStyle}
                placeholder={editingId ? 'Dejar vacío para no cambiar' : 'Mínimo 6 caracteres'}
                type="password"
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Nombre *</label>
              <input
                style={inputStyle}
                placeholder="Nombre"
                value={form.firstName}
                onChange={(e) => updateField('firstName', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Apellido *</label>
              <input
                style={inputStyle}
                placeholder="Apellido"
                value={form.lastName}
                onChange={(e) => updateField('lastName', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Rol</label>
              <select
                style={inputStyle}
                value={form.role}
                onChange={(e) => updateField('role', e.target.value)}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Jefatura directa</label>
              <select
                style={inputStyle}
                value={form.managerId}
                onChange={(e) => updateField('managerId', e.target.value)}
              >
                <option value="">Sin jefatura asignada</option>
                {managerOptions
                  .filter((m: any) => m.id !== editingId)
                  .map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} ({getRoleLabel(m.role)})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Departamento</label>
              <input
                style={inputStyle}
                list="dept-options"
                placeholder="Seleccionar o escribir nuevo"
                value={form.department}
                onChange={(e) => updateField('department', e.target.value)}
              />
              <datalist id="dept-options">
                {departments.map((d) => <option key={d} value={d} />)}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>Cargo</label>
              <input
                style={inputStyle}
                list="pos-options"
                placeholder="Seleccionar o escribir nuevo"
                value={form.position}
                onChange={(e) => updateField('position', e.target.value)}
              />
              <datalist id="pos-options">
                {positions.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button className="btn-primary" onClick={handleCreate} disabled={creating}>
              {creating ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear usuario'}
            </button>
            <button className="btn-ghost" onClick={() => { setShowCreateForm(false); setForm(emptyForm); setEditingId(null); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Bulk import panel */}
      {showBulkImport && isAdmin && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>Carga masiva de usuarios</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Suba un archivo CSV con los datos de los usuarios. La contrasena por defecto sera <code style={{ background: 'var(--bg-surface)', padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.8rem' }}>EvaPro2026!</code> si no se especifica.
          </p>

          {/* Step 1: Download template */}
          <div style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>1. Descargar plantilla CSV</div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Descargue la plantilla con datos de ejemplo, completela con los datos de sus empleados y vuelva a subirla.
            </p>
            <button className="btn-ghost" onClick={downloadTemplate} style={{ fontSize: '0.82rem' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Descargar plantilla
            </button>
          </div>

          {/* Columns reference */}
          <div style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.75rem' }}>Referencia de columnas</div>
            <div className="table-wrapper" style={{ fontSize: '0.78rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Columna</th>
                    <th>Obligatoria</th>
                    <th>Descripcion</th>
                    <th>Ejemplo</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['correo', 'Si', 'Correo electronico del usuario', 'juan@empresa.cl'],
                    ['nombre', 'Si', 'Nombre del usuario', 'Juan'],
                    ['apellido', 'Si', 'Apellido del usuario', 'Perez'],
                    ['contrasena', 'No', 'Si se deja vacia, se asigna: EvaPro2026!', 'MiClave123!'],
                    ['rol', 'No', 'Ver tabla de roles abajo. Default: colaborador', 'colaborador'],
                    ['departamento', 'No', 'Area o departamento de trabajo', 'Tecnologia'],
                    ['cargo', 'No', 'Puesto o cargo del usuario', 'Desarrollador Senior'],
                    ['fecha_ingreso', 'No', 'Formato: DD-MM-AAAA', '15-01-2024'],
                  ].map(([col, req, desc, ej]) => (
                    <tr key={col}>
                      <td><code style={{ background: 'rgba(99,102,241,0.1)', padding: '0.1rem 0.3rem', borderRadius: '3px', fontWeight: 600 }}>{col}</code></td>
                      <td style={{ color: req === 'Si' ? 'var(--danger)' : 'var(--text-muted)', fontWeight: req === 'Si' ? 600 : 400 }}>{req}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{desc}</td>
                      <td style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{ej}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Roles detail box */}
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(99,102,241,0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(99,102,241,0.15)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#6366f1', marginBottom: '0.5rem' }}>Valores permitidos para la columna "rol"</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.78rem' }}>
                {[
                  ['colaborador', 'Empleado base (default si se deja vacio)'],
                  ['encargado_equipo', 'Jefe de equipo / Manager'],
                  ['encargado_sistema', 'Administrador de la organizacion (RRHH)'],
                  ['asesor_externo', 'Evaluador externo (solo lectura)'],
                ].map(([code, desc]) => (
                  <div key={code} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <code style={{ background: 'rgba(99,102,241,0.15)', padding: '0.1rem 0.4rem', borderRadius: '3px', fontWeight: 600, whiteSpace: 'nowrap', fontSize: '0.75rem' }}>{code}</code>
                    <span style={{ color: 'var(--text-secondary)' }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Date format box */}
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(245,158,11,0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(245,158,11,0.15)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#f59e0b', marginBottom: '0.3rem' }}>Formato de fecha</div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0 }}>
                Use el formato <strong>DD-MM-AAAA</strong> (dia-mes-ano). Ejemplo: <code style={{ background: 'rgba(245,158,11,0.1)', padding: '0.1rem 0.3rem', borderRadius: '3px' }}>15-01-2024</code> para el 15 de enero de 2024. Si no se indica fecha, el campo queda vacio.
              </p>
            </div>
          </div>

          {/* Step 2: Upload file */}
          <div style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>2. Subir archivo CSV</div>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}
            />

            {/* Validation errors */}
            {csvErrors.length > 0 && (
              <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--danger)', marginBottom: '0.4rem' }}>
                  Se encontraron {csvErrors.length} error{csvErrors.length !== 1 ? 'es' : ''} en el archivo:
                </div>
                <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                  {csvErrors.map((err, i) => (
                    <div key={i} style={{ fontSize: '0.78rem', color: 'var(--danger)', padding: '0.15rem 0', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                      <span style={{ color: 'var(--danger)', fontWeight: 700, flexShrink: 0 }}>x</span>
                      <span>{err}</span>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', marginBottom: 0 }}>
                  Corrija los errores en el archivo CSV y vuelva a subirlo.
                </p>
              </div>
            )}

            {/* Preview table when valid */}
            {csvContent && csvErrors.length === 0 && csvPreviewRows.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--success)', fontWeight: 600, marginBottom: '0.4rem' }}>
                  Archivo valido — {csvContent.trim().split('\n').length - 1} usuarios para importar
                </div>
                <div className="table-wrapper" style={{ fontSize: '0.75rem' }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Correo</th>
                        <th>Nombre</th>
                        <th>Apellido</th>
                        <th>Rol</th>
                        <th>Departamento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvPreviewRows.map((row, i) => {
                        const h = csvContent.split('\n')[0].split(',');
                        const emailI = h.indexOf('email');
                        const fnI = h.indexOf('first_name');
                        const lnI = h.indexOf('last_name');
                        const rI = h.indexOf('role');
                        const dI = h.indexOf('department');
                        return (
                          <tr key={i}>
                            <td>{row[emailI] || '--'}</td>
                            <td>{row[fnI] || '--'}</td>
                            <td>{row[lnI] || '--'}</td>
                            <td>{row[rI] || 'employee'}</td>
                            <td>{row[dI] || '--'}</td>
                          </tr>
                        );
                      })}
                      {csvContent.trim().split('\n').length - 1 > 5 && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                          ...y {csvContent.trim().split('\n').length - 1 - 5} filas mas
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Server result */}
          {bulkResult && (
            <div style={{
              padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem',
              background: bulkResult.status === 'completed' ? 'rgba(16,185,129,0.1)' : bulkResult.status === 'failed' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
              border: `1px solid ${bulkResult.status === 'completed' ? 'rgba(16,185,129,0.25)' : bulkResult.status === 'failed' ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
            }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.4rem', color: bulkResult.status === 'completed' ? 'var(--success)' : bulkResult.status === 'failed' ? 'var(--danger)' : 'var(--warning)' }}>
                {bulkResult.status === 'completed' ? 'Importacion completada exitosamente' : bulkResult.status === 'failed' ? 'Importacion fallida' : 'Importacion completada con errores'}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Total: {bulkResult.totalRows} | Exitosos: {bulkResult.successRows} | Errores: {bulkResult.errorRows}
              </div>
              {bulkResult.errors && bulkResult.errors.length > 0 && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.78rem' }}>
                  {bulkResult.errors.map((err: any, i: number) => (
                    <div key={i} style={{ color: 'var(--danger)', marginTop: '0.2rem' }}>
                      Fila {err.row}: {err.message}
                    </div>
                  ))}
                </div>
              )}
              {bulkResult.successRows > 0 && (
                <button
                  className="btn-primary"
                  style={{ marginTop: '0.75rem', fontSize: '0.8rem', padding: '0.35rem 0.8rem' }}
                  onClick={() => window.location.reload()}
                >
                  Cerrar y actualizar lista
                </button>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              className="btn-primary"
              onClick={handleBulkImport}
              disabled={bulkLoading || !csvContent.trim() || csvErrors.length > 0}
            >
              {bulkLoading ? 'Importando...' : `Importar ${csvContent ? csvContent.trim().split('\\n').length - 1 : 0} usuarios`}
            </button>
            <button className="btn-ghost" onClick={() => { setShowBulkImport(false); setCsvContent(''); setBulkResult(null); setCsvErrors([]); setCsvPreviewRows([]); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Subscription usage warning */}
      {maxEmployees > 0 && (
        <div className="animate-fade-up-delay-1" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Usuarios: {activeUsers} / {maxEmployees} ({planName})
            </span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: activeUsers >= maxEmployees ? 'var(--danger)' : activeUsers / maxEmployees > 0.8 ? 'var(--warning)' : 'var(--success)' }}>
              {Math.round((activeUsers / maxEmployees) * 100)}%
            </span>
          </div>
          <div style={{ height: '6px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min((activeUsers / maxEmployees) * 100, 100)}%`,
              background: activeUsers >= maxEmployees ? 'var(--danger)' : activeUsers / maxEmployees > 0.8 ? 'var(--warning)' : 'var(--success)',
              borderRadius: '999px', transition: 'width 0.6s ease',
            }} />
          </div>
          {activeUsers >= maxEmployees && (
            <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginTop: '0.5rem', fontWeight: 500 }}>
              Has alcanzado el limite de usuarios de tu plan. Contacta al administrador del sistema para ampliar tu suscripcion.
            </p>
          )}
          {activeUsers / maxEmployees > 0.8 && activeUsers < maxEmployees && (
            <p style={{ color: 'var(--warning)', fontSize: '0.82rem', marginTop: '0.5rem', fontWeight: 500 }}>
              Estas cerca del limite de usuarios de tu plan ({maxEmployees - activeUsers} disponibles).
            </p>
          )}
        </div>
      )}

      {/* Error message */}
      {errorMsg && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{errorMsg}</span>
          <button onClick={() => setErrorMsg('')} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 700, fontSize: '1rem' }}>x</button>
        </div>
      )}

      {/* Stats row */}
      <div className="animate-fade-up-delay-1" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total usuarios', value: String(totalUsers), color: 'var(--accent-hover)' },
          { label: 'Activos', value: String(activeUsers), color: 'var(--success)' },
          { label: 'Inactivos', value: String(inactiveUsers), color: 'var(--text-muted)' },
          { label: 'Managers / Admins', value: String(managersCount), color: 'var(--warning)' },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No hay usuarios registrados</p>
        </div>
      ) : (
        <div className="card animate-fade-up-delay-2" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Cargo</th>
                  <th>Departamento</th>
                  <th>Jefatura</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => {
                  const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
                  const managerName = getManagerName(u.managerId);
                  return (
                    <tr key={u.id}>
                      <td>
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }}
                          onClick={() => router.push(`/dashboard/usuarios/${u.id}`)}
                        >
                          <Avatar name={fullName} />
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.875rem' }}>{fullName}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          {u.position || '–'}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.82rem' }}>
                          {u.department || '–'}
                        </span>
                      </td>
                      <td>
                        {managerName ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent-hover)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                            </svg>
                            <span style={{ fontSize: '0.82rem', color: 'var(--accent-hover)', fontWeight: 500 }}>
                              {managerName}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Sin jefatura
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${getRoleBadge(u.role)}`}>
                          {getRoleLabel(u.role)}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${u.isActive ? 'badge-success' : 'badge-warning'}`}>
                          {u.isActive ? 'activo' : 'inactivo'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            className="btn-ghost"
                            style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                            onClick={() => router.push(`/dashboard/usuarios/${u.id}`)}
                          >
                            Perfil
                          </button>
                          {isAdmin && (
                            <button
                              className="btn-ghost"
                              style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                              onClick={() => handleEdit(u)}
                            >
                              Editar
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              className="btn-ghost"
                              style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', color: 'var(--danger)' }}
                              onClick={() => handleDelete(u.id, fullName)}
                            >
                              Eliminar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
