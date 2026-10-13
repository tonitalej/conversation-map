import type { Classification, ConversationMap, MapNode } from '../core/model.ts';
import { CLASSIFICATION_LABEL, FLAG_LABEL, RELATION_LABEL, SPEAKER_LABEL, STATUS_LABEL } from './labels.ts';

/**
 * Escape conversation-derived text so it renders literally in any CommonMark/GFM viewer:
 * no links, images, raw HTML, emphasis, headings, lists or tables can be injected.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\r?\n+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/[\\`*_{}[\]()<>#+!|~]/g, '\\$&')
    .replace(/^([#>+\-]|\d+\.)/, '\\$1')
    .replace(/(https?|ftp|mailto|javascript|data):/gi, '$1&#58;')
    .replace(/www\./gi, 'www&#46;');
}

function tag(n: MapNode): string {
  if (n.kind === 'topic') return '';
  const label = CLASSIFICATION_LABEL[n.classification!];
  const status = STATUS_LABEL[n.status];
  return `**[${label}${status && !label.toLowerCase().includes(status.toLowerCase()) ? ` · ${status}` : ''}]** `;
}

function flags(n: MapNode): string {
  const shown = n.flags.filter((f) => f !== 'merged');
  return shown.length > 0 ? ` _(${shown.map((f) => FLAG_LABEL[f]).join('; ')})_` : '';
}

const OVERVIEW: { title: string; classes: Classification[] }[] = [
  { title: 'Decisions', classes: ['decision'] },
  { title: 'Open questions', classes: ['open_question'] },
  { title: 'Pending actions', classes: ['action_item'] },
  { title: 'Completed actions', classes: ['completed_action'] },
  { title: 'Unaccepted suggestions', classes: ['suggestion'] },
  { title: 'Rejected or superseded', classes: ['rejected_proposal', 'superseded_decision'] },
];

export function renderMarkdown(map: ConversationMap): string {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  out.push(`# ${escapeMarkdown(map.title)}`, '');
  out.push(
    `_Conversation Map · ${map.stats.messages} messages · ${map.stats.topics} topics · ${map.stats.items} items · coverage: ${map.coverage.status}_`,
    '',
  );
  if (map.coverage.note) out.push(`> Coverage note: ${escapeMarkdown(map.coverage.note)}`, '');

  out.push('## Overview', '');
  for (const section of OVERVIEW) {
    const items = map.nodes.filter((n) => n.classification && section.classes.includes(n.classification));
    out.push(`### ${section.title} (${items.length})`, '');
    if (items.length === 0) out.push('_None recorded._', '');
    for (const n of items) {
      const extras = [n.owner ? `owner: ${escapeMarkdown(n.owner)}` : '', n.due ? `due: ${escapeMarkdown(n.due)}` : '']
        .filter(Boolean)
        .join(', ');
      out.push(`- ${tag(n)}${escapeMarkdown(n.title)}${extras ? ` (${extras})` : ''}${flags(n)} — \`${n.id}\``);
    }
    if (items.length > 0) out.push('');
  }

  out.push('## Topic map', '');
  const walk = (id: string, depth: number) => {
    const n = byId.get(id)!;
    const indent = '  '.repeat(depth);
    out.push(`${indent}- ${tag(n)}**${escapeMarkdown(n.title)}**${flags(n)} — \`${n.id}\``);
    if (n.summary) out.push(`${indent}  ${escapeMarkdown(n.summary)}`);
    if (n.detail) out.push(`${indent}  ${escapeMarkdown(n.detail)}`);
    if (n.rationale) out.push(`${indent}  _Why this classification:_ ${escapeMarkdown(n.rationale)}`);
    for (const e of n.evidence) {
      const who = e.speaker ? SPEAKER_LABEL[e.speaker] : 'Unknown';
      out.push(
        `${indent}  > ${who}, message ${escapeMarkdown(e.messageId)}${e.verified ? '' : ' (quote not found in source)'}: “${escapeMarkdown(e.quote)}”`,
      );
    }
    for (const c of n.childIds) walk(c, depth + 1);
  };
  for (const c of byId.get(map.rootId)!.childIds) walk(c, 0);
  out.push('');

  out.push('## Relationships', '');
  if (map.relations.length === 0) out.push('_No cross-topic relationships recorded._');
  for (const r of map.relations) {
    const from = byId.get(r.from)!;
    const to = byId.get(r.to)!;
    out.push(
      `- ${escapeMarkdown(from.title)} **${RELATION_LABEL[r.type].out.toLowerCase()}** ${escapeMarkdown(to.title)}${r.note ? ` — ${escapeMarkdown(r.note)}` : ''}`,
    );
  }
  out.push('');

  if (map.analystNotes.length > 0) {
    out.push('## Analyst notes', '');
    for (const n of map.analystNotes) out.push(`- ${escapeMarkdown(n)}`);
    out.push('');
  }

  const issues = map.diagnostics.filter((d) => d.level !== 'info');
  out.push('## Validation', '');
  out.push(
    `${map.stats.verifiedEvidence} verified quotes, ${map.stats.unverifiedEvidence} unverified, ${map.stats.unsupportedItems} items without a verified source.`,
    '',
  );
  for (const d of issues) out.push(`- ${d.level === 'error' ? 'Repaired' : 'Warning'}: ${escapeMarkdown(d.message)}`);
  if (issues.length === 0) out.push('_No validation problems._');
  out.push('');
  return out.join('\n');
}
