import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildMap } from '../../src/analysis/build.ts';
import { parseDraft } from '../../src/analysis/draft.ts';
import { LIMITS } from '../../src/core/limits.ts';
import { CLASSIFICATIONS, RELATION_TYPES, type ConversationMap } from '../../src/core/model.ts';
import { parseGold, scoreMap } from '../../src/eval/score.ts';
import { formatFromPath, parseTranscript } from '../../src/ingest/transcript.ts';
import { EXAMPLE, ROOT } from '../helpers.ts';

const schema = JSON.parse(
  readFileSync(join(ROOT, 'plugins/conversation-map/skills/conversation-map/references/analysis.schema.json'), 'utf8'),
);

function exampleMap(): ConversationMap {
  const path = join(EXAMPLE, 'transcript.md');
  const t = parseTranscript(readFileSync(path, 'utf8'), formatFromPath(path));
  const { draft, diagnostics } = parseDraft(readFileSync(join(EXAMPLE, 'analysis.json'), 'utf8'));
  return buildMap(t, [draft], diagnostics).map;
}

describe('published JSON Schema stays in sync with the validator', () => {
  it('lists the same classifications and relation types', () => {
    assert.deepEqual(schema.$defs.classification.enum, [...CLASSIFICATIONS]);
    assert.deepEqual(schema.$defs.relationType.enum, [...RELATION_TYPES]);
  });

  it('uses the same limits', () => {
    assert.equal(schema.$defs.key.pattern, LIMITS.keyPattern.source);
    assert.equal(schema.$defs.evidence.properties.quote.maxLength, LIMITS.quoteChars);
    assert.equal(schema.$defs.node.properties.evidence.maxItems, LIMITS.evidencePerNode);
    assert.equal(schema.properties.nodes.maxItems, LIMITS.nodes);
    assert.equal(schema.$defs.node.properties.title.maxLength, LIMITS.titleChars);
  });
});

describe('example analysis', () => {
  it('builds with no errors or warnings and every quote verified', () => {
    const map = exampleMap();
    assert.deepEqual(
      map.diagnostics.filter((d) => d.level !== 'info'),
      [],
    );
    assert.equal(map.stats.unverifiedEvidence, 0);
    assert.equal(map.stats.unsupportedItems, 0);
  });

  it('matches the checked-in generated map.json', () => {
    const committed = JSON.parse(readFileSync(join(EXAMPLE, 'output/map.json'), 'utf8'));
    assert.deepEqual(committed, JSON.parse(JSON.stringify(exampleMap())), 'run `npm run examples` to refresh');
  });
});

describe('semantic evaluation scorer', () => {
  const gold = parseGold(JSON.parse(readFileSync(join(EXAMPLE, 'gold.json'), 'utf8')));

  it('scores a map deterministically', () => {
    assert.deepEqual(scoreMap(exampleMap(), gold), scoreMap(exampleMap(), gold));
  });

  it('detects misclassified trap items', () => {
    const map = exampleMap();
    const referral = map.nodes.find((n) => n.id === 'referral-program')!;
    referral.classification = 'decision';
    const score = scoreMap(map, gold);
    assert.equal(score.trapErrors, 1);
    assert.deepEqual(score.mismatches, [
      { gold: 'g-referral', candidate: 'referral-program', expected: 'suggestion', got: 'decision' },
    ]);
  });

  it('counts unsupported items and missed gold items', () => {
    const map = exampleMap();
    const gdpr = map.nodes.find((n) => n.id === 'gdpr-review')!;
    gdpr.evidence = [];
    gdpr.title = 'Something unrelated';
    const score = scoreMap(map, gold);
    assert.ok(score.unsupportedClaimRate! > 0);
    assert.deepEqual(score.missed, ['g-gdpr']);
  });

  it('rejects malformed gold files', () => {
    assert.throws(() => parseGold({ items: [{ id: 'x', title: 't', classification: 'maybe', messages: [] }] }));
  });
});
