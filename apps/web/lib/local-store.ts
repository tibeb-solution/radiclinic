import type {
  Appointment,
  AppointmentStatus,
  AuditEvent,
  Branch,
  ClinicalRecord,
  DcmsLocalData,
  Organization,
  Patient,
  SupportRequest,
  TeamMember,
} from '@dcms/shared'

export const DCMS_LOCAL_STORAGE_KEY = 'dcms:v2'
const LEGACY_LOCAL_STORAGE_KEY = 'dcms:v1'

function emptyData(): DcmsLocalData {
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${uuid}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function migrateData(value: unknown): { data: DcmsLocalData; changed: boolean } {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.organizations) ||
    !Array.isArray(value.branches) ||
    !Array.isArray(value.patients)
  ) {
    throw new Error('Local clinic data has an unsupported format. It was left unchanged.')
  }

  const patients = (value.patients as Patient[]).filter((patient) => patient.id !== 'patient-olivia')
  const appointments = Array.isArray(value.appointments) ? (value.appointments as Appointment[]) : []
  const clinicalRecords = Array.isArray(value.clinicalRecords) ? (value.clinicalRecords as ClinicalRecord[]) : []
  const teamMembers = Array.isArray(value.teamMembers) ? (value.teamMembers as TeamMember[]) : []
  const supportRequests = Array.isArray(value.supportRequests) ? (value.supportRequests as SupportRequest[]) : []
  const auditEvents = Array.isArray(value.auditEvents) ? (value.auditEvents as AuditEvent[]) : []
  const hasWillowRecords =
    patients.some((patient) => patient.organizationId === 'org-willow') ||
    appointments.some((appointment) => appointment.organizationId === 'org-willow') ||
    clinicalRecords.some((record) => record.organizationId === 'org-willow') ||
    teamMembers.some((member) => member.organizationId === 'org-willow')
  const organizations = (value.organizations as Organization[]).filter(
    (organization) => organization.id !== 'org-willow' || hasWillowRecords
  )
  const branches = (value.branches as Branch[]).filter(
    (branch) => branch.id !== 'branch-main' || hasWillowRecords
  )
  const changed =
    value.version !== 2 ||
    patients.length !== value.patients.length ||
    !Array.isArray(value.appointments) ||
    !Array.isArray(value.clinicalRecords) ||
    !Array.isArray(value.teamMembers) ||
    !Array.isArray(value.supportRequests) ||
    organizations.length !== value.organizations.length ||
    branches.length !== value.branches.length

  return {
    changed,
    data: {
      version: 2,
      organizations,
      branches,
      patients,
      appointments,
      clinicalRecords,
      teamMembers,
      supportRequests,
      auditEvents,
    },
  }
}

export function readLocalData(): DcmsLocalData {
  if (typeof window === 'undefined') return emptyData()

  const raw = window.localStorage.getItem(DCMS_LOCAL_STORAGE_KEY)
  if (!raw) {
    const legacyRaw = window.localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY)
    if (!legacyRaw) {
      const initial = emptyData()
      window.localStorage.setItem(DCMS_LOCAL_STORAGE_KEY, JSON.stringify(initial))
      return initial
    }

    let legacyValue: unknown
    try {
      legacyValue = JSON.parse(legacyRaw) as unknown
    } catch {
      throw new Error('Legacy local clinic data is invalid JSON. It was not overwritten.')
    }
    const migrated = migrateData(legacyValue)
    writeLocalData(migrated.data)
    window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY)
    return migrated.data
  }

  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw new Error('Local clinic data is invalid JSON. It was not overwritten.')
  }
  const migrated = migrateData(value)
  if (migrated.changed) writeLocalData(migrated.data)
  return migrated.data
}

export function writeLocalData(data: DcmsLocalData): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DCMS_LOCAL_STORAGE_KEY, JSON.stringify(data))
}

export function resetLocalData(): DcmsLocalData {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(DCMS_LOCAL_STORAGE_KEY)
  }
  return readLocalData()
}

