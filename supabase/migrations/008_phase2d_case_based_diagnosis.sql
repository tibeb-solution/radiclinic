alter table public.patient_visits
  add column case_type text not null default 'general_dentistry',
  add constraint patient_visits_case_type_check
    check (case_type in (
      'general_dentistry', 'orthodontic', 'endodontic', 'periodontal',
      'oral_surgery', 'restorative', 'prosthodontic'
    ));

create table public.diagnosis_case_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid not null,
  diagnosis_id uuid not null,
  selected_case_type text not null,
  diagnosis_category text not null,
  override_reason text,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete cascade,
  foreign key (diagnosis_id, organization_id)
    references public.visit_diagnoses(id, organization_id) on delete cascade,
  check (selected_case_type in (
    'general_dentistry', 'orthodontic', 'endodontic', 'periodontal',
    'oral_surgery', 'restorative', 'prosthodontic'
  )),
  check (diagnosis_category in (
    'general_medical', 'dental', 'periodontal', 'oral_surgery',
    'restorative', 'endodontic', 'orthodontic', 'prosthodontic', 'other'
  )),
  check (override_reason is null or length(btrim(override_reason)) between 1 and 1000),
  unique (diagnosis_id)
);

create table public.diagnosis_catalog_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid not null,
  diagnosis_id uuid not null,
  diagnosis_name text not null,
  diagnosis_code text,
  code_system text,
  category text not null,
  description text,
  anatomical_area text,
  requires_tooth boolean not null default false,
  status text not null default 'pending',
  submitted_by uuid not null references public.profiles(id),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  reviewer_notes text,
  resulting_catalog_entry_id uuid,
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete cascade,
  foreign key (diagnosis_id, organization_id)
    references public.visit_diagnoses(id, organization_id) on delete cascade,
  foreign key (resulting_catalog_entry_id, organization_id)
    references public.diagnosis_catalog(id, organization_id)
    on delete no action deferrable initially deferred,
  check (status in ('pending', 'approved', 'rejected', 'clarification_requested', 'merged')),
  check (length(btrim(diagnosis_name)) between 1 and 200),
  check (diagnosis_code is null or length(btrim(diagnosis_code)) between 1 and 50),
  check (code_system is null or length(btrim(code_system)) between 1 and 40),
  check (category in (
    'general_medical', 'dental', 'periodontal', 'oral_surgery',
    'restorative', 'endodontic', 'orthodontic', 'prosthodontic', 'other'
  )),
  check (description is null or length(description) <= 1500),
  check (anatomical_area is null or length(anatomical_area) <= 200),
  check (reviewer_notes is null or length(reviewer_notes) between 1 and 2000),
  check (
    (reviewed_by is null and reviewed_at is null)
    or (reviewed_by is not null and reviewed_at is not null)
  ),
  unique (diagnosis_id)
);

create index diagnosis_case_decisions_patient_timeline_idx
  on public.diagnosis_case_decisions (organization_id, patient_id, recorded_at desc);
create index diagnosis_catalog_proposals_queue_idx
  on public.diagnosis_catalog_proposals (organization_id, status, submitted_at desc);
create index diagnosis_catalog_proposals_patient_idx
  on public.diagnosis_catalog_proposals (organization_id, patient_id, submitted_at desc);

