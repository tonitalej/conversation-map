import { LIMITS, ROOT_ID } from '../core/limits.ts';
import {
  ACTION_CLASSIFICATIONS,
  EVIDENCE_REQUIRED,
  GENERATOR,
  SCHEMA_VERSION,
  STATUS_BY_CLASSIFICATION,
  type AnalysisDraft,
  type Classification,
  type ConversationMap,
  type CoverageStatus,
  type Diagnostic,
  type DraftEvidence,
  type DraftNode,
  type DraftRelation,
  type Evidence,
  type MapNode,
  type MapStats,
  type Message,
  type NodeFlag,
  type Relation,
  type SourceMessage,
  type Speaker,
  type Transcript,
} from '../core/model.ts';
import { fnv1a, jaccard, normalizeForMatch, normalizeTitle, quoteOccursIn, tokens, truncate } from '../core/text.ts';
import { DraftError } from './draft.ts';

const EMBEDDED_MESSAGE_CHARS = 20_000;

interface WorkNode extends DraftNode {
  flags: Set<NodeFlag>;
  draftIndex: number;
  verified: Evidence[];
}

export interface BuildResult {
  map: ConversationMap;
  /** Diagnostics with level "error": problems the analyst should fix. Already repaired in `map`. */
  errors: Diagnostic[];
}

/**
 * Validate one or more analysis drafts against the transcript and assemble the map.
 * Always returns a consistent map; anything that had to be changed is reported in
 * `map.diagnostics` and problems the analyst should fix are also returned in `errors`.
 */
export function buildMap(
  transcript: Transcript,
  drafts: AnalysisDraft[],
  draftDiagnostics: Diagnostic[] = [],
): BuildResult {
  if (drafts.length === 0) throw new DraftError('analysis-missing', 'At least one analysis draft is required.');
  const diags: Diagnostic[] = [...transcript.diagnostics, ...draftDiagnostics];
  const ctx = new Context(diags);

  const nodes = mergeDrafts(drafts, ctx);
  if (nodes.size === 0) {
    throw new DraftError('analysis-empty', 'The analysis contains no usable nodes, so no map can be built.');
  }
  resolveHierarchy(nodes, ctx);
  dedupeSiblings(nodes, ctx);
  const messages = new Map(transcript.messages.map((m) => [m.id, m]));
  verifyEvidence(nodes, transcript.messages, messages, ctx);
  applyClassificationRules(nodes, messages, ctx);
  const relations = buildRelations(nodes, drafts, ctx);
  reportStructure(nodes, relations, ctx);

  const map = assemble(transcript, drafts, nodes, relations, messages, diags);
  return { map, errors: diags.filter((d) => d.level === 'error') };
}

class Context {
  /** Maps keys that were merged away (or renamed) to the surviving key. */
  readonly alias = new Map<string, string>();
  readonly diags: Diagnostic[];
  constructor(diags: Diagnostic[]) {
    this.diags = diags;
  }
  error(code: string, message: string, node?: string) {
    this.diags.push({ level: 'error', code, message, node, repaired: true });
  }
  warn(code: string, message: string, node?: string, repaired = false) {
    this.diags.push(
      repaired ? { level: 'warning', code, message, node, repaired } : { level: 'warning', code, message, node },
    );
  }
  info(code: string, message: string, node?: string) {
    this.diags.push({ level: 'info', code, message, node });
  }
  resolve(key: string): string {
    let k = key;
    for (let guard = 0; guard < 64 && this.alias.has(k); guard++) k = this.alias.get(k)!;
    return k;
  }
}

// ---------------------------------------------------------------------------
// 1. Merge drafts (same key across chunks = same node)

