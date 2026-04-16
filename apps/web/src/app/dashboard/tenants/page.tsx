'use client';

import { useEffect, useState } from 'react';
import { api, type Tenant } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatCLP } from '@/lib/format';
import { formatRutInput, validateRut, formatRut } from '@/lib/rut';
import TenantHealthBadge from '@/components/TenantHealthBadge';
import ImpersonateTenantButton from '@/components/ImpersonateTenantButton';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const planColor: Record<string, string> = {
  starter: 'badge-accent',
  pro: 'badge-warning',
  enterprise: 'badge-success',
  custom: 'badge-danger',
};

const INDUSTRIES = [
  'Tecnología', 'Retail / Comercio', 'Servicios Financieros', 'Salud', 'Educación',
  'Manufactura', 'Construcción', 'Minería', 'Energía', 'Telecomunicaciones',
  'Transporte y Logística', 'Agricultura', 'Gobierno', 'Consultoría', 'Otro',
];
const EMPLOYEE_RANGES = ['1-15', '16-50', '51-100', '101-200', '201-500', '501-1000', '1000+'];

const emptyForm = {
  name: '',
  slug: '',
  rut: '',
  ownerType: 'company',
  industry: '',
  employeeRange: '',
  commercialAddress: '',
  legalRepName: '',
  legalRepRut: '',
  planId: '',
  billingPeriod: 'monthly',
};

