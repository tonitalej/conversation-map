import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMap } from '../src/analysis/build.ts';
import { normalizeDraft } from '../src/analysis/draft.ts';
import type { ConversationMap, Diagnostic } from '../src/core/model.ts';
import { parseTranscript } from '../src/ingest/transcript.ts';
import type { ViewerAssets } from '../src/render/html.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = join(ROOT, 'plugins/conversation-map/skills/conversation-map/scripts/conversation-map.mjs');
export const EXAMPLE = join(ROOT, 'examples/launch-planning');

export function assets(): ViewerAssets {
  return {
    script: readFileSync(join(ROOT, 'build/viewer.js'), 'utf8'),
    style: readFileSync(join(ROOT, 'build/viewer.css'), 'utf8'),
  };
}

export type Msg = [role: string, content: string];

export function transcript(...messages: Msg[]) {
  return parseTranscript(JSON.stringify(messages.map(([role, content]) => ({ role, content }))), 'json');
}

export function draft(nodes: unknown[], relations: unknown[] = [], extra: Record<string, unknown> = {}) {
  return { schemaVersion: '1', title: 'Test', coverage: { status: 'complete' }, nodes, relations, ...extra };
}

export function topic(key: string, parent: string | null = null, title = key) {
  return { key, parent, kind: 'topic', title, summary: '' };
}

export function item(
  key: string,
  classification: string,
  evidence: [string, string][] = [],
  more: Record<string, unknown> = {},
) {
  return {
    key,
    parent: 't',
    kind: 'item',
    title: key,
    summary: '',
    classification,
    evidence: evidence.map(([message, quote]) => ({ message, quote })),
    ...more,
  };
}

/** Build a map from a transcript and one or more raw draft objects. */
export function mapOf(
  t: ReturnType<typeof transcript>,
  ...raw: unknown[]
): { map: ConversationMap; errors: Diagnostic[] } {
  const parsed = raw.map((r, i) => normalizeDraft(r, `analysis ${i + 1}`));
  return buildMap(
    t,
    parsed.map((p) => p.draft),
    parsed.flatMap((p) => p.diagnostics),
  );
}

export function node(map: ConversationMap, id: string) {
  const n = map.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} not in map`);
  return n;
}

export function codes(map: ConversationMap, level?: Diagnostic['level']): string[] {
  return map.diagnostics.filter((d) => !level || d.level === level).map((d) => d.code);
}
