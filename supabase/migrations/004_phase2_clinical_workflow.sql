alter type public.patient_status add value if not exists 'archived';

alter table public.patients
  add column if not exists sex text,
  add column if not exists email text,
  add column if not exists national_id text,
  add column if not exists address text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists emergency_contact_relationship text,
  add column if not exists archived_at timestamptz;

alter table public.patients
  add constraint patients_sex_check
  check (sex is null or sex in ('female', 'male', 'other', 'not_specified'));

alter table public.patient_medical_histories
  add column if not exists source text,
  add column if not exists verified boolean not null default false,
  add column if not exists recorded_by uuid references public.profiles(id),
  add column if not exists recorded_at timestamptz not null default now();

alter table public.patient_visits
  add column if not exists visit_type text not null default 'consultation',
  add column if not exists reason text,
  add column if not exists assigned_doctor_id uuid references public.profiles(id),
  add column if not exists assigned_nurse_id uuid references public.profiles(id),
  add column if not exists responsible_supervisor_id uuid references public.profiles(id),
  add column if not exists medical_history_reviewed boolean not null default false,
  add column if not exists follow_up_instructions text,
  add column if not exists clinical_notes text,
  add column if not exists urgent_care_exception boolean not null default false,
  add column if not exists urgent_care_reason text;

alter table public.clinical_records
  add column if not exists review_comment text,
  add column if not exists correction_reason text,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz;
alter table public.clinical_records
  drop constraint if exists clinical_record_status;
alter table public.clinical_records
  add constraint clinical_record_status
  check (status in ('draft', 'submitted', 'escalated', 'approved', 'returned'));

alter table public.patient_attachments
  add column if not exists visit_id uuid references public.patient_visits(id) on delete set null,
  add column if not exists category text not null default 'other',
  add column if not exists description text,
  add column if not exists tooth_number text;

alter table public.branches
  add constraint branches_id_organization_key unique (id, organization_id);
alter table public.patients
  add constraint patients_id_organization_key unique (id, organization_id);
alter table public.patient_visits
  add constraint patient_visits_id_organization_key unique (id, organization_id);
alter table public.patient_attachments
  drop constraint if exists patient_attachments_visit_id_fkey;
alter table public.patient_attachments
  add constraint patient_attachments_visit_organization_fkey
  foreign key (visit_id, organization_id)
  references public.patient_visits(id, organization_id) on delete restrict;
alter table public.patient_attachments
  add constraint patient_attachments_id_organization_key unique (id, organization_id);

create table public.patient_history_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null,
  category text not null check (category in ('general_medical', 'dental')),
  entry_type text not null,
  details text not null,
  source text not null default 'patient_reported',
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified')),
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  constraint patient_history_entry_type_not_blank check (length(btrim(entry_type)) > 0),
  constraint patient_history_details_not_blank check (length(btrim(details)) > 0),
  constraint patient_history_source_not_blank check (length(btrim(source)) > 0)
);

create table public.patient_vitals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null,
  visit_id uuid,
  blood_pressure_systolic smallint,
  blood_pressure_diastolic smallint,
  pulse_bpm smallint,
  temperature_c numeric(4, 1),
  respiratory_rate smallint,
  oxygen_saturation numeric(5, 2),
  blood_glucose numeric(7, 2),
  weight_kg numeric(6, 2),
  height_cm numeric(6, 2),
  notes text,
  source text not null default 'measured',
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete restrict,
  check (blood_pressure_systolic is null or blood_pressure_systolic between 40 and 300),
  check (blood_pressure_diastolic is null or blood_pressure_diastolic between 20 and 200),
  check (pulse_bpm is null or pulse_bpm between 20 and 250),
  check (temperature_c is null or temperature_c between 25 and 45),
  check (respiratory_rate is null or respiratory_rate between 1 and 100),
  check (oxygen_saturation is null or oxygen_saturation between 0 and 100),
  check (blood_glucose is null or blood_glucose >= 0),
  check (weight_kg is null or weight_kg between 0 and 500),
  check (height_cm is null or height_cm between 0 and 300)
);

create table public.clinical_examinations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  visit_id uuid not null,
  chief_complaint text,
  history_of_present_illness text,
  extraoral_examination text,
  intraoral_examination text,
  tooth_examination text,
  periodontal_examination text,
  soft_tissue_examination text,
  radiographic_findings text,
  other_observations text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete cascade,
  unique (visit_id)
);

create table public.visit_diagnoses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  visit_id uuid not null,
  diagnosis_name text not null,
  diagnosis_code text,
  description text,
  anatomical_location text,
  tooth_number text,
  supporting_findings text,
  status text not null default 'active'
    check (status in ('active', 'resolved', 'ruled_out')),
  notes text,
  diagnosed_by uuid not null references public.profiles(id),
  diagnosed_at timestamptz not null default now(),
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete cascade,
  check (length(btrim(diagnosis_name)) > 0)
);

create table public.odontogram_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null,
  visit_id uuid,
  performed_procedure_id uuid,
  tooth_number text not null
    check (tooth_number ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'),
  tooth_surface text not null default 'whole_tooth'
    check (tooth_surface in ('whole_tooth', 'mesial', 'distal', 'occlusal', 'buccal', 'lingual_palatal')),
  finding text not null,
  stage text not null default 'existing'
    check (stage in ('existing', 'proposed', 'in_progress', 'completed')),
  notes text,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete restrict,
  check (length(btrim(finding)) > 0)
);

create or replace function public.is_fdi_tooth_array(tooth_numbers text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(
    tooth_number ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
  ), true)
  from unnest(coalesce(tooth_numbers, '{}'::text[])) as teeth(tooth_number)
$$;

create table public.treatment_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  title text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'awaiting_authorization', 'approved', 'scheduled', 'in_progress', 'completed', 'cancelled', 'discontinued')),
  patient_authorized_at timestamptz,
  patient_authorization_method text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete restrict,
  check (length(btrim(title)) > 0)
);

alter table public.treatment_plans
  add constraint treatment_plans_id_organization_key unique (id, organization_id);

