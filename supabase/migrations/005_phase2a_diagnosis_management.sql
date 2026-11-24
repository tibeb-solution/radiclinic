create table public.diagnosis_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  diagnosis_name text not null,
  diagnosis_code text,
  code_system text,
  category text not null,
  description text,
  anatomical_area text,
  requires_tooth boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (length(btrim(diagnosis_name)) between 1 and 200),
  check (diagnosis_code is null or length(btrim(diagnosis_code)) between 1 and 50),
  check (code_system is null or length(btrim(code_system)) between 1 and 40),
  check (category in (
    'general_medical', 'dental', 'periodontal', 'oral_surgery',
    'restorative', 'endodontic', 'orthodontic', 'prosthodontic', 'other'
  ))
);

create unique index diagnosis_catalog_org_system_code_idx
  on public.diagnosis_catalog (
    organization_id, coalesce(lower(code_system), ''), lower(diagnosis_code)
  )
  where diagnosis_code is not null;
create index diagnosis_catalog_org_name_idx
  on public.diagnosis_catalog (organization_id, lower(diagnosis_name));
create index diagnosis_catalog_org_code_idx
  on public.diagnosis_catalog (organization_id, lower(diagnosis_code))
  where diagnosis_code is not null;

alter table public.visit_diagnoses
  add column patient_id uuid,
  add column branch_id uuid,
  add column catalog_entry_id uuid,
  add column diagnosis_code_system text,
  add column category text not null default 'other',
  add column severity text,
  add column clinical_notes text;

update public.visit_diagnoses d
set patient_id = v.patient_id,
    branch_id = v.branch_id
from public.patient_visits v
where v.id = d.visit_id
  and v.organization_id = d.organization_id;

alter table public.visit_diagnoses
  alter column patient_id set not null,
  alter column branch_id set not null,
  add constraint visit_diagnoses_id_organization_key unique (id, organization_id),
  add constraint visit_diagnoses_patient_organization_fkey
    foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  add constraint visit_diagnoses_branch_organization_fkey
    foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  add constraint visit_diagnoses_catalog_organization_fkey
    foreign key (catalog_entry_id, organization_id)
    references public.diagnosis_catalog(id, organization_id)
    on delete no action deferrable initially deferred,
  add constraint visit_diagnoses_category_check
    check (category in (
      'general_medical', 'dental', 'periodontal', 'oral_surgery',
      'restorative', 'endodontic', 'orthodontic', 'prosthodontic', 'other'
    )),
  add constraint visit_diagnoses_severity_check
    check (severity is null or severity in ('mild', 'moderate', 'severe', 'critical', 'unspecified')),
  add constraint visit_diagnoses_code_system_length_check
    check (diagnosis_code_system is null or length(btrim(diagnosis_code_system)) between 1 and 40);

alter table public.visit_diagnoses
  drop constraint if exists visit_diagnoses_status_check;
alter table public.visit_diagnoses
  add constraint visit_diagnoses_status_check
  check (status in (
    'active', 'under_treatment', 'resolved', 'historical', 'ruled_out', 'entered_in_error'
  ));

create index visit_diagnoses_patient_date_idx
  on public.visit_diagnoses (organization_id, patient_id, diagnosed_at desc);
create index visit_diagnoses_branch_date_idx
  on public.visit_diagnoses (organization_id, branch_id, diagnosed_at desc);

create table public.visit_diagnosis_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  diagnosis_id uuid not null,
  location_type text not null,
  tooth_number text,
  tooth_surface text,
  anatomical_area text,
  created_at timestamptz not null default now(),
  foreign key (diagnosis_id, organization_id)
    references public.visit_diagnoses(id, organization_id) on delete cascade,
  check (location_type in ('tooth', 'anatomical')),
  check (
    (location_type = 'tooth'
      and tooth_number is not null
      and tooth_number ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
      and tooth_surface is not null
      and tooth_surface in ('whole_tooth', 'mesial', 'distal', 'occlusal', 'buccal', 'lingual_palatal'))
    or
    (location_type = 'anatomical'
      and tooth_number is null
      and tooth_surface is null
      and length(btrim(coalesce(anatomical_area, ''))) > 0)
  ),
  check (anatomical_area is null or length(btrim(anatomical_area)) <= 200)
);

