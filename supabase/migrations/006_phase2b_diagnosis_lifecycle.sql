alter table public.visit_diagnoses
  add column certainty text not null default 'confirmed',
  add column priority text not null default 'routine',
  add column diagnostic_reasoning text,
  add column conflicting_findings text,
  add column required_investigations text,
  add column priority_reason text;

alter table public.visit_diagnoses
  alter column certainty set default 'provisional',
  add constraint visit_diagnoses_certainty_check
    check (certainty in ('suspected', 'provisional', 'confirmed', 'differential')),
  add constraint visit_diagnoses_priority_check
    check (priority in ('routine', 'priority', 'urgent', 'emergency')),
  add constraint visit_diagnoses_diagnostic_reasoning_length_check
    check (diagnostic_reasoning is null or length(diagnostic_reasoning) <= 2000),
  add constraint visit_diagnoses_conflicting_findings_length_check
    check (conflicting_findings is null or length(conflicting_findings) <= 2000),
  add constraint visit_diagnoses_required_investigations_length_check
    check (required_investigations is null or length(required_investigations) <= 2000),
  add constraint visit_diagnoses_priority_reason_length_check
    check (priority_reason is null or length(priority_reason) <= 1000);

create index visit_diagnoses_open_priority_idx
  on public.visit_diagnoses (organization_id, branch_id, priority, diagnosed_at desc)
  where status in ('active', 'under_treatment');

create table public.visit_diagnosis_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  diagnosis_id uuid not null,
  visit_id uuid not null,
  status text not null,
  certainty text not null,
  priority text not null,
  severity text,
  progression text not null,
  assessment_reason text not null,
  supporting_findings text,
  conflicting_findings text,
  required_investigations text,
  priority_reason text,
  assessed_by uuid not null references public.profiles(id),
  assessed_at timestamptz not null default now(),
  unique (id, diagnosis_id, organization_id),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (diagnosis_id, organization_id)
    references public.visit_diagnoses(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete cascade,
  check (status in (
    'active', 'under_treatment', 'resolved', 'historical', 'ruled_out', 'entered_in_error'
  )),
  check (certainty in ('suspected', 'provisional', 'confirmed', 'differential')),
  check (priority in ('routine', 'priority', 'urgent', 'emergency')),
  check (severity is null or severity in ('mild', 'moderate', 'severe', 'critical', 'unspecified')),
  check (progression in (
    'improved', 'worsened', 'unchanged', 'resolved', 'recurrence', 'complicated', 'undetermined'
  )),
  check (length(btrim(assessment_reason)) between 1 and 2000),
  check (supporting_findings is null or length(supporting_findings) <= 2000),
  check (conflicting_findings is null or length(conflicting_findings) <= 2000),
  check (required_investigations is null or length(required_investigations) <= 2000),
  check (priority_reason is null or length(priority_reason) <= 1000)
);

create index visit_diagnosis_assessments_timeline_idx
  on public.visit_diagnosis_assessments (organization_id, diagnosis_id, assessed_at desc);
create index visit_diagnosis_assessments_patient_idx
  on public.visit_diagnosis_assessments (organization_id, patient_id, assessed_at desc);

create table public.clinical_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  diagnosis_id uuid not null,
  visit_id uuid not null,
  assessment_id uuid,
  performed_procedure_id uuid,
  outcome text not null,
  clinical_findings text not null,
  complications text,
  further_treatment_required text,
  assessed_by uuid not null references public.profiles(id),
  assessed_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (diagnosis_id, organization_id)
    references public.visit_diagnoses(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete cascade,
  foreign key (assessment_id, diagnosis_id, organization_id)
    references public.visit_diagnosis_assessments(id, diagnosis_id, organization_id) on delete cascade,
  foreign key (performed_procedure_id, organization_id)
    references public.performed_procedures(id, organization_id)
    on delete no action deferrable initially deferred,
  check (outcome in (
    'improved', 'worsened', 'unchanged', 'resolved', 'recurrence', 'complicated', 'undetermined'
  )),
  check (length(btrim(clinical_findings)) between 1 and 2000),
  check (complications is null or length(complications) <= 2000),
  check (further_treatment_required is null or length(further_treatment_required) <= 2000)
);

