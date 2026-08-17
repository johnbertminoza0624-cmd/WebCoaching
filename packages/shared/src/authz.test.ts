import { describe, expect, it } from 'vitest';
import {
  canAccessPage, canWorkStage, canAdvanceFrom, canSeeRecord, sectionAccess, visibleSections,
  auditAction, canEditObservation, observationRequired, canSeeComparativeAggregates,
  COACHING_SECTIONS, type CoachingSection,
} from './authz.js';
import { WORKFLOW_STAGES, type FormStage } from './workflow.js';
import { ROLES, type Role } from './rbac.js';

const ALL_STAGES: FormStage[] = [...WORKFLOW_STAGES, 'VOIDED'];

describe('page access', () => {
  it('lets every role reach both dashboards and their own signature page', () => {
    for (const role of ROLES) {
      expect(canAccessPage(role, 'performance-dashboard')).toBe(true);
      expect(canAccessPage(role, 'coaching-dashboard')).toBe(true);
      expect(canAccessPage(role, 'signature')).toBe(true);
    }
  });

  it('keeps Admin out of the coaching conversation', () => {
    expect(canAccessPage('ADMIN', 'coaching')).toBe(false);
  });

  it('restricts upload to Admin and the QA line', () => {
    expect(canAccessPage('QA', 'audits-upload')).toBe(true);
    expect(canAccessPage('QA_TEAM_LEAD', 'audits-upload')).toBe(true);
    expect(canAccessPage('OPS_TEAM_LEAD', 'audits-upload')).toBe(false);
    expect(canAccessPage('AGENT', 'audits-upload')).toBe(false);
  });

  it('restricts administration and the repository to Admin and QA Manager', () => {
    for (const page of ['users-roles', 'repository'] as const) {
      expect(canAccessPage('ADMIN', page)).toBe(true);
      expect(canAccessPage('QA_MANAGER', page)).toBe(true);
      expect(canAccessPage('QA_TEAM_LEAD', page)).toBe(false);
      expect(canAccessPage('OPS_TEAM_LEAD', page)).toBe(false);
      expect(canAccessPage('AGENT', page)).toBe(false);
    }
  });
});

describe('stage ownership', () => {
  it('gives each stage exactly one owning side', () => {
    expect(canWorkStage('QA', 'QA_REVIEW')).toBe(true);
    expect(canWorkStage('OPS_TEAM_LEAD', 'QA_REVIEW')).toBe(false);
    expect(canWorkStage('AGENT', 'QA_REVIEW')).toBe(false);

    expect(canWorkStage('OPS_TEAM_LEAD', 'RELEASED_TO_OPS')).toBe(true);
    expect(canWorkStage('QA', 'RELEASED_TO_OPS')).toBe(false);
    expect(canWorkStage('AGENT', 'OPS_COACHING')).toBe(false);

    expect(canWorkStage('AGENT', 'AWAITING_AGENT_SIGNATURE')).toBe(true);
    expect(canWorkStage('OPS_TEAM_LEAD', 'AWAITING_AGENT_SIGNATURE')).toBe(false);
  });

  it('never lets monitoring or admin roles work a stage', () => {
    for (const role of ['OPS_ACCOUNT_MANAGER', 'ADMIN', 'SERVICE_DELIVERY_MANAGER'] as Role[]) {
      for (const stage of ALL_STAGES) {
        expect(canWorkStage(role, stage)).toBe(false);
        expect(canAdvanceFrom(role, stage)).toBe(false);
      }
    }
  });

  it('makes finalized and voided records unadvanceable by anyone', () => {
    for (const role of ROLES) {
      expect(canAdvanceFrom(role, 'FINALIZED')).toBe(false);
      expect(canAdvanceFrom(role, 'VOIDED')).toBe(false);
    }
  });
});

