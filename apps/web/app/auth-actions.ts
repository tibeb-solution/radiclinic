'use server'

import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { newTemporaryPassword } from '@/lib/password'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { AuthenticatedAccount, AuthRealm } from '@/lib/local-auth-store'
import type { ClinicPlan, ManagedClinic } from '@/lib/clinic-types'
import type {
  Appointment,
  AppointmentStatus,
  Branch,
  ClinicalRecord,
  DcmsLocalData,
  LocalRole,
  Patient,
  TeamMember,
} from '@dcms/shared'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const plans: ClinicPlan[] = ['Starter', 'Growth', 'Enterprise']

export type ActionResult = { ok: true } | { ok: false; error: string }

type WorkspaceResult = { ok: true; data: DcmsLocalData } | { ok: false; error: string }
type MutationResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string }

type ProfileRow = {
  email: string
  full_name: string | null
  is_platform_admin: boolean
  must_change_password: boolean
}
type ClinicAccount = AuthenticatedAccount & { clinicId: string }

function validEmail(value: string): boolean {
  return emailPattern.test(value.trim())
}

function emptyWorkspace(): DcmsLocalData {
  return {
    version: 2,
    organizations: [],
    branches: [],
    patients: [],
    appointments: [],
    clinicalRecords: [],
    teamMembers: [],
    supportRequests: [],
    auditEvents: [],
  }
}

function roleLabel(role: string): LocalRole {
  const labels: Record<string, LocalRole> = {
    organization_administrator: 'Organization Administrator',
    central_clinical_supervisor: 'Central Clinical Supervisor',
    branch_supervisor: 'Branch Supervisor',
    doctor: 'Doctor',
    nurse: 'Nurse',
    receptionist: 'Receptionist',
    accountant: 'Accountant',
    inventory_officer: 'Inventory Officer',
    laboratory_coordinator: 'Laboratory Coordinator',
  }
  return labels[role] ?? 'Receptionist'
}

function roleCode(role: LocalRole): string {
  const codes: Record<LocalRole, string> = {
    'Organization Administrator': 'organization_administrator',
    'Central Clinical Supervisor': 'central_clinical_supervisor',
    'Branch Supervisor': 'branch_supervisor',
    Doctor: 'doctor',
    Nurse: 'nurse',
    Receptionist: 'receptionist',
    Accountant: 'accountant',
    'Inventory Officer': 'inventory_officer',
    'Laboratory Coordinator': 'laboratory_coordinator',
    'Platform Super Administrator': 'organization_administrator',
  }
  return codes[role]
}

async function clinicAccount(adminOnly = false): Promise<ClinicAccount | null> {
  const account = await authenticatedAccount('clinic')
  if (!account?.clinicId || account.mustChangePassword) {
    return null
  }
  if (adminOnly && account.role !== 'organization_administrator') {
    return null
  }
  return { ...account, clinicId: account.clinicId }
}

async function writeAuditEvent(
  account: AuthenticatedAccount,
  action: string,
  entityType: string,
  entityId: string,
  branchId?: string,
  afterData?: unknown
): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('audit_events').insert({
    organization_id: account.clinicId,
    branch_id: branchId ?? null,
    actor_id: account.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    after_data: afterData ?? null,
  })
  return error ? `The change was saved, but its audit event could not be recorded: ${error.message}` : null
}

async function writePlatformAuditEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  actorId: string,
  organizationId: string,
  action: string,
  entityType: string,
  entityId: string,
  afterData?: unknown
): Promise<string | null> {
  const { error } = await admin.from('audit_events').insert({
    organization_id: organizationId,
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    after_data: afterData ?? null,
  })
  return error?.message ?? null
}