create or replace function public.create_clinical_encounter_phase2d(
  p_patient_id uuid,
  p_branch_id uuid,
  p_visit_type text,
  p_reason text,
  p_chief_complaint text,
  p_history_reviewed boolean,
  p_exam jsonb,
  p_vitals jsonb,
  p_follow_up text,
  p_case_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_visit_id uuid;
begin
  if p_case_type is null or p_case_type not in (
    'general_dentistry', 'orthodontic', 'endodontic', 'periodontal',
    'oral_surgery', 'restorative', 'prosthodontic'
  ) then
    raise exception using errcode = '22023', message = 'Choose a valid clinical case type';
  end if;
  new_visit_id := public.create_clinical_encounter(
    p_patient_id, p_branch_id, p_visit_type, p_reason, p_chief_complaint,
    p_history_reviewed, p_exam, p_vitals, p_follow_up
  );
  update public.patient_visits set case_type = p_case_type where id = new_visit_id;
  return new_visit_id;
end;
$$;

create or replace function public.update_clinical_visit_case_type(
  target_visit_id uuid,
  input_case_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  visit_row public.patient_visits%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select v.* into visit_row
  from public.patient_visits v
  where v.id = target_visit_id;
  if not found or not public.can_access_branch(visit_row.branch_id)
    or not public.has_org_role(visit_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor'
    ]) then
    raise exception using errcode = '42501', message = 'You are not authorized to change this visit case type';
  end if;
  if input_case_type is null or input_case_type not in (
    'general_dentistry', 'orthodontic', 'endodontic', 'periodontal',
    'oral_surgery', 'restorative', 'prosthodontic'
  ) then
    raise exception using errcode = '22023', message = 'Choose a valid clinical case type';
  end if;
  if visit_row.case_type is distinct from input_case_type then
    update public.patient_visits set case_type = input_case_type where id = visit_row.id;
    insert into public.audit_events (
      organization_id, branch_id, actor_id, action, entity_type, entity_id, before_data, after_data
    ) values (
      visit_row.organization_id, visit_row.branch_id, auth.uid(),
      'diagnosis.case_type_change', 'patient_visit', visit_row.id,
      jsonb_build_object('case_type', visit_row.case_type),
      jsonb_build_object('case_type', input_case_type)
    );
  end if;
end;
$$;

create or replace function public.record_visit_diagnosis_phase2d(
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
  input_priority_reason text,
  input_case_type text,
  input_override_reason text,
  input_propose_for_catalog boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  visit_row public.patient_visits%rowtype;
  catalog_row public.diagnosis_catalog%rowtype;
  resolved_name text;
  resolved_category text;
  normalized_override_reason text := nullif(btrim(input_override_reason), '');
  new_diagnosis_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select v.* into visit_row
  from public.patient_visits v
  where v.id = target_visit_id;
  if not found or not public.can_access_branch(visit_row.branch_id)
    or not public.has_org_role(visit_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor'
    ]) then
    raise exception using errcode = '42501', message = 'You are not authorized to record diagnoses for this visit';
  end if;
  if input_case_type is null or input_case_type not in (
    'general_dentistry', 'orthodontic', 'endodontic', 'periodontal',
    'oral_surgery', 'restorative', 'prosthodontic'
  ) then
    raise exception using errcode = '22023', message = 'Choose a valid clinical case type';
  end if;

  if target_catalog_entry_id is not null then
    select c.* into catalog_row
    from public.diagnosis_catalog c
    where c.id = target_catalog_entry_id
      and c.organization_id = visit_row.organization_id
      and c.is_active;
    if not found then
      raise exception using errcode = '22023', message = 'The selected diagnosis is not available in this clinic catalog';
    end if;
    resolved_name := catalog_row.diagnosis_name;
    resolved_category := catalog_row.category;
  else
    resolved_name := nullif(btrim(input_diagnosis_name), '');
    resolved_category := nullif(btrim(input_category), '');
  end if;

  if resolved_name is null or resolved_category is null then
    raise exception using errcode = '22023', message = 'Provide a diagnosis name and category';
  end if;

  if resolved_category not in ('general_medical', 'other')
    and input_case_type <> 'general_dentistry'
    and resolved_category <> input_case_type
    and normalized_override_reason is null then
    raise exception using errcode = '22023',
      message = 'This diagnosis is outside the selected case specialty. Add a clinical justification to continue.';
  end if;
  if exists (
    select 1
    from public.visit_diagnoses d
    where d.organization_id = visit_row.organization_id
      and d.visit_id = visit_row.id
      and d.category = resolved_category
      and lower(btrim(d.diagnosis_name)) = lower(btrim(resolved_name))
      and d.status <> 'entered_in_error'
  ) then
    if normalized_override_reason is null then
      raise exception using errcode = '23505',
        message = 'A diagnosis with this name and category already exists for this visit. Review the existing diagnosis or provide a clinical justification for a repeat entry.';
    end if;
  end if;
  if normalized_override_reason is not null and length(normalized_override_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Clinical justification must be 1,000 characters or fewer';
  end if;
  if coalesce(input_propose_for_catalog, false) and target_catalog_entry_id is not null then
    raise exception using errcode = '22023', message = 'Only a manually entered diagnosis can be proposed for the clinic catalog';
  end if;

  new_diagnosis_id := public.record_visit_diagnosis_v2(
    target_visit_id, target_catalog_entry_id,
    input_diagnosis_name, input_diagnosis_code, input_code_system, input_category,
    input_description, input_anatomical_location, input_tooth_numbers,
    input_tooth_surface, input_severity, input_supporting_findings,
    input_clinical_notes, input_certainty, input_priority, input_diagnostic_reasoning,
    input_conflicting_findings, input_required_investigations, input_priority_reason
  );

  insert into public.diagnosis_case_decisions (
    organization_id, branch_id, patient_id, visit_id, diagnosis_id,
    selected_case_type, diagnosis_category, override_reason, recorded_by
  ) values (
    visit_row.organization_id, visit_row.branch_id, visit_row.patient_id,
    visit_row.id, new_diagnosis_id, input_case_type, resolved_category,
    normalized_override_reason, auth.uid()
  );

  if coalesce(input_propose_for_catalog, false) then
    insert into public.diagnosis_catalog_proposals (
      organization_id, branch_id, patient_id, visit_id, diagnosis_id,
      diagnosis_name, diagnosis_code, code_system, category, description,
      anatomical_area, requires_tooth, submitted_by
    ) values (
      visit_row.organization_id, visit_row.branch_id, visit_row.patient_id,
      visit_row.id, new_diagnosis_id, btrim(input_diagnosis_name),
      nullif(btrim(input_diagnosis_code), ''), nullif(btrim(input_code_system), ''),
      input_category, nullif(btrim(input_description), ''),
      nullif(btrim(input_anatomical_location), ''),
      cardinality(coalesce(input_tooth_numbers, '{}'::text[])) > 0, auth.uid()
    );
  end if;
  return new_diagnosis_id;
end;
$$;

create or replace function public.review_diagnosis_catalog_proposal(
  target_proposal_id uuid,
  input_decision text,
  input_reviewer_notes text,
  input_diagnosis_name text default null,
  input_diagnosis_code text default null,
  input_code_system text default null,
  input_category text default null,
  input_catalog_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal_row public.diagnosis_catalog_proposals%rowtype;
  normalized_notes text := nullif(btrim(input_reviewer_notes), '');
  normalized_name text;
  normalized_category text;
  normalized_code text;
  normalized_code_system text;
  catalog_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select p.* into proposal_row
  from public.diagnosis_catalog_proposals p
  where p.id = target_proposal_id
  for update;
  if not found or not public.can_access_branch(proposal_row.branch_id)
    or not public.has_org_role(proposal_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor'
    ]) then
    raise exception using errcode = '42501', message = 'Only authorized clinical leadership can review catalog proposals';
  end if;
  if proposal_row.status <> 'pending' then
    raise exception using errcode = '22023', message = 'This catalog proposal has already been reviewed';
  end if;
  if input_decision is null
    or input_decision not in ('approved', 'rejected', 'clarification_requested', 'merged') then
    raise exception using errcode = '22023', message = 'Choose approve, reject, request clarification, or merge';
  end if;
  if normalized_notes is null or length(normalized_notes) > 2000 then
    raise exception using errcode = '22023', message = 'A review reason or explanation is required';
  end if;

  if input_decision in ('approved', 'merged') then
    if input_decision = 'merged' then
      select c.id into catalog_id
      from public.diagnosis_catalog c
      where c.id = input_catalog_entry_id
        and c.organization_id = proposal_row.organization_id
        and c.is_active;
      if catalog_id is null then
        raise exception using errcode = '22023', message = 'Choose an active clinic catalog entry to merge with';
      end if;
    else
      normalized_name := coalesce(nullif(btrim(input_diagnosis_name), ''), proposal_row.diagnosis_name);
      normalized_category := coalesce(nullif(btrim(input_category), ''), proposal_row.category);
      normalized_code := nullif(btrim(coalesce(input_diagnosis_code, proposal_row.diagnosis_code)), '');
      normalized_code_system := nullif(btrim(coalesce(input_code_system, proposal_row.code_system)), '');
      if normalized_category not in (
        'general_medical', 'dental', 'periodontal', 'oral_surgery',
        'restorative', 'endodontic', 'orthodontic', 'prosthodontic', 'other'
      ) then
        raise exception using errcode = '22023', message = 'Choose a valid specialty category';
      end if;
      if normalized_name is null or length(normalized_name) > 200
        or length(coalesce(normalized_code, '')) > 50
        or length(coalesce(normalized_code_system, '')) > 40 then
        raise exception using errcode = '22023', message = 'Check the proposed diagnosis name and code lengths';
      end if;
      select c.id into catalog_id
      from public.diagnosis_catalog c
      where c.organization_id = proposal_row.organization_id
        and c.is_active
        and c.category = normalized_category
        and lower(btrim(c.diagnosis_name)) = lower(btrim(normalized_name))
      limit 1;
      if catalog_id is null then
        if normalized_code is not null and exists (
          select 1
          from public.diagnosis_catalog c
          where c.organization_id = proposal_row.organization_id
            and c.is_active
            and lower(coalesce(c.code_system, '')) = lower(coalesce(normalized_code_system, ''))
            and lower(c.diagnosis_code) = lower(normalized_code)
        ) then
          raise exception using errcode = '23505',
            message = 'This code is already assigned to another clinic diagnosis. Review or merge the matching entry.';
        end if;
        insert into public.diagnosis_catalog (
          organization_id, diagnosis_name, diagnosis_code, code_system, category,
          description, anatomical_area, requires_tooth, created_by
        ) values (
          proposal_row.organization_id, normalized_name, normalized_code,
          normalized_code_system, normalized_category, proposal_row.description,
          proposal_row.anatomical_area, proposal_row.requires_tooth, auth.uid()
        ) returning id into catalog_id;
      end if;
    end if;
  end if;

  update public.diagnosis_catalog_proposals
  set status = input_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      reviewer_notes = normalized_notes,
      resulting_catalog_entry_id = catalog_id
  where id = proposal_row.id;

  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    proposal_row.organization_id, proposal_row.branch_id, auth.uid(),
    'diagnosis_catalog_proposal.' || input_decision,
    'diagnosis_catalog_proposal', proposal_row.id,
    jsonb_build_object(
      'diagnosis_id', proposal_row.diagnosis_id,
      'resulting_catalog_entry_id', catalog_id,
      'reviewer_notes', normalized_notes
    )
  );
  return catalog_id;
end;
$$;

alter table public.diagnosis_case_decisions enable row level security;
alter table public.diagnosis_catalog_proposals enable row level security;

create policy "Diagnosis case decisions are branch readable"
on public.diagnosis_case_decisions for select using (
  public.can_access_branch(branch_id)
);
create policy "Diagnosis catalog proposals are branch readable"
on public.diagnosis_catalog_proposals for select using (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor'
  ])
);

