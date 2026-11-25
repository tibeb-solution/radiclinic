alter table public.profiles
  add column if not exists preferred_dental_notation text not null default 'fdi',
  add column if not exists clinical_timezone text;

alter table public.profiles
  drop constraint if exists profiles_preferred_dental_notation_check;
alter table public.profiles
  add constraint profiles_preferred_dental_notation_check
  check (preferred_dental_notation in ('fdi', 'universal', 'palmer'));

create table if not exists public.dental_anatomical_teeth (
  fdi text primary key
    check (fdi ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'),
  dentition text not null check (dentition in ('permanent', 'primary')),
  universal text,
  palmer text
);

insert into public.dental_anatomical_teeth (fdi, dentition, universal, palmer) values
  ('11','permanent','8','UR1'),('12','permanent','7','UR2'),('13','permanent','6','UR3'),
  ('14','permanent','5','UR4'),('15','permanent','4','UR5'),('16','permanent','3','UR6'),
  ('17','permanent','2','UR7'),('18','permanent','1','UR8'),('21','permanent','9','UL1'),
  ('22','permanent','10','UL2'),('23','permanent','11','UL3'),('24','permanent','12','UL4'),
  ('25','permanent','13','UL5'),('26','permanent','14','UL6'),('27','permanent','15','UL7'),
  ('28','permanent','16','UL8'),('31','permanent','24','LL1'),('32','permanent','23','LL2'),
  ('33','permanent','22','LL3'),('34','permanent','21','LL4'),('35','permanent','20','LL5'),
  ('36','permanent','19','LL6'),('37','permanent','18','LL7'),('38','permanent','17','LL8'),
  ('41','permanent','25','LR1'),('42','permanent','26','LR2'),('43','permanent','27','LR3'),
  ('44','permanent','28','LR4'),('45','permanent','29','LR5'),('46','permanent','30','LR6'),
  ('47','permanent','31','LR7'),('48','permanent','32','LR8'),
  ('51','primary','E','URE'),('52','primary','D','URD'),('53','primary','C','URC'),
  ('54','primary','B','URB'),('55','primary','A','URA'),('61','primary','F','ULF'),
  ('62','primary','G','ULG'),('63','primary','H','ULH'),('64','primary','I','ULI'),
  ('65','primary','J','ULJ'),('71','primary','O','LLO'),('72','primary','N','LLN'),
  ('73','primary','M','LLM'),('74','primary','L','LLL'),('75','primary','K','LLK'),
  ('81','primary','P','LRP'),('82','primary','Q','LRQ'),('83','primary','R','LRR'),
  ('84','primary','S','LRS'),('85','primary','T','LRT')
on conflict (fdi) do update set dentition = excluded.dentition,
  universal = excluded.universal, palmer = excluded.palmer;

create or replace function public.format_tooth_identity(
  p_fdi text,
  p_notation text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_notation = 'universal' then t.universal
    when p_notation = 'palmer' then t.palmer
    else t.fdi
  end
  from public.dental_anatomical_teeth t
  where t.fdi = p_fdi;
$$;

create table if not exists public.medical_history_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  source text not null check (source in ('patient_reported', 'nursing_assessment', 'doctor_assessment')),
  collection_method text,
  answers jsonb not null default '{}'::jsonb,
  review_of_systems jsonb not null default '{}'::jsonb,
  clinical_notes text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'reviewed', 'verified', 'not_verified', 'requires_clarification', 'disputed', 'not_clinically_relevant')),
  verification_note text,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  check (answers <> 'null'::jsonb and jsonb_typeof(answers) = 'object'),
  check (review_of_systems <> 'null'::jsonb and jsonb_typeof(review_of_systems) = 'object'),
  check (length(coalesce(clinical_notes, '')) <= 5000),
  check (length(coalesce(verification_note, '')) <= 2000)
);

alter table public.patient_vitals
  add column if not exists bmi numeric(6,2),
  add column if not exists pain_score smallint,
  add column if not exists general_appearance text,
  add column if not exists level_of_consciousness text,
  add column if not exists mobility text,
  add column if not exists observed_symptoms text,
  add column if not exists urgent_attention_signs text,
  add column if not exists medication_reconciliation jsonb not null default '{}'::jsonb,
  add column if not exists escalation_note text;

