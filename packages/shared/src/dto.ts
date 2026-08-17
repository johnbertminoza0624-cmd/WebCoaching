/**
 * Zod contracts shared by the API (request validation) and the web app (form
 * validation). One definition, so a field the client thinks is optional can
 * never be required by the server.
 */
import { z } from 'zod';
import { ROLES } from './rbac.js';

export const answerSchema = z.enum(['YES', 'NO', 'NA']);
export const criticalTypeSchema = z.enum(['CUSTOMER', 'PROCESS', 'BUSINESS']);
export const roleSchema = z.enum(ROLES);

// ------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

// ------------------------------------------------------------------
// Admin — users & roles
// ------------------------------------------------------------------

export const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  eid: z.string().min(1).max(16).optional(),
  role: roleSchema,
  accountId: z.string().cuid().optional(),
  teamId: z.string().cuid().optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial().omit({ role: true });

/** Role changes are their own endpoint — they are audited and need a reason. */
export const changeRoleSchema = z.object({
  role: roleSchema,
  reason: z.string().min(3, 'Give a reason — it is written to the activity log').max(500),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const listUsersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  role: roleSchema.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  accountId: z.string().cuid().optional(),
  teamId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ------------------------------------------------------------------
// Coaching form
// ------------------------------------------------------------------

export const parameterResultSchema = z.object({
  parameterId: z.string().cuid(),
  answer: answerSchema,
  observedBehavior: z.string().max(4000).nullish(),
});

export const holdAttemptSchema = z.object({
  attemptNo: z.number().int().min(1).max(4),
  startAt: z.coerce.date().nullish(),
  endAt: z.coerce.date().nullish(),
  holdReasonId: z.string().cuid().nullish(),
  reasonValid: answerSchema.default('NA'),
});

export const upsertFormSchema = z.object({
  templateId: z.string().cuid(),
  agentId: z.string().cuid(),
  callDate: z.coerce.date(),
  auditDate: z.coerce.date(),
  callId: z.string().min(1).max(120),
  callReasonId: z.string().cuid().nullish(),
  ahtSeconds: z.number().int().min(0).max(86_400).nullish(),

  ivrAuthenticated: answerSchema.nullish(),
  agentReverified: answerSchema.nullish(),
  verifiedNonIvr: answerSchema.nullish(),
  usedServiceCloud: answerSchema.nullish(),

  wasSurveyed: z.boolean().default(false),
  surveyScore: z.number().int().min(1).max(5).nullish(),
  controllable: z.enum(['AGENT_CONTROLLABLE', 'AGENT_NON_CONTROLLABLE']).nullish(),
  observedDriverId: z.string().cuid().nullish(),
  customerVerbatim: z.string().max(4000).nullish(),

  parameters: z.array(parameterResultSchema).min(1),
  holdAttempts: z.array(holdAttemptSchema).max(4).default([]),
})
  .refine((v) => !v.wasSurveyed || v.surveyScore != null, {
    message: 'Enter the survey score, or mark the call as not surveyed',
    path: ['surveyScore'],
  })
  // The workbook lets a survey score exist with "Surveyed? = No"; that produced
  // rows scored as DSAT that the CSAT report then ignored. Reject it here.
  .refine((v) => v.wasSurveyed || v.surveyScore == null, {
    message: 'Remove the survey score, or mark the call as surveyed',
    path: ['surveyScore'],
  });
export type UpsertFormInput = z.infer<typeof upsertFormSchema>;

/** Section C — the coach assigns priority and gap to auto-generated rows. */
export const updateRootCauseSchema = z.object({
  coachingPriority: z.number().int().min(1).max(4).nullish(),
  gapId: z.string().cuid().nullish(),
});

/** Section D */
export const actionPlanItemSchema = z.object({
  priority: z.number().int().min(1).max(4),
  activity: z.string().max(2000).nullish(),
  ownerId: z.string().cuid().nullish(),
  deadline: z.coerce.date().nullish(),
  successMeasure: z.string().max(2000).nullish(),
  goal: z.string().max(2000).nullish(),
});

// ------------------------------------------------------------------
// Signatures
// ------------------------------------------------------------------

export const saveSignatureSchema = z.object({
  source: z.enum(['DRAWN', 'UPLOADED']),
  /** base64 PNG, max ~1.5MB decoded — the API re-encodes and strips metadata. */
  dataUrl: z.string().regex(/^data:image\/png;base64,/, 'Expected a PNG data URL'),
  width: z.number().int().min(40).max(4000),
  height: z.number().int().min(20).max(2000),
});

export const applySignatureSchema = z.object({
  signatureId: z.string().cuid().optional(),
  dataUrl: z.string().regex(/^data:image\/png;base64,/).optional(),
}).refine((v) => !!(v.signatureId || v.dataUrl), {
  message: 'Provide a saved signature or a new one',
});

export const declineSignatureSchema = z.object({
  reason: z.string().min(5, 'Explain why you are declining').max(2000),
});

// ------------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------------

export const dashboardQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  accountId: z.string().cuid().optional(),
  teamId: z.string().cuid().optional(),
  agentId: z.string().cuid().optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