export function ensureClinicWorkspace(
  organizationId: string,
  organizationName: string,
  firstBranchName: string
): DcmsLocalData {
  const data = readLocalData()
  let changed = false
  let organization = data.organizations.find((item) => item.id === organizationId)
  if (!organization) {
    organization = {
      id: organizationId,
      code: organizationName.replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase() || 'CLINIC',
      name: organizationName,
      status: 'active',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      country: 'ET',
      subscriptionStatus: 'active',
      createdAt: new Date().toISOString(),
    }
    data.organizations.push(organization)
    changed = true
  } else if (organization.name !== organizationName) {
    organization.name = organizationName
    changed = true
  }
  if (!data.branches.some((branch) => branch.organizationId === organizationId && branch.status === 'active')) {
    data.branches.push({
      id: createId('branch'),
      organizationId,
      name: firstBranchName,
      code: firstBranchName.replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase() || 'MAIN',
      status: 'active',
    })
    changed = true
  }
  const primaryBranch = data.branches.find((branch) => branch.organizationId === organizationId)
  if (primaryBranch && primaryBranch.name !== firstBranchName) {
    primaryBranch.name = firstBranchName
    primaryBranch.code = firstBranchName.replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase() || 'MAIN'
    changed = true
  }
  if (changed) writeLocalData(data)
  return data
}

function appendAudit(
  data: DcmsLocalData,
  event: Omit<AuditEvent, 'id' | 'timestamp'>
): void {
  data.auditEvents.unshift({
    ...event,
    id: createId('audit'),
    timestamp: new Date().toISOString(),
  })
}

export function listOrganizations(): Organization[] {
  return readLocalData().organizations
}

export function createOrganization(input: Omit<Organization, 'id' | 'createdAt'>): Organization {
  const data = readLocalData()
  const organization: Organization = {
    ...input,
    id: createId('org'),
    createdAt: new Date().toISOString(),
  }
  data.organizations.push(organization)
  appendAudit(data, {
    organizationId: organization.id,
    actor: 'local-demo-admin',
    action: 'organization.create',
    entityType: 'organization',
    entityId: organization.id,
    after: organization,
  })
  writeLocalData(data)
  return organization
}

export function listBranches(organizationId?: string): Branch[] {
  const branches = readLocalData().branches
  return organizationId
    ? branches.filter((branch) => branch.organizationId === organizationId)
    : branches
}

export function createBranch(input: Omit<Branch, 'id'>): Branch {
  const data = readLocalData()
  const branch: Branch = { ...input, id: createId('branch') }
  data.branches.push(branch)
  appendAudit(data, {
    organizationId: branch.organizationId,
    branchId: branch.id,
    actor: 'local-demo-admin',
    action: 'branch.create',
    entityType: 'branch',
    entityId: branch.id,
    after: branch,
  })
  writeLocalData(data)
  return branch
}

export function listPatients(organizationId?: string): Patient[] {
  const patients = readLocalData().patients
  return organizationId
    ? patients.filter((patient) => patient.organizationId === organizationId)
    : patients
}

export function createPatient(input: Omit<Patient, 'id' | 'createdAt'>): Patient {
  const data = readLocalData()
  const patient: Patient = {
    ...input,
    id: createId('patient'),
    createdAt: new Date().toISOString(),
  }
  data.patients.push(patient)
  appendAudit(data, {
    organizationId: patient.organizationId,
    branchId: patient.registeredBranchId,
    actor: 'local-demo-user',
    action: 'patient.create',
    entityType: 'patient',
    entityId: patient.id,
    after: patient,
  })
  writeLocalData(data)
  return patient
}

export function updatePatientStatus(
  organizationId: string,
  patientId: string,
  status: Patient['status']
): Patient | null {
  const data = readLocalData()
  const patient = data.patients.find(
    (item) => item.id === patientId && item.organizationId === organizationId
  )
  if (!patient) return null
  const before = { ...patient }
  patient.status = status
  appendAudit(data, {
    organizationId,
    branchId: patient.registeredBranchId,
    actor: 'local-clinic-user',
    action: 'patient.status.update',
    entityType: 'patient',
    entityId: patient.id,
    before,
    after: patient,
  })
  writeLocalData(data)
  return patient
}

export function setBranchStatus(
  organizationId: string,
  branchId: string,
  status: Branch['status']
): Branch | null {
  const data = readLocalData()
  const branch = data.branches.find(
    (item) => item.id === branchId && item.organizationId === organizationId
  )
  if (!branch) return null
  branch.status = status
  appendAudit(data, {
    organizationId,
    branchId,
    actor: 'local-clinic-user',
    action: 'branch.status.update',
    entityType: 'branch',
    entityId: branchId,
    after: branch,
  })
  writeLocalData(data)
  return branch
}

