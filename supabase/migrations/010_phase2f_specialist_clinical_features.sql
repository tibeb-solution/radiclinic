alter type public.patient_status add value if not exists 'deceased';

alter table public.patients
  add column if not exists merged_into_patient_id uuid,
  add column if not exists merged_at timestamptz,
  add column if not exists deceased_at timestamptz,
  add column if not exists deceased_reason text;

alter table public.patients
  add constraint patients_merged_source_fkey
  foreign key (merged_into_patient_id, organization_id)
  references public.patients(id, organization_id) on delete set null;

create table if not exists public.specialist_feature_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  department text not null check (department in (
    'general_dentistry', 'pediatric_dentistry', 'orthodontics', 'periodontics',
    'endodontics', 'oral_surgery', 'prosthodontics', 'restorative',
    'oral_medicine', 'oral_radiology'
  )),
  enabled boolean not null default false,
  configured_by uuid references public.profiles(id),
  configured_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  unique (organization_id, department, branch_id)
);

create table if not exists public.periodontal_examinations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  tooth_identity text not null,
  source_notation text not null default 'fdi',
  examination_date date not null default current_date,
  diagnosis text,
  gingival_inflammation text,
  plaque_index text,
  calculus_assessment text,
  tooth_mobility text,
  furcation_involvement text,
  suppuration boolean not null default false,
  treatment_recommendations text,
  scaling_root_planing_status text,
  surgery_status text,
  maintenance_plan text,
  next_follow_up date,
  notes text,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  check (tooth_identity ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'),
  check (source_notation in ('fdi', 'universal', 'palmer')),
  check (scaling_root_planing_status is null or scaling_root_planing_status in ('not_required', 'planned', 'in_progress', 'completed')),
  check (surgery_status is null or surgery_status in ('not_required', 'planned', 'in_progress', 'completed'))
);

create table if not exists public.periodontal_sites (
  id uuid primary key default gen_random_uuid(),
  examination_id uuid not null references public.periodontal_examinations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  surface text not null check (surface in ('mesiobuccal', 'buccal', 'distobuccal', 'mesiolingual', 'lingual', 'distolingual')),
  pocket_depth_mm smallint,
  gingival_recession_mm smallint,
  clinical_attachment_level_mm smallint,
  bleeding_on_probing boolean not null default false,
  plaque_present boolean not null default false,
  calculus_present boolean not null default false,
  finding text,
  check (pocket_depth_mm is null or pocket_depth_mm between 0 and 30),
  check (gingival_recession_mm is null or gingival_recession_mm between 0 and 30),
  check (clinical_attachment_level_mm is null or clinical_attachment_level_mm between 0 and 30),
  unique (examination_id, surface)
);

create table if not exists public.endodontic_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  treatment_plan_id uuid,
  tooth_identity text not null,
  source_notation text not null default 'fdi',
  preoperative_diagnosis text,
  symptoms text,
  vitality_tests jsonb not null default '{}'::jsonb,
  percussion_findings text,
  palpation_findings text,
  thermal_tests jsonb not null default '{}'::jsonb,
  periapical_findings text,
  status text not null default 'active',
  permanent_restoration_status text,
  responsible_clinician_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  foreign key (treatment_plan_id, organization_id) references public.treatment_plans(id, organization_id) on delete set null,
  check (tooth_identity ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'),
  check (status in ('active', 'paused', 'postponed', 'completed', 'discontinued')),
  check (jsonb_typeof(vitality_tests) = 'object'),
  check (jsonb_typeof(thermal_tests) = 'object')
);

alter table public.endodontic_cases
  add constraint endodontic_cases_id_organization_key unique (id, organization_id);

create table if not exists public.endodontic_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null,
  visit_id uuid,
  session_date timestamptz not null default now(),
  canal_count smallint,
  canal_anatomy jsonb not null default '{}'::jsonb,
  working_lengths jsonb not null default '{}'::jsonb,
  instrumentation_details text,
  irrigation_solution text,
  intracanal_medication text,
  obturation_material text,
  obturation_technique text,
  temporary_restoration text,
  pain_follow_up text,
  status text not null default 'initial',
  clinician_id uuid not null references public.profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (case_id, organization_id) references public.endodontic_cases(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  check (canal_count is null or canal_count between 1 and 12),
  check (status in ('initial', 'subsequent', 'paused', 'postponed', 'completed', 'follow_up')),
  check (jsonb_typeof(canal_anatomy) = 'object'),
  check (jsonb_typeof(working_lengths) = 'object')
);

