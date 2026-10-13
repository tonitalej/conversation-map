import { LIMITS } from '../core/limits.ts';
import {
  CLASSIFICATIONS,
  COVERAGE_STATUSES,
  RELATION_TYPES,
  SCHEMA_VERSION,
  type AnalysisDraft,
  type Classification,
  type CoverageStatus,
  type Diagnostic,
  type DraftEvidence,
  type DraftNode,
  type DraftRelation,
  type RelationType,
} from '../core/model.ts';
import { charLength, isPlainObject, stripControl, truncate } from '../core/text.ts';

export class DraftError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'DraftError';
  }
}

const NODE_FIELDS = new Set([
  'key',
  'parent',
  'kind',
  'title',
  'summary',
  'detail',
  'classification',
  'rationale',
  'evidence',
  'supersededBy',
  'owner',
  'due',
]);

const CLASSIFICATION_SET: ReadonlySet<string> = new Set(CLASSIFICATIONS);
const RELATION_SET: ReadonlySet<string> = new Set(RELATION_TYPES);

/**
 * Structural parsing of an analysis draft. Problems that can be repaired without inventing
 * content are reported as `error` diagnostics (with the repair applied) so a strict build can
 * refuse them; problems that make the whole draft unusable throw DraftError.
 */
export function parseDraft(raw: string, label = 'analysis'): { draft: AnalysisDraft; diagnostics: Diagnostic[] } {
  if (Buffer.byteLength(raw, 'utf8') > LIMITS.analysisBytes) {
    throw new DraftError(
      'analysis-too-large',
      `${label}: analysis exceeds ${LIMITS.analysisBytes / (1024 * 1024)} MB.`,
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new DraftError('analysis-invalid-json', `${label}: not valid JSON (${(err as Error).message}).`);
  }
  return normalizeDraft(data, label);
}

export function normalizeDraft(data: unknown, label = 'analysis'): { draft: AnalysisDraft; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const err = (code: string, message: string, node?: string) =>
    diagnostics.push({ level: 'error', code, message: `${label}: ${message}`, node, repaired: true });
  const warn = (code: string, message: string, node?: string) =>
    diagnostics.push({ level: 'warning', code, message: `${label}: ${message}`, node, repaired: true });

  if (!isPlainObject(data)) throw new DraftError('analysis-not-object', `${label}: top level must be a JSON object.`);
  const version = data['schemaVersion'];
  if (String(version) !== SCHEMA_VERSION) {
    throw new DraftError(
      'analysis-schema-version',
      `${label}: schemaVersion must be "${SCHEMA_VERSION}" (got ${JSON.stringify(version ?? null)}).`,
    );
  }
  if (!Array.isArray(data['nodes'])) throw new DraftError('analysis-no-nodes', `${label}: "nodes" must be an array.`);
  if (data['nodes'].length > LIMITS.nodes) {
    throw new DraftError(
      'analysis-too-many-nodes',
      `${label}: ${data['nodes'].length} nodes exceeds the limit of ${LIMITS.nodes}.`,
    );
  }

  const title = cleanText(data['title'], LIMITS.titleChars, 'title', warn) || 'Untitled conversation';
  const coverage = parseCoverage(data['coverage'], err, warn);

  const nodes: DraftNode[] = [];
  data['nodes'].forEach((rawNode, i) => {
    const node = parseNode(rawNode, i, err, warn);
    if (node) nodes.push(node);
  });

  const relations: DraftRelation[] = [];
  const rawRelations = data['relations'] ?? [];
  if (!Array.isArray(rawRelations)) {
    err('relations-not-array', '"relations" must be an array; relations were ignored.');
  } else {
    if (rawRelations.length > LIMITS.relations) {
      throw new DraftError(
        'analysis-too-many-relations',
        `${label}: relations exceed the limit of ${LIMITS.relations}.`,
      );
    }
    rawRelations.forEach((r, i) => {
      const rel = parseRelation(r, i, err, warn);
      if (rel) relations.push(rel);
    });
  }

  const notes: string[] = [];
  const rawNotes = data['notes'] ?? [];
  if (Array.isArray(rawNotes)) {
    for (const n of rawNotes.slice(0, LIMITS.notes)) {
      const t = cleanText(n, LIMITS.noteChars, 'note', warn);
      if (t) notes.push(t);
    }
    if (rawNotes.length > LIMITS.notes) warn('notes-truncated', `only the first ${LIMITS.notes} notes were kept.`);
  }

  return { draft: { schemaVersion: SCHEMA_VERSION, title, coverage, nodes, relations, notes }, diagnostics };
}

type Report = (code: string, message: string, node?: string) => void;

function parseCoverage(value: unknown, err: Report, warn: Report): { status: CoverageStatus; note?: string } {
  if (!isPlainObject(value)) {
    err('coverage-missing', '"coverage" is missing; coverage is reported as partial.');
    return { status: 'partial' };
  }
  const status = value['status'];
  const note = cleanText(value['note'], LIMITS.noteChars, 'coverage note', warn);
  if (typeof status !== 'string' || !(COVERAGE_STATUSES as readonly string[]).includes(status)) {
    err('coverage-invalid', '"coverage.status" must be "complete" or "partial"; reported as partial.');
    return note ? { status: 'partial', note } : { status: 'partial' };
  }
  return note ? { status: status as CoverageStatus, note } : { status: status as CoverageStatus };
}

function parseNode(raw: unknown, i: number, err: Report, warn: Report): DraftNode | null {
  const where = `nodes[${i}]`;
  if (!isPlainObject(raw)) {
    err('node-not-object', `${where} is not an object and was dropped.`);
    return null;
  }
  for (const field of Object.keys(raw)) {
    if (!NODE_FIELDS.has(field)) warn('node-unknown-field', `${where}: unknown field "${field.slice(0, 40)}" ignored.`);
  }

  let key = typeof raw['key'] === 'string' ? raw['key'].trim() : '';
  if (!key) {
    err('node-missing-key', `${where} has no key and was dropped.`);
    return null;
  }
  if (!LIMITS.keyPattern.test(key) || key === 'root') {
    const fixed = slugify(key);
    if (!fixed || fixed === 'root') {
      err('node-invalid-key', `${where}: key "${key.slice(0, 40)}" is invalid and the node was dropped.`);
      return null;
    }
    err('node-invalid-key', `${where}: key "${key.slice(0, 40)}" is not a lowercase slug; using "${fixed}".`, fixed);
    key = fixed;
  }

  const kind = raw['kind'];
  if (kind !== 'topic' && kind !== 'item') {
    err('node-invalid-kind', `node "${key}": kind must be "topic" or "item"; the node was dropped.`, key);
    return null;
  }

  const title = cleanText(raw['title'], LIMITS.titleChars, `node "${key}" title`, warn, key);
  if (!title) {
    err('node-missing-title', `node "${key}" has no title and was dropped.`, key);
    return null;
  }
  const summary = cleanText(raw['summary'], LIMITS.summaryChars, `node "${key}" summary`, warn, key) ?? '';

  const parentRaw = raw['parent'];
  let parent: string | null = null;
  if (typeof parentRaw === 'string' && parentRaw.trim() !== '' && parentRaw.trim() !== 'root')
    parent = parentRaw.trim();
  else if (parentRaw !== null && parentRaw !== undefined && parentRaw !== 'root' && parentRaw !== '') {
    err('node-invalid-parent', `node "${key}": parent must be a key or null; attached to the root.`, key);
  }

  const node: DraftNode = { key, parent, kind, title, summary };

  const detail = cleanText(raw['detail'], LIMITS.detailChars, `node "${key}" detail`, warn, key);
  if (detail) node.detail = detail;
  const rationale = cleanText(raw['rationale'], LIMITS.rationaleChars, `node "${key}" rationale`, warn, key);
  if (rationale) node.rationale = rationale;

  const cls = raw['classification'];
  if (kind === 'item') {
    if (typeof cls === 'string' && CLASSIFICATION_SET.has(cls)) node.classification = cls as Classification;
    else {
      err(
        'node-invalid-classification',
        `item "${key}": classification ${JSON.stringify(cls ?? null)} is not allowed; set to "unknown".`,
        key,
      );
      node.classification = 'unknown';
    }
  } else if (cls !== undefined) {
    warn('topic-classification-ignored', `topic "${key}": topics have no classification; value ignored.`, key);
  }

  const evidence = parseEvidence(raw['evidence'], key, err, warn);
  if (evidence.length > 0) node.evidence = evidence;

  if (typeof raw['supersededBy'] === 'string' && raw['supersededBy'].trim() !== '')
    node.supersededBy = raw['supersededBy'].trim();
  const owner = cleanText(raw['owner'], LIMITS.ownerChars, `node "${key}" owner`, warn, key);
  if (owner) node.owner = owner;
  const due = cleanText(raw['due'], LIMITS.dueChars, `node "${key}" due`, warn, key);
  if (due) node.due = due;
  return node;
}

function parseEvidence(value: unknown, key: string, err: Report, warn: Report): DraftEvidence[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    err('evidence-not-array', `node "${key}": evidence must be an array; ignored.`, key);
    return [];
  }
  const out: DraftEvidence[] = [];
  for (const [j, e] of value.entries()) {
    if (out.length >= LIMITS.evidencePerNode) {
      warn(
        'evidence-truncated',
        `node "${key}": only the first ${LIMITS.evidencePerNode} evidence entries were kept.`,
        key,
      );
      break;
    }
    if (!isPlainObject(e) || typeof e['message'] !== 'string' || typeof e['quote'] !== 'string') {
      err('evidence-invalid', `node "${key}": evidence[${j}] needs string "message" and "quote"; dropped.`, key);
      continue;
    }
    const quote = stripControl(e['quote']).trim();
    if (quote === '') {
      err('evidence-empty-quote', `node "${key}": evidence[${j}] has an empty quote; dropped.`, key);
      continue;
    }
    out.push({ message: e['message'].trim(), quote: truncate(quote, LIMITS.quoteChars) });
    if (charLength(quote) > LIMITS.quoteChars) {
      warn(
        'evidence-quote-truncated',
        `node "${key}": evidence[${j}] quote was longer than ${LIMITS.quoteChars} characters.`,
        key,
      );
    }
  }
  return out;
}

function parseRelation(raw: unknown, i: number, err: Report, warn: Report): DraftRelation | null {
  if (!isPlainObject(raw)) {
    err('relation-invalid', `relations[${i}] is not an object; dropped.`);
    return null;
  }
  const { from, to, type } = raw;
  if (typeof from !== 'string' || typeof to !== 'string' || typeof type !== 'string') {
    err('relation-invalid', `relations[${i}] needs string "from", "to" and "type"; dropped.`);
    return null;
  }
  if (!RELATION_SET.has(type)) {
    err('relation-invalid-type', `relations[${i}]: type "${type.slice(0, 40)}" is not allowed; dropped.`);
    return null;
  }
  const rel: DraftRelation = { from: from.trim(), to: to.trim(), type: type as RelationType };
  const note = cleanText(raw['note'], LIMITS.noteChars, `relations[${i}] note`, warn);
  if (note) rel.note = note;
  return rel;
}

function cleanText(value: unknown, max: number, what: string, warn: Report, node?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = stripControl(value).trim();
  if (cleaned === '') return undefined;
  if (charLength(cleaned) > max) {
    warn('text-truncated', `${what} exceeded ${max} characters and was truncated.`, node);
    return truncate(cleaned, max);
  }
  return cleaned;
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}
