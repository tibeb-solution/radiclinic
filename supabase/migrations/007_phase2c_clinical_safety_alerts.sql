create table public.clinical_safety_alert_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  criticality text not null,
  escalation_after_minutes integer,
  escalation_role text not null,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  change_reason text not null,
  configured_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (criticality in ('routine', 'urgent', 'critical')),
  check (escalation_after_minutes is null or escalation_after_minutes between 1 and 10080),
  check (escalation_role in ('branch_supervisor', 'central_clinical_supervisor')),
  check (effective_until is null or effective_until > effective_from),
  check (length(btrim(change_reason)) between 1 and 1000)
);

create unique index clinical_safety_alert_rules_active_idx
  on public.clinical_safety_alert_rules (organization_id, criticality)
  where effective_until is null;

create table public.clinical_safety_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  patient_id uuid not null,
  visit_id uuid not null,
  diagnosis_id uuid,
  title text not null,
  description text not null,
  criticality text not null,
  escalation_after_minutes integer,
  escalation_target_role text not null,
  status text not null default 'open',
  responsible_user_id uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  acknowledgment_action text,
  escalated_to_role text,
  escalated_by uuid references public.profiles(id),
  escalated_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution_reason text,
  check (criticality in ('routine', 'urgent', 'critical')),
  check (escalation_after_minutes is null or escalation_after_minutes between 1 and 10080),
  check (escalation_target_role in ('branch_supervisor', 'central_clinical_supervisor')),
  check (status in ('open', 'acknowledged', 'escalated', 'resolved')),
  check (status not in ('acknowledged', 'resolved') or acknowledged_by is not null),
  check (status <> 'escalated' or escalated_to_role is not null),
  check (status <> 'resolved' or resolved_by is not null),
  check (escalated_to_role is null or escalated_to_role in ('branch_supervisor', 'central_clinical_supervisor')),
  check (
    (escalated_to_role is null and escalated_by is null and escalated_at is null)
    or (escalated_to_role is not null and escalated_by is not null and escalated_at is not null)
  ),
  check (length(btrim(title)) between 1 and 200),
  check (length(btrim(description)) between 1 and 2000),
  check (acknowledgment_action is null or length(btrim(acknowledgment_action)) between 1 and 2000),
  check (resolution_reason is null or length(btrim(resolution_reason)) between 1 and 2000),
  check (
    (acknowledged_by is null and acknowledged_at is null and acknowledgment_action is null)
    or (acknowledged_by is not null and acknowledged_at is not null and acknowledgment_action is not null)
  ),
  check (
    (resolved_by is null and resolved_at is null and resolution_reason is null)
    or (resolved_by is not null and resolved_at is not null and resolution_reason is not null)
  ),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade,
  foreign key (patient_id, organization_id)
    references public.patients(id, organization_id) on delete cascade,
  foreign key (visit_id, organization_id)
    references public.patient_visits(id, organization_id) on delete restrict,
  foreign key (diagnosis_id, organization_id)
    references public.visit_diagnoses(id, organization_id) on delete restrict
);

create table public.clinical_safety_alert_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  alert_id uuid not null references public.clinical_safety_alerts(id) on delete cascade,
  event_type text not null,
  actor_id uuid not null references public.profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (event_type in ('flagged', 'acknowledged', 'escalated', 'resolved')),
  foreign key (branch_id, organization_id)
    references public.branches(id, organization_id) on delete cascade
);

create index clinical_safety_alerts_active_idx
  on public.clinical_safety_alerts (organization_id, branch_id, criticality, created_at desc)
  where status in ('open', 'escalated');
create index clinical_safety_alerts_patient_idx
  on public.clinical_safety_alerts (organization_id, patient_id, created_at desc);
create index clinical_safety_alert_events_timeline_idx
  on public.clinical_safety_alert_events (organization_id, alert_id, created_at);