create table if not exists public.orthodontic_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  treatment_plan_id uuid,
  chief_complaint text,
  initial_assessment jsonb not null default '{}'::jsonb,
  diagnostic_records jsonb not null default '{}'::jsonb,
  treatment_objectives text,
  proposed_appliance text,
  appliance_type text,
  treatment_stages jsonb not null default '[]'::jsonb,
  estimated_duration text,
  extraction_requirements text,
  complications text,
  retention_plan text,
  estimated_completion_date date,
  actual_completion_date date,
  status text not null default 'active',
  responsible_clinician_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  foreign key (treatment_plan_id, organization_id) references public.treatment_plans(id, organization_id) on delete set null,
  check (status in ('active', 'paused', 'completed', 'discontinued')),
  check (jsonb_typeof(initial_assessment) = 'object'),
  check (jsonb_typeof(diagnostic_records) = 'object'),
  check (jsonb_typeof(treatment_stages) = 'array')
);

alter table public.orthodontic_cases
  add constraint orthodontic_cases_id_organization_key unique (id, organization_id);

create table if not exists public.orthodontic_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null,
  visit_id uuid,
  adjustment_date timestamptz not null default now(),
  wire_or_appliance_change text,
  progress_assessment text,
  alignment_changes text,
  appliance_status text,
  patient_compliance text,
  treatment_delay text,
  complications text,
  next_visit date,
  clinician_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (case_id, organization_id) references public.orthodontic_cases(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict
);

create table if not exists public.restorative_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  treatment_plan_id uuid,
  tooth_identity text[] not null default '{}'::text[],
  source_notation text not null default 'fdi',
  procedure_type text not null check (procedure_type in (
    'crown', 'bridge', 'veneer', 'denture', 'partial_denture', 'complete_denture',
    'implant_supported', 'inlay', 'onlay', 'other'
  )),
  clinical_indication text,
  preparation_record text,
  material_selection text,
  shade_selection text,
  impression_or_scan text,
  laboratory_request_reference text,
  temporary_restoration text,
  trial_fitting text,
  final_fitting text,
  adjustments text,
  clinical_outcome text,
  follow_up_instructions text,
  status text not null default 'planned',
  responsible_clinician_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  foreign key (treatment_plan_id, organization_id) references public.treatment_plans(id, organization_id) on delete set null,
  check (status in ('planned', 'preparation', 'trial', 'final', 'adjustment', 'completed', 'discontinued'))
);

alter table public.restorative_cases
  add constraint restorative_cases_id_organization_key unique (id, organization_id);

create table if not exists public.restorative_case_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null,
  visit_id uuid,
  stage_type text not null,
  stage_date timestamptz not null default now(),
  details text,
  clinician_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (case_id, organization_id) references public.restorative_cases(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict
);

create table if not exists public.diagnostic_investigations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  tooth_identity text,
  diagnosis_id uuid,
  investigation_type text not null,
  clinical_reason text,
  requesting_doctor_id uuid not null references public.profiles(id),
  performing_provider text,
  request_date timestamptz not null default now(),
  scheduled_at timestamptz,
  completion_date timestamptz,
  result_or_report text,
  reviewing_doctor_id uuid references public.profiles(id),
  review_status text not null default 'awaiting_review',
  status text not null default 'requested',
  dicom_study_uid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  foreign key (diagnosis_id, organization_id) references public.visit_diagnoses(id, organization_id) on delete restrict,
  check (status in ('requested', 'scheduled', 'completed', 'result_received', 'awaiting_review', 'reviewed', 'cancelled')),
  check (review_status in ('awaiting_review', 'in_review', 'reviewed', 'amended'))
);

alter table public.diagnostic_investigations
  add constraint diagnostic_investigations_id_organization_key unique (id, organization_id);

create table if not exists public.investigation_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  investigation_id uuid not null,
  attachment_id uuid not null,
  original boolean not null default true,
  annotation_of uuid references public.investigation_images(id) on delete restrict,
  dicom_series_uid text,
  thumbnail_attachment_id uuid,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (investigation_id, organization_id) references public.diagnostic_investigations(id, organization_id) on delete cascade,
  foreign key (attachment_id, organization_id) references public.patient_attachments(id, organization_id) on delete restrict,
  foreign key (thumbnail_attachment_id, organization_id) references public.patient_attachments(id, organization_id) on delete set null
);

