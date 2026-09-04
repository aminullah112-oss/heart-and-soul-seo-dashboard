-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "Pillar" AS ENUM ('BUSINESS_CASE_STUDY', 'AI_BUSINESS', 'AI_AUTOMATION_SAAS', 'BUSINESS_FAILURE', 'FUTURE_OF_BUSINESS');

-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('DISCOVERED', 'SCORED', 'REJECTED_BY_SCORE', 'REJECTED_BY_DUPLICATE', 'REJECTED_BY_HUMAN', 'APPROVED', 'IN_PRODUCTION', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EntityKind" AS ENUM ('COMPANY', 'PERSON', 'PRODUCT', 'INDUSTRY', 'TECHNOLOGY', 'BUSINESS_MODEL', 'MARKET');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('RESEARCH', 'STORY', 'SCRIPT', 'FACT_CHECK', 'VISUALS', 'VOICE', 'RENDER', 'PACKAGING', 'QC', 'APPROVAL', 'SCHEDULED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'FAILED', 'ON_HOLD', 'ABANDONED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SourceTier" AS ENUM ('PRIMARY_COMPANY', 'REGULATORY_FILING', 'GOVERNMENT', 'FINANCIAL_REPORT', 'ACADEMIC', 'REPUTABLE_JOURNALISM', 'INDUSTRY_RESEARCH', 'SPECIALIST_PUBLICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'DISPUTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClaimConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ClaimKind" AS ENUM ('FINANCIAL', 'HISTORICAL', 'QUANTITATIVE', 'CAUSAL', 'QUOTE', 'DESCRIPTIVE');

-- CreateEnum
CREATE TYPE "VisualKind" AS ENUM ('STOCK_VIDEO', 'STOCK_IMAGE', 'GENERATED_IMAGE', 'CHART', 'SCREENSHOT', 'TEXT_CARD', 'MAP', 'ARCHIVAL', 'B_ROLL');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('STOCK_VIDEO', 'STOCK_IMAGE', 'GENERATED_IMAGE', 'CHART_PNG', 'AUDIO_VOICE', 'AUDIO_MUSIC', 'THUMBNAIL', 'RENDER_OUTPUT', 'SUBTITLE', 'OTHER');

-- CreateEnum
CREATE TYPE "CopyrightRisk" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RenderFormat" AS ENUM ('LONG_FORM_16_9', 'SHORT_9_16');

-- CreateEnum
CREATE TYPE "MisleadingRisk" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CheckVerdict" AS ENUM ('PASS', 'WARNING', 'FAIL');

-- CreateEnum
CREATE TYPE "DuplicateVerdict" AS ENUM ('RELATED', 'CANNIBALIZES', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REVISION_REQUESTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PublishVisibility" AS ENUM ('PRIVATE', 'UNLISTED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('PENDING_APPROVAL', 'SCHEDULED', 'UPLOADING', 'UPLOADED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AbTestKind" AS ENUM ('THUMBNAIL', 'TITLE');

-- CreateEnum
CREATE TYPE "AbTestStatus" AS ENUM ('RUNNING', 'CONCLUSIVE', 'INCONCLUSIVE', 'STOPPED');

-- CreateEnum
CREATE TYPE "SponsorStatus" AS ENUM ('IDENTIFIED', 'RESEARCHING', 'CONTACTED', 'IN_CONVERSATION', 'NEGOTIATING', 'WON', 'LOST', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('LLM', 'SEARCH', 'TTS', 'IMAGE', 'STOCK', 'RENDER', 'STORAGE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'EDITOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "positioning" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Business / Technology',
    "language" TEXT NOT NULL DEFAULT 'English',
    "primaryAudience" TEXT NOT NULL,
    "youtubeChannelId" TEXT,
    "videoLengthMinMinutes" INTEGER NOT NULL DEFAULT 8,
    "videoLengthMaxMinutes" INTEGER NOT NULL DEFAULT 15,
    "publishPerWeek" INTEGER NOT NULL DEFAULT 2,
    "shortsPerVideo" INTEGER NOT NULL DEFAULT 2,
    "minimumTopicScore" INTEGER NOT NULL DEFAULT 75,
    "minimumQcScore" INTEGER NOT NULL DEFAULT 85,
    "automaticPublish" BOOLEAN NOT NULL DEFAULT false,
    "humanApproval" BOOLEAN NOT NULL DEFAULT true,
    "scoringWeights" JSONB NOT NULL,
    "styleGuide" JSONB,
    "onboardingCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "pillar" "Pillar" NOT NULL,
    "status" "TopicStatus" NOT NULL DEFAULT 'DISCOVERED',
    "rationale" TEXT,
    "discoverySignal" TEXT,
    "discoveredVia" TEXT NOT NULL DEFAULT 'trend-hunter',
    "latestScore" DOUBLE PRECISION,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicScore" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "viralPotential" DOUBLE PRECISION NOT NULL,
    "searchDemand" DOUBLE PRECISION NOT NULL,
    "advertiserValue" DOUBLE PRECISION NOT NULL,
    "evergreenValue" DOUBLE PRECISION NOT NULL,
    "storyPotential" DOUBLE PRECISION NOT NULL,
    "timeliness" DOUBLE PRECISION NOT NULL,
    "competition" DOUBLE PRECISION NOT NULL,
    "researchAvailability" DOUBLE PRECISION NOT NULL,
    "visualPotential" DOUBLE PRECISION NOT NULL,
    "affiliatePotential" DOUBLE PRECISION NOT NULL,
    "sponsorshipPotential" DOUBLE PRECISION NOT NULL,
    "channelRelevance" DOUBLE PRECISION NOT NULL,
    "overall" DOUBLE PRECISION NOT NULL,
    "monetizationPotential" DOUBLE PRECISION NOT NULL,
    "weightsUsed" JSONB NOT NULL,
    "contributions" JSONB NOT NULL,
    "reasoning" TEXT NOT NULL,
    "gatesPassed" BOOLEAN NOT NULL DEFAULT false,
    "gateFailureReasons" TEXT[],
    "scoredByModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" "EntityKind" NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "summary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRelationship" (
    "id" TEXT NOT NULL,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidenceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityLink" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "topicId" TEXT,
    "videoProjectId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MENTIONED',

    CONSTRAINT "EntityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoProject" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL DEFAULT 'RESEARCH',
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "targetMinutes" INTEGER NOT NULL DEFAULT 11,
    "blockedReason" TEXT,
    "selectedTitleId" TEXT,
    "selectedThumbnailId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "searchQueries" TEXT[],
    "summary" TEXT,
    "coverageScore" DOUBLE PRECISION,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "researchProjectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "tier" "SourceTier" NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excerpt" TEXT NOT NULL,
    "reliability" DOUBLE PRECISION NOT NULL,
    "unavailableReason" TEXT,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "researchProjectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" "ClaimKind" NOT NULL,
    "confidence" "ClaimConfidence" NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "asOf" TIMESTAMP(3),
    "notes" TEXT,
    "usedInScript" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimSource" (
    "claimId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "support" TEXT NOT NULL DEFAULT 'DIRECT',

    CONSTRAINT "ClaimSource_pkey" PRIMARY KEY ("claimId","sourceId")
);

-- CreateTable
CREATE TABLE "StoryBrief" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "centralQuestion" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "targetViewer" TEXT NOT NULL,
    "whyCare" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "conflict" TEXT NOT NULL,
    "stakes" TEXT NOT NULL,
    "narrativeArc" JSONB NOT NULL,
    "keyRevelations" TEXT[],
    "ending" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "workingTitle" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "estimatedSeconds" DOUBLE PRECISION NOT NULL,
    "retentionScore" DOUBLE PRECISION,
    "retentionAnalysis" JSONB,
    "qualityScore" DOUBLE PRECISION,
    "originalityScore" DOUBLE PRECISION,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "revisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Storyboard" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "scriptVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Storyboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "narration" TEXT NOT NULL,
    "visualKind" "VisualKind" NOT NULL,
    "visualQuery" TEXT NOT NULL,
    "onScreenText" TEXT,
    "chartSpec" JSONB,
    "estimatedSeconds" DOUBLE PRECISION NOT NULL,
    "actualSeconds" DOUBLE PRECISION,
    "startSeconds" DOUBLE PRECISION,
    "assetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT,
    "kind" "AssetKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "licence" TEXT,
    "licenceUrl" TEXT,
    "attributionRequired" BOOLEAN NOT NULL DEFAULT false,
    "attributionText" TEXT,
    "copyrightRisk" "CopyrightRisk" NOT NULL DEFAULT 'UNKNOWN',
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PronunciationEntry" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "written" TEXT NOT NULL,
    "spoken" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PronunciationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicTrack" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mood" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "licenceUrl" TEXT,
    "attribution" TEXT,
    "bpm" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voiceover" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "durationSeconds" DOUBLE PRECISION NOT NULL,
    "characters" INTEGER NOT NULL,
    "spokenText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voiceover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoRender" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "format" "RenderFormat" NOT NULL DEFAULT 'LONG_FORM_16_9',
    "status" "RenderStatus" NOT NULL DEFAULT 'QUEUED',
    "resolution" TEXT NOT NULL,
    "fps" INTEGER NOT NULL,
    "storageKey" TEXT,
    "subtitleSrtKey" TEXT,
    "subtitleVttKey" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "bytes" INTEGER,
    "ffmpegCommand" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoRender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TitleVariant" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "curiosity" DOUBLE PRECISION NOT NULL,
    "clarity" DOUBLE PRECISION NOT NULL,
    "searchIntent" DOUBLE PRECISION NOT NULL,
    "emotionalImpact" DOUBLE PRECISION NOT NULL,
    "uniqueness" DOUBLE PRECISION NOT NULL,
    "credibility" DOUBLE PRECISION NOT NULL,
    "rubricScore" DOUBLE PRECISION NOT NULL,
    "overclaims" BOOLEAN NOT NULL DEFAULT false,
    "rationale" TEXT NOT NULL,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TitleVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Thumbnail" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "visualDirection" TEXT NOT NULL,
    "emotionalHook" TEXT NOT NULL,
    "rubricScore" DOUBLE PRECISION NOT NULL,
    "mobileLegible" BOOLEAN NOT NULL DEFAULT true,
    "misleadingRisk" "MisleadingRisk" NOT NULL DEFAULT 'NONE',
    "storageKey" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Thumbnail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoDescription" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "chapters" JSONB NOT NULL,
    "tags" TEXT[],
    "references" JSONB NOT NULL,
    "disclosure" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoDescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortClip" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "renderId" TEXT,
    "hook" TEXT NOT NULL,
    "narration" TEXT NOT NULL,
    "sourceSectionId" TEXT NOT NULL,
    "startSeconds" DOUBLE PRECISION NOT NULL,
    "endSeconds" DOUBLE PRECISION NOT NULL,
    "onScreenText" TEXT[],
    "ctaToLongForm" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactCheckReport" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "scriptVersion" INTEGER NOT NULL,
    "verdict" "CheckVerdict" NOT NULL,
    "findings" JSONB NOT NULL,
    "highRiskCount" INTEGER NOT NULL DEFAULT 0,
    "mediumRiskCount" INTEGER NOT NULL DEFAULT 0,
    "lowRiskCount" INTEGER NOT NULL DEFAULT 0,
    "unsupportedAssertions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactCheckReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcReport" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "scriptVersion" INTEGER NOT NULL,
    "factCheck" "CheckVerdict" NOT NULL,
    "copyright" "CheckVerdict" NOT NULL,
    "policy" "CheckVerdict" NOT NULL,
    "aiDisclosure" "CheckVerdict" NOT NULL,
    "scriptQuality" DOUBLE PRECISION NOT NULL,
    "retention" DOUBLE PRECISION NOT NULL,
    "visualQuality" DOUBLE PRECISION NOT NULL,
    "monetizationSafety" DOUBLE PRECISION NOT NULL,
    "originality" DOUBLE PRECISION NOT NULL,
    "finalScore" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "blockingReasons" TEXT[],
    "warnings" TEXT[],
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QcReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateFlag" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "againstProjectId" TEXT,
    "againstTitle" TEXT NOT NULL,
    "verdict" "DuplicateVerdict" NOT NULL,
    "topicalScore" DOUBLE PRECISION NOT NULL,
    "phrasalScore" DOUBLE PRECISION NOT NULL,
    "combinedScore" DOUBLE PRECISION NOT NULL,
    "sharedEntities" TEXT[],
    "reason" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalEvent" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "userId" TEXT,
    "stage" "PipelineStage" NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishingJob" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "renderId" TEXT,
    "visibility" "PublishVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "PublishStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "scheduledFor" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeVideo" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tags" TEXT[],
    "categoryId" TEXT NOT NULL,
    "visibility" "PublishVisibility" NOT NULL,
    "playlistId" TEXT,
    "thumbnailSet" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "daysSincePublish" INTEGER NOT NULL,
    "impressions" INTEGER,
    "ctr" DOUBLE PRECISION,
    "views" INTEGER,
    "averageViewDurationSeconds" DOUBLE PRECISION,
    "averageViewPercentage" DOUBLE PRECISION,
    "watchTimeMinutes" DOUBLE PRECISION,
    "subscribersGained" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "returningViewers" INTEGER,
    "estimatedRevenueUsd" DOUBLE PRECISION,
    "rpmUsd" DOUBLE PRECISION,
    "trafficSources" JSONB,
    "retentionCurve" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReport" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "findings" JSONB NOT NULL,
    "provisional" JSONB NOT NULL,
    "videosAnalysed" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbTest" (
    "id" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "kind" "AbTestKind" NOT NULL,
    "status" "AbTestStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "winnerVariantId" TEXT,
    "conclusion" TEXT,

    CONSTRAINT "AbTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbVariant" (
    "id" TEXT NOT NULL,
    "abTestId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "storageKey" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "watchTimeMinutes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),

    CONSTRAINT "AbVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sponsor" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "website" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "status" "SponsorStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "fitScore" DOUBLE PRECISION,
    "fitRationale" TEXT,
    "estimatedValueUsd" DOUBLE PRECISION,
    "lastContactAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostRecord" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT,
    "category" "CostCategory" NOT NULL,
    "provider" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "usd" DECIMAL(12,6) NOT NULL,
    "units" DOUBLE PRECISION NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "model" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationJob" (
    "id" TEXT NOT NULL,
    "videoProjectId" TEXT,
    "queue" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "bullJobId" TEXT,
    "stage" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "errorKind" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "jobId" TEXT,
    "videoProjectId" TEXT,
    "stage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Topic_channelId_status_idx" ON "Topic"("channelId", "status");

-- CreateIndex
CREATE INDEX "Topic_channelId_latestScore_idx" ON "Topic"("channelId", "latestScore" DESC);

-- CreateIndex
CREATE INDEX "Topic_pillar_idx" ON "Topic"("pillar");

-- CreateIndex
CREATE INDEX "TopicScore_topicId_createdAt_idx" ON "TopicScore"("topicId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Entity_channelId_kind_idx" ON "Entity"("channelId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Entity_channelId_key_key" ON "Entity"("channelId", "key");

-- CreateIndex
CREATE INDEX "ContentRelationship_toEntityId_idx" ON "ContentRelationship"("toEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRelationship_fromEntityId_toEntityId_relation_key" ON "ContentRelationship"("fromEntityId", "toEntityId", "relation");

-- CreateIndex
CREATE INDEX "EntityLink_videoProjectId_idx" ON "EntityLink"("videoProjectId");

-- CreateIndex
CREATE INDEX "EntityLink_topicId_idx" ON "EntityLink"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityLink_entityId_topicId_videoProjectId_key" ON "EntityLink"("entityId", "topicId", "videoProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoProject_topicId_key" ON "VideoProject"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoProject_slug_key" ON "VideoProject"("slug");

-- CreateIndex
CREATE INDEX "VideoProject_channelId_stage_idx" ON "VideoProject"("channelId", "stage");

-- CreateIndex
CREATE INDEX "VideoProject_status_idx" ON "VideoProject"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProject_videoProjectId_key" ON "ResearchProject"("videoProjectId");

-- CreateIndex
CREATE INDEX "Source_tier_idx" ON "Source"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "Source_researchProjectId_url_key" ON "Source"("researchProjectId", "url");

-- CreateIndex
CREATE INDEX "Claim_status_confidence_idx" ON "Claim"("status", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_researchProjectId_key_key" ON "Claim"("researchProjectId", "key");

-- CreateIndex
CREATE INDEX "ClaimSource_sourceId_idx" ON "ClaimSource"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryBrief_videoProjectId_key" ON "StoryBrief"("videoProjectId");

-- CreateIndex
CREATE INDEX "Script_videoProjectId_isCurrent_idx" ON "Script"("videoProjectId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "Script_videoProjectId_version_key" ON "Script"("videoProjectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Storyboard_videoProjectId_key" ON "Storyboard"("videoProjectId");

-- CreateIndex
CREATE INDEX "Scene_videoProjectId_idx" ON "Scene"("videoProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_storyboardId_index_key" ON "Scene"("storyboardId", "index");

-- CreateIndex
CREATE INDEX "Asset_videoProjectId_kind_idx" ON "Asset"("videoProjectId", "kind");

-- CreateIndex
CREATE INDEX "Asset_copyrightRisk_idx" ON "Asset"("copyrightRisk");

-- CreateIndex
CREATE UNIQUE INDEX "PronunciationEntry_channelId_written_key" ON "PronunciationEntry"("channelId", "written");

-- CreateIndex
CREATE INDEX "MusicTrack_channelId_mood_idx" ON "MusicTrack"("channelId", "mood");

-- CreateIndex
CREATE UNIQUE INDEX "Voiceover_sceneId_key" ON "Voiceover"("sceneId");

-- CreateIndex
CREATE INDEX "Voiceover_videoProjectId_idx" ON "Voiceover"("videoProjectId");

-- CreateIndex
CREATE INDEX "VideoRender_videoProjectId_status_idx" ON "VideoRender"("videoProjectId", "status");

-- CreateIndex
CREATE INDEX "TitleVariant_videoProjectId_rubricScore_idx" ON "TitleVariant"("videoProjectId", "rubricScore" DESC);

-- CreateIndex
CREATE INDEX "Thumbnail_videoProjectId_rubricScore_idx" ON "Thumbnail"("videoProjectId", "rubricScore" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "VideoDescription_videoProjectId_key" ON "VideoDescription"("videoProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ShortClip_renderId_key" ON "ShortClip"("renderId");

-- CreateIndex
CREATE INDEX "ShortClip_videoProjectId_idx" ON "ShortClip"("videoProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "FactCheckReport_videoProjectId_key" ON "FactCheckReport"("videoProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "QcReport_videoProjectId_key" ON "QcReport"("videoProjectId");

-- CreateIndex
CREATE INDEX "DuplicateFlag_videoProjectId_verdict_idx" ON "DuplicateFlag"("videoProjectId", "verdict");

-- CreateIndex
CREATE INDEX "ApprovalEvent_videoProjectId_createdAt_idx" ON "ApprovalEvent"("videoProjectId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "PublishingJob_status_scheduledFor_idx" ON "PublishingJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "PublishingJob_videoProjectId_idx" ON "PublishingJob"("videoProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeVideo_videoProjectId_key" ON "YouTubeVideo"("videoProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeVideo_youtubeId_key" ON "YouTubeVideo"("youtubeId");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_asOf_idx" ON "AnalyticsSnapshot"("asOf");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSnapshot_youtubeVideoId_asOf_key" ON "AnalyticsSnapshot"("youtubeVideoId", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "PerformanceReport_channelId_periodStart_periodEnd_key" ON "PerformanceReport"("channelId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "AbTest_youtubeVideoId_kind_idx" ON "AbTest"("youtubeVideoId", "kind");

-- CreateIndex
CREATE INDEX "AbVariant_abTestId_idx" ON "AbVariant"("abTestId");

-- CreateIndex
CREATE INDEX "Sponsor_channelId_status_idx" ON "Sponsor"("channelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Sponsor_channelId_company_key" ON "Sponsor"("channelId", "company");

-- CreateIndex
CREATE INDEX "CostRecord_videoProjectId_idx" ON "CostRecord"("videoProjectId");

-- CreateIndex
CREATE INDEX "CostRecord_category_createdAt_idx" ON "CostRecord"("category", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationJob_status_queue_idx" ON "AutomationJob"("status", "queue");

-- CreateIndex
CREATE INDEX "AutomationJob_videoProjectId_stage_idx" ON "AutomationJob"("videoProjectId", "stage");

-- CreateIndex
CREATE INDEX "AutomationJob_createdAt_idx" ON "AutomationJob"("createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_level_createdAt_idx" ON "SystemLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_videoProjectId_idx" ON "SystemLog"("videoProjectId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicScore" ADD CONSTRAINT "TopicScore_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRelationship" ADD CONSTRAINT "ContentRelationship_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRelationship" ADD CONSTRAINT "ContentRelationship_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityLink" ADD CONSTRAINT "EntityLink_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProject" ADD CONSTRAINT "VideoProject_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchProject" ADD CONSTRAINT "ResearchProject_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_researchProjectId_fkey" FOREIGN KEY ("researchProjectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_researchProjectId_fkey" FOREIGN KEY ("researchProjectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSource" ADD CONSTRAINT "ClaimSource_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimSource" ADD CONSTRAINT "ClaimSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryBrief" ADD CONSTRAINT "StoryBrief_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Storyboard" ADD CONSTRAINT "Storyboard_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_storyboardId_fkey" FOREIGN KEY ("storyboardId") REFERENCES "Storyboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationEntry" ADD CONSTRAINT "PronunciationEntry_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicTrack" ADD CONSTRAINT "MusicTrack_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voiceover" ADD CONSTRAINT "Voiceover_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voiceover" ADD CONSTRAINT "Voiceover_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoRender" ADD CONSTRAINT "VideoRender_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TitleVariant" ADD CONSTRAINT "TitleVariant_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thumbnail" ADD CONSTRAINT "Thumbnail_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoDescription" ADD CONSTRAINT "VideoDescription_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortClip" ADD CONSTRAINT "ShortClip_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortClip" ADD CONSTRAINT "ShortClip_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "VideoRender"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactCheckReport" ADD CONSTRAINT "FactCheckReport_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcReport" ADD CONSTRAINT "QcReport_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateFlag" ADD CONSTRAINT "DuplicateFlag_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateFlag" ADD CONSTRAINT "DuplicateFlag_againstProjectId_fkey" FOREIGN KEY ("againstProjectId") REFERENCES "VideoProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalEvent" ADD CONSTRAINT "ApprovalEvent_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalEvent" ADD CONSTRAINT "ApprovalEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingJob" ADD CONSTRAINT "PublishingJob_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YouTubeVideo" ADD CONSTRAINT "YouTubeVideo_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_youtubeVideoId_fkey" FOREIGN KEY ("youtubeVideoId") REFERENCES "YouTubeVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReport" ADD CONSTRAINT "PerformanceReport_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbTest" ADD CONSTRAINT "AbTest_youtubeVideoId_fkey" FOREIGN KEY ("youtubeVideoId") REFERENCES "YouTubeVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbVariant" ADD CONSTRAINT "AbVariant_abTestId_fkey" FOREIGN KEY ("abTestId") REFERENCES "AbTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sponsor" ADD CONSTRAINT "Sponsor_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostRecord" ADD CONSTRAINT "CostRecord_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationJob" ADD CONSTRAINT "AutomationJob_videoProjectId_fkey" FOREIGN KEY ("videoProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
