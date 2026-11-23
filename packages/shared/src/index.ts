export type LocalRole =
  | 'Organization Administrator'
  | 'Central Clinical Supervisor'
  | 'Branch Supervisor'
  | 'Doctor'
  | 'Nurse'
  | 'Receptionist'
  | 'Accountant'
  | 'Inventory Officer'
  | 'Laboratory Coordinator'
  | 'Platform Super Administrator'

export type OrganizationStatus = 'pending' | 'active' | 'suspended'

export interface Organization {
  id: string
  code: string
  name: string
  status: OrganizationStatus
  timezone: string
  country: string
  logoUrl?: string
  subscriptionStatus: 'trial' | 'active' | 'past_due' | 'suspended' | 'expired'
  createdAt: string
}

export interface Branch {
  id: string
  organizationId: string
  name: string
  code: string
  status: 'active' | 'inactive'
}

export interface Patient {
  id: string
  organizationId: string
  registeredBranchId: string
  patientNumber: string
  name: string
  dateOfBirth?: string
  sex?: 'female' | 'male' | 'other' | 'not_specified'
  phone?: string
  email?: string
  nationalId?: string
  address?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  emergencyContactRelationship?: string
  status: 'active' | 'inactive' | 'archived'
  createdAt: string
}

export type AppointmentStatus = 'scheduled' | 'checked-in' | 'completed' | 'cancelled'

export interface Appointment {
  id: string
  organizationId: string
  branchId: string
  patientName: string
  treatment: string
  date: string
  time: string
  status: AppointmentStatus
  createdAt: string
}

export interface ClinicalRecord {
  id: string
  organizationId: string
  branchId: string
  patientName: string
  title: string
  notes: string
  createdAt: string
}

export interface TeamMember {
  id: string
  organizationId: string
  branchId: string
  name: string
  email: string
  role: LocalRole
  status: 'active' | 'inactive'
  createdAt: string
}

export interface SupportRequest {
  id: string
  organizationId: string
  subject: string
  details: string
  status: 'open' | 'closed'
  createdAt: string
}

export interface AuditEvent {
  id: string
  organizationId?: string
  branchId?: string
  actor: string
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
  timestamp: string
}

export interface DcmsLocalData {
  version: 2
  organizations: Organization[]
  branches: Branch[]
  patients: Patient[]
  appointments: Appointment[]
  clinicalRecords: ClinicalRecord[]
  teamMembers: TeamMember[]
  supportRequests: SupportRequest[]
  auditEvents: AuditEvent[]
}