create table if not exists public.clinical_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  performed_procedure_id uuid,
  incident_type text not null check (incident_type in (
    'medical_emergency', 'allergic_reaction', 'syncope', 'unexpected_bleeding',
    'medication_reaction', 'anesthesia_complication', 'procedural_complication', 'other'
  )),
  incident_at timestamptz not null,
  location text,
  responsible_staff_id uuid not null references public.profiles(id),
  description text not null,
  immediate_actions text,
  medications_or_interventions jsonb not null default '[]'::jsonb,
  patient_condition text,
  outcome text,
  referral_or_transfer text,
  follow_up_requirements text,
  escalation_status text not null default 'open',
  supervisor_id uuid references public.profiles(id),
  supervisor_review text,
  supervisor_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  foreign key (performed_procedure_id, organization_id) references public.performed_procedures(id, organization_id) on delete restrict,
  check (length(btrim(description)) between 1 and 5000),
  check (escalation_status in ('open', 'escalated', 'under_review', 'resolved', 'closed')),
  check (jsonb_typeof(medications_or_interventions) = 'array')
);

create table if not exists public.sterilization_equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  equipment_name text not null,
  equipment_identifier text not null,
  equipment_type text,
  status text not null default 'active',
  last_maintenance_at timestamptz,
  next_maintenance_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  check (status in ('active', 'out_of_service', 'maintenance')),
  unique (organization_id, branch_id, equipment_identifier)
);

alter table public.sterilization_equipment
  add constraint sterilization_equipment_id_organization_key unique (id, organization_id);

create table if not exists public.sterilization_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  equipment_id uuid not null,
  cycle_identifier text not null,
  sterilized_at timestamptz not null,
  responsible_staff_id uuid not null references public.profiles(id),
  tray_or_batch_identifier text not null,
  instrument_details jsonb not null default '[]'::jsonb,
  cycle_parameters jsonb not null default '{}'::jsonb,
  chemical_indicator_result text,
  biological_indicator_result text,
  cycle_result text not null default 'incomplete',
  notes text,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (equipment_id, organization_id) references public.sterilization_equipment(id, organization_id) on delete restrict,
  check (cycle_result in ('successful', 'failed', 'incomplete')),
  check (chemical_indicator_result is null or chemical_indicator_result in ('pass', 'fail', 'not_available')),
  check (biological_indicator_result is null or biological_indicator_result in ('pass', 'fail', 'pending', 'not_available')),
  check (jsonb_typeof(instrument_details) = 'array'),
  check (jsonb_typeof(cycle_parameters) = 'object')
);

alter table public.sterilization_cycles
  add constraint sterilization_cycles_id_organization_key unique (id, organization_id);

create table if not exists public.instrument_cycle_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  performed_procedure_id uuid,
  used_at timestamptz not null default now(),
  recorded_by uuid not null references public.profiles(id),
  foreign key (cycle_id, organization_id) references public.sterilization_cycles(id, organization_id) on delete restrict,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  foreign key (performed_procedure_id, organization_id) references public.performed_procedures(id, organization_id) on delete restrict
);

create table if not exists public.sterilization_maintenance (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  equipment_id uuid not null,
  maintenance_at timestamptz not null,
  maintenance_type text not null,
  details text,
  performed_by uuid not null references public.profiles(id),
  next_due_at timestamptz,
  foreign key (equipment_id, organization_id) references public.sterilization_equipment(id, organization_id) on delete cascade
);

create table if not exists public.infection_control_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid,
  visit_id uuid,
  incident_type text not null,
  incident_at timestamptz not null default now(),
  description text not null,
  immediate_actions text,
  responsible_staff_id uuid not null references public.profiles(id),
  status text not null default 'open',
  follow_up text,
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  check (status in ('open', 'under_review', 'resolved', 'closed'))
);

