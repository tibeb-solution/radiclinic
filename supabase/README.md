# Supabase setup

## 1. Create the project

Create a Supabase project, then open **SQL Editor** and run these files in order:

- `migrations/001_phase1_foundation.sql`
- `migrations/002_auth_and_tenant_guards.sql`
- `migrations/003_api_role_grants.sql`
- `migrations/004_phase2_clinical_workflow.sql`
- `migrations/005_phase2a_diagnosis_management.sql`
- `migrations/006_phase2b_diagnosis_lifecycle.sql`
- `migrations/007_phase2c_clinical_safety_alerts.sql`
- `migrations/008_phase2d_case_based_diagnosis.sql`
- `migrations/009_phase2e_clinical_enhancements.sql`

The first migration creates the Phase 1 tables, private document bucket, helper functions, and baseline row-level security. The second adds first-login password setup, clinic support requests, branch-aware tenant checks, and cross-organization reference guards. The third grants the required PostgREST table privileges while leaving row-level security enabled. The fourth adds the Phase 2 patient chart and clinical workflow tables, constraints, RPCs, and row-level security policies without replacing existing patient data. The fifth adds a clinic-managed diagnosis catalog, searchable diagnosis codes, multi-tooth and anatomical diagnosis locations, diagnosis history, and a validated diagnosis-recording RPC. The sixth adds diagnosis certainty and priority, controlled status transitions, append-only reassessments and outcomes, and audit history. The seventh adds auditable clinical safety alerts, acknowledgment and resolution workflows, escalation rules, branch-scoped access, and a dashboard alert list. The eighth adds visit case types, specialty-filtered diagnosis recommendations and search, documented specialty/duplicate overrides, and a leadership-reviewed catalog-proposal queue. The ninth separates source-specific medical assessments, adds structured review-of-systems and doctor conclusions, staged treatment planning, anatomical tooth identities and three display formats, appointment recommendations with backend conflict checks and authorized overrides, validated safety-reference decisions, referral/document history, and protected clinical history entries.

If migrations 001–004 have already been applied, apply migrations 005–009, each once and in order. If 001–005 have been applied, run 006, 007, 008, then 009. If 001–006 have been applied, run 007, 008, then 009. If 001–007 have been applied, run 008 and then 009. If 001–008 have been applied, run only 009. Copy each complete file into a new Supabase SQL Editor query; do not rerun a migration after it succeeds.

Phase 2 chart features include editable patient demographics, append-only medical and dental history, encounter examinations and vitals, FDI tooth findings, diagnoses, treatment-plan items, performed procedures, prescriptions, consent records, clinical review and version history, and private patient attachments. Phase 2A adds a clinic-managed diagnosis catalog and enforces diagnosis, patient, visit, branch, and tooth-location consistency in the database. Phase 2B lifecycle foundation adds certainty, urgency, controlled diagnosis closure/reopening, append-only reassessments, and outcomes that can reference procedures. The Phase 2C first slice adds clinician-flagged safety alerts, required action documentation for acknowledgment and resolution, auditable supervisor escalation, effective-dated escalation settings, and dashboard visibility. Escalation is presented for an authorized supervisor to perform; it is not an automated notification service. Phase 2D adds visit case types, suggested and searchable diagnosis categories, documented reasons for specialty overrides or repeat diagnoses, and manual diagnosis provenance. A proposed catalog addition remains separate from the patient diagnosis and can only be approved, rejected, sent back for clarification, or merged by organization administrators or central clinical supervisors. Patient refusal/reconsideration, second opinions, finalized-record amendments and late entries, secure clinical exports/transfers, and broader governance configuration remain outstanding. Consent linked to a treatment item authorizes that item; escalated clinical records are restricted to central clinical supervisors and organization administrators. Test role and branch isolation against a staging Supabase project before using real patient data.

Platform administrators can pause or restore a clinic administrator's access from the clinic list. Pausing deactivates the clinic membership, blocking workspace and database access without deleting the authentication user or any clinic data. Clinic administrators can pause and restore their staff from the team directory.

Platform administrators can permanently delete a clinic organization from the clinic list by selecting its delete action and confirming the exact clinic name. This removes its organization-scoped database records and clinical-document files, and writes a platform audit event. Clinic member Auth accounts are deleted only when they have no other organization or branch memberships; accounts still referenced by retained records can remain but lose access to the deleted clinic. Deleting a user in Supabase Auth alone does not delete the organization, so that organization remains listed until it is deleted from the platform console.

## 2. Configure the web app

Copy `apps/web/.env.example` to `apps/web/.env.local`, then replace:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

The first two values are available from **Project Settings > API**. The secret key must stay server-only and must never be added to browser code or `NEXT_PUBLIC_` variables.

## 3. Create the platform administrator

In Supabase:

1. Open **Authentication > Users**.
2. Add the platform administrator and set a password.
3. Run this SQL, replacing the email:

```sql
update public.profiles
set is_platform_admin = true
where email = 'admin@example.com';
```

The corresponding profile is created automatically when the authentication user is created.

## 4. Deploy the application

For the hosting provider, set these three environment variables for every environment where the app runs:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

Use the same URL and publishable key as local development. Use the project's current secret key as `SUPABASE_SECRET_KEY`; this key grants server-side administrative access and must not be exposed in a `NEXT_PUBLIC_` variable, source file, or browser request. Redeploy after setting environment variables.

The project is a Next.js app. The root `package.json` production command is `pnpm build`; start the production server with `pnpm --filter @dcms/web start`.

## 5. Configure Auth redirects

In Supabase **Authentication > URL Configuration**, set the deployed HTTPS origin as the Site URL, and allow:

- `http://localhost:3000/**` for local development
- `https://your-deployed-host/**` for production

Do not run an already applied migration again. Apply future schema changes using new migration files.
