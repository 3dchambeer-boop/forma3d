// =====================================================================
// FORMA-3D Domain Types
// =====================================================================

import type { Locale } from './i18n';

export type Role = 'END_USER' | 'DESIGNER' | 'FARM_MANAGER' | 'ADMIN';

export type ViewId =
  | 'landing'
  | 'auth'
  | 'dashboard'
  | 'new_project'
  | 'model_viewer'
  | 'designer_queue'
  | 'designer_review'
  | 'farm_dashboard'
  | 'printer_fleet'
  | 'slicing_dispatch'
  | 'admin_analytics'
  | 'admin_users'
  | 'notifications'
  | 'settings'
  | 'system_health';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl?: string;
  locale: Locale;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING';
  createdAt: string;
  lastLoginAt?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export type ModelFormat = 'STL' | 'GLB' | 'OBJ' | 'PLY';

export type RevisionStatus =
  | 'DRAFT'
  | 'PROCESSING'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED';

export type AIProvider = 'PARAMETRIC' | 'AI_DESIGNER' | 'TRIPO' | 'SELF_HOSTED' | 'MOCK' | 'MESHY' | 'RODIN';

export type GenerationInputType = 'TEXT_TO_3D' | 'IMAGE_TO_3D';

export type GenerationStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'GENERATING'
  | 'DOWNLOADING'
  | 'CONVERTING'
  | 'VALIDATING'
  | 'PROCESSING'
  | 'REVIEW_REQUIRED'
  | 'APPROVED'
  | 'FAILED'
  | 'CANCELLED';

export interface DesignRevision {
  id: string;
  projectId: string;
  version: number;
  status: RevisionStatus;
  prompt: string;
  negativePrompt?: string;
  modelUrl?: string;
  thumbnailUrl?: string;
  format?: ModelFormat;
  vertexCount?: number;
  faceCount?: number;
  boundingBoxX?: number;
  boundingBoxY?: number;
  boundingBoxZ?: number;
  validationReport?: string;
  validationStatus?: 'VALIDATED' | 'VALID_WITH_WARNINGS' | 'REPAIR_REQUIRED' | null;
  stlUrl?: string | null;
  stlSha256?: string | null;
  sourceModelUrl?: string | null;
  specJson?: string | null;
  createdAt: string;
}

/** Parsed mesh_validation_service report (see services/ai_3d_engine). */
export interface ValidationReport {
  status: string;
  issues: { code: string; severity: 'error' | 'warning' | 'info'; message: string; count: number | null }[];
  repairs_applied: string[];
  checks_not_performed: string[];
  stats: { triangles?: number; size_mm?: { x: number; y: number; z: number } | null; volume_mm3?: number | null; bodies?: number; estimated_min_wall_mm?: number | null };
}

export interface GenerationStatusResponse {
  job: {
    id: string; status: GenerationStatus; stage: string | null; progress: number;
    provider: AIProvider; providerModel: string | null; externalTaskId: string | null;
    attempts: number; errorMessage: string | null; costCredits: number | null;
    createdAt: string; startedAt: string | null; completedAt: string | null;
    result: { status: string; size_mm: { x: number; y: number; z: number } | null; triangles: number; transforms: string[]; stl_sha256: string } | null;
  };
  project: { id: string; name: string };
  revision: {
    id: string; version: number; status: RevisionStatus; modelUrl: string | null; stlUrl: string | null;
    format: ModelFormat | null; validationStatus: string | null; validationReport: ValidationReport | string | null;
    spec: DesignSpec | null; sizeMm: { x: number; y: number; z: number } | null; triangles: number | null;
  } | null;
}

/** Structured spec returned by the engine's parser. */
export interface DesignSpec {
  prompt: string;
  language: 'ar' | 'en';
  template: string | null;
  template_title: string | null;
  intended_use: string;
  params: Record<string, { value: number; source: 'user_field' | 'prompt' | 'default' | 'llm'; note: string | null }>;
  requirements: string[];
  assumptions: string[];
  clarifications: string[];
  errors: string[];
  extractor: 'rules' | 'llm';
  template_schema: {
    key: string; title_ar: string; title_en: string; key_params: string[];
    params: { name: string; default: number; min: number; max: number; unit: 'mm' | 'deg' | 'count' | 'bool'; label_ar: string; label_en: string }[];
  } | null;
}