create table if not exists public.patient_representatives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null,
  representative_name text not null,
  relationship text not null,
  contact_phone text,
  contact_email text,
  authorization_status text not null default 'pending',
  authorization_scope text,
  authorization_document_attachment_id uuid,
  valid_from date,
  valid_until date,
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (authorization_document_attachment_id, organization_id) references public.patient_attachments(id, organization_id) on delete set null,
  check (authorization_status in ('pending', 'active', 'expired', 'revoked')),
  check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create table if not exists public.patient_duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null,
  candidate_patient_id uuid not null,
  match_reason text not null,
  match_score numeric(5,2),
  status text not null default 'possible',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (candidate_patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  check (patient_id <> candidate_patient_id),
  check (match_score is null or match_score between 0 and 100),
  check (status in ('possible', 'confirmed_duplicate', 'dismissed', 'merged'))
);

create table if not exists public.patient_record_merges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_patient_id uuid not null,
  target_patient_id uuid not null,
  reason text not null,
  authorized_by uuid not null references public.profiles(id),
  merged_at timestamptz not null default now(),
  preserved_source_snapshot jsonb not null default '{}'::jsonb,
  foreign key (source_patient_id, organization_id) references public.patients(id, organization_id) on delete restrict,
  foreign key (target_patient_id, organization_id) references public.patients(id, organization_id) on delete restrict,
  check (source_patient_id <> target_patient_id),
  check (length(btrim(reason)) between 1 and 2000),
  check (jsonb_typeof(preserved_source_snapshot) = 'object')
);

create table if not exists public.clinical_handovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  referring_doctor_id uuid not null references public.profiles(id),
  referring_clinic text not null,
  receiving_organization_id uuid references public.organizations(id) on delete restrict,
  receiving_branch_id uuid,
  receiving_doctor_id uuid references public.profiles(id),
  receiving_clinic text,
  summary jsonb not null default '{}'::jsonb,
  consent_status text not null default 'pending',
  status text not null default 'draft',
  prepared_at timestamptz,
  sent_at timestamptz,
  received_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  foreign key (receiving_branch_id, receiving_organization_id)
    references public.branches(id, organization_id) on delete restrict,
  check (consent_status in ('pending', 'granted', 'denied', 'revoked')),
  check (status in ('draft', 'sent', 'received', 'acknowledged', 'cancelled')),
  check (jsonb_typeof(summary) = 'object')
);

create table if not exists public.clinical_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  document_type text not null check (document_type in (
    'clinical_examination', 'medical_dental_history', 'treatment_plan',
    'prescription', 'referral_letter', 'procedure_report', 'treatment_progress',
    'consent', 'post_treatment_instructions', 'follow_up_instructions'
  )),
  document_identifier text not null,
  title text not null,
  source_record_ids jsonb not null default '[]'::jsonb,
  content jsonb not null default '{}'::jsonb,
  version_number integer not null default 1,
  issuing_status text not null default 'draft',
  issued_at timestamptz,
  issued_content jsonb,
  responsible_user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  check (length(btrim(document_identifier)) between 1 and 100),
  check (version_number > 0),
  check (issuing_status in ('draft', 'review', 'approved', 'issued', 'superseded', 'void')),
  check (jsonb_typeof(source_record_ids) = 'array'),
  check (jsonb_typeof(content) = 'object'),
  check (issued_content is null or jsonb_typeof(issued_content) = 'object'),
  unique (organization_id, document_identifier)
);

alter table public.specialist_feature_settings
  add constraint specialist_feature_settings_id_organization_key unique (id, organization_id);
alter table public.periodontal_examinations
  add constraint periodontal_examinations_id_organization_key unique (id, organization_id);
alter table public.clinical_incidents
  add constraint clinical_incidents_id_organization_key unique (id, organization_id);
alter table public.patient_representatives
  add constraint patient_representatives_id_organization_key unique (id, organization_id);
alter table public.clinical_handovers
  add constraint clinical_handovers_id_organization_key unique (id, organization_id);
alter table public.clinical_documents
  add constraint clinical_documents_id_organization_key unique (id, organization_id);

create index if not exists periodontal_examinations_patient_date_idx
  on public.periodontal_examinations (organization_id, patient_id, examination_date desc);
create index if not exists endodontic_cases_patient_idx
  on public.endodontic_cases (organization_id, patient_id, created_at desc);
create index if not exists endodontic_sessions_case_date_idx
  on public.endodontic_sessions (organization_id, case_id, session_date desc);
create index if not exists orthodontic_cases_patient_idx
  on public.orthodontic_cases (organization_id, patient_id, created_at desc);
create index if not exists orthodontic_adjustments_case_date_idx
  on public.orthodontic_adjustments (organization_id, case_id, adjustment_date desc);
