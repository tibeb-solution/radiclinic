# Supabase setup

## 1. Create the project

Create a Supabase project, then open **SQL Editor** and run these files in order:

- `migrations/001_phase1_foundation.sql`
- `migrations/002_auth_and_tenant_guards.sql`
- `migrations/003_api_role_grants.sql`
- `migrations/004_phase2_clinical_workflow.sql`

The first migration creates the Phase 1 tables, private document bucket, helper functions, and baseline row-level security. The second adds first-login password setup, clinic support requests, branch-aware tenant checks, and cross-organization reference guards. The third grants the required PostgREST table privileges while leaving row-level security enabled. The fourth adds the Phase 2 patient chart and clinical workflow tables, constraints, RPCs, and row-level security policies without replacing existing patient data.

If migrations 001–003 have already been applied, run only `004_phase2_clinical_workflow.sql` from the Supabase SQL Editor. Copy the complete file contents into a new SQL Editor query and run it once. Do not rerun it if it succeeds.

Phase 2 chart features include editable patient demographics, append-only medical and dental history, encounter examinations and vitals, FDI tooth findings, diagnoses, treatment-plan items, performed procedures, prescriptions, consent records, clinical review and version history, and private patient attachments. Consent linked to a treatment item authorizes that item; escalated clinical records are restricted to central clinical supervisors and organization administrators. This is a working clinical-chart baseline, not a complete EHR: cross-clinic sharing workflows, configurable approval queues, inventory/lab/billing integrations, and jurisdiction-specific compliance review remain outstanding. Test role and branch isolation against the live Supabase project before using real patient data.

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
