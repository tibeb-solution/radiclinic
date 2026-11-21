# Role and Permission Matrix

Permissions are implemented in documentation and shared constants. UI-only hiding is not a security boundary. Until server-side auth exists, local demo users can exercise role-aware navigation through a clearly marked development adapter only.

Permissions use stable keys such as `patient:read`. Branch scope is resolved separately for organization-wide and branch-specific assignments.

## Permission keys

| Area | Permissions |
|---|---|
| Organizations | `organization:read`, `organization:update` |
| Branches | `branch:read`, `branch:create`, `branch:update`, `branch:deactivate` |
| Users | `user:read`, `user:create`, `user:update`, `user:deactivate`, `user:assign-role` |
| Roles | `role:read`, `role:create`, `role:update`, `role:configure-permissions` |
| Patients | `patient:read`, `patient:create`, `patient:update`, `patient:deactivate`, `patient:search` |
| Clinical history | `clinical-history:read`, `clinical-history:create`, `clinical-history:update`, `clinical-history:approve`, `clinical-history:delete` |
| Visits | `visit:read`, `visit:create`, `visit:update` |
| Attachments | `attachment:read`, `attachment:upload`, `attachment:download`, `attachment:delete` |
| Sharing | `sharing:create`, `sharing:approve`, `sharing:read`, `sharing:revoke`, `sharing:receive-read` |
| Audit | `audit:read`, `audit:export` |
| Subscription | `subscription:read` |

Platform Super Administrator has separate platform permissions:

`platform:clinic-read`, `platform:clinic-approve`, `platform:clinic-suspend`, `platform:subscription-manage`, `platform:payment-record`, `platform:settings-update`, `platform:audit-read`, `platform:usage-read`.

## Seeded role matrix

`-` means no access, `O` means organization scope, `B` means branch scope.

| Permission | Org Admin | Central Supervisor | Branch Supervisor | Doctor | Nurse | Receptionist | Accountant | Inventory | Lab Coordinator |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| organization:read/update | O/O | O/- | B/- | -/- | -/- | B/- | O/- | -/- | -/- |
| branch:read/create/update/deactivate | O/O/O/O | O/-/-/- | B/B/B/B | B/-/-/- | B/-/-/- | B/-/-/- | -/-/-/- | -/-/-/- | -/-/-/- |
| user:read/create/update/deactivate/assign-role | O/O/O/O/O | O/-/-/-/- | B/O/O/O/O | -/-/-/-/- | -/-/-/-/- | -/-/-/-/- | -/-/-/-/- | -/-/-/-/- | -/-/-/-/- |
| role:read/configure | O/O | O/- | B/- | -/- | -/- | -/- | -/- | -/- | -/- |
| patient:read/create/update/deactivate/search | O/O/O/O/O | O/O/O/O/O | B/B/B/B/B | B/B/B/B/B | B/B/B/-/B | B/B/B/-/B | -/-/-/-/O | -/-/-/-/- | -/-/-/-/B |
| clinical-history:read/create/update/approve | O/O/O/O | O/O/O/O | B/B/B/B | B/B/B/- | B/B/-/- | -/-/-/- | -/-/-/- | -/-/-/- | -/-/-/- |
| visit:read/create/update | O/O/O | O/O/O | B/B/B | B/B/B | B/B/- | B/B/- | -/-/- | -/-/- | -/-/- |
| attachment:read/upload/download/delete | O/O/O/O | O/O/O/O | B/B/B/B | B/B/B/B | B/B/B/- | B/B/B/- | -/-/-/- | -/-/-/- | B/B/B/- |
| sharing:create/approve/read/revoke/receive-read | O/-/O/O/O | O/-/O/O/O | B/-/B/B/O | B/-/B/B/O | -/-/B/-/O | -/-/B/-/O | -/-/-/-/- | -/-/-/-/O | -/-/-/-/O |
| audit:read/export | O/O | O/- | B/- | -/- | -/- | -/- | -/- | -/- | -/- |
| subscription:read | O | O | - | - | - | - | O | - | - |

This table is a minimum seed matrix and is intentionally configurable per organization.

## Enforcement notes

- The API applies both permission checks and RLS.
- A branch assignment never grants access to a branch outside that assignment.
- Organization-wide users may access only branches allowed by the permission and product policy.
- Clinical approval reviewers must be supervisors and cannot approve their own submission.
- Read actions to patient data trigger audit entries in addition to the permission check.
- Accountants receive patient search counts/financial metadata only where separately permitted by future finance modules.
- Receiving-clinic sharing access is granted through `sharing:receive-read` and an active share grant; it is not broad patient database access.