create index if not exists restorative_cases_patient_idx
  on public.restorative_cases (organization_id, patient_id, created_at desc);
create index if not exists diagnostic_investigations_patient_idx
  on public.diagnostic_investigations (organization_id, patient_id, request_date desc);
create index if not exists clinical_incidents_patient_idx
  on public.clinical_incidents (organization_id, patient_id, incident_at desc);
create index if not exists sterilization_cycles_equipment_idx
  on public.sterilization_cycles (organization_id, equipment_id, sterilized_at desc);
create index if not exists instrument_cycle_usage_patient_idx
  on public.instrument_cycle_usage (organization_id, patient_id, used_at desc);
create index if not exists patient_duplicate_candidates_org_idx
  on public.patient_duplicate_candidates (organization_id, status, created_at desc);
create index if not exists clinical_handovers_patient_idx
  on public.clinical_handovers (organization_id, patient_id, created_at desc);
create index if not exists clinical_documents_patient_idx
  on public.clinical_documents (organization_id, patient_id, created_at desc);

create or replace function public.detect_possible_duplicate_patients(p_patient_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_patient public.patients%rowtype;
  candidate record;
  found_count integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select * into source_patient from public.patients where id = p_patient_id;
  if not found or not public.can_access_branch(source_patient.registered_branch_id)
    or not public.has_org_role(source_patient.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor', 'receptionist'
    ]) then
    raise exception using errcode = '42501', message = 'Not authorized to investigate patient duplicates';
  end if;

  for candidate in
    select p.*
    from public.patients p
    where p.organization_id = source_patient.organization_id
      and p.id <> source_patient.id
      and (
        (source_patient.national_id is not null and btrim(p.national_id) = btrim(source_patient.national_id))
        or (
          source_patient.date_of_birth is not null
          and p.date_of_birth = source_patient.date_of_birth
          and lower(btrim(p.full_name)) = lower(btrim(source_patient.full_name))
        )
      )
  loop
    insert into public.patient_duplicate_candidates (
      organization_id, patient_id, candidate_patient_id, match_reason, match_score
    )
    values (
      source_patient.organization_id,
      source_patient.id,
      candidate.id,
      case
        when source_patient.national_id is not null
          and btrim(candidate.national_id) = btrim(source_patient.national_id)
          then 'Matching national identifier'
        else 'Matching name and date of birth'
      end,
      case
        when source_patient.national_id is not null
          and btrim(candidate.national_id) = btrim(source_patient.national_id)
          then 100
        else 95
      end
    )
    on conflict do nothing;
    found_count := found_count + 1;
  end loop;

  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    source_patient.organization_id, source_patient.registered_branch_id, auth.uid(),
    'patient.duplicate_check', 'patient', source_patient.id,
    jsonb_build_object('possible_duplicate_count', found_count)
  );
  return found_count;
end;
$$;

create or replace function public.merge_confirmed_patient_records(
  p_source_patient_id uuid,
  p_target_patient_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_patient public.patients%rowtype;
  target_patient public.patients%rowtype;
  merge_id uuid;
  table_name text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select * into source_patient from public.patients where id = p_source_patient_id;
  select * into target_patient from public.patients where id = p_target_patient_id;
  if not found or source_patient.organization_id <> target_patient.organization_id then
    raise exception using errcode = '22023', message = 'Choose two patient profiles in the same organization';
  end if;
  if not public.can_access_branch(source_patient.registered_branch_id)
    or not public.has_org_role(source_patient.organization_id, array[
      'organization_administrator'
    ]) then
    raise exception using errcode = '42501', message = 'Only organization administrators may merge patient records';
  end if;
  if source_patient.id = target_patient.id then
    raise exception using errcode = '22023', message = 'Source and target patient profiles must be different';
  end if;
  if source_patient.merged_into_patient_id is not null then
    raise exception using errcode = '22023', message = 'This source patient record has already been merged';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'A merge reason is required';
  end if;

  insert into public.patient_record_merges (
    organization_id, source_patient_id, target_patient_id, reason,
    authorized_by, preserved_source_snapshot
  ) values (
    source_patient.organization_id, source_patient.id, target_patient.id,
    btrim(p_reason), auth.uid(), to_jsonb(source_patient)
  ) returning id into merge_id;

  for table_name in
    select c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'patient_id'
      and c.table_name <> 'patients'
      and exists (
        select 1
        from information_schema.columns organization_column
        where organization_column.table_schema = 'public'
          and organization_column.table_name = c.table_name
          and organization_column.column_name = 'organization_id'
      )
  loop
    execute format(
      'update public.%I set patient_id = $1 where organization_id = $2 and patient_id = $3',
      table_name
    ) using target_patient.id, source_patient.organization_id, source_patient.id;
  end loop;

  update public.patients
  set status = 'archived',
      merged_into_patient_id = target_patient.id,
      merged_at = now(),
      updated_at = now()
  where id = source_patient.id;

  update public.patient_duplicate_candidates
  set status = 'merged', reviewed_by = auth.uid(), reviewed_at = now(),
      review_reason = btrim(p_reason)
  where organization_id = source_patient.organization_id
    and (patient_id = source_patient.id or candidate_patient_id = source_patient.id);

  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    source_patient.organization_id, source_patient.registered_branch_id, auth.uid(),
    'patient.merge', 'patient', source_patient.id,
    to_jsonb(source_patient),
    jsonb_build_object('merged_into_patient_id', target_patient.id, 'reason', btrim(p_reason),
      'merge_record_id', merge_id)
  );
  return merge_id;
