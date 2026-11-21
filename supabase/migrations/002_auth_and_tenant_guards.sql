alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject text not null,
  details text not null default '',
  status text not null default 'open',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint support_requests_status check (status in ('open', 'closed'))
);
alter table public.support_requests enable row level security;
drop policy if exists "Organization members manage support requests" on public.support_requests;
create policy "Organization members manage support requests"
on public.support_requests for all using (
  public.has_org_role(organization_id, array['organization_administrator'])
)
with check (
  public.has_org_role(organization_id, array['organization_administrator'])
);
drop policy if exists "Organization members create support requests" on public.support_requests;
create policy "Organization members create support requests"
on public.support_requests for insert with check (public.is_org_member(organization_id));
drop policy if exists "Organization members read support requests" on public.support_requests;
create policy "Organization members read support requests"
on public.support_requests for select using (public.is_org_member(organization_id));

revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, updated_at) on public.profiles to authenticated;

create or replace function public.can_access_branch(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.is_platform_admin() or exists (
  select 1
  from public.branches b
  join public.organization_members m
    on m.organization_id = b.organization_id
   and m.user_id = auth.uid()
   and m.active
  where b.id = target_branch_id
    and (
      b.status = 'active'
      or m.role in ('organization_administrator', 'central_clinical_supervisor')
    )
    and (
      m.role in ('organization_administrator', 'central_clinical_supervisor')
      or exists (
        select 1 from public.branch_memberships bm
        where bm.branch_id = target_branch_id
          and bm.user_id = auth.uid()
          and bm.active
      )
    )
) $$;

create or replace function public.complete_password_setup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  update public.profiles
  set must_change_password = false, updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.complete_password_setup() from public, anon;
grant execute on function public.complete_password_setup() to authenticated;

create or replace function public.can_access_clinical_document(object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when split_part(object_path, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and split_part(object_path, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then exists (
      select 1
      from public.branches b
      where b.organization_id = split_part(object_path, '/', 1)::uuid
        and b.id = split_part(object_path, '/', 2)::uuid
        and public.can_access_branch(b.id)
    )
    else false
  end
$$;

drop policy if exists "Platform admins update organizations" on public.organizations;
create policy "Platform and organization admins update organizations"
on public.organizations for update using (
  public.is_platform_admin()
  or public.has_org_role(id, array['organization_administrator'])
)
with check (
  public.is_platform_admin()
  or public.has_org_role(id, array['organization_administrator'])
);
revoke update on public.organizations from authenticated;
grant update (name, logo_url, contact_phone, address, timezone, country, updated_at)
on public.organizations to authenticated;

create or replace function public.assert_same_organization()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  related_organization_id uuid;
begin
  if tg_table_name = 'patients' then
    select organization_id into related_organization_id
    from public.branches where id = new.registered_branch_id;
    if related_organization_id is distinct from new.organization_id then
      raise exception 'Patient branch must belong to its organization';
    end if;
  elsif tg_table_name = 'patient_visits' then
    select organization_id into related_organization_id
    from public.branches where id = new.branch_id;
    if related_organization_id is distinct from new.organization_id then
      raise exception 'Visit branch must belong to its organization';
    end if;
    select organization_id into related_organization_id
    from public.patients where id = new.patient_id;
    if related_organization_id is distinct from new.organization_id then
      raise exception 'Visit patient must belong to its organization';
    end if;
  elsif tg_table_name = 'clinical_records' then
    select organization_id into related_organization_id
    from public.branches where id = new.branch_id;
    if related_organization_id is distinct from new.organization_id then
      raise exception 'Clinical record branch must belong to its organization';
    end if;
    select organization_id into related_organization_id
    from public.patients where id = new.patient_id;
    if related_organization_id is distinct from new.organization_id then
      raise exception 'Clinical record patient must belong to its organization';
    end if;
    if new.visit_id is not null then
      select organization_id into related_organization_id
      from public.patient_visits
      where id = new.visit_id and patient_id = new.patient_id;
      if related_organization_id is distinct from new.organization_id then
        raise exception 'Clinical record visit must belong to its patient and organization';
      end if;
    end if;
  elsif tg_table_name = 'appointments' then
    select organization_id into related_organization_id
    from public.branches where id = new.branch_id;
    if related_organization_id is distinct from new.organization_id then
      raise exception 'Appointment branch must belong to its organization';
    end if;
    if new.patient_id is not null then
      select organization_id into related_organization_id
      from public.patients where id = new.patient_id;
      if related_organization_id is distinct from new.organization_id then
        raise exception 'Appointment patient must belong to its organization';
      end if;
    end if;
  elsif tg_table_name = 'patient_medical_histories' then
    select organization_id into related_organization_id
    from public.patients where id = new.patient_id;
    if related_organization_id is distinct from new.organization_id then
      raise exception 'Medical history patient must belong to its organization';
    end if;
  elsif tg_table_name = 'patient_attachments' then
    select organization_id into related_organization_id
    from public.patients where id = new.patient_id;
    if related_organization_id is distinct from new.organization_id then
      raise exception 'Attachment patient must belong to its organization';
    end if;
    if new.clinical_record_id is not null then
      select organization_id into related_organization_id
      from public.clinical_records where id = new.clinical_record_id;
      if related_organization_id is distinct from new.organization_id then
        raise exception 'Attachment clinical record must belong to its organization';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger patients_same_organization
before insert or update of organization_id, registered_branch_id on public.patients
for each row execute function public.assert_same_organization();

create trigger visits_same_organization
before insert or update of organization_id, branch_id, patient_id on public.patient_visits
for each row execute function public.assert_same_organization();

create trigger clinical_records_same_organization
before insert or update of organization_id, branch_id, patient_id on public.clinical_records
for each row execute function public.assert_same_organization();

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
    if old.status <> 'submitted'
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

create trigger clinical_record_approval_guard
before insert or update on public.clinical_records
for each row execute function public.guard_clinical_record_approval();

create trigger appointments_same_organization
before insert or update of organization_id, branch_id, patient_id on public.appointments
for each row execute function public.assert_same_organization();

create trigger medical_histories_same_organization
before insert or update of organization_id, patient_id on public.patient_medical_histories
for each row execute function public.assert_same_organization();

create trigger attachments_same_organization
before insert or update of organization_id, patient_id on public.patient_attachments
for each row execute function public.assert_same_organization();

create or replace function public.assert_record_share_consent_and_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  patient_organization_id uuid;
begin
  select organization_id into patient_organization_id
  from public.patients where id = new.patient_id;
  if patient_organization_id is distinct from new.origin_organization_id then
    raise exception 'Shared patient must belong to the origin organization';
  end if;
  if new.status in ('approved', 'active') and not new.patient_consent then
    raise exception 'Patient consent is required before approving record access';
  end if;
  if exists (
    select 1
    from unnest(new.clinical_record_ids) requested(id)
    left join public.clinical_records r
      on r.id = requested.id
     and r.organization_id = new.origin_organization_id
     and r.patient_id = new.patient_id
    where r.id is null
  ) then
    raise exception 'Shared clinical records must belong to the selected patient and origin clinic';
  end if;
  return new;
end;
$$;

create trigger record_shares_consent_and_scope
before insert or update of origin_organization_id, patient_id, patient_consent, status, clinical_record_ids
on public.record_shares
for each row execute function public.assert_record_share_consent_and_scope();

drop policy if exists "Patients are organization isolated" on public.patients;
create policy "Patients are branch isolated"
on public.patients for select using (public.can_access_branch(registered_branch_id));

drop policy if exists "Authorized users create patients" on public.patients;
create policy "Authorized users create patients"
on public.patients for insert with check (
  public.can_access_branch(registered_branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'receptionist'
  ])
);

drop policy if exists "Authorized users update patients" on public.patients;
create policy "Authorized users update patients"
on public.patients for update using (
  public.can_access_branch(registered_branch_id)
)
with check (
  public.can_access_branch(registered_branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'receptionist'
  ])
);

drop policy if exists "Medical histories are organization isolated" on public.patient_medical_histories;
drop policy if exists "Medical histories are branch isolated" on public.patient_medical_histories;
create policy "Medical histories are branch readable"
on public.patient_medical_histories for select using (
  exists (
    select 1 from public.patients p
    where p.id = patient_id and public.can_access_branch(p.registered_branch_id)
  )
);
create policy "Authorized users create medical histories"
on public.patient_medical_histories for insert with check (
  exists (
    select 1 from public.patients p
    where p.id = patient_id
      and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ])
);
revoke update, delete on public.patient_medical_histories from authenticated;

drop policy if exists "Visits are organization isolated" on public.patient_visits;
drop policy if exists "Visits are branch isolated" on public.patient_visits;
create policy "Visits are branch readable"
on public.patient_visits for select using (public.can_access_branch(branch_id));
create policy "Authorized users create visits"
on public.patient_visits for insert with check (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ])
);