create unique index visit_diagnosis_tooth_location_unique_idx
  on public.visit_diagnosis_locations (diagnosis_id, tooth_number, tooth_surface)
  where location_type = 'tooth';
create unique index visit_diagnosis_anatomical_location_unique_idx
  on public.visit_diagnosis_locations (diagnosis_id, lower(anatomical_area))
  where location_type = 'anatomical';
create index visit_diagnosis_locations_org_diagnosis_idx
  on public.visit_diagnosis_locations (organization_id, diagnosis_id);

insert into public.visit_diagnosis_locations (
  organization_id, diagnosis_id, location_type, tooth_number, tooth_surface, anatomical_area
)
select organization_id, id, 'tooth', tooth_number, 'whole_tooth', anatomical_location
from public.visit_diagnoses
where tooth_number ~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
on conflict do nothing;

insert into public.visit_diagnosis_locations (
  organization_id, diagnosis_id, location_type, anatomical_area
)
select organization_id, id, 'anatomical',
       coalesce(nullif(btrim(anatomical_location), ''), 'Legacy tooth/location: ' || btrim(tooth_number))
from public.visit_diagnoses
where (
  tooth_number is null
  or tooth_number !~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$'
)
and (
  nullif(btrim(anatomical_location), '') is not null
  or nullif(btrim(tooth_number), '') is not null
)
on conflict do nothing;

create table public.visit_diagnosis_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  diagnosis_id uuid not null,
  event_type text not null,
  previous_status text,
  new_status text,
  reason text,
  actor_id uuid not null references public.profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (diagnosis_id, organization_id)
    references public.visit_diagnoses(id, organization_id) on delete cascade,
  check (event_type in ('recorded', 'status_changed', 'corrected')),
  check (reason is null or length(btrim(reason)) > 0)
);

create index visit_diagnosis_events_diagnosis_date_idx
  on public.visit_diagnosis_events (organization_id, diagnosis_id, created_at desc);

create or replace function public.touch_diagnosis_catalog_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger diagnosis_catalog_updated_at
before update on public.diagnosis_catalog
for each row execute function public.touch_diagnosis_catalog_updated_at();

create or replace function public.audit_diagnosis_catalog_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
begin
  actor := coalesce(auth.uid(), new.created_by);
  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, before_data, after_data
  ) values (
    new.organization_id,
    actor,
    case when tg_op = 'INSERT' then 'diagnosis.catalog.create' else 'diagnosis.catalog.update' end,
    'diagnosis_catalog',
    new.id,
    case when tg_op = 'UPDATE' then
      jsonb_build_object(
        'name', old.diagnosis_name,
        'code', old.diagnosis_code,
        'category', old.category,
        'active', old.is_active
      )
    else null end,
    jsonb_build_object(
      'name', new.diagnosis_name,
      'code', new.diagnosis_code,
      'category', new.category,
      'active', new.is_active
    )
  );
  return new;
end;
$$;

create trigger diagnosis_catalog_audit
after insert or update on public.diagnosis_catalog
for each row execute function public.audit_diagnosis_catalog_change();

insert into public.visit_diagnosis_events (
  organization_id, branch_id, diagnosis_id, event_type, new_status, actor_id, details, created_at
)
select organization_id, branch_id, id, 'recorded', status, diagnosed_by,
       jsonb_build_object(
         'diagnosis_name', diagnosis_name,
         'diagnosis_code', diagnosis_code,
         'category', category,
         'tooth_number', tooth_number
       ),
       diagnosed_at
from public.visit_diagnoses;