export interface DesignProject {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  organizationId: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  revisions: DesignRevision[];
  createdAt: string;
  updatedAt: string;
}

export interface AIGenerationJob {
  id: string;
  projectId: string;
  initiatedById: string;
  provider: AIProvider;
  status: GenerationStatus;
  progress: number;
  inputType: GenerationInputType;
  textPrompt?: string;
  referenceImageUrl?: string;
  externalTaskId?: string;
  outputModelUrl?: string;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export type ReviewStatus = 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

export interface HumanReview {
  id: string;
  revisionId: string;
  reviewerId: string;
  reviewerName: string;
  status: ReviewStatus;
  comments?: string;
  rejectionReason?: string;
  createdAt: string;
  decidedAt?: string;
}

export type PrinterStatus = 'IDLE' | 'BUSY' | 'OFFLINE' | 'ERROR' | 'PAUSED' | 'HEATING';

export interface Printer {
  id: string;
  name: string;
  organizationId: string;
  model: string;
  status: PrinterStatus;
  buildVolumeX: number;
  buildVolumeY: number;
  buildVolumeZ: number;
  nozzleDiameter: number;
  materials: string[];
  octoprintUrl?: string;
  lastSeenAt?: string;
  bedTemp?: number;
  nozzleTemp?: number;
  progressPercent?: number;
  currentJobName?: string;
  utilizationPercent: number;
}

export type PrintJobStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SLICING'
  | 'SLICED'
  | 'QUEUED_FOR_PRINTER'
  | 'AWAITING_PRINT_CONFIRMATION'
  | 'PRINTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'PAUSED';

export interface SlicingProfile {
  id: string;
  name: string;
  printerModel: string;
  material: string;
  nozzleDiameter: number;
  layerHeight: number;
  infillDensity: number;
  printSpeed: number;
  supportsEnabled: boolean;
}

export interface PrintJob {
  id: string;
  projectId: string;
  projectName?: string;
  revisionId: string;
  revisionVersion?: number;
  initiatedById: string;
  initiatedByName?: string;
  slicingProfileId?: string;
  status: PrintJobStatus;
  priority: number;
  gcodeUrl?: string;
  gcodeSizeBytes?: number;
  gcodeChecksum?: string;
  estimatedTimeMin?: number;
  actualTimeMin?: number;
  materialGrams?: number;
  printerId?: string;
  printerName?: string;
  dispatchedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  octoprintPath?: string | null;
  progressPercent?: number | null;
  lastPrinterState?: string | null;
  createdAt: string;
  updatedAt: string;
  // Populated by API when include is used
  project?: { id: string; name: string };
  revision?: { id: string; version: number; format?: ModelFormat };
  printer?: { id: string; name: string; model: string; status: PrinterStatus };
  slicingProfile?: SlicingProfile;
  initiatedBy?: { id: string; name: string };
}

export interface AuditEvent {
  id: string;
  actorId?: string;
  actorName?: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: string | null;
  ipAddress?: string;
  createdAt: string;
  // Populated by API
  actor?: { id: string; name: string; email: string } | null;
}

export interface AppNotification {
  id: string;
  userId: string;
  type: 'GENERATION_DONE' | 'REVIEW_DECISION' | 'PRINT_COMPLETE' | 'PRINT_FAILED' | 'SYSTEM' | 'PRINTER_OFFLINE';
  title: string;
  message: string;
  read: boolean;
  link?: ViewId;
  createdAt: string;
}

export type ServiceHealth = 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'NOT_CONFIGURED';

export interface ServiceStatus {
  id: string;
  name: string;
  status: ServiceHealth;
  latencyMs?: number;
  uptime?: string;
  message?: string;
}
