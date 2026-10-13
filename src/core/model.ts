/**
 * Conversation Map data model (schema version 1).
 *
 * Two documents exist:
 *  - AnalysisDraft: what the analyst (an LLM or a person) writes. Loose, keyed by
 *    analyst-chosen slugs, validated before use.
 *  - ConversationMap: the validated, normalized output consumed by every renderer.
 */

export const SCHEMA_VERSION = '1';
export const GENERATOR = 'conversation-map/1.0.0';

export const SPEAKERS = ['user', 'assistant', 'system', 'tool', 'other'] as const;
export type Speaker = (typeof SPEAKERS)[number];

export const CLASSIFICATIONS = [
  'user_statement',
  'assistant_statement',
  'fact',
  'suggestion',
  'decision',
  'rejected_proposal',
  'superseded_decision',
  'open_question',
  'answered_question',
  'action_item',
  'completed_action',
  'inference',
  'unknown',
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const RELATION_TYPES = [
  'supports',
  'contradicts',
  'supersedes',
  'answers',
  'implements',
  'depends_on',
  'related',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const STATUSES = [
  'none',
  'active',
  'proposed',
  'rejected',
  'superseded',
  'open',
  'answered',
  'pending',
  'done',
] as const;
export type Status = (typeof STATUSES)[number];

/** Status is derived from classification so the two can never disagree. */
export const STATUS_BY_CLASSIFICATION: Readonly<Record<Classification, Status>> = {
  user_statement: 'none',
  assistant_statement: 'none',
  fact: 'none',
  suggestion: 'proposed',
  decision: 'active',
  rejected_proposal: 'rejected',
  superseded_decision: 'superseded',
  open_question: 'open',
  answered_question: 'answered',
  action_item: 'pending',
  completed_action: 'done',
  inference: 'none',
  unknown: 'none',
};

/** Classifications that assert something happened in the conversation and therefore need grounding. */
export const EVIDENCE_REQUIRED: ReadonlySet<Classification> = new Set(
  CLASSIFICATIONS.filter((c) => c !== 'inference' && c !== 'unknown'),
);

export const ACTION_CLASSIFICATIONS: ReadonlySet<Classification> = new Set(['action_item', 'completed_action']);

export const COVERAGE_STATUSES = ['complete', 'partial'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Transcript

export type TranscriptFormat = 'json' | 'jsonl' | 'text';

export interface Message {
  id: string;
  /** Zero-based position in the supplied transcript. */
  index: number;
  speaker: Speaker;
  /** Speaker label exactly as supplied (e.g. "Human", "ChatGPT", "Dana"). */
  label: string;
  text: string;
  /** Only present when the transcript supplied one. Never synthesized. */
  timestamp?: string;
}

export interface Transcript {
  format: TranscriptFormat;
  title?: string;
  messages: Message[];
  diagnostics: Diagnostic[];
}

// ---------------------------------------------------------------------------
// Analysis draft (analyst output, untrusted until validated)

export interface DraftEvidence {
  message: string;
  quote: string;
}

export interface DraftNode {
  key: string;
  parent: string | null;
  kind: 'topic' | 'item';
  title: string;
  summary: string;
  detail?: string;
  classification?: Classification;
  rationale?: string;
  evidence?: DraftEvidence[];
  supersededBy?: string;
  owner?: string;
  due?: string;
}

export interface DraftRelation {
  from: string;
  to: string;
  type: RelationType;
  note?: string;
}

export interface AnalysisDraft {
  schemaVersion: string;
  title: string;
  coverage: { status: CoverageStatus; note?: string };
  nodes: DraftNode[];
  relations: DraftRelation[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Validated output

export type DiagnosticLevel = 'error' | 'warning' | 'info';

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  /** Node key/id the diagnostic concerns, when applicable. */
  node?: string;
  /** Set when the pipeline changed the analyst's data to keep the map consistent. */
  repaired?: boolean;
}

export interface Evidence {
  messageId: string;
  quote: string;
  /** True only when the quote was found verbatim (after whitespace/quote normalization) in that message. */
  verified: boolean;
  speaker?: Speaker;
  label?: string;
  index?: number;
}

export type NodeKind = 'root' | 'topic' | 'item';

export type NodeFlag = 'unsupported' | 'unverified-evidence' | 'attribution-mismatch' | 'in-conflict' | 'merged';

export interface MapNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  kind: NodeKind;
  classification?: Classification;
  status: Status;
  title: string;
  summary: string;
  detail?: string;
  rationale?: string;
  evidence: Evidence[];
  /** Speakers of verified evidence, in first-seen order. */
  speakers: Speaker[];
  owner?: string;
  due?: string;
  flags: NodeFlag[];
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  type: RelationType;
  note?: string;
  /** True when the pipeline created the relation (e.g. from `supersededBy`). */
  derived: boolean;
}

export interface SourceMessage {
  id: string;
  index: number;
  speaker: Speaker;
  label: string;
  text: string;
  timestamp?: string;
}

export interface MapStats {
  messages: number;
  topics: number;
  items: number;
  byClassification: Partial<Record<Classification, number>>;
  relations: number;
  verifiedEvidence: number;
  unverifiedEvidence: number;
  unsupportedItems: number;
}

export interface ConversationMap {
  schemaVersion: typeof SCHEMA_VERSION;
  generator: string;
  id: string;
  title: string;
  source: {
    format: TranscriptFormat;
    messageCount: number;
    speakers: Partial<Record<Speaker, number>>;
    characters: number;
  };
  coverage: { status: CoverageStatus; note?: string };
  rootId: string;
  nodes: MapNode[];
  relations: Relation[];
  /** Only messages cited as evidence are embedded, to limit what the artifact discloses. */
  messages: SourceMessage[];
  analystNotes: string[];
  diagnostics: Diagnostic[];
  stats: MapStats;
}