alter table public.patient_vitals
  add constraint patient_vitals_pain_score_check
  check (pain_score is null or pain_score between 0 and 10);

create table if not exists public.doctor_medical_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid not null,
  medical_history_review jsonb not null default '{}'::jsonb,
  systemic_assessment jsonb not null default '{}'::jsonb,
  clinical_risk_assessment jsonb not null default '{}'::jsonb,
  clinical_conclusion text,
  differential_diagnoses jsonb not null default '[]'::jsonb,
  investigations_required jsonb not null default '[]'::jsonb,
  referrals jsonb not null default '[]'::jsonb,
  treatment_precautions text,
  recommendations text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete cascade,
  check (length(coalesce(clinical_conclusion, '')) <= 5000),
  check (jsonb_typeof(differential_diagnoses) = 'array'),
  check (jsonb_typeof(investigations_required) = 'array'),
  check (jsonb_typeof(referrals) = 'array')
);

alter table public.treatment_plans
  add column if not exists diagnosis_id uuid,
  add column if not exists treatment_objective text,
  add column if not exists treatment_description text,
  add column if not exists responsible_doctor_id uuid references public.profiles(id),
  add column if not exists estimated_total_duration text,
  add column if not exists proposed_start_date date,
  add column if not exists estimated_completion_date date,
  add column if not exists estimated_total_cost numeric(12,2),
  add column if not exists priority text not null default 'routine',
  add column if not exists clinical_approval_status text not null default 'pending',
  add column if not exists actual_completion_date date,
  add column if not exists authorized_by uuid references public.profiles(id);

alter table public.treatment_plans
  drop constraint if exists treatment_plans_phase2e_priority_check,
  drop constraint if exists treatment_plans_phase2e_clinical_approval_check,
  drop constraint if exists treatment_plans_phase2e_dates_check,
  drop constraint if exists treatment_plans_phase2e_cost_check;
alter table public.treatment_plans
  add constraint treatment_plans_phase2e_priority_check
    check (priority in ('low', 'routine', 'high', 'urgent')),
  add constraint treatment_plans_phase2e_clinical_approval_check
    check (clinical_approval_status in ('pending', 'approved', 'rejected', 'returned')),
  add constraint treatment_plans_phase2e_dates_check
    check (estimated_completion_date is null or proposed_start_date is null or estimated_completion_date >= proposed_start_date),
  add constraint treatment_plans_phase2e_cost_check
    check (estimated_total_cost is null or estimated_total_cost >= 0);

create table if not exists public.treatment_plan_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null,
  stage_name text not null,
  stage_description text,
  sequence_number integer not null,
  responsible_doctor_id uuid references public.profiles(id),
  expected_start_date date,
  expected_completion_date date,
  estimated_duration text,
  required_materials jsonb not null default '[]'::jsonb,
  dependency_stage_ids uuid[] not null default '{}'::uuid[],
  completion_criteria text,
  status text not null default 'planned',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plan_id, organization_id) references public.treatment_plans(id, organization_id) on delete cascade,
  unique (plan_id, sequence_number),
  check (length(btrim(stage_name)) between 1 and 200),
  check (sequence_number > 0),
  check (expected_completion_date is null or expected_start_date is null or expected_completion_date >= expected_start_date),
  check (status in ('planned', 'upcoming', 'in_progress', 'completed', 'delayed', 'cancelled', 'discontinued')),
  check (jsonb_typeof(required_materials) = 'array')
);

alter table public.treatment_plan_stages
  drop constraint if exists treatment_plan_stages_id_organization_key;
alter table public.treatment_plan_stages
  add constraint treatment_plan_stages_id_organization_key
  unique (id, organization_id);

