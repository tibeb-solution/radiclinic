create extension if not exists pgcrypto;

create type public.organization_status as enum ('pending', 'active', 'suspended');
create type public.subscription_status as enum ('trial', 'active', 'past_due', 'suspended', 'expired');
create type public.subscription_plan as enum ('Starter', 'Growth', 'Enterprise');
create type public.branch_status as enum ('active', 'inactive');
create type public.member_role as enum (
  'organization_administrator',
  'central_clinical_supervisor',
  'branch_supervisor',
  'doctor',
  'nurse',
  'receptionist',
  'accountant',
  'inventory_officer',
  'laboratory_coordinator'
);
create type public.patient_status as enum ('active', 'inactive');
create type public.appointment_status as enum ('scheduled', 'checked_in', 'completed', 'cancelled');
create type public.share_status as enum ('pending', 'approved', 'active', 'revoked', 'expired');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  is_platform_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  code text not null,
  logo_url text,
  contact_email text,
  contact_phone text,
  address text,
  timezone text not null default 'UTC',
  country text,
  status public.organization_status not null default 'active',
  subscription_status public.subscription_status not null default 'trial',
  subscription_plan public.subscription_plan not null default 'Starter',
  subscription_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_blank check (length(btrim(name)) > 0),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  status public.branch_status not null default 'active',
  address text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  constraint branches_name_not_blank check (length(btrim(name)) > 0)
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.branch_memberships (
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.member_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (branch_id, user_id)
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  registered_branch_id uuid not null references public.branches(id),
  patient_number text not null,
  full_name text not null,
  date_of_birth date,
  sex text,
  phone text,
  email text,
  national_id text,
  address text,
  status public.patient_status not null default 'active',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, patient_number),
  constraint patients_name_not_blank check (length(btrim(full_name)) > 0)
);

create table public.patient_medical_histories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  allergies jsonb not null default '[]'::jsonb,
  medications jsonb not null default '[]'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  previous_medical_treatments jsonb not null default '[]'::jsonb,
  previous_dental_treatments jsonb not null default '[]'::jsonb,
  dental_history text,
  notes text,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id)
);

create table public.patient_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_number text not null,
  visited_at timestamptz not null default now(),
  chief_complaint text,
  vital_signs jsonb not null default '{}'::jsonb,
  observations text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, visit_number)
);

