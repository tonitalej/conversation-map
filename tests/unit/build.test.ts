import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateMap } from '../../src/analysis/validate-map.ts';
import { DraftError } from '../../src/analysis/draft.ts';
import { codes, draft, item, mapOf, node, topic, transcript } from '../helpers.ts';

const convo = transcript(
  ['user', 'Should we use Postgres or MySQL for the new service?'],
  ['assistant', 'I recommend Postgres because of its JSON support.'],
  ['user', "Agreed, let's use Postgres. Sam will set up the database by Monday."],
  ['assistant', 'Great. I have already provisioned the staging cluster.'],
  ['user', 'Actually, use MySQL instead. Ops only supports MySQL.'],
);

describe('evidence verification and attribution', () => {
  it('verifies verbatim quotes and derives speakers from the cited messages', () => {
    const { map, errors } = mapOf(
      convo,
      draft([topic('t'), item('use-postgres', 'decision', [['m3', "let's use Postgres"]])]),
    );
    assert.equal(errors.length, 0);
    const n = node(map, 'use-postgres');
    assert.equal(n.evidence[0]!.verified, true);
    assert.deepEqual(n.speakers, ['user']);
    assert.deepEqual(n.flags, []);
  });

  it('marks paraphrased quotes as unverified and the item as unsupported', () => {
    const { map } = mapOf(convo, draft([topic('t'), item('d', 'decision', [['m3', 'we chose Postgres']])]));
    const n = node(map, 'd');
    assert.equal(n.evidence[0]!.verified, false);
    assert.deepEqual(n.flags, ['unsupported', 'unverified-evidence']);
    assert.deepEqual(n.speakers, []);
    assert.ok(codes(map, 'warning').includes('evidence-unverified'));
    assert.ok(codes(map, 'warning').includes('item-unsupported'));
  });

  it('removes citations of messages that do not exist rather than showing them', () => {
    const { map, errors } = mapOf(convo, draft([topic('t'), item('d', 'decision', [['m99', "let's use Postgres"]])]));
    assert.ok(
      errors.some((e) => e.code === 'evidence-wrong-message'),
      'quote relocated to the only message containing it',
    );
    assert.equal(node(map, 'd').evidence[0]!.messageId, 'm3');

    const r2 = mapOf(convo, draft([topic('t'), item('x', 'fact', [['m42', 'not in the transcript']])]));
    assert.equal(node(r2.map, 'x').evidence.length, 0);
    assert.ok(r2.errors.some((e) => e.code === 'evidence-unknown-message'));
  });

  it('never attributes a user statement to the assistant', () => {
    const { map, errors } = mapOf(
      convo,
      draft([topic('t'), item('s', 'user_statement', [['m2', 'I recommend Postgres']])]),
    );
    assert.equal(node(map, 's').classification, 'assistant_statement');
    assert.ok(errors.some((e) => e.code === 'attribution-mismatch'));
  });

  it('marks statements with evidence from both speakers as unknown with an attribution flag', () => {
    const { map } = mapOf(
      convo,
      draft([
        topic('t'),
        item('s', 'assistant_statement', [
          ['m2', 'I recommend Postgres'],
          ['m3', 'Agreed'],
        ]),
      ]),
    );
    const n = node(map, 's');
    assert.equal(n.classification, 'unknown');
    assert.ok(n.flags.includes('attribution-mismatch'));
  });

  it('keeps inferences without quotes but never marks them as stated', () => {
    const { map, errors } = mapOf(convo, draft([topic('t'), item('i', 'inference')]));
    assert.equal(errors.length, 0);
    const n = node(map, 'i');
    assert.equal(n.status, 'none');
    assert.ok(!n.flags.includes('unsupported'));
  });
});