create index clinical_outcomes_diagnosis_timeline_idx
  on public.clinical_outcomes (organization_id, diagnosis_id, assessed_at desc);
create index clinical_outcomes_patient_timeline_idx
  on public.clinical_outcomes (organization_id, patient_id, assessed_at desc);

create or replace function public.is_valid_diagnosis_status_transition(
  current_status text,
  next_status text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when current_status = 'entered_in_error' then false
  when current_status = next_status then true
    when current_status = 'resolved' then next_status in ('active', 'historical')
    when current_status = 'ruled_out' then next_status in ('active', 'historical')
    else next_status in (
      'active', 'under_treatment', 'resolved', 'historical', 'ruled_out', 'entered_in_error'
    )
  end
$$;

create or replace function public.guard_visit_diagnosis_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.diagnosis_state_change', true) is distinct from 'authorized' then
    raise exception using errcode = '42501', message = 'Diagnosis changes must use the authorized diagnosis workflow';
  end if;
  return new;
end;
$$;

create trigger visit_diagnosis_authorized_update
before update on public.visit_diagnoses
for each row execute function public.guard_visit_diagnosis_update();

create or replace function public.capture_visit_diagnosis_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_name text;
  actor uuid;
  change_reason text;
begin
  actor := coalesce(auth.uid(), new.diagnosed_by);
  change_reason := nullif(current_setting('app.diagnosis_change_reason', true), '');

  if tg_op = 'INSERT' then
    insert into public.visit_diagnosis_events (
      organization_id, branch_id, diagnosis_id, event_type, new_status, reason, actor_id, details
    ) values (
      new.organization_id, new.branch_id, new.id, 'recorded', new.status,
      change_reason, actor,
      jsonb_build_object(
        'certainty', new.certainty,
        'priority', new.priority,
        'category', new.category
      )
    );
    insert into public.audit_events (
      organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
    ) values (
      new.organization_id, new.branch_id, actor, 'diagnosis.create',
      'visit_diagnosis', new.id,
      jsonb_build_object(
        'status', new.status,
        'certainty', new.certainty,
        'priority', new.priority,
        'category', new.category
      )
    );
  else
    action_name := case
      when new.status is distinct from old.status then 'status_changed'
      else 'corrected'
    end;
    insert into public.visit_diagnosis_events (
      organization_id, branch_id, diagnosis_id, event_type, previous_status, new_status,
      reason, actor_id, details
    ) values (
      new.organization_id, new.branch_id, new.id, action_name, old.status, new.status,
      change_reason, actor,
      jsonb_build_object(
        'previous_certainty', old.certainty,
        'new_certainty', new.certainty,
        'previous_priority', old.priority,
        'new_priority', new.priority,
        'previous_severity', old.severity,
        'new_severity', new.severity,
        'previous_name', old.diagnosis_name,
        'new_name', new.diagnosis_name
      )
    );
    insert into public.audit_events (
      organization_id, branch_id, actor_id, action, entity_type, entity_id, before_data, after_data
    ) values (
      new.organization_id, new.branch_id, actor, 'diagnosis.' || action_name,
      'visit_diagnosis', new.id,
      jsonb_build_object(
        'status', old.status,
        'certainty', old.certainty,
        'priority', old.priority
      ),
      jsonb_build_object(
        'status', new.status,
        'certainty', new.certainty,
        'priority', new.priority,
        'reason', change_reason
      )
    );
  end if;

  return new;
end;
$$;

create or replace function public.assert_diagnosis_assessment_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  diagnosis_patient_id uuid;
  visit_patient_id uuid;
  visit_branch_id uuid;
begin
  select d.patient_id into diagnosis_patient_id
  from public.visit_diagnoses d
  where d.id = new.diagnosis_id
    and d.organization_id = new.organization_id;
  select v.patient_id, v.branch_id into visit_patient_id, visit_branch_id
  from public.patient_visits v
  where v.id = new.visit_id
    and v.organization_id = new.organization_id;
  if diagnosis_patient_id is distinct from new.patient_id
    or visit_patient_id is distinct from new.patient_id
    or visit_branch_id is distinct from new.branch_id then
    raise exception 'Diagnosis assessment must match its diagnosis, patient, visit, clinic, and branch';
  end if;
  return new;
end;
$$;

create trigger visit_diagnosis_assessment_scope_guard
before insert on public.visit_diagnosis_assessments
for each row execute function public.assert_diagnosis_assessment_scope();

create or replace function public.assert_clinical_outcome_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  diagnosis_patient_id uuid;
  visit_patient_id uuid;
  visit_branch_id uuid;
  procedure_patient_id uuid;
  procedure_branch_id uuid;
begin
  select d.patient_id into diagnosis_patient_id
  from public.visit_diagnoses d
  where d.id = new.diagnosis_id
    and d.organization_id = new.organization_id;
  select v.patient_id, v.branch_id into visit_patient_id, visit_branch_id
  from public.patient_visits v
  where v.id = new.visit_id
    and v.organization_id = new.organization_id;
  if diagnosis_patient_id is distinct from new.patient_id
    or visit_patient_id is distinct from new.patient_id
    or visit_branch_id is distinct from new.branch_id then
    raise exception 'Clinical outcome must match its diagnosis, patient, visit, clinic, and branch';
  end if;

  if new.performed_procedure_id is not null then
    select p.patient_id, p.branch_id into procedure_patient_id, procedure_branch_id
    from public.performed_procedures p
    where p.id = new.performed_procedure_id
      and p.organization_id = new.organization_id;
    if procedure_patient_id is distinct from new.patient_id
      or procedure_branch_id is distinct from new.branch_id then
      raise exception 'Clinical outcome procedure must belong to the same patient, clinic, and branch';
    end if;
  end if;
  return new;
end;
$$;

create trigger clinical_outcome_scope_guard
before insert on public.clinical_outcomes
for each row execute function public.assert_clinical_outcome_scope();

create or replace function public.audit_diagnosis_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    new.organization_id, new.branch_id, new.assessed_by,
    'diagnosis.reassess', 'visit_diagnosis', new.diagnosis_id,
    jsonb_build_object(
      'assessment_id', new.id,
      'visit_id', new.visit_id,
      'progression', new.progression,
      'certainty', new.certainty,
      'priority', new.priority
    )
  );
  return new;