function mergeDrafts(drafts: AnalysisDraft[], ctx: Context): Map<string, WorkNode> {
  const nodes = new Map<string, WorkNode>();
  drafts.forEach((draft, draftIndex) => {
    for (const n of draft.nodes) {
      const work: WorkNode = { ...n, evidence: [...(n.evidence ?? [])], flags: new Set(), draftIndex, verified: [] };
      const existing = nodes.get(n.key);
      if (!existing) {
        nodes.set(n.key, work);
        continue;
      }
      if (existing.kind === n.kind && existing.classification === n.classification) {
        mergeInto(existing, work, ctx);
        if (existing.draftIndex === draftIndex) {
          ctx.error('node-duplicate-key', `Key "${n.key}" is used twice; the two nodes were merged.`, n.key);
        } else {
          ctx.info('node-merged-across-drafts', `Node "${n.key}" appears in several drafts and was merged.`, n.key);
        }
        continue;
      }
      const renamed = uniqueKey(`${n.key}-${draftIndex + 1}`, nodes);
      ctx.error(
        'node-key-conflict',
        `Key "${n.key}" is used for nodes with different kinds or classifications (${describe(existing)} vs ${describe(work)}); the second was renamed "${renamed}".`,
        renamed,
      );
      work.key = renamed;
      nodes.set(renamed, work);
    }
  });
  if (nodes.size > LIMITS.nodes) {
    throw new DraftError(
      'analysis-too-many-nodes',
      `Merged analysis has ${nodes.size} nodes; the limit is ${LIMITS.nodes}.`,
    );
  }
  return nodes;
}

function describe(n: DraftNode): string {
  return n.kind === 'topic' ? 'topic' : `item/${n.classification}`;
}

function uniqueKey(base: string, taken: Map<string, unknown>): string {
  let key = base.slice(0, 60);
  for (let i = 2; taken.has(key) || key === ROOT_ID; i++) key = `${base.slice(0, 58)}-${i}`;
  return key;
}

function mergeInto(target: WorkNode, source: WorkNode, ctx: Context) {
  const seen = new Set(target.evidence!.map((e) => `${e.message}\u0000${normalizeForMatch(e.quote)}`));
  for (const e of source.evidence ?? []) {
    const k = `${e.message}\u0000${normalizeForMatch(e.quote)}`;
    if (!seen.has(k) && target.evidence!.length < LIMITS.evidencePerNode) {
      target.evidence!.push(e);
      seen.add(k);
    }
  }
  if (source.summary.length > target.summary.length) target.summary = source.summary;
  if (source.detail && source.detail !== target.detail) {
    target.detail = target.detail
      ? truncate(`${target.detail}\n\n${source.detail}`, LIMITS.detailChars)
      : source.detail;
  }
  target.rationale ??= source.rationale;
  target.owner ??= source.owner;
  target.due ??= source.due;
  target.supersededBy ??= source.supersededBy;
  if (source.parent !== target.parent && source.parent !== null) {
    if (target.parent === null) target.parent = source.parent;
    else
      ctx.warn(
        'node-parent-disagreement',
        `Merged node "${target.key}" had different parents ("${target.parent}" and "${source.parent}"); kept "${target.parent}".`,
        target.key,
      );
  }
  target.flags.add('merged');
}

// ---------------------------------------------------------------------------
// 2. Hierarchy: unknown parents, items as parents, cycles, depth