describe('classification rules', () => {
  it('derives status from classification so suggestions are never shown as decisions', () => {
    const { map } = mapOf(
      convo,
      draft([
        topic('t'),
        item('s', 'suggestion', [['m2', 'I recommend Postgres']]),
        item('q', 'open_question', [['m1', 'Should we use Postgres or MySQL']]),
        item('a', 'action_item', [['m3', 'Sam will set up the database']]),
      ]),
    );
    assert.equal(node(map, 's').status, 'proposed');
    assert.equal(node(map, 'q').status, 'open');
    assert.equal(node(map, 'a').status, 'pending');
  });

  it('keeps owner and due only when they appear in the cited message', () => {
    const { map } = mapOf(
      convo,
      draft([
        topic('t'),
        item('a', 'action_item', [['m3', 'Sam will set up the database by Monday']], { owner: 'Sam', due: 'Monday' }),
        item('b', 'action_item', [['m3', 'Sam will set up the database by Monday']], {
          owner: 'Alex',
          due: '2026-03-02',
        }),
        item('c', 'decision', [['m3', "let's use Postgres"]], { owner: 'Sam' }),
      ]),
    );
    assert.equal(node(map, 'a').owner, 'Sam');
    assert.equal(node(map, 'a').due, 'Monday');
    assert.equal(node(map, 'b').owner, undefined, 'fabricated owner removed');
    assert.equal(node(map, 'b').due, undefined, 'resolved calendar date removed');
    assert.equal(node(map, 'c').owner, undefined, 'owner is only for actions');
    assert.equal(codes(map, 'warning').filter((c) => c === 'field-ungrounded').length, 2);
  });

  it('represents corrections: the old decision is superseded and linked to the new one', () => {
    const { map, errors } = mapOf(
      convo,
      draft([
        topic('t'),
        item('pg', 'superseded_decision', [['m3', "let's use Postgres"]], { supersededBy: 'mysql' }),
        item('mysql', 'decision', [['m5', 'use MySQL instead']]),
      ]),
    );
    assert.equal(errors.length, 0);
    assert.equal(node(map, 'pg').status, 'superseded');
    assert.deepEqual(
      map.relations.map((r) => [r.from, r.type, r.to, r.derived]),
      [['mysql', 'supersedes', 'pg', true]],
    );
  });

  it('does not leave a replaced decision marked as current', () => {
    const viaField = mapOf(
      convo,
      draft([
        topic('t'),
        item('pg', 'decision', [['m3', "let's use Postgres"]], { supersededBy: 'mysql' }),
        item('mysql', 'decision', [['m5', 'use MySQL instead']]),
      ]),
    );
    assert.equal(node(viaField.map, 'pg').classification, 'superseded_decision');
    assert.ok(viaField.errors.some((e) => e.code === 'decision-superseded'));

    const viaRelation = mapOf(
      convo,
      draft(
        [
          topic('t'),
          item('pg', 'decision', [['m3', "let's use Postgres"]]),
          item('mysql', 'decision', [['m5', 'use MySQL instead']]),
        ],
        [{ from: 'mysql', to: 'pg', type: 'supersedes' }],
      ),
    );
    assert.equal(node(viaRelation.map, 'pg').status, 'superseded');
  });

  it('keeps unresolved conflicts unresolved and flags both sides', () => {
    const { map } = mapOf(
      convo,
      draft(
        [
          topic('t'),
          item('a', 'user_statement', [['m3', "let's use Postgres"]]),
          item('b', 'user_statement', [['m5', 'Ops only supports MySQL']]),
        ],
        [{ from: 'a', to: 'b', type: 'contradicts' }],
      ),
    );
    assert.ok(node(map, 'a').flags.includes('in-conflict'));
    assert.ok(node(map, 'b').flags.includes('in-conflict'));
    assert.equal(node(map, 'a').classification, 'user_statement');
  });

  it('warns when a question is linked to an answer but still marked open', () => {
    const { map } = mapOf(
      convo,
      draft(
        [
          topic('t'),
          item('q', 'open_question', [['m1', 'Postgres or MySQL']]),
          item('a', 'decision', [['m3', "let's use Postgres"]]),
        ],
        [{ from: 'a', to: 'q', type: 'answers' }],
      ),
    );
    assert.ok(codes(map, 'warning').includes('open-question-has-answer'));
    assert.equal(node(map, 'q').status, 'open', 'not silently reclassified');
  });

  it('flags superseded decisions with no linked replacement', () => {
    const { map } = mapOf(
      convo,
      draft([topic('t'), item('pg', 'superseded_decision', [['m3', "let's use Postgres"]])]),
    );
    assert.ok(codes(map, 'warning').includes('superseded-without-replacement'));
  });
});