drop policy if exists "Clinical records are organization isolated" on public.clinical_records;
drop policy if exists "Clinical records are branch isolated" on public.clinical_records;
create policy "Clinical records are branch readable"
on public.clinical_records for select using (public.can_access_branch(branch_id));
create policy "Authorized users create clinical records"
on public.clinical_records for insert with check (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'doctor', 'nurse'
  ])
);
revoke update, delete on public.patient_visits, public.clinical_records from authenticated;

drop policy if exists "Appointments are organization isolated" on public.appointments;
drop policy if exists "Appointments are branch isolated" on public.appointments;
create policy "Appointments are branch readable"
on public.appointments for select using (public.can_access_branch(branch_id));
create policy "Authorized users create appointments"
on public.appointments for insert with check (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse', 'receptionist'
  ])
);
create policy "Authorized users update appointments"
on public.appointments for update using (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse', 'receptionist'
  ])
)
with check (
  public.can_access_branch(branch_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse', 'receptionist'
  ])
);
revoke delete on public.appointments from authenticated;

drop policy if exists "Attachments are organization isolated" on public.patient_attachments;
drop policy if exists "Attachments are branch isolated" on public.patient_attachments;
create policy "Attachments are branch readable"
on public.patient_attachments for select using (
  exists (
    select 1 from public.patients p
    where p.id = patient_id and public.can_access_branch(p.registered_branch_id)
  )
);
create policy "Authorized users create attachments"
on public.patient_attachments for insert with check (
  exists (
    select 1 from public.patients p
    where p.id = patient_id
      and p.organization_id = organization_id
      and public.can_access_branch(p.registered_branch_id)
  )
);
revoke update, delete on public.patient_attachments from authenticated;

