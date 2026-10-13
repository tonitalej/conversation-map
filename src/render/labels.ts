import type { Classification, NodeFlag, RelationType, Speaker, Status } from '../core/model.ts';

/** Human-facing vocabulary, shared by the Markdown export, static outline and interactive viewer. */

export const CLASSIFICATION_LABEL: Readonly<Record<Classification, string>> = {
  user_statement: 'User statement',
  assistant_statement: 'Assistant statement',
  fact: 'Fact',
  suggestion: 'Suggestion',
  decision: 'Decision',
  rejected_proposal: 'Rejected proposal',
  superseded_decision: 'Superseded decision',
  open_question: 'Open question',
  answered_question: 'Answered question',
  action_item: 'Action item',
  completed_action: 'Completed action',
  inference: 'Inference',
  unknown: 'Unclassified',
};

/** Short text glyphs so categories never depend on color alone. */
export const CLASSIFICATION_GLYPH: Readonly<Record<Classification, string>> = {
  user_statement: 'U',
  assistant_statement: 'A',
  fact: 'F',
  suggestion: 'S',
  decision: 'D',
  rejected_proposal: 'R',
  superseded_decision: 'D',
  open_question: '?',
  answered_question: '?',
  action_item: 'T',
  completed_action: 'T',
  inference: 'I',
  unknown: '·',
};

export const CLASSIFICATION_HELP: Readonly<Record<Classification, string>> = {
  user_statement: 'Something the user said, attributed to the user only.',
  assistant_statement: 'Something the assistant said, attributed to the assistant only.',
  fact: 'A factual statement explicitly made in the conversation (not independently verified).',
  suggestion: 'A proposal or recommendation that was not explicitly accepted.',
  decision: 'An explicit choice that is still current.',
  rejected_proposal: 'A proposal that was explicitly declined.',
  superseded_decision: 'A decision that was later replaced or corrected. Not current.',
  open_question: 'A question that was not answered in the conversation.',
  answered_question: 'A question that received an answer in the conversation.',
  action_item: 'Work that someone said should happen. Not done yet.',
  completed_action: 'Work explicitly reported as done.',
  inference: "The analyst's interpretation. Not stated explicitly in the conversation.",
  unknown: 'Could not be classified reliably.',
};

export const STATUS_LABEL: Readonly<Record<Status, string>> = {
  none: '',
  active: 'Current',
  proposed: 'Proposed',
  rejected: 'Rejected',
  superseded: 'Superseded',
  open: 'Open',
  answered: 'Answered',
  pending: 'Pending',
  done: 'Done',
};

export const RELATION_LABEL: Readonly<Record<RelationType, { out: string; in: string }>> = {
  supports: { out: 'Supports', in: 'Supported by' },
  contradicts: { out: 'Conflicts with', in: 'Conflicts with' },
  supersedes: { out: 'Replaces', in: 'Replaced by' },
  answers: { out: 'Answers', in: 'Answered by' },
  implements: { out: 'Implements', in: 'Implemented by' },
  depends_on: { out: 'Depends on', in: 'Needed by' },
  related: { out: 'Related to', in: 'Related to' },
};

export const SPEAKER_LABEL: Readonly<Record<Speaker, string>> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
  other: 'Other',
};

export const FLAG_LABEL: Readonly<Record<NodeFlag, string>> = {
  unsupported: 'No verified source',
  'unverified-evidence': 'Has unverified quote',
  'attribution-mismatch': 'Attribution unclear',
  'in-conflict': 'In conflict',
  merged: 'Merged duplicates',
};
