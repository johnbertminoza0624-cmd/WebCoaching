# AWR Quality Coaching Platform

A full-stack web application that replaces the manual `AWR Care and Claims CF-MF.xlsm` workbook process with a structured, role-based Coaching workflow — from QA audit import through Ops Team Lead sign-off.

## Purpose

Quality Auditors (QA) currently score agent calls in a spreadsheet and walk agents through the results manually. This app turns that into a guided digital workflow:

1. QA uploads the audit `.xlsx` export.
2. QA starts a Coaching session by selecting a **Call ID** instead of retyping audit data.
3. The system auto-populates all audit fields and parameter scores from the spreadsheet (read-only, source of truth).
4. QA adds **observations** (required for any parameter scored "No") and completes Hold Attempt Details.
5. QA releases the Coaching to the Ops Team Lead, who signs as supervisor and builds the SMART action plan.
6. The Agent reviews and acknowledges (signs) the completed Coaching.

The goal is to eliminate manual re-entry/transcription errors, enforce that observations exist wherever a parameter failed, and produce a provable, signed audit trail (with tamper-evident signatures) instead of an editable spreadsheet.

## Tech Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| API | NestJS 11 (REST, Zod validation via `nestjs-zod`) |
| Web | Next.js 15 App Router, React 19 / React Server Components |
| ORM / DB | Prisma 6 + PostgreSQL 16 |
| UI | shadcn/ui + Tailwind CSS v4, design tokens from `design/awr-coaching-ui.html` |
| Auth | NestJS-issued JWT (short-lived access token + rotating refresh token in httpOnly cookies), Argon2id password hashing; optional Azure AD SSO |
| Files | S3-compatible object storage (MinIO locally) for signatures and PDFs |
| PDF export | Puppeteer, server-side template rendered in the API |
| Charts | Recharts |
| Spreadsheet parsing | `xlsx` (SheetJS) on the web client for reading uploaded audit files |
| Forms/validation | react-hook-form + Zod, shared DTOs between client and server |

### Monorepo layout

```
apps/
  api/          NestJS backend (REST API, auth, business logic, PDF/S3)
  web/          Next.js frontend (App Router)
packages/
  db/           Prisma schema, migrations, seed scripts
  shared/       Zod DTOs, RBAC matrix, scoring logic — imported by both apps
  ui/           shadcn components + design tokens
design/
  awr-coaching-ui.html   Reference UI/design tokens
docker-compose.yml       Local infra (Postgres, MinIO, etc.)
```

`packages/shared` exists so scoring rules live in exactly one place — the browser's live score preview and the API's authoritative score can never drift apart, since the client's computed score is never trusted for persistence.

## Roles

Eight roles, defined in `packages/shared/src/rbac.ts`:

| Role | Does | Sees |
|---|---|---|
| Agent | Signs their own acknowledgement, completes action items | Own records |
| Ops Team Lead | Signs as supervisor, authors the SMART action plan | Their teams |
| QA | Creates and scores audits, runs Coaching sessions | Own audits |
| QA Team Lead | Calibration; reopen/void audits | Whole account |
| Ops Account Manager | Coaching oversight across teams | Whole account |
| QA Manager | Owns form templates, weights, reference lists | Whole account |
| Service Delivery Manager | Executive read across programs | All accounts |
| Admin | User and role administration | All accounts (cannot sign for anyone) |

Permission (`can()`) and data scope (`buildFormScopeFilter()`) are checked separately — every list query composes the scope filter so a role's visibility can't silently expand.

## Coaching Process

When starting a Coaching session, the QA does **not** manually fill out audit fields. Instead, the Coaching is populated automatically from the uploaded `.xlsx` audit file, which is treated as the single source of truth for audit data.

### 1. Call ID as the primary selector

The manually entered Call ID field is replaced with a **searchable dropdown/select**, populated with every Call ID found in the uploaded `.xlsx`.

```
Call ID: [ Search or select Call ID ▼ ]
```

Selecting a Call ID triggers the system to retrieve the matching audit record from the uploaded file.

### 2. Automatic audit population

Once a Call ID is selected, the system matches it to the corresponding row in the `.xlsx` and auto-fills:

- Agent Name
- EID
- Supervisor
- Quality Auditor
- Call Date
- Audit Date
- Disposition
- Call Reason
- Call ID
- AHT
- Total Hold Time
- All parameters configured in the selected Coaching Form, and their scores