// Auto-generate slug from org name
const autoSlug = (name: string) =>
  name.toLowerCase()
    .replace(/[áÃ ä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export default function TenantsPage() {
  const token = useAuthStore((s) => s.token);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);

  // Admin modal state
  const [adminModalTenant, setAdminModalTenant] = useState<Tenant | null>(null);
  const [adminData, setAdminData] = useState<any>(null);
  const [adminForm, setAdminForm] = useState({ email: '', firstName: '', lastName: '', rut: '', password: '', hireDate: '', department: '', position: '', hierarchyLevel: '' });
  const [adminDepts, setAdminDepts] = useState<string[]>([]);
  const [adminPositions, setAdminPositions] = useState<any[]>([]);
  const [adminSaving, setAdminSaving] = useState(false);
  const [showNewDept, setShowNewDept] = useState(false);
  const [showNewPos, setShowNewPos] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [adminSuccess, setAdminSuccess] = useState('');

  // Fetch available subscription plans and existing subscriptions
  useEffect(() => {
    if (!token) return;
    api.subscriptions.plans.list(token)
      .then((p: any[]) => setPlans(p.filter((pl: any) => pl.isActive)))
      .catch(() => {});
    api.subscriptions.list(token)
      .then(setSubscriptions)
      .catch(() => {});
  }, [token]);

  // Helper: get active subscription for a tenant
  const getSubscription = (tenantId: string) =>
    subscriptions.find((s: any) => s.tenantId === tenantId && s.status !== 'cancelled');

  const fetchTenants = () => {
    if (!token) return;
    setLoading(true);
    api.tenants.list(token)
      .then(setTenants)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTenants();
  }, [token]);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setShowForm(false);
    setEditingId(null);
    setError('');
  };

  const handleCreate = async () => {
    if (!token || !form.name || !form.rut) {
      setError('Nombre y RUT son obligatorios');
      return;
    }
    if (!validateRut(form.rut)) {
      setError('RUT invalido. Verifique el formato y digito verificador.');
      return;
    }
    if (!form.planId) {
      setError('Debe seleccionar un plan de suscripción');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await api.tenants.create({
        name: form.name,
        slug: autoSlug(form.name),
        rut: form.rut,
        ownerType: form.ownerType,
        industry: form.industry || undefined,
        employeeRange: form.employeeRange || undefined,
        commercialAddress: form.commercialAddress || undefined,
      }, token);

      // Create subscription for the new tenant
      const tenantId = result?.tenant?.id;
      if (tenantId && form.planId) {
        try {
          await api.subscriptions.create(token, {
            tenantId,
            planId: form.planId,
            billingPeriod: form.billingPeriod,
            status: 'active',
            startDate: new Date().toISOString().slice(0, 10),
          });
        } catch {
          // Subscription creation failed but org was created
          setError('Organizacion creada, pero hubo un error asignando la suscripcion. Asignela manualmente desde Suscripciones.');
        }
      }

      setSuccess('Organizacion creada correctamente con suscripcion asignada');
      resetForm();
      fetchTenants();
      setTimeout(() => setSuccess(''), 4000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!token || !editingId) return;
    setSaving(true);
    setError('');
    try {
      await api.tenants.update(token, editingId, {
        name: form.name,
        slug: form.slug,
        rut: form.rut,
        ownerType: form.ownerType,
        industry: form.industry || null,
        employeeRange: form.employeeRange || null,
        commercialAddress: form.commercialAddress || null,
        legalRepName: form.legalRepName || null,
        legalRepRut: form.legalRepRut || null,
      });

      // Update or create subscription if plan changed
      if (form.planId) {
        const existingSub = getSubscription(editingId);
        if (existingSub) {
          // Update existing subscription if plan or billing period changed
          const planChanged = existingSub.planId !== form.planId;
          const periodChanged = (existingSub.billingPeriod?.toLowerCase() || 'monthly') !== form.billingPeriod;
          if (planChanged || periodChanged) {
            await api.subscriptions.update(token, existingSub.id, { planId: form.planId, billingPeriod: form.billingPeriod });
          }
        } else {
          // Create new subscription
          await api.subscriptions.create(token, {
            tenantId: editingId,
            planId: form.planId,
            status: 'active',
            startDate: new Date().toISOString().slice(0, 10),
          });
        }
      }

      setSuccess('Organizacion actualizada');
      resetForm();
      fetchTenants();
      // Refresh subscriptions
      api.subscriptions.list(token).then(setSubscriptions).catch(() => {});
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id: string, name: string) => {
    if (!token) return;
    if (!confirm(`Desactivar la organización "${name}"?`)) return;
    try {
      await api.tenants.deactivate(token, id);
      setSuccess('Organizacion desactivada');
      fetchTenants();
      setTimeout(() => setSuccess(''), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startEdit = (t: Tenant) => {
    const sub = getSubscription(t.id);
    setForm({
      name: t.name,
      slug: t.slug,
      rut: t.rut ? formatRut(t.rut) : '',
      ownerType: t.ownerType,
      industry: t.industry || '',
      employeeRange: t.employeeRange || '',
      commercialAddress: t.commercialAddress || '',
      legalRepName: t.legalRepName || '',
      legalRepRut: t.legalRepRut ? formatRut(t.legalRepRut) : '',
      planId: sub?.planId || '',
      billingPeriod: sub?.billingPeriod?.toLowerCase() || 'monthly',
    });
    setEditingId(t.id);
    setShowForm(true);
    setError('');
  };

  const openAdminModal = async (t: Tenant) => {
    setAdminModalTenant(t);
    setAdminData(null);
    setAdminError('');
    setAdminSuccess('');
    setShowNewDept(false);
    setShowNewPos(false);
    setAdminForm({ email: '', firstName: '', lastName: '', rut: '', password: '', hireDate: '', department: '', position: '', hierarchyLevel: '' });

    // Load tenant departments and positions from table (with settings fallback)
    let depts: string[] = [];
    let positions: any[] = [];
    if (token) {
      try {
        const deptRecords = await api.tenants.getDepartmentsForTenant(token, t.id);
        if (Array.isArray(deptRecords) && deptRecords.length > 0) {
          depts = deptRecords.filter((d: any) => d.isActive).map((d: any) => d.name);
        }
      } catch {}
      try {
        const posRecords = await api.tenants.getPositionsForTenant(token, t.id);
        if (Array.isArray(posRecords) && posRecords.length > 0) {
          positions = posRecords.filter((p: any) => p.isActive).map((p: any) => ({ name: p.name, level: p.level }));
        }
      } catch {}
    }
    // Fallback to settings if table endpoints fail or return empty
    if (depts.length === 0) {
      depts = Array.isArray(t.settings?.departments) ? t.settings.departments : [];
    }
    if (positions.length === 0) {
      positions = Array.isArray(t.settings?.positions) ? t.settings.positions.filter((p: any) => p?.name) : [];
    }
    setAdminDepts(depts);
    setAdminPositions(positions);

    // Load existing admin
    if (token) {
      try {
        const res: any = await api.users.list(token, 1, 5, { role: 'tenant_admin', tenantId: t.id });
        const users = (res as any).data || res || [];
        const admin = users.find((u: any) => u.role === 'tenant_admin');
        if (admin) {
          setAdminData(admin);
          setAdminForm({
            email: admin.email || '',
            firstName: admin.firstName || '',
            lastName: admin.lastName || '',
            rut: admin.rut ? formatRut(admin.rut) : '',
            password: '',
            hireDate: admin.hireDate ? admin.hireDate.slice(0, 10) : '',
            department: admin.department || '',
            position: admin.position || '',
            hierarchyLevel: '',
          });
          // If admin's department/position not in catalog, show as custom
          if (admin.department && !depts.includes(admin.department)) setShowNewDept(true);
          if (admin.position && !positions.some((p: any) => p.name === admin.position)) setShowNewPos(true);
        }
      } catch {}
    }
  };

  const saveAdmin = async () => {
    if (!token || !adminModalTenant) return;
    // Validate
    if (!adminForm.email?.trim()) { setAdminError('Email es obligatorio'); return; }
    if (!adminForm.firstName?.trim()) { setAdminError('Nombres es obligatorio'); return; }
    if (!adminForm.lastName?.trim()) { setAdminError('Apellidos es obligatorio'); return; }
    if (!adminForm.rut?.trim()) { setAdminError('RUT es obligatorio'); return; }
    if (!validateRut(adminForm.rut)) { setAdminError('RUT invalido. Verifique el formato y digito verificador.'); return; }
    if (!adminData && !adminForm.password?.trim()) { setAdminError('Contrase\u00f1a es obligatoria para nuevo administrador'); return; }
    if (showNewDept && !adminForm.department?.trim()) { setAdminError('Nombre del departamento es obligatorio'); return; }
    if (showNewPos && !adminForm.position?.trim()) { setAdminError('Nombre del cargo es obligatorio'); return; }
    if (showNewPos && (!adminForm.hierarchyLevel || Number(adminForm.hierarchyLevel) < 1)) { setAdminError('Nivel jer\u00e1rquico es obligatorio para cargo nuevo (1 = m\u00e1s alto)'); return; }

    setAdminSaving(true);
    setAdminError('');
    try {
      if (adminData?.id) {
        // Update existing admin
        const upd: any = {
          email: adminForm.email.trim(),
          firstName: adminForm.firstName.trim(),
          lastName: adminForm.lastName.trim(),
          rut: adminForm.rut.trim(),
          department: adminForm.department || null,
          position: adminForm.position || null,
          hireDate: adminForm.hireDate || null,
        };
        if (adminForm.password?.trim()) upd.password = adminForm.password.trim();
        // Send hierarchy level for new positions
        if (adminForm.position && !adminPositions.some((p: any) => p.name === adminForm.position) && adminForm.hierarchyLevel) {
          upd.hierarchyLevel = Number(adminForm.hierarchyLevel);
        }
        await api.users.update(token, adminData.id, upd);
        setAdminSuccess('Administrador actualizado correctamente');
      } else {
        // Create new admin
        await api.users.create(token, {
          tenantId: adminModalTenant.id,
          email: adminForm.email.trim(),
          firstName: adminForm.firstName.trim(),
          lastName: adminForm.lastName.trim(),
          rut: adminForm.rut.trim(),
          password: adminForm.password.trim(),
          role: 'tenant_admin',
          department: adminForm.department || null,
          position: adminForm.position || null,
          hireDate: adminForm.hireDate || null,
          hierarchyLevel: adminForm.hierarchyLevel ? Number(adminForm.hierarchyLevel) : undefined,
          mustChangePassword: true,
        });
        setAdminSuccess('Administrador creado correctamente');
      }
      setTimeout(() => { setAdminModalTenant(null); setAdminSuccess(''); }, 2000);
    } catch (e: any) {
      setAdminError(e.message || 'Error al guardar');
    }
    setAdminSaving(false);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.55rem 0.75rem',
    fontSize: '0.85rem',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    transition: 'var(--transition)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '0.78rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '0.3rem',
    display: 'block',
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Organizaciones</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Gestión de organizaciónes de la plataforma</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => { setShowUpload(!showUpload); setUploadResult(null); }}>
            {showUpload ? 'Cancelar carga' : 'Cargar desde Excel'}
          </button>
          <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
            + Nueva organización
          </button>
        </div>
      </div>

      {/* Excel Upload Section */}
      {showUpload && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem' }}>Cargar Organización desde Excel</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            Suba la plantilla de onboarding para crear una organización completa con su administrador, departamentos, cargos, competencias y colaboradores.
          </p>
          <button className="btn-ghost" style={{ fontSize: '0.82rem', marginBottom: '0.75rem' }}
            onClick={async () => {
              const XLSX = await import('xlsx/dist/xlsx.mini.min');
              const wb = XLSX.utils.book_new();
              // IMPORTANT: Row numbers must match the parser's getVal() calls exactly
              // Parser reads: org rows 5-15, admin rows 5-11, depts col2 rows 5+, positions col2 rows 5+, competencies col2 rows 5+, users row 5+

              // Hoja 1: Organización (parser reads row 5=name, 6=rut, ..., 14=legalRepName, 15=legalRepRut)
              const orgData = [
                ['PLANTILLA DE ONBOARDING - EVAPRO'], [''],
                ['DATOS DE LA ORGANIZACIÓN'], ['Campo', 'Valor'],
                ['Nombre de la empresa *', ''],           // row 5 â†’ getVal(s(0), 5, 2)
                ['RUT de la empresa', ''],                // row 6
                ['Tipo (company/consultant)', 'company'], // row 7
                ['Industria', ''],                        // row 8
                ['Rango de colaboradores', ''],            // row 9
                ['Dirección comercial', ''],               // row 10
                ['Plan (starter/growth/pro/enterprise)', 'starter'], // row 11
                ['Período facturación (monthly/quarterly/semiannual/yearly)', 'monthly'], // row 12
                ['Fecha de inicio (YYYY-MM-DD)', new Date().toISOString().split('T')[0]], // row 13
                ['Nombre representante legal', ''],        // row 14
                ['RUT representante legal', ''],            // row 15
              ];
              const ws1 = XLSX.utils.aoa_to_sheet(orgData);
              ws1['!cols'] = [{ wch: 48 }, { wch: 40 }];
              XLSX.utils.book_append_sheet(wb, ws1, 'Organización');

              // Hoja 2: Administrador (parser reads rows 5-11)
              const adminData = [
                ['ADMINISTRADOR DEL SISTEMA'], [''],
                ['El primer usuario creado tendrá rol de Administrador'], ['Campo', 'Valor'],
                ['Email *', ''],              // row 5
                ['Nombres *', ''],            // row 6
                ['Apellidos *', ''],          // row 7
                ['RUT *', ''],                // row 8
                ['Contraseña temporal *', 'EvaPro2026!'], // row 9
                ['Cargo', ''],                // row 10
                ['Departamento', ''],         // row 11
              ];
              const ws2 = XLSX.utils.aoa_to_sheet(adminData);
              ws2['!cols'] = [{ wch: 32 }, { wch: 40 }];
              XLSX.utils.book_append_sheet(wb, ws2, 'Administrador');

              // Hoja 3: Departamentos (parser reads col 2 starting row 5)
              const deptData = [
                ['DEPARTAMENTOS'], [''],
                ['Ingrese un departamento por fila en la columna B'], ['', 'Nombre del departamento'],
                ['', 'Tecnología'],           // row 5, col 2
                ['', 'Ventas'],               // row 6, col 2
                ['', 'Recursos Humanos'],
                ['', 'Finanzas'],
                ['', 'Operaciones'],
                ['', 'Marketing'],
                ['', 'Legal'],
                ['', 'Administración'],
              ];
              const ws3 = XLSX.utils.aoa_to_sheet(deptData);
              ws3['!cols'] = [{ wch: 8 }, { wch: 30 }];
              XLSX.utils.book_append_sheet(wb, ws3, 'Departamentos');

              // Hoja 4: Cargos (parser reads col 2=name, col 3=level starting row 5)
              const posData = [
                ['CATÁLOGO DE CARGOS'], [''],
                ['Nombre en col B, nivel en col C (1=más alto)'], ['', 'Nombre del cargo', 'Nivel'],
                ['', 'Gerente General', 1],   // row 5
                ['', 'Gerente de Área', 2],
                ['', 'Jefe de Departamento', 3],
                ['', 'Coordinador', 4],
                ['', 'Analista Senior', 5],
                ['', 'Analista', 6],
                ['', 'Asistente', 7],
              ];
              const ws4 = XLSX.utils.aoa_to_sheet(posData);
              ws4['!cols'] = [{ wch: 8 }, { wch: 28 }, { wch: 8 }];
              XLSX.utils.book_append_sheet(wb, ws4, 'Cargos');

              // Hoja 5: Competencias (parser reads col 2=name, col 3=category starting row 5)
              const compData = [
                ['COMPETENCIAS (opcional)'], [''],
                ['Nombre en col B, categoría en col C'], ['', 'Nombre', 'Categoría', 'Descripción', 'Nivel esperado'],
                ['', 'Liderazgo', 'Habilidades directivas', 'Capacidad para guiar equipos', 3],
                ['', 'Comunicación', 'Habilidades interpersonales', 'Comunicación efectiva', 3],
                ['', 'Trabajo en equipo', 'Habilidades interpersonales', '', 3],
              ];
              const ws5 = XLSX.utils.aoa_to_sheet(compData);
              ws5['!cols'] = [{ wch: 8 }, { wch: 25 }, { wch: 25 }, { wch: 35 }, { wch: 14 }];
              XLSX.utils.book_append_sheet(wb, ws5, 'Competencias');

              // Hoja 6: Colaboradores (parser reads row 5+ with col 1=email)
              const usrData = [
                ['COLABORADORES'], [''],
                ['Complete los datos de cada colaborador desde la fila 5'],
                ['Email *', 'Nombres *', 'Apellidos *', 'RUT', 'Contraseña *', 'Rol (manager/employee)', 'Departamento', 'Cargo', 'Fecha ingreso', 'Email jefe directo'],
                ['ejemplo@empresa.cl', 'Juan', 'Pérez', '12345678-9', 'EvaPro2026!', 'employee', 'Ventas', 'Ejecutivo de Ventas', '2024-01-15', 'jefe@empresa.cl'],
              ];
              const ws6 = XLSX.utils.aoa_to_sheet(usrData);
              ws6['!cols'] = [{ wch: 25 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 25 }];
              XLSX.utils.book_append_sheet(wb, ws6, 'Colaboradores');
              XLSX.writeFile(wb, 'Plantilla_Onboarding_EvaPro.xlsx');
            }}>
            {'ðŸ“¥'} Descargar plantilla Excel
          </button>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file || !token) return;
              setUploading(true);
              setUploadResult(null);
              setError('');
              try {
                const XLSX = await import('xlsx/dist/xlsx.mini.min');
                const data_ab = await file.arrayBuffer();
                const wb = XLSX.read(data_ab, { type: 'array' });

                // Parse helper: get cell value from sheet
                const getVal = (sheetName: string, row: number, col: number) => {
                  const ws = wb.Sheets[sheetName];
                  if (!ws) return '';
                  const cellRef = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
                  const cell = ws[cellRef];
                  if (!cell) return '';
                  // Handle hyperlinks, rich text, and other complex cell types
                  const val = cell.w || cell.v;
                  if (val == null) return '';
                  if (typeof val === 'object') {
                    // Hyperlink: { text, hyperlink } or rich text array
                    if (val.text) return String(val.text).trim();
                    if (val.hyperlink) return String(val.hyperlink).trim();
                    if (Array.isArray(val)) return val.map((v: any) => v?.t || v?.text || String(v)).join('').trim();
                    return JSON.stringify(val);
                  }
                  return String(val).trim();
                };
                const sheetName = (idx: number) => wb.SheetNames[idx] || '';
                const s = (idx: number) => sheetName(idx);
                const org = {
                  name: getVal(s(0), 5, 2),
                  rut: getVal(s(0), 6, 2),
                  ownerType: getVal(s(0), 7, 2) || 'company',
                  industry: getVal(s(0), 8, 2),
                  employeeRange: getVal(s(0), 9, 2),
                  commercialAddress: getVal(s(0), 10, 2),
                  plan: getVal(s(0), 11, 2) || 'starter',
                  billingPeriod: getVal(s(0), 12, 2) || 'monthly',
                  startDate: getVal(s(0), 13, 2) || new Date().toISOString().split('T')[0],
                  legalRepName: getVal(s(0), 14, 2) || '',
                  legalRepRut: getVal(s(0), 15, 2) || '',
                };

                const admin = {
                  email: getVal(s(1), 5, 2),
                  firstName: getVal(s(1), 6, 2),
                  lastName: getVal(s(1), 7, 2),
                  rut: getVal(s(1), 8, 2),
                  password: getVal(s(1), 9, 2),
                  position: getVal(s(1), 10, 2),
                  department: getVal(s(1), 11, 2),
                };

                const departments: string[] = [];
                for (let r = 5; r <= 24; r++) {
                  const name = getVal(s(2), r, 2);
                  if (name) departments.push(name);
                }

                const positions: { name: string; level: number }[] = [];
                for (let r = 5; r <= 19; r++) {
                  const name = getVal(s(3), r, 2);
                  const level = parseInt(getVal(s(3), r, 3));
                  if (name && level) positions.push({ name, level });
                }

                const competencies: any[] = [];
                for (let r = 5; r <= 19; r++) {
                  const name = getVal(s(4), r, 2);
                  const category = getVal(s(4), r, 3);
                  if (name && category) competencies.push({
                    name, category,
                    description: getVal(s(4), r, 4),
                    expectedLevel: parseInt(getVal(s(4), r, 5)) || undefined,
                  });
                }

                const users: any[] = [];
                for (let r = 5; r <= 54; r++) {
                  const email = getVal(s(5), r, 1);
                  if (!email || !email.includes('@')) continue;
                  users.push({
                    email,
                    firstName: getVal(s(5), r, 2),
                    lastName: getVal(s(5), r, 3),
                    rut: getVal(s(5), r, 4),
                    password: getVal(s(5), r, 5),
                    role: getVal(s(5), r, 6) || 'employee',
                    department: getVal(s(5), r, 7),
                    position: getVal(s(5), r, 8),
                    hireDate: getVal(s(5), r, 9),
                    managerEmail: getVal(s(5), r, 10),
                  });
                }

                if (!org.name || !admin.email || !admin.password || !admin.firstName || !admin.lastName) {
                  setError('Faltan datos obligatorios: nombre de organización, correo, contraseña, nombres y apellidos del administrador');
                  setUploading(false);
                  return;
                }

                const result = await api.tenants.bulkOnboard(token, { org, admin, departments, positions, competencies, users });
                setUploadResult(result);
                setSuccess('Organización creada exitosamente');
                // Reload tenants list
                api.tenants.list(token).then(setTenants).catch(() => {});
              } catch (err: any) {
                setError(err.message || 'Error al procesar el archivo');
              }
              setUploading(false);
            }}
            disabled={uploading}
            style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}
          />
          {uploading && <p style={{ color: 'var(--accent)', fontSize: '0.85rem', fontWeight: 600 }}>Procesando archivo...</p>}

          {uploadResult && (
            <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--success)', marginBottom: '0.5rem' }}>Organización creada exitosamente</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {(uploadResult.summary || []).map((s: string, i: number) => (
                  <div key={i}>{s.startsWith('ADVERTENCIA') ? <span style={{ color: 'var(--warning)' }}>{s}</span> : s}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      {error && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 'var(--radius-sm)', color: 'var(--success)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          {success}
        </div>
      )}

      {/* Inline Form */}
      {showForm && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>
            {editingId ? 'Editar organización' : 'Nueva organización'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Razón Social *</label>
              <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mi Empresa S.A." />
            </div>
            <div>
              <label style={labelStyle}>RUT Empresa *</label>
              <input style={inputStyle} value={form.rut} onChange={(e) => setForm({ ...form, rut: formatRutInput(e.target.value) })} placeholder="76.123.456-7" maxLength={12} />
            </div>
            <div>
              <label style={labelStyle}>Tipo propietario</label>
              <select style={inputStyle} value={form.ownerType} onChange={(e) => setForm({ ...form, ownerType: e.target.value })}>
                <option value="company">Empresa</option>
                <option value="consultant">Consultor</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Industria</label>
              <select style={inputStyle} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>
                <option value="">Seleccionar industria...</option>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Rango de colaboradores</label>
              <select style={inputStyle} value={form.employeeRange} onChange={(e) => setForm({ ...form, employeeRange: e.target.value })}>
                <option value="">Seleccionar rango...</option>
                {EMPLOYEE_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Dirección comercial</label>
              <input style={inputStyle} placeholder="Ej: Av. Providencia 1234, Santiago" value={form.commercialAddress} onChange={(e) => setForm({ ...form, commercialAddress: e.target.value })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={labelStyle}>Nombre representante legal</label>
                <input style={inputStyle} placeholder="Ej: Juan Pérez González" value={form.legalRepName} onChange={(e) => setForm({ ...form, legalRepName: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>RUT representante legal</label>
                <input style={inputStyle} placeholder="Ej: 12.345.678-9" value={form.legalRepRut} onChange={(e) => setForm({ ...form, legalRepRut: formatRutInput(e.target.value) })} maxLength={12} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Plan y período {!editingId && '*'}</label>
              <select
                style={{ ...inputStyle, borderColor: !form.planId ? 'var(--warning)' : 'var(--border)' }}
                value={form.planId ? `${form.planId}|${form.billingPeriod}` : ''}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const [planId, billingPeriod] = e.target.value.split('|');
                  setForm({ ...form, planId, billingPeriod });
                }}
              >
                <option value="">{editingId ? 'Sin cambio de plan' : 'Seleccionar plan y período...'}</option>
                {plans.flatMap((p: any) => {
                  const cur = p.currency || 'UF';
                  const fmt = (v: any, suffix: string) => v != null && Number(v) > 0 ? ` (${Number(v).toFixed(1)} ${cur}${suffix})` : '';
                  return [
                    <option key={`${p.id}|monthly`}    value={`${p.id}|monthly`}>{p.name} &mdash; Mensual{fmt(p.monthlyPrice, '/mes')}</option>,
                    <option key={`${p.id}|quarterly`}  value={`${p.id}|quarterly`}>{p.name} &mdash; Trimestral{fmt(p.quarterlyPrice, '/trim')}</option>,
                    <option key={`${p.id}|semiannual`} value={`${p.id}|semiannual`}>{p.name} &mdash; Semestral{fmt(p.semiannualPrice, '/sem')}</option>,
                    <option key={`${p.id}|annual`}     value={`${p.id}|annual`}>{p.name} &mdash; Anual{fmt(p.yearlyPrice, '/año')}</option>,
                  ];
                })}
              </select>
              {plans.length === 0 && (
                <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.3rem' }}>
                  No hay planes creados. Vaya a Suscripciones para crear planes primero.
                </p>
              )}
              {editingId && !getSubscription(editingId) && (
                <p style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.3rem' }}>
                  Esta organización no tiene suscripción. Seleccione un plan para asignarla.
                </p>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button className="btn-primary" onClick={editingId ? handleUpdate : handleCreate} disabled={saving}>
              {saving ? 'Guardando...' : editingId ? 'Actualizar' : 'Crear organización'}
            </button>
            <button className="btn-ghost" onClick={resetForm}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <Spinner />
      ) : (
        <div className="card animate-fade-up-delay-1" style={{ padding: 0, overflow: 'hidden' }}>
          {tenants.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--text-secondary)' }}>Sin organizaciónes</p>
              <p style={{ fontSize: '0.85rem' }}>Crea la primera organización para comenzar</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table style={{ minWidth: '750px' }}>
                <thead>
                  <tr>
                    <th style={{ whiteSpace: 'nowrap' }}>Nombre</th>
                    <th style={{ whiteSpace: 'nowrap' }}>RUT</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Slug</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Plan</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Max Emp.</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Estado</th>
                    <th style={{ whiteSpace: 'nowrap' }} title="Estado de salud del tenant: suscripción vigente, uso del plan, trial, vencimientos">Salud</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Creado</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{t.rut ? formatRut(t.rut) : '-'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t.slug}</td>
                      {(() => {
                        const sub = getSubscription(t.id);
                        const pName = sub?.plan?.name || t.plan || 'â€”';
                        const pCode = sub?.plan?.code || t.plan || '';
                        const maxEmp = sub?.plan?.maxEmployees || t.maxEmployees;
                        return (
                          <>
                            <td>
                              <span className={`badge ${planColor[pCode] || 'badge-accent'}`}>{pName}</span>
                              {!sub && <span style={{ fontSize: '0.7rem', color: 'var(--danger)', display: 'block', marginTop: '0.2rem' }}>Sin suscripcion</span>}
                            </td>
                            <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{maxEmp}</td>
                          </>
                        );
                      })()}
                      <td>
                        <span className={`badge ${t.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {t.isActive ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td>
                        <TenantHealthBadge
                          size="sm"
                          input={{
                            tenant: { isActive: t.isActive, createdAt: t.createdAt },
                            subscription: getSubscription(t.id) as any,
                            activeUsers: (t as any).userCount ?? null,
                          }}
                        />
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        {new Date(t.createdAt).toLocaleDateString('es-ES')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn-ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }} onClick={() => startEdit(t)}>
                            Editar
                          </button>
                          <button className="btn-ghost" style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem', color: 'var(--accent)' }}
                            onClick={() => openAdminModal(t)}>
                            Admin
                          </button>
                          {t.isActive && (
                            <ImpersonateTenantButton tenantId={t.id} tenantName={t.name} />
                          )}
                          {t.isActive && (
                            <button
                              className="btn-ghost"
                              style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem', color: 'var(--danger)' }}
                              onClick={() => handleDeactivate(t.id, t.name)}
                            >
                              Desactivar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Admin Modal */}
      {adminModalTenant && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setAdminModalTenant(null); }}>
          <div className="card" style={{ padding: '1.75rem', width: '520px', maxHeight: '85vh', overflowY: 'auto', position: 'relative' }}>
            <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1.25rem' }}>
              {adminData ? `Administrador de ${adminModalTenant.name}` : `Nuevo Administrador de ${adminModalTenant.name}`}
            </h3>

            {adminError && (
              <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '1rem' }}>
                {adminError}
              </div>
            )}
            {adminSuccess && (
              <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 'var(--radius-sm)', color: 'var(--success)', fontSize: '0.82rem', marginBottom: '1rem' }}>
                {adminSuccess}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Email *</label>
                <input style={inputStyle} value={adminForm.email}
                  onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                  placeholder="admin@empresa.com" />
              </div>
              <div>
                <label style={labelStyle}>Nombres *</label>
                <input style={inputStyle} value={adminForm.firstName}
                  onChange={(e) => setAdminForm({ ...adminForm, firstName: e.target.value })}
                  placeholder="Juan" />
              </div>
              <div>
                <label style={labelStyle}>Apellidos *</label>
                <input style={inputStyle} value={adminForm.lastName}
                  onChange={(e) => setAdminForm({ ...adminForm, lastName: e.target.value })}
                  placeholder="Perez" />
              </div>
              <div>
                <label style={labelStyle}>RUT *</label>
                <input style={inputStyle} value={adminForm.rut}
                  onChange={(e) => setAdminForm({ ...adminForm, rut: formatRutInput(e.target.value) })}
                  placeholder="12.345.678-9" maxLength={12} />
              </div>
              <div>
                <label style={labelStyle}>{adminData ? 'Nueva contrase\u00f1a' : 'Contrase\u00f1a *'}</label>
                <input style={inputStyle} type="text" value={adminForm.password}
                  onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                  placeholder={adminData ? 'Sin cambios' : '********'} />
                {adminData && <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>Dejar vac&iacute;o para no cambiar</p>}
              </div>
              <div>
                <label style={labelStyle}>Fecha de ingreso</label>
                <input style={inputStyle} type="date" value={adminForm.hireDate}
                  onChange={(e) => setAdminForm({ ...adminForm, hireDate: e.target.value })} />
              </div>

              {/* Departamento */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Departamento</label>
                {!showNewDept ? (
                  <select style={inputStyle}
                    value={adminDepts.includes(adminForm.department) ? adminForm.department : ''}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setShowNewDept(true);
                        setAdminForm({ ...adminForm, department: '' });
                      } else {
                        setAdminForm({ ...adminForm, department: e.target.value });
                      }
                    }}>
                    <option value="">-- Seleccionar departamento --</option>
                    {adminDepts.map(d => <option key={d} value={d}>{d}</option>)}
                    <option value="__new__">+ Nuevo departamento...</option>
                  </select>
                ) : (
                  <div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input style={{ ...inputStyle, flex: 1 }}
                        value={adminForm.department}
                        onChange={(e) => setAdminForm({ ...adminForm, department: e.target.value })}
                        placeholder="Nombre del nuevo departamento"
                        autoFocus />
                      <button type="button" className="btn-ghost" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                        onClick={() => { setShowNewDept(false); setAdminForm({ ...adminForm, department: adminData?.department || '' }); }}>
                        Cancelar
                      </button>
                    </div>
                    <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      Se agregar&aacute; autom&aacute;ticamente al cat&aacute;logo de departamentos de la organizaci&oacute;n.
                    </p>
                  </div>
                )}
              </div>

              {/* Cargo */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Cargo</label>
                {!showNewPos ? (
                  <select style={inputStyle}
                    value={adminPositions.some((p: any) => p.name === adminForm.position) ? adminForm.position : ''}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setShowNewPos(true);
                        setAdminForm({ ...adminForm, position: '', hierarchyLevel: '' });
                      } else {
                        const match = adminPositions.find((p: any) => p.name === e.target.value);
                        setAdminForm({ ...adminForm, position: e.target.value, hierarchyLevel: match ? String(match.level) : '' });
                      }
                    }}>
                    <option value="">-- Seleccionar cargo --</option>
                    {[...adminPositions].sort((a: any, b: any) => a.level - b.level).map((p: any) => (
                      <option key={p.name} value={p.name}>{p.name} (Nivel {p.level})</option>
                    ))}
                    <option value="__new__">+ Nuevo cargo...</option>
                  </select>
                ) : (
                  <div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input style={{ ...inputStyle, flex: 1 }}
                        value={adminForm.position}
                        onChange={(e) => setAdminForm({ ...adminForm, position: e.target.value })}
                        placeholder="Nombre del cargo nuevo"
                        autoFocus />
                      <input style={{ ...inputStyle, width: '80px', textAlign: 'center' as const }}
                        type="number" min={1} max={20}
                        value={adminForm.hierarchyLevel}
                        onChange={(e) => setAdminForm({ ...adminForm, hierarchyLevel: e.target.value })}
                        placeholder="Nivel *" />
                      <button type="button" className="btn-ghost" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                        onClick={() => { setShowNewPos(false); setAdminForm({ ...adminForm, position: adminData?.position || '', hierarchyLevel: '' }); }}>
                        Cancelar
                      </button>
                    </div>
                    <div style={{ marginTop: '0.35rem', padding: '0.5rem 0.75rem', background: 'rgba(99,102,241,0.04)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(99,102,241,0.12)', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      <div style={{ fontWeight: 600, marginBottom: '0.3rem', color: 'var(--accent)' }}>Referencia de niveles jer&aacute;rquicos</div>
                      <p style={{ margin: '0 0 0.3rem', lineHeight: 1.4 }}>
                        Nivel 1 = m&aacute;s alto (ej: Gerente General), nivel 7+ = operativo. El cargo se agregar&aacute; al cat&aacute;logo.
                      </p>
                      {adminPositions.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.15rem 1rem', marginTop: '0.25rem' }}>
                          {[...adminPositions].sort((a: any, b: any) => a.level - b.level).map((p: any) => (
                                  <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.1rem 0', borderBottom: '1px solid var(--border)' }}>
                                    <span>{p.name}</span>
                                    <span style={{ fontWeight: 600, color: 'var(--accent)' }}>Nv.{p.level}</span>
                                  </div>
                                ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button className="btn-primary" onClick={saveAdmin} disabled={adminSaving}>
                {adminSaving ? 'Guardando...' : adminData ? 'Actualizar' : 'Crear administrador'}
              </button>
              <button className="btn-ghost" onClick={() => setAdminModalTenant(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