create table if not exists public.treatment_plan_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null,
  step_description text not null,
  sequence_number integer not null,
  responsible_clinician_id uuid references public.profiles(id),
  procedure_catalog_name text,
  tooth_identity text[] not null default '{}'::text[],
  estimated_duration_minutes integer,
  required_appointment_minutes integer,
  recommended_date date,
  recommended_interval_days integer,
  dependency_step_ids uuid[] not null default '{}'::uuid[],
  clinical_instructions text,
  status text not null default 'planned',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (stage_id, organization_id) references public.treatment_plan_stages(id, organization_id) on delete cascade,
  unique (stage_id, sequence_number),
  check (length(btrim(step_description)) between 1 and 1000),
  check (sequence_number > 0),
  check (estimated_duration_minutes is null or estimated_duration_minutes > 0),
  check (required_appointment_minutes is null or required_appointment_minutes > 0),
  check (recommended_interval_days is null or recommended_interval_days >= 0),
  check (status in ('planned', 'awaiting_authorization', 'approved', 'scheduled', 'in_progress', 'paused', 'completed', 'partially_completed', 'abandoned', 'cancelled', 'discontinued'))
);

alter table public.treatment_plan_steps
  drop constraint if exists treatment_plan_steps_id_organization_key;
alter table public.treatment_plan_steps
  add constraint treatment_plan_steps_id_organization_key
  unique (id, organization_id);

alter table public.performed_procedures
  add column if not exists stage_id uuid,
  add column if not exists step_id uuid,
  add column if not exists tooth_identity text[] not null default '{}'::text[],
  add column if not exists actual_start_at timestamptz,
  add column if not exists actual_completion_at timestamptz,
  add column if not exists status text not null default 'not_started',
  add column if not exists complications text,
  add column if not exists follow_up_instructions text,
  add column if not exists cancellation_reason text;

alter table public.performed_procedures
  drop constraint if exists performed_procedures_phase2e_status_check;
alter table public.performed_procedures
  add constraint performed_procedures_phase2e_status_check
  check (status in ('not_started', 'started', 'paused', 'completed', 'partially_completed', 'abandoned', 'cancelled'));

alter table public.odontogram_findings
  add column if not exists tooth_identity text,
  add column if not exists source_notation text not null default 'fdi';
alter table public.visit_diagnosis_locations
  add column if not exists tooth_identity text,
  add column if not exists source_notation text not null default 'fdi';
alter table public.treatment_plan_items
  add column if not exists tooth_identity text[] not null default '{}'::text[],
  add column if not exists source_notation text not null default 'fdi';

create table if not exists public.appointment_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  plan_id uuid,
  stage_id uuid,
  step_id uuid,
  assigned_doctor_id uuid,
  proposed_start timestamptz not null,
  proposed_end timestamptz not null,
  room_resource text,
  equipment_resources text[] not null default '{}'::text[],
  status text not null default 'proposed',
  generated_by uuid not null references public.profiles(id),
  generated_at timestamptz not null default now(),
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  appointment_id uuid,
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (plan_id, organization_id) references public.treatment_plans(id, organization_id) on delete cascade,
  check (proposed_end > proposed_start),
  check (status in ('proposed', 'accepted', 'declined', 'superseded'))
);

create table if not exists public.clinical_safety_reference_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  reference_source text not null,
  source_version text,
  entry_type text not null check (entry_type in ('allergy', 'interaction', 'contraindication', 'duplicate', 'dosage')),
  medication_name text,
  related_medication_name text,
  condition_name text,
  allergy_name text,
  risk_description text not null,
  recommended_action text not null,
  severity text not null check (severity in ('informational', 'moderate', 'high', 'critical')),
  validated_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (length(btrim(reference_source)) between 1 and 200),
  check (length(btrim(risk_description)) between 1 and 3000),
  check (length(btrim(recommended_action)) between 1 and 3000)
);

create table if not exists public.clinical_safety_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  alert_id uuid references public.clinical_safety_alerts(id) on delete restrict,
  reference_entry_id uuid references public.clinical_safety_reference_entries(id) on delete restrict,
  decision text not null check (decision in ('accepted_alternative', 'modified', 'rejected', 'overridden')),
  override_reason text,
  final_recommendation text,
  alternatives jsonb not null default '[]'::jsonb,
  actor_id uuid not null references public.profiles(id),
  decided_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id) references public.patient_visits(id, organization_id) on delete restrict,
  check (decision <> 'overridden' or (override_reason is not null and length(btrim(override_reason)) between 1 and 2000)),
  check (jsonb_typeof(alternatives) = 'array')
);

