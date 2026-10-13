import {
  CLASSIFICATIONS,
  RELATION_TYPES,
  SCHEMA_VERSION,
  SPEAKERS,
  STATUS_BY_CLASSIFICATION,
  type ConversationMap,
} from '../core/model.ts';
import { isPlainObject } from '../core/text.ts';

/**
 * Integrity checks for a finished ConversationMap (e.g. one loaded from map.json before
 * re-rendering). Returns human-readable problems; an empty list means the map is consistent.
 */
export function validateMap(value: unknown): string[] {
  const problems: string[] = [];
  if (!isPlainObject(value)) return ['Map must be a JSON object.'];
  const map = value as unknown as ConversationMap;
  if (map.schemaVersion !== SCHEMA_VERSION) problems.push(`schemaVersion must be "${SCHEMA_VERSION}".`);
  if (typeof map.title !== 'string') problems.push('title must be a string.');
  if (!Array.isArray(map.nodes) || !Array.isArray(map.relations) || !Array.isArray(map.messages)) {
    problems.push('nodes, relations and messages must be arrays.');
    return problems;
  }

  const ids = new Map<string, ConversationMap['nodes'][number]>();
  for (const n of map.nodes) {
    if (!isPlainObject(n) || typeof n.id !== 'string') {
      problems.push('Every node needs a string id.');
      continue;
    }
    if (ids.has(n.id)) problems.push(`Duplicate node id "${n.id}".`);
    ids.set(n.id, n);
  }
  const root = ids.get(map.rootId);
  if (!root || root.kind !== 'root' || root.parentId !== null)
    problems.push('rootId must reference a root node without a parent.');

  for (const n of ids.values()) {
    if (!['root', 'topic', 'item'].includes(n.kind)) problems.push(`Node "${n.id}" has invalid kind.`);
    if (typeof n.title !== 'string' || typeof n.summary !== 'string')
      problems.push(`Node "${n.id}" needs title and summary strings.`);
    if (n.kind === 'item') {
      if (!(CLASSIFICATIONS as readonly string[]).includes(n.classification ?? '')) {
        problems.push(`Item "${n.id}" has invalid classification.`);
      } else if (n.status !== STATUS_BY_CLASSIFICATION[n.classification!]) {
        problems.push(`Item "${n.id}" status does not match its classification.`);
      }
      if (Array.isArray(n.childIds) && n.childIds.length > 0) problems.push(`Item "${n.id}" must not have children.`);
    }
    if (n.kind !== 'root') {
      const parent = n.parentId === null ? undefined : ids.get(n.parentId);
      if (!parent) problems.push(`Node "${n.id}" has a missing parent.`);
      else if (!parent.childIds.includes(n.id)) problems.push(`Parent of "${n.id}" does not list it as a child.`);
    }
    for (const c of n.childIds ?? []) {
      if (ids.get(c)?.parentId !== n.id) problems.push(`Child "${c}" of "${n.id}" does not point back to it.`);
    }
    if (!Array.isArray(n.evidence)) problems.push(`Node "${n.id}" evidence must be an array.`);
    else
      for (const e of n.evidence) {
        if (e.speaker !== undefined && !(SPEAKERS as readonly string[]).includes(e.speaker)) {
          problems.push(`Node "${n.id}" evidence has an invalid speaker.`);
        }
      }
  }

  // Reachability and acyclicity of the hierarchy.
  if (root) {
    const seen = new Set<string>();
    const stack = [root.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) {
        problems.push(`Hierarchy contains a cycle at "${id}".`);
        break;
      }
      seen.add(id);
      for (const c of ids.get(id)?.childIds ?? []) stack.push(c);
    }
    if (seen.size !== ids.size) problems.push('Some nodes are not reachable from the root.');
  }

  const relIds = new Set<string>();
  for (const r of map.relations) {
    if (!(RELATION_TYPES as readonly string[]).includes(r.type)) problems.push(`Relation "${r.id}" has invalid type.`);
    if (!ids.has(r.from) || !ids.has(r.to)) problems.push(`Relation "${r.id}" references a missing node.`);
    if (relIds.has(r.id)) problems.push(`Duplicate relation id "${r.id}".`);
    relIds.add(r.id);
  }
  return problems;
}
