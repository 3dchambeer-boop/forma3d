// =====================================================================
// Generation job state machine (server-enforced).
//
// The database row is the source of truth; browsers only display it.
// Spelling follows the existing Prisma enum (CANCELLED with two Ls).
// =====================================================================

export const GENERATION_STATES = [
  'QUEUED',
  'GENERATING',
  'DOWNLOADING',
  'CONVERTING',
  'VALIDATING',
  'REVIEW_REQUIRED',
  'FAILED',
  'CANCELLED',
] as const;

export type GenerationState = (typeof GENERATION_STATES)[number];

const TRANSITIONS: Record<GenerationState, readonly GenerationState[]> = {
  QUEUED: ['GENERATING', 'CONVERTING', 'FAILED', 'CANCELLED'],
  // GENERATING → QUEUED is a scheduled retry after a transient provider error
  GENERATING: ['GENERATING', 'DOWNLOADING', 'CONVERTING', 'QUEUED', 'FAILED', 'CANCELLED'],
  DOWNLOADING: ['CONVERTING', 'QUEUED', 'FAILED', 'CANCELLED'],
  CONVERTING: ['VALIDATING', 'QUEUED', 'FAILED', 'CANCELLED'],
  // every generated revision goes to a designer: printing requires human approval
  VALIDATING: ['REVIEW_REQUIRED', 'FAILED'],
  REVIEW_REQUIRED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: GenerationState, to: GenerationState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: GenerationState, to: GenerationState): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal generation state transition ${from} → ${to}`);
  }
}

export function isTerminal(state: GenerationState): boolean {
  return TRANSITIONS[state].length === 0;
}