alter table public.patient_attachments
  add column if not exists tooth_identity text,
  add column if not exists source_notation text not null default 'fdi',
  add column if not exists diagnosis_id uuid,
  add column if not exists treatment_plan_id uuid,
  add column if not exists version_number integer not null default 1,
  add column if not exists original_attachment_id uuid,
  add column if not exists access_permissions jsonb not null default '{}'::jsonb,
  add column if not exists uploaded_by uuid references public.profiles(id);

alter table public.patient_attachments
  drop constraint if exists patient_attachments_access_permissions_object_check;
alter table public.patient_attachments
  add constraint patient_attachments_access_permissions_object_check
  check (jsonb_typeof(access_permissions) = 'object');

create table if not exists public.attachment_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  attachment_id uuid not null,
  action text not null check (action in ('uploaded', 'viewed', 'downloaded', 'transmitted', 'shared', 'revoked')),
  actor_id uuid not null references public.profiles(id),
  recipient_organization_id uuid references public.organizations(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  acted_at timestamptz not null default now(),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (attachment_id, organization_id) references public.patient_attachments(id, organization_id) on delete cascade
);

create table if not exists public.clinical_referrals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  referring_doctor_id uuid not null references public.profiles(id),
  receiving_organization_id uuid references public.organizations(id) on delete restrict,
  receiving_branch_id uuid,
  receiving_doctor_id uuid references public.profiles(id),
  reason text not null,
  recommended_next_steps text,
  package jsonb not null default '{}'::jsonb,
  status text not null default 'sent',
  sent_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid references public.profiles(id),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  check (length(btrim(reason)) between 1 and 3000),
  check (status in ('sent', 'received', 'accepted', 'declined', 'completed', 'cancelled')),
  check (jsonb_typeof(package) = 'object')
);

alter table public.clinical_referrals
  drop constraint if exists clinical_referrals_id_organization_key;
alter table public.clinical_referrals
  add constraint clinical_referrals_id_organization_key
  unique (id, organization_id);

create table if not exists public.clinical_referral_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  referral_id uuid not null,
  status text not null,
  actor_id uuid not null references public.profiles(id),
  notes text,
  changed_at timestamptz not null default now(),
  foreign key (referral_id, organization_id) references public.clinical_referrals(id, organization_id) on delete cascade,
  check (status in ('sent', 'received', 'accepted', 'declined', 'completed', 'cancelled'))
);

create table if not exists public.clinical_record_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  patient_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  version_number integer not null,
  before_data jsonb,
  after_data jsonb,
  change_reason text,
  changed_by uuid references public.profiles(id),
  actor_role text,
  clinical_context jsonb not null default '{}'::jsonb,
  approval_status text,
  entered_in_error boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, version_number),
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id) references public.patients(id, organization_id) on delete cascade,
  check (version_number > 0),
  check (length(coalesce(change_reason, '')) <= 2000)
);

create or replace function public.prevent_clinical_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Clinical history is immutable';
end;
$$;

create trigger clinical_record_history_immutable_update
before update or delete on public.clinical_record_history
for each row execute function public.prevent_clinical_history_mutation();

alter table public.appointments
  add column if not exists assigned_doctor_id uuid references public.profiles(id),
  add column if not exists treatment_room text,
  add column if not exists required_equipment text[] not null default '{}'::text[],
  add column if not exists recommendation_id uuid,
  add column if not exists override_reason text,
  add column if not exists overridden_by uuid references public.profiles(id);

create table if not exists public.clinic_scheduling_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  resource_type text not null check (resource_type in ('doctor', 'room', 'equipment')),
  resource_name text not null,
  profile_id uuid references public.profiles(id),
  availability jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  foreign key (branch_id, organization_id) references public.branches(id, organization_id) on delete cascade,
  check (length(btrim(resource_name)) between 1 and 200),
  check (jsonb_typeof(availability) = 'object')
);

