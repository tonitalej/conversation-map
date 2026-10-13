import {
  ACTION_CLASSIFICATIONS,
  CLASSIFICATIONS,
  EVIDENCE_REQUIRED,
  SPEAKERS,
  type Classification,
  type ConversationMap,
  type MapNode,
  type Speaker,
} from '../core/model.ts';
import { isPlainObject, jaccard, tokens } from '../core/text.ts';

/**
 * Semantic-quality scoring of a generated map against a hand-labelled gold file.
 * Deterministic: the same map and gold always give the same scores.
 */

export interface GoldItem {
  id: string;
  title: string;
  classification: Classification;
  messages: string[];
  speaker?: Speaker;
  /** Marks deliberately tricky items (e.g. a suggestion phrased like a decision). */
  trap?: boolean;
}

export interface Gold {
  transcript: string;
  items: GoldItem[];
}

export interface Score {
  goldItems: number;
  candidateItems: number;
  matched: number;
  classificationAccuracy: number | null;
  classificationPrecision: number | null;
  classificationRecall: number | null;
  attributionAccuracy: number | null;
  sourceTraceability: number | null;
  unsupportedClaimRate: number | null;
  taskPrecision: number | null;
  taskRecall: number | null;
  trapItems: number;
  trapErrors: number;
  mismatches: { gold: string; candidate: string; expected: Classification; got: Classification }[];
  missed: string[];
}

export function parseGold(value: unknown): Gold {
  if (!isPlainObject(value) || !Array.isArray(value['items']))
    throw new Error('Gold file must be an object with an "items" array.');
  const items = value['items'].map((raw, i): GoldItem => {
    if (!isPlainObject(raw)) throw new Error(`Gold item ${i} is not an object.`);
    const { id, title, classification, messages, speaker, trap } = raw;
    if (typeof id !== 'string' || typeof title !== 'string') throw new Error(`Gold item ${i} needs id and title.`);
    if (typeof classification !== 'string' || !(CLASSIFICATIONS as readonly string[]).includes(classification)) {
      throw new Error(`Gold item ${id} has invalid classification.`);
    }
    if (!Array.isArray(messages) || !messages.every((m) => typeof m === 'string'))
      throw new Error(`Gold item ${id} needs a messages array.`);
    if (speaker !== undefined && !(SPEAKERS as readonly string[]).includes(String(speaker)))
      throw new Error(`Gold item ${id} has invalid speaker.`);
    const item: GoldItem = {
      id,
      title,
      classification: classification as Classification,
      messages: messages as string[],
    };
    if (speaker !== undefined) item.speaker = speaker as Speaker;
    if (trap === true) item.trap = true;
    return item;
  });
  return { transcript: typeof value['transcript'] === 'string' ? value['transcript'] : '', items };
}

function similarity(g: GoldItem, c: MapNode): number {
  const cited = new Set(c.evidence.filter((e) => e.verified).map((e) => e.messageId));
  const shared = g.messages.some((m) => cited.has(m));
  const titleSim = jaccard(tokens(g.title), tokens(c.title));
  if (shared && titleSim >= 0.15) return 1 + titleSim;
  if (titleSim >= 0.5) return titleSim;
  return 0;
}

const ratio = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 1000) / 1000);

export function scoreMap(map: ConversationMap, gold: Gold): Score {
  const candidates = map.nodes.filter((n) => n.kind === 'item');
  // Greedy one-to-one matching on the best similarity first.
  const pairs: { g: GoldItem; c: MapNode; s: number }[] = [];
  for (const g of gold.items)
    for (const c of candidates) {
      const s = similarity(g, c);
      if (s > 0) pairs.push({ g, c, s });
    }
  pairs.sort((a, b) => b.s - a.s || a.g.id.localeCompare(b.g.id) || a.c.id.localeCompare(b.c.id));
  const usedG = new Set<string>();
  const usedC = new Set<string>();
  const matches: { g: GoldItem; c: MapNode }[] = [];
  for (const p of pairs) {
    if (usedG.has(p.g.id) || usedC.has(p.c.id)) continue;
    usedG.add(p.g.id);
    usedC.add(p.c.id);
    matches.push(p);
  }

  const correct = matches.filter((m) => m.c.classification === m.g.classification);
  const withSpeaker = matches.filter((m) => m.g.speaker);
  const attributed = withSpeaker.filter((m) => m.c.speakers.length === 1 && m.c.speakers[0] === m.g.speaker);
  const traced = candidates.filter((c) => c.evidence.some((e) => e.verified));
  const needEvidence = candidates.filter((c) => EVIDENCE_REQUIRED.has(c.classification!));
  const unsupported = needEvidence.filter((c) => !c.evidence.some((e) => e.verified));

  const goldTasks = gold.items.filter((g) => ACTION_CLASSIFICATIONS.has(g.classification));
  const candTasks = candidates.filter((c) => ACTION_CLASSIFICATIONS.has(c.classification!));
  const taskHits = matches.filter(
    (m) => ACTION_CLASSIFICATIONS.has(m.g.classification) && m.c.classification === m.g.classification,
  );
  const traps = gold.items.filter((g) => g.trap);
  const trapErrors = matches.filter((m) => m.g.trap && m.c.classification !== m.g.classification).length;

  return {
    goldItems: gold.items.length,
    candidateItems: candidates.length,
    matched: matches.length,
    classificationAccuracy: ratio(correct.length, matches.length),
    classificationPrecision: ratio(correct.length, candidates.length),
    classificationRecall: ratio(correct.length, gold.items.length),
    attributionAccuracy: ratio(attributed.length, withSpeaker.length),
    sourceTraceability: ratio(traced.length, candidates.length),
    unsupportedClaimRate: ratio(unsupported.length, needEvidence.length),
    taskPrecision: ratio(taskHits.length, candTasks.length),
    taskRecall: ratio(taskHits.length, goldTasks.length),
    trapItems: traps.length,
    trapErrors,
    mismatches: matches
      .filter((m) => m.c.classification !== m.g.classification)
      .map((m) => ({ gold: m.g.id, candidate: m.c.id, expected: m.g.classification, got: m.c.classification! })),
    missed: gold.items.filter((g) => !usedG.has(g.id)).map((g) => g.id),
  };
}
