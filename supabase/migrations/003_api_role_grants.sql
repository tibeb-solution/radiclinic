grant usage on schema public to authenticated, service_role;

revoke all on all tables in schema public from anon;
revoke insert, update, delete on all tables in schema public from authenticated;

grant all on all tables in schema public to service_role;

grant select on
  public.profiles,
  public.organizations,
  public.branches,
  public.organization_members,
  public.branch_memberships,
  public.patients,
  public.patient_medical_histories,
  public.patient_visits,
  public.clinical_records,
  public.appointments,
  public.record_shares,
  public.patient_attachments,
  public.subscription_payments,
  public.audit_events,
  public.support_requests
to authenticated;

grant insert, update on public.branches to authenticated;
grant update (active) on public.organization_members to authenticated;

grant insert (
  organization_id,
  registered_branch_id,
  patient_number,
  full_name,
  date_of_birth,
  phone,
  created_by
) on public.patients to authenticated;
grant update (status) on public.patients to authenticated;

grant insert (
  organization_id,
  patient_id,
  allergies,
  medications,
  conditions,
  previous_medical_treatments,
  previous_dental_treatments,
  dental_history,
  notes,
  updated_by
) on public.patient_medical_histories to authenticated;

grant insert (
  organization_id,
  branch_id,
  patient_id,
  visit_number,
  visited_at,
  chief_complaint,
  vital_signs,
  observations,
  created_by
) on public.patient_visits to authenticated;

grant insert (
  organization_id,
  branch_id,
  patient_id,
  visit_id,
  title,
  diagnosis,
  treatment_plan,
  completed_procedures,
  prescriptions,
  tooth_chart,
  status,
  submitted_by
) on public.clinical_records to authenticated;

grant insert (
  organization_id,
  branch_id,
  patient_id,
  title,
  starts_at,
  ends_at,
  status,
  notes,
  created_by
) on public.appointments to authenticated;
grant update (status) on public.appointments to authenticated;

grant insert (
  origin_organization_id,
  receiving_organization_id,
  patient_id,
  patient_consent,
  record_categories,
  clinical_record_ids,
  status,
  expires_at,
  authorized_by,
  revoked_by,
  revoked_at
) on public.record_shares to authenticated;
grant update (
  patient_consent,
  record_categories,
  clinical_record_ids,
  status,
  expires_at,
  authorized_by,
  revoked_by,
  revoked_at
) on public.record_shares to authenticated;

grant insert (
  organization_id,
  patient_id,
  clinical_record_id,
  storage_bucket,
  storage_path,
  file_name,
  mime_type,
  file_size,
  uploaded_by
) on public.patient_attachments to authenticated;

grant insert (
  organization_id,
  amount,
  currency,
  status,
  external_reference,
  paid_at,
  recorded_by
) on public.subscription_payments to authenticated;

grant insert (
  organization_id,
  branch_id,
  actor_id,
  action,
  entity_type,
  entity_id,
  before_data,
  after_data,
  ip_address,
  user_agent
) on public.audit_events to authenticated;

grant insert (
  organization_id,
  subject,
  details,
  created_by
) on public.support_requests to authenticated;

grant update (name, logo_url, contact_phone, address, timezone, country, updated_at)
on public.organizations to authenticated;
grant update (full_name, avatar_url, updated_at)
on public.profiles to authenticated;