create or replace function public.check_appointment_conflicts(
  p_branch_id uuid,
  p_patient_id uuid,
  p_assigned_doctor_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_required_resources text[] default '{}'::text[],
  p_ignore_appointment_id uuid default null
)
returns table (
  conflict_type text,
  conflicting_appointment_id uuid,
  conflicting_patient_name text,
  conflicting_starts_at timestamptz,
  conflicting_ends_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception using errcode = '22023', message = 'Appointment end time must be after start time';
  end if;
  return query
  select 'doctor'::text, a.id,
         pt.full_name,
         a.starts_at, a.ends_at
  from public.appointments a
  left join public.patients pt on pt.id = a.patient_id
  where a.branch_id = p_branch_id
    and a.assigned_doctor_id = p_assigned_doctor_id
    and a.status in ('scheduled', 'checked-in')
    and (p_ignore_appointment_id is null or a.id <> p_ignore_appointment_id)
    and tstzrange(a.starts_at, coalesce(a.ends_at, a.starts_at + interval '30 minutes'), '[)')
        && tstzrange(p_starts_at, p_ends_at, '[)');
end;
$$;

create or replace function public.accept_treatment_appointment_recommendation(
  p_recommendation_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_assigned_doctor_id uuid default null,
  p_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  recommendation_row public.appointment_recommendations%rowtype;
  doctor_id uuid;
  conflict_count integer;
  appointment_id uuid;
  normalized_reason text := nullif(btrim(p_override_reason), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select r.* into recommendation_row
  from public.appointment_recommendations r
  where r.id = p_recommendation_id;
  if not found or not public.can_access_branch(recommendation_row.branch_id)
    or not public.has_org_role(recommendation_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor', 'receptionist'
    ]) then
    raise exception using errcode = '42501', message = 'You are not authorized to schedule this recommendation';
  end if;
  if recommendation_row.status <> 'proposed' then
    raise exception using errcode = '22023', message = 'This appointment recommendation is no longer available';
  end if;
  doctor_id := coalesce(p_assigned_doctor_id, recommendation_row.assigned_doctor_id);
  if doctor_id is null then
    raise exception using errcode = '22023', message = 'Choose an assigned doctor';
  end if;
  select count(*) into conflict_count
  from public.check_appointment_conflicts(
    recommendation_row.branch_id, recommendation_row.patient_id,
    doctor_id, p_starts_at, p_ends_at
  );
  if conflict_count > 0 then
    if normalized_reason is null or not public.has_org_role(recommendation_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
    ]) then
      raise exception using errcode = '23505',
        message = 'Scheduling conflict detected. Choose another available time or obtain an authorized override.';
    end if;
  end if;
  insert into public.appointments (
    organization_id, branch_id, patient_id, title, starts_at, ends_at,
    status, notes, created_by, assigned_doctor_id, treatment_room,
    required_equipment, recommendation_id, override_reason, overridden_by
  ) values (
    recommendation_row.organization_id, recommendation_row.branch_id,
    recommendation_row.patient_id, 'Treatment plan appointment',
    p_starts_at, p_ends_at, 'scheduled',
    'Generated from an approved treatment plan recommendation',
    auth.uid(), doctor_id, recommendation_row.room_resource,
    recommendation_row.equipment_resources, recommendation_row.id,
    normalized_reason, case when normalized_reason is not null then auth.uid() else null end
  ) returning id into appointment_id;
  update public.appointment_recommendations
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now(),
      appointment_id = appointment_id
  where id = recommendation_row.id;
  insert into public.clinical_record_history (
    organization_id, branch_id, patient_id, entity_type, entity_id,
    version_number, after_data, change_reason, changed_by, actor_role
  ) values (
    recommendation_row.organization_id, recommendation_row.branch_id,
    recommendation_row.patient_id, 'appointment', appointment_id,
    1, jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at,
      'doctor_id', doctor_id, 'override_reason', normalized_reason),
    case when normalized_reason is not null then 'Authorized scheduling override' else null end,
    auth.uid(), 'authorized_scheduler'
  );
  return appointment_id;
end;
$$;

create index if not exists phase2e_history_patient_idx
  on public.clinical_record_history (organization_id, patient_id, created_at desc);
create index if not exists phase2e_stages_plan_idx
  on public.treatment_plan_stages (organization_id, plan_id, sequence_number);
