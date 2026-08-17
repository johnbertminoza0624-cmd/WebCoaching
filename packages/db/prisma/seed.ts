/**
 * Seed — imports the roster and reference lists directly from the workbook, so
 * dev data matches production reality instead of invented names.
 *
 * Idempotent: every write is an upsert keyed on a natural unique, so re-running
 * refreshes lists without duplicating them.
 *
 *   pnpm db:seed
 */
import { PrismaClient, Role, UserStatus, CriticalType, TemplateStatus, FormStatus, AnswerValue } from '@prisma/client';
import * as argon2 from 'argon2';
import * as XLSX from 'xlsx';
import * as path from 'node:path';
import * as fs from 'node:fs';
import 'dotenv/config';

const prisma = new PrismaClient();

const WORKBOOK = path.resolve(
  process.cwd(),
  process.env.SEED_WORKBOOK_PATH ?? '../../AWR Care and Claims CF-MF.xlsm',
);
const ACCOUNT_NAME = 'AWR Care and Claims';
const ACCOUNT_CODE = 'AWR-CC';
const TEMPLATE_SLUG = 'awr-care-claims';
const TEMPLATE_VERSION = '1.3 S 2025';

// ------------------------------------------------------------------
// Workbook helpers
// ------------------------------------------------------------------

type Grid = (string | number | Date | null)[][];

/** Read a sheet as a dense 2-D array so we can address it by column letter. */
function readGrid(sheet: XLSX.WorkSheet): Grid {
  return XLSX.utils.sheet_to_json<Grid[number]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as Grid;
}

const colIndex = (letter: string): number =>
  [...letter.toUpperCase()].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/** Values down one column, trimmed, blanks dropped, duplicates removed. */
function column(grid: Grid, letter: string, startRow = 0): string[] {
  const c = colIndex(letter);
  const out: string[] = [];
  for (let r = startRow; r < grid.length; r++) {
    const v = grid[r]?.[c];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) out.push(s);
  }
  return [...new Set(out)];
}

/** Two columns read as aligned pairs (roster rows), keeping row alignment. */
function rows(grid: Grid, letters: string[], startRow: number): (string | null)[][] {
  const idx = letters.map(colIndex);
  const out: (string | null)[][] = [];
  for (let r = startRow; r < grid.length; r++) {
    const cells = idx.map((c) => {
      const v = grid[r]?.[c];
      const s = v == null ? '' : String(v).trim();
      return s || null;
    });
    if (cells[0]) out.push(cells);
  }
  return out;
}

// ------------------------------------------------------------------
// Identity helpers
// ------------------------------------------------------------------

const usedEmails = new Set<string>();

function emailFor(fullName: string): string {
  const slug = fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Peñano -> Penano
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  let email = `${slug}@awr.local`;
  let n = 2;
  while (usedEmails.has(email)) email = `${slug}${n++}@awr.local`;
  usedEmails.add(email);
  return email;
}

/**
 * The address a person would get if they were the only holder of their name —
 * no collision suffix.
 *
 * `emailFor` appends a number when an address is taken, so calling it twice for
 * the same person mints a *second* account. Several people appear both on the
 * roster (as a supervisor) and in the QA staff list, and without this they were
 * seeded twice with different roles.
 */
function canonicalEmail(fullName: string): string {
  const slug = fullName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  return `${slug}@awr.local`;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '—' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1)! };
}

// ------------------------------------------------------------------
// The v1.3 parameter set (section B of the workbook)
// ------------------------------------------------------------------

const PARAMETERS: Array<[CriticalType, string, number]> = [
  [CriticalType.CUSTOMER, 'Did the agent greet the customer warmly, introduce themselves and the company', 0.05],
  [CriticalType.CUSTOMER, 'Did the agent ask questions to understand the reason for the call and any additional needs', 0.05],
  [CriticalType.PROCESS,  'Did the agent follow the proper account authentication process?', 0.05],
  [CriticalType.PROCESS,  'Did the agent follow the probing questions in Salesforce', 0.20],
  // Workbook reads "maitain" — corrected here; flagged in the seed report.
  [CriticalType.PROCESS,  'Did the agent maintain a professional tone and deliver the required disclosures?', 0.05],
  [CriticalType.PROCESS,  'Did the agent set up the claim correctly, including the correct provider', 0.20],
  [CriticalType.CUSTOMER, "Did the agent escalate the customer's issue to a supervisor if the customer requested one? Did the agent follow proper hold procedures?", 0.15],
  [CriticalType.BUSINESS, 'Did the agent offer an upsell after the issue was properly resolved', 0.05],
  [CriticalType.BUSINESS, 'Did the agent maintain control over the call and the call flow?', 0.15],
  [CriticalType.CUSTOMER, 'Did the agent recap all actions that took place during the call', 0.05],
];

