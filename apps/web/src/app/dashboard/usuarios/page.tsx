'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useUsers, useCreateUser, useUpdateUser, useRemoveUser } from '@/hooks/useUsers';
import { useQueryClient } from '@tanstack/react-query';
import { useInvalidatePositions } from '@/hooks/usePositions';
import { useAuthStore } from '@/store/auth.store';
import { getRoleLabel, getRoleBadge, ASSIGNABLE_ROLES } from '@/lib/roles';
import { api } from '@/lib/api';
import { useToastStore } from '@/store/toast.store';
import { useDepartments } from '@/hooks/useDepartments';
import { usePositions } from '@/hooks/usePositions';
import { formatRutInput, validateRut, normalizeRut } from '@/lib/rut';
import { TableSkeleton } from '@/components/LoadingSkeleton';

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
  rut: '',
  password: '',
  role: 'employee',
  department: '',
  position: '',
  hierarchyLevel: '' as string | number,
  managerId: '',
  hireDate: '',
  gender: '',
  birthDate: '',
  nationality: '',
  seniorityLevel: '',
  contractType: '',
  workLocation: '',
};

const GENDER_OPTIONS = [
  { value: '', label: '— Sin especificar —' },
  { value: 'masculino', label: 'Masculino' },
  { value: 'femenino', label: 'Femenino' },
  { value: 'no_binario', label: 'No binario' },
  { value: 'prefiero_no_decir', label: 'Prefiero no decir' },
];
const SENIORITY_OPTIONS = [
  { value: '', label: '— Sin especificar —' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Nivel Medio' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead / Líder' },
  { value: 'director', label: 'Director(a)' },
  { value: 'executive', label: 'Ejecutivo(a)' },
];
const CONTRACT_OPTIONS = [
  { value: '', label: '— Sin especificar —' },
  { value: 'indefinido', label: 'Indefinido' },
  { value: 'plazo_fijo', label: 'Plazo fijo' },
  { value: 'honorarios', label: 'Honorarios' },
  { value: 'practicante', label: 'Practicante' },
];
const LOCATION_OPTIONS = [
  { value: '', label: '— Sin especificar —' },
  { value: 'oficina', label: 'Oficina' },
  { value: 'remoto', label: 'Remoto' },
  { value: 'hibrido', label: 'Híbrido' },
];