create index if not exists phase2e_steps_stage_idx
  on public.treatment_plan_steps (organization_id, stage_id, sequence_number);
create index if not exists phase2e_medical_assessments_patient_idx
  on public.medical_history_assessments (organization_id, patient_id, recorded_at desc);
create index if not exists phase2e_referrals_patient_idx
  on public.clinical_referrals (organization_id, patient_id, sent_at desc);
create index if not exists phase2e_attachment_actions_idx
  on public.attachment_actions (organization_id, attachment_id, acted_at desc);

alter table public.medical_history_assessments enable row level security;
alter table public.doctor_medical_assessments enable row level security;
alter table public.treatment_plan_stages enable row level security;
alter table public.treatment_plan_steps enable row level security;
alter table public.appointment_recommendations enable row level security;
alter table public.clinical_safety_decisions enable row level security;
alter table public.attachment_actions enable row level security;
alter table public.clinical_referrals enable row level security;
alter table public.clinical_referral_status_history enable row level security;
alter table public.clinical_record_history enable row level security;
alter table public.clinic_scheduling_resources enable row level security;

create policy "Medical assessments are branch readable"
on public.medical_history_assessments for select using (public.can_access_branch(branch_id));
create policy "Doctor assessments are branch readable"
on public.doctor_medical_assessments for select using (public.can_access_branch(branch_id));
create policy "Treatment stages are branch readable"
on public.treatment_plan_stages for select using (
  exists (select 1 from public.treatment_plans p where p.id = plan_id and public.can_access_branch(p.branch_id))
);
create policy "Treatment steps are branch readable"
on public.treatment_plan_steps for select using (
  exists (
    select 1 from public.treatment_plan_stages s
    join public.treatment_plans p on p.id = s.plan_id
    where s.id = stage_id and public.can_access_branch(p.branch_id)
  )
);
create policy "Appointment recommendations are branch readable"
on public.appointment_recommendations for select using (public.can_access_branch(branch_id));
create policy "Safety decisions are branch readable"
on public.clinical_safety_decisions for select using (public.can_access_branch(branch_id));
create policy "Attachment actions are branch readable"
on public.attachment_actions for select using (public.can_access_branch(branch_id));
create policy "Referrals are branch readable"
on public.clinical_referrals for select using (
  public.can_access_branch(branch_id)
  or receiving_branch_id is not null and public.can_access_branch(receiving_branch_id)
);
create policy "Referral history follows referral access"
on public.clinical_referral_status_history for select using (
  exists (
    select 1 from public.clinical_referrals r
    where r.id = referral_id
      and (public.can_access_branch(r.branch_id)
        or r.receiving_branch_id is not null and public.can_access_branch(r.receiving_branch_id))
  )
);
create policy "Clinical history is branch readable"
on public.clinical_record_history for select using (
  branch_id is null or public.can_access_branch(branch_id)
);
create policy "Scheduling resources are branch readable"
on public.clinic_scheduling_resources for select using (public.can_access_branch(branch_id));

revoke insert, update, delete on public.clinical_record_history from authenticated;
revoke insert, update, delete on public.clinical_referral_status_history from authenticated;
grant select on public.clinical_record_history to authenticated;
grant select on public.clinical_referral_status_history to authenticated;

grant all on
  public.medical_history_assessments,
  public.doctor_medical_assessments,
  public.treatment_plan_stages,
  public.treatment_plan_steps,
  public.appointment_recommendations,
  public.clinical_safety_decisions,
  public.attachment_actions,
  public.clinical_referrals,
  public.clinical_referral_status_history,
  public.clinical_record_history,
  public.clinic_scheduling_resources
to service_role;
grant select on
  public.dental_anatomical_teeth,
  public.medical_history_assessments,
  public.doctor_medical_assessments,
  public.treatment_plan_stages,
  public.treatment_plan_steps,
  public.appointment_recommendations,
  public.clinical_safety_reference_entries,
  public.clinical_safety_decisions,
  public.attachment_actions,
  public.clinical_referrals,
  public.clinical_referral_status_history,
  public.clinical_record_history,
  public.clinic_scheduling_resources
to authenticated;