end;
$$;

create trigger visit_diagnosis_assessment_audit
after insert on public.visit_diagnosis_assessments
for each row execute function public.audit_diagnosis_assessment();

create or replace function public.audit_clinical_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    new.organization_id, new.branch_id, new.assessed_by,
    'diagnosis.outcome', 'clinical_outcome', new.id,
    jsonb_build_object(
      'diagnosis_id', new.diagnosis_id,
      'visit_id', new.visit_id,
      'outcome', new.outcome
    )
  );
  return new;
end;
$$;

create trigger clinical_outcome_audit
after insert on public.clinical_outcomes
for each row execute function public.audit_clinical_outcome();

create or replace function public.update_visit_diagnosis_state(
  target_diagnosis_id uuid,
  input_status text,
  input_certainty text,
  input_priority text,
  input_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  diagnosis_row public.visit_diagnoses%rowtype;
  normalized_reason text := nullif(btrim(input_reason), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select d.* into diagnosis_row
  from public.visit_diagnoses d
  where d.id = target_diagnosis_id;
  if not found then
    raise exception using errcode = '22023', message = 'Diagnosis not found';
  end if;
  if not public.can_access_branch(diagnosis_row.branch_id)
    or not public.has_org_role(diagnosis_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor'
    ]) then
    raise exception using errcode = '42501', message = 'You are not authorized to update this diagnosis';
  end if;
  if input_status is null or input_certainty is null or input_priority is null
    or input_status not in (
      'active', 'under_treatment', 'resolved', 'historical', 'ruled_out', 'entered_in_error'
    ) or input_certainty not in ('suspected', 'provisional', 'confirmed', 'differential')
    or input_priority not in ('routine', 'priority', 'urgent', 'emergency') then
    raise exception using errcode = '22023', message = 'Choose a valid diagnosis status, certainty, and priority';
  end if;
  if not public.is_valid_diagnosis_status_transition(diagnosis_row.status, input_status) then
    raise exception using errcode = '22023', message = 'This diagnosis status transition is not allowed';
  end if;
  if input_status = 'resolved' and input_certainty <> 'confirmed' then
    raise exception using errcode = '22023', message = 'Only a confirmed diagnosis can be marked resolved';
  end if;
  if normalized_reason is null or length(normalized_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Provide a reason of up to 1000 characters for this diagnosis change';
  end if;
  if diagnosis_row.status = input_status
    and diagnosis_row.certainty = input_certainty
    and diagnosis_row.priority = input_priority then
    raise exception using errcode = '22023', message = 'No diagnosis state changes were provided';
  end if;

  perform set_config('app.diagnosis_state_change', 'authorized', true);
  perform set_config('app.diagnosis_change_reason', normalized_reason, true);
  update public.visit_diagnoses
  set status = input_status,
      certainty = input_certainty,
      priority = input_priority,
      priority_reason = case
        when diagnosis_row.priority is distinct from input_priority then normalized_reason
        else diagnosis_row.priority_reason
      end
  where id = diagnosis_row.id;
  return diagnosis_row.id;
end;
$$;

create or replace function public.record_visit_diagnosis_v2(
  target_visit_id uuid,
  target_catalog_entry_id uuid,
  input_diagnosis_name text,
  input_diagnosis_code text,
  input_code_system text,
  input_category text,
  input_description text,
  input_anatomical_location text,
  input_tooth_numbers text[],
  input_tooth_surface text,
  input_severity text,
  input_supporting_findings text,
  input_clinical_notes text,
  input_certainty text,
  input_priority text,
  input_diagnostic_reasoning text,
  input_conflicting_findings text,
  input_required_investigations text,
  input_priority_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_diagnosis_id uuid;
  normalized_reasoning text := nullif(btrim(input_diagnostic_reasoning), '');
  normalized_priority_reason text := nullif(btrim(input_priority_reason), '');
begin
  if input_certainty is null or input_priority is null
    or input_certainty not in ('suspected', 'provisional', 'confirmed', 'differential')
    or input_priority not in ('routine', 'priority', 'urgent', 'emergency') then
    raise exception using errcode = '22023', message = 'Choose a valid diagnostic certainty and priority';
  end if;
  if normalized_reasoning is null or length(normalized_reasoning) > 2000 then
    raise exception using errcode = '22023', message = 'Document why this diagnosis is being considered';
  end if;
  if input_conflicting_findings is not null and length(input_conflicting_findings) > 2000
    or input_required_investigations is not null and length(input_required_investigations) > 2000
    or normalized_priority_reason is not null and length(normalized_priority_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Diagnosis findings, investigations, or priority reason are too long';
  end if;
  if input_priority <> 'routine' and normalized_priority_reason is null then
    raise exception using errcode = '22023', message = 'Document the reason for assigning a non-routine priority';
  end if;

  new_diagnosis_id := public.record_visit_diagnosis(
    target_visit_id,
    target_catalog_entry_id,
    input_diagnosis_name,
    input_diagnosis_code,
    input_code_system,
    input_category,
    input_description,
    input_anatomical_location,
    input_tooth_numbers,
    input_tooth_surface,
    input_severity,
    input_supporting_findings,
    input_clinical_notes
  );

  perform set_config('app.diagnosis_state_change', 'authorized', true);
  perform set_config(
    'app.diagnosis_change_reason',
    coalesce(normalized_priority_reason, normalized_reasoning),
    true
  );
  update public.visit_diagnoses
  set certainty = input_certainty,
      priority = input_priority,
      diagnostic_reasoning = normalized_reasoning,
      conflicting_findings = nullif(btrim(input_conflicting_findings), ''),
      required_investigations = nullif(btrim(input_required_investigations), ''),
      priority_reason = normalized_priority_reason
  where id = new_diagnosis_id
    and (
      certainty is distinct from input_certainty
      or priority is distinct from input_priority
      or diagnostic_reasoning is distinct from normalized_reasoning
      or conflicting_findings is distinct from nullif(btrim(input_conflicting_findings), '')
      or required_investigations is distinct from nullif(btrim(input_required_investigations), '')
      or priority_reason is distinct from normalized_priority_reason
    );
  return new_diagnosis_id;
end;
$$;

create or replace function public.record_diagnosis_reassessment(
  target_diagnosis_id uuid,
  target_visit_id uuid,
  input_status text,
  input_certainty text,
  input_priority text,
  input_severity text,
  input_progression text,
  input_assessment_reason text,
  input_supporting_findings text,
  input_conflicting_findings text,
  input_required_investigations text,
  input_priority_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  diagnosis_row public.visit_diagnoses%rowtype;
  visit_row public.patient_visits%rowtype;
  new_assessment_id uuid;
  normalized_reason text := nullif(btrim(input_assessment_reason), '');
  normalized_priority_reason text := nullif(btrim(input_priority_reason), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select d.* into diagnosis_row
  from public.visit_diagnoses d
  where d.id = target_diagnosis_id;
  if not found then
    raise exception using errcode = '22023', message = 'Diagnosis not found';
  end if;
  select v.* into visit_row
  from public.patient_visits v
  where v.id = target_visit_id
    and v.organization_id = diagnosis_row.organization_id
    and v.patient_id = diagnosis_row.patient_id;
  if not found or not public.can_access_branch(visit_row.branch_id)
    or not public.has_org_role(diagnosis_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor'
    ]) then
    raise exception using errcode = '42501', message = 'Visit or diagnosis is not accessible for reassessment';
  end if;
  if input_status is null or input_certainty is null or input_priority is null
    or input_progression is null
    or input_status not in (
      'active', 'under_treatment', 'resolved', 'historical', 'ruled_out', 'entered_in_error'
    ) or input_certainty not in ('suspected', 'provisional', 'confirmed', 'differential')
    or input_priority not in ('routine', 'priority', 'urgent', 'emergency')
    or input_progression not in (
      'improved', 'worsened', 'unchanged', 'resolved', 'recurrence', 'complicated', 'undetermined'
    ) then
    raise exception using errcode = '22023', message = 'Choose valid reassessment classifications';
  end if;
  if input_severity is not null
    and input_severity not in ('mild', 'moderate', 'severe', 'critical', 'unspecified') then
    raise exception using errcode = '22023', message = 'Choose a valid diagnosis severity';
  end if;
  if normalized_reason is null or length(normalized_reason) > 2000 then
    raise exception using errcode = '22023', message = 'Document why the diagnosis is being reassessed';
  end if;
  if input_conflicting_findings is not null and length(input_conflicting_findings) > 2000
    or input_required_investigations is not null and length(input_required_investigations) > 2000
    or normalized_priority_reason is not null and length(normalized_priority_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Reassessment findings or priority reason are too long';
  end if;
  if input_priority <> diagnosis_row.priority and normalized_priority_reason is null then
    raise exception using errcode = '22023', message = 'Document the reason for changing diagnosis priority';
  end if;
  if not public.is_valid_diagnosis_status_transition(diagnosis_row.status, input_status) then
    raise exception using errcode = '22023', message = 'This diagnosis status transition is not allowed';
  end if;
  if input_status = 'resolved' and input_certainty <> 'confirmed' then
    raise exception using errcode = '22023', message = 'Only a confirmed diagnosis can be resolved';
  end if;
  if input_progression = 'resolved'
    and (input_status <> 'resolved' or input_certainty <> 'confirmed') then
    raise exception using errcode = '22023', message = 'A resolved progression requires a confirmed, resolved diagnosis';
  end if;
  if input_progression = 'recurrence'
    and diagnosis_row.status = 'resolved'
    and input_status <> 'active' then
    raise exception using errcode = '22023', message = 'A recurrent diagnosis must be reopened as active';
  end if;

  insert into public.visit_diagnosis_assessments (
    organization_id, branch_id, patient_id, diagnosis_id, visit_id, status,
    certainty, priority, severity, progression, assessment_reason,
    supporting_findings, conflicting_findings, required_investigations,
    priority_reason, assessed_by
  ) values (
    diagnosis_row.organization_id, visit_row.branch_id, diagnosis_row.patient_id,
    diagnosis_row.id, visit_row.id, input_status, input_certainty, input_priority,
    input_severity, input_progression, normalized_reason,
    nullif(btrim(input_supporting_findings), ''),
    nullif(btrim(input_conflicting_findings), ''),
    nullif(btrim(input_required_investigations), ''),
    normalized_priority_reason, auth.uid()
  )
  returning id into new_assessment_id;

  if diagnosis_row.status is distinct from input_status
    or diagnosis_row.certainty is distinct from input_certainty
    or diagnosis_row.priority is distinct from input_priority
    or diagnosis_row.severity is distinct from input_severity
    or diagnosis_row.supporting_findings is distinct from nullif(btrim(input_supporting_findings), '')
    or diagnosis_row.conflicting_findings is distinct from nullif(btrim(input_conflicting_findings), '')
    or diagnosis_row.required_investigations is distinct from nullif(btrim(input_required_investigations), '') then
    perform set_config('app.diagnosis_state_change', 'authorized', true);
    perform set_config('app.diagnosis_change_reason', normalized_reason, true);
    update public.visit_diagnoses
    set status = input_status,
        certainty = input_certainty,
        priority = input_priority,
        severity = input_severity,
        supporting_findings = nullif(btrim(input_supporting_findings), ''),
        conflicting_findings = nullif(btrim(input_conflicting_findings), ''),
        required_investigations = nullif(btrim(input_required_investigations), ''),
        priority_reason = coalesce(normalized_priority_reason, priority_reason)
    where id = diagnosis_row.id;
  end if;

  return new_assessment_id;
end;
$$;

create or replace function public.record_clinical_outcome(
  target_diagnosis_id uuid,
  target_visit_id uuid,
  target_assessment_id uuid,
  target_procedure_id uuid,
  input_outcome text,
  input_clinical_findings text,
  input_complications text,
  input_further_treatment_required text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  diagnosis_row public.visit_diagnoses%rowtype;
  visit_row public.patient_visits%rowtype;
  new_outcome_id uuid;
  normalized_findings text := nullif(btrim(input_clinical_findings), '');
  outcome_reason text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select d.* into diagnosis_row
  from public.visit_diagnoses d
  where d.id = target_diagnosis_id;
  if not found then
    raise exception using errcode = '22023', message = 'Diagnosis not found';
  end if;
  select v.* into visit_row
  from public.patient_visits v
  where v.id = target_visit_id
    and v.organization_id = diagnosis_row.organization_id
    and v.patient_id = diagnosis_row.patient_id;
  if not found or not public.can_access_branch(visit_row.branch_id)
    or not public.has_org_role(diagnosis_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor'
    ]) then
    raise exception using errcode = '42501', message = 'Visit or diagnosis is not accessible for outcome recording';
  end if;
  if input_outcome is null or input_outcome not in (
    'improved', 'worsened', 'unchanged', 'resolved', 'recurrence', 'complicated', 'undetermined'
  ) then
    raise exception using errcode = '22023', message = 'Choose a valid clinical outcome';
  end if;
  if normalized_findings is null or length(normalized_findings) > 2000
    or input_complications is not null and length(input_complications) > 2000
    or input_further_treatment_required is not null and length(input_further_treatment_required) > 2000 then
    raise exception using errcode = '22023', message = 'Record clinical findings and limit outcome text to 2000 characters';
  end if;
  if target_procedure_id is not null and not exists (
    select 1 from public.performed_procedures p
    where p.id = target_procedure_id
      and p.organization_id = diagnosis_row.organization_id
      and p.patient_id = diagnosis_row.patient_id
  ) then
    raise exception using errcode = '22023', message = 'The selected procedure does not belong to this patient and clinic';
  end if;
  if target_assessment_id is not null and not exists (
    select 1 from public.visit_diagnosis_assessments a
    where a.id = target_assessment_id
      and a.diagnosis_id = diagnosis_row.id
      and a.visit_id = visit_row.id
      and a.organization_id = diagnosis_row.organization_id
  ) then
    raise exception using errcode = '22023', message = 'The selected reassessment does not match this diagnosis and visit';
  end if;
  if input_outcome = 'resolved' and diagnosis_row.certainty <> 'confirmed' then
    raise exception using errcode = '22023', message = 'Only a confirmed diagnosis can be marked resolved';
  end if;

  insert into public.clinical_outcomes (
    organization_id, branch_id, patient_id, diagnosis_id, visit_id,
    assessment_id, performed_procedure_id, outcome, clinical_findings,
    complications, further_treatment_required, assessed_by
  ) values (
    diagnosis_row.organization_id, visit_row.branch_id, diagnosis_row.patient_id,
    diagnosis_row.id, visit_row.id, target_assessment_id, target_procedure_id,
    input_outcome, normalized_findings, nullif(btrim(input_complications), ''),
    nullif(btrim(input_further_treatment_required), ''), auth.uid()
  )
  returning id into new_outcome_id;

  if input_outcome = 'resolved' and diagnosis_row.status is distinct from 'resolved' then
    outcome_reason := left('Clinician-recorded outcome: ' || normalized_findings, 1000);
    perform public.update_visit_diagnosis_state(
      diagnosis_row.id, 'resolved', diagnosis_row.certainty,
      diagnosis_row.priority, outcome_reason
    );
  elsif input_outcome = 'recurrence' and diagnosis_row.status = 'resolved' then
    outcome_reason := left('Clinician-recorded recurrence: ' || normalized_findings, 1000);
    perform public.update_visit_diagnosis_state(
      diagnosis_row.id, 'active', diagnosis_row.certainty,
      diagnosis_row.priority, outcome_reason
    );
  end if;

  return new_outcome_id;
end;
$$;

alter table public.visit_diagnosis_assessments enable row level security;
alter table public.clinical_outcomes enable row level security;

create policy "Diagnosis assessments are branch readable"
on public.visit_diagnosis_assessments for select using (
  public.can_access_branch(branch_id)
);
create policy "Clinical outcomes are branch readable"
on public.clinical_outcomes for select using (
  public.can_access_branch(branch_id)
);

revoke update, delete on public.visit_diagnoses from authenticated;
revoke insert, update, delete on
  public.visit_diagnosis_assessments,
  public.clinical_outcomes
from authenticated;
grant select on
  public.visit_diagnoses,
  public.visit_diagnosis_assessments,
  public.clinical_outcomes
to authenticated;
grant all on
  public.visit_diagnosis_assessments,
  public.clinical_outcomes
to service_role;
revoke all on
  public.visit_diagnosis_assessments,
  public.clinical_outcomes
from anon;

revoke all on function public.is_valid_diagnosis_status_transition(text, text)
  from public, anon, authenticated;
revoke all on function public.record_visit_diagnosis_v2(
  uuid, uuid, text, text, text, text, text, text, text[], text, text, text, text,
  text, text, text, text, text, text
) from public, anon;
revoke all on function public.record_diagnosis_reassessment(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text
) from public, anon;
revoke all on function public.update_visit_diagnosis_state(uuid, text, text, text, text)
  from public, anon;
revoke all on function public.record_clinical_outcome(
  uuid, uuid, uuid, uuid, text, text, text, text
) from public, anon;

grant execute on function public.record_visit_diagnosis_v2(
  uuid, uuid, text, text, text, text, text, text, text[], text, text, text, text,
  text, text, text, text, text, text
) to authenticated;
grant execute on function public.record_diagnosis_reassessment(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.update_visit_diagnosis_state(uuid, text, text, text, text)
  to authenticated;
grant execute on function public.record_clinical_outcome(
  uuid, uuid, uuid, uuid, text, text, text, text
) to authenticated;
