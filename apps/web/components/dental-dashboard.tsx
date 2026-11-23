'use client'

import { type FormEvent, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileHeart,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Stethoscope,
  UsersRound,
  X,
} from 'lucide-react'
import { PatientClinicalChart } from '@/components/patient-clinical-chart'
import type {
  Appointment,
  AppointmentStatus,
  Branch,
  ClinicalRecord,
  DcmsLocalData,
  LocalRole,
  Patient,
  SupportRequest,
  TeamMember,
} from '@dcms/shared'
import {
  addClinicStaff,
  createClinicAppointment,
  createClinicBranch,
  createClinicClinicalRecord,
  createClinicPatient,
  createClinicSupportRequest,
  getClinicWorkspaceData,
  logout,
  setClinicAppointmentStatus,
  setClinicBranchStatus,
  setClinicPatientStatus,
  setClinicStaffStatus,
  updateClinicProfile,
} from '@/app/auth-actions'

type ModuleName =
  | 'Overview'
  | 'Appointments'
  | 'Patients'
  | 'Clinical records'
  | 'Team & access'
  | 'Branches'
  | 'Billing'
  | 'Settings'
  | 'Activity'

type ModalName = 'patient' | 'appointment' | 'clinical-record' | 'team' | 'branch' | 'billing' | 'help' | 'notifications'
type Notice = { message: string; kind: 'success' | 'error' }
type NavItem = { label: ModuleName; icon: typeof LayoutDashboard }

const navigation: { title: string; items: NavItem[] }[] = [
  {
    title: 'WORKSPACE',
    items: [
      { label: 'Overview', icon: LayoutDashboard },
      { label: 'Appointments', icon: CalendarDays },
      { label: 'Patients', icon: UsersRound },
      { label: 'Clinical records', icon: FileHeart },
    ],
  },
  {
    title: 'OPERATIONS',
    items: [
      { label: 'Team & access', icon: ShieldCheck },
      { label: 'Branches', icon: Stethoscope },
      { label: 'Billing', icon: CreditCard },
      { label: 'Settings', icon: Settings2 },
    ],
  },
]

const roles: LocalRole[] = [
  'Organization Administrator',
  'Central Clinical Supervisor',
  'Branch Supervisor',
  'Doctor',
  'Nurse',
  'Receptionist',
  'Accountant',
  'Inventory Officer',
  'Laboratory Coordinator',
]

const appointmentStatuses: AppointmentStatus[] = ['scheduled', 'checked-in', 'completed', 'cancelled']

function BrandMark() {
  return <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
}