end;
$$;

create or replace function public.acknowledge_clinical_handover(p_handover_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  handover public.clinical_handovers%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select * into handover from public.clinical_handovers where id = p_handover_id;
  if not found then
    raise exception using errcode = '22023', message = 'Handover not found';
  end if;
  if handover.consent_status <> 'granted'
    or (handover.receiving_branch_id is not null
      and not public.can_access_branch(handover.receiving_branch_id)) then
    raise exception using errcode = '42501', message = 'Handover consent or receiving-branch access is missing';
  end if;
  update public.clinical_handovers
  set status = 'acknowledged',
      received_at = coalesce(received_at, now()),
      acknowledged_at = now(),
      acknowledged_by = auth.uid()
  where id = handover.id;
  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    handover.organization_id, handover.branch_id, auth.uid(),
    'clinical_handover.acknowledged', 'clinical_handover', handover.id,
    jsonb_build_object('acknowledged_by', auth.uid())
  );
end;
$$;

create or replace function public.issue_clinical_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_row public.clinical_documents%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select * into document_row from public.clinical_documents where id = p_document_id;
  if not found or not public.can_access_branch(document_row.branch_id)
    or not public.has_org_role(document_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor'
    ]) then
    raise exception using errcode = '42501', message = 'Not authorized to issue restricted clinical documents';
  end if;
  update public.clinical_documents
  set issuing_status = 'issued',
      issued_at = now(),
      issued_content = content
  where id = document_row.id;
  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    document_row.organization_id, document_row.branch_id, auth.uid(),
    'clinical_document.issued', 'clinical_document', document_row.id,
    jsonb_build_object('document_identifier', document_row.document_identifier,
      'document_type', document_row.document_type, 'version_number', document_row.version_number)
  );
end;
$$;

create or replace function public.reject_failed_sterilization_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_result text;
begin
  select c.cycle_result into cycle_result
  from public.sterilization_cycles c
  where c.id = new.cycle_id
    and c.organization_id = new.organization_id;
  if cycle_result is distinct from 'successful' then
    raise exception using errcode = '22023',
      message = 'Instrument use cannot be traced to a failed or incomplete sterilization cycle';
  end if;
  return new;
end;
$$;

create trigger instrument_cycle_usage_result_guard
before insert or update of cycle_id on public.instrument_cycle_usage
for each row execute function public.reject_failed_sterilization_usage();

create or replace function public.audit_phase2f_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_data jsonb;
  old_data jsonb;
  organization_id_value uuid;
  branch_id_value uuid;
  patient_id_value uuid;
  entity_id_value uuid;