const AGENT_ACK = `I acknowledge that the behaviors and performance items discussed during this coaching session were based on observations from Quality Monitoring. I understand the specific areas identified for improvement and how they impact customer experience, compliance, and overall team performance.

I commit to applying the agreed actions and to seeking clarification where I need support.`;

const SUPERVISOR_ACK = `I acknowledge the observations and findings from the Quality Monitoring results and understand the behaviors identified for development. I recognize my responsibility to provide clear direction, coaching, and support to ensure the agent is equipped to succeed.

I commit to creating and executing the agreed action plan and to reviewing progress with the agent.`;

// ------------------------------------------------------------------
// Fallback reference data
// ------------------------------------------------------------------

/**
 * Used when the source workbook is not available.
 *
 * The workbook is the authority for these lists, but it is not in the repo, so
 * without a fallback the database cannot be seeded at all — and an unseeded
 * database means no users, which means nobody can sign in and none of the API
 * can be exercised. These values mirror the reference lists the web app ships
 * with; when the workbook is present it wins.
 */
const FALLBACK = {
  reasons: {
    Claims: [
      'Claims - Deemed Unit', 'No Technicians / NPPO', 'Escalation', 'Proposal',
      'Parts and Claims', 'Dispatch (No agent staff)', 'Update Unit', 'Reassignment',
      'Claim Modernization', 'Others',
    ],
    Billing: [
      'Proration', 'Charges - Paid in System', 'Service Due', 'Suspended',
      'Payment Reversal', 'Converted Charges', 'Dunning', 'Others',
    ],
    Leasing: ['Buy Out', 'Removal', 'Rewrite', 'Enrollment', 'Others'],
    Retention: ['Cancellation', 'Enrollment - New Property', 'Change (Multiple Address)', 'Others'],
    Others: ['SAR Approval', 'No Product Available', 'Checking Notes', 'Payment Update', 'Eligibility and Benefits', 'Others'],
  } as Record<string, string[]>,
  holdReasons: [
    'Review account details', 'Review bundle proposal', 'Review bundle coverage',
    'Look for Supervisor', 'Transfer to another department', 'Other',
  ],
  gaps: [
    'Knowledge Gap - Product', 'Knowledge Gap - Navigation', 'Knowledge Gap - Policy',
    'Process Gap', 'Communication Gap - Agent', 'No Gap found',
  ],
  drivers: {
    AGENT_CONTROLLABLE: ['Agent knowledge', 'Agent communication', 'Agent process adherence'],
    AGENT_NON_CONTROLLABLE: ['System downtime', 'Policy restriction', 'Third-party delay'],
  } as Record<string, string[]>,
  /** name, eid, supervisor, wave, status — the shape `rows()` returns. */
  roster: [
    ['Jenny Rey Cinco', '21900', 'Filipinas Gerodias', 'Wave 8', 'Active'],
    ['Miko Ryan Caroz', '24137', 'Ostel Remitar', 'Wave 8', 'Active'],
    ['Emaronnel Ganday', '21845', 'Melody Tagaytay', 'Wave 8', 'Active'],
    ['Trizar Coronel', '20375', 'Darwin Tamayo', 'Wave 1', 'Active'],
    ['Rhealyn Benitez', '20004', 'Jennivie Buta', 'Wave 8', 'Active'],
    ['Marvin Medillo', '21291', 'Filipinas Gerodias', 'Wave 3', 'Active'],
    ['Mary Joy Batonon', '21300', 'Filipinas Gerodias', 'Wave 3', 'Active'],
    ['Herly Paran', '21390', 'Dane Joesan Day', 'Wave 6', 'Active'],
    ['Kouichi Arkoncel', '21285', 'Dane Joesan Day', 'Wave 3', 'Active'],
    ['Michael Belo', '21923', 'Michelle Alpas', 'Wave 8', 'Active'],
    ['Nel Ben Layno', '21533', 'Filipinas Gerodias', 'Wave 5', 'Active'],
    ['Venamie Batingal', '21013', 'Darwin Tamayo', 'Wave 2', 'Active'],
    ['Shela Limpiado', '22286', 'Darwin Tamayo', 'Wave 11', 'Active'],
    ['Jacel Macadumpis', '22548', 'Boniconsilii Kim Catalan', 'Wave 13', 'Active'],
    ['Mark Dacillo', '21850', 'Jennivie Buta', 'Wave 7', 'Active'],
    ['Gina Lyn Lascuña', '21642', 'Filipinas Gerodias', 'Wave 6', 'Active'],
  ] as (string | null)[][],
  /** QA staff have no roster row; they are seeded explicitly. */
  qaStaff: [
    ['Melody Flores', 'QA'],
    ['Klyde Villagonzalo', 'QA'],
    ['Elton Te', 'QA'],
    ['Baby Jean Grecia', 'QA_TEAM_LEAD'],
    ['Melody Tagaytay', 'QA_MANAGER'],
    ['Ostel Remitar', 'OPS_ACCOUNT_MANAGER'],
    ['Noland Ortiz', 'SERVICE_DELIVERY_MANAGER'],
  ] as [string, keyof typeof Role][],
};