create or replace function public.assert_clinical_safety_alert_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  visit_patient_id uuid;
  visit_branch_id uuid;
  diagnosis_patient_id uuid;
  diagnosis_visit_id uuid;
begin
  select v.patient_id, v.branch_id
  into visit_patient_id, visit_branch_id
  from public.patient_visits v
  where v.id = new.visit_id
    and v.organization_id = new.organization_id;

  if visit_patient_id is distinct from new.patient_id
    or visit_branch_id is distinct from new.branch_id then
    raise exception 'Safety alert must match its patient, visit, branch, and clinic';
  end if;

  if new.diagnosis_id is not null then
    select d.patient_id, d.visit_id
    into diagnosis_patient_id, diagnosis_visit_id
    from public.visit_diagnoses d
    where d.id = new.diagnosis_id
      and d.organization_id = new.organization_id;
    if diagnosis_patient_id is distinct from new.patient_id
      or diagnosis_visit_id is distinct from new.visit_id then
      raise exception 'Safety alert diagnosis must belong to the same patient and visit';
    end if;
  end if;

  if new.responsible_user_id is not null and not exists (
    select 1
    from public.organization_members m
    where m.organization_id = new.organization_id
      and m.user_id = new.responsible_user_id
      and m.active
  ) then
    raise exception 'Responsible clinician must be an active member of this clinic';
  end if;
  return new;
end;
$$;

create trigger clinical_safety_alert_scope_guard
before insert on public.clinical_safety_alerts
for each row execute function public.assert_clinical_safety_alert_scope();

create or replace function public.guard_clinical_safety_alert_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.clinical_safety_alert_change', true) is distinct from 'authorized' then
    raise exception using errcode = '42501', message = 'Safety alerts can only be changed through the audited alert workflow';
  end if;
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.branch_id is distinct from old.branch_id
    or new.patient_id is distinct from old.patient_id
    or new.visit_id is distinct from old.visit_id
    or new.diagnosis_id is distinct from old.diagnosis_id
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.criticality is distinct from old.criticality
    or new.escalation_after_minutes is distinct from old.escalation_after_minutes
    or new.escalation_target_role is distinct from old.escalation_target_role
    or new.responsible_user_id is distinct from old.responsible_user_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'Flagged safety alert details are immutable';
  end if;
  if old.status = 'resolved' then
    raise exception using errcode = '22023', message = 'Resolved safety alerts are immutable';
  end if;
  return new;
end;
$$;

create trigger clinical_safety_alert_update_guard
before update on public.clinical_safety_alerts
for each row execute function public.guard_clinical_safety_alert_update();