create table public.clinical_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  patient_id uuid not null references public.patients(id) on delete cascade,
  visit_id uuid references public.patient_visits(id) on delete set null,
  title text not null,
  diagnosis text,
  treatment_plan jsonb not null default '[]'::jsonb,
  completed_procedures jsonb not null default '[]'::jsonb,
  prescriptions jsonb not null default '[]'::jsonb,
  tooth_chart jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  submitted_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_record_status check (status in ('draft', 'submitted', 'approved', 'returned'))
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  patient_id uuid references public.patients(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status public.appointment_status not null default 'scheduled',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.record_shares (
  id uuid primary key default gen_random_uuid(),
  origin_organization_id uuid not null references public.organizations(id) on delete cascade,
  receiving_organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  patient_consent boolean not null default false,
  record_categories text[] not null default '{}'::text[],
  clinical_record_ids uuid[] not null default '{}'::uuid[],
  status public.share_status not null default 'pending',
  expires_at timestamptz,
  authorized_by uuid references public.profiles(id),
  revoked_by uuid references public.profiles(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint record_shares_different_orgs check (origin_organization_id <> receiving_organization_id)
);

create table public.patient_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinical_record_id uuid references public.clinical_records(id) on delete set null,
  storage_bucket text not null default 'clinical-documents',
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  amount numeric(12, 2) not null,
  currency text not null default 'ETB',
  status text not null default 'pending',
  external_reference text,
  paid_at timestamptz,
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index patients_org_branch_idx on public.patients(organization_id, registered_branch_id);
create index visits_org_patient_idx on public.patient_visits(organization_id, patient_id);
create index clinical_org_patient_idx on public.clinical_records(organization_id, patient_id);
create index appointments_org_branch_starts_idx on public.appointments(organization_id, branch_id, starts_at);
create index audit_org_created_idx on public.audit_events(organization_id, created_at desc);
create index org_members_user_idx on public.organization_members(user_id);
create index branch_members_user_idx on public.branch_memberships(user_id);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(nullif(excluded.full_name, ''), public.profiles.full_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (
  select 1 from public.profiles
  where id = auth.uid() and is_platform_admin
) $$;

create or replace function public.is_org_member(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.is_platform_admin() or exists (
  select 1 from public.organization_members
  where organization_id = target_org_id
    and user_id = auth.uid()
    and active
) $$;

create or replace function public.has_org_role(target_org_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.is_platform_admin() or exists (
  select 1 from public.organization_members
  where organization_id = target_org_id
    and user_id = auth.uid()
    and active
    and role::text = any(allowed_roles)
) $$;

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
    and (m.role = 'organization_administrator' or exists (
      select 1 from public.branch_memberships bm
      where bm.branch_id = target_branch_id
        and bm.user_id = auth.uid()
        and bm.active
    ))
) $$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.organization_members enable row level security;
alter table public.branch_memberships enable row level security;
alter table public.patients enable row level security;
alter table public.patient_medical_histories enable row level security;
alter table public.patient_visits enable row level security;
alter table public.clinical_records enable row level security;
alter table public.appointments enable row level security;
alter table public.record_shares enable row level security;
alter table public.patient_attachments enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.audit_events enable row level security;

create policy "Profiles are visible to the owner, platform admins, and org admins"
on public.profiles for select using (
  id = auth.uid()
  or public.is_platform_admin()
  or exists (
    select 1
    from public.organization_members viewer
    join public.organization_members subject
      on subject.organization_id = viewer.organization_id
    where viewer.user_id = auth.uid()
      and viewer.active
      and viewer.role = 'organization_administrator'
      and subject.user_id = profiles.id
      and subject.active
  )
);

create policy "Users can update their own profile"
on public.profiles for update using (id = auth.uid())
with check (id = auth.uid());

create policy "Organizations are visible to their members"
on public.organizations for select using (public.is_org_member(id));
create policy "Only platform admins create organizations"
on public.organizations for insert with check (public.is_platform_admin());
create policy "Platform admins update organizations"
on public.organizations for update using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "Branches are visible to branch or organization members"
on public.branches for select using (public.can_access_branch(id));
create policy "Organization admins manage branches"
on public.branches for insert with check (
  public.has_org_role(organization_id, array['organization_administrator'])
);
create policy "Organization admins update branches"
on public.branches for update using (
  public.has_org_role(organization_id, array['organization_administrator'])
)
with check (
  public.has_org_role(organization_id, array['organization_administrator'])
);

create policy "Organization members view membership"
on public.organization_members for select using (public.is_org_member(organization_id));
create policy "Organization admins manage membership"
on public.organization_members for all using (
  public.has_org_role(organization_id, array['organization_administrator'])
)
with check (
  public.has_org_role(organization_id, array['organization_administrator'])
);

create policy "Branch members view branch assignments"
on public.branch_memberships for select using (
  public.can_access_branch(branch_id)
);
create policy "Organization admins manage branch assignments"
on public.branch_memberships for all using (
  exists (
    select 1 from public.branches b
    where b.id = branch_id
      and public.has_org_role(b.organization_id, array['organization_administrator'])
  )
)
with check (
  exists (
    select 1 from public.branches b
    where b.id = branch_id
      and public.has_org_role(b.organization_id, array['organization_administrator'])
  )
);

create policy "Patients are organization isolated"
on public.patients for select using (public.is_org_member(organization_id));
create policy "Authorized users create patients"
on public.patients for insert with check (
  public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'receptionist'
  ])
);
create policy "Authorized users update patients"
on public.patients for update using (
  public.is_org_member(organization_id)
)
with check (
  public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'receptionist'
  ])
);

create policy "Medical histories are organization isolated"
on public.patient_medical_histories for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy "Visits are organization isolated"
on public.patient_visits for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy "Clinical records are organization isolated"
on public.clinical_records for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy "Appointments are organization isolated"
on public.appointments for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));

create policy "Origin or receiving organizations can view shares"
on public.record_shares for select using (
  public.is_org_member(origin_organization_id)
  or public.is_org_member(receiving_organization_id)
);
create policy "Origin organization manages shares"
on public.record_shares for all using (
  public.is_org_member(origin_organization_id)
)
with check (
  public.is_org_member(origin_organization_id)
);

create policy "Attachments are organization isolated"
on public.patient_attachments for all using (public.is_org_member(organization_id))
with check (public.is_org_member(organization_id));
create policy "Platform admins manage subscriptions"
on public.subscription_payments for all using (public.is_platform_admin())
with check (public.is_platform_admin());

create policy "Audit is organization visible"
on public.audit_events for select using (
  organization_id is null
    or public.has_org_role(organization_id, array[
      'organization_administrator', 'central_clinical_supervisor'
    ])
);
create policy "Organization members create audit events"
on public.audit_events for insert with check (
  organization_id is null or public.is_org_member(organization_id)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinical-documents',
  'clinical-documents',
  false,
  20971520,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/dicom'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Clinical document objects are readable by organization members" on storage.objects;
create policy "Clinical document objects are readable by organization members"
on storage.objects for select using (
  bucket_id = 'clinical-documents'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists "Clinical document objects are uploaded by organization members" on storage.objects;
create policy "Clinical document objects are uploaded by organization members"
on storage.objects for insert with check (
  bucket_id = 'clinical-documents'
  and public.is_org_member(split_part(name, '/', 1)::uuid)
);

drop policy if exists "Clinical document objects are deleted by organization admins" on storage.objects;
create policy "Clinical document objects are deleted by organization admins"
on storage.objects for delete using (
  bucket_id = 'clinical-documents'
  and public.has_org_role(
    split_part(name, '/', 1)::uuid,
    array['organization_administrator', 'central_clinical_supervisor']
  )
);

revoke update (is_platform_admin) on public.profiles from authenticated;
revoke update, delete on public.audit_events from authenticated;