// ------------------------------------------------------------------
// Seed
// ------------------------------------------------------------------

async function main() {
  const hasWorkbook = fs.existsSync(WORKBOOK);
  console.log(hasWorkbook ? `Seeding from ${WORKBOOK}` : 'Workbook not found — seeding from built-in reference data');
  if (!hasWorkbook) {
    console.log(`  (set SEED_WORKBOOK_PATH to seed from ${WORKBOOK})`);
  }

  let grid: ReturnType<typeof readGrid> = [];
  if (hasWorkbook) {
    const wb = XLSX.readFile(WORKBOOK);
    const ref = wb.Sheets['Reference'];
    if (!ref) throw new Error('The workbook has no "Reference" sheet.');
    grid = readGrid(ref);
  }

  // Read from the workbook when it is present, otherwise from FALLBACK.
  const refColumn = (col: string, skip: number, fb: string[]) =>
    hasWorkbook ? column(grid, col, skip) : fb;

  // ---- account ----------------------------------------------------
  const account = await prisma.account.upsert({
    where: { code: ACCOUNT_CODE },
    update: { name: ACCOUNT_NAME },
    create: { name: ACCOUNT_NAME, code: ACCOUNT_CODE },
  });

  // ---- dispositions + call reasons (the INDIRECT cascade) ---------
  // Column U lists the dispositions; each has its own column of reasons whose
  // row-1 cell is the disposition name.
  const REASON_COLUMNS: Record<string, string> = {
    Billing: 'W',
    Claims: 'X',
    Leasing: 'Y',
    Retention: 'Z',
    Others: 'AA',
  };

  const dispositions = refColumn('U', 1, Object.keys(FALLBACK.reasons));
  for (const [i, name] of dispositions.entries()) {
    const disposition = await prisma.disposition.upsert({
      where: { name },
      update: { sortOrder: i },
      create: { name, sortOrder: i },
    });

    const col = REASON_COLUMNS[name];
    if (hasWorkbook && !col) {
      console.warn(`  ! no call-reason column mapped for disposition "${name}"`);
      continue;
    }
    // Row 0 of that column repeats the disposition name — skip it.
    const reasons = hasWorkbook ? column(grid, col!, 1) : (FALLBACK.reasons[name] ?? []);
    for (const [j, reason] of reasons.entries()) {
      await prisma.callReason.upsert({
        where: { dispositionId_name: { dispositionId: disposition.id, name: reason } },
        update: { sortOrder: j },
        create: { dispositionId: disposition.id, name: reason, sortOrder: j },
      });
    }
    console.log(`  disposition ${name}: ${reasons.length} call reasons`);
  }

  // ---- hold reasons ----------------------------------------------
  const holdReasons = refColumn('AC', 1, FALLBACK.holdReasons);
  for (const [i, name] of holdReasons.entries()) {
    await prisma.holdReason.upsert({
      where: { name },
      update: { sortOrder: i },
      create: { name, sortOrder: i },
    });
  }

  // ---- root cause gaps -------------------------------------------
  const gaps = refColumn('S', 1, FALLBACK.gaps);
  for (const [i, name] of gaps.entries()) {
    await prisma.rootCauseGap.upsert({
      where: { name },
      update: { sortOrder: i },
      create: { name, sortOrder: i },
    });
  }

  // ---- observed drivers ------------------------------------------
  // Columns E and F are two ungrouped lists. Reading them against column C
  // (AgentControllable / AgentNonControllable): E holds behaviours the agent
  // owns, F holds constraints they do not. Verify this mapping with QA.
  const driverGroups: Array<[string, string]> = [
    ['AGENT_CONTROLLABLE', 'E'],
    ['AGENT_NON_CONTROLLABLE', 'F'],
  ];
  for (const [category, col] of driverGroups) {
    for (const [i, name] of refColumn(col, 0, FALLBACK.drivers[category] ?? []).entries()) {
      await prisma.observedDriver.upsert({
        where: { category_name: { category, name } },
        update: { sortOrder: i },
        create: { category, name, sortOrder: i },
      });
    }
  }

  // ---- form template ---------------------------------------------
  const weightTotal = PARAMETERS.reduce((a, [, , w]) => a + w, 0);
  if (Math.round(weightTotal * 1e4) / 1e4 !== 1) {
    throw new Error(`Parameter weights total ${weightTotal}, expected 1.0`);
  }

  const template = await prisma.formTemplate.upsert({
    where: { slug_version: { slug: TEMPLATE_SLUG, version: TEMPLATE_VERSION } },
    update: {
      status: TemplateStatus.PUBLISHED,
      agentAckText: AGENT_ACK,
      supervisorAckText: SUPERVISOR_ACK,
    },
    create: {
      slug: TEMPLATE_SLUG,
      accountId: account.id,
      name: 'Quality Coaching Form — AWR Care and Claims Audit',
      description:
        'Ten weighted parameters covering greeting, authentication, Salesforce probing, claim setup, hold procedure, upsell and call control.',
      lineOfBusiness: 'Care and Claims',
      version: TEMPLATE_VERSION,
      status: TemplateStatus.PUBLISHED,
      agentAckText: AGENT_ACK,
      supervisorAckText: SUPERVISOR_ACK,
    },
  });

  for (const [i, [criticalType, text, weight]] of PARAMETERS.entries()) {
    await prisma.templateParameter.upsert({
      where: { templateId_sortOrder: { templateId: template.id, sortOrder: i + 1 } },
      update: { criticalType, text, weight },
      create: { templateId: template.id, sortOrder: i + 1, criticalType, text, weight },
    });
  }

  // ---- people ------------------------------------------------------
  // Roster: M = name, N = EID, O = supervisor, P = wave, Q = status.
  const roster = hasWorkbook ? rows(grid, ['M', 'N', 'O', 'P', 'Q'], 1) : FALLBACK.roster;

  // Supervisors become Ops Team Leads. A team is one (wave, supervisor) pair,
  // which is how the roster actually partitions.
  const defaultPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';
  const passwordHash = await argon2.hash(defaultPassword, { type: argon2.argon2id });

  const supervisorNames = [...new Set(roster.map((r) => r[2]).filter(Boolean) as string[])];
  const supervisorIds = new Map<string, string>();

  for (const name of supervisorNames) {
    const { firstName, lastName } = splitName(name);
    const user = await prisma.user.upsert({
      where: { email: emailFor(name) },
      update: { role: Role.OPS_TEAM_LEAD, accountId: account.id },
      create: {
        email: [...usedEmails].at(-1)!,
        firstName,
        lastName,
        role: Role.OPS_TEAM_LEAD,
        status: UserStatus.ACTIVE,
        accountId: account.id,
        passwordHash,
        mustChangePassword: true,
      },
    });
    supervisorIds.set(name, user.id);
  }

  const teamIds = new Map<string, string>();
  const teamKey = (wave: string | null, supervisor: string) => `${wave ?? 'Unassigned'}|${supervisor}`;

  for (const [, , supervisor, wave] of roster) {
    if (!supervisor) continue;
    const key = teamKey(wave ?? null, supervisor);
    if (teamIds.has(key)) continue;
    const teamName = `${wave ?? 'Unassigned'} · ${splitName(supervisor).lastName}`;
    const team = await prisma.team.upsert({
      where: { accountId_name: { accountId: account.id, name: teamName } },
      update: { leadId: supervisorIds.get(supervisor) ?? null, wave },
      create: {
        accountId: account.id,
        name: teamName,
        wave,
        leadId: supervisorIds.get(supervisor) ?? null,
      },
    });
    teamIds.set(key, team.id);
  }

  let agentCount = 0;
  for (const [name, eid, supervisor, wave, status] of roster) {
    if (!name) continue;
    const { firstName, lastName } = splitName(name);
    const email = emailFor(name);
    const teamId = supervisor ? (teamIds.get(teamKey(wave ?? null, supervisor)) ?? null) : null;

    await prisma.user.upsert({
      where: { email },
      update: {
        eid,
        teamId,
        status: status === 'Active' ? UserStatus.ACTIVE : UserStatus.INACTIVE,
      },
      create: {
        email,
        eid,
        firstName,
        lastName,
        role: Role.AGENT,
        // The roster's Inactive rows are ex-agents. They are kept, not deleted:
        // their historical audits must stay attributable.
        status: status === 'Active' ? UserStatus.ACTIVE : UserStatus.INACTIVE,
        accountId: account.id,
        teamId,
        passwordHash,
        mustChangePassword: true,
      },
    });
    agentCount++;
  }

  // Auditors (column B) become QA users.
  for (const name of column(grid, 'B', 0)) {
    const { firstName, lastName } = splitName(name);
    const email = emailFor(name);
    await prisma.user.upsert({
      where: { email },
      update: { role: Role.QA, accountId: account.id },
      create: {
        email,
        firstName,
        lastName,
        role: Role.QA,
        accountId: account.id,
        passwordHash,
        mustChangePassword: true,
      },
    });
  }

  // ---- QA staff -----------------------------------------------------
  // The roster lists agents and their supervisors only. QA auditors, the QA
  // Team Lead and the managers never appear on it, so without this they would
  // have no accounts — and the QA stage of the workflow would be unusable.
  for (const [name, role] of FALLBACK.qaStaff) {
    const { firstName, lastName } = splitName(name);
    // Upsert on the canonical address so someone who already exists from the
    // roster has their role corrected rather than duplicated. The explicit
    // staff role wins: it is the more specific declaration.
    const email = canonicalEmail(name);
    usedEmails.add(email);
    await prisma.user.upsert({
      where: { email },
      update: { role: Role[role], accountId: account.id },
      create: {
        email,
        firstName,
        lastName,
        role: Role[role],
        status: UserStatus.ACTIVE,
        accountId: account.id,
        passwordHash,
        mustChangePassword: true,
      },
    });
  }

  // ---- platform admin ---------------------------------------------
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@awr.local';
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: Role.ADMIN, status: UserStatus.ACTIVE },
    create: {
      email: adminEmail,
      firstName: 'Platform',
      lastName: 'Admin',
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      accountId: account.id,
      passwordHash,
      mustChangePassword: true,
    },
  });

  // ---- coaching forms ----------------------------------------------
  // Without these the API has nothing to scope, so none of the record-level
  // permission work can be exercised. Deterministic so the set is stable.
  const formCount = await seedCoachingForms(account.id, template.id);

  const totals = await prisma.user.groupBy({ by: ['role'], _count: true });
  console.log('\nSeed complete');
  console.log(`  account       ${account.name}`);
  console.log(`  template      v${TEMPLATE_VERSION} · ${PARAMETERS.length} parameters · weights sum to 1.0`);
  console.log(`  teams         ${teamIds.size}`);
  console.log(`  roster rows   ${agentCount}`);
  console.log(`  coaching forms ${formCount}`);
  console.log(`  dispositions  ${dispositions.length}`);
  console.log(`  hold reasons  ${holdReasons.length}`);
  console.log(`  gaps          ${gaps.length}`);
  for (const t of totals) console.log(`  ${t.role.padEnd(26)} ${t._count}`);
  console.log(`\n  Sign in as ${adminEmail} — password from SEED_ADMIN_PASSWORD.`);
  console.log('  Every seeded user has mustChangePassword = true.');
}