export function listAppointments(organizationId: string): Appointment[] {
  return readLocalData().appointments.filter((item) => item.organizationId === organizationId)
}

export function createAppointment(
  input: Omit<Appointment, 'id' | 'createdAt'>
): Appointment {
  const data = readLocalData()
  const appointment: Appointment = {
    ...input,
    id: createId('appointment'),
    createdAt: new Date().toISOString(),
  }
  data.appointments.push(appointment)
  appendAudit(data, {
    organizationId: appointment.organizationId,
    branchId: appointment.branchId,
    actor: 'local-clinic-user',
    action: 'appointment.create',
    entityType: 'appointment',
    entityId: appointment.id,
    after: appointment,
  })
  writeLocalData(data)
  return appointment
}

export function updateAppointmentStatus(
  organizationId: string,
  appointmentId: string,
  status: AppointmentStatus
): Appointment | null {
  const data = readLocalData()
  const appointment = data.appointments.find(
    (item) => item.id === appointmentId && item.organizationId === organizationId
  )
  if (!appointment) return null
  appointment.status = status
  appendAudit(data, {
    organizationId,
    branchId: appointment.branchId,
    actor: 'local-clinic-user',
    action: 'appointment.status.update',
    entityType: 'appointment',
    entityId: appointment.id,
    after: appointment,
  })
  writeLocalData(data)
  return appointment
}

export function listClinicalRecords(organizationId: string): ClinicalRecord[] {
  return readLocalData().clinicalRecords.filter((item) => item.organizationId === organizationId)
}

export function createClinicalRecord(
  input: Omit<ClinicalRecord, 'id' | 'createdAt'>
): ClinicalRecord {
  const data = readLocalData()
  const record: ClinicalRecord = {
    ...input,
    id: createId('clinical-record'),
    createdAt: new Date().toISOString(),
  }
  data.clinicalRecords.push(record)
  appendAudit(data, {
    organizationId: record.organizationId,
    branchId: record.branchId,
    actor: 'local-clinic-user',
    action: 'clinical-record.create',
    entityType: 'clinical-record',
    entityId: record.id,
    after: record,
  })
  writeLocalData(data)
  return record
}

export function listTeamMembers(organizationId: string): TeamMember[] {
  return readLocalData().teamMembers.filter((item) => item.organizationId === organizationId)
}

export function createTeamMember(input: Omit<TeamMember, 'id' | 'createdAt'>): TeamMember {
  const data = readLocalData()
  const member: TeamMember = {
    ...input,
    id: createId('team-member'),
    createdAt: new Date().toISOString(),
  }
  data.teamMembers.push(member)
  appendAudit(data, {
    organizationId: member.organizationId,
    branchId: member.branchId,
    actor: 'local-clinic-user',
    action: 'team-member.create',
    entityType: 'team-member',
    entityId: member.id,
    after: member,
  })
  writeLocalData(data)
  return member
}

export function updateTeamMemberStatus(
  organizationId: string,
  memberId: string,
  status: TeamMember['status']
): TeamMember | null {
  const data = readLocalData()
  const member = data.teamMembers.find(
    (item) => item.id === memberId && item.organizationId === organizationId
  )
  if (!member) return null
  member.status = status
  appendAudit(data, {
    organizationId,
    branchId: member.branchId,
    actor: 'local-clinic-user',
    action: 'team-member.status.update',
    entityType: 'team-member',
    entityId: member.id,
    after: member,
  })
  writeLocalData(data)
  return member
}

export function createSupportRequest(
  input: Omit<SupportRequest, 'id' | 'status' | 'createdAt'>
): SupportRequest {
  const data = readLocalData()
  const request: SupportRequest = {
    ...input,
    id: createId('support-request'),
    status: 'open',
    createdAt: new Date().toISOString(),
  }
  data.supportRequests.push(request)
  appendAudit(data, {
    organizationId: request.organizationId,
    actor: 'local-clinic-user',
    action: 'support-request.create',
    entityType: 'support-request',
    entityId: request.id,
    after: request,
  })
  writeLocalData(data)
  return request
}

export function listSupportRequests(organizationId: string): SupportRequest[] {
  return readLocalData().supportRequests.filter((item) => item.organizationId === organizationId)
}