create table public.treatment_plan_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null,
  treatment_name text not null,
  tooth_numbers text[] not null default '{}'::text[],
  description text,
  clinical_reason text,
  estimated_cost numeric(12, 2),
  estimated_duration_minutes integer,
  assigned_doctor_id uuid references public.profiles(id),
  priority text not null default 'routine'
    check (priority in ('low', 'routine', 'high', 'urgent')),
  required_materials jsonb not null default '[]'::jsonb,
  status text not null default 'proposed'
    check (status in ('proposed', 'awaiting_authorization', 'approved', 'scheduled', 'in_progress', 'completed', 'cancelled', 'discontinued')),
  patient_authorized_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plan_id, organization_id)
    references public.treatment_plans(id, organization_id) on delete cascade,
  check (length(btrim(treatment_name)) > 0),
  check (estimated_cost is null or estimated_cost >= 0),
  check (estimated_duration_minutes is null or estimated_duration_minutes > 0),
  check (jsonb_typeof(required_materials) = 'array'),
  check (public.is_fdi_tooth_array(tooth_numbers))
);

alter table public.treatment_plan_items
  add constraint treatment_plan_items_id_organization_key unique (id, organization_id);

create table public.performed_procedures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid,
  treatment_plan_item_id uuid,
  procedure_name text not null,
  tooth_numbers text[] not null default '{}'::text[],
  procedure_details text not null,
  materials_used jsonb not null default '[]'::jsonb,
  clinical_outcome text,
  performed_by uuid not null references public.profiles(id),
  performed_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete restrict,
  foreign key (treatment_plan_item_id, organization_id)
    references public.treatment_plan_items(id, organization_id) on delete restrict,
  check (length(btrim(procedure_name)) > 0),
  check (length(btrim(procedure_details)) > 0),
  check (jsonb_typeof(materials_used) = 'array'),
  check (public.is_fdi_tooth_array(tooth_numbers))
);

alter table public.performed_procedures
  add constraint performed_procedures_id_organization_key unique (id, organization_id);
alter table public.odontogram_findings
  add constraint odontogram_completed_requires_procedure
  check (stage <> 'completed' or performed_procedure_id is not null);
alter table public.odontogram_findings
  add constraint odontogram_procedure_same_organization
  foreign key (performed_procedure_id, organization_id)
  references public.performed_procedures(id, organization_id) on delete restrict;

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null,
  visit_id uuid,
  medication_name text not null,
  strength text,
  dosage text not null,
  route text not null,
  frequency text not null,
  duration text,
  quantity text,
  instructions text,
  prescribed_by uuid not null references public.profiles(id),
  prescribed_at timestamptz not null default now(),
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete restrict,
  check (length(btrim(medication_name)) > 0),
  check (length(btrim(dosage)) > 0),
  check (length(btrim(route)) > 0),
  check (length(btrim(frequency)) > 0)
);

alter table public.prescriptions
  add constraint prescriptions_id_organization_key unique (id, organization_id);

create table public.medication_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prescription_id uuid not null,
  event_type text not null
    check (event_type in ('dispensed', 'administered', 'patient_reported_taken')),
  dose text,
  notes text,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  foreign key (prescription_id, organization_id)
    references public.prescriptions(id, organization_id) on delete cascade
);

create table public.patient_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null,
  visit_id uuid,
  treatment_plan_item_id uuid,
  procedure_id uuid,
  consent_type text not null default 'clinical_treatment'
    check (consent_type in ('clinical_treatment', 'photography', 'other')),
  status text not null
    check (status in ('given', 'refused', 'withdrawn')),
  method text not null,
  notes text,
  document_attachment_id uuid references public.patient_attachments(id) on delete set null,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete restrict,
  foreign key (treatment_plan_item_id, organization_id)
    references public.treatment_plan_items(id, organization_id) on delete restrict,
  foreign key (procedure_id, organization_id)
    references public.performed_procedures(id, organization_id) on delete restrict,
  check (num_nonnulls(treatment_plan_item_id, procedure_id) <= 1),
  check (length(btrim(method)) > 0)
);

create table public.clinical_approval_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  record_type text not null
    check (record_type in ('clinical_record', 'treatment_plan', 'procedure')),
  requires_review boolean not null default false,
  reviewer_role text not null default 'branch_supervisor'
    check (reviewer_role in ('branch_supervisor', 'central_clinical_supervisor', 'organization_administrator')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  unique nulls not distinct (organization_id, branch_id, record_type)
);

create table public.clinical_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  clinical_record_id uuid references public.clinical_records(id) on delete cascade,
  treatment_plan_id uuid references public.treatment_plans(id) on delete cascade,
  treatment_plan_item_id uuid references public.treatment_plan_items(id) on delete cascade,
  procedure_id uuid references public.performed_procedures(id) on delete cascade,
  decision text not null
    check (decision in ('approved', 'returned', 'escalated')),
  comment text not null default '',
  reviewed_by uuid not null references public.profiles(id),
  reviewed_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  check (num_nonnulls(clinical_record_id, treatment_plan_id, treatment_plan_item_id, procedure_id) = 1),
  check (decision = 'approved' or length(btrim(comment)) > 0)
);

create table public.clinical_record_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  clinical_record_id uuid not null references public.clinical_records(id) on delete cascade,
  version_number integer not null,
  snapshot jsonb not null,
  change_reason text,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (clinical_record_id, version_number)
);

create table public.patient_access_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  actor_id uuid not null references public.profiles(id),
  access_reason text,
  accessed_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade
);

alter table public.patient_attachments
  add constraint patient_attachments_category_check
  check (category in ('dental_xray', 'panoramic_radiograph', 'intraoral_photo', 'clinical_photo', 'laboratory_report', 'referral', 'consent', 'treatment_document', 'other'));

create index patient_history_patient_date_idx
  on public.patient_history_entries (organization_id, patient_id, recorded_at desc);
create index patient_vitals_patient_date_idx
  on public.patient_vitals (organization_id, patient_id, recorded_at desc);
create index visit_diagnoses_visit_date_idx
  on public.visit_diagnoses (organization_id, visit_id, diagnosed_at desc);
create index odontogram_patient_date_idx
  on public.odontogram_findings (organization_id, patient_id, recorded_at desc);
create index treatment_plans_patient_date_idx
  on public.treatment_plans (organization_id, patient_id, created_at desc);