begin
  record_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  old_data := case when tg_op = 'DELETE' then to_jsonb(old) else null end;
  organization_id_value := nullif(record_data->>'organization_id', '')::uuid;
  branch_id_value := nullif(record_data->>'branch_id', '')::uuid;
  patient_id_value := nullif(record_data->>'patient_id', '')::uuid;
  entity_id_value := nullif(record_data->>'id', '')::uuid;
  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    organization_id_value,
    branch_id_value,
    auth.uid(),
    'phase2f.' || lower(tg_table_name) || '.' || lower(tg_op),
    tg_table_name,
    entity_id_value,
    case when tg_op = 'UPDATE' or tg_op = 'DELETE' then old_data else null end,
    case when tg_op = 'DELETE' then null else record_data end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'periodontal_examinations', 'endodontic_cases', 'orthodontic_cases',
    'restorative_cases', 'diagnostic_investigations', 'clinical_incidents',
    'sterilization_cycles', 'instrument_cycle_usage', 'patient_representatives',
    'patient_duplicate_candidates', 'patient_record_merges',
    'clinical_handovers', 'clinical_documents'
  ] loop
    execute format('drop trigger if exists phase2f_audit on public.%I', table_name);
    execute format(
      'create trigger phase2f_audit after insert or update or delete on public.%I
       for each row execute function public.audit_phase2f_change()',
      table_name
    );
  end loop;
end;
$$;

alter table public.specialist_feature_settings enable row level security;
create policy "Specialist feature settings are organization readable"
on public.specialist_feature_settings for select using (
  public.is_org_member(organization_id)
);
create policy "Authorized administrators configure specialist features"
on public.specialist_feature_settings for insert with check (
  public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor'
  ])
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'periodontal_examinations', 'endodontic_cases', 'endodontic_sessions',
    'orthodontic_cases', 'orthodontic_adjustments', 'restorative_cases',
    'restorative_case_stages', 'diagnostic_investigations', 'investigation_images',
    'clinical_incidents', 'sterilization_equipment', 'sterilization_cycles',
    'instrument_cycle_usage', 'sterilization_maintenance',
    'infection_control_incidents',
    'patient_duplicate_candidates', 'patient_record_merges',
    'clinical_handovers', 'clinical_documents', 'periodontal_sites',
    'orthodontic_adjustments', 'restorative_case_stages', 'investigation_images'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'periodontal_examinations', 'endodontic_cases', 'orthodontic_cases',
    'restorative_cases', 'diagnostic_investigations', 'clinical_incidents',
    'sterilization_equipment', 'sterilization_cycles',
    'infection_control_incidents',
    'clinical_handovers', 'clinical_documents'
  ] loop
    execute format(
      'drop policy if exists "Phase 2f authorized clinical insert" on public.%I',
      table_name
    );
    execute format(
      'create policy "Phase 2f authorized clinical insert" on public.%I for insert with check (
        public.can_access_branch(branch_id)
        and public.has_org_role(organization_id, array[
          ''organization_administrator'', ''central_clinical_supervisor'',
          ''branch_supervisor'', ''doctor'', ''nurse'', ''inventory_officer''
        ])
      )',
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'periodontal_examinations', 'endodontic_cases', 'orthodontic_cases',
    'restorative_cases', 'diagnostic_investigations', 'clinical_incidents',
    'sterilization_equipment', 'infection_control_incidents',
    'clinical_handovers', 'clinical_documents'
  ] loop
    execute format(
      'drop policy if exists "Phase 2f branch readable" on public.%I',
      table_name
    );
    execute format(
      'create policy "Phase 2f branch readable" on public.%I for select using (public.can_access_branch(branch_id))',
      table_name
    );
  end loop;
end;
$$;