create or replace function public.assert_visit_diagnosis_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  visit_patient_id uuid;
  visit_branch_id uuid;
begin
  select v.patient_id, v.branch_id
  into visit_patient_id, visit_branch_id
  from public.patient_visits v
  where v.id = new.visit_id
    and v.organization_id = new.organization_id;

  if visit_patient_id is distinct from new.patient_id
    or visit_branch_id is distinct from new.branch_id then
    raise exception 'Diagnosis visit, patient, branch, and organization must match';
  end if;

  return new;
end;
$$;

create trigger visit_diagnoses_scope_guard
before insert or update of visit_id, patient_id, branch_id, organization_id
on public.visit_diagnoses
for each row execute function public.assert_visit_diagnosis_scope();

create or replace function public.capture_visit_diagnosis_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_name text;
  actor uuid;
begin
  actor := coalesce(auth.uid(), new.diagnosed_by);

  if tg_op = 'INSERT' then
    action_name := 'recorded';
    insert into public.visit_diagnosis_events (
      organization_id, branch_id, diagnosis_id, event_type, new_status, actor_id, details
    ) values (
      new.organization_id, new.branch_id, new.id, action_name, new.status, actor,
      jsonb_build_object(
        'diagnosis_name', new.diagnosis_name,
        'diagnosis_code', new.diagnosis_code,
        'category', new.category,
        'tooth_number', new.tooth_number
      )
    );
    insert into public.audit_events (
      organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
    ) values (
      new.organization_id, new.branch_id, actor, 'diagnosis.create',
      'visit_diagnosis', new.id,
      jsonb_build_object('status', new.status, 'category', new.category)
    );
  else
    action_name := case
      when new.status is distinct from old.status then 'status_changed'
      else 'corrected'
    end;
    insert into public.visit_diagnosis_events (
      organization_id, branch_id, diagnosis_id, event_type, previous_status, new_status,
      actor_id, details
    ) values (
      new.organization_id, new.branch_id, new.id, action_name, old.status, new.status, actor,
      jsonb_build_object(
        'previous_name', old.diagnosis_name,
        'new_name', new.diagnosis_name,
        'previous_code', old.diagnosis_code,
        'new_code', new.diagnosis_code,
        'previous_category', old.category,
        'new_category', new.category,
        'previous_tooth_number', old.tooth_number,
        'new_tooth_number', new.tooth_number
      )
    );
    insert into public.audit_events (
      organization_id, branch_id, actor_id, action, entity_type, entity_id, before_data, after_data
    ) values (
      new.organization_id, new.branch_id, actor, 'diagnosis.' || action_name,
      'visit_diagnosis', new.id,
      jsonb_build_object('status', old.status, 'category', old.category),
      jsonb_build_object('status', new.status, 'category', new.category)
    );
  end if;

  return new;
end;
$$;

create trigger visit_diagnosis_event_capture
after insert or update on public.visit_diagnoses
for each row execute function public.capture_visit_diagnosis_event();