grant insert, update on
  public.medical_history_assessments,
  public.doctor_medical_assessments,
  public.treatment_plan_stages,
  public.treatment_plan_steps,
  public.appointment_recommendations,
  public.clinical_safety_decisions,
  public.clinical_referrals
to authenticated;

create policy "Authorized clinical staff may add medical assessments"
on public.medical_history_assessments for insert with check (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ])
);
create policy "Authorized clinicians may add doctor assessments"
on public.doctor_medical_assessments for insert with check (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor'
  ])
);
create policy "Authorized clinicians may manage stages"
on public.treatment_plan_stages for insert with check (
  exists (
    select 1 from public.treatment_plans p
    where p.id = plan_id
      and public.can_access_branch(p.branch_id)
      and public.has_org_role(p.organization_id, array[
        'organization_administrator', 'central_clinical_supervisor',
        'branch_supervisor', 'doctor'
      ])
  )
);
create policy "Authorized clinicians may manage steps"
on public.treatment_plan_steps for insert with check (
  exists (
    select 1 from public.treatment_plan_stages s
    join public.treatment_plans p on p.id = s.plan_id
    where s.id = stage_id
      and public.can_access_branch(p.branch_id)
      and public.has_org_role(p.organization_id, array[
        'organization_administrator', 'central_clinical_supervisor',
        'branch_supervisor', 'doctor'
      ])
  )
);
create policy "Authorized schedulers may create recommendations"
on public.appointment_recommendations for insert with check (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'receptionist'
  ])
);

create policy "Authorized clinicians may record safety decisions"
on public.clinical_safety_decisions for insert with check (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor'
  ])
);
create policy "Authorized doctors may create referrals"
on public.clinical_referrals for insert with check (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor'
  ])
);

create policy "Authorized clinicians may update stages"
on public.treatment_plan_stages for update using (
  exists (
    select 1 from public.treatment_plans p
    where p.id = plan_id and public.can_access_branch(p.branch_id)
      and public.has_org_role(p.organization_id, array[
        'organization_administrator', 'central_clinical_supervisor',
        'branch_supervisor', 'doctor'
      ])
  )
) with check (
  exists (
    select 1 from public.treatment_plans p
    where p.id = plan_id and public.can_access_branch(p.branch_id)
  )
);
create policy "Authorized clinicians may update steps"
on public.treatment_plan_steps for update using (
  exists (
    select 1 from public.treatment_plan_stages s
    join public.treatment_plans p on p.id = s.plan_id
    where s.id = stage_id and public.can_access_branch(p.branch_id)
      and public.has_org_role(p.organization_id, array[
        'organization_administrator', 'central_clinical_supervisor',
        'branch_supervisor', 'doctor'
      ])
  )
) with check (
  exists (
    select 1 from public.treatment_plan_stages s
    join public.treatment_plans p on p.id = s.plan_id
    where s.id = stage_id and public.can_access_branch(p.branch_id)
  )
);

revoke all on function public.format_tooth_identity(text, text) from public, anon;
revoke all on function public.check_appointment_conflicts(uuid, uuid, uuid, timestamptz, timestamptz, text[], uuid) from public, anon;
revoke all on function public.accept_treatment_appointment_recommendation(uuid, timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.format_tooth_identity(text, text) to authenticated;
grant execute on function public.check_appointment_conflicts(uuid, uuid, uuid, timestamptz, timestamptz, text[], uuid) to authenticated;
grant execute on function public.accept_treatment_appointment_recommendation(uuid, timestamptz, timestamptz, uuid, text) to authenticated;



create table if not exists public.clinical_safety_reference_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  reference_source text not null,
  source_version text,
  entry_type text not null check (entry_type in ('allergy', 'interaction', 'contraindication', 'duplicate', 'dosage')),
  medication_name text,
  related_medication_name text,
  condition_name text,
  allergy_name text,
  risk_description text not null,
  recommended_action text not null,
  severity text not null check (severity in ('informational', 'moderate', 'high', 'critical')),
  validated_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (length(btrim(reference_source)) between 1 and 200),
  check (length(btrim(risk_description)) between 1 and 3000),
  check (length(btrim(recommended_action)) between 1 and 3000)
);