function Sidebar({
  active,
  onNavigate,
  open,
  onClose,
  clinicName,
  branchName,
}: {
  active: ModuleName
  onNavigate: (label: ModuleName) => void
  open: boolean
  onClose: () => void
  clinicName: string
  branchName: string
}) {
  return <>
    {open && <button className="sidebar-scrim" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup"><BrandMark /><span className="brand-name">Clinic<span> Care</span></span><button className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation"><X /></button></div>
      <button className="clinic-switcher" aria-label={`View branches for ${clinicName}`} onClick={() => { onNavigate('Branches'); onClose() }}>
        <span className="clinic-avatar"><Stethoscope /></span>
        <span className="clinic-copy"><strong>{clinicName}</strong><small>Organization workspace</small></span>
        <ChevronDown className="switch-chevron" />
      </button>
      <div className="branch-pill"><span className="live-dot" /> {branchName} <span className="branch-label">BRANCH</span></div>
      <nav className="side-nav" aria-label="Main navigation">
        {navigation.map((group) => <div className="nav-group" key={group.title}>
          <p className="nav-heading">{group.title}</p>
          {group.items.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${active === label ? 'nav-item-active' : ''}`} onClick={() => { onNavigate(label); onClose() }}>
            <Icon className="nav-icon" /><span>{label}</span>
          </button>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <button className={`nav-item ${active === 'Activity' ? 'nav-item-active' : ''}`} onClick={() => onNavigate('Activity')}><Activity className="nav-icon" /><span>Activity</span></button>
        <Link className="nav-item" href="/admin"><Building2 className="nav-icon" /><span>Platform admin</span></Link>
        <form action={logout.bind(null, 'clinic')}><button className="nav-item" type="submit"><LockKeyhole className="nav-icon" /><span>Sign out</span></button></form>
        <div className="sidebar-divider" />
        <div className="provider-brand"><span className="provider-icon"><Activity /></span><span><small>Powered by</small><strong>Tibeb Health</strong></span><ShieldCheck className="provider-check" /></div>
        <div className="profile-row"><div className="profile-avatar">CA</div><div className="profile-copy"><strong>{clinicName} Admin</strong><small>Clinic administrator</small></div><MoreHorizontal className="profile-more" /></div>
      </div>
    </aside>
  </>
}

function StatCard({
  label,
  value,
  footnote,
  icon: Icon,
}: {
  label: string
  value: number
  footnote: string
  icon: typeof UsersRound
}) {
  return <article className="stat-card">
    <div className="stat-top"><span className="stat-icon"><Icon /></span></div>
    <p className="stat-label">{label}</p><div className="stat-value">{value}</div><p className="stat-footnote">{footnote}</p>
  </article>
}

function Avatar({ name }: { name: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
  return <span className="patient-avatar avatar-mint" aria-hidden="true">{initials || '?'}</span>
}

function PatientTable({
  patients,
  onStatusChange,
  onOpen,
}: {
  patients: Patient[]
  onStatusChange: (patient: Patient, status: Patient['status']) => void
  onOpen: (patient: Patient) => void
}) {
  if (patients.length === 0) {
    return <div className="workspace-empty"><UsersRound /><strong>No patients yet</strong><span>Add a patient to start keeping your clinic records here.</span></div>
  }
  return <div className="table-wrap"><table className="patient-table"><thead><tr><th>Patient</th><th>Patient number</th><th>Phone</th><th>Status</th><th>Action</th></tr></thead><tbody>
    {patients.map((patient) => <tr key={patient.id}>
      <td><div className="patient-cell"><Avatar name={patient.name} /><span><button className="patient-profile-link" onClick={() => onOpen(patient)}><strong>{patient.name}</strong></button><small>{patient.dateOfBirth || 'Date of birth not provided'}</small></span></div></td>
      <td>{patient.patientNumber}</td><td>{patient.phone || '—'}</td>
      <td><span className={`status ${patient.status === 'active' ? 'status-checked-in' : ''}`}>{patient.status}</span></td>
      <td>{patient.status === 'archived'
        ? <button className="row-action" onClick={() => onStatusChange(patient, 'active')}>Restore</button>
        : <div className="patient-row-actions">
            <button className="row-action" onClick={() => onStatusChange(patient, patient.status === 'active' ? 'inactive' : 'active')}>{patient.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>
            <button className="row-action" onClick={() => onStatusChange(patient, 'archived')}>Archive</button>
          </div>}
      </td>
    </tr>)}
  </tbody></table></div>
}

function AppointmentRows({
  appointments,
  onStatusChange,
}: {
  appointments: Appointment[]
  onStatusChange: (appointmentId: string, status: AppointmentStatus) => void
}) {
  if (appointments.length === 0) {
    return <div className="workspace-empty"><CalendarDays /><strong>No appointments for this date</strong><span>Schedule one to see it here.</span></div>
  }
  return <div className="appointment-list">
    {appointments.map((appointment) => <div className="appointment-row workspace-appointment-row" key={appointment.id}>
      <span className="appointment-time">{appointment.time}</span><Avatar name={appointment.patientName} />
      <div className="appointment-info"><strong>{appointment.patientName}</strong><span>{appointment.treatment}</span></div>
      <span className="appointment-doctor">{appointment.date}</span>
      <label className="sr-only" htmlFor={`appointment-${appointment.id}`}>Appointment status for {appointment.patientName}</label>
      <select id={`appointment-${appointment.id}`} className="status-select" value={appointment.status} onChange={(event) => onStatusChange(appointment.id, event.target.value as AppointmentStatus)}>
        {appointmentStatuses.map((status) => <option value={status} key={status}>{status.replace('-', ' ')}</option>)}
      </select>
    </div>)}
  </div>
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`)
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function initialsFor(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
}

export function DentalDashboard({
  clinicId,
  clinicName,
  branchName,
  timezone,
  plan,
}: {
  clinicId: string
  clinicName: string
  branchName: string
  timezone: string
  plan: string
}) {
  const [active, setActive] = useState<ModuleName>('Overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [toast, setToast] = useState('')
  const [dayOffset, setDayOffset] = useState(0)
  const [data, setData] = useState<DcmsLocalData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [branchId, setBranchId] = useState('')
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [modal, setModal] = useState<ModalName | null>(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [staffCredential, setStaffCredential] = useState<{ email: string; password: string } | null>(null)

  useEffect(() => {
    let active = true
    void getClinicWorkspaceData().then((result) => {
      if (!active) return
      if (!result.ok) {
        setLoadError(result.error)
        return
      }
      setData(result.data)
      setLoadError('')
      setBranchId((current) =>
        result.data.branches.some((branch) => branch.id === current && branch.status === 'active')
          ? current
          : result.data.branches.find((branch) => branch.organizationId === clinicId && branch.status === 'active')?.id ?? ''
      )
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Could not load clinic data.')
    })
    return () => { active = false }
  }, [clinicId, clinicName, branchName])

  const branches = useMemo(
    () => (data?.branches ?? []).filter((item) => item.organizationId === clinicId),
    [data, clinicId]
  )
  const activeBranches = branches.filter((branch) => branch.status === 'active')
  const selectedBranch = activeBranches.find((branch) => branch.id === branchId) ?? activeBranches[0]
  const patients = useMemo(
    () => (data?.patients ?? []).filter((patient) => patient.organizationId === clinicId),
    [data, clinicId]
  )
  const appointments = useMemo(
    () => listAppointmentsFor(data, clinicId),
    [data, clinicId]
  )
  const records = useMemo(
    () => (data?.clinicalRecords ?? []).filter((record) => record.organizationId === clinicId),
    [data, clinicId]
  )
  const teamMembers = useMemo(
    () => (data?.teamMembers ?? []).filter((member) => member.organizationId === clinicId),
    [data, clinicId]
  )
  const supportRequests = useMemo(
    () => (data?.supportRequests ?? []).filter((request) => request.organizationId === clinicId),
    [data, clinicId]
  )
  const auditEvents = useMemo(
    () => (data?.auditEvents ?? []).filter((event) => event.organizationId === clinicId),
    [data, clinicId]
  )

  const selectedDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000))
  const dayLabel = new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const appointmentsForDate = appointments
    .filter((appointment) => appointment.date === selectedDate)
    .filter((appointment) => matchesSearch(`${appointment.patientName} ${appointment.treatment}`))
    .sort((left, right) => left.time.localeCompare(right.time))
  const visiblePatients = patients
    .filter((patient) => matchesSearch(`${patient.name} ${patient.patientNumber} ${patient.phone ?? ''}`))
    .sort((left, right) => left.name.localeCompare(right.name))
  const activePatientCount = patients.filter((patient) => patient.status === 'active').length
  const activeTeamCount = teamMembers.filter((member) => member.status === 'active').length

  function matchesSearch(text: string): boolean {
    return text.toLowerCase().includes(search.trim().toLowerCase())
  }

  async function refreshData(): Promise<boolean> {
    try {
      const result = await getClinicWorkspaceData()
      if (!result.ok) {
        setLoadError(result.error)
        return false
      }
      setData(result.data)
      setLoadError('')
      return true
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not refresh clinic data.')
      return false
    }
  }

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3000)
  }

  function openModal(name: ModalName) {
    setFormError('')
    setModal(name)
  }

  function branchForRecord(): Branch {
    if (!selectedBranch) throw new Error('Add an active branch before creating clinic records.')
    return selectedBranch
  }

  async function updatePatient(patient: Patient, nextStatus: Patient['status']) {
    try {
      const result = await setClinicPatientStatus(patient.id, nextStatus)
      if (!result.ok) {
        showToast(result.error)
        return
      }
      await refreshData()
      showToast(`${patient.name} marked ${nextStatus}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update the patient.')
    }
  }

  async function changeAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
    try {
      const result = await setClinicAppointmentStatus(appointmentId, status)
      if (!result.ok) {
        showToast(result.error)
        return
      }
      await refreshData()
      showToast('Appointment status updated.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update the appointment.')
    }
  }

  async function toggleBranchStatus(branch: Branch) {
    const nextStatus = branch.status === 'active' ? 'inactive' : 'active'
    try {
      const result = await setClinicBranchStatus(branch.id, nextStatus)
      if (!result.ok) {
        showToast(result.error)
        return
      }
      if (branch.id === branchId && nextStatus === 'inactive') {
        const next = activeBranches.find((item) => item.id !== branch.id)
        setBranchId(next?.id ?? '')
      }
      await refreshData()
      showToast(`${branch.name} branch ${nextStatus}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update the branch.')
    }
  }

  async function toggleMemberStatus(member: TeamMember) {
    try {
      const result = await setClinicStaffStatus(member.id, member.status !== 'active')
      if (!result.ok) {
        showToast(result.error)
        return
      }
      await refreshData()
      showToast(`${member.name} access ${member.status === 'active' ? 'paused' : 'restored'}.`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update staff access.')
    }
  }

  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError('')
    setSaving(true)
    const form = new FormData(event.currentTarget)
    const value = (key: string) => String(form.get(key) ?? '').trim()
    try {
      if (modal === 'patient') {
        const name = value('name')
        const patientNumber = value('patientNumber') || `PT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
        const result = await createClinicPatient({
          branchId: branchForRecord().id,
          patientNumber,
          name,
          phone: value('phone'),
          dateOfBirth: value('dateOfBirth'),
          sex: value('sex'),
          email: value('email'),
          address: value('address'),
          nationalId: value('nationalId'),
          emergencyContactName: value('emergencyContactName'),
          emergencyContactPhone: value('emergencyContactPhone'),
          emergencyContactRelationship: value('emergencyContactRelationship'),
        })
        if (!result.ok) throw new Error(result.error)
        showToast('Patient added to the clinic database.')
      } else if (modal === 'appointment') {
        const startsAt = new Date(`${value('date')}T${value('time')}`)
        const result = await createClinicAppointment({
          branchId: branchForRecord().id,
          patientId: value('patientId'),
          title: value('treatment'),
          startsAt: startsAt.toISOString(),
        })
        if (!result.ok) throw new Error(result.error)
        showToast('Appointment saved to the clinic database.')
      } else if (modal === 'clinical-record') {
        const result = await createClinicClinicalRecord({
          branchId: branchForRecord().id,
          patientId: value('patientId'),
          title: value('title'),
          notes: value('notes'),
        })
        if (!result.ok) throw new Error(result.error)
        showToast('Clinical record saved to the clinic database.')
      } else if (modal === 'team') {
        const result = await addClinicStaff({
          branchId: branchForRecord().id,
          name: value('name'),
          email: value('email').toLowerCase(),
          role: value('role') as LocalRole,
        })
        if (!result.ok) throw new Error(result.error)
        setStaffCredential({ email: result.member.email, password: result.temporaryPassword })
        showToast('Staff account created. Share its one-time password securely.')
      } else if (modal === 'branch') {
        const name = value('name')
        const result = await createClinicBranch(name)
        if (!result.ok) throw new Error(result.error)
        showToast('Branch added to the organization.')
      } else if (modal === 'billing') {
        const result = await createClinicSupportRequest({
          plan: value('plan'),
          details: value('details'),
        })
        if (!result.ok) throw new Error(result.error)
        showToast('Plan request submitted to the platform.')
      }
      if (modal !== 'help' && modal !== 'notifications') {
        await refreshData()
        setModal(null)
      }
    } catch (error) {
      if (error instanceof Error) setFormError(error.message)
      else throw error
    } finally {
      setSaving(false)
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileError('')
    setProfileSaving(true)
    const form = new FormData(event.currentTarget)
    try {
      const result = await updateClinicProfile(
        String(form.get('clinicName') ?? ''),
        String(form.get('branchName') ?? '')
      )
      if (!result.ok) {
        setProfileError(result.error)
        return
      }
      showToast('Clinic settings updated.')
      window.location.reload()
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Could not update clinic settings.')
    } finally {
      setProfileSaving(false)
    }
  }

  const openNewPatient = () => openModal('patient')
  const createAction = active === 'Patients'
    ? openNewPatient
    : active === 'Appointments'
      ? () => openModal('appointment')
      : active === 'Clinical records'
        ? () => openModal('clinical-record')
        : active === 'Team & access'
          ? () => openModal('team')
          : active === 'Branches'
            ? () => openModal('branch')
            : active === 'Billing'
              ? () => openModal('billing')
              : openNewPatient
  const createLabel = active === 'Appointments'
    ? 'Schedule appointment'
    : active === 'Clinical records'
      ? 'Add record'
      : active === 'Team & access'
        ? 'Add team member'
        : active === 'Branches'
          ? 'Add branch'
          : active === 'Billing'
            ? 'Request plan change'
            : 'Add patient'

  if (!data) {
    return <main className="workspace-loading" aria-live="polite">{loadError || 'Loading your clinic workspace…'}</main>
  }
  if (!selectedBranch) {
    return <main className="workspace-loading" aria-live="polite">No active clinic branch is available. Ask your organization administrator to activate one.</main>
  }

  const recentEvents = auditEvents.slice(0, 20)
  const recentAppointments = appointments
    .filter((appointment) => appointment.date >= selectedDate && appointment.status !== 'cancelled')
    .sort((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`))
    .slice(0, 5)

  return <div className="app-shell">
    <Sidebar
      active={active}
      onNavigate={setActive}
      open={menuOpen}
      onClose={() => setMenuOpen(false)}
      clinicName={clinicName}
      branchName={selectedBranch.name}
    />
    <main className="main-panel">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu /></button><span className="breadcrumb-muted">Workspace</span><ChevronRight className="breadcrumb-chevron" /><span className="breadcrumb-current">{active}</span></div>
        <div className="topbar-actions"><label className="search-box"><Search /><input aria-label="Search patients, appointments, records" placeholder="Search clinic records..." value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label><button className="icon-button notification-button" aria-label="View clinic activity" onClick={() => setActive('Activity')}><Bell /><span className="notification-dot" /></button><span className="topbar-separator" /><button className="help-button" onClick={() => openModal('help')}>Help center <ArrowRight /></button></div>
      </header>
      <div className="dashboard-content">
        {loadError && <p className="workspace-error" role="alert">{loadError}</p>}
        {staffCredential && <section className="credential-issued" role="status">
          <div><strong>Temporary staff credentials — share securely</strong><p>Send to {staffCredential.email}. The staff member must choose a new password at first sign-in.</p><code>{staffCredential.password}</code></div>
          <button className="admin-icon-button" onClick={() => setStaffCredential(null)} aria-label="Dismiss temporary credentials"><X /></button>
        </section>}
        {active === 'Overview' && <>
          <div className="welcome-row"><div><div className="eyebrow"><span className="live-dot" /> {dayLabel.toUpperCase()}</div><h1>{clinicName}</h1><p className="welcome-subtitle">Your clinic workspace. Changes are saved to your secure clinic database.</p></div><button className="primary-button" onClick={openNewPatient}><Plus /> New patient</button></div>
          <div className="branch-notice"><div className="branch-notice-icon"><Stethoscope /></div><div><strong>{clinicName}</strong><span>{selectedBranch.name} branch <i /> Secure clinic workspace</span></div><button className="notice-link" onClick={() => setActive('Branches')}>Manage branches <ArrowRight /></button></div>
          <section className="stats-grid" aria-label="Clinic overview statistics">
            <StatCard label="Active patients" value={activePatientCount} footnote="In this clinic" icon={UsersRound} />
            <StatCard label="Appointments today" value={appointmentsForDate.length} footnote={dayLabel} icon={CalendarDays} />
            <StatCard label="Clinical records" value={records.length} footnote="Saved for this clinic" icon={ClipboardList} />
            <StatCard label="Active team members" value={activeTeamCount} footnote="Clinic accounts" icon={ShieldCheck} />
          </section>
          <div className="content-grid">
            <section className="panel appointments-panel">
              <div className="panel-header"><div><div className="panel-title-row"><h2>Appointments</h2><span className="count-chip">{appointmentsForDate.length}</span></div><p>Appointments for the selected date</p></div><button className="text-link" onClick={() => setActive('Appointments')}>Open schedule <ArrowRight /></button></div>
              <div className="schedule-date"><div className="date-label"><CalendarDays /><span>{dayLabel}</span></div><div className="date-controls"><button aria-label="Previous day" onClick={() => setDayOffset((day) => day - 1)}><ChevronLeft /></button><button aria-label="Next day" onClick={() => setDayOffset((day) => day + 1)}><ChevronRight /></button></div></div>
              <AppointmentRows appointments={appointmentsForDate} onStatusChange={changeAppointmentStatus} />
              <button className="view-schedule" onClick={() => setActive('Appointments')}>View schedule <ArrowRight /></button>
            </section>
            <section className="panel activity-panel">
              <div className="panel-header"><div><h2>Clinic activity</h2><p>Recent organization changes</p></div><button className="icon-button more-button" aria-label="Open clinic activity" onClick={() => setActive('Activity')}><MoreHorizontal /></button></div>
              <div className="activity-summary"><strong>{recentEvents.length}</strong><span>recent clinic actions</span></div>
              {recentEvents.length === 0
                ? <div className="workspace-empty workspace-empty-compact"><Activity /><strong>No activity recorded</strong><span>Actions you take in this workspace will appear here.</span></div>
                : <ul className="activity-mini-list">{recentEvents.slice(0, 4).map((event) => <li key={event.id}><span>{event.action.replaceAll('.', ' ')}</span><time>{formatDate(event.timestamp.slice(0, 10))}</time></li>)}</ul>}
              <button className="text-link" onClick={() => setActive('Activity')}>View activity <ArrowRight /></button>
            </section>
          </div>
          <section className="panel patients-panel"><div className="panel-header"><div><div className="panel-title-row"><h2>Upcoming appointments</h2><span className="count-chip count-muted">{recentAppointments.length}</span></div><p>Next scheduled appointments</p></div><button className="text-link" onClick={() => setActive('Appointments')}>Full schedule <ArrowRight /></button></div>
            {recentAppointments.length === 0
              ? <div className="workspace-empty"><CalendarDays /><strong>No upcoming appointments</strong><span>Schedule an appointment when you’re ready.</span></div>
              : <AppointmentRows appointments={recentAppointments} onStatusChange={changeAppointmentStatus} />}
          </section>
          <footer className="dashboard-footer"><span><ShieldCheck /> Clinic records are stored in the secured organization database.</span><span>© 2026 Tibeb Health <i /> <button onClick={() => setActive('Settings')}>Clinic settings</button></span></footer>
        </>}

        {active === 'Patients' && <section className="workspace-module">
          {selectedPatientId ? <PatientClinicalChart
            patientId={selectedPatientId}
            branchId={patients.find((patient) => patient.id === selectedPatientId)?.registeredBranchId ?? branchForRecord().id}
            onClose={() => setSelectedPatientId('')}
          /> : <>
          <div className="module-heading"><div><div className="eyebrow">CLINIC WORKSPACE</div><h1>Patients</h1><p>Manage patient profiles belonging to this clinic.</p></div><button className="primary-button" onClick={openNewPatient}><Plus /> Add patient</button></div>
          <section className="panel workspace-panel"><div className="panel-header"><div><div className="panel-title-row"><h2>Patient directory</h2><span className="count-chip">{visiblePatients.length}</span></div><p>Search filters by name, patient number, or phone.</p></div></div>
            <PatientTable patients={visiblePatients} onStatusChange={updatePatient} onOpen={(patient) => setSelectedPatientId(patient.id)} />
          </section>
          </>}
        </section>}

        {active === 'Appointments' && <section className="workspace-module">
          <div className="module-heading"><div><div className="eyebrow">CLINIC WORKSPACE</div><h1>Appointments</h1><p>Create appointments and update their status.</p></div><button className="primary-button" onClick={() => openModal('appointment')}><Plus /> Schedule appointment</button></div>
          <div className="schedule-date workspace-date"><div className="date-label"><CalendarDays /><span>{dayLabel}</span></div><div className="date-controls"><button aria-label="Previous day" onClick={() => setDayOffset((day) => day - 1)}><ChevronLeft /></button><button aria-label="Next day" onClick={() => setDayOffset((day) => day + 1)}><ChevronRight /></button></div></div>
          <section className="panel workspace-panel"><div className="panel-header"><div><div className="panel-title-row"><h2>Schedule</h2><span className="count-chip">{appointmentsForDate.length}</span></div></div></div><AppointmentRows appointments={appointmentsForDate} onStatusChange={changeAppointmentStatus} /></section>
        </section>}

        {active === 'Clinical records' && <section className="workspace-module">
          <div className="module-heading"><div><div className="eyebrow">CLINIC WORKSPACE</div><h1>Clinical records</h1><p>Create patient-linked clinical notes for authorized clinic staff.</p></div><button className="primary-button" onClick={() => openModal('clinical-record')}><Plus /> Add record</button></div>
          <section className="panel workspace-panel"><div className="panel-header"><div><div className="panel-title-row"><h2>Records</h2><span className="count-chip">{records.length}</span></div><p>Stored under your clinic organization.</p></div></div>
            {records.length === 0 ? <div className="workspace-empty"><FileHeart /><strong>No clinical records yet</strong><span>Add a note to start a patient record.</span></div> : <div className="workspace-record-list">{records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((record) => <article className="workspace-record" key={record.id}><div><strong>{record.title}</strong><span>{record.patientName} · {branches.find((branch) => branch.id === record.branchId)?.name ?? ''}</span><p>{record.notes}</p></div><time>{formatDate(record.createdAt.slice(0, 10))}</time></article>)}</div>}
          </section>
        </section>}

        {active === 'Team & access' && <section className="workspace-module">
          <div className="module-heading"><div><div className="eyebrow">CLINIC OPERATIONS</div><h1>Team &amp; access</h1><p>Create staff sign-in accounts with role and branch assignments.</p></div><button className="primary-button" onClick={() => openModal('team')}><Plus /> Add team member</button></div>
          <section className="panel workspace-panel"><div className="panel-header"><div><div className="panel-title-row"><h2>Team directory</h2><span className="count-chip">{teamMembers.length}</span></div><p>Temporary passwords are displayed only once.</p></div></div>
            {teamMembers.length === 0 ? <div className="workspace-empty"><UsersRound /><strong>No team members yet</strong><span>Create the first staff account for this clinic.</span></div> : <div className="workspace-list">{teamMembers.map((member) => <article className="workspace-list-row" key={member.id}><Avatar name={member.name} /><div className="workspace-list-copy"><strong>{member.name}</strong><span>{member.email} · {member.role}</span></div><span className={`status ${member.status === 'active' ? 'status-checked-in' : ''}`}>{member.status}</span><button className="row-action" onClick={() => void toggleMemberStatus(member)}>{member.status === 'active' ? 'Pause' : 'Restore'}</button></article>)}</div>}
          </section>
        </section>}

        {active === 'Branches' && <section className="workspace-module">
          <div className="module-heading"><div><div className="eyebrow">CLINIC OPERATIONS</div><h1>Branches</h1><p>Manage branches within your clinic organization.</p></div><button className="primary-button" onClick={() => openModal('branch')}><Plus /> Add branch</button></div>
          <section className="panel workspace-panel"><div className="panel-header"><div><div className="panel-title-row"><h2>Clinic branches</h2><span className="count-chip">{branches.length}</span></div><p>Branch changes are shared with your organization.</p></div></div>
            <div className="workspace-list">{branches.map((branch) => <article className="workspace-list-row" key={branch.id}><span className="workspace-list-icon"><Building2 /></span><div className="workspace-list-copy"><strong>{branch.name}</strong><span>{branch.code} · {branch.id === branchId ? 'Current branch' : 'Branch workspace'}</span></div><span className={`status ${branch.status === 'active' ? 'status-checked-in' : ''}`}>{branch.status}</span>{branch.status === 'active' && branch.id !== branchId && <button className="row-action" onClick={() => setBranchId(branch.id)}>Set current</button>}<button className="row-action" onClick={() => toggleBranchStatus(branch)}>{branch.status === 'active' ? 'Deactivate' : 'Reactivate'}</button></article>)}</div>
          </section>
        </section>}

        {active === 'Billing' && <section className="workspace-module">
          <div className="module-heading"><div><div className="eyebrow">CLINIC OPERATIONS</div><h1>Billing</h1><p>Subscription details provided by your platform administrator.</p></div><button className="primary-button" onClick={() => openModal('billing')}><Plus /> Request plan change</button></div>
          <section className="panel workspace-panel"><div className="billing-plan-card"><span className="workspace-list-icon"><CreditCard /></span><div><small>CURRENT PLAN</small><h2>{plan}</h2><p>Plan changes are reviewed by the platform administrator.</p></div></div><div className="panel-header"><div><div className="panel-title-row"><h2>Plan requests</h2><span className="count-chip">{supportRequests.length}</span></div><p>Requests are sent to the platform team.</p></div></div>
            {supportRequests.length === 0 ? <div className="workspace-empty workspace-empty-compact"><CreditCard /><strong>No plan requests</strong><span>There are no requests for this clinic.</span></div> : <div className="workspace-list">{supportRequests.map((request) => <article className="workspace-list-row" key={request.id}><span className="workspace-list-icon"><CreditCard /></span><div className="workspace-list-copy"><strong>{request.subject}</strong><span>{request.details}</span></div><span className={`status ${request.status === 'open' ? 'status-arriving' : 'status-checked-in'}`}>{request.status}</span></article>)}</div>}
          </section>
        </section>}

        {active === 'Settings' && <section className="workspace-module">
          <div className="module-heading"><div><div className="eyebrow">CLINIC OPERATIONS</div><h1>Settings</h1><p>Update your clinic workspace details.</p></div></div>
          <section className="panel workspace-panel"><form className="workspace-settings-form" onSubmit={saveProfile}>
            <label className="admin-field">Clinic name<input name="clinicName" defaultValue={clinicName} maxLength={120} required /></label>
            <label className="admin-field">Primary branch name<input name="branchName" defaultValue={branchName} maxLength={100} required /></label>
            {profileError && <p className="workspace-error" role="alert">{profileError}</p>}
            <button className="primary-button" type="submit" disabled={profileSaving}>{profileSaving ? 'Saving…' : 'Save settings'} <Check /></button>
          </form><p className="workspace-help-copy">These details update your organization profile. Other branches are managed in the Branches section.</p></section>
        </section>}

        {active === 'Activity' && <section className="workspace-module">
          <div className="module-heading"><div><div className="eyebrow">CLINIC WORKSPACE</div><h1>Activity</h1><p>Recent changes recorded for this organization.</p></div></div>
          <section className="panel workspace-panel">{recentEvents.length === 0 ? <div className="workspace-empty"><Activity /><strong>No activity recorded</strong><span>New patient, appointment, branch, and team actions will appear here.</span></div> : <div className="workspace-list">{recentEvents.map((event) => <article className="workspace-list-row workspace-activity-row" key={event.id}><span className="workspace-list-icon"><Activity /></span><div className="workspace-list-copy"><strong>{event.action.replaceAll('.', ' ')}</strong><span>{event.entityType} · {event.entityId}</span></div><time>{new Date(event.timestamp).toLocaleString()}</time></article>)}</div>}</section>
        </section>}
      </div>
    </main>
    {toast && <div className="toast-message" role="status"><Check />{toast}</div>}
    {modal && <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setModal(null) }}>
      <section className="admin-dialog clinic-workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
        <div className="admin-dialog-head"><div><span className="admin-dialog-icon"><ClipboardList /></span><h2 id="workspace-dialog-title">{modalTitle(modal)}</h2><p>{modalDescription(modal)}</p></div><button className="admin-icon-button" onClick={() => setModal(null)} aria-label="Close dialog"><X /></button></div>
        {modal === 'help' ? <div className="workspace-dialog-content"><p>Use the sidebar to switch between patients, appointments, clinical records, staff, branches, and settings.</p><p>Clinic records are stored in your organization database and restricted to authorized clinic users.</p><button className="admin-primary" onClick={() => setModal(null)}>Got it</button></div>
          : modal === 'notifications' ? <div className="workspace-dialog-content"><p>You currently have {recentEvents.length} recorded activity item{recentEvents.length === 1 ? '' : 's'}.</p><button className="admin-primary" onClick={() => { setModal(null); setActive('Activity') }}>View activity</button></div>
            : <form onSubmit={submitModal}>
              {modal === 'patient' && <>
                <label className="admin-field">Patient name<input name="name" required maxLength={120} autoFocus /></label>
                <label className="admin-field">Patient number<input name="patientNumber" placeholder="Leave blank to generate one" maxLength={32} /></label>
                <div className="admin-field-row"><label className="admin-field">Phone<input name="phone" type="tel" maxLength={40} /></label><label className="admin-field">Date of birth<input name="dateOfBirth" type="date" /></label></div>
                <div className="admin-field-row"><label className="admin-field">Gender<select name="sex" defaultValue=""><option value="">Not provided</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="not_specified">Prefer not to say</option></select></label><label className="admin-field">Email<input name="email" type="email" maxLength={254} /></label></div>
                <label className="admin-field">Address<input name="address" maxLength={500} /></label>
                <div className="admin-field-row"><label className="admin-field">Emergency contact<input name="emergencyContactName" maxLength={120} /></label><label className="admin-field">Emergency phone<input name="emergencyContactPhone" type="tel" maxLength={40} /></label></div>
                <label className="admin-field">Emergency contact relationship<input name="emergencyContactRelationship" maxLength={80} /></label>
                <label className="admin-field">National ID (optional)<input name="nationalId" maxLength={80} /></label>
              </>}
              {modal === 'appointment' && <>
                <label className="admin-field">Patient<select name="patientId" required defaultValue=""><option value="" disabled>Select a patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.patientNumber}</option>)}</select></label>
                <label className="admin-field">Appointment type<input name="treatment" required maxLength={120} placeholder="e.g. Check-up" /></label>
                <div className="admin-field-row"><label className="admin-field">Date<input name="date" type="date" defaultValue={selectedDate} required /></label><label className="admin-field">Time<input name="time" type="time" required /></label></div>
                {patients.length === 0 && <p className="workspace-help-copy">Add a patient before scheduling an appointment.</p>}
              </>}
              {modal === 'clinical-record' && <>
                <label className="admin-field">Patient<select name="patientId" required defaultValue=""><option value="" disabled>Select a patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.patientNumber}</option>)}</select></label>
                <label className="admin-field">Record title<input name="title" required maxLength={120} /></label>
                <label className="admin-field">Notes<textarea name="notes" rows={4} required maxLength={3000} /></label>
                {patients.length === 0 && <p className="workspace-help-copy">Add a patient before creating a clinical record.</p>}
              </>}
              {modal === 'team' && <>
                <label className="admin-field">Team member name<input name="name" required maxLength={120} /></label>
                <label className="admin-field">Email<input name="email" type="email" required maxLength={254} /></label>
                <label className="admin-field">Role<select name="role" defaultValue="Receptionist">{roles.filter((role) => role !== 'Organization Administrator' && role !== 'Platform Super Administrator').map((role) => <option key={role}>{role}</option>)}</select></label>
                <p className="workspace-help-copy">A temporary password will be generated. The staff member must replace it at first sign-in.</p>
              </>}
              {modal === 'branch' && <label className="admin-field">Branch name<input name="name" required maxLength={100} autoFocus /></label>}
              {modal === 'billing' && <>
                <label className="admin-field">Requested plan<select name="plan" defaultValue="Growth"><option>Starter</option><option>Growth</option><option>Enterprise</option></select></label>
                <label className="admin-field">Details<textarea name="details" rows={3} maxLength={1000} placeholder="Optional details for your request" /></label>
                <p className="workspace-help-copy">This request is saved for review by the platform administrator.</p>
              </>}
              {formError && <p className="workspace-error" role="alert">{formError}</p>}
              <div className="admin-dialog-footer"><button type="button" className="admin-secondary" onClick={() => setModal(null)} disabled={saving}>Cancel</button><button type="submit" className="admin-primary" disabled={saving}>{saving ? 'Saving…' : modalSubmitLabel(modal)} <Check /></button></div>
            </form>}
      </section>
    </div>}
  </div>
}