describe('hierarchy and relations', () => {
  it('reattaches unknown parents, item parents, and cycles without losing nodes', () => {
    const { map, errors } = mapOf(
      convo,
      draft([
        topic('t'),
        { ...topic('loop-a'), parent: 'loop-b' },
        { ...topic('loop-b'), parent: 'loop-a' },
        { ...item('orphan', 'fact', [['m5', 'Ops only supports MySQL']]), parent: 'missing' },
        item('leaf', 'fact', [['m2', 'JSON support']]),
        { ...item('child-of-item', 'fact', [['m5', 'Ops only supports MySQL']]), parent: 'leaf' },
      ]),
    );
    const e = errors.map((x) => x.code);
    assert.ok(e.includes('node-unknown-parent'));
    assert.ok(e.includes('node-parent-is-item'));
    assert.ok(e.includes('node-cycle'));
    assert.equal(node(map, 'orphan').parentId, 'root');
    assert.equal(node(map, 'child-of-item').parentId, 't');
    assert.deepEqual(validateMap(map), []);
    assert.equal(map.nodes.length, 7);
  });

  it('limits nesting depth', () => {
    const chain = Array.from({ length: 8 }, (_, i) => ({ ...topic(`d${i}`), parent: i === 0 ? null : `d${i - 1}` }));
    const { map, errors } = mapOf(convo, draft(chain));
    assert.ok(errors.some((e) => e.code === 'node-too-deep'));
    assert.ok(Math.max(...map.nodes.map((n) => n.depth)) <= 6);
    assert.deepEqual(validateMap(map), []);
  });

  it('merges duplicate siblings and rewires relations to the survivor', () => {
    const { map } = mapOf(
      convo,
      draft(
        [
          topic('t'),
          { ...item('db-1', 'decision', [['m3', "let's use Postgres"]]), title: 'Use Postgres' },
          { ...item('db-2', 'decision', [['m3', 'Agreed']]), title: 'use postgres!' },
          item('why', 'assistant_statement', [['m2', 'JSON support']]),
        ],
        [{ from: 'why', to: 'db-2', type: 'supports' }],
      ),
    );
    assert.equal(map.nodes.filter((n) => n.kind === 'item').length, 2);
    const survivor = node(map, 'db-1');
    assert.equal(survivor.evidence.length, 2);
    assert.ok(survivor.flags.includes('merged'));
    assert.deepEqual(
      map.relations.map((r) => r.to),
      ['db-1'],
    );
  });

  it('merges chunked drafts by key and renames genuinely conflicting keys', () => {
    const a = draft([topic('t'), item('db', 'decision', [['m3', "let's use Postgres"]])]);
    const b = draft([
      topic('t'),
      item('db', 'decision', [['m5', 'use MySQL instead']]),
      { ...item('db', 'suggestion', [['m2', 'I recommend Postgres']]) },
    ]);
    const { map, errors } = mapOf(convo, a, b);
    assert.equal(node(map, 'db').evidence.length, 2);
    assert.ok(map.nodes.some((n) => n.id === 'db-2' && n.classification === 'suggestion'));
    assert.ok(errors.some((e) => e.code === 'node-key-conflict'));
    assert.ok(codes(map, 'info').includes('node-merged-across-drafts'));
  });

  it('drops relations to missing nodes and self-relations', () => {
    const { map, errors } = mapOf(
      convo,
      draft(
        [topic('t'), item('a', 'fact', [['m5', 'Ops only supports MySQL']])],
        [
          { from: 'a', to: 'ghost', type: 'related' },
          { from: 'a', to: 'a', type: 'related' },
        ],
      ),
    );
    assert.equal(map.relations.length, 0);
    assert.deepEqual(errors.map((e) => e.code).sort(), ['relation-self', 'relation-unknown-node']);
  });

  it('refuses to build a map with no usable nodes', () => {
    assert.throws(
      () => mapOf(convo, draft([{ key: 'x' }])),
      (e: unknown) => e instanceof DraftError && e.code === 'analysis-empty',
    );
  });
});

describe('output properties', () => {
  const build = () =>
    mapOf(
      convo,
      draft([
        topic('db', null, 'Database'),
        { ...item('pg', 'decision', [['m3', "let's use Postgres"]]), parent: 'db' },
      ]),
    ).map;

  it('is deterministic: identical input gives identical output', () => {
    assert.equal(JSON.stringify(build()), JSON.stringify(build()));
  });

  it('uses analyst keys as stable node ids and embeds only cited messages', () => {
    const map = build();
    assert.deepEqual(
      map.nodes.map((n) => n.id),
      ['root', 'db', 'pg'],
    );
    assert.deepEqual(
      map.messages.map((m) => m.id),
      ['m3'],
    );
    assert.match(map.id, /^c[0-9a-z]+$/);
    assert.deepEqual(validateMap(map), []);
  });

  it('reports partial coverage instead of claiming completeness', () => {
    const { map } = mapOf(
      convo,
      draft([topic('t')], [], { coverage: { status: 'partial', note: 'Only messages 1-3 were read.' } }),
    );
    assert.equal(map.coverage.status, 'partial');
    assert.ok(codes(map, 'info').includes('coverage-partial'));
  });
});

describe('map integrity validator', () => {
  it('detects broken references, cycles, and inconsistent status', () => {
    const map = mapOf(convo, draft([topic('t'), item('a', 'decision', [['m3', "let's use Postgres"]])])).map;
    const broken = structuredClone(map);
    broken.nodes[2]!.status = 'done';
    broken.relations.push({ id: 'x', from: 'a', to: 'nope', type: 'related', derived: false });
    broken.nodes[1]!.childIds.push('root');
    const problems = validateMap(broken).join(' ');
    assert.match(problems, /status does not match/);
    assert.match(problems, /references a missing node/);
    assert.match(problems, /does not point back/);
  });
});