create index procedures_patient_date_idx
  on public.performed_procedures (organization_id, patient_id, performed_at desc);
create index prescriptions_patient_date_idx
  on public.prescriptions (organization_id, patient_id, prescribed_at desc);
create index clinical_reviews_queue_idx
  on public.clinical_reviews (organization_id, branch_id, reviewed_at desc);
create index patient_access_events_patient_date_idx
  on public.patient_access_events (organization_id, patient_id, accessed_at desc);

create or replace function public.guard_clinical_record_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'approved' then
    raise exception 'Approved clinical records are immutable';
  end if;
  if new.status = 'approved' then
    if tg_op = 'INSERT' then
      raise exception 'A clinical record must be submitted before approval';
    end if;
    if old.status not in ('submitted', 'escalated')
      or new.approved_by is distinct from auth.uid()
      or new.submitted_by is null
      or new.approved_by = new.submitted_by
      or not public.can_access_branch(new.branch_id)
      or not public.has_org_role(new.organization_id, array[
        'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
      ])
    then
      raise exception 'A different authorized supervisor must approve this clinical record';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.capture_clinical_record_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('draft', 'returned') and new.status = 'submitted' then
    if old.status = 'returned' and (
      new.correction_reason is null or length(btrim(new.correction_reason)) = 0
    ) then
      raise exception 'A reason is required when resubmitting a returned clinical record';
    end if;

    insert into public.clinical_record_versions (
      organization_id, clinical_record_id, version_number, snapshot, change_reason, changed_by
    )
    values (
      old.organization_id,
      old.id,
      coalesce((
        select max(version_number) + 1
        from public.clinical_record_versions
        where clinical_record_id = old.id
      ), 1),
      to_jsonb(old),
      new.correction_reason,
      auth.uid()
    );
    new.review_comment := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;

  if new.status = 'returned' and old.status = 'submitted' then
    if new.reviewed_by is distinct from auth.uid()
      or new.reviewed_at is null
      or new.review_comment is null
      or length(btrim(new.review_comment)) = 0
      or not public.can_access_branch(new.branch_id)
      or not public.has_org_role(new.organization_id, array[
        'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
      ])
    then
      raise exception 'Returning a clinical record requires an authorized reviewer and a reason';
    end if;
  end if;
  return new;
end;
$$;

create trigger clinical_record_version_capture
before update on public.clinical_records
for each row execute function public.capture_clinical_record_version();

create or replace function public.create_clinical_encounter(
  p_patient_id uuid,
  p_branch_id uuid,
  p_visit_type text,
  p_reason text,
  p_chief_complaint text,
  p_history_reviewed boolean,
  p_exam jsonb,
  p_vitals jsonb,
  p_follow_up text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_org_id uuid;
  new_visit_id uuid;
  visit_number_value text;
  exam_data jsonb := coalesce(p_exam, '{}'::jsonb);
  vital_data jsonb := coalesce(p_vitals, '{}'::jsonb);
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_patient_id is null or p_branch_id is null or length(btrim(coalesce(p_visit_type, ''))) = 0 then
    raise exception 'A patient, branch, and visit type are required';
  end if;
  if jsonb_typeof(exam_data) <> 'object' or jsonb_typeof(vital_data) <> 'object' then
    raise exception 'Examination and vital-sign data must be JSON objects';
  end if;

  select p.organization_id into target_org_id
  from public.patients p
  where p.id = p_patient_id;
  if target_org_id is null or not public.can_access_branch(p_branch_id) then
    raise exception 'Patient or branch is not accessible';
  end if;
  if not exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.organization_id = target_org_id
  ) then
    raise exception 'Patient and branch must belong to the same clinic';
  end if;
  if not public.has_org_role(target_org_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ]) then
    raise exception 'Your clinic role cannot create clinical encounters';
  end if;

  visit_number_value := 'V-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.patient_visits (
    organization_id, branch_id, patient_id, visit_number, visit_type, reason,
    chief_complaint, medical_history_reviewed, follow_up_instructions,
    assigned_doctor_id, created_by
  )
  values (
    target_org_id, p_branch_id, p_patient_id, visit_number_value, btrim(p_visit_type),
    nullif(btrim(coalesce(p_reason, '')), ''),
    nullif(btrim(coalesce(p_chief_complaint, '')), ''),
    coalesce(p_history_reviewed, false),
    nullif(btrim(coalesce(p_follow_up, '')), ''),
    case when public.has_org_role(target_org_id, array['doctor']) then current_user_id else null end,
    current_user_id
  )
  returning id into new_visit_id;

  insert into public.clinical_examinations (
    organization_id, visit_id, chief_complaint, history_of_present_illness,
    extraoral_examination, intraoral_examination, tooth_examination,
    periodontal_examination, soft_tissue_examination, radiographic_findings,
    other_observations, created_by
  )
  values (
    target_org_id, new_visit_id,
    nullif(btrim(coalesce(p_chief_complaint, '')), ''),
    nullif(btrim(coalesce(exam_data->>'history_of_present_illness', '')), ''),
    nullif(btrim(coalesce(exam_data->>'extraoral_examination', '')), ''),
    nullif(btrim(coalesce(exam_data->>'intraoral_examination', '')), ''),
    nullif(btrim(coalesce(exam_data->>'tooth_examination', '')), ''),
    nullif(btrim(coalesce(exam_data->>'periodontal_examination', '')), ''),
    nullif(btrim(coalesce(exam_data->>'soft_tissue_examination', '')), ''),
    nullif(btrim(coalesce(exam_data->>'radiographic_findings', '')), ''),
    nullif(btrim(coalesce(exam_data->>'other_observations', '')), ''),
    current_user_id
  );

  if vital_data - 'source' - 'notes' <> '{}'::jsonb
    or nullif(btrim(coalesce(vital_data->>'notes', '')), '') is not null then
    insert into public.patient_vitals (
      organization_id, patient_id, visit_id,
      blood_pressure_systolic, blood_pressure_diastolic, pulse_bpm,
      temperature_c, respiratory_rate, oxygen_saturation, blood_glucose,
      weight_kg, height_cm, notes, source, recorded_by
    )
    values (
      target_org_id, p_patient_id, new_visit_id,
      nullif(vital_data->>'blood_pressure_systolic', '')::smallint,
      nullif(vital_data->>'blood_pressure_diastolic', '')::smallint,
      nullif(vital_data->>'pulse_bpm', '')::smallint,
      nullif(vital_data->>'temperature_c', '')::numeric,
      nullif(vital_data->>'respiratory_rate', '')::smallint,
      nullif(vital_data->>'oxygen_saturation', '')::numeric,
      nullif(vital_data->>'blood_glucose', '')::numeric,
      nullif(vital_data->>'weight_kg', '')::numeric,
      nullif(vital_data->>'height_cm', '')::numeric,
      nullif(btrim(coalesce(vital_data->>'notes', '')), ''),
      coalesce(nullif(btrim(vital_data->>'source'), ''), 'measured'),
      current_user_id
    );
  end if;

  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id
  )
  values (target_org_id, p_branch_id, current_user_id, 'visit.create', 'patient_visit', new_visit_id);

  return new_visit_id;
