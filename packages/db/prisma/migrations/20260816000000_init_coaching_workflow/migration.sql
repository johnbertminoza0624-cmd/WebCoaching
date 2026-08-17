-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('AGENT', 'OPS_TEAM_LEAD', 'QA', 'QA_TEAM_LEAD', 'OPS_ACCOUNT_MANAGER', 'QA_MANAGER', 'SERVICE_DELIVERY_MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CriticalType" AS ENUM ('CUSTOMER', 'PROCESS', 'BUSINESS', 'COMPLIANCE', 'NON_CRITICAL');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('QA_REVIEW', 'RELEASED_TO_OPS', 'OPS_COACHING', 'RELEASED_TO_AGENT', 'AWAITING_AGENT_SIGNATURE', 'FINALIZED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AnswerValue" AS ENUM ('YES', 'NO', 'NA');

-- CreateEnum
CREATE TYPE "RespondentCategory" AS ENUM ('SAT', 'NEUTRAL', 'DSAT', 'NOT_SURVEYED');

-- CreateEnum
CREATE TYPE "ControllableFlag" AS ENUM ('AGENT_CONTROLLABLE', 'AGENT_NON_CONTROLLABLE');

-- CreateEnum
CREATE TYPE "ImpactType" AS ENUM ('CUSTOMER_IMPACTING', 'PROCESS_DEFECT', 'BUSINESS_IMPACTING', 'COMPLIANCE_IMPACTING', 'NO_IMPACT');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "SignatureSource" AS ENUM ('DRAWN', 'UPLOADED');

-- CreateEnum
CREATE TYPE "SignatoryRole" AS ENUM ('AGENT', 'SUPERVISOR');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wave" TEXT,
    "accountId" TEXT NOT NULL,
    "leadId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "eid" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "accountId" TEXT,
    "teamId" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_changes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromRole" "Role" NOT NULL,
    "toRole" "Role" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispositions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_reasons" (
    "id" TEXT NOT NULL,
    "dispositionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "call_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hold_reasons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "hold_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "root_cause_gaps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "root_cause_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observed_drivers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "observed_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" TEXT NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "accountId" TEXT,
    "lineOfBusiness" TEXT,
    "createdById" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "agentAckText" TEXT NOT NULL,
    "supervisorAckText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_change_log" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "parameterId" TEXT,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_parameters" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "criticalType" "CriticalType" NOT NULL,
    "text" TEXT NOT NULL,
    "weight" DECIMAL(6,4) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "template_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coaching_forms" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "FormStatus" NOT NULL DEFAULT 'QA_REVIEW',
    "agentId" TEXT NOT NULL,
    "supervisorId" TEXT,
    "auditorId" TEXT NOT NULL,
    "callDate" DATE NOT NULL,
    "auditDate" DATE NOT NULL,
    "callId" TEXT NOT NULL,
    "callReasonId" TEXT,
    "ahtSeconds" INTEGER,
    "totalHoldSeconds" INTEGER NOT NULL DEFAULT 0,
    "ivrAuthenticated" "AnswerValue",
    "agentReverified" "AnswerValue",
    "verifiedNonIvr" "AnswerValue",
    "usedServiceCloud" "AnswerValue",
    "wasSurveyed" BOOLEAN NOT NULL DEFAULT false,
    "surveyScore" INTEGER,
    "respondentCategory" "RespondentCategory" NOT NULL DEFAULT 'NOT_SURVEYED',
    "controllable" "ControllableFlag",
    "observedDriverId" TEXT,
    "customerVerbatim" TEXT,
    "qaScore" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "customerCriticalCount" INTEGER NOT NULL DEFAULT 0,
    "processCriticalCount" INTEGER NOT NULL DEFAULT 0,
    "businessCriticalCount" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "qaReviewAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedToOpsAt" TIMESTAMP(3),
    "opsCoachingAt" TIMESTAMP(3),
    "releasedToAgentAt" TIMESTAMP(3),
    "awaitingSignatureAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coaching_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_change_log" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "actorId" TEXT,
    "revision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "afterSignature" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_parameter_results" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "textSnapshot" TEXT NOT NULL,
    "weightSnapshot" DECIMAL(6,4) NOT NULL,
    "criticalType" "CriticalType" NOT NULL,
    "answer" "AnswerValue" NOT NULL DEFAULT 'YES',
    "observedBehavior" TEXT,
    "score" DECIMAL(6,4) NOT NULL DEFAULT 0,

    CONSTRAINT "form_parameter_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hold_attempts" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "holdReasonId" TEXT,
    "reasonValid" "AnswerValue" NOT NULL DEFAULT 'NA',

    CONSTRAINT "hold_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "root_causes" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "parameterResultId" TEXT,
    "syntheticSource" TEXT,
    "situation" TEXT,
    "behavior" TEXT,
    "impact" "ImpactType" NOT NULL,
    "coachingPriority" INTEGER,
    "gapId" TEXT,

    CONSTRAINT "root_causes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_plan_items" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "rootCauseId" TEXT,
    "priority" INTEGER NOT NULL,
    "activity" TEXT,
    "ownerId" TEXT,
    "deadline" DATE,
    "successMeasure" TEXT,
    "goal" TEXT,
    "status" "ActionStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "action_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "SignatureSource" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_signatures" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "signerRole" "SignatoryRole" NOT NULL,
    "signatureId" TEXT,
    "storageKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "formHash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "declined" BOOLEAN NOT NULL DEFAULT false,
    "declineReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "supersededByChangeId" TEXT,

    CONSTRAINT "form_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_exports" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "formHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_name_key" ON "accounts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_code_key" ON "accounts"("code");

-- CreateIndex
CREATE INDEX "teams_leadId_idx" ON "teams"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_accountId_name_key" ON "teams"("accountId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_eid_key" ON "users"("eid");

-- CreateIndex
CREATE INDEX "users_accountId_role_idx" ON "users"("accountId", "role");

-- CreateIndex
CREATE INDEX "users_teamId_idx" ON "users"("teamId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "role_changes_userId_idx" ON "role_changes"("userId");

-- CreateIndex
CREATE INDEX "role_changes_createdAt_idx" ON "role_changes"("createdAt");

-- CreateIndex
CREATE INDEX "activity_log_entityType_entityId_idx" ON "activity_log"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "activity_log_createdAt_idx" ON "activity_log"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "dispositions_name_key" ON "dispositions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "call_reasons_dispositionId_name_key" ON "call_reasons"("dispositionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "hold_reasons_name_key" ON "hold_reasons"("name");

-- CreateIndex
CREATE UNIQUE INDEX "root_cause_gaps_name_key" ON "root_cause_gaps"("name");

-- CreateIndex
CREATE UNIQUE INDEX "observed_drivers_category_name_key" ON "observed_drivers"("category", "name");

-- CreateIndex
CREATE INDEX "form_templates_status_accountId_idx" ON "form_templates"("status", "accountId");

-- CreateIndex
CREATE INDEX "form_templates_slug_idx" ON "form_templates"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "form_templates_slug_version_key" ON "form_templates"("slug", "version");

-- CreateIndex
CREATE INDEX "template_change_log_templateId_createdAt_idx" ON "template_change_log"("templateId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "template_parameters_templateId_sortOrder_key" ON "template_parameters"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "coaching_forms_reference_key" ON "coaching_forms"("reference");

-- CreateIndex
CREATE INDEX "coaching_forms_agentId_callDate_idx" ON "coaching_forms"("agentId", "callDate");

-- CreateIndex
CREATE INDEX "coaching_forms_supervisorId_status_idx" ON "coaching_forms"("supervisorId", "status");

-- CreateIndex
CREATE INDEX "coaching_forms_auditorId_status_idx" ON "coaching_forms"("auditorId", "status");

-- CreateIndex
CREATE INDEX "coaching_forms_agentId_status_idx" ON "coaching_forms"("agentId", "status");

-- CreateIndex
CREATE INDEX "coaching_forms_status_auditDate_idx" ON "coaching_forms"("status", "auditDate");

-- CreateIndex
CREATE INDEX "form_change_log_formId_createdAt_idx" ON "form_change_log"("formId", "createdAt");

-- CreateIndex
CREATE INDEX "form_change_log_actorId_idx" ON "form_change_log"("actorId");

-- CreateIndex
CREATE INDEX "form_parameter_results_parameterId_answer_idx" ON "form_parameter_results"("parameterId", "answer");

-- CreateIndex
CREATE UNIQUE INDEX "form_parameter_results_formId_sortOrder_key" ON "form_parameter_results"("formId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "hold_attempts_formId_attemptNo_key" ON "hold_attempts"("formId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "root_causes_parameterResultId_key" ON "root_causes"("parameterResultId");

-- CreateIndex
CREATE INDEX "root_causes_formId_idx" ON "root_causes"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "root_causes_formId_coachingPriority_key" ON "root_causes"("formId", "coachingPriority");

-- CreateIndex
CREATE UNIQUE INDEX "action_plan_items_rootCauseId_key" ON "action_plan_items"("rootCauseId");

-- CreateIndex
CREATE INDEX "action_plan_items_ownerId_status_idx" ON "action_plan_items"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "action_plan_items_formId_priority_key" ON "action_plan_items"("formId", "priority");

-- CreateIndex
CREATE INDEX "signatures_userId_isActive_idx" ON "signatures"("userId", "isActive");

-- CreateIndex
CREATE INDEX "form_signatures_formId_signerRole_supersededAt_idx" ON "form_signatures"("formId", "signerRole", "supersededAt");

-- CreateIndex
CREATE INDEX "form_signatures_signerId_idx" ON "form_signatures"("signerId");

-- CreateIndex
CREATE UNIQUE INDEX "form_signatures_formId_signerRole_revision_key" ON "form_signatures"("formId", "signerRole", "revision");

-- CreateIndex
CREATE INDEX "pdf_exports_formId_createdAt_idx" ON "pdf_exports"("formId", "createdAt");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_changes" ADD CONSTRAINT "role_changes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_changes" ADD CONSTRAINT "role_changes_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_reasons" ADD CONSTRAINT "call_reasons_dispositionId_fkey" FOREIGN KEY ("dispositionId") REFERENCES "dispositions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_change_log" ADD CONSTRAINT "template_change_log_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_change_log" ADD CONSTRAINT "template_change_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_parameters" ADD CONSTRAINT "template_parameters_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_forms" ADD CONSTRAINT "coaching_forms_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "form_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_forms" ADD CONSTRAINT "coaching_forms_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_forms" ADD CONSTRAINT "coaching_forms_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_forms" ADD CONSTRAINT "coaching_forms_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_forms" ADD CONSTRAINT "coaching_forms_callReasonId_fkey" FOREIGN KEY ("callReasonId") REFERENCES "call_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coaching_forms" ADD CONSTRAINT "coaching_forms_observedDriverId_fkey" FOREIGN KEY ("observedDriverId") REFERENCES "observed_drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_change_log" ADD CONSTRAINT "form_change_log_formId_fkey" FOREIGN KEY ("formId") REFERENCES "coaching_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_change_log" ADD CONSTRAINT "form_change_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_parameter_results" ADD CONSTRAINT "form_parameter_results_formId_fkey" FOREIGN KEY ("formId") REFERENCES "coaching_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_parameter_results" ADD CONSTRAINT "form_parameter_results_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "template_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hold_attempts" ADD CONSTRAINT "hold_attempts_formId_fkey" FOREIGN KEY ("formId") REFERENCES "coaching_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hold_attempts" ADD CONSTRAINT "hold_attempts_holdReasonId_fkey" FOREIGN KEY ("holdReasonId") REFERENCES "hold_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "root_causes" ADD CONSTRAINT "root_causes_formId_fkey" FOREIGN KEY ("formId") REFERENCES "coaching_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "root_causes" ADD CONSTRAINT "root_causes_parameterResultId_fkey" FOREIGN KEY ("parameterResultId") REFERENCES "form_parameter_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "root_causes" ADD CONSTRAINT "root_causes_gapId_fkey" FOREIGN KEY ("gapId") REFERENCES "root_cause_gaps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_items" ADD CONSTRAINT "action_plan_items_formId_fkey" FOREIGN KEY ("formId") REFERENCES "coaching_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_items" ADD CONSTRAINT "action_plan_items_rootCauseId_fkey" FOREIGN KEY ("rootCauseId") REFERENCES "root_causes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_plan_items" ADD CONSTRAINT "action_plan_items_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_formId_fkey" FOREIGN KEY ("formId") REFERENCES "coaching_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_signatures" ADD CONSTRAINT "form_signatures_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "signatures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_exports" ADD CONSTRAINT "pdf_exports_formId_fkey" FOREIGN KEY ("formId") REFERENCES "coaching_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

