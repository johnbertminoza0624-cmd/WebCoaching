# AWR Quality Coaching Platform — architecture

Full-stack app replacing the `AWR Care and Claims CF-MF.xlsm` workbook.

## Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| API | NestJS 11 (REST, Zod validation via `nestjs-zod`) |
| Web | Next.js 15 App Router, React Server Components |
| ORM / DB | Prisma 6 + PostgreSQL 16 |
| UI | shadcn/ui + Tailwind v4, tokens from `design/awr-coaching-ui.html` |
| Auth | NestJS-issued JWT — short access token + rotating refresh token in httpOnly cookies; Argon2id password hashing |
| Files | S3-compatible object storage (MinIO locally) for signatures and PDFs |
| PDF | Puppeteer rendering a server-side template in the API |
| Charts | Recharts, palette from the validated tokens |

```
apps/
  api/          NestJS
  web/          Next.js
packages/
  db/           Prisma schema, migrations, seed
  shared/       Zod DTOs, RBAC matrix, scoring logic — imported by BOTH sides
  ui/           shadcn components + the design tokens
```

`packages/shared` exists so the **scoring rules live in exactly one place**. The
form's live score in the browser and the authoritative score written by the API
must never be two implementations that can drift apart.

## Roles

Eight roles, defined in [`packages/shared/src/rbac.ts`](packages/shared/src/rbac.ts).

| Role | Does | Sees |
|---|---|---|
| Agent | Signs their own acknowledgement, completes action items | Own records |
| Ops Team Lead | Signs as supervisor, authors the SMART action plan | Their teams |
| QA | Creates and scores audits | Own audits |
| QA Team Lead | Calibration; reopen/void audits | Whole account |
| Ops Account Manager | Coaching oversight across teams | Whole account |
| QA Manager | Owns form templates, weights, reference lists | Whole account |
| Service Delivery Manager | Executive read across programs | All accounts |
| Admin | User and role administration | All accounts |

**Permission and scope are separate checks.** `can()` answers *may this role do
this at all*; `buildFormScopeFilter()` answers *which rows*. Every list query
composes the scope filter — a `@RequirePermission()` guard alone would let a QA
Team Lead read another account's audits.

### Two deliberate restrictions

1. **Admin cannot sign for anyone.** `ADMIN` is granted every permission
   *except* `form:sign_agent` and `form:sign_supervisor`. If an admin could sign
   on someone's behalf, every acknowledgement in the system becomes unprovable.
   The audit trail is the product here.
2. **No one can change their own role.** `assignableRoles()` returns `[]` when
   actor === target, enforced again in the service and disabled in the UI.

Every role change writes a `RoleChange` row (actor, from, to, reason) plus an
`ActivityLog` entry.

## Data model highlights

Full schema: [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma)

- **Templates are versioned.** The workbook is already on "v1.3 S 2025". A
  `FormParameterResult` snapshots the parameter *text and weight* it was scored
  against, so re-weighting a template never retroactively rewrites a signed audit.
- **Reference lists are tables, not enums** — dispositions, call reasons, hold
  reasons, root-cause gaps. The roster visibly churns (waves, active/inactive),
  and the QA Manager edits these without a deploy.
- **Durations are integer seconds**, never `TIME` columns. Arithmetic on time-of-day
  columns is a recurring source of off-by-an-hour bugs, and hold time is summed.
- **`FormSignature` stores a `formHash`** — SHA-256 of the form at the moment of
  signing. If the audit is edited afterwards, the mismatch is detectable, so
  "this is what I signed" is a provable claim rather than a policy.
- **Denormalized `qaScore` and the three critical-error counts** live on
  `CoachingForm`, recomputed on every write. The dashboard aggregates over 100k+
  rows; recomputing from `form_parameter_results` on read would not hold up.

## Form lifecycle

```
QA_REVIEW ──QA releases──> RELEASED_TO_OPS ──TL starts──> OPS_COACHING
                                                               │
                                                       TL signs & releases
                                                               ▼
FINALIZED <──agent acknowledges── AWAITING_AGENT_SIGNATURE <── RELEASED_TO_AGENT
                          ▲                                          
                          └──reopen (QA TL)

              any state ──void (QA TL/Mgr)──> VOIDED
```

A form is created by importing a row from the uploaded `.xlsx`, so it enters at
`QA_REVIEW` already scored — there is no pre-QA draft state.

**Only the role that owns a stage may advance it** (`STAGE_OWNER` /
`canAdvance()` in [`packages/shared/src/workflow.ts`](packages/shared/src/workflow.ts)).
This is what makes the dashboards trustworthy: a stage count cannot move unless
the person responsible for that stage acts.