drop policy if exists "Origin or receiving organizations can view shares" on public.record_shares;
drop policy if exists "Origin organization manages shares" on public.record_shares;
create policy "Origin and receiving organizations read shares"
on public.record_shares for select using (
  public.is_org_member(origin_organization_id)
  or public.is_org_member(receiving_organization_id)
);
create policy "Authorized origin users create shares"
on public.record_shares for insert with check (
  public.has_org_role(origin_organization_id, array[
    'organization_administrator', 'central_clinical_supervisor'
  ])
);
create policy "Authorized origin users update shares"
on public.record_shares for update using (
  public.has_org_role(origin_organization_id, array[
    'organization_administrator', 'central_clinical_supervisor'
  ])
)
with check (
  public.has_org_role(origin_organization_id, array[
    'organization_administrator', 'central_clinical_supervisor'
  ])
);
revoke delete on public.record_shares from authenticated;

drop policy if exists "Audit is organization visible" on public.audit_events;
create policy "Audit is organization visible"
on public.audit_events for select using (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.has_org_role(organization_id, array[
      'organization_administrator', 'central_clinical_supervisor'
    ])
  )
);
drop policy if exists "Organization members create audit events" on public.audit_events;
create policy "Organization members create audit events"
on public.audit_events for insert with check (
  (actor_id = auth.uid() and organization_id is not null and public.is_org_member(organization_id))
  or (organization_id is null and public.is_platform_admin())
);
revoke update, delete on public.audit_events from authenticated;

drop policy if exists "Clinical document objects are readable by organization members" on storage.objects;
drop policy if exists "Clinical document objects are uploaded by organization members" on storage.objects;
drop policy if exists "Clinical document objects are deleted by organization admins" on storage.objects;
create policy "Clinical document objects are readable by branch members"
on storage.objects for select using (
  bucket_id = 'clinical-documents'
  and public.can_access_clinical_document(name)
);
create policy "Clinical document objects are uploaded by authorized branch members"
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
create policy "Clinical document objects are deleted by clinic administrators"
on storage.objects for delete using (
  bucket_id = 'clinical-documents'
  and public.can_access_clinical_document(name)
  and public.has_org_role(
    split_part(name, '/', 1)::uuid,
    array['organization_administrator', 'central_clinical_supervisor']
  )
);