end;
$$;

create or replace function public.assert_clinical_review_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_branch_id uuid;
begin
  if new.clinical_record_id is not null then
    select organization_id, branch_id into target_organization_id, target_branch_id
    from public.clinical_records where id = new.clinical_record_id;
    if not exists (
      select 1 from public.clinical_records r
      where r.id = new.clinical_record_id
        and r.organization_id = new.organization_id
        and r.branch_id = new.branch_id
        and r.reviewed_by = new.reviewed_by
        and r.review_comment is not distinct from nullif(new.comment, '')
        and (
          (new.decision = 'approved' and r.status = 'approved')
          or (new.decision = 'returned' and r.status = 'returned')
          or (new.decision = 'escalated' and r.status = 'escalated')
        )
    ) then
      raise exception 'Clinical review decision must match the reviewed record state';
    end if;
  elsif new.treatment_plan_id is not null then
    select organization_id, branch_id into target_organization_id, target_branch_id
    from public.treatment_plans where id = new.treatment_plan_id;
  elsif new.treatment_plan_item_id is not null then
    select p.organization_id, p.branch_id into target_organization_id, target_branch_id
    from public.treatment_plan_items i
    join public.treatment_plans p on p.id = i.plan_id
    where i.id = new.treatment_plan_item_id;
    if new.decision = 'approved' and not exists (
      select 1 from public.treatment_plan_items i
      where i.id = new.treatment_plan_item_id
        and i.organization_id = new.organization_id
        and i.status = 'approved'
        and i.approved_by = new.reviewed_by
    ) then
      raise exception 'Treatment review decision must match its approved item';
    end if;
  elsif new.procedure_id is not null then
    select organization_id, branch_id into target_organization_id, target_branch_id
    from public.performed_procedures where id = new.procedure_id;
  end if;

  if target_organization_id is distinct from new.organization_id
    or target_branch_id is distinct from new.branch_id then
    raise exception 'Clinical review target must belong to the selected clinic and branch';
  end if;
  return new;
end;
$$;

create trigger clinical_reviews_scope_guard
before insert on public.clinical_reviews
for each row execute function public.assert_clinical_review_scope();

create or replace function public.assert_visit_patient_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  visit_patient_id uuid;
  visit_branch_id uuid;
begin
  if new.visit_id is null then
    return new;
  end if;
  select patient_id, branch_id into visit_patient_id, visit_branch_id
  from public.patient_visits
  where id = new.visit_id
    and organization_id = new.organization_id;
  if visit_patient_id is distinct from new.patient_id
    or (
      tg_table_name = 'treatment_plans'
      and visit_branch_id is distinct from (to_jsonb(new)->>'branch_id')::uuid
    ) then
    raise exception 'Visit must belong to this patient, clinic, and treatment branch';
  end if;
  return new;
end;
$$;

create trigger patient_vitals_visit_patient_guard
before insert or update of patient_id, organization_id, visit_id
on public.patient_vitals
for each row execute function public.assert_visit_patient_scope();

create trigger odontogram_visit_patient_guard
before insert or update of patient_id, organization_id, visit_id
on public.odontogram_findings
for each row execute function public.assert_visit_patient_scope();

create trigger treatment_plan_visit_patient_guard
before insert or update of patient_id, organization_id, visit_id
on public.treatment_plans
for each row execute function public.assert_visit_patient_scope();

create trigger prescription_visit_patient_guard
before insert or update of patient_id, organization_id, visit_id
on public.prescriptions
for each row execute function public.assert_visit_patient_scope();

create trigger consent_visit_patient_guard
before insert or update of patient_id, organization_id, visit_id
on public.patient_consents
for each row execute function public.assert_visit_patient_scope();

create or replace function public.assert_consent_treatment_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  plan_patient_id uuid;
  plan_branch_id uuid;
  procedure_patient_id uuid;
  procedure_branch_id uuid;
  attachment_patient_id uuid;
begin
  if new.treatment_plan_item_id is not null then
    select p.patient_id, p.branch_id into plan_patient_id, plan_branch_id
    from public.treatment_plan_items i
    join public.treatment_plans p on p.id = i.plan_id
    where i.id = new.treatment_plan_item_id
      and i.organization_id = new.organization_id;
    if plan_patient_id is distinct from new.patient_id
      or not public.can_access_branch(plan_branch_id) then
      raise exception 'Treatment consent must belong to the treatment plan patient';
    end if;
  end if;
  if new.procedure_id is not null then
    select patient_id, branch_id into procedure_patient_id, procedure_branch_id
    from public.performed_procedures
    where id = new.procedure_id
      and organization_id = new.organization_id;
    if procedure_patient_id is distinct from new.patient_id
      or not public.can_access_branch(procedure_branch_id) then
      raise exception 'Procedure consent must belong to the procedure patient';
    end if;
  end if;
  if new.document_attachment_id is not null then
    select patient_id into attachment_patient_id
    from public.patient_attachments
    where id = new.document_attachment_id
      and organization_id = new.organization_id;
    if attachment_patient_id is distinct from new.patient_id then
      raise exception 'Consent document must belong to the consent patient and clinic';
    end if;
  end if;
  return new;
end;
$$;

create trigger patient_consent_treatment_scope_guard
before insert on public.patient_consents
for each row execute function public.assert_consent_treatment_scope();