function listAppointmentsFor(data: DcmsLocalData | null, organizationId: string): Appointment[] {
  return (data?.appointments ?? []).filter((appointment) => appointment.organizationId === organizationId)
}

function modalTitle(modal: ModalName): string {
  switch (modal) {
    case 'patient': return 'Add patient'
    case 'appointment': return 'Schedule appointment'
    case 'clinical-record': return 'Add clinical record'
    case 'team': return 'Add team member'
    case 'branch': return 'Add branch'
    case 'billing': return 'Request plan change'
    case 'help': return 'Clinic workspace help'
    case 'notifications': return 'Clinic activity'
  }
}

function modalDescription(modal: ModalName): string {
  switch (modal) {
    case 'patient': return 'Create a patient profile inside this clinic organization.'
    case 'appointment': return 'Add an appointment to the clinic schedule.'
    case 'clinical-record': return 'Save a patient-linked clinical note.'
    case 'team': return 'Create a staff account and assign a clinic role.'
    case 'branch': return 'Add another branch to this clinic organization.'
    case 'billing': return 'Submit a plan request to the platform administrator.'
    case 'help': return 'Learn how to use your clinic workspace.'
    case 'notifications': return 'Review recent clinic actions.'
  }
}

function modalSubmitLabel(modal: ModalName): string {
  switch (modal) {
    case 'patient': return 'Save patient'
    case 'appointment': return 'Save appointment'
    case 'clinical-record': return 'Save record'
    case 'team': return 'Save team member'
    case 'branch': return 'Save branch'
    case 'billing': return 'Save request'
    case 'help': return 'Close'
    case 'notifications': return 'View activity'
  }
}