function resolveHierarchy(nodes: Map<string, WorkNode>, ctx: Context) {
  for (const n of nodes.values()) {
    if (n.parent === null) continue;
    if (n.parent === n.key) {
      ctx.error('node-self-parent', `Node "${n.key}" is its own parent; attached to the root.`, n.key);
      n.parent = null;
      continue;
    }
    if (!nodes.has(n.parent)) {
      ctx.error(
        'node-unknown-parent',
        `Node "${n.key}" has unknown parent "${n.parent}"; attached to the root.`,
        n.key,
      );
      n.parent = null;
    }
  }
  // Items are leaves: re-home children of items onto the nearest topic ancestor.
  for (const n of nodes.values()) {
    let p = n.parent === null ? undefined : nodes.get(n.parent);
    if (!p || p.kind === 'topic') continue;
    const original = p.key;
    const seen = new Set<string>();
    while (p && p.kind === 'item' && !seen.has(p.key)) {
      seen.add(p.key);
      p = p.parent === null ? undefined : nodes.get(p.parent);
    }
    n.parent = p && p.kind === 'topic' ? p.key : null;
    ctx.error(
      'node-parent-is-item',
      `Node "${n.key}" was placed under item "${original}"; items cannot have children, so it was moved to ${n.parent ? `topic "${n.parent}"` : 'the root'}. Use a relation to link items.`,
      n.key,
    );
  }
  // Cycles.
  for (const n of nodes.values()) {
    const seen = new Set<string>([n.key]);
    let p = n.parent;
    while (p !== null) {
      if (seen.has(p)) {
        ctx.error('node-cycle', `Node "${n.key}" is part of a parent cycle; it was attached to the root.`, n.key);
        n.parent = null;
        break;
      }
      seen.add(p);
      p = nodes.get(p)?.parent ?? null;
    }
  }
  // Depth (root = 0).
  for (const n of nodes.values()) {
    const chain: string[] = [];
    let p = n.parent;
    while (p !== null) {
      chain.unshift(p);
      p = nodes.get(p)!.parent;
    }
    if (chain.length + 1 > LIMITS.depth) {
      const newParent = chain[LIMITS.depth - 2] ?? null;
      ctx.error(
        'node-too-deep',
        `Node "${n.key}" is nested deeper than ${LIMITS.depth} levels; moved under "${newParent ?? ROOT_ID}".`,
        n.key,
      );
      n.parent = newParent;
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Sibling deduplication

function childrenOf(nodes: Map<string, WorkNode>): Map<string | null, WorkNode[]> {
  const out = new Map<string | null, WorkNode[]>();
  for (const n of nodes.values()) {
    const list = out.get(n.parent) ?? [];
    list.push(n);
    out.set(n.parent, list);
  }
  return out;
}

function dedupeSiblings(nodes: Map<string, WorkNode>, ctx: Context) {
  const queue: (string | null)[] = [null];
  const visited = new Set<string | null>();
  while (queue.length > 0) {
    const parent = queue.shift()!;
    if (visited.has(parent)) continue;
    visited.add(parent);
    const siblings = childrenOf(nodes).get(parent) ?? [];
    const byIdentity = new Map<string, WorkNode>();
    for (const s of siblings) {
      const identity = `${s.kind}|${s.classification ?? ''}|${normalizeTitle(s.title)}`;
      const survivor = byIdentity.get(identity);
      if (!survivor) {
        byIdentity.set(identity, s);
        continue;
      }
      mergeInto(survivor, s, ctx);
      for (const child of nodes.values()) if (child.parent === s.key) child.parent = survivor.key;
      nodes.delete(s.key);
      ctx.alias.set(s.key, survivor.key);
      ctx.warn(
        'node-duplicate-merged',
        `"${s.key}" duplicates "${survivor.key}" (same title and classification under the same parent) and was merged into it.`,
        survivor.key,
        true,
      );
    }
    const remaining = [...byIdentity.values()];
    for (let i = 0; i < remaining.length; i++) {
      for (let j = i + 1; j < remaining.length; j++) {
        const a = remaining[i]!;
        const b = remaining[j]!;
        if (a.kind !== b.kind || a.classification !== b.classification) continue;
        if (jaccard(tokens(a.title), tokens(b.title)) >= 0.8) {
          ctx.warn(
            'node-possible-duplicate',
            `"${a.key}" and "${b.key}" have very similar titles; check whether they are the same.`,
            a.key,
          );
        }
      }
    }
    for (const s of remaining) if (s.kind === 'topic') queue.push(s.key);
  }
}

// ---------------------------------------------------------------------------
// 4. Evidence verification and attribution

function verifyEvidence(
  nodes: Map<string, WorkNode>,
  ordered: Message[],
  messages: Map<string, Message>,
  ctx: Context,
) {
  for (const n of nodes.values()) {
    const out: Evidence[] = [];
    for (const ev of n.evidence ?? []) {
      const resolved = locateEvidence(ev, ordered, messages);
      if (resolved.kind === 'missing-message') {
        ctx.error(
          'evidence-unknown-message',
          `Node "${n.key}" cites message "${ev.message}", which does not exist; the citation was removed.`,
          n.key,
        );
        continue;
      }
      if (resolved.kind === 'relocated') {
        ctx.error(
          'evidence-wrong-message',
          `Node "${n.key}": the quote attributed to "${ev.message}" was found only in "${resolved.message.id}"; the citation was corrected.`,
          n.key,
        );
      }
      const m = resolved.message;
      const verified = resolved.kind !== 'unverified';
      if (!verified) {
        n.flags.add('unverified-evidence');
        ctx.warn(
          'evidence-unverified',
          `Node "${n.key}": quote not found in message "${m.id}". It is shown as unverified.`,
          n.key,
        );
      }
      out.push({ messageId: m.id, quote: ev.quote, verified, speaker: m.speaker, label: m.label, index: m.index });
    }
    n.verified = out;
  }
}

type Located =
  | { kind: 'verified'; message: Message }
  | { kind: 'relocated'; message: Message }
  | { kind: 'unverified'; message: Message }
  | { kind: 'missing-message' };

function locateEvidence(ev: DraftEvidence, ordered: Message[], messages: Map<string, Message>): Located {
  const cited = messages.get(ev.message);
  const quotable = Array.from(ev.quote.trim()).length >= LIMITS.quoteMinChars;
  if (cited && quotable && quoteOccursIn(ev.quote, cited.text)) return { kind: 'verified', message: cited };
  if (quotable) {
    let found: Message | undefined;
    let count = 0;
    for (const m of ordered) {
      if (quoteOccursIn(ev.quote, m.text)) {
        found = m;
        if (++count > 1) break;
      }
    }
    if (count === 1 && found) return { kind: 'relocated', message: found };
  }
  return cited ? { kind: 'unverified', message: cited } : { kind: 'missing-message' };
}

function speakersOf(n: WorkNode): Speaker[] {
  const out: Speaker[] = [];
  for (const e of n.verified) if (e.verified && e.speaker && !out.includes(e.speaker)) out.push(e.speaker);
  return out;
}

// ---------------------------------------------------------------------------
// 5. Classification rules

function applyClassificationRules(nodes: Map<string, WorkNode>, messages: Map<string, Message>, ctx: Context) {
  for (const n of nodes.values()) {
    if (n.kind !== 'item') continue;
    const speakers = speakersOf(n);

    // Rule: a statement attributed to one speaker must not come from another.
    for (const [cls, speaker] of [
      ['user_statement', 'user'],
      ['assistant_statement', 'assistant'],
    ] as const) {
      if (n.classification !== cls || speakers.length === 0 || speakers.every((s) => s === speaker)) continue;
      const other: Classification | null = speakers.every((s) => s === 'assistant')
        ? 'assistant_statement'
        : speakers.every((s) => s === 'user')
          ? 'user_statement'
          : null;
      if (other) {
        ctx.error(
          'attribution-mismatch',
          `"${n.key}" is classified ${cls}, but its verified evidence comes from the ${speakers[0]}; reclassified as ${other}.`,
          n.key,
        );
        n.classification = other;
      } else {
        ctx.error(
          'attribution-mismatch',
          `"${n.key}" is classified ${cls}, but its evidence comes from several speakers; reclassified as unknown.`,
          n.key,
        );
        n.classification = 'unknown';
        n.flags.add('attribution-mismatch');
      }
    }

    if (EVIDENCE_REQUIRED.has(n.classification!) && speakers.length === 0) {
      n.flags.add('unsupported');
      ctx.warn(
        'item-unsupported',
        `"${n.key}" (${n.classification}) has no verified supporting quote; it is marked as unsupported.`,
        n.key,
      );
    }

    // Owner and due date must be stated, not invented.
    for (const field of ['owner', 'due'] as const) {
      const value = n[field];
      if (!value) continue;
      if (!ACTION_CLASSIFICATIONS.has(n.classification!)) {
        ctx.warn('field-not-applicable', `"${n.key}": ${field} is only used for actions; removed.`, n.key, true);
        delete n[field];
        continue;
      }
      const needle = normalizeForMatch(value);
      const grounded = n.verified.some(
        (e) => e.verified && normalizeForMatch(messages.get(e.messageId)?.text ?? '').includes(needle),
      );
      if (!grounded) {
        ctx.warn(
          'field-ungrounded',
          `"${n.key}": ${field} "${value}" does not appear in the cited messages; removed rather than guessed.`,
          n.key,
          true,
        );
        delete n[field];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Relations

function buildRelations(nodes: Map<string, WorkNode>, drafts: AnalysisDraft[], ctx: Context): Relation[] {
  const out = new Map<string, Relation>();
  const add = (from: string, to: string, rel: DraftRelation, derived: boolean) => {
    const id = `${from}--${rel.type}--${to}`;
    if (out.has(id)) return;
    const r: Relation = { id, from, to, type: rel.type, derived };
    if (rel.note) r.note = rel.note;
    out.set(id, r);
  };

  for (const n of nodes.values()) {
    if (!n.supersededBy) continue;
    const target = ctx.resolve(n.supersededBy);
    if (!nodes.has(target) || target === n.key) {
      ctx.error(
        'superseded-by-invalid',
        `"${n.key}": supersededBy "${n.supersededBy}" is not another node; the link was removed.`,
        n.key,
      );
      delete n.supersededBy;
      continue;
    }
    if (n.classification === 'decision') {
      ctx.error(
        'decision-superseded',
        `"${n.key}" is a current decision but names a replacement ("${target}"); reclassified as superseded_decision so it is not shown as current.`,
        n.key,
      );
      n.classification = 'superseded_decision';
    } else if (n.classification !== 'superseded_decision') {
      ctx.error(
        'superseded-by-not-applicable',
        `"${n.key}": supersededBy only applies to superseded decisions; removed.`,
        n.key,
      );
      delete n.supersededBy;
      continue;
    }
    add(target, n.key, { from: target, to: n.key, type: 'supersedes' }, true);
  }

  for (const draft of drafts) {
    for (const rel of draft.relations) {
      const from = ctx.resolve(rel.from);
      const to = ctx.resolve(rel.to);
      if (!nodes.has(from) || !nodes.has(to)) {
        ctx.error(
          'relation-unknown-node',
          `Relation ${rel.from} -${rel.type}-> ${rel.to} refers to a node that does not exist; removed.`,
        );
        continue;
      }
      if (from === to) {
        ctx.error('relation-self', `Relation ${rel.type} on "${from}" points to itself; removed.`, from);
        continue;
      }
      if (rel.type === 'supersedes') {
        const target = nodes.get(to)!;
        if (target.classification === 'decision') {
          ctx.error(
            'decision-superseded',
            `"${to}" is superseded by "${from}" but was classified as a current decision; reclassified as superseded_decision.`,
            to,
          );
          target.classification = 'superseded_decision';
        }
      }
      add(from, to, rel, false);
    }
  }

  const relations = [...out.values()];
  for (const r of relations) {
    if (r.type === 'contradicts') {
      nodes.get(r.from)!.flags.add('in-conflict');
      nodes.get(r.to)!.flags.add('in-conflict');
    }
    if (r.type === 'answers' && nodes.get(r.to)!.classification === 'open_question') {
      ctx.warn(
        'open-question-has-answer',
        `"${r.to}" is an open question but "${r.from}" is linked as its answer; confirm whether it is answered.`,
        r.to,
      );
    }
  }
  return relations;
}

// ---------------------------------------------------------------------------
// 7. Structural reporting

function reportStructure(nodes: Map<string, WorkNode>, relations: Relation[], ctx: Context) {
  const kids = childrenOf(nodes);
  for (const n of nodes.values()) {
    if (n.kind === 'topic' && !(kids.get(n.key)?.length ?? 0)) {
      ctx.info('topic-empty', `Topic "${n.key}" has no details under it.`, n.key);
    }
    if (
      n.classification === 'superseded_decision' &&
      !relations.some((r) => r.type === 'supersedes' && r.to === n.key)
    ) {
      ctx.warn('superseded-without-replacement', `"${n.key}" is superseded but no replacement is linked.`, n.key);
    }
    if (n.classification === 'answered_question' && !relations.some((r) => r.type === 'answers' && r.to === n.key)) {
      ctx.info('answer-not-linked', `"${n.key}" is answered but no answering node is linked.`, n.key);
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Assembly

function assemble(
  transcript: Transcript,
  drafts: AnalysisDraft[],
  work: Map<string, WorkNode>,
  relations: Relation[],
  messages: Map<string, Message>,
  diags: Diagnostic[],
): ConversationMap {
  const kids = childrenOf(work);
  const title =
    drafts[0]!.title !== 'Untitled conversation' ? drafts[0]!.title : (transcript.title ?? drafts[0]!.title);
  const coverageStatus: CoverageStatus = drafts.some((d) => d.coverage.status === 'partial') ? 'partial' : 'complete';
  const coverageNotes = drafts.map((d) => d.coverage.note).filter((n): n is string => !!n);
  const coverage: ConversationMap['coverage'] =
    coverageNotes.length > 0 ? { status: coverageStatus, note: coverageNotes.join(' ') } : { status: coverageStatus };
  if (coverageStatus === 'partial') {
    diags.push({
      level: 'info',
      code: 'coverage-partial',
      message: 'The analyst reported partial coverage; the map may not include everything discussed.',
    });
  }

  const root: MapNode = {
    id: ROOT_ID,
    parentId: null,
    childIds: [],
    depth: 0,
    kind: 'root',
    status: 'none',
    title,
    summary: coverage.note ?? '',
    evidence: [],
    speakers: [],
    flags: [],
  };
  const nodes: MapNode[] = [root];
  const visit = (parentKey: string | null, parent: MapNode) => {
    for (const w of kids.get(parentKey) ?? []) {
      const node: MapNode = {
        id: w.key,
        parentId: parent.id,
        childIds: [],
        depth: parent.depth + 1,
        kind: w.kind,
        status: w.kind === 'item' ? STATUS_BY_CLASSIFICATION[w.classification!] : 'none',
        title: w.title,
        summary: w.summary,
        evidence: w.verified,
        speakers: speakersOf(w),
        flags: [...w.flags].sort(),
      };
      if (w.kind === 'item') node.classification = w.classification!;
      if (w.detail) node.detail = w.detail;
      if (w.rationale) node.rationale = w.rationale;
      if (w.owner) node.owner = w.owner;
      if (w.due) node.due = w.due;
      parent.childIds.push(node.id);
      nodes.push(node);
      if (w.kind === 'topic') visit(w.key, node);
    }
  };
  visit(null, root);

  const cited = new Set<string>();
  for (const n of nodes) for (const e of n.evidence) cited.add(e.messageId);
  const embedded: SourceMessage[] = [...cited]
    .map((id) => messages.get(id)!)
    .sort((a, b) => a.index - b.index)
    .map((m) => {
      const s: SourceMessage = {
        id: m.id,
        index: m.index,
        speaker: m.speaker,
        label: m.label,
        text: truncate(m.text, EMBEDDED_MESSAGE_CHARS),
      };
      if (m.timestamp) s.timestamp = m.timestamp;
      return s;
    });

  const speakers: Partial<Record<Speaker, number>> = {};
  let characters = 0;
  for (const m of transcript.messages) {
    speakers[m.speaker] = (speakers[m.speaker] ?? 0) + 1;
    characters += m.text.length;
  }

  const stats: MapStats = {
    messages: transcript.messages.length,
    topics: nodes.filter((n) => n.kind === 'topic').length,
    items: nodes.filter((n) => n.kind === 'item').length,
    byClassification: {},
    relations: relations.length,
    verifiedEvidence: 0,
    unverifiedEvidence: 0,
    unsupportedItems: nodes.filter((n) => n.flags.includes('unsupported')).length,
  };
  for (const n of nodes) {
    if (n.classification)
      stats.byClassification[n.classification] = (stats.byClassification[n.classification] ?? 0) + 1;
    for (const e of n.evidence) e.verified ? stats.verifiedEvidence++ : stats.unverifiedEvidence++;
  }

  const notes = drafts.flatMap((d) => d.notes);
  return {
    schemaVersion: SCHEMA_VERSION,
    generator: GENERATOR,
    id: `c${fnv1a(transcript.messages.map((m) => `${m.speaker}:${m.text}`).join('\u0001'))}`,
    title,
    source: { format: transcript.format, messageCount: transcript.messages.length, speakers, characters },
    coverage,
    rootId: ROOT_ID,
    nodes,
    relations: relations.sort((a, b) => a.id.localeCompare(b.id)),
    messages: embedded,
    analystNotes: notes,
    diagnostics: diags,
    stats,
  };
}