create or replace function public.apply_treatment_consent_authorization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'given' and new.treatment_plan_item_id is not null then
    update public.treatment_plan_items
    set patient_authorized_at = new.recorded_at,
        updated_at = now()
    where id = new.treatment_plan_item_id
      and organization_id = new.organization_id
      and patient_authorized_at is null;
  end if;
  return new;
end;
$$;

create trigger apply_treatment_consent_authorization
after insert on public.patient_consents
for each row execute function public.apply_treatment_consent_authorization();

create or replace function public.assert_performed_procedure_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item_patient_id uuid;
  item_branch_id uuid;
  visit_patient_id uuid;
  visit_branch_id uuid;
begin
  if new.treatment_plan_item_id is not null then
    select p.patient_id, p.branch_id into item_patient_id, item_branch_id
    from public.treatment_plan_items i
    join public.treatment_plans p on p.id = i.plan_id
    where i.id = new.treatment_plan_item_id
      and i.organization_id = new.organization_id;
    if item_patient_id is distinct from new.patient_id
      or item_branch_id is distinct from new.branch_id then
      raise exception 'Performed procedure must match the treatment plan patient and branch';
    end if;
  end if;

  if new.visit_id is not null then
    select patient_id, branch_id into visit_patient_id, visit_branch_id
    from public.patient_visits
    where id = new.visit_id and organization_id = new.organization_id;
    if visit_patient_id is distinct from new.patient_id
      or visit_branch_id is distinct from new.branch_id then
      raise exception 'Performed procedure must match the visit patient and branch';
    end if;
  end if;
  return new;
end;
$$;

create trigger performed_procedure_scope_guard
before insert on public.performed_procedures
for each row execute function public.assert_performed_procedure_scope();

create or replace function public.assert_odontogram_procedure_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  procedure_patient_id uuid;
  procedure_branch_id uuid;
  procedure_teeth text[];
begin
  if new.performed_procedure_id is null then
    return new;
  end if;
  select patient_id, branch_id, tooth_numbers
  into procedure_patient_id, procedure_branch_id, procedure_teeth
  from public.performed_procedures
  where id = new.performed_procedure_id
    and organization_id = new.organization_id;
  if procedure_patient_id is distinct from new.patient_id
    or not public.can_access_branch(procedure_branch_id)
    or not (new.tooth_number = any(coalesce(procedure_teeth, '{}'::text[]))) then
    raise exception 'Completed odontogram finding must match the performed procedure and tooth';
  end if;
  return new;
end;
$$;

create trigger odontogram_procedure_scope_guard
before insert on public.odontogram_findings
for each row execute function public.assert_odontogram_procedure_scope();

create or replace function public.guard_treatment_item_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_branch_id uuid;
begin
  if old.status = 'approved'
    and new.status = 'approved'
    and (
      new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
    ) then
    raise exception 'Treatment approval metadata is immutable';
  end if;

  if new.approved_by is not null
    and (
      new.status <> 'approved'
      or new.approved_by is distinct from auth.uid()
      or new.approved_at is null
      or not public.has_org_role(new.organization_id, array[
        'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
      ])
    ) then
    raise exception 'Clinical approval metadata must be set by an authorized reviewer while approving';
  end if;
  if new.approved_at is not null and new.approved_by is null then
    raise exception 'An approval timestamp requires an approving clinician';
  end if;

  if new.patient_authorized_at is not null
    and not exists (
      select 1 from public.patient_consents c
      where c.treatment_plan_item_id = new.id
        and c.organization_id = new.organization_id
        and c.status = 'given'
        and c.recorded_at = new.patient_authorized_at
    ) then
    raise exception 'Patient authorization must be supported by a recorded consent event';
  end if;

  if new.status = old.status then
    return new;
  end if;

  select branch_id into parent_branch_id
  from public.treatment_plans
  where id = new.plan_id and organization_id = new.organization_id;
  if parent_branch_id is null or not public.can_access_branch(parent_branch_id) then
    raise exception 'Treatment plan branch is not accessible';
  end if;

  if not (
    (old.status = 'proposed' and new.status in ('awaiting_authorization', 'cancelled', 'discontinued'))
    or (old.status = 'awaiting_authorization' and new.status in ('approved', 'cancelled', 'discontinued'))
    or (old.status = 'approved' and new.status in ('scheduled', 'in_progress', 'cancelled', 'discontinued'))
    or (old.status = 'scheduled' and new.status in ('in_progress', 'cancelled', 'discontinued'))
    or (old.status = 'in_progress' and new.status in ('completed', 'discontinued'))
  ) then
    raise exception 'Invalid treatment status transition';
  end if;

  if new.status in ('approved', 'scheduled', 'in_progress', 'completed')
    and new.patient_authorized_at is null then
    raise exception 'Patient authorization is required before treatment proceeds';
  end if;
  if new.status = 'approved'
    and (
      new.approved_by is distinct from auth.uid()
      or new.approved_at is null
      or not public.has_org_role(new.organization_id, array[
        'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
      ])
    ) then
    raise exception 'Treatment approval requires an authorized clinical supervisor';
  end if;
  if new.status = 'completed' and not exists (
    select 1 from public.performed_procedures p
    where p.treatment_plan_item_id = new.id
      and p.organization_id = new.organization_id
  ) then
    raise exception 'A completed treatment requires a recorded performed procedure';
  end if;
  return new;
end;
$$;

create trigger treatment_item_state_guard
before update of status, patient_authorized_at, approved_by, approved_at
on public.treatment_plan_items
for each row execute function public.guard_treatment_item_state();

create or replace function public.audit_treatment_item_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_branch_id uuid;
begin
  if new.status = 'approved' and old.status <> 'approved' then
    select branch_id into target_branch_id
    from public.treatment_plans
    where id = new.plan_id and organization_id = new.organization_id;
    insert into public.clinical_reviews (
      organization_id, branch_id, treatment_plan_item_id,
      decision, comment, reviewed_by
    )
    values (
      new.organization_id, target_branch_id, new.id,
      'approved', '', new.approved_by
    );
    insert into public.audit_events (
      organization_id, branch_id, actor_id, action, entity_type, entity_id
    )
    values (
      new.organization_id, target_branch_id, new.approved_by,
      'treatment_plan_item.approved', 'treatment_plan_item', new.id
    );
  end if;
  return new;