`VOIDED` sits outside the sequence — terminal, but never "completed", so it is
excluded from both pending workload and completion-rate denominators.

The stage model lives in `packages/shared` for the same reason scoring does: the
Prisma `FormStatus` enum, the API's transition guards, and the browser's
dashboards must never hold three versions of the same answer. Entering a stage
stamps its own timestamp column on `CoachingForm` (`qaReviewAt`,
`releasedToOpsAt`, …), which is what stage aging, SLA breach counts, and average
time-in-stage are computed from. These are real columns rather than a replay
over `FormChangeLog` because the dashboard aggregates stage age across the whole
account; `FormChangeLog` remains the record of *who* moved it and why.

Scoring, section C generation, and status transitions run **server-side in a
single transaction**. The browser computes the same score for instant feedback,
but the client's number is never trusted.

## Signatures

Drawn signatures are captured on canvas, trimmed, and uploaded as a transparent
PNG; uploads go through the same path. Stored as an object-storage key plus a
SHA-256 content hash — never as a data URI in Postgres, where it would bloat
every user query.

A `Signature` is reusable profile-level; a `FormSignature` is one application of
it, capturing signer, role, timestamp, IP, user agent, and the form hash.

## The coaching form repository

The platform is not Care-and-Claims-only. `FormTemplate` is a **repository**:
each program has its own coaching form, and QA, QA Managers and Admins pick one
when starting an audit.

- `accountId = null` means a **global** form offered to every account.
- Only `PUBLISHED` templates are selectable — a half-written draft can never be
  used to score a real call.
- `slug` is the stable family identity; `(slug, version)` is unique. Versioning
  is per family, not per account, because Postgres treats NULLs as distinct and
  an `(accountId, version)` key would let duplicate global templates through.
- A published template that has already scored audits **forks to a new version**
  rather than being edited in place.

Weights are validated to total exactly `1.0000` on both save and publish. A
template summing to 0.95 silently caps every agent scored on it at 95%, and
nobody notices for a quarter.

## Change logs

Two tables, both derived from a real before/after diff computed server-side.
The client never supplies its own list of what it changed — an audit trail that
can be lied to is worse than none, because it looks authoritative.

| Table | Covers |
|---|---|
| `template_change_log` | Every edit to a coaching form in the repository: renames, weight changes, parameters added or removed, publish, archive |
| `form_change_log` | Every edit to an individual audit: field, old value, new value, actor, resulting revision, IP |

### Editing a signed form

Forms stay editable at **all** times, including after signing. That collides
with what a signature means, so:

- Any edit is allowed in any status. Nothing is ever locked.
- Editing a `COMPLETED` form requires `form:edit_completed` **and a written
  reason**.
- A **substantive** edit (anything affecting what was scored or acknowledged)
  bumps `revision`, marks existing signatures `supersededAt`, and returns the
  form to `PENDING_AGENT` for re-acknowledgement.
- A **cosmetic** edit (typo in an observed-behavior note, action-plan wording)
  is logged but does not invalidate signatures. Otherwise people re-sign
  constantly and stop reading what they sign.
- Superseded signature rows are **never deleted** — they are the evidence that
  someone acknowledged revision N. This is why `FormSignature` is keyed on
  `(formId, signerRole, revision)`.

## Theme

`packages/ui/src/theme.css` — "Google Remix Remix" by Sihab Hasan (21st.dev),
imported as the shadcn/Tailwind v4 token set, with four documented corrections:

1. `--accent: transparent` → the theme's own sidebar-accent step. As shipped,
   hover and selected states were invisible.
2. `--muted: transparent` → the secondary step. Muted is load-bearing here
   (table hover, segmented controls, readonly fields).
3. `--ring: transparent` → primary. As shipped there was **no keyboard focus
   indicator at all** (WCAG 2.4.7 failure).
4. The chart ramp cannot serve as a categorical scale. In light mode
   `--chart-3` (#fbbc05) sits at 1.66:1 on white; in dark mode chart-2 and
   chart-3 are ΔE 3.5 apart under tritanopia — indistinguishable. The Google
   hues are retained for single-series and status use; the three critical-error
   categories are re-stepped and validated (all six checks pass, all-pairs,
   both modes).

## Next steps

1. Scaffold the monorepo, run the first migration, seed reference lists and the
   roster from the workbook.
2. `apps/api`: auth + RBAC guards, then the forms module (the transaction-heavy
   part), then admin/users.
3. `apps/web`: shadcn init with these tokens, then the four screens already
   prototyped in `design/awr-coaching-ui.html`.
4. PDF renderer, sharing the template with the web form.