create or replace function public.record_clinical_safety_alert_event(
  target_alert_id uuid,
  input_event_type text,
  input_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_row public.clinical_safety_alerts%rowtype;
begin
  select a.* into alert_row
  from public.clinical_safety_alerts a
  where a.id = target_alert_id;
  if not found or auth.uid() is null then
    raise exception using errcode = '42501', message = 'Safety alert not found or authentication required';
  end if;

  insert into public.clinical_safety_alert_events (
    organization_id, branch_id, alert_id, event_type, actor_id, details
  ) values (
    alert_row.organization_id, alert_row.branch_id, alert_row.id,
    input_event_type, auth.uid(), coalesce(input_details, '{}'::jsonb)
  );
  insert into public.audit_events (
    organization_id, branch_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    alert_row.organization_id, alert_row.branch_id, auth.uid(),
    'clinical_safety_alert.' || input_event_type, 'clinical_safety_alert',
    alert_row.id, coalesce(input_details, '{}'::jsonb)
  );
end;
$$;

create or replace function public.create_clinical_safety_alert(
  target_patient_id uuid,
  target_visit_id uuid,
  target_diagnosis_id uuid,
  input_title text,
  input_description text,
  input_criticality text,
  target_responsible_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  visit_row public.patient_visits%rowtype;
  rule_row public.clinical_safety_alert_rules%rowtype;
  alert_id uuid;
  escalation_interval integer;
  escalation_role text;
  normalized_title text := nullif(btrim(input_title), '');
  normalized_description text := nullif(btrim(input_description), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select v.* into visit_row
  from public.patient_visits v
  where v.id = target_visit_id and v.patient_id = target_patient_id;
  if not found or not public.can_access_branch(visit_row.branch_id)
    or not public.has_org_role(visit_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor', 'nurse'
    ]) then
    raise exception using errcode = '42501', message = 'Patient visit is not accessible for safety alert creation';
  end if;
  if input_criticality is null or input_criticality not in ('routine', 'urgent', 'critical')
    or normalized_title is null or length(normalized_title) > 200
    or normalized_description is null or length(normalized_description) > 2000 then
    raise exception using errcode = '22023', message = 'Provide a valid alert level, title, and clinical finding';
  end if;

  select r.* into rule_row
  from public.clinical_safety_alert_rules r
  where r.organization_id = visit_row.organization_id
    and r.criticality = input_criticality
    and r.effective_until is null;
  if found then
    escalation_interval := rule_row.escalation_after_minutes;
    escalation_role := rule_row.escalation_role;
  else
    escalation_interval := null;
    escalation_role := case
      when input_criticality = 'critical' then 'central_clinical_supervisor'
      else 'branch_supervisor'
    end;
  end if;

  insert into public.clinical_safety_alerts (
    organization_id, branch_id, patient_id, visit_id, diagnosis_id,
    title, description, criticality, escalation_after_minutes,
    escalation_target_role, responsible_user_id, created_by
  ) values (
    visit_row.organization_id, visit_row.branch_id, target_patient_id, target_visit_id,
    target_diagnosis_id, normalized_title, normalized_description, input_criticality,
    escalation_interval, escalation_role,
    target_responsible_user_id, auth.uid()
  ) returning id into alert_id;

  perform public.record_clinical_safety_alert_event(
    alert_id, 'flagged', jsonb_build_object(
      'criticality', input_criticality,
      'escalation_after_minutes', escalation_interval,
      'escalation_role', escalation_role
    )
  );
  return alert_id;
end;
$$;

create or replace function public.acknowledge_clinical_safety_alert(
  target_alert_id uuid,
  input_action_taken text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_row public.clinical_safety_alerts%rowtype;
  normalized_action text := nullif(btrim(input_action_taken), '');
  supervisor boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select a.* into alert_row from public.clinical_safety_alerts a where a.id = target_alert_id;
  if not found or not public.can_access_branch(alert_row.branch_id) then
    raise exception using errcode = '42501', message = 'Safety alert is not accessible';
  end if;
  supervisor := public.has_org_role(alert_row.organization_id, array[
    'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
  ]);
  if not supervisor and not public.has_org_role(alert_row.organization_id, array['doctor', 'nurse']) then
    raise exception using errcode = '42501', message = 'You are not authorized to acknowledge safety alerts';
  end if;
  if alert_row.responsible_user_id is not null
    and alert_row.responsible_user_id <> auth.uid()
    and not supervisor then
    raise exception using errcode = '42501', message = 'Only the responsible clinician or a supervisor may acknowledge this alert';
  end if;
  if alert_row.status not in ('open', 'escalated') then
    raise exception using errcode = '22023', message = 'Only an open or escalated alert can be acknowledged';
  end if;
  if normalized_action is null or length(normalized_action) > 2000 then
    raise exception using errcode = '22023', message = 'Document the action taken to acknowledge this alert';
  end if;

  perform set_config('app.clinical_safety_alert_change', 'authorized', true);
  update public.clinical_safety_alerts
  set status = 'acknowledged',
      acknowledged_by = auth.uid(),
      acknowledged_at = now(),
      acknowledgment_action = normalized_action
  where id = alert_row.id;
  perform public.record_clinical_safety_alert_event(
    alert_row.id, 'acknowledged', jsonb_build_object('action_taken', normalized_action)
  );
  return alert_row.id;
end;
$$;

create or replace function public.escalate_clinical_safety_alert(
  target_alert_id uuid,
  input_target_role text,
  input_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_row public.clinical_safety_alerts%rowtype;
  normalized_reason text := nullif(btrim(input_reason), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select a.* into alert_row from public.clinical_safety_alerts a where a.id = target_alert_id;
  if not found or not public.can_access_branch(alert_row.branch_id)
    or not public.has_org_role(alert_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor', 'branch_supervisor'
    ]) then
    raise exception using errcode = '42501', message = 'Only an authorized supervisor can escalate an accessible alert';
  end if;
  if alert_row.status not in ('open', 'escalated') then
    raise exception using errcode = '22023', message = 'Only an unacknowledged alert can be escalated';
  end if;
  if input_target_role is null
    or input_target_role not in ('branch_supervisor', 'central_clinical_supervisor')
    or normalized_reason is null or length(normalized_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Choose an escalation target and document the reason';
  end if;

  if alert_row.escalation_after_minutes is not null
    and now() < alert_row.created_at + make_interval(mins => alert_row.escalation_after_minutes) then
    raise exception using errcode = '22023', message = 'The configured escalation interval has not elapsed';
  end if;
  if input_target_role <> alert_row.escalation_target_role then
    raise exception using errcode = '22023', message = 'Use the escalation role configured when this alert was flagged';
  end if;

  perform set_config('app.clinical_safety_alert_change', 'authorized', true);
  update public.clinical_safety_alerts
  set status = 'escalated',
      escalated_to_role = input_target_role,
      escalated_by = auth.uid(),
      escalated_at = now()
  where id = alert_row.id;
  perform public.record_clinical_safety_alert_event(
    alert_row.id, 'escalated',
    jsonb_build_object('target_role', input_target_role, 'reason', normalized_reason)
  );
  return alert_row.id;
end;
$$;

create or replace function public.resolve_clinical_safety_alert(
  target_alert_id uuid,
  input_resolution_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  alert_row public.clinical_safety_alerts%rowtype;
  normalized_reason text := nullif(btrim(input_resolution_reason), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select a.* into alert_row from public.clinical_safety_alerts a where a.id = target_alert_id;
  if not found or not public.can_access_branch(alert_row.branch_id)
    or not public.has_org_role(alert_row.organization_id, array[
      'organization_administrator', 'central_clinical_supervisor',
      'branch_supervisor', 'doctor', 'nurse'
    ]) then
    raise exception using errcode = '42501', message = 'Safety alert is not accessible for resolution';
  end if;
  if alert_row.status <> 'acknowledged' or alert_row.acknowledged_by is null then
    raise exception using errcode = '22023', message = 'A safety alert must be acknowledged before it can be resolved';
  end if;
  if normalized_reason is null or length(normalized_reason) > 2000 then
    raise exception using errcode = '22023', message = 'Document the resolution of this safety alert';
  end if;

  perform set_config('app.clinical_safety_alert_change', 'authorized', true);
  update public.clinical_safety_alerts
  set status = 'resolved',
      resolved_by = auth.uid(),
      resolved_at = now(),
      resolution_reason = normalized_reason
  where id = alert_row.id;
  perform public.record_clinical_safety_alert_event(
    alert_row.id, 'resolved', jsonb_build_object('reason', normalized_reason)
  );
  return alert_row.id;
end;
$$;

create or replace function public.configure_clinical_safety_alert_rule(
  target_organization_id uuid,
  input_criticality text,
  input_escalation_after_minutes integer,
  input_escalation_role text,
  input_change_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_rule_id uuid;
  normalized_reason text := nullif(btrim(input_change_reason), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if target_organization_id is null or not public.has_org_role(target_organization_id, array[
    'organization_administrator', 'central_clinical_supervisor'
  ]) then
    raise exception using errcode = '42501', message = 'Clinical leadership authorization is required to configure alert escalation';
  end if;
  if input_criticality is null or input_criticality not in ('routine', 'urgent', 'critical')
    or (input_escalation_after_minutes is not null
      and input_escalation_after_minutes not between 1 and 10080)
    or input_escalation_role is null
    or input_escalation_role not in ('branch_supervisor', 'central_clinical_supervisor')
    or normalized_reason is null or length(normalized_reason) > 1000 then
    raise exception using errcode = '22023', message = 'Provide valid alert escalation settings and a reason';
  end if;

  update public.clinical_safety_alert_rules r
  set effective_until = greatest(clock_timestamp(), r.effective_from + interval '1 microsecond')
  where r.organization_id = target_organization_id
    and r.criticality = input_criticality
    and r.effective_until is null;

  insert into public.clinical_safety_alert_rules (
    organization_id, criticality, escalation_after_minutes, escalation_role, effective_from,
    change_reason, configured_by
  ) values (
    target_organization_id, input_criticality, input_escalation_after_minutes,
    input_escalation_role, clock_timestamp(), normalized_reason, auth.uid()
  ) returning id into new_rule_id;

  insert into public.audit_events (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    target_organization_id, auth.uid(), 'clinical_safety_alert_rule.configure',
    'clinical_safety_alert_rule', new_rule_id,
    jsonb_build_object(
      'criticality', input_criticality,
      'escalation_after_minutes', input_escalation_after_minutes,
      'escalation_role', input_escalation_role,
      'reason', normalized_reason
    )
  );
  return new_rule_id;
end;
$$;

alter table public.clinical_safety_alert_rules enable row level security;
alter table public.clinical_safety_alerts enable row level security;
alter table public.clinical_safety_alert_events enable row level security;

create policy "Clinical alert rules are readable by clinical leadership"
on public.clinical_safety_alert_rules for select using (
  public.is_org_member(organization_id)
  and public.has_org_role(organization_id, array[
    'organization_administrator', 'central_clinical_supervisor',
    'branch_supervisor', 'doctor', 'nurse'
  ])
);
create policy "Clinical safety alerts are branch readable"
on public.clinical_safety_alerts for select using (
  public.can_access_branch(branch_id)
);
create policy "Clinical safety alert events are branch readable"
on public.clinical_safety_alert_events for select using (
  public.can_access_branch(branch_id)
);

revoke insert, update, delete on
  public.clinical_safety_alert_rules,
  public.clinical_safety_alerts,
  public.clinical_safety_alert_events
from authenticated;
grant select on
  public.clinical_safety_alert_rules,
  public.clinical_safety_alerts,
  public.clinical_safety_alert_events
to authenticated;
grant all on
  public.clinical_safety_alert_rules,
  public.clinical_safety_alerts,
  public.clinical_safety_alert_events
to service_role;
revoke all on
  public.clinical_safety_alert_rules,
  public.clinical_safety_alerts,
  public.clinical_safety_alert_events
from anon;

revoke all on function public.record_clinical_safety_alert_event(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.create_clinical_safety_alert(uuid, uuid, uuid, text, text, text, uuid)
  from public, anon;
revoke all on function public.acknowledge_clinical_safety_alert(uuid, text)
  from public, anon;
revoke all on function public.escalate_clinical_safety_alert(uuid, text, text)
  from public, anon;
revoke all on function public.resolve_clinical_safety_alert(uuid, text)
  from public, anon;
revoke all on function public.configure_clinical_safety_alert_rule(uuid, text, integer, text, text)
  from public, anon;

grant execute on function public.create_clinical_safety_alert(uuid, uuid, uuid, text, text, text, uuid)
  to authenticated;
grant execute on function public.acknowledge_clinical_safety_alert(uuid, text)
  to authenticated;
grant execute on function public.escalate_clinical_safety_alert(uuid, text, text)
  to authenticated;
grant execute on function public.resolve_clinical_safety_alert(uuid, text)
  to authenticated;
grant execute on function public.configure_clinical_safety_alert_rule(uuid, text, integer, text, text)
  to authenticated;