describe('record visibility', () => {
  it('hides a record from the Ops TL until QA releases it', () => {
    expect(canSeeRecord('OPS_TEAM_LEAD', 'QA_REVIEW')).toBe(false);
    expect(canSeeRecord('OPS_TEAM_LEAD', 'RELEASED_TO_OPS')).toBe(true);
    expect(canSeeRecord('OPS_TEAM_LEAD', 'OPS_COACHING')).toBe(true);
    // still visible after they hand it on — they need to follow it through
    expect(canSeeRecord('OPS_TEAM_LEAD', 'RELEASED_TO_AGENT')).toBe(true);
    expect(canSeeRecord('OPS_TEAM_LEAD', 'FINALIZED')).toBe(true);
  });

  it('hides a record from the agent until their team lead releases it', () => {
    for (const stage of ['QA_REVIEW', 'RELEASED_TO_OPS', 'OPS_COACHING'] as FormStage[]) {
      expect(canSeeRecord('AGENT', stage)).toBe(false);
    }
    expect(canSeeRecord('AGENT', 'RELEASED_TO_AGENT')).toBe(true);
    expect(canSeeRecord('AGENT', 'AWAITING_AGENT_SIGNATURE')).toBe(true);
    expect(canSeeRecord('AGENT', 'FINALIZED')).toBe(true);
  });

  it('shows the QA line every stage from creation', () => {
    for (const role of ['QA', 'QA_TEAM_LEAD', 'QA_MANAGER'] as Role[]) {
      for (const stage of ALL_STAGES) expect(canSeeRecord(role, stage)).toBe(true);
    }
  });

  it('shows oversight roles the whole pipeline', () => {
    for (const role of ['OPS_ACCOUNT_MANAGER', 'SERVICE_DELIVERY_MANAGER', 'ADMIN'] as Role[]) {
      for (const stage of ALL_STAGES) expect(canSeeRecord(role, stage)).toBe(true);
    }
  });

  it('keeps voided records away from downstream roles', () => {
    expect(canSeeRecord('OPS_TEAM_LEAD', 'VOIDED')).toBe(false);
    expect(canSeeRecord('AGENT', 'VOIDED')).toBe(false);
    expect(canSeeRecord('QA', 'VOIDED')).toBe(true);
    expect(canSeeRecord('ADMIN', 'VOIDED')).toBe(true);
  });
});

describe('section access', () => {
  it('hides every post-hold section from QA during review', () => {
    const visible = visibleSections('QA', 'QA_REVIEW');
    expect(visible).toEqual(['AUDIT_INFO', 'PARAMETERS', 'HOLD_ATTEMPTS']);
    for (const s of ['SECTION_C', 'SECTION_D', 'OPS_SIGNATURE', 'AGENT_SIGNATURE'] as CoachingSection[]) {
      expect(sectionAccess('QA', 'QA_REVIEW', s)).toBe('HIDDEN');
    }
  });

  it('never lets anyone edit imported audit data', () => {
    for (const role of ROLES) {
      for (const stage of ALL_STAGES) {
        expect(sectionAccess(role, stage, 'AUDIT_INFO')).not.toBe('EDIT');
      }
    }
  });

  it('lets QA edit observations and holds only during QA review', () => {
    expect(sectionAccess('QA', 'QA_REVIEW', 'PARAMETERS')).toBe('EDIT');
    expect(sectionAccess('QA', 'QA_REVIEW', 'HOLD_ATTEMPTS')).toBe('EDIT');
    // once released, QA-owned content is frozen
    expect(sectionAccess('QA', 'RELEASED_TO_OPS', 'PARAMETERS')).toBe('READ');
    expect(sectionAccess('QA', 'OPS_COACHING', 'HOLD_ATTEMPTS')).toBe('READ');
  });

  it('stops the Ops TL modifying QA-owned content', () => {
    for (const stage of ['RELEASED_TO_OPS', 'OPS_COACHING'] as FormStage[]) {
      expect(sectionAccess('OPS_TEAM_LEAD', stage, 'PARAMETERS')).toBe('READ');
      expect(sectionAccess('OPS_TEAM_LEAD', stage, 'HOLD_ATTEMPTS')).toBe('READ');
      expect(sectionAccess('OPS_TEAM_LEAD', stage, 'SECTION_C')).toBe('EDIT');
      expect(sectionAccess('OPS_TEAM_LEAD', stage, 'SECTION_D')).toBe('EDIT');
      expect(sectionAccess('OPS_TEAM_LEAD', stage, 'OPS_SIGNATURE')).toBe('EDIT');
    }
  });

  it('never lets the Ops TL sign for the agent', () => {
    for (const stage of ALL_STAGES) {
      expect(sectionAccess('OPS_TEAM_LEAD', stage, 'AGENT_SIGNATURE')).not.toBe('EDIT');
    }
  });

  it('lets the agent edit only their own signature', () => {
    for (const stage of ['RELEASED_TO_AGENT', 'AWAITING_AGENT_SIGNATURE'] as FormStage[]) {
      expect(sectionAccess('AGENT', stage, 'AGENT_SIGNATURE')).toBe('EDIT');
      for (const s of ['PARAMETERS', 'HOLD_ATTEMPTS', 'SECTION_C', 'SECTION_D', 'OPS_SIGNATURE'] as CoachingSection[]) {
        expect(sectionAccess('AGENT', stage, s)).toBe('READ');
      }
    }
  });

  it('makes a finalized coaching fully read-only for everyone', () => {
    for (const role of ROLES) {
      for (const s of COACHING_SECTIONS) {
        expect(sectionAccess(role, 'FINALIZED', s)).toBe('READ');
      }
    }
  });

  it('never lets the Ops Account Manager edit anything', () => {
    for (const stage of ALL_STAGES) {
      for (const s of COACHING_SECTIONS) {
        expect(sectionAccess('OPS_ACCOUNT_MANAGER', stage, s)).not.toBe('EDIT');
      }
    }
  });
});