export async function getClinicWorkspaceData(): Promise<WorkspaceResult> {
  const account = await authenticatedAccount('clinic')
  if (!account?.clinicId || account.mustChangePassword) {
    return { ok: false, error: 'Complete account setup before opening the clinic workspace.' }
  }
  const supabase = await createSupabaseServerClient()
  const organizationId = account.clinicId
  const [
    organizationResult,
    branchesResult,
    patientsResult,
    appointmentsResult,
    recordsResult,
    membersResult,
    auditResult,
    supportResult,
  ] = await Promise.all([
    supabase.from('organizations').select('id, name, status, timezone, country, logo_url, subscription_status, created_at').eq('id', organizationId).single(),
    supabase.from('branches').select('id, organization_id, name, code, status').eq('organization_id', organizationId).order('created_at'),
    supabase.from('patients').select('id, organization_id, registered_branch_id, patient_number, full_name, date_of_birth, phone, status, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }),
    supabase.from('appointments').select('id, organization_id, branch_id, title, starts_at, status, patients(full_name)').eq('organization_id', organizationId).order('starts_at'),
    supabase.from('clinical_records').select('id, organization_id, branch_id, title, diagnosis, created_at, patients(full_name)').eq('organization_id', organizationId).order('created_at', { ascending: false }),
    supabase.from('organization_members').select('user_id, role, active').eq('organization_id', organizationId),
    supabase.from('audit_events').select('id, organization_id, branch_id, actor_id, action, entity_type, entity_id, before_data, after_data, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(100),
    supabase.from('support_requests').select('id, organization_id, subject, details, status, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false }),
  ])
  for (const [label, result] of [
    ['organization', organizationResult],
    ['branches', branchesResult],
    ['patients', patientsResult],
    ['appointments', appointmentsResult],
    ['clinical records', recordsResult],
    ['team members', membersResult],
    ['audit events', auditResult],
    ['plan requests', supportResult],
  ] as const) {
    if (result.error) return { ok: false, error: `Could not load ${label}: ${result.error.message}` }
  }

  const memberRows = membersResult.data ?? []
  const branchRows = branchesResult.data ?? []
  const patientRows = patientsResult.data ?? []
  const appointmentRows = appointmentsResult.data ?? []
  const recordRows = recordsResult.data ?? []
  const auditRows = auditResult.data ?? []
  const supportRows = supportResult.data ?? []
  const organization = organizationResult.data
  if (!organization) return { ok: false, error: 'Clinic organization not found.' }
  const memberIds = [...new Set(memberRows.map((item) => item.user_id))]
  const [profilesResult, branchMembershipsResult] = memberIds.length
    ? await Promise.all([
        supabase.from('profiles').select('id, email, full_name').in('id', memberIds),
        supabase.from('branch_memberships').select('branch_id, user_id, active').in('user_id', memberIds),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ]
  if (profilesResult.error) return { ok: false, error: `Could not load team profiles: ${profilesResult.error.message}` }
  if (branchMembershipsResult.error) return { ok: false, error: `Could not load branch assignments: ${branchMembershipsResult.error.message}` }

  const data = emptyWorkspace()
  data.organizations.push({
    id: organization.id,
    code: organization.id.slice(0, 10).toUpperCase(),
    name: organization.name,
    status: organization.status,
    timezone: organization.timezone,
    country: organization.country ?? '',
    logoUrl: organization.logo_url ?? undefined,
    subscriptionStatus: organization.subscription_status,
    createdAt: organization.created_at,
  })
  data.branches = branchRows.map((branch) => ({
    id: branch.id,
    organizationId: branch.organization_id,
    name: branch.name,
    code: branch.code,
    status: branch.status,
  }))
  data.patients = patientRows.map((patient) => ({
    id: patient.id,
    organizationId: patient.organization_id,
    registeredBranchId: patient.registered_branch_id,
    patientNumber: patient.patient_number,
    name: patient.full_name,
    dateOfBirth: patient.date_of_birth ?? undefined,
    phone: patient.phone ?? undefined,
    status: patient.status,
    createdAt: patient.created_at,
  }))
  const clinicTimezone = organization.timezone || 'UTC'
  data.appointments = appointmentRows.map((appointment) => {
    const patient = appointment.patients as unknown as { full_name: string } | null
    const startsAt = new Date(appointment.starts_at)
    const dateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: clinicTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(startsAt)
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: clinicTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(startsAt)
    return {
      id: appointment.id,
      organizationId: appointment.organization_id,
      branchId: appointment.branch_id,
      patientName: patient?.full_name ?? 'Patient',
      treatment: appointment.title,
      date: dateParts,
      time: timeParts,
      status: appointment.status.replace('_', '-') as AppointmentStatus,
      createdAt: appointment.starts_at,
    } satisfies Appointment
  })
  data.clinicalRecords = recordRows.map((record) => {
    const patient = record.patients as unknown as { full_name: string } | null
    return {
      id: record.id,
      organizationId: record.organization_id,
      branchId: record.branch_id,
      patientName: patient?.full_name ?? 'Patient',
      title: record.title,
      notes: record.diagnosis ?? '',
      createdAt: record.created_at,
    } satisfies ClinicalRecord
  })
  data.teamMembers = memberRows.flatMap((member) => {
    const profile = profilesResult.data.find((item) => item.id === member.user_id)
    if (!profile) return []
    const branchAssignment = branchMembershipsResult.data.find(
      (item) => item.user_id === member.user_id && item.active
    )
    return [{
      id: member.user_id,
      organizationId,
      branchId: branchAssignment?.branch_id ?? '',
      name: profile.full_name ?? profile.email,
      email: profile.email,
      role: roleLabel(member.role),
      status: member.active ? 'active' : 'inactive',
      createdAt: '',
    } satisfies TeamMember]
  })
  data.auditEvents = auditRows.map((event) => ({
    id: event.id,
    organizationId: event.organization_id ?? undefined,
    branchId: event.branch_id ?? undefined,
    actor: profilesResult.data.find((profile) => profile.id === event.actor_id)?.full_name ?? 'Clinic user',
    action: event.action,
    entityType: event.entity_type,
    entityId: event.entity_id ?? '',
    before: event.before_data ?? undefined,
    after: event.after_data ?? undefined,
    timestamp: event.created_at,
  }))
  data.supportRequests = supportRows.map((request) => ({
    id: request.id,
    organizationId: request.organization_id,
    subject: request.subject,
    details: request.details,
    status: request.status,
    createdAt: request.created_at,
  }))
  return { ok: true, data }
}

export async function createClinicSupportRequest(input: {
  plan: string
  details: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Complete account setup and sign in to an active clinic first.' }
  if (!plans.includes(input.plan as ClinicPlan)) return { ok: false, error: 'Choose a valid subscription plan.' }
  const details = input.details.trim()
  if (details.length > 1000) return { ok: false, error: 'Keep plan request details under 1,000 characters.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('support_requests').insert({
    organization_id: account.clinicId,
    subject: `Plan request: ${input.plan}`,
    details,
    created_by: account.id,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  const auditError = await writeAuditEvent(account, 'subscription.change_requested', 'support_request', data.id)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function createClinicBranch(name: string): Promise<MutationResult<Branch>> {
  const account = await clinicAccount(true)
  if (!account) return { ok: false, error: 'Sign in as an active clinic administrator to manage branches.' }
  const normalizedName = name.trim()
  if (!normalizedName || normalizedName.length > 100) return { ok: false, error: 'Enter a branch name within 100 characters.' }
  const supabase = await createSupabaseServerClient()
  const code = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10).toUpperCase() || 'BRANCH'
  const { data, error } = await supabase.from('branches')
    .insert({ organization_id: account.clinicId, name: normalizedName, code })
    .select('id, organization_id, name, code, status')
    .single()
  if (error) return { ok: false, error: error.message }
  const auditError = await writeAuditEvent(account, 'branch.create', 'branch', data.id, data.id, data)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return {
    ok: true,
    value: { id: data.id, organizationId: data.organization_id, name: data.name, code: data.code, status: data.status },
  }
}

export async function setClinicBranchStatus(branchId: string, status: 'active' | 'inactive'): Promise<ActionResult> {
  const account = await clinicAccount(true)
  if (!account) return { ok: false, error: 'Sign in as an active clinic administrator to manage branches.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('branches')
    .update({ status })
    .eq('organization_id', account.clinicId)
    .eq('id', branchId)
    .select('id, name')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Branch not found or not accessible.' }
  const auditError = await writeAuditEvent(account, `branch.${status}`, 'branch', data.id, data.id, data)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function createClinicPatient(input: {
  branchId: string
  patientNumber: string
  name: string
  phone: string
  dateOfBirth: string
}): Promise<MutationResult<Patient>> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Complete account setup and sign in to an active clinic first.' }
  const patientNumber = input.patientNumber.trim()
  const name = input.name.trim()
  if (!input.branchId || !name || name.length > 120 || !patientNumber || patientNumber.length > 32) {
    return { ok: false, error: 'Enter a patient name, patient number, and active branch.' }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('patients').insert({
    organization_id: account.clinicId,
    registered_branch_id: input.branchId,
    patient_number: patientNumber,
    full_name: name,
    phone: input.phone.trim() || null,
    date_of_birth: input.dateOfBirth || null,
    created_by: account.id,
  }).select('id, organization_id, registered_branch_id, patient_number, full_name, date_of_birth, phone, status, created_at').single()
  if (error) return { ok: false, error: error.message.includes('patients_organization_id_patient_number_key') ? 'That patient number is already in use.' : error.message }
  const auditError = await writeAuditEvent(account, 'patient.create', 'patient', data.id, input.branchId)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return {
    ok: true,
    value: {
      id: data.id, organizationId: data.organization_id, registeredBranchId: data.registered_branch_id,
      patientNumber: data.patient_number, name: data.full_name, dateOfBirth: data.date_of_birth ?? undefined,
      phone: data.phone ?? undefined, status: data.status, createdAt: data.created_at,
    },
  }
}

export async function setClinicPatientStatus(patientId: string, status: 'active' | 'inactive'): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Complete account setup and sign in to an active clinic first.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('patients')
    .update({ status })
    .eq('organization_id', account.clinicId)
    .eq('id', patientId)
    .select('id, registered_branch_id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Patient not found or not accessible.' }
  const auditError = await writeAuditEvent(account, `patient.${status}`, 'patient', data.id, data.registered_branch_id)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function createClinicAppointment(input: {
  branchId: string
  patientId: string
  title: string
  startsAt: string
}): Promise<MutationResult<Appointment>> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Complete account setup and sign in to an active clinic first.' }
  const title = input.title.trim()
  const startsAt = new Date(input.startsAt)
  if (!input.branchId || !input.patientId || !title || title.length > 120 || Number.isNaN(startsAt.getTime())) {
    return { ok: false, error: 'Choose a patient and enter an appointment type, branch, date, and time.' }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('appointments').insert({
    organization_id: account.clinicId,
    branch_id: input.branchId,
    patient_id: input.patientId,
    title,
    starts_at: startsAt.toISOString(),
    created_by: account.id,
  }).select('id, organization_id, branch_id, title, starts_at, status').single()
  if (error) return { ok: false, error: error.message }
  const patient = (await supabase.from('patients').select('full_name').eq('id', input.patientId).single()).data
  const auditError = await writeAuditEvent(account, 'appointment.create', 'appointment', data.id, input.branchId)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return {
    ok: true,
    value: {
      id: data.id, organizationId: data.organization_id, branchId: data.branch_id,
      patientName: patient?.full_name ?? 'Patient', treatment: data.title,
      date: startsAt.toISOString().slice(0, 10), time: startsAt.toISOString().slice(11, 16),
      status: data.status.replace('_', '-') as AppointmentStatus, createdAt: data.starts_at,
    },
  }
}

export async function setClinicAppointmentStatus(appointmentId: string, status: AppointmentStatus): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Complete account setup and sign in to an active clinic first.' }
  const supabase = await createSupabaseServerClient()
  const dbStatus = status.replace('-', '_')
  const { data, error } = await supabase.from('appointments')
    .update({ status: dbStatus })
    .eq('organization_id', account.clinicId)
    .eq('id', appointmentId)
    .select('id, branch_id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Appointment not found or not accessible.' }
  const auditError = await writeAuditEvent(account, `appointment.${status}`, 'appointment', data.id, data.branch_id)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function createClinicClinicalRecord(input: {
  branchId: string
  patientId: string
  title: string
  notes: string
}): Promise<MutationResult<ClinicalRecord>> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Complete account setup and sign in to an active clinic first.' }
  const title = input.title.trim()
  const notes = input.notes.trim()
  if (!input.branchId || !input.patientId || !title || title.length > 120 || !notes || notes.length > 3000) {
    return { ok: false, error: 'Choose a patient and enter a record title and notes.' }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('clinical_records').insert({
    organization_id: account.clinicId,
    branch_id: input.branchId,
    patient_id: input.patientId,
    title,
    diagnosis: notes,
    submitted_by: account.id,
  }).select('id, organization_id, branch_id, title, diagnosis, created_at').single()
  if (error) return { ok: false, error: error.message }
  const patient = (await supabase.from('patients').select('full_name').eq('id', input.patientId).single()).data
  const auditError = await writeAuditEvent(account, 'clinical_record.create', 'clinical_record', data.id, input.branchId)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return {
    ok: true,
    value: {
      id: data.id, organizationId: data.organization_id, branchId: data.branch_id,
      patientName: patient?.full_name ?? 'Patient', title: data.title, notes: data.diagnosis ?? '',
      createdAt: data.created_at,
    },
  }
}

export async function addClinicStaff(input: {
  branchId: string
  name: string
  email: string
  role: LocalRole
}): Promise<{ ok: true; member: TeamMember; temporaryPassword: string } | { ok: false; error: string }> {
  const account = await clinicAccount(true)
  if (!account) return { ok: false, error: 'Sign in as an active clinic administrator to manage staff.' }
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (!name || name.length > 120 || !validEmail(email) || !input.branchId) {
    return { ok: false, error: 'Enter a staff name, valid email, and branch.' }
  }
  if (input.role === 'Platform Super Administrator' || input.role === 'Organization Administrator') {
    return { ok: false, error: 'Use the platform administrator flow to create administrator accounts.' }
  }
  const admin = createSupabaseAdminClient()
  const { data: branch, error: branchLookupError } = await admin.from('branches')
    .select('id')
    .eq('id', input.branchId)
    .eq('organization_id', account.clinicId)
    .eq('status', 'active')
    .maybeSingle()
  if (branchLookupError) return { ok: false, error: branchLookupError.message }
  if (!branch) return { ok: false, error: 'Choose an active branch in this clinic.' }

  const temporaryPassword = newTemporaryPassword()
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: name },
  })
  if (userError || !userData.user) return { ok: false, error: userError?.message ?? 'Could not create the staff account.' }

  const role = roleCode(input.role)
  const { error: profileError } = await admin.from('profiles')
    .update({ full_name: name, must_change_password: true })
    .eq('id', userData.user.id)
  const { error: membershipError } = profileError
    ? { error: null }
    : await admin.from('organization_members').insert({
        organization_id: account.clinicId,
        user_id: userData.user.id,
        role,
      })
  const { error: branchError } = profileError || membershipError
    ? { error: null }
    : await admin.from('branch_memberships').insert({
        branch_id: input.branchId,
        user_id: userData.user.id,
        role,
      })
  if (profileError || membershipError || branchError) {
    const cleanupResults = await Promise.all([
      admin.from('organization_members').delete().eq('user_id', userData.user.id),
      admin.auth.admin.deleteUser(userData.user.id),
    ])
    const cause = profileError?.message ?? membershipError?.message ?? branchError?.message ?? 'Assignment failed.'
    const cleanupError = cleanupResults.find((result) => result.error)?.error
    return {
      ok: false,
      error: cleanupError
        ? `Staff setup failed (${cause}); cleanup also failed (${cleanupError.message}). Contact support.`
        : `Staff setup failed and was rolled back: ${cause}`,
    }
  }
  const auditError = await writeAuditEvent(account, 'team_member.create', 'profile', userData.user.id, input.branchId)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return {
    ok: true,
    temporaryPassword,
    member: {
      id: userData.user.id,
      organizationId: account.clinicId!,
      branchId: input.branchId,
      name,
      email,
      role: input.role,
      status: 'active',
      createdAt: new Date().toISOString(),
    },
  }
}

export async function setClinicStaffStatus(userId: string, active: boolean): Promise<ActionResult> {
  const account = await clinicAccount(true)
  if (!account) return { ok: false, error: 'Sign in as an active clinic administrator to manage staff.' }
  if (!userId || userId === account.id) return { ok: false, error: 'Choose a different staff member.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('organization_members')
    .update({ active })
    .eq('organization_id', account.clinicId)
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Staff member not found.' }
  if (!active) {
    const admin = createSupabaseAdminClient()
    const { error: signOutError } = await admin.auth.admin.signOut(userId, 'global')
    if (signOutError) return { ok: false, error: `Staff access was paused, but existing sessions could not be revoked: ${signOutError.message}` }
  }
  const auditError = await writeAuditEvent(account, active ? 'team_member.activate' : 'team_member.deactivate', 'profile', userId)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

async function authenticatedAccount(realm: AuthRealm): Promise<AuthenticatedAccount | null> {
  const supabase = await createSupabaseServerClient()
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError && userError.name !== 'AuthSessionMissingError') {
    throw new Error(`Could not verify the current Supabase session: ${userError.message}`)
  }
  if (!userData.user) return null

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('email, full_name, is_platform_admin, must_change_password')
    .eq('id', userData.user.id)
    .single()
  if (profileError) throw new Error(`Could not load the signed-in profile: ${profileError.message}`)

  const accountProfile = profile as ProfileRow
  if (realm === 'platform') {
    if (!accountProfile.is_platform_admin) return null
    return {
      id: userData.user.id,
      realm,
      email: accountProfile.email,
      displayName: accountProfile.full_name || 'Platform administrator',
      mustChangePassword: accountProfile.must_change_password,
    }
  }

  if (accountProfile.is_platform_admin) return null
  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('organization_id, role, organizations!inner(id, name, status, subscription_plan, timezone)')
    .eq('user_id', userData.user.id)
    .eq('active', true)
    .eq('organizations.status', 'active')
    .limit(1)
    .maybeSingle()
  if (membershipError) throw new Error(`Could not load clinic membership: ${membershipError.message}`)
  if (!membership) return null

  const organization = membership.organizations as unknown as {
    id: string
    name: string
    status: string
    subscription_plan: ClinicPlan
    timezone: string
  }
  const { data: branch, error: branchError } = await supabase
    .from('branches')
    .select('name')
    .eq('organization_id', organization.id)
    .eq('status', 'active')
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (branchError) throw new Error(`Could not load the clinic's primary branch: ${branchError.message}`)

  return {
    id: userData.user.id,
    realm,
    email: accountProfile.email,
    displayName: accountProfile.full_name || organization.name,
    clinicId: organization.id,
    clinicName: organization.name,
    branchName: branch?.name ?? 'Main branch',
    timezone: organization.timezone,
    plan: organization.subscription_plan,
    role: membership.role,
    mustChangePassword: accountProfile.must_change_password,
  }
}

async function requirePlatformAdmin(): Promise<AuthenticatedAccount> {
  const account = await authenticatedAccount('platform')
  if (!account) throw new Error('You must sign in as a platform administrator to do that.')
  return account
}

async function verifyPassword(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Supabase authentication is not configured.')
  const verifier = createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  })
  const { error } = await verifier.auth.signInWithPassword({ email, password })
  return !error
}

export async function getClinicSession(): Promise<AuthenticatedAccount | null> {
  return authenticatedAccount('clinic')
}

export async function getPlatformSession(): Promise<AuthenticatedAccount | null> {
  return authenticatedAccount('platform')
}

export async function listManagedClinics(): Promise<ManagedClinic[]> {
  await requirePlatformAdmin()
  const supabase = await createSupabaseServerClient()
  const { data: organizations, error: organizationsError } = await supabase
    .from('organizations')
    .select('id, name, status, subscription_plan, created_at')
    .order('created_at', { ascending: false })
  if (organizationsError) throw new Error(`Could not load clinics: ${organizationsError.message}`)
  if (!organizations.length) return []

  const ids = organizations.map((organization) => organization.id)
  const [membersResult, branchesResult] = await Promise.all([
    supabase
      .from('organization_members')
      .select('organization_id, user_id')
      .eq('role', 'organization_administrator')
      .in('organization_id', ids),
    supabase
      .from('branches')
      .select('organization_id, name')
      .in('organization_id', ids)
      .order('created_at'),
  ])
  if (membersResult.error) throw new Error(`Could not load clinic administrators: ${membersResult.error.message}`)
  if (branchesResult.error) throw new Error(`Could not load clinic branches: ${branchesResult.error.message}`)

  const userIds = [...new Set(membersResult.data.map((member) => member.user_id))]
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabase.from('profiles').select('id, email').in('id', userIds)
    : { data: [], error: null }
  if (profilesError) throw new Error(`Could not load clinic administrator emails: ${profilesError.message}`)

  return organizations.map((organization) => {
    const membership = membersResult.data.find((item) => item.organization_id === organization.id)
    return {
      id: organization.id,
      name: organization.name,
      email: profiles?.find((profile) => profile.id === membership?.user_id)?.email ?? '',
      branchName: branchesResult.data.find((branch) => branch.organization_id === organization.id)?.name ?? '',
      plan: organization.subscription_plan as ClinicPlan,
      status: organization.status === 'suspended' ? 'suspended' : 'active',
      createdAt: organization.created_at,
    }
  })
}

export async function loginClinic(email: string, password: string): Promise<ActionResult> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!validEmail(normalizedEmail) || !password) {
    return { ok: false, error: 'Enter a valid email address and password.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
  if (error) return { ok: false, error: 'The email or password is incorrect, or this clinic is suspended.' }
  if (!(await authenticatedAccount('clinic'))) {
    await supabase.auth.signOut()
    return { ok: false, error: 'This account does not have access to an active clinic workspace.' }
  }
  return { ok: true }
}

export async function loginPlatformAdmin(email: string, password: string): Promise<ActionResult> {
  const normalizedEmail = email.trim().toLowerCase()
  if (!validEmail(normalizedEmail) || !password) {
    return { ok: false, error: 'Enter a valid email address and password.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
  if (error) return { ok: false, error: 'The email or password is incorrect.' }
  if (!(await authenticatedAccount('platform'))) {
    await supabase.auth.signOut()
    return { ok: false, error: 'This account is not a platform administrator.' }
  }
  return { ok: true }
}

export async function logout(realm: AuthRealm): Promise<void> {
  if (realm !== 'platform' && realm !== 'clinic') throw new Error('Invalid authentication realm.')
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signOut()
  if (error) throw new Error(`Could not sign out: ${error.message}`)
  redirect(realm === 'platform' ? '/admin/login' : '/login')
}

export async function createClinic(input: {
  name: string
  email: string
  branchName: string
  plan: string
}): Promise<{ ok: true; clinic: ManagedClinic; temporaryPassword: string } | { ok: false; error: string }> {
  const platformAccount = await authenticatedAccount('platform')
  if (!platformAccount) {
    return { ok: false, error: 'You must sign in as a platform administrator to create clinics.' }
  }
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const branchName = input.branchName.trim()
  if (!name || name.length > 120 || !validEmail(email) || !branchName || branchName.length > 100) {
    return { ok: false, error: 'Enter a clinic name, valid administrator email, and branch name.' }
  }
  if (!plans.includes(input.plan as ClinicPlan)) {
    return { ok: false, error: 'Choose a valid subscription plan.' }
  }

  const temporaryPassword = newTemporaryPassword()
  const admin = createSupabaseAdminClient()
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: name },
  })
  if (authError || !authData.user) {
    return { ok: false, error: authError?.message ?? 'Could not create the clinic administrator.' }
  }

  const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'clinic'
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8)
  const slug = `${baseSlug}-${suffix}`
  const code = suffix.toUpperCase()
  const organizationResult = await admin
    .from('organizations')
    .insert({
      name,
      slug,
      code,
      contact_email: email,
      status: 'active',
      subscription_status: 'trial',
      subscription_plan: input.plan,
      timezone: 'Africa/Addis_Ababa',
      country: 'ET',
    })
    .select('id')
    .single()
  if (organizationResult.error) {
    await admin.auth.admin.deleteUser(authData.user.id)
    return { ok: false, error: `Could not create clinic: ${organizationResult.error.message}` }
  }
  const organizationId = organizationResult.data.id

  const branchCode = branchName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10).toUpperCase() || 'MAIN'
  const branchResult = await admin.from('branches').insert({
    organization_id: organizationId,
    name: branchName,
    code: branchCode,
  })
  const membershipResult = branchResult.error
    ? null
    : await admin.from('organization_members').insert({
        organization_id: organizationId,
        user_id: authData.user.id,
        role: 'organization_administrator',
      })

  if (branchResult.error || membershipResult?.error) {
    const cleanupResults = await Promise.all([
      admin.from('organizations').delete().eq('id', organizationId),
      admin.auth.admin.deleteUser(authData.user.id),
    ])
    const cleanupError = cleanupResults.find((result) => result.error)?.error
    const cause = branchResult.error?.message ?? membershipResult?.error?.message ?? 'Could not assign clinic administrator.'
    return {
      ok: false,
      error: cleanupError
        ? `Clinic setup failed (${cause}); cleanup also failed (${cleanupError.message}). Contact support before retrying.`
        : `Clinic setup failed and was rolled back: ${cause}`,
    }
  }

  const auditError = await writePlatformAuditEvent(
    admin, platformAccount.id, organizationId, 'organization.create', 'organization', organizationId,
    { name, email, branchName, plan: input.plan }
  )
  if (auditError) {
    const cleanupResults = await Promise.all([
      admin.from('organizations').delete().eq('id', organizationId),
      admin.auth.admin.deleteUser(authData.user.id),
    ])
    const cleanupError = cleanupResults.find((result) => result.error)?.error
    return {
      ok: false,
      error: cleanupError
        ? `Clinic audit failed (${auditError}); rollback also failed (${cleanupError.message}). Contact support.`
        : `Clinic setup was rolled back because its audit event failed: ${auditError}`,
    }
  }

  revalidatePath('/admin')
  return {
    ok: true,
    clinic: {
      id: organizationId,
      name,
      email,
      branchName,
      plan: input.plan as ClinicPlan,
      status: 'active',
      createdAt: new Date().toISOString(),
    },
    temporaryPassword,
  }
}

export async function updateClinic(input: {
  id: string
  name: string
  email: string
  branchName: string
  plan: string
  status: string
}): Promise<ActionResult> {
  const platformAccount = await authenticatedAccount('platform')
  if (!platformAccount) {
    return { ok: false, error: 'You must sign in as a platform administrator to update clinics.' }
  }
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  const branchName = input.branchName.trim()
  if (!input.id || !name || name.length > 120 || !validEmail(email) || !branchName || branchName.length > 100) {
    return { ok: false, error: 'Enter a clinic name, valid administrator email, and branch name.' }
  }
  if (!plans.includes(input.plan as ClinicPlan)) return { ok: false, error: 'Choose a valid subscription plan.' }
  if (input.status !== 'active' && input.status !== 'suspended') {
    return { ok: false, error: 'Choose a valid clinic status.' }
  }

  const admin = createSupabaseAdminClient()
  const { data: organization, error: organizationError } = await admin
    .from('organizations')
    .select('id, name, contact_email, subscription_plan, subscription_status, status')
    .eq('id', input.id)
    .maybeSingle()
  if (organizationError) return { ok: false, error: organizationError.message }
  if (!organization) return { ok: false, error: 'Clinic not found.' }

  const { data: membership, error: membershipError } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', input.id)
    .eq('role', 'organization_administrator')
    .limit(1)
    .maybeSingle()
  if (membershipError) return { ok: false, error: membershipError.message }
  if (!membership) return { ok: false, error: 'Clinic administrator not found.' }

  if (organization.status !== input.status) {
    const { data: members, error: membersError } = await admin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', input.id)
    if (membersError) return { ok: false, error: membersError.message }
    const signOutResults = await Promise.all(
      members.map((member) => admin.auth.admin.signOut(member.user_id, 'global'))
    )
    const signOutError = signOutResults.find((result) => result.error)?.error
    if (signOutError) {
      return { ok: false, error: `Could not revoke every clinic session; organization status was not changed: ${signOutError.message}` }
    }
  }

  const { data: branch, error: branchLoadError } = await admin
    .from('branches')
    .select('id, name, code')
    .eq('organization_id', input.id)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (branchLoadError) return { ok: false, error: branchLoadError.message }

  const updatedOrganization = {
    name,
    contact_email: email,
    subscription_plan: input.plan,
    status: input.status,
    subscription_status: input.status === 'suspended'
      ? 'suspended'
      : organization.subscription_status === 'suspended'
        ? 'active'
        : organization.subscription_status,
  }
  const { error: updateError } = await admin
    .from('organizations')
    .update(updatedOrganization)
    .eq('id', input.id)
  if (updateError) return { ok: false, error: updateError.message }

  let branchUpdated = false
  if (branch) {
    const branchCode = branchName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10).toUpperCase() || 'MAIN'
    const { error: branchUpdateError } = await admin
      .from('branches')
      .update({ name: branchName, code: branchCode })
      .eq('id', branch.id)
    if (branchUpdateError) {
      const { error: rollbackError } = await admin.from('organizations').update({
        name: organization.name,
        contact_email: organization.contact_email,
        subscription_plan: organization.subscription_plan,
        status: organization.status,
        subscription_status: organization.subscription_status,
      }).eq('id', input.id)
      return {
        ok: false,
        error: rollbackError
          ? `Branch update failed (${branchUpdateError.message}); organization rollback also failed (${rollbackError.message}).`
          : `Branch update failed; clinic changes were rolled back: ${branchUpdateError.message}`,
      }
    }
    branchUpdated = true
  }

  const { error: userError } = await admin.auth.admin.updateUserById(membership.user_id, {
    email,
    email_confirm: true,
    user_metadata: { full_name: name },
  })
  if (userError) {
    const rollbackResults = await Promise.all([
      admin.from('organizations').update({
        name: organization.name,
        contact_email: organization.contact_email,
        subscription_plan: organization.subscription_plan,
        status: organization.status,
        subscription_status: organization.subscription_status,
      }).eq('id', input.id),
      ...(branch && branchUpdated
        ? [admin.from('branches').update({ name: branch.name, code: branch.code }).eq('id', branch.id)]
        : []),
    ])
    const rollbackError = rollbackResults.find((result) => result.error)?.error
    return {
      ok: false,
      error: rollbackError
        ? `Administrator update failed (${userError.message}); rollback also failed (${rollbackError.message}).`
        : `Administrator update failed; clinic changes were rolled back: ${userError.message}`,
    }
  }

  const auditError = await writePlatformAuditEvent(
    admin, platformAccount.id, input.id, 'organization.update', 'organization', input.id,
    { name, email, branchName, plan: input.plan, status: input.status }
  )
  if (auditError) return { ok: false, error: `Clinic details were updated, but the audit event failed: ${auditError}` }
  revalidatePath('/admin')
  return { ok: true }
}