drop policy if exists "Phase 2f patient representative branch readable"
on public.patient_representatives;
create policy "Phase 2f patient representative branch readable"
on public.patient_representatives for select using (
  exists (
    select 1 from public.patients p
    where p.id = patient_representatives.patient_id
      and p.organization_id = patient_representatives.organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
);
drop policy if exists "Phase 2f authorized patient representative insert"
on public.patient_representatives;
create policy "Phase 2f authorized patient representative insert"
on public.patient_representatives for insert with check (
  exists (
    select 1 from public.patients p
    where p.id = patient_representatives.patient_id
      and p.organization_id = patient_representatives.organization_id
      and public.can_access_branch(p.registered_branch_id)
      and public.has_org_role(patient_representatives.organization_id, array[
        'organization_administrator', 'central_clinical_supervisor',
        'branch_supervisor', 'doctor', 'nurse'
      ])
  )
);

create policy "Phase 2f periodontal sites are branch readable"
on public.periodontal_sites for select using (
  exists (
    select 1 from public.periodontal_examinations e
    where e.id = examination_id and public.can_access_branch(e.branch_id)
  )
);
create policy "Phase 2f nested clinical records are branch readable"
on public.endodontic_sessions for select using (
  exists (
    select 1 from public.endodontic_cases c
    where c.id = case_id and public.can_access_branch(c.branch_id)
  )
);
create policy "Phase 2f orthodontic adjustments are branch readable"
on public.orthodontic_adjustments for select using (
  exists (
    select 1 from public.orthodontic_cases c
    where c.id = case_id and public.can_access_branch(c.branch_id)
  )
);
create policy "Phase 2f restorative stages are branch readable"
on public.restorative_case_stages for select using (
  exists (
    select 1 from public.restorative_cases c
    where c.id = case_id and public.can_access_branch(c.branch_id)
  )
);
create policy "Phase 2f investigation images are branch readable"
on public.investigation_images for select using (
  exists (
    select 1 from public.diagnostic_investigations i
    where i.id = investigation_id and public.can_access_branch(i.branch_id)
  )
);
create policy "Phase 2f cycle usage is branch readable"
on public.instrument_cycle_usage for select using (
  exists (
    select 1 from public.sterilization_cycles c
    where c.id = cycle_id and public.can_access_branch(c.branch_id)
  )
);
create policy "Phase 2f sterilization maintenance is branch readable"
on public.sterilization_maintenance for select using (
  exists (
    select 1 from public.sterilization_equipment e
    where e.id = equipment_id and public.can_access_branch(e.branch_id)
  )
);
create policy "Phase 2f sterilization cycles are branch readable"
on public.sterilization_cycles for select using (public.can_access_branch(branch_id));
create policy "Phase 2f duplicate candidates are organization readable"
on public.patient_duplicate_candidates for select using (
  public.is_org_member(organization_id)
);
create policy "Phase 2f merge records are organization readable"
on public.patient_record_merges for select using (
  public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor'
  ])
);

grant select on
  public.specialist_feature_settings,
  public.periodontal_examinations,
  public.periodontal_sites,
  public.endodontic_cases,
  public.endodontic_sessions,
  public.orthodontic_cases,
  public.orthodontic_adjustments,
  public.restorative_cases,
  public.restorative_case_stages,
  public.diagnostic_investigations,
  public.investigation_images,
  public.clinical_incidents,
  public.sterilization_equipment,
  public.sterilization_cycles,
  public.instrument_cycle_usage,
  public.sterilization_maintenance,
  public.infection_control_incidents,
  public.patient_representatives,
  public.patient_duplicate_candidates,
  public.patient_record_merges,
  public.clinical_handovers,
  public.clinical_documents
to authenticated;

grant insert, update on
  public.periodontal_examinations,
  public.periodontal_sites,
  public.endodontic_cases,
  public.endodontic_sessions,
  public.orthodontic_cases,
  public.orthodontic_adjustments,
  public.restorative_cases,
  public.restorative_case_stages,
  public.diagnostic_investigations,
  public.investigation_images,
  public.clinical_incidents,
  public.sterilization_equipment,
  public.sterilization_cycles,
  public.instrument_cycle_usage,
  public.sterilization_maintenance,
  public.infection_control_incidents,
  public.patient_representatives,
  public.patient_duplicate_candidates,
  public.clinical_handovers,
  public.clinical_documents
to authenticated;

grant all on
  public.specialist_feature_settings,
  public.periodontal_examinations,
  public.periodontal_sites,
  public.endodontic_cases,
  public.endodontic_sessions,
  public.orthodontic_cases,
  public.orthodontic_adjustments,
  public.restorative_cases,
  public.restorative_case_stages,
  public.diagnostic_investigations,
  public.investigation_images,
  public.clinical_incidents,
  public.sterilization_equipment,
  public.sterilization_cycles,
  public.instrument_cycle_usage,
  public.sterilization_maintenance,
  public.infection_control_incidents,
  public.patient_representatives,
  public.patient_duplicate_candidates,
  public.patient_record_merges,
  public.clinical_handovers,
  public.clinical_documents
to service_role;

revoke all on function public.detect_possible_duplicate_patients(uuid),
  public.merge_confirmed_patient_records(uuid, uuid, text),
  public.acknowledge_clinical_handover(uuid),
  public.issue_clinical_document(uuid)
from public, anon;

grant execute on function public.detect_possible_duplicate_patients(uuid),
  public.merge_confirmed_patient_records(uuid, uuid, text),
  public.acknowledge_clinical_handover(uuid),
  public.issue_clinical_document(uuid)
to authenticated;
