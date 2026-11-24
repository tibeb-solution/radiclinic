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

export type DiagnosisCatalogEntry = {
  id: string
  diagnosisName: string
  diagnosisCode: string | null
  codeSystem: string | null
  category: string
  description: string | null
  anatomicalArea: string | null
  requiresTooth: boolean
}

export type DiagnosisCatalogProposal = {
  id: string
  diagnosisId: string
  diagnosisName: string
  diagnosisCode: string | null
  codeSystem: string | null
  category: string
  description: string | null
  anatomicalArea: string | null
  requiresTooth: boolean
  status: string
  reviewerNotes: string | null
  submittedAt: string
}

export type ClinicalSafetyAlertSummary = {
  id: string
  patientId: string
  patientName: string
  title: string
  criticality: string
  status: string
  createdAt: string
}

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

async function listStoragePaths(
  bucket: ReturnType<ReturnType<typeof createSupabaseAdminClient>['storage']['from']>,
  directory: string
): Promise<{ paths: string[] } | { error: string }> {
  const paths: string[] = []
  const pageSize = 100

  async function visit(folder: string): Promise<string | null> {
    let offset = 0
    while (true) {
      const { data, error } = await bucket.list(folder, { limit: pageSize, offset })
      if (error) return error.message
      const entries = data ?? []
      for (const entry of entries) {
        const path = `${folder}/${entry.name}`
        if (entry.id === null) {
          const nestedError = await visit(path)
          if (nestedError) return nestedError
        } else {
          paths.push(path)
        }
      }
      if (entries.length < pageSize) return null
      offset += entries.length
    }
  }

  const error = await visit(directory)
  return error ? { error } : { paths }
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
  name: string
  patientNumber?: string
  phone?: string
  dateOfBirth?: string
  sex?: string
  email?: string
  address?: string
  nationalId?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  emergencyContactRelationship?: string
}): Promise<MutationResult<Patient>> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Complete account setup and sign in to an active clinic first.' }
  const patientNumber = input.patientNumber?.trim() || `PT-${randomUUID().slice(0, 8).toUpperCase()}`
  const name = input.name.trim()
  if (!input.branchId || !name || name.length > 120 || patientNumber.length > 32) {
    return { ok: false, error: 'Enter a patient name and choose an active branch.' }
  }
  const email = input.email?.trim().toLowerCase() ?? ''
  if (email && !validEmail(email)) return { ok: false, error: 'Enter a valid patient email address.' }
  const sexValue = input.sex?.trim() ?? ''
  let sex: Patient['sex']
  if (sexValue === '') sex = undefined
  else if (sexValue === 'female' || sexValue === 'male' || sexValue === 'other' || sexValue === 'not_specified') sex = sexValue
  else return { ok: false, error: 'Choose a valid gender option.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('patients').insert({
    organization_id: account.clinicId,
    registered_branch_id: input.branchId,
    patient_number: patientNumber,
    full_name: name,
    phone: input.phone?.trim() || null,
    date_of_birth: input.dateOfBirth || null,
    sex: sex ?? null,
    email: email || null,
    address: input.address?.trim() || null,
    national_id: input.nationalId?.trim() || null,
    emergency_contact_name: input.emergencyContactName?.trim() || null,
    emergency_contact_phone: input.emergencyContactPhone?.trim() || null,
    emergency_contact_relationship: input.emergencyContactRelationship?.trim() || null,
    created_by: account.id,
  }).select('id, organization_id, registered_branch_id, patient_number, full_name, date_of_birth, sex, phone, email, national_id, address, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, status, created_at').single()
  if (error) return { ok: false, error: error.message.includes('patients_organization_id_patient_number_key') ? 'That patient number is already in use.' : error.message }
  const auditError = await writeAuditEvent(account, 'patient.create', 'patient', data.id, input.branchId)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return {
    ok: true,
    value: {
      id: data.id, organizationId: data.organization_id, registeredBranchId: data.registered_branch_id,
      patientNumber: data.patient_number, name: data.full_name, dateOfBirth: data.date_of_birth ?? undefined,
      sex: data.sex ?? undefined, phone: data.phone ?? undefined, email: data.email ?? undefined,
      nationalId: data.national_id ?? undefined, address: data.address ?? undefined,
      emergencyContactName: data.emergency_contact_name ?? undefined,
      emergencyContactPhone: data.emergency_contact_phone ?? undefined,
      emergencyContactRelationship: data.emergency_contact_relationship ?? undefined,
      status: data.status, createdAt: data.created_at,
    },
  }
}

export async function setClinicPatientStatus(patientId: string, status: Patient['status']): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Complete account setup and sign in to an active clinic first.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('patients')
    .update({ status, archived_at: status === 'archived' ? new Date().toISOString() : null })
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
      .select('organization_id, user_id, active')
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
      administratorActive: membership?.active ?? false,
      createdAt: organization.created_at,
    }
  })
}

export async function setClinicAdminActive(id: string, active: boolean): Promise<ActionResult> {
  const platformAccount = await authenticatedAccount('platform')
  if (!platformAccount) {
    return { ok: false, error: 'You must sign in as a platform administrator to manage clinic access.' }
  }
  if (!id || typeof active !== 'boolean') return { ok: false, error: 'Choose a clinic and valid access state.' }

  const admin = createSupabaseAdminClient()
  const { data: membership, error: membershipError } = await admin
    .from('organization_members')
    .select('user_id, active')
    .eq('organization_id', id)
    .eq('role', 'organization_administrator')
    .limit(1)
    .maybeSingle()
  if (membershipError) return { ok: false, error: membershipError.message }
  if (!membership) return { ok: false, error: 'Clinic administrator not found.' }
  if (membership.active === active) return { ok: true }

  const { data: updatedMembership, error: updateError } = await admin
    .from('organization_members')
    .update({ active })
    .eq('organization_id', id)
    .eq('user_id', membership.user_id)
    .eq('active', membership.active)
    .select('user_id')
    .maybeSingle()
  if (updateError) return { ok: false, error: updateError.message }
  if (!updatedMembership) return { ok: false, error: 'Clinic administrator access changed concurrently. Refresh and try again.' }

  const auditError = await writePlatformAuditEvent(
    admin,
    platformAccount.id,
    id,
    active ? 'clinic_admin.activated' : 'clinic_admin.deactivated',
    'profile',
    membership.user_id,
    { active }
  )
  if (auditError) return { ok: false, error: `Access was updated, but its audit event failed: ${auditError}` }
  revalidatePath('/admin')
  return { ok: true }
}