end;
$$;

create trigger treatment_item_approval_audit
after update of status on public.treatment_plan_items
for each row execute function public.audit_treatment_item_approval();

create or replace function public.apply_consent_to_treatment_authorization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.treatment_plan_item_id is not null then
    update public.treatment_plan_items
    set patient_authorized_at = case
      when new.status = 'given' then new.recorded_at
      else null
    end,
    updated_at = now()
    where id = new.treatment_plan_item_id
      and organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

create trigger patient_consent_treatment_authorization
after insert on public.patient_consents
for each row execute function public.apply_consent_to_treatment_authorization();

create or replace function public.assert_consent_attachment_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.document_attachment_id is not null and not exists (
    select 1 from public.patient_attachments a
    where a.id = new.document_attachment_id
      and a.organization_id = new.organization_id
      and a.patient_id = new.patient_id
      and (new.visit_id is null or a.visit_id is null or a.visit_id = new.visit_id)
  ) then
    raise exception 'Consent attachment must belong to this patient and clinic';
  end if;
  return new;
end;
$$;

create trigger patient_consent_attachment_scope_guard
before insert on public.patient_consents
for each row execute function public.assert_consent_attachment_scope();

create or replace function public.assert_patient_attachment_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  patient_branch_id uuid;
  visit_patient_id uuid;
  visit_branch_id uuid;
  path_organization_id uuid;
  path_branch_id uuid;
  path_patient_id uuid;
begin
  if split_part(new.storage_path, '/', 1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or split_part(new.storage_path, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or split_part(new.storage_path, '/', 3) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Clinical document path must include clinic, branch, and patient identifiers';
  end if;
  path_organization_id := split_part(new.storage_path, '/', 1)::uuid;
  path_branch_id := split_part(new.storage_path, '/', 2)::uuid;
  path_patient_id := split_part(new.storage_path, '/', 3)::uuid;

  select registered_branch_id into patient_branch_id
  from public.patients
  where id = new.patient_id and organization_id = new.organization_id;
  if new.storage_bucket <> 'clinical-documents'
    or path_organization_id is distinct from new.organization_id
    or path_branch_id is distinct from patient_branch_id
    or path_patient_id is distinct from new.patient_id then
    raise exception 'Clinical document metadata and storage path must match the patient and clinic';
  end if;

  if new.visit_id is not null then
    select patient_id, branch_id into visit_patient_id, visit_branch_id
    from public.patient_visits
    where id = new.visit_id and organization_id = new.organization_id;
    if visit_patient_id is distinct from new.patient_id
      or visit_branch_id is distinct from patient_branch_id then
      raise exception 'Clinical document visit must belong to this patient and branch';
    end if;
  end if;
  return new;
end;
$$;

create trigger patient_attachment_scope_guard
before insert or update on public.patient_attachments
for each row execute function public.assert_patient_attachment_scope();

create or replace function public.review_clinical_record(
  p_clinical_record_id uuid,
  p_decision text,
  p_comment text default ''
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.clinical_records%rowtype;
  normalized_comment text := btrim(coalesce(p_comment, ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_decision not in ('approved', 'returned', 'escalated') then
    raise exception 'Choose approve, return, or escalate';
  end if;
  if p_decision <> 'approved' and normalized_comment = '' then
    raise exception 'A reason is required when returning or escalating a record';
  end if;

  select * into target from public.clinical_records
  where id = p_clinical_record_id and status in ('submitted', 'escalated');
  if not found or not public.can_access_branch(target.branch_id)
    or not public.has_org_role(target.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
    ]) then
    raise exception 'Submitted record not found or reviewer is not authorized';
  end if;
  if target.status = 'escalated'
    and not public.has_org_role(target.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor'
    ]) then
    raise exception 'Escalated cases require central clinical supervision';
  end if;

  if p_decision in ('approved', 'returned', 'escalated') then
    update public.clinical_records
    set status = case when p_decision = 'escalated' then 'escalated' else p_decision end,
        approved_by = case when p_decision = 'approved' then auth.uid() else null end,
        approved_at = case when p_decision = 'approved' then now() else null end,
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_comment = nullif(normalized_comment, ''),
        updated_at = now()
    where id = target.id;
  end if;

  insert into public.clinical_reviews (
    organization_id, branch_id, clinical_record_id, decision, comment, reviewed_by
  )
  values (
    target.organization_id, target.branch_id, target.id, p_decision,
    normalized_comment, auth.uid()
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
  )
  values (
    target.organization_id, target.branch_id, auth.uid(),
    'clinical_record.' || p_decision, 'clinical_record', target.id,
    jsonb_build_object('comment', normalized_comment)
  );
end;
$$;

create or replace function public.create_treatment_plan_with_item(
  p_patient_id uuid,
  p_branch_id uuid,
  p_visit_id uuid,
  p_title text,
  p_treatment_name text,
  p_tooth_numbers text[],
  p_description text,
  p_clinical_reason text,
  p_estimated_cost numeric,
  p_estimated_duration_minutes integer,
  p_priority text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_org_id uuid;
  new_plan_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if length(btrim(coalesce(p_title, ''))) = 0
    or length(btrim(coalesce(p_treatment_name, ''))) = 0 then
    raise exception 'A treatment plan title and treatment item are required';
  end if;
  select organization_id into target_org_id
  from public.patients where id = p_patient_id;
  if target_org_id is null
    or not exists (
      select 1 from public.branches b
      where b.id = p_branch_id and b.organization_id = target_org_id
        and public.can_access_branch(b.id)
    )
    or not public.has_org_role(target_org_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor'
    ]) then
    raise exception 'Patient or branch is not accessible for treatment planning';
  end if;

  insert into public.treatment_plans (
    organization_id, branch_id, patient_id, visit_id, title, created_by
  )
  values (
    target_org_id, p_branch_id, p_patient_id, p_visit_id, btrim(p_title), current_user_id
  )
  returning id into new_plan_id;

  insert into public.treatment_plan_items (
    organization_id, plan_id, treatment_name, tooth_numbers, description,
    clinical_reason, estimated_cost, estimated_duration_minutes, priority, created_by
  )
  values (
    target_org_id, new_plan_id, btrim(p_treatment_name), coalesce(p_tooth_numbers, '{}'::text[]),
    nullif(btrim(coalesce(p_description, '')), ''),
    nullif(btrim(coalesce(p_clinical_reason, '')), ''),
    p_estimated_cost, p_estimated_duration_minutes, coalesce(nullif(p_priority, ''), 'routine'),
    current_user_id
  );

  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id
  )
  values (target_org_id, p_branch_id, current_user_id, 'treatment_plan.create', 'treatment_plan', new_plan_id);
  return new_plan_id;
end;
$$;

alter table public.patient_history_entries enable row level security;
alter table public.patient_vitals enable row level security;
alter table public.clinical_examinations enable row level security;
alter table public.visit_diagnoses enable row level security;
alter table public.odontogram_findings enable row level security;
alter table public.treatment_plans enable row level security;
alter table public.treatment_plan_items enable row level security;
alter table public.performed_procedures enable row level security;
alter table public.prescriptions enable row level security;
alter table public.medication_events enable row level security;
alter table public.patient_consents enable row level security;
alter table public.clinical_approval_rules enable row level security;
alter table public.clinical_reviews enable row level security;
alter table public.clinical_record_versions enable row level security;
alter table public.patient_access_events enable row level security;

create policy "Patient history is branch readable"
on public.patient_history_entries for select using (
  exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
);
create policy "Clinical staff append patient history"
on public.patient_history_entries for insert with check (
  recorded_by = auth.uid()
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ])
);

