# DCMS Milestone 1 Architecture

## 1. System overview

The Dental Clinic Management System (DCMS) is a multi-tenant, subscription-based platform for independent dental clinics. It is owned and operated by the platform company.

The system is a pnpm monorepo:

- `apps/web`: Next.js App Router frontend.
- `apps/api`: NestJS modular-monolith REST API.
- `packages/shared`: shared TypeScript types, Zod schemas, permission constants, and enums.

The monolith is split into domain modules, but every module uses explicit service interfaces and has no direct cross-module table access.

## Interim local-data mode

Milestone 1 development is currently local-first. No PostgreSQL database is implemented. The Next.js app stores clinic demo and user-created records in browser `localStorage` through one typed repository module. Local authentication accounts and hashed sessions are the limited exception: they are written to an ignored JSON file on the single local application server, not to browser storage.

The repository boundary is intentionally similar to a future API repository:

- UI components call repository functions, never browser storage APIs directly.
- A shared seed is loaded once for demo clinics, users, branches, patients, and audit activity.
- Mutations update local state and append local audit events.
- Clinic demo data and the local account file are not production-secured or suitable for multi-instance deployment.
- The future API/database adapter replaces the repository implementation without changing domain services.

PostgreSQL, Drizzle, RLS, Docker Postgres/MinIO/Mailpit, and production server-side auth are explicitly deferred until local product flows are complete. Local auth uses separately provisioned platform and clinic credentials, salted password hashes, and HTTP-only session cookies; it does not provide production-grade rate limiting or distributed session storage.

## 2. Core architectural boundaries

### Tenant isolation

- Every tenant-owned table has a non-null `organization_id`.
- Tables associated with a specific clinic location also have `branch_id` where applicable.
- Tenant-owned child tables use composite foreign keys into their organization and branch parents.
- PostgreSQL RLS is enabled on every tenant-owned table.
- API database sessions use a non-superuser, non-table-owner application role.
- For each request transaction, the API sets `app.current_org_id` and optionally `app.current_branch_id` using `SET LOCAL`.
- Platform-admin operations use a separately audited database role or a transaction marked by an audited service path.
- The UI may hide controls, but authorization is never enforced only by the UI.

### Two authentication realms

Platform users and clinic users are separate:

- `platform_users` authenticate through `/platform/login`.
- `users` authenticate through `/login` or a clinic slug/org-code login route.
- Access tokens have distinct audiences: `dcms-platform` and `dcms-clinic`.
- Platform and clinic refresh-token families are stored separately and revoked independently.

### Domain modules

- `auth`
- `platform-admin`
- `organizations`
- `branches`
- `users-roles`
- `patients`
- `clinical-history`
- `sharing`
- `subscriptions`
- `audit`
- `files`

Cross-module database access is prohibited. Modules expose typed application services and DTO contracts.

## 3. Request flow

1. Helmet and CSP middleware establish response security.
2. CORS validates an allowlisted origin.
3. CSRF is required for cookie-based state-changing clinic and platform requests.
4. Rate limiting and authentication execute.
5. Subscription and realm guards execute.
6. The permission guard evaluates the user's organization and branch scope.
7. The NestJS data context opens a transaction.
8. The RLS context variables are set locally for that transaction.
9. The domain service performs the operation.
10. A repository inserts append-only audit events.
11. The transaction commits and the response is returned.

## 4. Authentication

- Passwords use Argon2id with documented cost parameters.
- Access tokens are short-lived.
- Refresh tokens are random rotating secrets stored only as hashes.
- Tokens and other secrets are never exposed in application logs.
- Refresh-token cookies are `httpOnly`, `Secure` in production, and `SameSite=Lax` or stricter.
- Reuse of an already rotated refresh token revokes the token family.
- Sessions record device, IP, user agent, expiry, and revocation time.
- Login events record success/failure metadata.
- Password reset tokens are single-use, hashed, time-limited, and emailed.
- Platform and clinic accounts have separate suspension and lockout behavior.

## 5. Authorization

Permission constants live in `packages/shared`. A guard consumes `@RequirePermission(...)` declarations and resolves branch scope from:

- organization-wide assignments,
- branch assignments,
- one or more roles held by the user,
- the relationship between the target resource and the user's branch scope.

Role definitions are configurable per organization. System defaults are seeded and remain assignable. Platform Super Administrator permissions exist only in the platform realm.

## 6. Clinical data and revisions

Clinical entries are append-only:

- Updates create a new revision linked to the prior revision.
- Every revision records author, timestamp, and reason.
- The previous revision remains viewable.
- Clinical resources use soft deletion only.
- Approval is represented by `approval_requests`.
- A reviewer cannot equal the submitter.
- Database and application constraints enforce this rule for medical-history approvals.

## 7. File storage

Patient attachments remain in a private S3-compatible bucket:

- uploads obtain short-lived presigned PUT URLs,
- downloads obtain short-lived presigned GET URLs,
- every URL request must pass the permission and tenant checks,
- metadata, checksums, uploader, and category are stored in PostgreSQL,
- object keys include organization and patient identifiers,
- bucket access is private and public listing is disabled.

## 8. Sharing

Cross-clinic sharing uses a separate, explicit grant path:

1. The originator enters exact, consent-based lookup attributes.
2. The limited lookup returns matching identity metadata only.
3. The originator creates a share request and consent record.
4. A share grant defines permitted category and record IDs, purpose, expiry, and status.
5. The receiving clinic can read only the granted records.
6. Every read/download is logged in `share_access_log` and `audit_logs`.
7. Revocation is soft and immediate: active accesses stop and existing URLs should expire quickly.

## 9. Audit

The API writes audit records for auth, patient, role, file, sharing, subscription, and suspension events. Sensitive reads are explicitly logged.

An append-only database policy allows the application role to insert audit rows but prevents update and delete. The platform database owner migration role is not available to application requests.

## 10. Frontend

The frontend uses:

- React and Next.js App Router,
- React Hook Form and Zod,
- TanStack Query,
- Tailwind CSS and shared UI primitives,
- a responsive app shell,
- organization and platform layouts,
- standard loading, empty, modal, toast, pagination, and error components.

English is the initial locale. Shared UI copy and country-specific formatting are structured for Amharic and future locales.

## 11. Local infrastructure

Docker Compose provides PostgreSQL, MinIO, and Mailpit. PostgreSQL includes a migration role and a restricted application role. MinIO is available only on private local endpoints. Mailpit captures verification, invitation, and password-reset email.

A single README command sequence starts dependencies and applications.

## 12. Operations and data protection

- TLS terminates at the deployment edge and database TLS is required.
- PostgreSQL encryption at rest is deployment-provider managed or volume-encrypted.
- MinIO/S3 bucket objects are encrypted at rest.
- Application logs must never contain passwords, reset tokens, access tokens, or PHI.
- Backups, recovery, and restore verification are documented in `docs/OPERATIONS.md`.
- Compliance requirements and the legal certification limitation are documented in `docs/COMPLIANCE.md`.