export async function resetClinicPassword(id: string): Promise<
  { ok: true; email: string; temporaryPassword: string } | { ok: false; error: string }
> {
  const platformAccount = await authenticatedAccount('platform')
  if (!platformAccount) {
    return { ok: false, error: 'You must sign in as a platform administrator to reset clinic passwords.' }
  }
  if (!id) return { ok: false, error: 'Choose a clinic to reset.' }
  const admin = createSupabaseAdminClient()
  const { data: membership, error: membershipError } = await admin
    .from('organization_members')
    .select('user_id, profiles!inner(email)')
    .eq('organization_id', id)
    .eq('role', 'organization_administrator')
    .limit(1)
    .maybeSingle()
  if (membershipError) return { ok: false, error: membershipError.message }
  if (!membership) return { ok: false, error: 'Clinic administrator not found.' }

  const temporaryPassword = newTemporaryPassword()
  const { error: passwordError } = await admin.auth.admin.updateUserById(membership.user_id, {
    password: temporaryPassword,
  })
  if (passwordError) return { ok: false, error: passwordError.message }
  const { error: profileError } = await admin
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', membership.user_id)
  if (profileError) return { ok: false, error: profileError.message }
  const { error: signOutError } = await admin.auth.admin.signOut(membership.user_id, 'global')
  if (signOutError) return { ok: false, error: `Password reset, but existing sessions could not be revoked: ${signOutError.message}` }
  const auditError = await writePlatformAuditEvent(
    admin, platformAccount.id, id, 'clinic_admin.password_reset', 'profile', membership.user_id
  )
  if (auditError) return { ok: false, error: `Password reset, but its audit event failed: ${auditError}` }
  revalidatePath('/admin')

  const profile = membership.profiles as unknown as { email: string }
  return { ok: true, email: profile.email, temporaryPassword }
}