export default function UsuariosPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const toast = useToastStore();
  const currentUserRole = useAuthStore((s) => s.user?.role || '');
  const isAdmin = currentUserRole === 'super_admin' || currentUserRole === 'tenant_admin';
  const { departments: configuredDepartments } = useDepartments();

  // Pagination + filters state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterPosition, setFilterPosition] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterNoManager, setFilterNoManager] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(searchTerm); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const filters = (debouncedSearch || filterDept || filterRole || filterPosition || filterStatus)
    ? { search: debouncedSearch || undefined, department: filterDept || undefined, role: filterRole || undefined, position: filterPosition || undefined, status: filterStatus || undefined }
    : undefined;

  // When filtering by no-manager, load more users to filter client-side
  const { data: paginated, isLoading } = useUsers(page, filterNoManager ? 500 : pageSize, filters);

  // Load ALL users (no filters) once for departments/positions dropdowns
  const { data: allUsersPag } = useUsers(1, 200);

  const queryClient = useQueryClient();
  const invalidatePositions = useInvalidatePositions();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const removeUser = useRemoveUser();

  const [showGuide, setShowGuide] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  // Departure modal state
  const [departureUser, setDepartureUser] = useState<{ id: string; name: string } | null>(null);
  const [departureForm, setDepartureForm] = useState({
    departureType: 'resignation',
    departureDate: new Date().toISOString().split('T')[0],
    isVoluntary: true,
    reasonCategory: '',
    reasonDetail: '',
    wouldRehire: '' as '' | 'true' | 'false',
  });
  const [departureSubmitting, setDepartureSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Bulk import state
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [csvContent, setCsvContent] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<any>(null);

  // Invite by email state
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviteRole, setInviteRole] = useState('employee');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ invited: number; skipped: string[] } | null>(null);

  // Resend invite per-user loading
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);
  const [resendToast, setResendToast] = useState('');
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

  const usersRaw = paginated?.data || [];
  const users = filterNoManager ? usersRaw.filter((u: any) => !u.managerId) : usersRaw;
  const totalRecords = filterNoManager ? users.length : (paginated?.total || 0);
  const totalPages = filterNoManager ? 1 : Math.max(1, Math.ceil((paginated?.total || 0) / pageSize));

  // Use all users for dropdown options (departments, positions, managers)
  const allUsers = allUsersPag?.data || [];
  const departments = configuredDepartments;
  const { positions: positionCatalog } = usePositions();
  const existingPositions = Array.from(new Set(allUsers.map((u: any) => u.position).filter(Boolean))).sort() as string[];

  const totalUsers = allUsersPag?.total || 0;
  const activeUsers = allUsers.filter((u: any) => u.isActive).length;
  const noManagerCount = allUsers.filter((u: any) => !u.managerId && u.role !== 'tenant_admin' && u.role !== 'super_admin').length;
  const inactiveUsers = totalUsers - activeUsers;
  const managersCount = allUsers.filter((u: any) => u.role === 'manager' || u.role === 'tenant_admin').length;

  // Helper to get manager name from id
  const getManagerName = (managerId: string | null) => {
    if (!managerId) return null;
    const mgr = allUsers.find((u: any) => u.id === managerId);
    if (!mgr) return null;
    return `${mgr.firstName || ''} ${mgr.lastName || ''}`.trim() || mgr.email;
  };

  // Users who can be managers — filter by superior hierarchy level
  const selectedLevel = form.hierarchyLevel ? Number(form.hierarchyLevel) : null;
  const managerOptions = allUsers.filter((u: any) => {
    if (!u.isActive) return false;
    if (u.role !== 'manager' && u.role !== 'tenant_admin') return false;
    // If the current user has a hierarchy level, only show managers with a superior (lower number) level
    if (selectedLevel && u.hierarchyLevel) {
      return u.hierarchyLevel < selectedLevel;
    }
    return true;
  });

  const handleCreate = async () => {
    if (!form.email || !form.firstName || !form.lastName || (!editingId && !form.password)) return;
    if (form.rut && !validateRut(form.rut)) {
      setErrorMsg('RUT inválido. Verifica el formato (ej: 12.345.678-9)');
      return;
    }
    // Validate: custom position requires hierarchy level
    if (form.position && positionCatalog.length > 0 && !positionCatalog.some(p => p.name === form.position) && !form.hierarchyLevel) {
      setErrorMsg('El nivel jerárquico es obligatorio para cargos personalizados. Indica un nivel (1=más alto).');
      return;
    }
    setErrorMsg('');

    // Check limit before creating
    if (!editingId && maxEmployees > 0 && activeUsers >= maxEmployees) {
      setErrorMsg(`Limite de usuarios alcanzado para el plan "${planName}". Maximo: ${maxEmployees}. Contacte al administrador del sistema para ampliar su plan.`);
      return;
    }

    const rutValue = form.rut ? normalizeRut(form.rut) : undefined;

    setCreating(true);
    try {
      // Build additional fields (only send non-empty values)
      const demoFields: any = {};
      if (form.hireDate) demoFields.hireDate = form.hireDate;
      if (form.gender) demoFields.gender = form.gender;
      if (form.birthDate) demoFields.birthDate = form.birthDate;
      if (form.nationality) demoFields.nationality = form.nationality;
      if (form.seniorityLevel) demoFields.seniorityLevel = form.seniorityLevel;
      if (form.contractType) demoFields.contractType = form.contractType;
      if (form.workLocation) demoFields.workLocation = form.workLocation;

      if (editingId) {
        const data: any = {
          firstName: form.firstName,
          lastName: form.lastName,
          rut: rutValue || undefined,
          role: form.role,
          department: form.department || undefined,
          position: form.position || undefined,
          hierarchyLevel: form.hierarchyLevel ? Number(form.hierarchyLevel) : undefined,
          managerId: form.managerId || null,
          ...demoFields,
        };
        if (form.password) data.password = form.password;
        await updateUser.mutateAsync({ id: editingId, data });
      } else {
        await createUser.mutateAsync({
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
          rut: rutValue || undefined,
          password: form.password,
          role: form.role,
          department: form.department || null,
          position: form.position || null,
          hierarchyLevel: form.hierarchyLevel ? Number(form.hierarchyLevel) : undefined,
          managerId: form.managerId || undefined,
          ...demoFields,
        });
      }
      setForm(emptyForm);
      setShowCreateForm(false);
      setEditingId(null);
      // Invalidate positions cache in case a custom position was added
      invalidatePositions();
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
      rut: u.rut ? formatRutInput(u.rut) : '',
      password: '',
      role: u.role || 'employee',
      department: u.department || '',
      position: u.position || '',
      hierarchyLevel: u.hierarchyLevel ?? '',
      managerId: u.managerId || '',
      hireDate: u.hireDate ? u.hireDate.slice(0, 10) : '',
      gender: u.gender || '',
      birthDate: u.birthDate ? u.birthDate.slice(0, 10) : '',
      nationality: u.nationality || '',
      seniorityLevel: u.seniorityLevel || '',
      contractType: u.contractType || '',
      workLocation: u.workLocation || '',
    });
    setShowCreateForm(true);
  };

  const handleDelete = (id: string, name: string) => {
    setDepartureUser({ id, name });
    setDepartureForm({
      departureType: 'resignation',
      departureDate: new Date().toISOString().split('T')[0],
      isVoluntary: true,
      reasonCategory: '',
      reasonDetail: '',
      wouldRehire: '',
    });
  };

  const handleDepartureSubmit = async () => {
    if (!departureUser || !token) return;
    setDepartureSubmitting(true);
    try {
      const body = {
        departureType: departureForm.departureType,
        departureDate: departureForm.departureDate,
        isVoluntary: departureForm.isVoluntary,
        reasonCategory: departureForm.reasonCategory || null,
        reasonDetail: departureForm.reasonDetail || null,
        wouldRehire: departureForm.wouldRehire === 'true' ? true : departureForm.wouldRehire === 'false' ? false : null,
      };
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com'}/users/${departureUser.id}/departure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Error desconocido' }));
        throw new Error(err.message || 'Error al registrar salida');
      }
      toast.success(`Salida de ${departureUser.name} registrada correctamente`);
      setDepartureUser(null);
      // Refresh users list (user was already deactivated by the departure endpoint)
      queryClient.invalidateQueries({ queryKey: ['users'] });
    } catch (err: any) {
      toast.error(err.message || 'Error al registrar salida');
    } finally {
      setDepartureSubmitting(false);
    }
  };

  const handleQuickDeactivate = async (id: string) => {
    try {
      await removeUser.mutateAsync(id);
    } catch (err: any) {
      toast.error(err.message || 'Error al desactivar usuario');
    }
  };

  const updateField = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleResendInvite = async (userId: string, email: string) => {
    if (!token) return;
    setResendingInvite(userId);
    try {
      await api.users.resendInvite(token, userId);
      setResendToast(`Invitación enviada a ${email}`);
      setTimeout(() => setResendToast(''), 3500);
    } catch {
      setResendToast('Error al enviar invitación');
      setTimeout(() => setResendToast(''), 3500);
    } finally {
      setResendingInvite(null);
    }
  };

  const handleInviteBulk = async () => {
    if (!token) return;
    const emails = inviteEmails.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) return;
    setInviteLoading(true);
    setInviteResult(null);
    try {
      const result = await api.users.inviteBulk(token, { emails, role: inviteRole });
      setInviteResult(result);
    } catch {
      setInviteResult({ invited: 0, skipped: emails });
    } finally {
      setInviteLoading(false);
    }
  };

  // Download Excel template with org-specific departments and positions
  const downloadTemplate = async () => {
    const XLSX = await import('xlsx/dist/xlsx.mini.min');
    const wb = XLSX.utils.book_new();
    const depts = configuredDepartments || [];
    const positions = positionCatalog || [];

    // Sheet 1: Colaboradores (main data entry)
    const usrHeaders = ['correo *', 'nombre *', 'apellido *', 'rut', 'contrasena', 'rol', 'departamento *', 'cargo *', 'nivel_jerarquico', 'fecha_ingreso (DD-MM-AAAA)', 'jefatura_directa (correo)', 'genero', 'fecha_nacimiento (DD-MM-AAAA)', 'nacionalidad', 'nivel_senioridad', 'tipo_contrato', 'modalidad_trabajo'];
    const exRow1 = ['juan.perez@empresa.cl', 'Juan', 'Pérez', '12345678-9', 'Clave123!', 'colaborador', depts[0] || 'Tecnología', positions[0]?.name || 'Analista', positions[0]?.level || 6, '15-01-2024', 'maria@empresa.cl', 'masculino', '15-03-1990', 'Chilena', 'mid', 'indefinido', 'oficina'];
    const exRow2 = ['maria.garcia@empresa.cl', 'María', 'García', '', '', 'encargado_equipo', depts[1] || 'Ventas', positions[1]?.name || 'Gerente', positions[1]?.level || 2, '01-06-2023', '', 'femenino', '22-08-1985', 'Chilena', 'senior', 'indefinido', 'hibrido'];
    const ws1 = XLSX.utils.aoa_to_sheet([usrHeaders, exRow1, exRow2]);
    ws1['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 20 }, { wch: 28 }, { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Colaboradores');

    // Sheet 2: Departamentos válidos
    const deptRows = [['DEPARTAMENTOS VÁLIDOS'], ['(Use estos valores exactos en la columna "departamento")'], [], ...depts.map(d => [d])];
    const ws2 = XLSX.utils.aoa_to_sheet(deptRows);
    ws2['!cols'] = [{ wch: 35 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Departamentos válidos');

    // Sheet 3: Cargos válidos
    const posRows = [['CARGOS VÁLIDOS'], ['(Use estos valores en la columna "cargo". Si ingresa un cargo nuevo, debe incluir el nivel jerárquico)'], [],
      ['Cargo', 'Nivel jerárquico (1=más alto)'],
      ...positions.map((p: any) => [p.name, p.level]),
      [], ['NOTA: Si ingresa un cargo que no está en esta lista, se creará automáticamente en el catálogo.'],
      ['El nivel jerárquico es obligatorio para cargos nuevos. Nivel 1 = más alto (ej: Gerente General), 7+ = operativo.'],
    ];
    const ws3 = XLSX.utils.aoa_to_sheet(posRows);
    ws3['!cols'] = [{ wch: 30 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Cargos válidos');

    // Sheet 4: Instrucciones
    const instrRows = [
      ['INSTRUCCIONES DE LA PLANTILLA DE CARGA DE USUARIOS'], [],
      ['Campo', 'Obligatorio', 'Descripción', 'Ejemplo'],
      ['correo', 'Sí', 'Correo electrónico único del usuario', 'juan@empresa.cl'],
      ['nombre', 'Sí', 'Nombres del colaborador', 'Juan'],
      ['apellido', 'Sí', 'Apellidos del colaborador', 'Pérez González'],
      ['rut', 'No', 'RUT con formato (puntos y guión)', '12.345.678-9'],
      ['contrasena', 'No', 'Si se deja vacía se asigna: EvaPro2026!', 'MiClave123!'],
      ['rol', 'No', 'Valores: colaborador, encargado_equipo, encargado_sistema, asesor_externo. Default: colaborador', 'colaborador'],
      ['departamento', 'Sí', 'Debe coincidir con un departamento de la hoja "Departamentos válidos"', depts[0] || 'Tecnología'],
      ['cargo', 'Sí', 'Cargo del catálogo o uno nuevo (si es nuevo, nivel_jerarquico es obligatorio)', positions[0]?.name || 'Analista'],
      ['nivel_jerarquico', 'Condicional', 'Obligatorio si el cargo no está en el catálogo. Nivel 1=más alto. Si el cargo existe, se toma del catálogo', String(positions[0]?.level || 6)],
      ['fecha_ingreso', 'No', 'Formato DD-MM-AAAA', '15-01-2024'],
      ['jefatura_directa', 'No', 'Correo del jefe directo (debe existir en la organización)', 'jefe@empresa.cl'],
      ['genero', 'No', 'Valores: masculino, femenino, no_binario, prefiero_no_decir', 'femenino'],
      ['fecha_nacimiento', 'No', 'Formato DD-MM-AAAA', '15-03-1990'],
      ['nacionalidad', 'No', 'Texto libre (ej: Chilena, Peruana, Colombiana)', 'Chilena'],
      ['nivel_senioridad', 'No', 'Valores: junior, mid, senior, lead, director, executive', 'senior'],
      ['tipo_contrato', 'No', 'Valores: indefinido, plazo_fijo, honorarios, practicante', 'indefinido'],
      ['modalidad_trabajo', 'No', 'Valores: oficina, remoto, hibrido', 'hibrido'],
      [], ['NOTAS:'],
      ['• Máximo 500 usuarios por archivo'],
      ['• Los campos marcados con * son obligatorios'],
      ['• Los departamentos deben coincidir con los configurados en el sistema'],
      ['• Los cargos pueden ser del catálogo o nuevos. Si es nuevo, debe incluir nivel_jerarquico (1=más alto)'],
      ['• Cargos nuevos se agregan automáticamente al catálogo de la organización'],
      ['• Los campos demográficos (género, nacimiento, nacionalidad, etc.) son opcionales pero necesarios para análisis DEI'],
      ['• El rol super_admin NO está permitido en esta carga'],
    ];
    const ws4 = XLSX.utils.aoa_to_sheet(instrRows);
    ws4['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 55 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, ws4, 'Instrucciones');

    XLSX.writeFile(wb, 'plantilla_usuarios_evapro.xlsx');
  };

  // Map Spanish CSV columns to English backend columns
  const COLUMN_MAP: Record<string, string> = {
    correo: 'email', email: 'email',
    nombre: 'first_name', first_name: 'first_name',
    apellido: 'last_name', last_name: 'last_name',
    rut: 'rut',
    contrasena: 'password', password: 'password',
    rol: 'role', role: 'role',
    departamento: 'department', department: 'department',
    cargo: 'position', position: 'position',
    nivel_jerarquico: 'hierarchy_level', hierarchy_level: 'hierarchy_level',
    fecha_ingreso: 'hire_date', hire_date: 'hire_date',
    jefatura_directa: 'manager_email', manager_email: 'manager_email',
    genero: 'gender', gender: 'gender',
    fecha_nacimiento: 'birth_date', birth_date: 'birth_date',
    nacionalidad: 'nationality', nationality: 'nationality',
    nivel_senioridad: 'seniority_level', seniority_level: 'seniority_level',
    tipo_contrato: 'contract_type', contract_type: 'contract_type',
    modalidad_trabajo: 'work_location', work_location: 'work_location',
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

    // Limit to 500 rows (check early)
    if (lines.length - 1 > 500) {
      return { valid: false, errors: [`El archivo tiene ${lines.length - 1} filas de datos. El máximo permitido es 500 usuarios por archivo.`], converted: '', previewRows: [] };
    }

    // Parse header
    const rawHeader = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"*]/g, '').replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, ' ').trim());
    const mappedHeader = rawHeader.map(h => COLUMN_MAP[h] || h);

    // Check required columns
    const requiredCols = ['email', 'first_name', 'last_name', 'department', 'position'];
    const colLabels: Record<string, string> = { email: 'correo', first_name: 'nombre', last_name: 'apellido', department: 'departamento', position: 'cargo' };
    for (const col of requiredCols) {
      if (!mappedHeader.includes(col)) {
        errors.push(`Columna requerida faltante: "${colLabels[col] || col}" (o "${col}").`);
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors, converted: '', previewRows: [] };
    }

    const emailIdx = mappedHeader.indexOf('email');
    const fnIdx = mappedHeader.indexOf('first_name');
    const lnIdx = mappedHeader.indexOf('last_name');
    const roleIdx = mappedHeader.indexOf('role');
    const deptIdx = mappedHeader.indexOf('department');
    const posIdx = mappedHeader.indexOf('position');
    const dateIdx = mappedHeader.indexOf('hire_date');
    const birthDateIdx = mappedHeader.indexOf('birth_date');

    // Prepare department + position validation (case-insensitive, accent-insensitive)
    const deptMatch = (a: string, b: string) => (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' }) === 0;
    const validDepts = configuredDepartments || [];
    const validPositions = (positionCatalog || []).map((p: any) => p.name);

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
      if (!cols[fnIdx]) errors.push(`Fila ${rowNum}: Nombres vacío.`);
      if (!cols[lnIdx]) errors.push(`Fila ${rowNum}: Apellidos vacío.`);

      // Validate department (required)
      if (deptIdx >= 0) {
        if (!cols[deptIdx]) {
          errors.push(`Fila ${rowNum}: Departamento vacío (obligatorio).`);
        } else if (!validDepts.some((d) => deptMatch(d, cols[deptIdx]))) {
          errors.push(`Fila ${rowNum}: Departamento no válido: "${cols[deptIdx]}". Vea hoja "Departamentos válidos".`);
        }
      }

      // Validate position (required) — accepts catalog or custom with hierarchy level
      const hlIdx = mappedHeader.indexOf('hierarchy_level');
      if (posIdx >= 0) {
        if (!cols[posIdx]) {
          errors.push(`Fila ${rowNum}: Cargo vacío (obligatorio).`);
        } else if (validPositions.length > 0 && !validPositions.some((p: string) => deptMatch(p, cols[posIdx]))) {
          // Custom position — require hierarchy level
          const hlVal = hlIdx >= 0 ? Number(cols[hlIdx]) : 0;
          if (!hlVal || hlVal < 1) {
            errors.push(`Fila ${rowNum}: Cargo "${cols[posIdx]}" no está en el catálogo. Ingrese nivel_jerarquico (1=más alto) para agregarlo automáticamente.`);
          }
        }
      }

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

      // Department already validated above as required field

      // Validate and convert dates if provided (DD-MM-YYYY to YYYY-MM-DD)
      const convertDate = (idx: number, label: string) => {
        if (idx >= 0 && cols[idx]) {
          const dateVal = cols[idx];
          if (dateRegex.test(dateVal)) {
            const [dd, mm, yyyy] = dateVal.split('-');
            const d = parseInt(dd), m = parseInt(mm);
            if (m < 1 || m > 12) errors.push(`Fila ${rowNum}: Mes invalido en ${label}: "${dateVal}".`);
            else if (d < 1 || d > 31) errors.push(`Fila ${rowNum}: Dia invalido en ${label}: "${dateVal}".`);
            else cols[idx] = `${yyyy}-${mm}-${dd}`;
          } else if (!isoDateRegex.test(dateVal)) {
            errors.push(`Fila ${rowNum}: Formato de fecha invalido en ${label}: "${dateVal}". Use DD-MM-AAAA.`);
          }
        }
      };
      convertDate(dateIdx, 'fecha_ingreso');
      convertDate(birthDateIdx, 'fecha_nacimiento');

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

  // Handle Excel or CSV file upload with validation
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let text = '';
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');

    if (isExcel) {
      try {
        const XLSX = await import('xlsx/dist/xlsx.mini.min');
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]]; // First sheet = Colaboradores
        if (!ws) { setCsvErrors(['No se encontró la hoja "Colaboradores" en el archivo.']); return; }
        // Convert to CSV for existing parser (backend expects CSV)
        text = XLSX.utils.sheet_to_csv(ws);
      } catch {
        setCsvErrors(['Error al leer el archivo Excel. Verifique que sea un archivo .xlsx válido.']);
        return;
      }
    } else {
      // Legacy CSV support
      text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string || '');
        reader.readAsText(file);
      });
    }

    if (!text) return;
    const result = validateAndParseCSV(text);
    setCsvErrors(result.errors);
    setCsvPreviewRows(result.previewRows);
    setCsvContent(result.valid ? result.converted : '');
    setBulkResult(null);
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
      {/* Toast notification for resend invite */}
      {resendToast && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderLeft: '3px solid var(--accent)', borderRadius: 'var(--radius-sm)',
          padding: '0.75rem 1.25rem', fontSize: '0.85rem', fontWeight: 500,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 9999,
          color: 'var(--text-primary)',
        }}>
          {resendToast}
        </div>
      )}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('usuarios.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('usuarios.subtitle')}
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-ghost"
              onClick={() => { setShowInvitePanel(!showInvitePanel); setShowBulkImport(false); setShowCreateForm(false); setInviteResult(null); setInviteEmails(''); }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              Invitar por email
            </button>
            <button
              className="btn-ghost"
              onClick={() => { setShowBulkImport(!showBulkImport); setShowCreateForm(false); setShowInvitePanel(false); setBulkResult(null); setCsvContent(''); }}
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

      {/* Guide toggle */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>Guía: Gestión de Usuarios</h3>
          <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '1.2rem', margin: '0 0 1rem' }}>
            <li><strong>¿Qué incluye?</strong> Crear, editar y gestionar los colaboradores de la organización. Cada usuario tiene: nombre, correo, RUT, cargo, departamento, jefatura directa y rol.</li>
            <li><strong>Roles del sistema:</strong> Administrador (gestión completa), Encargado de equipo (ve su equipo, aprueba objetivos), Colaborador (accede a sus evaluaciones y objetivos), Asesor externo (evaluador invitado, solo lectura).</li>
            <li><strong>Jefatura directa:</strong> Define quién es el jefe de cada usuario. Esta relación se usa para: asignar evaluadores automáticamente, filtrar datos por equipo, y definir reportes directos en evaluaciones 360°.</li>
            <li><strong>Cargo y nivel:</strong> Al seleccionar un cargo del catálogo (configurado en Mantenedores), se asigna automáticamente el nivel jerárquico de ese cargo. Al elegir &quot;Otro (personalizado)&quot;, debe ingresar el nivel jerárquico manualmente (1=más alto). El cargo nuevo se agrega automáticamente al catálogo de la organización.</li>
            <li><strong>Nivel jerárquico:</strong> Define la posición del cargo en la estructura organizacional. Nivel 1 = más alto (ej: Gerente General), nivel 7+ = operativo. Se usa para: sugerencia de pares en evaluaciones, filtrar managers disponibles, y organigrama.</li>
            <li><strong>Importación masiva:</strong> El botón &quot;Importar Excel&quot; permite cargar hasta 500 usuarios. La plantilla incluye columna &quot;nivel_jerarquico&quot;: si el cargo existe en el catálogo se toma el nivel del catálogo; si es un cargo nuevo, el nivel es obligatorio y el cargo se agrega automáticamente al catálogo.</li>
          </ul>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Solo administradores pueden crear, editar y desactivar usuarios.
          </div>
        </div>
      )}

      {/* Filters bar */}
      <div className="card animate-fade-up" style={{ padding: '1rem', marginBottom: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px' }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('common.search')}</label>
          <input
            className="input"
            type="text"
            placeholder="Nombres, apellidos o email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ fontSize: '0.85rem' }}
          />
        </div>
        <div style={{ flex: '0 1 160px' }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Departamento</label>
          <select className="input" value={filterDept} onChange={(e) => { setFilterDept(e.target.value); setPage(1); }} style={{ fontSize: '0.85rem' }}>
            <option value="">Todos</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 1 180px' }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rol</label>
          <select className="input" value={filterRole} onChange={(e) => { setFilterRole(e.target.value); setPage(1); }} style={{ fontSize: '0.85rem' }}>
            <option value="">Todos los roles</option>
            <option value="tenant_admin">Administrador</option>
            <option value="manager">Encargado de Equipo</option>
            <option value="employee">Colaborador</option>
            <option value="external">Asesor Externo</option>
          </select>
        </div>
        <div style={{ flex: '0 1 170px' }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cargo</label>
          <select className="input" value={filterPosition} onChange={(e) => { setFilterPosition(e.target.value); setPage(1); }} style={{ fontSize: '0.85rem' }}>
            <option value="">Todos los cargos</option>
            {positionCatalog.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ flex: '0 1 120px' }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Estado</label>
          <select className="input" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} style={{ fontSize: '0.85rem' }}>
            <option value="">Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={filterNoManager} onChange={(e) => { setFilterNoManager(e.target.checked); setPage(1); }} style={{ accentColor: 'var(--accent)' }} />
          Sin jefatura {noManagerCount > 0 && <span style={{ background: 'var(--danger)', color: '#fff', borderRadius: '10px', padding: '0 0.35rem', fontSize: '0.7rem', fontWeight: 700, marginLeft: '0.2rem' }}>{noManagerCount}</span>}
        </label>
        {(searchTerm || filterDept || filterRole || filterPosition || filterStatus || filterNoManager) && (
          <button
            className="btn-ghost"
            style={{ fontSize: '0.78rem', padding: '0.5rem 0.75rem' }}
            onClick={() => { setSearchTerm(''); setFilterDept(''); setFilterRole(''); setFilterPosition(''); setFilterStatus(''); setFilterNoManager(false); setPage(1); }}
          >
            Limpiar filtros
          </button>
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
              <label style={labelStyle}>Nombres *</label>
              <input
                style={inputStyle}
                placeholder="Nombres"
                value={form.firstName}
                onChange={(e) => updateField('firstName', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Apellidos *</label>
              <input
                style={inputStyle}
                placeholder="Apellidos"
                value={form.lastName}
                onChange={(e) => updateField('lastName', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>RUT</label>
              <input
                style={inputStyle}
                placeholder="Ej: 12.345.678-9"
                value={form.rut}
                onChange={(e) => updateField('rut', formatRutInput(e.target.value))}
                maxLength={12}
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
              <label style={labelStyle}>Departamento</label>
              <select
                style={inputStyle}
                value={form.department}
                onChange={(e) => updateField('department', e.target.value)}
              >
                <option value="">— Seleccionar departamento —</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Cargo</label>
              {positionCatalog.length > 0 ? (
                <>
                  <select
                    style={inputStyle}
                    value={positionCatalog.some(p => p.name === form.position) ? form.position : (form.position ? '__custom__' : '')}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__custom__') {
                        updateField('position', '');
                        updateField('hierarchyLevel', '');
                      } else {
                        const catalogItem = positionCatalog.find(p => p.name === val);
                        updateField('position', val);
                        updateField('hierarchyLevel', catalogItem?.level != null ? String(catalogItem.level) : '');
                        if (catalogItem?.level && form.managerId) {
                          const currentManager = allUsers.find((u: any) => u.id === form.managerId) as any;
                          if (currentManager?.hierarchyLevel && currentManager.hierarchyLevel >= catalogItem.level) {
                            updateField('managerId', '');
                          }
                        }
                      }
                    }}
                  >
                    <option value="">— Seleccionar cargo —</option>
                    {positionCatalog.map((p) => (
                      <option key={p.name} value={p.name}>{p.name} (Nivel {p.level})</option>
                    ))}
                    <option value="__custom__">Otro (personalizado)...</option>
                  </select>
                  {/* Custom position: name + hierarchy level */}
                  {!positionCatalog.some(p => p.name === form.position) && (
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem' }}>
                      <input style={{ ...inputStyle, flex: 1 }} placeholder="Nombre del cargo personalizado"
                        value={form.position} onChange={(e) => updateField('position', e.target.value)} />
                      <div style={{ width: '120px' }}>
                        <input style={inputStyle} type="number" min={1} max={20} placeholder="Nivel *"
                          value={form.hierarchyLevel} onChange={(e) => updateField('hierarchyLevel', e.target.value)}
                          title="Nivel jerárquico (1=más alto, 7+=operativo)" />
                      </div>
                    </div>
                  )}
                  {!positionCatalog.some(p => p.name === form.position) && (
                    <div style={{ marginTop: '0.35rem', padding: '0.5rem 0.75rem', background: 'rgba(99,102,241,0.04)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(99,102,241,0.12)', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                      <div style={{ fontWeight: 600, marginBottom: '0.3rem', color: 'var(--accent)' }}>Referencia de niveles configurados</div>
                      <p style={{ margin: '0 0 0.3rem', lineHeight: 1.4 }}>
                        Nivel 1 = más alto (ej: Gerente General), nivel 7+ = operativo. El cargo se agregará automáticamente al catálogo.
                      </p>
                      {positionCatalog.length > 0 && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.15rem 1rem', marginTop: '0.25rem' }}>
                          {[...positionCatalog].sort((a, b) => a.level - b.level).map((p) => (
                            <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.1rem 0', borderBottom: '1px solid var(--border)' }}>
                              <span>{p.name}</span>
                              <span style={{ fontWeight: 600, color: 'var(--accent)' }}>Nv.{p.level}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <input style={inputStyle} placeholder="Cargo" value={form.position}
                  onChange={(e) => updateField('position', e.target.value)} />
              )}
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
                      {m.firstName} {m.lastName}{m.hierarchyLevel ? ` (Nv.${m.hierarchyLevel})` : ''} — {m.position || getRoleLabel(m.role)}
                    </option>
                  ))}
              </select>
              {selectedLevel && managerOptions.filter((m: any) => m.id !== editingId).length === 0 && (
                <p style={{ fontSize: '0.72rem', color: 'var(--warning)', marginTop: '0.2rem' }}>No hay usuarios con nivel jerárquico superior al cargo seleccionado</p>
              )}
            </div>
          </div>
          {/* Información adicional del colaborador */}
          <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Información adicional del colaborador
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={labelStyle}>Fecha de ingreso</label>
                <input style={inputStyle} type="date" value={form.hireDate} onChange={(e) => updateField('hireDate', e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Fecha de nacimiento</label>
                <input style={inputStyle} type="date" value={form.birthDate} onChange={(e) => updateField('birthDate', e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Género</label>
                <select style={inputStyle} value={form.gender} onChange={(e) => updateField('gender', e.target.value)}>
                  {GENDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Nacionalidad</label>
                <input style={inputStyle} placeholder="Ej: Chilena" value={form.nationality} onChange={(e) => updateField('nationality', e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Tipo de contrato</label>
                <select style={inputStyle} value={form.contractType} onChange={(e) => updateField('contractType', e.target.value)}>
                  {CONTRACT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Modalidad de trabajo</label>
                <select style={inputStyle} value={form.workLocation} onChange={(e) => updateField('workLocation', e.target.value)}>
                  {LOCATION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Nivel de senioridad</label>
                <select style={inputStyle} value={form.seniorityLevel} onChange={(e) => updateField('seniorityLevel', e.target.value)}>
                  {SENIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
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

      {/* Invite by email panel */}
      {showInvitePanel && isAdmin && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>Invitar por email</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Ingresa los emails de las personas que deseas invitar. Se creará una cuenta con contraseña temporal y recibirán un correo de bienvenida.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: '1rem', marginBottom: '1rem' }}>
            <textarea
              placeholder="Un email por línea&#10;ej: juan.perez@empresa.cl&#10;maria.garcia@empresa.cl"
              value={inviteEmails}
              onChange={(e) => { setInviteEmails(e.target.value); setInviteResult(null); }}
              rows={5}
              style={{
                padding: '0.6rem 0.875rem', fontSize: '0.85rem',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                outline: 'none', resize: 'vertical', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem', textTransform: 'uppercase' }}>Rol</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
                >
                  <option value="employee">Colaborador</option>
                  <option value="manager">Encargado de equipo</option>
                  <option value="tenant_admin">Administrador</option>
                </select>
              </div>
              <button
                className="btn-primary"
                disabled={inviteLoading || !inviteEmails.trim()}
                onClick={handleInviteBulk}
                style={{ marginTop: 'auto' }}
              >
                {inviteLoading ? 'Enviando...' : 'Enviar invitaciones →'}
              </button>
            </div>
          </div>
          {inviteResult && (
            <div style={{
              padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)',
              background: inviteResult.invited > 0 ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
              border: `1px solid ${inviteResult.invited > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
              fontSize: '0.85rem',
            }}>
              <strong style={{ color: inviteResult.invited > 0 ? '#10b981' : '#f59e0b' }}>
                {inviteResult.invited} invitación{inviteResult.invited !== 1 ? 'es' : ''} enviada{inviteResult.invited !== 1 ? 's' : ''}
              </strong>
              {inviteResult.skipped.length > 0 && (
                <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                  · {inviteResult.skipped.length} ya existían o inválidos
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bulk import panel */}
      {showBulkImport && isAdmin && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>Carga masiva de usuarios</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Suba un archivo Excel (.xlsx) con los datos de los usuarios. La contraseña por defecto será <code style={{ background: 'var(--bg-surface)', padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.8rem' }}>EvaPro2026!</code> si no se especifica. Máximo 500 usuarios por archivo.
          </p>

          {/* Step 1: Download template */}
          <div style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>1. Descargar plantilla Excel</div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              La plantilla incluye los departamentos y cargos configurados en su organización. Complete los datos y vuelva a subirla.
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
                    ['correo', 'Si', 'Correo electrónico del usuario', 'juan@empresa.cl'],
                    ['nombre', 'Si', 'Nombres del usuario', 'Juan'],
                    ['apellido', 'Si', 'Apellidos del usuario', 'Perez'],
                    ['rut', 'No', 'RUT del usuario (sin puntos ni guion)', '12345678-9'],
                    ['contrasena', 'No', 'Si se deja vacía, se asigna: EvaPro2026!', 'MiClave123!'],
                    ['rol', 'No', 'Ver tabla de roles abajo. Default: colaborador', 'colaborador'],
                    ['departamento', 'Sí', 'Debe coincidir con departamentos configurados', 'Tecnología'],
                    ['cargo', 'Sí', 'Cargo del catálogo o uno nuevo. Si es nuevo, requiere nivel_jerarquico', 'Analista Senior'],
                    ['nivel_jerarquico', 'Condicional', 'Obligatorio si el cargo no está en el catálogo. 1=más alto, 7+=operativo', '6'],
                    ['fecha_ingreso', 'No', 'Formato: DD-MM-AAAA', '15-01-2024'],
                    ['jefatura_directa', 'No', 'Correo del jefe directo del usuario', 'maria@empresa.cl'],
                    ['genero', 'No', 'Valores: masculino, femenino, no_binario, prefiero_no_decir', 'femenino'],
                    ['fecha_nacimiento', 'No', 'Formato: DD-MM-AAAA', '15-03-1990'],
                    ['nacionalidad', 'No', 'Texto libre (ej: Chilena, Peruana)', 'Chilena'],
                    ['nivel_senioridad', 'No', 'Valores: junior, mid, senior, lead, director, executive', 'senior'],
                    ['tipo_contrato', 'No', 'Valores: indefinido, plazo_fijo, honorarios, practicante', 'indefinido'],
                    ['modalidad_trabajo', 'No', 'Valores: oficina, remoto, hibrido', 'hibrido'],
                  ].map(([col, req, desc, ej]) => (
                    <tr key={col}>
                      <td><code style={{ background: 'rgba(99,102,241,0.1)', padding: '0.1rem 0.3rem', borderRadius: '3px', fontWeight: 600 }}>{col}</code></td>
                      <td style={{ color: req === 'Si' || req === 'Sí' ? 'var(--danger)' : req === 'Condicional' ? 'var(--warning)' : 'var(--text-muted)', fontWeight: req === 'Si' || req === 'Sí' || req === 'Condicional' ? 600 : 400 }}>{req}</td>
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
            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.5rem' }}>2. Subir archivo Excel o CSV</div>
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.txt"
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
                  Corrija los errores en el archivo y vuelva a subirlo.
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
                        <th>Nombres</th>
                        <th>Apellidos</th>
                        <th>RUT</th>
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
          { label: 'Encargados / Admins', value: String(managersCount), color: 'var(--warning)' },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: s.color }}>{s.value}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={8} cols={5} />
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
                            {u.rut && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>RUT: {u.rut}</div>}
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
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button
                            className="btn-ghost"
                            style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
                            onClick={() => router.push(`/dashboard/usuarios/${u.id}`)}
                          >
                            Perfil
                          </button>
                          {(isAdmin || currentUserRole === 'manager') && (
                            <button
                              className="btn-ghost"
                              style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', color: 'var(--accent)' }}
                              onClick={() => router.push(`/dashboard/desempeno/${u.id}`)}
                              title="Ver historial de desempeño"
                            >
                              Desempeño
                            </button>
                          )}
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
                          {isAdmin && (
                            <button
                              className="btn-ghost"
                              style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}
                              disabled={resendingInvite === u.id}
                              onClick={() => handleResendInvite(u.id, u.email)}
                              title="Reenviar invitación por email"
                            >
                              {resendingInvite === u.id ? '...' : '✉'}
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

          {/* Pagination */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '1rem 0 0', borderTop: '1px solid var(--border)', marginTop: '0.5rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              <span>Mostrar</span>
              <select
                className="input"
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                style={{ width: '70px', padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
              <span>de {totalRecords} usuarios</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <button
                className="btn-ghost"
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                onClick={() => setPage(1)}
                disabled={page <= 1}
              >
                {'«'}
              </button>
              <button
                className="btn-ghost"
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
              >
                {'‹'}
              </button>
              <span style={{ fontSize: '0.82rem', padding: '0 0.5rem', fontWeight: 600 }}>
                {page} / {totalPages}
              </span>
              <button
                className="btn-ghost"
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
              >
                {'›'}
              </button>
              <button
                className="btn-ghost"
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
              >
                {'»'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ DEPARTURE MODAL ═══════════ */}
      {departureUser && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="card" style={{ padding: '2rem', maxWidth: '550px', width: '100%', maxHeight: '85vh', overflow: 'auto' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.25rem' }}>Registrar Salida</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Colaborador: <strong>{departureUser.name}</strong>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Departure Type */}
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Tipo de salida *</label>
                <select
                  className="input"
                  value={departureForm.departureType}
                  onChange={(e) => {
                    const type = e.target.value;
                    setDepartureForm(f => ({
                      ...f,
                      departureType: type,
                      isVoluntary: ['resignation', 'retirement', 'mutual_agreement'].includes(type),
                    }));
                  }}
                >
                  <option value="resignation">Renuncia voluntaria</option>
                  <option value="termination">Despido</option>
                  <option value="retirement">Jubilación</option>
                  <option value="contract_end">Fin de contrato</option>
                  <option value="abandonment">Abandono</option>
                  <option value="mutual_agreement">Mutuo acuerdo</option>
                </select>
              </div>

              {/* Date */}
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Fecha de salida *</label>
                <input
                  type="date"
                  className="input"
                  value={departureForm.departureDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setDepartureForm(f => ({ ...f, departureDate: e.target.value }))}
                />
              </div>

              {/* Voluntary */}
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Naturaleza</label>
                <div style={{ display: 'flex', gap: '1.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="radio" name="voluntary" checked={departureForm.isVoluntary} onChange={() => setDepartureForm(f => ({ ...f, isVoluntary: true }))} />
                    Voluntaria
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="radio" name="voluntary" checked={!departureForm.isVoluntary} onChange={() => setDepartureForm(f => ({ ...f, isVoluntary: false }))} />
                    Involuntaria
                  </label>
                </div>
              </div>

              {/* Reason Category */}
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Categoría del motivo</label>
                <select
                  className="input"
                  value={departureForm.reasonCategory}
                  onChange={(e) => setDepartureForm(f => ({ ...f, reasonCategory: e.target.value }))}
                >
                  <option value="">Sin especificar</option>
                  <option value="better_offer">Mejor oferta laboral</option>
                  <option value="work_climate">Clima laboral</option>
                  <option value="performance">Desempeño</option>
                  <option value="restructuring">Reestructuración</option>
                  <option value="personal">Motivos personales</option>
                  <option value="relocation">Reubicación</option>
                  <option value="career_growth">Crecimiento profesional</option>
                  <option value="compensation">Compensación/beneficios</option>
                  <option value="health">Salud</option>
                  <option value="other">Otro</option>
                </select>
              </div>

              {/* Reason Detail */}
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Detalle / Observaciones</label>
                <textarea
                  className="input"
                  rows={3}
                  value={departureForm.reasonDetail}
                  onChange={(e) => setDepartureForm(f => ({ ...f, reasonDetail: e.target.value }))}
                  placeholder="Información adicional sobre la salida..."
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Would Rehire */}
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>¿Recontratarías a esta persona?</label>
                <div style={{ display: 'flex', gap: '1.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="radio" name="rehire" checked={departureForm.wouldRehire === 'true'} onChange={() => setDepartureForm(f => ({ ...f, wouldRehire: 'true' }))} />
                    Sí
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="radio" name="rehire" checked={departureForm.wouldRehire === 'false'} onChange={() => setDepartureForm(f => ({ ...f, wouldRehire: 'false' }))} />
                    No
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer', color: 'var(--text-muted)' }}>
                    <input type="radio" name="rehire" checked={departureForm.wouldRehire === ''} onChange={() => setDepartureForm(f => ({ ...f, wouldRehire: '' }))} />
                    Sin respuesta
                  </label>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <button
                className="btn-ghost"
                onClick={() => setDepartureUser(null)}
                disabled={departureSubmitting}
                style={{ padding: '0.5rem 1rem' }}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={handleDepartureSubmit}
                disabled={departureSubmitting || !departureForm.departureDate || !departureForm.departureType}
                style={{ padding: '0.5rem 1.5rem' }}
              >
                {departureSubmitting ? 'Registrando...' : 'Registrar Salida'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
