# Supabase data and local development

The working application stores authentication in Supabase Auth and clinic organizations, branches, patients, appointments, clinical records, staff roles, plan requests, and audit events in Supabase PostgreSQL. The browser does not use `localStorage` as its source of truth.

## Environment

Copy `apps/web/.env.example` to `apps/web/.env.local` and set the Supabase URL, publishable key, and server-only secret key. Never expose the secret key through client code or a `NEXT_PUBLIC_` variable.

Run the migrations in order from `supabase/migrations`. For a Phase 1 installation that already ran migrations 001–003, apply `004_phase2_clinical_workflow.sql` once. The migration is additive and preserves existing patient rows.

## Authentication setup

Create the platform administrator in Supabase **Authentication > Users**, then promote its profile using the SQL in [the Supabase setup guide](../supabase/README.md). Platform administrators create clinic organizations and their initial administrator accounts through the platform console. The generated temporary password is shown once and must be replaced at first sign-in.

Clinic patient, appointment, branch, team, and audit records are organization- and branch-scoped by PostgreSQL row-level security. Phase 2 chart access is audited; clinical documents stay in the private storage bucket and use expiring signed links. Do not enter real patient information until role/branch testing and deployment security, privacy, backup, and recovery requirements have been reviewed for the operating jurisdiction. Use synthetic patient records during development.
