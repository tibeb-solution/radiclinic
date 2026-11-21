# Supabase data and local development

The working application stores authentication in Supabase Auth and clinic organizations, branches, patients, appointments, clinical records, staff roles, plan requests, and audit events in Supabase PostgreSQL. The browser does not use `localStorage` as its source of truth.

## Environment

Copy `apps/web/.env.example` to `apps/web/.env.local` and set the Supabase URL, publishable key, and server-only secret key. Never expose the secret key through client code or a `NEXT_PUBLIC_` variable.

Run the migrations in order from `supabase/migrations`. For an existing installation that already ran the first two migrations, apply `003_api_role_grants.sql`.

## Authentication setup

Create the platform administrator in Supabase **Authentication > Users**, then promote its profile using the SQL in [the Supabase setup guide](../supabase/README.md). Platform administrators create clinic organizations and their initial administrator accounts through the platform console. The generated temporary password is shown once and must be replaced at first sign-in.

Clinic patient, appointment, branch, team, and audit records are organization-scoped and protected by PostgreSQL row-level security. Do not enter real patient information until deployment security, privacy, backup, and recovery requirements have been reviewed for the operating jurisdiction.
