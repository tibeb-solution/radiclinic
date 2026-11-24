# DCMS Entity Relationship Design

## Current implementation state

Supabase migrations `001`–`007` implement the active organization, patient, visit, and clinical-chart schema. This ERD also describes target entities that have not yet been implemented. Clinic chart reads and writes use Supabase with row-level security; diagnosis catalog, locations, and events are introduced by migration `005_phase2a_diagnosis_management.sql`, lifecycle fields, reassessments, and outcomes by migration `006_phase2b_diagnosis_lifecycle.sql`, and safety alerts and escalation rules by migration `007_phase2c_clinical_safety_alerts.sql`.

## Platform realm

```text
PlatformSettings
  1 -- 1 platform_settings

PlatformUser
  1 -- * PlatformSession
  1 -- * LoginEvent
  1 -- * AuditLog

SubscriptionPlan
  1 -- * Subscription

Subscription
  * -- 1 Organization
  * -- 1 SubscriptionPlan
  1 -- * SubscriptionPayment

SubscriptionPayment
  * -- 1 Subscription
  * -- 1 PlatformUser (recorded_by)
```

## Clinic and identity realm

```text
Organization
  1 -- * Branch
  1 -- * User
  1 -- * Role
  1 -- * Patient
  1 -- * Visit
  1 -- * AuditLog
  1 -- * Subscription
  1 -- * ShareGrant (originating or receiving)

Branch
  * -- 1 Organization
  1 -- * UserRoleAssignment (optional branch scope)
  1 -- * Patient (registered_branch_id)
  1 -- * PatientVisit

User
  * -- 1 Organization
  1 -- * UserRoleAssignment
  1 -- * Session
  1 -- * LoginEvent
  1 -- * Invitation

Role
  * -- 1 Organization
  1 -- * RolePermission
  1 -- * UserRoleAssignment

Permission
  1 -- * RolePermission

UserRoleAssignment
  * -- 1 User
  * -- 1 Role
  scope = organization or branch
  optional branch_id only for branch scope
```

## Patient and clinical records

```text
Patient
  * -- 1 Organization
  * -- 1 Branch (registered_branch_id)
  1 -- * PatientMedicalHistory
  1 -- * PatientVisit
  1 -- * PatientAttachment
  1 -- * Allergy
  1 -- * Medication
  1 -- * MedicalCondition
  1 -- * PreviousTreatment
  1 -- * PreviousDentalTreatment
  1 -- * DentalHistory
  1 -- * VitalObservation
  1 -- * ShareGrant

PatientMedicalHistory
  1 -- * ApprovalRequest

DiagnosisCatalog
  * -- 1 Organization
  1 -- * VisitDiagnosis (optional catalog reference)

VisitDiagnosis
  * -- 1 Organization
  * -- 1 Branch
  * -- 1 Patient
  * -- 1 PatientVisit
  1 -- * VisitDiagnosisLocation
  1 -- * VisitDiagnosisEvent
  1 -- * VisitDiagnosisAssessment
  1 -- * ClinicalOutcome
  1 -- * ClinicalSafetyAlert (patient)
  * -- * TreatmentPlanItem (planned)

PatientVisit
  1 -- * ClinicalSafetyAlert

VisitDiagnosis
  1 -- * ClinicalSafetyAlert (optional diagnosis link)

ClinicalSafetyAlert
  * -- 1 Patient
  * -- 1 PatientVisit
  * -- 0..1 VisitDiagnosis
  1 -- * ClinicalSafetyAlertEvent
  has clinician-set criticality and an append-only event history
  acknowledgment records action taken; resolution requires prior acknowledgment

ClinicalSafetyAlertRule
  * -- 1 Organization
  versions effective-dated escalation intervals and target roles
  each change requires a reason and is audited

VisitDiagnosisLocation
  * -- 1 VisitDiagnosis
  supports FDI tooth/surface locations and non-tooth anatomical areas

VisitDiagnosisAssessment
  * -- 1 VisitDiagnosis
  * -- 1 PatientVisit
  records progression, certainty, priority, severity, rationale, and findings
  append-only; each reassessment is independently auditable

ClinicalOutcome
  * -- 1 VisitDiagnosis
  * -- 1 PatientVisit
  * -- 0..1 VisitDiagnosisAssessment
  * -- 0..1 PerformedProcedure
  records a clinical outcome separately from a diagnosis or procedure

ClinicalRecordRevision (concept)
  * -- 1 Patient
  1 -- 0..1 previous revision
  author_id -> User
```

The allergy, medication, condition, treatment, dental-history, and vital tables are separate versioned tables or views over a shared revision mechanism. Each row carries `organization_id`, patient, author, reason, created timestamp, and soft-delete fields where allowed.

## Sharing and audit

```text
ConsentRecord
  1 -- * ShareRequest

ShareRequest
  * -- 1 Organization (originating)
  * -- 1 Organization (receiving)
  * -- 1 Patient
  * -- 1 ConsentRecord

ShareGrant
  * -- 1 ShareRequest
  1 -- * SharedCategory or SharedRecordId
  1 -- * ShareAccessLog

ShareAccessLog
  * -- 1 ShareGrant
  actor -> User
  actor organization -> receiving Organization

AuditLog
  actor may be PlatformUser or clinic User
  organization_id nullable for platform actions
  branch_id optional
```

## Key composite constraints

Tenant-owned child rows must validate the organization in its parent chain.

Examples:

- `branches.organization_id` references `organizations(id)`.
- `users(organization_id, id)` references `organizations(id)`, and role assignments use composite organization/user and organization/role references.
- `patients(organization_id, registered_branch_id)` must reference a branch with the same `organization_id`.
- `patient_visits(organization_id, branch_id, patient_id)` must reference a patient and branch in the same organization.
- `patient_attachments(organization_id, patient_id)` must reference a patient in the same organization.
- `share_grants(originating_org_id, receiving_org_id, patient_id)` must reference a patient owned by the originating organization.
- `audit_logs.organization_id` is required for clinic events and may be null for explicitly platform-only events.
- `visit_diagnoses(organization_id, patient_id, visit_id, branch_id)` must agree with the visit and its patient/branch.
- `visit_diagnosis_locations` validates FDI tooth numbering and supported tooth surfaces; anatomical-only diagnoses do not require a tooth.
- Diagnosis catalog selection, diagnosis creation, and diagnosis-history writes are restricted by organization, branch, and role.

Composite foreign keys are preferred to separate foreign keys whenever the child must preserve tenant consistency.

## RLS model

Tenant tables are selected by policies equivalent to:

```sql
organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid
```

Shared receiving-clinic access is an explicit exception implemented through a grant policy, never through broad organization membership. Incoming user requests use both the receiving organization context and an active `share_grants`/`shared_record_ids` check.

Audit logs allow insert and deny update/delete for the application role. Only migration or audit-administration roles may purge or archive according to retention policy.