export async function changeClinicPassword(currentPassword: string, newPassword: string): Promise<ActionResult> {
  const account = await authenticatedAccount('clinic')
  if (!account) return { ok: false, error: 'Your session has expired. Sign in again.' }
  if (newPassword.length < 12) return { ok: false, error: 'Use a password with at least 12 characters.' }
  if (currentPassword === newPassword) return { ok: false, error: 'Choose a password different from your temporary password.' }
  if (!(await verifyPassword(account.email, currentPassword))) {
    return { ok: false, error: 'Your current password is incorrect.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword })
  if (passwordError) return { ok: false, error: passwordError.message }
  const { error: profileError } = await supabase.rpc('complete_password_setup')
  if (profileError) return { ok: false, error: `Password changed, but account setup could not be completed: ${profileError.message}` }
  revalidatePath('/')
  revalidatePath('/account/setup')
  return { ok: true }
}

export async function updateClinicProfile(name: string, branchName: string): Promise<ActionResult> {
  const account = await authenticatedAccount('clinic')
  if (!account?.clinicId) return { ok: false, error: 'Your session has expired. Sign in again.' }

  const normalizedName = name.trim()
  const normalizedBranch = branchName.trim()
  if (!normalizedName || normalizedName.length > 120 || !normalizedBranch || normalizedBranch.length > 100) {
    return { ok: false, error: 'Enter a clinic name and branch name within the allowed length.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error: organizationError } = await supabase
    .from('organizations')
    .update({ name: normalizedName })
    .eq('id', account.clinicId)
  if (organizationError) return { ok: false, error: organizationError.message }

  const { data: branch, error: branchLoadError } = await supabase
    .from('branches')
    .select('id')
    .eq('organization_id', account.clinicId)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (branchLoadError) return { ok: false, error: branchLoadError.message }
  if (branch) {
    const code = normalizedBranch.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10).toUpperCase() || 'MAIN'
    const { error: branchUpdateError } = await supabase
      .from('branches')
      .update({ name: normalizedBranch, code })
      .eq('id', branch.id)
    if (branchUpdateError) return { ok: false, error: branchUpdateError.message }
  }
  revalidatePath('/')
  return { ok: true }
}

export async function changePlatformCredentials(
  currentPassword: string,
  newEmail: string,
  newPassword: string
): Promise<ActionResult> {
  const account = await authenticatedAccount('platform')
  if (!account) return { ok: false, error: 'Your session has expired. Sign in again.' }
  const normalizedEmail = newEmail.trim().toLowerCase()
  if (!validEmail(normalizedEmail)) return { ok: false, error: 'Enter a valid email address.' }
  if (newPassword && newPassword.length < 12) return { ok: false, error: 'Use a password with at least 12 characters.' }
  if (!newPassword && normalizedEmail === account.email) return { ok: false, error: 'Change the email or enter a new password.' }
  if (!(await verifyPassword(account.email, currentPassword))) return { ok: false, error: 'Your current password is incorrect.' }

  const admin = createSupabaseAdminClient()
  const { error } = await admin.auth.admin.updateUserById(account.id, {
    ...(normalizedEmail !== account.email ? { email: normalizedEmail, email_confirm: true } : {}),
    ...(newPassword ? { password: newPassword } : {}),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin')
  return { ok: true }
}

export async function getAccountForPage(realm: AuthRealm): Promise<AuthenticatedAccount | null> {
  return authenticatedAccount(realm)
}