create or replace function public.record_visit_diagnosis(
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
  input_clinical_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_branch_id uuid;
  target_patient_id uuid;
  catalog_row public.diagnosis_catalog%rowtype;
  resolved_name text;
  resolved_code text;
  resolved_code_system text;
  resolved_category text;
  resolved_location text;
  resolved_severity text;
  diagnosis_id uuid;
  normalized_teeth text[];
  tooth text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select v.organization_id, v.branch_id, v.patient_id
  into target_organization_id, target_branch_id, target_patient_id
  from public.patient_visits v
  where v.id = target_visit_id;

  if not found then
    raise exception using errcode = '22023', message = 'Visit not found';
  end if;

  if not public.can_access_branch(target_branch_id)
    or not public.has_org_role(target_organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor'
    ]) then
    raise exception using errcode = '42501', message = 'You are not authorized to record diagnoses for this visit';
  end if;

  normalized_teeth := coalesce(input_tooth_numbers, '{}'::text[]);
  if cardinality(normalized_teeth) > 32 then
    raise exception using errcode = '22023', message = 'A diagnosis can be linked to at most 32 teeth';
  end if;

  if input_tooth_surface is null
    or input_tooth_surface not in (
      'whole_tooth', 'mesial', 'distal', 'occlusal', 'buccal', 'lingual_palatal'
    ) then
    raise exception using errcode = '22023', message = 'Choose a valid tooth surface';
  end if;

  foreach tooth in array normalized_teeth loop
    if tooth is null
      or tooth !~ '^(1[1-8]|2[1-8]|3[1-8]|4[1-8]|5[1-5]|6[1-5]|7[1-5]|8[1-5])$' then
      raise exception using errcode = '22023', message = 'Every tooth must use a valid FDI number';
    end if;
  end loop;

  if cardinality(normalized_teeth) <> (
    select count(distinct value) from unnest(normalized_teeth) as teeth(value)
  ) then
    raise exception using errcode = '22023', message = 'A tooth may only be selected once';
  end if;

  resolved_severity := nullif(btrim(input_severity), '');
  if resolved_severity is not null
    and resolved_severity not in ('mild', 'moderate', 'severe', 'critical', 'unspecified') then
    raise exception using errcode = '22023', message = 'Choose a valid diagnosis severity';
  end if;

  if target_catalog_entry_id is not null then
    select * into catalog_row
    from public.diagnosis_catalog c
    where c.id = target_catalog_entry_id
      and c.organization_id = target_organization_id
      and c.is_active;

    if not found then
      raise exception using errcode = '22023', message = 'The selected diagnosis is not in this clinic catalog or is inactive';
    end if;

    resolved_name := catalog_row.diagnosis_name;
    resolved_code := catalog_row.diagnosis_code;
    resolved_code_system := catalog_row.code_system;
    resolved_category := catalog_row.category;
    resolved_location := coalesce(
      nullif(btrim(input_anatomical_location), ''),
      catalog_row.anatomical_area
    );

    if catalog_row.requires_tooth and cardinality(normalized_teeth) = 0 then
      raise exception using errcode = '22023', message = 'This diagnosis requires at least one tooth location';
    end if;
  else
    resolved_name := nullif(btrim(input_diagnosis_name), '');
    resolved_code := nullif(btrim(input_diagnosis_code), '');
    resolved_code_system := nullif(btrim(input_code_system), '');
    resolved_category := nullif(btrim(input_category), '');
    resolved_location := nullif(btrim(input_anatomical_location), '');

    if resolved_name is null or length(resolved_name) > 200 then
      raise exception using errcode = '22023', message = 'Enter a diagnosis name up to 200 characters';
    end if;
    if resolved_category is null or resolved_category not in (
      'general_medical', 'dental', 'periodontal', 'oral_surgery',
      'restorative', 'endodontic', 'orthodontic', 'prosthodontic', 'other'
    ) then
      raise exception using errcode = '22023', message = 'Choose a valid diagnosis category';
    end if;
    if resolved_code is not null and length(resolved_code) > 50 then
      raise exception using errcode = '22023', message = 'Diagnosis code must be 50 characters or fewer';
    end if;
    if resolved_code_system is not null and length(resolved_code_system) > 40 then
      raise exception using errcode = '22023', message = 'Code system must be 40 characters or fewer';
    end if;
  end if;

  if resolved_location is not null and length(resolved_location) > 200 then
    raise exception using errcode = '22023', message = 'Anatomical location must be 200 characters or fewer';
  end if;

  if input_description is not null and length(input_description) > 1500
    or input_supporting_findings is not null and length(input_supporting_findings) > 1500
    or input_clinical_notes is not null and length(input_clinical_notes) > 1500 then
    raise exception using errcode = '22023', message = 'Diagnosis descriptions and notes must be 1500 characters or fewer';
  end if;

  insert into public.visit_diagnoses (
    organization_id, branch_id, patient_id, visit_id, catalog_entry_id,
    diagnosis_name, diagnosis_code, diagnosis_code_system, category, severity,
    description, anatomical_location, tooth_number, supporting_findings,
    clinical_notes, diagnosed_by
  ) values (
    target_organization_id, target_branch_id, target_patient_id, target_visit_id,
    target_catalog_entry_id, resolved_name, resolved_code, resolved_code_system,
    resolved_category, resolved_severity, nullif(btrim(input_description), ''),
    resolved_location, normalized_teeth[1], nullif(btrim(input_supporting_findings), ''),
    nullif(btrim(input_clinical_notes), ''), auth.uid()
  )
  returning id into diagnosis_id;

  if cardinality(normalized_teeth) > 0 then
    insert into public.visit_diagnosis_locations (
      organization_id, diagnosis_id, location_type, tooth_number, tooth_surface, anatomical_area
    )
    select target_organization_id, diagnosis_id, 'tooth', tooth, input_tooth_surface, resolved_location
    from unnest(normalized_teeth) as selected_teeth(tooth);
  elsif resolved_location is not null then
    insert into public.visit_diagnosis_locations (
      organization_id, diagnosis_id, location_type, anatomical_area
    ) values (
      target_organization_id, diagnosis_id, 'anatomical', resolved_location
    );
  end if;

  return diagnosis_id;