revoke insert, update, delete on
  public.diagnosis_case_decisions,
  public.diagnosis_catalog_proposals
from authenticated;
grant select on
  public.diagnosis_case_decisions,
  public.diagnosis_catalog_proposals
to authenticated;
grant all on
  public.diagnosis_case_decisions,
  public.diagnosis_catalog_proposals
to service_role;
revoke all on
  public.diagnosis_case_decisions,
  public.diagnosis_catalog_proposals
from anon;

revoke all on function public.record_visit_diagnosis_phase2d(
  uuid, uuid, text, text, text, text, text, text, text[], text, text, text, text,
  text, text, text, text, text, text, text, text, boolean
) from public, anon;
revoke all on function public.create_clinical_encounter_phase2d(
  uuid, uuid, text, text, text, boolean, jsonb, jsonb, text, text
) from public, anon;
revoke all on function public.update_clinical_visit_case_type(uuid, text)
  from public, anon;
revoke all on function public.review_diagnosis_catalog_proposal(
  uuid, text, text, text, text, text, text, uuid
) from public, anon;

grant execute on function public.record_visit_diagnosis_phase2d(
  uuid, uuid, text, text, text, text, text, text, text[], text, text, text, text,
  text, text, text, text, text, text, text, text, boolean
) to authenticated;
grant execute on function public.create_clinical_encounter_phase2d(
  uuid, uuid, text, text, text, boolean, jsonb, jsonb, text, text
) to authenticated;
grant execute on function public.update_clinical_visit_case_type(uuid, text)
  to authenticated;
grant execute on function public.review_diagnosis_catalog_proposal(
  uuid, text, text, text, text, text, text, uuid
) to authenticated;