describe('observations', () => {
  it('requires an observation only for a NO score', () => {
    expect(observationRequired('NO')).toBe(true);
    expect(observationRequired('YES')).toBe(false);
    expect(observationRequired('NA')).toBe(false);
  });

  it('allows editing observations only at the QA stage', () => {
    expect(canEditObservation('QA', 'QA_REVIEW')).toBe(true);
    expect(canEditObservation('QA_TEAM_LEAD', 'QA_REVIEW')).toBe(true);
    expect(canEditObservation('OPS_TEAM_LEAD', 'QA_REVIEW')).toBe(false);
    expect(canEditObservation('QA', 'OPS_COACHING')).toBe(false);
  });
});

describe('row actions', () => {
  it('does not surface pre-release records to Ops TL or Agent', () => {
    expect(auditAction('OPS_TEAM_LEAD', 'QA_REVIEW')).toBe('QUICK_VIEW');
    expect(auditAction('AGENT', 'QA_REVIEW')).toBe('NONE');
    expect(auditAction('AGENT', 'RELEASED_TO_OPS')).toBe('NONE');
    expect(auditAction('AGENT', 'OPS_COACHING')).toBe('NONE');
  });

  it('offers Coach to the Ops TL once QA releases', () => {
    expect(auditAction('OPS_TEAM_LEAD', 'RELEASED_TO_OPS')).toBe('COACH');
    expect(auditAction('OPS_TEAM_LEAD', 'OPS_COACHING')).toBe('COACH');
    expect(auditAction('QA', 'RELEASED_TO_OPS')).toBe('QUICK_VIEW');
  });

  it('offers Sign to the agent once the Ops TL releases', () => {
    expect(auditAction('AGENT', 'RELEASED_TO_AGENT')).toBe('SIGN');
    expect(auditAction('AGENT', 'AWAITING_AGENT_SIGNATURE')).toBe('SIGN');
    expect(auditAction('OPS_TEAM_LEAD', 'RELEASED_TO_AGENT')).toBe('QUICK_VIEW');
  });

  it('collapses to Quick View for everyone once finalized', () => {
    for (const role of ROLES) {
      expect(auditAction(role, 'FINALIZED')).toBe('QUICK_VIEW');
    }
  });
});

describe('aggregate leakage', () => {
  it('withholds comparative aggregates from an agent', () => {
    expect(canSeeComparativeAggregates('AGENT')).toBe(false);
    expect(canSeeComparativeAggregates('OPS_TEAM_LEAD')).toBe(true);
  });
});