/**
 * Seeds coaching forms spread across the workflow, so every role has records at
 * its own stage and the scope filters have something real to exclude.
 */
async function seedCoachingForms(accountId: string, templateId: string): Promise<number> {
  const existing = await prisma.coachingForm.count();
  if (existing > 0) {
    console.log(`  coaching forms: ${existing} already present, skipping`);
    return existing;
  }

  const callReasons = await prisma.callReason.findMany();
  const agents = await prisma.user.findMany({ where: { role: Role.AGENT }, include: { team: true } });
  const auditors = await prisma.user.findMany({ where: { role: Role.QA } });
  const parameters = await prisma.templateParameter.findMany({
    where: { templateId }, orderBy: { sortOrder: 'asc' },
  });
  if (!agents.length || !auditors.length || !parameters.length) return 0;

  // Same weighting as the web seed: mostly finalized, with a backlog at Ops TL.
  const stages: FormStatus[] = [
    FormStatus.FINALIZED, FormStatus.FINALIZED, FormStatus.FINALIZED,
    FormStatus.QA_REVIEW, FormStatus.QA_REVIEW,
    FormStatus.RELEASED_TO_OPS, FormStatus.RELEASED_TO_OPS,
    FormStatus.OPS_COACHING,
    FormStatus.RELEASED_TO_AGENT,
    FormStatus.AWAITING_AGENT_SIGNATURE,
  ];

  // Deterministic PRNG — the same database every time it is seeded fresh.
  let seed = 20260817;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  const STAGE_FIELD: Record<string, string> = {
    QA_REVIEW: 'qaReviewAt',
    RELEASED_TO_OPS: 'releasedToOpsAt',
    OPS_COACHING: 'opsCoachingAt',
    RELEASED_TO_AGENT: 'releasedToAgentAt',
    AWAITING_AGENT_SIGNATURE: 'awaitingSignatureAt',
    FINALIZED: 'finalizedAt',
  };
  const ORDER = Object.keys(STAGE_FIELD);

  let created = 0;
  for (let i = 0; i < 80; i++) {
    const agent = agents[Math.floor(rng() * agents.length)]!;
    const auditor = auditors[Math.floor(rng() * auditors.length)]!;
    const status = stages[Math.floor(rng() * stages.length)]!;
    const callReason = callReasons.length ? callReasons[Math.floor(rng() * callReasons.length)]! : null;

    const callDate = new Date(2026, 7, 1 + Math.floor(rng() * 55));
    const auditDate = new Date(callDate.getTime() + 864e5);

    // Stamp every stage up to and including the current one.
    const stamps: Record<string, Date> = {};
    let cursor = auditDate.getTime();
    for (const st of ORDER) {
      stamps[STAGE_FIELD[st]!] = new Date(cursor);
      cursor += (2 + rng() * 40) * 36e5;
      if (st === status) break;
    }

    const failing = new Set<number>();
    const failCount = rng() > 0.75 ? 2 : rng() > 0.45 ? 1 : 0;
    while (failing.size < Math.min(failCount, parameters.length)) {
      failing.add(parameters[Math.floor(rng() * parameters.length)]!.sortOrder);
    }

    const results = parameters.map((p) => {
      const answer = failing.has(p.sortOrder) ? AnswerValue.NO : AnswerValue.YES;
      return {
        parameterId: p.id,
        sortOrder: p.sortOrder,
        textSnapshot: p.text,
        weightSnapshot: p.weight,
        criticalType: p.criticalType,
        answer,
        // A failed parameter always carries the observation QA must record.
        observedBehavior: answer === AnswerValue.NO
          ? 'Did not meet the required standard on this call.'
          : null,
        score: answer === AnswerValue.NO ? 0 : p.weight,
      };
    });

    const earned = results.reduce((a, r) => a + Number(r.score), 0);
    const possible = results.reduce((a, r) => a + Number(r.weightSnapshot), 0);

    await prisma.coachingForm.create({
      data: {
        reference: `AWR-${String(1000 + i)}`,
        templateId,
        status,
        agentId: agent.id,
        supervisorId: agent.team?.leadId ?? null,
        auditorId: auditor.id,
        callDate,
        auditDate,
        callId: String(90000000 + i * 7919),
        callReasonId: callReason?.id ?? null,
        ahtSeconds: 180 + Math.floor(rng() * 1200),
        totalHoldSeconds: rng() > 0.5 ? Math.floor(rng() * 400) : 0,
        qaScore: possible > 0 ? earned / possible : 1,
        ...stamps,
        parameterResults: { create: results },
      },
    });
    created++;
  }
  return created;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