export async function deleteClinicAccount(
  id: string,
  confirmationName: string
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  const platformAccount = await authenticatedAccount('platform')
  if (!platformAccount) {
    return { ok: false, error: 'You must sign in as a platform administrator to delete clinics.' }
  }
  if (!id || !confirmationName.trim()) {
    return { ok: false, error: 'Choose a clinic and enter its name to confirm deletion.' }
  }

  const admin = createSupabaseAdminClient()
  const { data: organization, error: organizationError } = await admin
    .from('organizations')
    .select('id, name, status')
    .eq('id', id)
    .maybeSingle()
  if (organizationError) return { ok: false, error: organizationError.message }
  if (!organization) return { ok: false, error: 'Clinic not found. Refresh the clinic list.' }
  if (confirmationName.trim() !== organization.name) {
    return { ok: false, error: 'The clinic name does not match. No data was deleted.' }
  }

  const { data: memberships, error: membershipsError } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', id)
  if (membershipsError) return { ok: false, error: `Could not load clinic members: ${membershipsError.message}` }

  const storage = admin.storage.from('clinical-documents')
  const storageResult = await listStoragePaths(storage, id)
  if ('error' in storageResult) {
    return { ok: false, error: `Could not inspect clinic files; no clinic records were deleted: ${storageResult.error}` }
  }
  for (let offset = 0; offset < storageResult.paths.length; offset += 100) {
    const { error } = await storage.remove(storageResult.paths.slice(offset, offset + 100))
    if (error) {
      return {
        ok: false,
        error: `Could not remove all clinic files; clinic records were retained. Some files may already have been removed. Storage error: ${error.message}`,
      }
    }
  }

  const { data: deletedOrganization, error: deleteError } = await admin
    .from('organizations')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (deleteError) {
    return {
      ok: false,
      error: `Clinic files were removed, but the clinic records could not be deleted: ${deleteError.message}`,
    }
  }
  if (!deletedOrganization) {
    return { ok: false, error: 'Clinic files were removed, but the clinic record was already deleted or changed.' }
  }

  const warnings: string[] = []
  const { error: auditError } = await admin.from('audit_events').insert({
    organization_id: null,
    actor_id: platformAccount.id,
    action: 'organization.deleted',
    entity_type: 'organization',
    entity_id: id,
    after_data: { name: organization.name, status: organization.status },
  })
  if (auditError) warnings.push(`the platform audit event could not be recorded (${auditError.message})`)

  const userIds = [...new Set((memberships ?? []).map((membership) => membership.user_id))]
  for (const userId of userIds) {
    if (userId === platformAccount.id) continue

    const { data: otherMembership, error: otherMembershipError } = await admin
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (otherMembershipError) {
      warnings.push(`a former clinic member account could not be checked (${otherMembershipError.message})`)
      continue
    }
    if (otherMembership) continue

    const { data: otherBranchMembership, error: branchMembershipError } = await admin
      .from('branch_memberships')
      .select('branch_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle()
    if (branchMembershipError) {
      warnings.push(`a former clinic member account could not be checked (${branchMembershipError.message})`)
      continue
    }
    if (otherBranchMembership) continue

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', userId)
      .maybeSingle()
    if (profileError) {
      warnings.push(`a former clinic member account could not be checked (${profileError.message})`)
      continue
    }
    if (!profile || profile.is_platform_admin) continue

    const { error: userDeleteError } = await admin.auth.admin.deleteUser(userId)
    if (userDeleteError) {
      warnings.push('some former clinic member login accounts were retained because they are referenced by other records')
    }
  }

  revalidatePath('/admin')
  return warnings.length
    ? { ok: true, warning: `Clinic “${organization.name}” and its files were deleted, but ${warnings.join('; ')}. Those accounts no longer have access to this clinic.` }
    : { ok: true }
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

  const { data: administratorProfile, error: profileError } = await admin
    .from('profiles')
    .update({ full_name: name, must_change_password: true })
    .eq('id', authData.user.id)
    .select('id')
    .maybeSingle()
  if (profileError || !administratorProfile) {
    const cleanupResults = await Promise.all([
      admin.from('organizations').delete().eq('id', organizationId),
      admin.auth.admin.deleteUser(authData.user.id),
    ])
    const cleanupError = cleanupResults.find((result) => result.error)?.error
    const cause = profileError?.message ?? 'The administrator profile was not created.'
    return {
      ok: false,
      error: cleanupError
        ? `Clinic account setup failed (${cause}); cleanup also failed (${cleanupError.message}). Contact support.`
        : `Clinic setup was rolled back because its administrator profile could not be configured: ${cause}`,
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
      administratorActive: true,
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

export type ClinicalPatientChart = {
  currentUserId: string
  patient: {
    id: string
    patientNumber: string
    fullName: string
    dateOfBirth: string | null
    sex: string | null
    phone: string | null
    email: string | null
    nationalId: string | null
    address: string | null
    emergencyContactName: string | null
    emergencyContactPhone: string | null
    emergencyContactRelationship: string | null
    status: string
    registeredBranchId: string
    createdAt: string
  }
  historyEntries: Array<{
    id: string
    category: string
    entryType: string
    details: string
    source: string
    verificationStatus: string
    recordedAt: string
  }>
  vitals: Array<{
    id: string
    visitId: string | null
    bloodPressureSystolic: number | null
    bloodPressureDiastolic: number | null
    pulseBpm: number | null
    temperatureC: number | null
    respiratoryRate: number | null
    oxygenSaturation: number | null
    bloodGlucose: number | null
    weightKg: number | null
    heightCm: number | null
    notes: string | null
    source: string
    recordedAt: string
  }>
  visits: Array<{
    id: string
    branchId: string
    visitNumber: string
    visitType: string
    caseType: string
    reason: string | null
    chiefComplaint: string | null
    medicalHistoryReviewed: boolean
    followUpInstructions: string | null
    clinicalNotes: string | null
    visitedAt: string
  }>
  examinations: Array<{
    id: string
    visitId: string
    historyOfPresentIllness: string | null
    extraoralExamination: string | null
    intraoralExamination: string | null
    toothExamination: string | null
    periodontalExamination: string | null
    softTissueExamination: string | null
    radiographicFindings: string | null
    otherObservations: string | null
    createdAt: string
  }>
  diagnoses: Array<{
    id: string
    visitId: string
    catalogEntryId: string | null
    diagnosisName: string
    diagnosisCode: string | null
    diagnosisCodeSystem: string | null
    category: string
    severity: string | null
    certainty: string
    priority: string
    diagnosticReasoning: string | null
    conflictingFindings: string | null
    requiredInvestigations: string | null
    priorityReason: string | null
    description: string | null
    anatomicalLocation: string | null
    toothNumber: string | null
    supportingFindings: string | null
    clinicalNotes: string | null
    status: string
    diagnosedAt: string
    locations: Array<{
      toothNumber: string | null
      toothSurface: string | null
      anatomicalArea: string | null
    }>
  }>
  diagnosisAssessments: Array<{
    id: string
    diagnosisId: string
    visitId: string
    progression: string
    status: string
    certainty: string
    priority: string
    severity: string | null
    assessmentReason: string
    supportingFindings: string | null
    conflictingFindings: string | null
    requiredInvestigations: string | null
    assessedAt: string
  }>
  diagnosisCaseDecisions: Array<{
    diagnosisId: string
    selectedCaseType: string
    diagnosisCategory: string
    overrideReason: string | null
    recordedAt: string
  }>
  diagnosisCatalogProposals: DiagnosisCatalogProposal[]
  canReviewDiagnosisCatalogProposals: boolean
  clinicalOutcomes: Array<{
    id: string
    diagnosisId: string
    visitId: string
    assessmentId: string | null
    performedProcedureId: string | null
    outcome: string
    clinicalFindings: string
    complications: string | null
    furtherTreatmentRequired: string | null
    assessedAt: string
  }>
  clinicalSafetyAlerts: Array<{
    id: string
    visitId: string
    diagnosisId: string | null
    title: string
    description: string
    criticality: string
    escalationAfterMinutes: number | null
    escalationTargetRole: string
    status: string
    responsibleUserId: string | null
    createdBy: string
    createdAt: string
    acknowledgedBy: string | null
    acknowledgedAt: string | null
    acknowledgmentAction: string | null
    escalatedToRole: string | null
    escalatedAt: string | null
    resolvedBy: string | null
    resolvedAt: string | null
    resolutionReason: string | null
    events: Array<{
      id: string
      eventType: string
      actorId: string
      details: Record<string, unknown>
      createdAt: string
    }>
  }>
  canCreateClinicalSafetyAlert: boolean
  canAcknowledgeClinicalSafetyAlerts: boolean
  clinicalSafetyAlertRules: Array<{
    criticality: string
    escalationAfterMinutes: number | null
    escalationRole: string
    changeReason: string
  }>
  canManageClinicalSafetyAlerts: boolean
  canEscalateClinicalSafetyAlerts: boolean
  canManageDiagnosisCatalog: boolean
  odontogram: Array<{
    id: string
    visitId: string | null
    toothNumber: string
    toothSurface: string
    finding: string
    stage: string
    notes: string | null
    recordedAt: string
  }>
  treatmentPlans: Array<{
    id: string
    title: string
    status: string
    createdAt: string
    items: Array<{
      id: string
      treatmentName: string
      toothNumbers: string[]
      status: string
      priority: string
      estimatedCost: number | null
      createdAt: string
    }>
  }>
  procedures: Array<{
    id: string
    visitId: string | null
    treatmentPlanItemId: string | null
    procedureName: string
    toothNumbers: string[]
    procedureDetails: string
    clinicalOutcome: string | null
    performedAt: string
  }>
  prescriptions: Array<{
    id: string
    visitId: string | null
    medicationName: string
    strength: string | null
    dosage: string
    route: string
    frequency: string
    duration: string | null
    quantity: string | null
    instructions: string | null
    prescribedAt: string
  }>
  consents: Array<{
    id: string
    visitId: string | null
    status: string
    method: string
    notes: string | null
    recordedAt: string
  }>
  attachments: Array<{
    id: string
    category: string
    fileName: string
    mimeType: string | null
    fileSize: number | null
    description: string | null
    visitId: string | null
    toothNumber: string | null
    createdAt: string
  }>
  clinicalRecords: Array<{
    id: string
    branchId: string
    title: string
    diagnosis: string | null
    status: string
    reviewComment: string | null
    canSubmit: boolean
    createdAt: string
  }>
  canReviewClinicalRecords: boolean
  canReviewEscalatedClinicalRecords: boolean
}

export type ClinicalEncounterInput = {
  patientId: string
  branchId: string
  visitType: string
  caseType: string
  reason: string
  chiefComplaint: string
  historyReviewed: boolean
  followUp: string
  exam: {
    historyOfPresentIllness: string
    extraoralExamination: string
    intraoralExamination: string
    toothExamination: string
    periodontalExamination: string
    softTissueExamination: string
    radiographicFindings: string
    otherObservations: string
  }
  vitals: {
    bloodPressureSystolic: string
    bloodPressureDiastolic: string
    pulseBpm: string
    temperatureC: string
    respiratoryRate: string
    oxygenSaturation: string
    bloodGlucose: string
    weightKg: string
    heightCm: string
    notes: string
    source: string
  }
}

export async function getClinicalPatientChart(
  patientId: string
): Promise<{ ok: true; data: ClinicalPatientChart } | { ok: false; error: string }> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Sign in to an active clinic to open patient records.' }
  if (!patientId) return { ok: false, error: 'Choose a patient record.' }

  const supabase = await createSupabaseServerClient()
  const { data: patient, error: patientError } = await supabase
    .from('patients')
    .select('id, organization_id, registered_branch_id, patient_number, full_name, date_of_birth, sex, phone, email, national_id, address, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, status, created_at')
    .eq('organization_id', account.clinicId)
    .eq('id', patientId)
    .maybeSingle()
  if (patientError) return { ok: false, error: `Could not load patient profile: ${patientError.message}` }
  if (!patient) return { ok: false, error: 'Patient not found or you do not have access to this branch.' }

  const { error: accessError } = await supabase.from('patient_access_events').insert({
    organization_id: account.clinicId,
    branch_id: patient.registered_branch_id,
    patient_id: patient.id,
    actor_id: account.id,
  })
  if (accessError) return { ok: false, error: `Could not record patient record access: ${accessError.message}` }

  const [
    historyResult,
    vitalsResult,
    visitsResult,
    examinationsResult,
    diagnosesResult,
    diagnosisAssessmentsResult,
    clinicalOutcomesResult,
    clinicalSafetyAlertsResult,
    clinicalSafetyAlertRulesResult,
    diagnosisCaseDecisionsResult,
    diagnosisCatalogProposalsResult,
    odontogramResult,
    treatmentPlansResult,
    proceduresResult,
    prescriptionsResult,
    consentsResult,
    attachmentsResult,
    clinicalRecordsResult,
  ] = await Promise.all([
    supabase.from('patient_history_entries').select('id, category, entry_type, details, source, verification_status, recorded_at').eq('patient_id', patientId).order('recorded_at', { ascending: false }),
    supabase.from('patient_vitals').select('id, visit_id, blood_pressure_systolic, blood_pressure_diastolic, pulse_bpm, temperature_c, respiratory_rate, oxygen_saturation, blood_glucose, weight_kg, height_cm, notes, source, recorded_at').eq('patient_id', patientId).order('recorded_at', { ascending: false }),
    supabase.from('patient_visits').select('id, branch_id, visit_number, visit_type, case_type, reason, chief_complaint, medical_history_reviewed, follow_up_instructions, clinical_notes, visited_at').eq('patient_id', patientId).order('visited_at', { ascending: false }),
    supabase.from('clinical_examinations').select('id, visit_id, history_of_present_illness, extraoral_examination, intraoral_examination, tooth_examination, periodontal_examination, soft_tissue_examination, radiographic_findings, other_observations, created_at, patient_visits!inner(patient_id)').eq('patient_visits.patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('visit_diagnoses').select('id, visit_id, catalog_entry_id, diagnosis_name, diagnosis_code, diagnosis_code_system, category, severity, certainty, priority, diagnostic_reasoning, conflicting_findings, required_investigations, priority_reason, description, anatomical_location, tooth_number, supporting_findings, clinical_notes, status, diagnosed_at, patient_visits!inner(patient_id)').eq('patient_visits.patient_id', patientId).order('diagnosed_at', { ascending: false }),
    supabase.from('visit_diagnosis_assessments').select('id, diagnosis_id, visit_id, progression, status, certainty, priority, severity, assessment_reason, supporting_findings, conflicting_findings, required_investigations, assessed_at').eq('patient_id', patientId).order('assessed_at', { ascending: false }),
    supabase.from('clinical_outcomes').select('id, diagnosis_id, visit_id, assessment_id, performed_procedure_id, outcome, clinical_findings, complications, further_treatment_required, assessed_at').eq('patient_id', patientId).order('assessed_at', { ascending: false }),
    supabase.from('clinical_safety_alerts').select('id, visit_id, diagnosis_id, title, description, criticality, escalation_after_minutes, escalation_target_role, status, responsible_user_id, created_by, created_at, acknowledged_by, acknowledged_at, acknowledgment_action, escalated_to_role, escalated_at, resolved_by, resolved_at, resolution_reason').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('clinical_safety_alert_rules').select('criticality, escalation_after_minutes, escalation_role, change_reason').eq('organization_id', account.clinicId).is('effective_until', null),
    supabase.from('diagnosis_case_decisions').select('diagnosis_id, selected_case_type, diagnosis_category, override_reason, recorded_at').eq('patient_id', patientId).order('recorded_at', { ascending: false }),
    account.role === 'organization_administrator' || account.role === 'central_clinical_supervisor'
      ? supabase.from('diagnosis_catalog_proposals').select('id, diagnosis_id, diagnosis_name, diagnosis_code, code_system, category, description, anatomical_area, requires_tooth, status, reviewer_notes, submitted_at').eq('organization_id', account.clinicId).eq('patient_id', patientId).eq('status', 'pending').order('submitted_at', { ascending: false }).limit(50)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('odontogram_findings').select('id, visit_id, tooth_number, tooth_surface, finding, stage, notes, recorded_at').eq('patient_id', patientId).order('recorded_at', { ascending: false }),
    supabase.from('treatment_plans').select('id, title, status, created_at, treatment_plan_items(id, treatment_name, tooth_numbers, status, priority, estimated_cost, created_at)').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('performed_procedures').select('id, visit_id, treatment_plan_item_id, procedure_name, tooth_numbers, procedure_details, clinical_outcome, performed_at').eq('patient_id', patientId).order('performed_at', { ascending: false }),
    supabase.from('prescriptions').select('id, visit_id, medication_name, strength, dosage, route, frequency, duration, quantity, instructions, prescribed_at').eq('patient_id', patientId).order('prescribed_at', { ascending: false }),
    supabase.from('patient_consents').select('id, visit_id, status, method, notes, recorded_at').eq('patient_id', patientId).order('recorded_at', { ascending: false }),
    supabase.from('patient_attachments').select('id, category, file_name, mime_type, file_size, description, visit_id, tooth_number, created_at').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('clinical_records')    .select('id, branch_id, title, diagnosis, status, review_comment, submitted_by, created_at').eq('patient_id', patientId).order('created_at', { ascending: false }),
  ])
  for (const [label, result] of [
    ['medical and dental history', historyResult],
    ['vital signs', vitalsResult],
    ['visits', visitsResult],
    ['examinations', examinationsResult],
    ['diagnoses', diagnosesResult],
    ['diagnosis reassessments', diagnosisAssessmentsResult],
    ['clinical outcomes', clinicalOutcomesResult],
    ['clinical safety alerts', clinicalSafetyAlertsResult],
    ['clinical safety alert settings', clinicalSafetyAlertRulesResult],
    ['diagnosis case decisions', diagnosisCaseDecisionsResult],
    ['diagnosis catalog proposals', diagnosisCatalogProposalsResult],
    ['dental chart', odontogramResult],
    ['treatment plans', treatmentPlansResult],
    ['procedures', proceduresResult],
    ['prescriptions', prescriptionsResult],
    ['consent records', consentsResult],
    ['clinical documents', attachmentsResult],
    ['clinical records', clinicalRecordsResult],
  ] as const) {
    if (result.error) return { ok: false, error: `Could not load ${label}: ${result.error.message}` }
  }

  const historyRows = historyResult.data ?? []
  const vitalRows = vitalsResult.data ?? []
  const visitRows = visitsResult.data ?? []
  const examinationRows = examinationsResult.data ?? []
  const diagnosisRows = diagnosesResult.data ?? []
  const diagnosisAssessmentRows = diagnosisAssessmentsResult.data ?? []
  const clinicalOutcomeRows = clinicalOutcomesResult.data ?? []
  const clinicalSafetyAlertRows = clinicalSafetyAlertsResult.data ?? []
  const clinicalSafetyAlertRuleRows = clinicalSafetyAlertRulesResult.data ?? []
  const diagnosisCaseDecisionRows = diagnosisCaseDecisionsResult.data ?? []
  const diagnosisCatalogProposalRows = diagnosisCatalogProposalsResult.data ?? []
  const odontogramRows = odontogramResult.data ?? []
  const treatmentPlanRows = treatmentPlansResult.data ?? []
  const procedureRows = proceduresResult.data ?? []
  const prescriptionRows = prescriptionsResult.data ?? []
  const consentRows = consentsResult.data ?? []
  const attachmentRows = attachmentsResult.data ?? []
  const clinicalRecordRows = clinicalRecordsResult.data ?? []
  const diagnosisIds = diagnosisRows.map((diagnosis) => diagnosis.id)
  const diagnosisLocationsResult = diagnosisIds.length
    ? await supabase
      .from('visit_diagnosis_locations')
      .select('diagnosis_id, tooth_number, tooth_surface, anatomical_area')
      .in('diagnosis_id', diagnosisIds)
    : { data: [], error: null }
  if (diagnosisLocationsResult.error) {
    return { ok: false, error: `Could not load diagnosis locations: ${diagnosisLocationsResult.error.message}` }
  }
  const diagnosisLocations = diagnosisLocationsResult.data ?? []
  const clinicalSafetyAlertIds = clinicalSafetyAlertRows.map((alert) => alert.id)
  const clinicalSafetyAlertEventsResult = clinicalSafetyAlertIds.length
    ? await supabase.from('clinical_safety_alert_events')
      .select('id, alert_id, event_type, actor_id, details, created_at')
      .in('alert_id', clinicalSafetyAlertIds)
      .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (clinicalSafetyAlertEventsResult.error) {
    return { ok: false, error: `Could not load safety alert history: ${clinicalSafetyAlertEventsResult.error.message}` }
  }
  const clinicalSafetyAlertEventRows = clinicalSafetyAlertEventsResult.data ?? []

  return {
    ok: true,
    data: {
      currentUserId: account.id,
      patient: {
        id: patient.id,
        patientNumber: patient.patient_number,
        fullName: patient.full_name,
        dateOfBirth: patient.date_of_birth,
        sex: patient.sex,
        phone: patient.phone,
        email: patient.email,
        nationalId: patient.national_id,
        address: patient.address,
        emergencyContactName: patient.emergency_contact_name,
        emergencyContactPhone: patient.emergency_contact_phone,
        emergencyContactRelationship: patient.emergency_contact_relationship,
        status: patient.status,
        registeredBranchId: patient.registered_branch_id,
        createdAt: patient.created_at,
      },
      historyEntries: historyRows.map((entry) => ({
        id: entry.id,
        category: entry.category,
        entryType: entry.entry_type,
        details: entry.details,
        source: entry.source,
        verificationStatus: entry.verification_status,
        recordedAt: entry.recorded_at,
      })),
      vitals: vitalRows.map((item) => ({
        id: item.id,
        visitId: item.visit_id,
        bloodPressureSystolic: item.blood_pressure_systolic,
        bloodPressureDiastolic: item.blood_pressure_diastolic,
        pulseBpm: item.pulse_bpm,
        temperatureC: item.temperature_c,
        respiratoryRate: item.respiratory_rate,
        oxygenSaturation: item.oxygen_saturation,
        bloodGlucose: item.blood_glucose,
        weightKg: item.weight_kg,
        heightCm: item.height_cm,
        notes: item.notes,
        source: item.source,
        recordedAt: item.recorded_at,
      })),
      visits: visitRows.map((visit) => ({
        id: visit.id,
        branchId: visit.branch_id,
        visitNumber: visit.visit_number,
        visitType: visit.visit_type,
        caseType: visit.case_type,
        reason: visit.reason,
        chiefComplaint: visit.chief_complaint,
        medicalHistoryReviewed: visit.medical_history_reviewed,
        followUpInstructions: visit.follow_up_instructions,
        clinicalNotes: visit.clinical_notes,
        visitedAt: visit.visited_at,
      })),
      examinations: examinationRows.map((exam) => ({
        id: exam.id,
        visitId: exam.visit_id,
        historyOfPresentIllness: exam.history_of_present_illness,
        extraoralExamination: exam.extraoral_examination,
        intraoralExamination: exam.intraoral_examination,
        toothExamination: exam.tooth_examination,
        periodontalExamination: exam.periodontal_examination,
        softTissueExamination: exam.soft_tissue_examination,
        radiographicFindings: exam.radiographic_findings,
        otherObservations: exam.other_observations,
        createdAt: exam.created_at,
      })),
      diagnoses: diagnosisRows.map((diagnosis) => ({
        id: diagnosis.id,
        visitId: diagnosis.visit_id,
        catalogEntryId: diagnosis.catalog_entry_id,
        diagnosisName: diagnosis.diagnosis_name,
        diagnosisCode: diagnosis.diagnosis_code,
        diagnosisCodeSystem: diagnosis.diagnosis_code_system,
        category: diagnosis.category,
        severity: diagnosis.severity,
        certainty: diagnosis.certainty,
        priority: diagnosis.priority,
        diagnosticReasoning: diagnosis.diagnostic_reasoning,
        conflictingFindings: diagnosis.conflicting_findings,
        requiredInvestigations: diagnosis.required_investigations,
        priorityReason: diagnosis.priority_reason,
        description: diagnosis.description,
        anatomicalLocation: diagnosis.anatomical_location,
        toothNumber: diagnosis.tooth_number,
        supportingFindings: diagnosis.supporting_findings,
        clinicalNotes: diagnosis.clinical_notes,
        status: diagnosis.status,
        diagnosedAt: diagnosis.diagnosed_at,
        locations: diagnosisLocations
          .filter((location) => location.diagnosis_id === diagnosis.id)
          .map((location) => ({
            toothNumber: location.tooth_number,
            toothSurface: location.tooth_surface,
            anatomicalArea: location.anatomical_area,
          })),
      })),
      diagnosisAssessments: diagnosisAssessmentRows.map((assessment) => ({
        id: assessment.id,
        diagnosisId: assessment.diagnosis_id,
        visitId: assessment.visit_id,
        progression: assessment.progression,
        status: assessment.status,
        certainty: assessment.certainty,
        priority: assessment.priority,
        severity: assessment.severity,
        assessmentReason: assessment.assessment_reason,
        supportingFindings: assessment.supporting_findings,
        conflictingFindings: assessment.conflicting_findings,
        requiredInvestigations: assessment.required_investigations,
        assessedAt: assessment.assessed_at,
      })),
      diagnosisCaseDecisions: diagnosisCaseDecisionRows.map((decision) => ({
        diagnosisId: decision.diagnosis_id,
        selectedCaseType: decision.selected_case_type,
        diagnosisCategory: decision.diagnosis_category,
        overrideReason: decision.override_reason,
        recordedAt: decision.recorded_at,
      })),
      diagnosisCatalogProposals: diagnosisCatalogProposalRows.map((proposal) => ({
        id: proposal.id,
        diagnosisId: proposal.diagnosis_id,
        diagnosisName: proposal.diagnosis_name,
        diagnosisCode: proposal.diagnosis_code,
        codeSystem: proposal.code_system,
        category: proposal.category,
        description: proposal.description,
        anatomicalArea: proposal.anatomical_area,
        requiresTooth: proposal.requires_tooth,
        status: proposal.status,
        reviewerNotes: proposal.reviewer_notes,
        submittedAt: proposal.submitted_at,
      })),
      canReviewDiagnosisCatalogProposals: [
        'organization_administrator',
        'central_clinical_supervisor',
      ].includes(account.role ?? ''),
      clinicalOutcomes: clinicalOutcomeRows.map((outcome) => ({
        id: outcome.id,
        diagnosisId: outcome.diagnosis_id,
        visitId: outcome.visit_id,
        assessmentId: outcome.assessment_id,
        performedProcedureId: outcome.performed_procedure_id,
        outcome: outcome.outcome,
        clinicalFindings: outcome.clinical_findings,
        complications: outcome.complications,
        furtherTreatmentRequired: outcome.further_treatment_required,
        assessedAt: outcome.assessed_at,
      })),
      clinicalSafetyAlerts: clinicalSafetyAlertRows.map((alert) => ({
        id: alert.id,
        visitId: alert.visit_id,
        diagnosisId: alert.diagnosis_id,
        title: alert.title,
        description: alert.description,
        criticality: alert.criticality,
        escalationAfterMinutes: alert.escalation_after_minutes,
        escalationTargetRole: alert.escalation_target_role,
        status: alert.status,
        responsibleUserId: alert.responsible_user_id,
        createdBy: alert.created_by,
        createdAt: alert.created_at,
        acknowledgedBy: alert.acknowledged_by,
        acknowledgedAt: alert.acknowledged_at,
        acknowledgmentAction: alert.acknowledgment_action,
        escalatedToRole: alert.escalated_to_role,
        escalatedAt: alert.escalated_at,
        resolvedBy: alert.resolved_by,
        resolvedAt: alert.resolved_at,
        resolutionReason: alert.resolution_reason,
        events: clinicalSafetyAlertEventRows
          .filter((event) => event.alert_id === alert.id)
          .map((event) => ({
            id: event.id,
            eventType: event.event_type,
            actorId: event.actor_id,
            details: event.details as Record<string, unknown>,
            createdAt: event.created_at,
          })),
      })),
      canCreateClinicalSafetyAlert: [
          'organization_administrator',
          'central_clinical_supervisor',
          'branch_supervisor',
          'doctor',
          'nurse',
      ].includes(account.role ?? ''),
      canAcknowledgeClinicalSafetyAlerts: [
          'organization_administrator',
          'central_clinical_supervisor',
          'branch_supervisor',
          'doctor',
          'nurse',
      ].includes(account.role ?? ''),
      clinicalSafetyAlertRules: clinicalSafetyAlertRuleRows.map((rule) => ({
        criticality: rule.criticality,
        escalationAfterMinutes: rule.escalation_after_minutes,
        escalationRole: rule.escalation_role,
        changeReason: rule.change_reason,
      })),
      canManageClinicalSafetyAlerts: [
        'organization_administrator',
        'central_clinical_supervisor',
      ].includes(account.role ?? ''),
      canEscalateClinicalSafetyAlerts: [
        'organization_administrator',
        'central_clinical_supervisor',
        'branch_supervisor',
      ].includes(account.role ?? ''),
      canManageDiagnosisCatalog: account.role === 'organization_administrator',
      odontogram: odontogramRows.map((finding) => ({
        id: finding.id,
        visitId: finding.visit_id,
        toothNumber: finding.tooth_number,
        toothSurface: finding.tooth_surface,
        finding: finding.finding,
        stage: finding.stage,
        notes: finding.notes,
        recordedAt: finding.recorded_at,
      })),
      treatmentPlans: treatmentPlanRows.map((plan) => ({
        id: plan.id,
        title: plan.title,
        status: plan.status,
        createdAt: plan.created_at,
        items: (plan.treatment_plan_items ?? []).map((item) => ({
          id: item.id,
          treatmentName: item.treatment_name,
          toothNumbers: item.tooth_numbers,
          status: item.status,
          priority: item.priority,
          estimatedCost: item.estimated_cost,
          createdAt: item.created_at,
        })),
      })),
      procedures: procedureRows.map((procedure) => ({
        id: procedure.id,
        visitId: procedure.visit_id,
        treatmentPlanItemId: procedure.treatment_plan_item_id,
        procedureName: procedure.procedure_name,
        toothNumbers: procedure.tooth_numbers,
        procedureDetails: procedure.procedure_details,
        clinicalOutcome: procedure.clinical_outcome,
        performedAt: procedure.performed_at,
      })),
      prescriptions: prescriptionRows.map((prescription) => ({
        id: prescription.id,
        visitId: prescription.visit_id,
        medicationName: prescription.medication_name,
        strength: prescription.strength,
        dosage: prescription.dosage,
        route: prescription.route,
        frequency: prescription.frequency,
        duration: prescription.duration,
        quantity: prescription.quantity,
        instructions: prescription.instructions,
        prescribedAt: prescription.prescribed_at,
      })),
      consents: consentRows.map((consent) => ({
        id: consent.id,
        visitId: consent.visit_id,
        status: consent.status,
        method: consent.method,
        notes: consent.notes,
        recordedAt: consent.recorded_at,
      })),
      attachments: attachmentRows.map((attachment) => ({
        id: attachment.id,
        category: attachment.category,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
        fileSize: attachment.file_size,
        description: attachment.description,
        visitId: attachment.visit_id,
        toothNumber: attachment.tooth_number,
        createdAt: attachment.created_at,
      })),
      clinicalRecords: clinicalRecordRows.map((record) => ({
        id: record.id,
        branchId: record.branch_id,
        title: record.title,
        diagnosis: record.diagnosis,
        status: record.status,
        reviewComment: record.review_comment,
        canSubmit: record.submitted_by === account.id && ['draft', 'returned'].includes(record.status),
        createdAt: record.created_at,
      })),
      canReviewClinicalRecords: [
        'Organization Administrator',
        'Central Clinical Supervisor',
        'Branch Supervisor',
      ].includes(account.role ?? ''),
      canReviewEscalatedClinicalRecords: [
        'Organization Administrator',
        'Central Clinical Supervisor',
      ].includes(account.role ?? ''),
    },
  }
}

export async function createClinicalEncounter(
  input: ClinicalEncounterInput
): Promise<MutationResult<string>> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.patientId || !input.branchId || !input.visitType.trim()) {
    return { ok: false, error: 'Choose a patient, branch, visit type, and clinical case type.' }
  }
  if (![
    'general_dentistry', 'orthodontic', 'endodontic', 'periodontal',
    'oral_surgery', 'restorative', 'prosthodontic',
  ].includes(input.caseType)) return { ok: false, error: 'Choose a valid clinical case type.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('create_clinical_encounter_phase2d', {
    p_patient_id: input.patientId,
    p_branch_id: input.branchId,
    p_visit_type: input.visitType.trim(),
    p_reason: input.reason.trim(),
    p_chief_complaint: input.chiefComplaint.trim(),
    p_history_reviewed: input.historyReviewed,
    p_exam: {
      history_of_present_illness: input.exam.historyOfPresentIllness,
      extraoral_examination: input.exam.extraoralExamination,
      intraoral_examination: input.exam.intraoralExamination,
      tooth_examination: input.exam.toothExamination,
      periodontal_examination: input.exam.periodontalExamination,
      soft_tissue_examination: input.exam.softTissueExamination,
      radiographic_findings: input.exam.radiographicFindings,
      other_observations: input.exam.otherObservations,
    },
    p_vitals: Object.fromEntries(
      Object.entries({
        blood_pressure_systolic: input.vitals.bloodPressureSystolic,
        blood_pressure_diastolic: input.vitals.bloodPressureDiastolic,
        pulse_bpm: input.vitals.pulseBpm,
        temperature_c: input.vitals.temperatureC,
        respiratory_rate: input.vitals.respiratoryRate,
        oxygen_saturation: input.vitals.oxygenSaturation,
        blood_glucose: input.vitals.bloodGlucose,
        weight_kg: input.vitals.weightKg,
        height_cm: input.vitals.heightCm,
        notes: input.vitals.notes,
        source: input.vitals.source,
      }).filter(([, value]) => value.trim() !== '')
    ),
    p_follow_up: input.followUp.trim(),
    p_case_type: input.caseType,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true, value: data }
}

export async function updateClinicalVisitCaseType(
  visitId: string,
  caseType: string
): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('update_clinical_visit_case_type', {
    target_visit_id: visitId,
    input_case_type: caseType,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function addPatientHistoryEntry(input: {
  patientId: string
  category: 'general_medical' | 'dental'
  entryType: string
  details: string
  source: string
  verified: boolean
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.patientId || !input.entryType.trim() || !input.details.trim()) {
    return { ok: false, error: 'Enter a history category, entry type, and details.' }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('patient_history_entries').insert({
    organization_id: account.clinicId,
    patient_id: input.patientId,
    category: input.category,
    entry_type: input.entryType.trim(),
    details: input.details.trim(),
    source: input.source.trim() || 'patient_reported',
    verification_status: input.verified ? 'verified' : 'unverified',
    recorded_by: account.id,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  const auditError = await writeAuditEvent(account, 'patient.history.add', 'patient_history_entry', data.id)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function updateClinicPatientProfile(input: {
  patientId: string
  fullName: string
  dateOfBirth: string
  sex: string
  phone: string
  email: string
  nationalId: string
  address: string
  emergencyContactName: string
  emergencyContactPhone: string
  emergencyContactRelationship: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  const fullName = input.fullName.trim()
  const email = input.email.trim().toLowerCase()
  if (!input.patientId || !fullName || fullName.length > 120 || (email && !validEmail(email))) {
    return { ok: false, error: 'Enter a patient name and a valid email address.' }
  }
  const sexValue = input.sex.trim()
  let sex: Patient['sex']
  if (!sexValue) sex = undefined
  else if (sexValue === 'female' || sexValue === 'male' || sexValue === 'other' || sexValue === 'not_specified') sex = sexValue
  else return { ok: false, error: 'Choose a valid gender option.' }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('patients').update({
    full_name: fullName,
    date_of_birth: input.dateOfBirth || null,
    sex: sex ?? null,
    phone: input.phone.trim() || null,
    email: email || null,
    national_id: input.nationalId.trim() || null,
    address: input.address.trim() || null,
    emergency_contact_name: input.emergencyContactName.trim() || null,
    emergency_contact_phone: input.emergencyContactPhone.trim() || null,
    emergency_contact_relationship: input.emergencyContactRelationship.trim() || null,
    updated_at: new Date().toISOString(),
  }).eq('id', input.patientId).eq('organization_id', account.clinicId)
    .select('id, registered_branch_id').maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Patient not found or your role cannot update this profile.' }
  const auditError = await writeAuditEvent(account, 'patient.profile.update', 'patient', data.id, data.registered_branch_id)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function addVisitDiagnosis(input: {
  visitId: string
  catalogEntryId: string
  name: string
  code: string
  codeSystem: string
  category: string
  description: string
  location: string
  toothNumbers: string[]
  toothSurface: string
  severity: string
  findings: string
  clinicalNotes: string
  certainty: string
  priority: string
  reasoning: string
  conflictingFindings: string
  requiredInvestigations: string
  priorityReason: string
  caseType: string
  overrideReason: string
  proposeForCatalog: boolean
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.visitId || !input.name.trim()) return { ok: false, error: 'Choose a visit and enter a diagnosis.' }
  if (![
    'general_dentistry', 'orthodontic', 'endodontic', 'periodontal',
    'oral_surgery', 'restorative', 'prosthodontic',
  ].includes(input.caseType)) return { ok: false, error: 'Choose a valid clinical case type.' }
  if (input.overrideReason.trim().length > 1000) {
    return { ok: false, error: 'Clinical justification must be 1,000 characters or fewer.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('record_visit_diagnosis_phase2d', {
    target_visit_id: input.visitId,
    target_catalog_entry_id: input.catalogEntryId || null,
    input_diagnosis_name: input.name.trim(),
    input_diagnosis_code: input.code.trim() || null,
    input_code_system: input.codeSystem.trim() || null,
    input_category: input.category,
    input_description: input.description.trim() || null,
    input_anatomical_location: input.location.trim() || null,
    input_tooth_numbers: input.toothNumbers,
    input_tooth_surface: input.toothSurface,
    input_severity: input.severity,
    input_supporting_findings: input.findings.trim() || null,
    input_clinical_notes: input.clinicalNotes.trim() || null,
    input_certainty: input.certainty,
    input_priority: input.priority,
    input_diagnostic_reasoning: input.reasoning.trim(),
    input_conflicting_findings: input.conflictingFindings.trim() || null,
    input_required_investigations: input.requiredInvestigations.trim() || null,
    input_priority_reason: input.priorityReason.trim() || null,
    input_case_type: input.caseType,
    input_override_reason: input.overrideReason.trim() || null,
    input_propose_for_catalog: input.proposeForCatalog,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function updateVisitDiagnosisState(input: {
  diagnosisId: string
  status: string
  certainty: string
  priority: string
  reason: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.diagnosisId || !input.reason.trim()) {
    return { ok: false, error: 'Choose a diagnosis and document the reason for the change.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('update_visit_diagnosis_state', {
    target_diagnosis_id: input.diagnosisId,
    input_status: input.status,
    input_certainty: input.certainty,
    input_priority: input.priority,
    input_reason: input.reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function recordDiagnosisReassessment(input: {
  diagnosisId: string
  visitId: string
  status: string
  certainty: string
  priority: string
  severity: string
  progression: string
  reason: string
  supportingFindings: string
  conflictingFindings: string
  requiredInvestigations: string
  priorityReason: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.diagnosisId || !input.visitId || !input.reason.trim()) {
    return { ok: false, error: 'Choose a diagnosis and visit, then document the reassessment.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('record_diagnosis_reassessment', {
    target_diagnosis_id: input.diagnosisId,
    target_visit_id: input.visitId,
    input_status: input.status,
    input_certainty: input.certainty,
    input_priority: input.priority,
    input_severity: input.severity || null,
    input_progression: input.progression,
    input_assessment_reason: input.reason.trim(),
    input_supporting_findings: input.supportingFindings.trim() || null,
    input_conflicting_findings: input.conflictingFindings.trim() || null,
    input_required_investigations: input.requiredInvestigations.trim() || null,
    input_priority_reason: input.priorityReason.trim() || null,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function recordClinicalOutcome(input: {
  diagnosisId: string
  visitId: string
  assessmentId: string
  procedureId: string
  outcome: string
  clinicalFindings: string
  complications: string
  furtherTreatmentRequired: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.diagnosisId || !input.visitId || !input.clinicalFindings.trim()) {
    return { ok: false, error: 'Choose a diagnosis and visit, and record the clinical findings.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('record_clinical_outcome', {
    target_diagnosis_id: input.diagnosisId,
    target_visit_id: input.visitId,
    target_assessment_id: input.assessmentId || null,
    target_procedure_id: input.procedureId || null,
    input_outcome: input.outcome,
    input_clinical_findings: input.clinicalFindings.trim(),
    input_complications: input.complications.trim() || null,
    input_further_treatment_required: input.furtherTreatmentRequired.trim() || null,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function getOpenClinicalSafetyAlerts(): Promise<MutationResult<ClinicalSafetyAlertSummary[]>> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  const supabase = await createSupabaseServerClient()
  const { data: alerts, error } = await supabase
    .from('clinical_safety_alerts')
    .select('id, patient_id, title, criticality, status, created_at')
    .eq('organization_id', account.clinicId)
    .in('status', ['open', 'escalated'])
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) return { ok: false, error: `Could not load open clinical alerts: ${error.message}` }
  const patientIds = [...new Set((alerts ?? []).map((alert) => alert.patient_id))]
  const { data: patients, error: patientsError } = patientIds.length
    ? await supabase.from('patients').select('id, full_name').in('id', patientIds)
    : { data: [], error: null }
  if (patientsError) return { ok: false, error: `Could not load clinical alert patient names: ${patientsError.message}` }
  const patientNames = new Map((patients ?? []).map((patient) => [patient.id, patient.full_name]))
  return {
    ok: true,
    value: (alerts ?? []).map((alert) => ({
      id: alert.id,
      patientId: alert.patient_id,
      patientName: patientNames.get(alert.patient_id) ?? 'Patient record',
      title: alert.title,
      criticality: alert.criticality,
      status: alert.status,
      createdAt: alert.created_at,
    })),
  }
}

export async function createClinicalSafetyAlert(input: {
  patientId: string
  visitId: string
  diagnosisId: string
  title: string
  description: string
  criticality: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.patientId || !input.visitId || !input.title.trim() || !input.description.trim()) {
    return { ok: false, error: 'Choose a visit and document the finding that needs attention.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('create_clinical_safety_alert', {
    target_patient_id: input.patientId,
    target_visit_id: input.visitId,
    target_diagnosis_id: input.diagnosisId || null,
    input_title: input.title.trim(),
    input_description: input.description.trim(),
    input_criticality: input.criticality,
    target_responsible_user_id: account.id,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function acknowledgeClinicalSafetyAlert(
  alertId: string,
  actionTaken: string
): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!alertId || !actionTaken.trim()) {
    return { ok: false, error: 'Document the action taken before acknowledging the alert.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('acknowledge_clinical_safety_alert', {
    target_alert_id: alertId,
    input_action_taken: actionTaken.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function escalateClinicalSafetyAlert(
  alertId: string,
  targetRole: string,
  reason: string
): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!alertId || !reason.trim()) return { ok: false, error: 'Document why this alert is being escalated.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('escalate_clinical_safety_alert', {
    target_alert_id: alertId,
    input_target_role: targetRole,
    input_reason: reason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function resolveClinicalSafetyAlert(
  alertId: string,
  resolutionReason: string
): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!alertId || !resolutionReason.trim()) {
    return { ok: false, error: 'Document why the safety alert can be resolved.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('resolve_clinical_safety_alert', {
    target_alert_id: alertId,
    input_resolution_reason: resolutionReason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function configureClinicalSafetyAlertRule(input: {
  criticality: string
  escalationAfterMinutes: number | null
  escalationRole: string
  changeReason: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.changeReason.trim()) return { ok: false, error: 'Record the reason for changing alert escalation settings.' }
  if (input.escalationAfterMinutes !== null
    && (!Number.isInteger(input.escalationAfterMinutes)
      || input.escalationAfterMinutes < 1
      || input.escalationAfterMinutes > 10080)) {
    return { ok: false, error: 'Escalation interval must be between 1 minute and 7 days, or left blank for manual escalation.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('configure_clinical_safety_alert_rule', {
    target_organization_id: account.clinicId,
    input_criticality: input.criticality,
    input_escalation_after_minutes: input.escalationAfterMinutes,
    input_escalation_role: input.escalationRole,
    input_change_reason: input.changeReason.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function searchDiagnosisCatalog(
  query: string,
  category = 'all'
): Promise<MutationResult<DiagnosisCatalogEntry[]>> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  const term = query.trim()
  if (term.length < 2) return { ok: true, value: [] }
  if (term.length > 100) return { ok: false, error: 'Search text must be 100 characters or fewer.' }
  const validCategories = [
    'all', 'general_medical', 'dental', 'periodontal', 'oral_surgery',
    'restorative', 'endodontic', 'orthodontic', 'prosthodontic', 'other',
  ]
  if (!validCategories.includes(category)) return { ok: false, error: 'Choose a valid diagnosis category for search.' }

  const escapedTerm = term.replace(/[\\%_]/g, '\\$&')
  const pattern = `%${escapedTerm}%`
  const supabase = await createSupabaseServerClient()
  let nameQuery = supabase.from('diagnosis_catalog')
      .select('id, diagnosis_name, diagnosis_code, code_system, category, description, anatomical_area, requires_tooth')
      .eq('organization_id', account.clinicId)
      .eq('is_active', true)
      .ilike('diagnosis_name', pattern)
      .order('diagnosis_name')
      .limit(20)
  let codeQuery = supabase.from('diagnosis_catalog')
      .select('id, diagnosis_name, diagnosis_code, code_system, category, description, anatomical_area, requires_tooth')
      .eq('organization_id', account.clinicId)
      .eq('is_active', true)
      .ilike('diagnosis_code', pattern)
      .order('diagnosis_code')
      .limit(20)
  if (category !== 'all') {
    nameQuery = nameQuery.eq('category', category)
    codeQuery = codeQuery.eq('category', category)
  }
  const [nameResult, codeResult] = await Promise.all([nameQuery, codeQuery])
  if (nameResult.error || codeResult.error) {
    return { ok: false, error: `Could not search diagnosis catalog: ${(nameResult.error ?? codeResult.error)?.message}` }
  }
  const entries = new Map<string, DiagnosisCatalogEntry>()
  for (const row of [...(nameResult.data ?? []), ...(codeResult.data ?? [])]) {
    entries.set(row.id, {
      id: row.id,
      diagnosisName: row.diagnosis_name,
      diagnosisCode: row.diagnosis_code,
      codeSystem: row.code_system,
      category: row.category,
      description: row.description,
      anatomicalArea: row.anatomical_area,
      requiresTooth: row.requires_tooth,
    })
  }
  return { ok: true, value: [...entries.values()].slice(0, 25) }
}

export async function addDiagnosisCatalogEntry(input: {
  name: string
  code: string
  codeSystem: string
  category: string
  description: string
  anatomicalArea: string
  requiresTooth: boolean
}): Promise<MutationResult<DiagnosisCatalogEntry>> {
  const account = await clinicAccount(true)
  if (!account) return { ok: false, error: 'Only a clinic administrator can add diagnosis catalog entries.' }
  if (!input.name.trim() || input.name.trim().length > 200) {
    return { ok: false, error: 'Enter a diagnosis name up to 200 characters.' }
  }
  const categories = [
    'general_medical', 'dental', 'periodontal', 'oral_surgery',
    'restorative', 'endodontic', 'orthodontic', 'prosthodontic', 'other',
  ]
  if (!categories.includes(input.category)) {
    return { ok: false, error: 'Choose a valid diagnosis category.' }
  }
  if (input.code.trim().length > 50 || input.codeSystem.trim().length > 40) {
    return { ok: false, error: 'Diagnosis codes are limited to 50 characters and code systems to 40.' }
  }
  if (input.description.trim().length > 1500 || input.anatomicalArea.trim().length > 200) {
    return { ok: false, error: 'The description or anatomical area is too long.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('diagnosis_catalog').insert({
    organization_id: account.clinicId,
    diagnosis_name: input.name.trim(),
    diagnosis_code: input.code.trim() || null,
    code_system: input.codeSystem.trim() || null,
    category: input.category,
    description: input.description.trim() || null,
    anatomical_area: input.anatomicalArea.trim() || null,
    requires_tooth: input.requiresTooth,
    created_by: account.id,
  }).select('id, diagnosis_name, diagnosis_code, code_system, category, description, anatomical_area, requires_tooth').single()
  if (error) return { ok: false, error: error.message }

  revalidatePath('/')
  return {
    ok: true,
    value: {
      id: data.id,
      diagnosisName: data.diagnosis_name,
      diagnosisCode: data.diagnosis_code,
      codeSystem: data.code_system,
      category: data.category,
      description: data.description,
      anatomicalArea: data.anatomical_area,
      requiresTooth: data.requires_tooth,
    },
  }
}

export async function reviewDiagnosisCatalogProposal(input: {
  proposalId: string
  decision: 'approved' | 'rejected' | 'clarification_requested' | 'merged'
  notes: string
  diagnosisName: string
  diagnosisCode: string
  codeSystem: string
  category: string
  catalogEntryId: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account || !['organization_administrator', 'central_clinical_supervisor'].includes(account.role ?? '')) {
    return { ok: false, error: 'Only authorized clinical leadership can review catalog proposals.' }
  }
  if (!input.proposalId || !input.notes.trim()) {
    return { ok: false, error: 'Choose a proposal and document the review decision.' }
  }
  if (!['approved', 'rejected', 'clarification_requested', 'merged'].includes(input.decision)) {
    return { ok: false, error: 'Choose a valid catalog proposal decision.' }
  }
  if (
    input.notes.trim().length > 2000
    || input.diagnosisName.trim().length > 200
    || input.diagnosisCode.trim().length > 50
    || input.codeSystem.trim().length > 40
    || ![
      'general_medical', 'dental', 'periodontal', 'oral_surgery',
      'restorative', 'endodontic', 'orthodontic', 'prosthodontic', 'other',
    ].includes(input.category)
  ) {
    return { ok: false, error: 'Check the review notes and proposed diagnosis details.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('review_diagnosis_catalog_proposal', {
    target_proposal_id: input.proposalId,
    input_decision: input.decision,
    input_reviewer_notes: input.notes.trim(),
    input_diagnosis_name: input.diagnosisName.trim() || null,
    input_diagnosis_code: input.diagnosisCode.trim() || null,
    input_code_system: input.codeSystem.trim() || null,
    input_category: input.category || null,
    input_catalog_entry_id: input.catalogEntryId || null,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}

export async function addOdontogramFinding(input: {
  patientId: string
  visitId: string
  performedProcedureId: string
  toothNumber: string
  surface: string
  finding: string
  stage: string
  notes: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.patientId || !/^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/.test(input.toothNumber)) {
    return { ok: false, error: 'Choose a valid FDI tooth number.' }
  }
  if (input.stage === 'completed' && !input.performedProcedureId) {
    return { ok: false, error: 'Link a completed finding to its actual performed procedure.' }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('odontogram_findings').insert({
    organization_id: account.clinicId,
    patient_id: input.patientId,
    visit_id: input.visitId || null,
    performed_procedure_id: input.performedProcedureId || null,
    tooth_number: input.toothNumber,
    tooth_surface: input.surface,
    finding: input.finding.trim(),
    stage: input.stage,
    notes: input.notes.trim() || null,
    recorded_by: account.id,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  const auditError = await writeAuditEvent(account, 'odontogram.finding.add', 'odontogram_finding', data.id)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function createClinicPrescription(input: {
  patientId: string
  visitId: string
  medicationName: string
  strength: string
  dosage: string
  route: string
  frequency: string
  duration: string
  quantity: string
  instructions: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.patientId || !input.medicationName.trim() || !input.dosage.trim() || !input.route.trim() || !input.frequency.trim()) {
    return { ok: false, error: 'Complete the patient, medication, dosage, route, and frequency fields.' }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('prescriptions').insert({
    organization_id: account.clinicId,
    patient_id: input.patientId,
    visit_id: input.visitId || null,
    medication_name: input.medicationName.trim(),
    strength: input.strength.trim() || null,
    dosage: input.dosage.trim(),
    route: input.route.trim(),
    frequency: input.frequency.trim(),
    duration: input.duration.trim() || null,
    quantity: input.quantity.trim() || null,
    instructions: input.instructions.trim() || null,
    prescribed_by: account.id,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  const auditError = await writeAuditEvent(account, 'prescription.create', 'prescription', data.id)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function recordPatientConsent(input: {
  patientId: string
  visitId: string
  treatmentPlanItemId: string
  status: 'given' | 'refused' | 'withdrawn'
  method: string
  notes: string
  attachmentId: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.patientId || !input.method.trim()) return { ok: false, error: 'Choose a patient and record how consent was discussed.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('patient_consents').insert({
    organization_id: account.clinicId,
    patient_id: input.patientId,
    visit_id: input.visitId || null,
    treatment_plan_item_id: input.treatmentPlanItemId || null,
    status: input.status,
    method: input.method.trim(),
    notes: input.notes.trim() || null,
    document_attachment_id: input.attachmentId || null,
    recorded_by: account.id,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  const auditError = await writeAuditEvent(account, `patient.consent.${input.status}`, 'patient_consent', data.id)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function uploadClinicalAttachment(formData: FormData): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0 || file.size > 20 * 1024 * 1024) {
    return { ok: false, error: 'Choose a file smaller than 20 MB.' }
  }
  const extensionByMimeType: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/dicom': 'dcm',
  }
  const extension = extensionByMimeType[file.type]
  if (!extension) return { ok: false, error: 'Use a PDF, JPEG, PNG, WebP, or DICOM file.' }

  const patientId = String(formData.get('patientId') ?? '')
  const branchId = String(formData.get('branchId') ?? '')
  const visitId = String(formData.get('visitId') ?? '')
  const category = String(formData.get('category') ?? 'other')
  const toothNumber = String(formData.get('toothNumber') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim()
  const allowedCategories = [
    'dental_xray', 'panoramic_radiograph', 'intraoral_photo', 'clinical_photo',
    'laboratory_report', 'referral', 'consent', 'treatment_document', 'other',
  ]
  if (!patientId || !branchId || !allowedCategories.includes(category)) {
    return { ok: false, error: 'Choose a patient, branch, and valid document category.' }
  }
  if (toothNumber && !/^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$/.test(toothNumber)) {
    return { ok: false, error: 'Enter a valid FDI tooth number or leave the tooth field blank.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data: patient, error: patientError } = await supabase.from('patients')
    .select('id, registered_branch_id')
    .eq('organization_id', account.clinicId)
    .eq('id', patientId)
    .maybeSingle()
  if (patientError) return { ok: false, error: patientError.message }
  if (!patient || patient.registered_branch_id !== branchId) {
    return { ok: false, error: 'Patient or branch is not accessible.' }
  }
  if (visitId) {
    const { data: visit, error: visitError } = await supabase.from('patient_visits')
      .select('id')
      .eq('id', visitId)
      .eq('patient_id', patientId)
      .eq('branch_id', branchId)
      .maybeSingle()
    if (visitError) return { ok: false, error: visitError.message }
    if (!visit) return { ok: false, error: 'Choose a visit belonging to this patient and branch.' }
  }

  const path = `${account.clinicId}/${branchId}/${patientId}/${randomUUID()}.${extension}`
  const { error: uploadError } = await supabase.storage
    .from('clinical-documents')
    .upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) return { ok: false, error: `File upload failed: ${uploadError.message}` }

  const { data: attachment, error: metadataError } = await supabase.from('patient_attachments').insert({
    organization_id: account.clinicId,
    patient_id: patientId,
    visit_id: visitId || null,
    storage_bucket: 'clinical-documents',
    storage_path: path,
    file_name: file.name.slice(0, 255),
    mime_type: file.type,
    file_size: file.size,
    category,
    description: description || null,
    tooth_number: toothNumber || null,
    uploaded_by: account.id,
  }).select('id').single()
  if (metadataError) {
    const admin = createSupabaseAdminClient()
    const { error: cleanupError } = await admin.storage.from('clinical-documents').remove([path])
    return {
      ok: false,
      error: cleanupError
        ? `File metadata could not be saved (${metadataError.message}), and upload cleanup failed (${cleanupError.message}). Contact support.`
        : `File metadata could not be saved; the uploaded file was removed: ${metadataError.message}`,
    }
  }
  const auditError = await writeAuditEvent(account, 'patient.attachment.upload', 'patient_attachment', attachment.id, branchId)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function getClinicalAttachmentUrl(
  attachmentId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  const supabase = await createSupabaseServerClient()
  const { data: attachment, error: attachmentError } = await supabase.from('patient_attachments')
    .select('storage_bucket, storage_path, patient_id')
    .eq('id', attachmentId)
    .eq('organization_id', account.clinicId)
    .maybeSingle()
  if (attachmentError) return { ok: false, error: attachmentError.message }
  if (!attachment) return { ok: false, error: 'Document not found or you do not have access to it.' }
  const { data: patient, error: patientError } = await supabase.from('patients')
    .select('registered_branch_id')
    .eq('id', attachment.patient_id)
    .eq('organization_id', account.clinicId)
    .maybeSingle()
  if (patientError) return { ok: false, error: patientError.message }
  if (!patient) return { ok: false, error: 'Patient not found or you do not have access to this document.' }
  const { error: accessError } = await supabase.from('patient_access_events').insert({
    organization_id: account.clinicId,
    branch_id: patient.registered_branch_id,
    patient_id: attachment.patient_id,
    actor_id: account.id,
    access_reason: 'clinical_document_download',
  })
  if (accessError) return { ok: false, error: `Could not record document access: ${accessError.message}` }
  const { data, error } = await supabase.storage
    .from(attachment.storage_bucket)
    .createSignedUrl(attachment.storage_path, 300)
  if (error) return { ok: false, error: error.message }
  return { ok: true, url: data.signedUrl }
}

export async function createClinicTreatmentPlan(input: {
  patientId: string
  branchId: string
  visitId: string
  title: string
  treatmentName: string
  toothNumbers: string[]
  description: string
  clinicalReason: string
  estimatedCost: string
  estimatedDurationMinutes: string
  priority: string
}): Promise<MutationResult<string>> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.patientId || !input.branchId || !input.title.trim() || !input.treatmentName.trim()) {
    return { ok: false, error: 'Complete the plan title and treatment name.' }
  }
  const cost = input.estimatedCost.trim() ? Number(input.estimatedCost) : null
  const duration = input.estimatedDurationMinutes.trim() ? Number(input.estimatedDurationMinutes) : null
  if ((cost !== null && (!Number.isFinite(cost) || cost < 0))
    || (duration !== null && (!Number.isInteger(duration) || duration <= 0))) {
    return { ok: false, error: 'Enter a valid non-negative cost and positive duration.' }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('create_treatment_plan_with_item', {
    p_patient_id: input.patientId,
    p_branch_id: input.branchId,
    p_visit_id: input.visitId || null,
    p_title: input.title.trim(),
    p_treatment_name: input.treatmentName.trim(),
    p_tooth_numbers: input.toothNumbers,
    p_description: input.description.trim(),
    p_clinical_reason: input.clinicalReason.trim(),
    p_estimated_cost: cost,
    p_estimated_duration_minutes: duration,
    p_priority: input.priority,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true, value: data }
}

export async function updateTreatmentPlanItemStatus(
  itemId: string,
  status: 'awaiting_authorization' | 'approved' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'discontinued'
): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!itemId) return { ok: false, error: 'Choose a treatment item.' }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('treatment_plan_items')
    .update({
      status,
      ...(status === 'approved' ? { approved_by: account.id, approved_at: new Date().toISOString() } : {}),
    })
    .eq('id', itemId)
    .eq('organization_id', account.clinicId)
    .select('id, plan_id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Treatment item not found or you are not allowed to change it.' }
  const { data: plan, error: planError } = await supabase.from('treatment_plans')
    .select('branch_id')
    .eq('id', data.plan_id)
    .eq('organization_id', account.clinicId)
    .single()
  if (planError) return { ok: false, error: `Treatment status changed, but its branch could not be loaded: ${planError.message}` }
  if (status !== 'approved') {
    const auditError = await writeAuditEvent(
      account, `treatment_plan_item.${status}`, 'treatment_plan_item', data.id, plan.branch_id, { status }
    )
    if (auditError) return { ok: false, error: auditError }
  }
  revalidatePath('/')
  return { ok: true }
}

export async function recordPerformedProcedure(input: {
  patientId: string
  branchId: string
  visitId: string
  treatmentPlanItemId: string
  procedureName: string
  toothNumbers: string[]
  details: string
  clinicalOutcome: string
}): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!input.patientId || !input.branchId || !input.procedureName.trim() || !input.details.trim()) {
    return { ok: false, error: 'Enter the procedure, patient, branch, and procedure details.' }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('performed_procedures').insert({
    organization_id: account.clinicId,
    branch_id: input.branchId,
    patient_id: input.patientId,
    visit_id: input.visitId || null,
    treatment_plan_item_id: input.treatmentPlanItemId || null,
    procedure_name: input.procedureName.trim(),
    tooth_numbers: input.toothNumbers,
    procedure_details: input.details.trim(),
    clinical_outcome: input.clinicalOutcome.trim() || null,
    performed_by: account.id,
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  const auditError = await writeAuditEvent(account, 'procedure.performed', 'performed_procedure', data.id, input.branchId)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function submitClinicalRecord(
  recordId: string,
  correctionReason = '',
  correctedRecord?: { title: string; diagnosis: string }
): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!recordId) return { ok: false, error: 'Choose a clinical record to submit.' }
  if (correctedRecord && (!correctedRecord.title.trim() || !correctedRecord.diagnosis.trim())) {
    return { ok: false, error: 'Enter the corrected record title and clinical notes.' }
  }
  if (correctionReason.trim().length > 1000) {
    return { ok: false, error: 'Keep the correction reason under 1,000 characters.' }
  }
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.from('clinical_records')
    .update({
      status: 'submitted',
      correction_reason: correctionReason.trim() || null,
      ...(correctedRecord ? {
        title: correctedRecord.title.trim(),
        diagnosis: correctedRecord.diagnosis.trim(),
      } : {}),
    })
    .eq('id', recordId)
    .eq('organization_id', account.clinicId)
    .eq('submitted_by', account.id)
    .in('status', ['draft', 'returned'])
    .select('id, branch_id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Record is not an editable draft or returned record.' }
  const auditError = await writeAuditEvent(account, 'clinical_record.submit', 'clinical_record', data.id, data.branch_id)
  if (auditError) return { ok: false, error: auditError }
  revalidatePath('/')
  return { ok: true }
}

export async function reviewClinicalRecord(
  recordId: string,
  decision: 'approved' | 'returned' | 'escalated',
  comment: string
): Promise<ActionResult> {
  const account = await clinicAccount()
  if (!account) return { ok: false, error: 'Your clinic session has expired. Sign in again.' }
  if (!recordId || (decision !== 'approved' && !comment.trim())) {
    return { ok: false, error: 'Choose a record and provide a reason when returning or escalating it.' }
  }
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('review_clinical_record', {
    p_clinical_record_id: recordId,
    p_decision: decision,
    p_comment: comment.trim(),
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/')
  return { ok: true }
}
