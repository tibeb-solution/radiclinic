# Milestone 1 Architecture Decisions

## ADR-001: Node.js and NestJS

**Status:** Accepted

Use one Node.js/TypeScript backend with NestJS. A modular monolith is the correct initial fit for the single deployment, shared database, and Milestone 1 feature set. The module boundary is stricter than a typical controller/service monolith but cheaper to operate than independent services.

## ADR-002: pnpm monorepo

**Status:** Accepted

Use pnpm workspaces for `apps/web`, `apps/api`, and `packages/shared`. This provides shared contracts while preserving independent application runtime builds.

## ADR-003: PostgreSQL

**Status:** Accepted

PostgreSQL remains the planned production datastore for relational integrity, composite foreign keys, row-level security, migrations, append-only audit policies, and JSON-backed future extension points.

It is deferred for the local-first prototype. Do not add PostgreSQL, migrations, RLS, Docker Postgres, or production server-side persistence during the interim implementation. Local platform and clinic account records may use the ignored single-server JSON auth file described in `docs/LOCAL_DATA.md`; this is not a substitute for PostgreSQL.

## ADR-004: Drizzle ORM

**Status:** Accepted

Drizzle remains the planned PostgreSQL ORM. It is deferred with PostgreSQL and may be introduced only when database-backed persistence is re-enabled. Choose it over Prisma because SQL visibility and PostgreSQL RLS policies are easier to control and review.

## ADR-005: PostgreSQL RLS

**Status:** Accepted

RLS is mandatory for tenant-owned tables. The API uses `SET LOCAL app.current_org_id` in a database transaction and connects with a non-owner application role.

Platform operations use a separate role and audited service path. RLS bypass policies are never exposed to clinic application code.

## ADR-006: Separate auth realms

**Status:** Accepted

Clinic and platform users use separate tables and token audiences. This prevents a platform account from accidentally becoming a clinic identity and vice versa.

## ADR-007: Cookie refresh tokens

**Status:** Accepted

Use short-lived access tokens and rotating refresh tokens stored in secure HTTP-only cookies. Refresh token values are hashed at rest. Rotation revokes the old family on reuse.

## ADR-008: Zod for shared contracts

**Status:** Accepted

Use Zod schemas in `packages/shared` for shared DTO validation where practical. NestJS class-validator remains usable for framework DTO validation, and every externally reachable input is validated.

## ADR-009: Private object storage

**Status:** Accepted

Use S3-compatible object storage for attachments. MinIO is the local implementation and an S3-compatible cloud provider can be used in production. Database metadata and permissions remain authoritative.

## ADR-010: Append-only clinical revisions

**Status:** Accepted

Clinical records use immutable revision chains and soft deletion. UI "edit" operations create a new revision with a reason and author. Approval is a separate related entity.

## ADR-011: Delayed clinical modules

**Status:** Accepted

Appointments, odontogram, treatment plans, prescriptions, clinic invoicing, inventory, lab, reports, and notifications are not implemented in Milestone 1. Their navigation entries are marked "Coming soon" and domain interfaces may be created later without leaking cross-module database access.

## ADR-012: Platform configuration defaults

**Status:** Accepted

Until configured, platform branding uses `Platform Co.` and a placeholder mark. Clinic registration activation mode, branch sharing policy, and subscription lockout behavior are configuration values rather than hard-coded behavior.

## ADR-013: Demo data and credentials

**Status:** Accepted

Seed data is restricted to local development and test environments. README credentials are demonstration credentials only and must never be used in production.

## ADR-014: Testing strategy

**Status:** Accepted

- Vitest or Jest for unit tests.
- Supertest for API integration tests.
- Direct SQL tests under restricted clinic and platform contexts.
- Playwright for critical registration, login, patient, sharing, and platform flows.

## Known trade-offs

- The monolith will initially be more strongly coupled at deployment level than an eventual microservice architecture.
- RLS setup and migrations require careful role ownership and test coverage.
- Cross-clinic sharing adds explicit grant joins to every read path.
- A full legal compliance program cannot be implemented solely as software and must be completed for a specific deployment jurisdiction.