create policy "Patient vitals are branch readable"
on public.patient_vitals for select using (
  exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
);
create policy "Clinical staff append patient vitals"
on public.patient_vitals for insert with check (
  recorded_by = auth.uid()
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ])
);

create policy "Examinations are branch readable"
on public.clinical_examinations for select using (
  exists (
    select 1 from public.patient_visits v
    where v.id = visit_id and v.organization_id = organization_id
      and public.can_access_branch(v.branch_id)
  )
);
create policy "Clinical staff create examinations"
on public.clinical_examinations for insert with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.patient_visits v
    where v.id = visit_id and v.organization_id = organization_id
      and public.can_access_branch(v.branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ])
);

create policy "Diagnoses are branch readable"
on public.visit_diagnoses for select using (
  exists (
    select 1 from public.patient_visits v
    where v.id = visit_id and v.organization_id = organization_id
      and public.can_access_branch(v.branch_id)
  )
);
create policy "Doctors and supervisors record diagnoses"
on public.visit_diagnoses for insert with check (
  diagnosed_by = auth.uid()
  and exists (
    select 1 from public.patient_visits v
    where v.id = visit_id and v.organization_id = organization_id
      and public.can_access_branch(v.branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor'
  ])
);

create policy "Odontogram findings are branch readable"
on public.odontogram_findings for select using (
  exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
);
create policy "Clinical staff append odontogram findings"
on public.odontogram_findings for insert with check (
  recorded_by = auth.uid()
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor'
  ])
);

create policy "Treatment plans are branch readable"
on public.treatment_plans for select using (public.can_access_branch(branch_id));
create policy "Clinical staff create treatment plans"
on public.treatment_plans for insert with check (
  created_by = auth.uid()
  and public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor'
  ])
);
create policy "Treatment plan items are branch readable"
on public.treatment_plan_items for select using (
  exists (
    select 1 from public.treatment_plans p
    where p.id = plan_id and p.organization_id = organization_id
      and public.can_access_branch(p.branch_id)
  )
);
create policy "Clinical staff create treatment plan items"
on public.treatment_plan_items for insert with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.treatment_plans p
    where p.id = plan_id and p.organization_id = organization_id
      and public.can_access_branch(p.branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor'
  ])
);
create policy "Authorized supervisors update treatment plan items"
on public.treatment_plan_items for update using (
  (
    (
      created_by = auth.uid()
      and public.has_org_role(organization_id, array[
        'organization_administrator', 'central_clinical_supervisor',
        'branch_supervisor', 'doctor'
      ])
    )
    or public.has_org_role(organization_id, array[
      'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
    ])
  )
  and exists (
    select 1 from public.treatment_plans p
    where p.id = plan_id and public.can_access_branch(p.branch_id)
  )
)
with check (
  public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor'
  ])
  and exists (
    select 1 from public.treatment_plans p
    where p.id = plan_id and p.organization_id = organization_id
      and public.can_access_branch(p.branch_id)
  )
);

create policy "Performed procedures are branch readable"
on public.performed_procedures for select using (public.can_access_branch(branch_id));
create policy "Clinical staff record performed procedures"
on public.performed_procedures for insert with check (
  performed_by = auth.uid()
  and public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor'
  ])
);

create policy "Prescriptions are branch readable"
on public.prescriptions for select using (
  exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
);
create policy "Doctors and supervisors create prescriptions"
on public.prescriptions for insert with check (
  prescribed_by = auth.uid()
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor'
  ])
);

create policy "Medication events are branch readable"
on public.medication_events for select using (
  exists (
    select 1 from public.prescriptions p
    join public.patients patient
      on patient.id = p.patient_id
      and patient.organization_id = p.organization_id
    where p.id = medication_events.prescription_id
      and p.organization_id = medication_events.organization_id
      and public.can_access_branch(patient.registered_branch_id)
  )
);
create policy "Authorized staff record medication events"
on public.medication_events for insert with check (
  recorded_by = auth.uid()
  and exists (
    select 1 from public.prescriptions p
    join public.patients patient
      on patient.id = p.patient_id
      and patient.organization_id = p.organization_id
    where p.id = medication_events.prescription_id
      and p.organization_id = medication_events.organization_id
      and public.can_access_branch(patient.registered_branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ])
);

create policy "Patient consents are branch readable"
on public.patient_consents for select using (
  exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
);
create policy "Clinical staff append patient consent"
on public.patient_consents for insert with check (
  recorded_by = auth.uid()
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ])
);