end;
$$;

alter table public.diagnosis_catalog enable row level security;
alter table public.visit_diagnosis_locations enable row level security;
alter table public.visit_diagnosis_events enable row level security;

create policy "Clinic members read diagnosis catalog"
on public.diagnosis_catalog for select using (
  public.is_org_member(organization_id)
);
create policy "Clinic admins create diagnosis catalog entries"
on public.diagnosis_catalog for insert with check (
  created_by = auth.uid()
  and public.has_org_role(organization_id, array['organization_administrator'])
);
create policy "Clinic admins update diagnosis catalog entries"
on public.diagnosis_catalog for update using (
  public.has_org_role(organization_id, array['organization_administrator'])
) with check (
  public.has_org_role(organization_id, array['organization_administrator'])
);

create policy "Diagnosis locations are branch readable"
on public.visit_diagnosis_locations for select using (
  exists (
    select 1 from public.visit_diagnoses d
    where d.id = diagnosis_id
      and d.organization_id = organization_id
      and public.can_access_branch(d.branch_id)
  )
);
create policy "Diagnosis events are branch readable"
on public.visit_diagnosis_events for select using (
  public.can_access_branch(branch_id)
);

revoke insert, update, delete on public.visit_diagnoses from authenticated;
grant select on public.visit_diagnoses to authenticated;

revoke insert, update, delete on
  public.diagnosis_catalog,
  public.visit_diagnosis_locations,
  public.visit_diagnosis_events
from authenticated;
grant select on
  public.diagnosis_catalog,
  public.visit_diagnosis_locations,
  public.visit_diagnosis_events
to authenticated;
grant insert (
  organization_id, diagnosis_name, diagnosis_code, code_system, category,
  description, anatomical_area, requires_tooth, created_by
) on public.diagnosis_catalog to authenticated;
grant update (
  diagnosis_name, diagnosis_code, code_system, category, description,
  anatomical_area, requires_tooth, is_active, updated_at
) on public.diagnosis_catalog to authenticated;

grant all on
  public.diagnosis_catalog,
  public.visit_diagnosis_locations,
  public.visit_diagnosis_events
to service_role;
revoke all on
  public.diagnosis_catalog,
  public.visit_diagnosis_locations,
  public.visit_diagnosis_events
from anon;

revoke all on function public.record_visit_diagnosis(
  uuid, uuid, text, text, text, text, text, text, text[], text, text, text, text
) from public, anon;
grant execute on function public.record_visit_diagnosis(
  uuid, uuid, text, text, text, text, text, text, text[], text, text, text, text
) to authenticated;