**Example** — uploaded row:

| Agent Name | EID | Supervisor | Quality Auditor | Call Date | Audit Date | Disposition | Call Reason | Call ID | AHT | Total Hold Time | Greeting | Verification | Resolution |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| John Doe | 12345 | Jane Smith | QA User | 08/16/2026 | 08/16/2026 | Transfer | Billing | 123456789 | 450 | 35 | Yes | No | Yes |

Selecting Call ID `123456789` populates all of the above automatically.

### 3. Populated data is read-only

Once populated, the QA **cannot edit** any imported field, including Agent Name, EID, Supervisor, Quality Auditor, Call Date, Audit Date, Disposition, Call Reason, Call ID, AHT, Total Hold Time, parameter names, or parameter scores. The QA's role is not to modify or correct imported audit data — the `.xlsx` file remains the source of truth for that data.

### 4. QA's responsibility: observations

For each parameter, the Coaching form shows:

| Field | Editable? |
|---|---|
| Parameter Name | Read-only |
| Parameter Score | Read-only |
| QA Observation | Editable |

Example:

| Parameter | Score | QA Observation |
|---|---|---|
| Greeting | Yes | Optional observation |
| Verification | No | **Required observation** |
| Resolution | N/A | Optional observation |

### 5. Observation validation rules

Validation is conditional on the imported score:

- **Score = No → Observation required.** The audit cannot be released until every "No"-scored parameter has an observation.
- **Score = Yes → Observation optional.**
- **Score = N/A → Observation optional.**

If any "No"-scored parameter lacks an observation, release is blocked and the system clearly flags which parameter(s) still need one.

### 6. QA workflow through Hold Attempt Details

After selecting a Call ID, the QA only needs to:

1. Review the auto-populated audit information.
2. Add observations for each parameter as required.
3. Complete any other QA-owned fields.
4. Complete the **Hold Attempt Details** section.
5. Confirm all required observations are present.
6. Release the audit.

No imported audit data is manually entered or modified at any point.

### 7. Release audit

The QA releases the Coaching via **Release Audit to Ops TL**. Before allowing release, the system validates:

- A Call ID has been selected.
- The required audit data exists.
- Every "No"-scored parameter has a QA observation.
- All other required QA fields are completed.
- Hold Attempt Details is completed where required.

If anything required is missing, release is blocked and the missing items are clearly identified. On release, the Coaching moves to the **Ops TL stage** in the form lifecycle.

### 8. Data ownership summary

| Source of truth: uploaded `.xlsx` | Owned by QA in Coaching |
|---|---|
| Agent Name, EID, Supervisor, Quality Auditor, Call Date, Audit Date, Disposition, Call Reason, Call ID, AHT, Total Hold Time, Parameter Scores | QA Observations, other QA-owned fields, Hold Attempt Details |

The QA can never change imported scores or audit information from the Coaching interface.

**Overall flow:**

```
Upload .xlsx → Select Call ID → Auto-populate Audit → QA Adds Observations
            → Complete Hold Attempt Details → Release Audit to Ops TL
```

## Dashboard: Role-Based, Workflow-Driven

The Dashboard is a **summary and visualization layer over the Audits page** — never an independent source of Coaching data. It maintains no counters of its own; every metric is recomputed from the current workflow status of the audit records.

```
Audit / Coaching records → Workflow status → Role-based filtering
                         → Dashboard calculations → KPIs / funnel / charts
```

### Single source of truth

Both pages read the same records from a shared store (`lib/audit-store.ts`), and both scope those records through the *same* function (`scopeAudits` in `lib/coaching-metrics.ts`). A user can never see a Dashboard metric covering records they cannot access on the Audits page. When an audit advances a stage, the Dashboard recomputes immediately — QA pending drops, Ops TL pending rises, the completion rate moves.

### Workflow stages

`QA Review → Released to Ops TL → Ops TL Coaching → Released to Agent → Awaiting Agent Signature → Finalized`

Only the role that owns the current stage may advance it. `VOIDED` sits outside the sequence: terminal, but never counted as completed, so it leaves both the pending workload and the completion-rate denominator.

An audit contributes to exactly one stage bucket, and stage decides whose workload it is — a record in QA Review is the QA's pending work and appears in no Ops TL or Agent metric.