create policy "Clinic admins read clinical approval rules"
on public.clinical_approval_rules for select using (
  public.has_org_role(organization_id, array['organization_administrator'])
);
create policy "Clinic admins create clinical approval rules"
on public.clinical_approval_rules for insert with check (
  created_by = auth.uid()
  and public.has_org_role(organization_id, array['organization_administrator'])
);
create policy "Clinic admins update clinical approval rules"
on public.clinical_approval_rules for update using (
  public.has_org_role(organization_id, array['organization_administrator'])
)
with check (
  public.has_org_role(organization_id, array['organization_administrator'])
);

create policy "Clinical reviews are branch readable"
on public.clinical_reviews for select using (public.can_access_branch(branch_id));
create policy "Authorized supervisors record clinical reviews"
on public.clinical_reviews for insert with check (
  reviewed_by = auth.uid()
  and public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
  ])
);

create policy "Clinical record versions are branch readable"
on public.clinical_record_versions for select using (
  exists (
    select 1 from public.clinical_records r
    where r.id = clinical_record_id and r.organization_id = organization_id
      and public.can_access_branch(r.branch_id)
  )
);

create policy "Patient access events are visible to clinic supervisors"
on public.patient_access_events for select using (
  public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor'
  ])
);
create policy "Clinic members record patient access"
on public.patient_access_events for insert with check (
  actor_id = auth.uid()
  and public.can_access_branch(branch_id)
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
);

drop policy if exists "Authorized users create attachments" on public.patient_attachments;
create policy "Clinical staff create patient attachments"
on public.patient_attachments for insert with check (
  uploaded_by = auth.uid()
  and storage_bucket = 'clinical-documents'
  and split_part(storage_path, '/', 1) = organization_id::text
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.organization_id = organization_id
      and p.registered_branch_id = split_part(storage_path, '/', 2)::uuid
      and public.can_access_branch(p.registered_branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ])
);

drop policy if exists "Clinical document objects are uploaded by authorized branch members" on storage.objects;
create policy "Clinical document objects are uploaded by authorized clinical staff"
on storage.objects for insert with check (
  bucket_id = 'clinical-documents'
  and public.can_access_clinical_document(name)
  and public.has_org_role(
    split_part(name, '/', 1)::uuid,
    array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor', 'nurse'
    ]
  )
);

create policy "Clinical staff update submitted records for review"
on public.clinical_records for update using (
  public.can_access_branch(branch_id)
  and (
    (submitted_by = auth.uid() and status in ('draft', 'returned'))
    or (
      status in ('submitted', 'escalated')
      and public.has_org_role(organization_id, array[
        'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
      ])
    )
  )
)
with check (
  public.can_access_branch(branch_id)
  and (
    (submitted_by = auth.uid() and status in ('submitted', 'returned'))
    or (
      status in ('submitted', 'escalated', 'approved', 'returned')
      and public.has_org_role(organization_id, array[
        'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
      ])
    )
  )
);

revoke update, delete on
  public.patient_history_entries,
  public.patient_vitals,
  public.clinical_examinations,
  public.visit_diagnoses,
  public.odontogram_findings,
  public.performed_procedures,
  public.prescriptions,
  public.medication_events,
  public.patient_consents,
  public.clinical_reviews,
  public.clinical_record_versions,
  public.patient_access_events
from authenticated;
revoke delete on
  public.treatment_plans,
  public.treatment_plan_items,
  public.clinical_approval_rules
from authenticated;

grant select, insert on
  public.patient_history_entries,
  public.patient_vitals,
  public.clinical_examinations,
  public.visit_diagnoses,
  public.odontogram_findings,
  public.treatment_plans,
  public.treatment_plan_items,
  public.performed_procedures,
  public.prescriptions,
  public.medication_events,
  public.patient_consents,
  public.clinical_reviews,
  public.patient_access_events
to authenticated;
grant select on public.clinical_record_versions to authenticated;
grant insert (visit_id, category, description, tooth_number)
on public.patient_attachments to authenticated;
grant select, insert on public.clinical_approval_rules to authenticated;
grant update (branch_id, record_type, requires_review, reviewer_role, updated_at)
on public.clinical_approval_rules to authenticated;
grant update (status, patient_authorized_at, approved_by, approved_at, updated_at)
on public.treatment_plan_items to authenticated;
grant update (
  title, diagnosis, treatment_plan, completed_procedures, prescriptions, tooth_chart,
  status, review_comment, correction_reason, reviewed_by, reviewed_at, approved_by, approved_at, updated_at
) on public.clinical_records to authenticated;
grant update (
  sex, email, national_id, address, emergency_contact_name,
  emergency_contact_phone, emergency_contact_relationship, updated_at
) on public.patients to authenticated;
grant insert (
  sex, email, national_id, address, emergency_contact_name,
  emergency_contact_phone, emergency_contact_relationship
) on public.patients to authenticated;
grant update (full_name, date_of_birth, phone) on public.patients to authenticated;
grant update (archived_at) on public.patients to authenticated;
grant insert (
  visit_type, reason, chief_complaint, medical_history_reviewed,
  follow_up_instructions, assigned_doctor_id, created_by
) on public.patient_visits to authenticated;
grant all on all tables in schema public to service_role;
revoke all on
  public.patient_history_entries,
  public.patient_vitals,
  public.clinical_examinations,
  public.visit_diagnoses,
  public.odontogram_findings,
  public.treatment_plans,
  public.treatment_plan_items,
  public.performed_procedures,
  public.prescriptions,
  public.medication_events,
  public.patient_consents,
  public.clinical_approval_rules,
  public.clinical_reviews,
  public.clinical_record_versions,
  public.patient_access_events
from anon;
revoke all on function public.create_clinical_encounter(
  uuid, uuid, text, text, text, boolean, jsonb, jsonb, text
) from public, anon;
revoke all on function public.create_treatment_plan_with_item(
  uuid, uuid, uuid, text, text, text[], text, text, numeric, integer, text
) from public, anon;
revoke all on function public.review_clinical_record(uuid, text, text) from public, anon;
grant execute on function public.create_clinical_encounter(
  uuid, uuid, text, text, text, boolean, jsonb, jsonb, text
) to authenticated;
grant execute on function public.create_treatment_plan_with_item(
  uuid, uuid, uuid, text, text, text[], text, text, numeric, integer, text
) to authenticated;
grant execute on function public.review_clinical_record(uuid, text, text) to authenticated;