### Created ≠ completed

"Total coaching created" is shown explicitly as a volume count, labelled as *not* a completion count. A record counts as complete only once the Agent acknowledges it and it reaches `FINALIZED`.

### Role-specific views

| Role | Sees |
|---|---|
| Agent | Own records only — pending signature, completed, total received, acknowledgement rate. No programme analytics. |
| Ops Team Lead | Their teams — pending coaching, active coaching, awaiting agent, Ops TL completion rate |
| QA | Own audits — pending QA review, released to Ops TL, QA completion rate, finalized |
| QA TL / QA Mgr / Ops AM / SDM / Admin | Whole pipeline — pending per stage, overall completion, plus volume by wave / supervisor / QA auditor |

### Stage-scoped rates

Each completion rate divides only by the records that actually **reached** that stage — Ops TL completion is measured against records released to Ops TL, agent acknowledgement against records released to agents. Records from different stages are never mixed into one rate.

### Bottlenecks and aging

Each stage carries an SLA in hours (`STAGE_SLA_HOURS`). The funnel shows, per stage: record count, share of the live set, average time waiting, and how many have breached their target. The pending stage holding the most records is called out explicitly as the current bottleneck, and a "longest waiting" table lists the most stuck records with the role that owes the next action. Average time *passing through* each stage is computed from recorded stage-entry timestamps.

Every KPI tile and funnel row deep-links to the Audits page pre-filtered to the stages behind that number (`/audits?stage=RELEASED_TO_OPS,OPS_COACHING`), so the row count always matches the figure clicked.

> **Note:** identity currently comes from a role switcher in the header (`lib/session.tsx`) as a stand-in for authentication. When the API lands it is replaced by the JWT, and scoping moves server-side via `buildFormScopeFilter()`.

---

## Form Lifecycle

```
QA_REVIEW ──QA releases──> RELEASED_TO_OPS ──TL starts──> OPS_COACHING
                                                               │
                                                       TL signs & releases
                                                               ▼
FINALIZED <──agent acknowledges── AWAITING_AGENT_SIGNATURE <── RELEASED_TO_AGENT

              any state ──void (QA TL / QA Mgr)──> VOIDED
```

A form is created by importing a row from the uploaded `.xlsx`, so it enters at `QA_REVIEW` already scored — there is no pre-QA draft state. Only the role that owns the current stage may advance it, so a stage count cannot change unless the person responsible for that stage acts.

The stage model has **one definition**, in [`packages/shared/src/workflow.ts`](packages/shared/src/workflow.ts) — stage order, legal transitions, stage owners, action labels and SLAs. The Prisma `FormStatus` enum mirrors it, and the web app aliases it rather than redeclaring it. Entering a stage stamps its own timestamp column on `CoachingForm` (`qaReviewAt`, `releasedToOpsAt`, `opsCoachingAt`, `releasedToAgentAt`, `awaitingSignatureAt`, `finalizedAt`), which is what stage aging and average time-in-stage are computed from.

Scoring, section generation, and status transitions run server-side in a single transaction. The browser computes the same score for instant feedback, but the client's number is never trusted for persistence.

## Data Model Highlights

- **Templates are versioned.** A `FormParameterResult` snapshots the parameter text and weight it was scored against, so re-weighting a template never retroactively rewrites a signed audit.
- **Reference lists are tables, not enums** (dispositions, call reasons, hold reasons, root-cause gaps) — editable by the QA Manager without a deploy.
- **Durations are integer seconds**, never `TIME` columns, to avoid time-of-day arithmetic bugs.
- **`FormSignature` stores a `formHash`** (SHA-256 of the form at signing time) so post-signature edits are detectable.
- **Denormalized `qaScore` and critical-error counts** on `CoachingForm` are recomputed on every write, since dashboards aggregate over 100k+ rows.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma) for full details.

## Getting Started

### Prerequisites

- Node.js >= 20.11
- pnpm 9.12.0
- Docker (for local Postgres/MinIO via `docker-compose.yml`)

### Setup

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web: `http://localhost:3000`
- API: `http://localhost:4000`

### Common scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run all apps in dev mode (Turborepo) |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all workspaces |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm db:generate` | Generate Prisma client |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:seed` | Seed the database |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm infra:up` / `pnpm infra:down` | Start/stop local Docker infra |
