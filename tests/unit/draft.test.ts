import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DraftError, normalizeDraft, parseDraft, slugify } from '../../src/analysis/draft.ts';
import { draft, item, topic } from '../helpers.ts';

const fatal = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof DraftError);
    return e.code;
  }
  return 'no-error';
};

describe('analysis draft parsing', () => {
  it('rejects unusable drafts with explicit codes', () => {
    assert.equal(
      fatal(() => parseDraft('{nope')),
      'analysis-invalid-json',
    );
    assert.equal(
      fatal(() => parseDraft('[]')),
      'analysis-not-object',
    );
    assert.equal(
      fatal(() => normalizeDraft({ ...draft([]), schemaVersion: '2' })),
      'analysis-schema-version',
    );
    assert.equal(
      fatal(() => normalizeDraft({ schemaVersion: '1' })),
      'analysis-no-nodes',
    );
  });

  it('accepts a minimal valid draft without diagnostics', () => {
    const { draft: d, diagnostics } = normalizeDraft(draft([topic('t'), item('a', 'decision', [['m1', 'go']])]));
    assert.deepEqual(diagnostics, []);
    assert.equal(d.nodes.length, 2);
  });

  it('repairs what it safely can and reports each repair as an error', () => {
    const { draft: d, diagnostics } = normalizeDraft(
      draft([
        topic('t'),
        { ...item('Bad Key!', 'decision'), parent: 't' },
        item('no-class', 'certainly_true'),
        { key: 'x', kind: 'item', title: '', summary: '' },
        { key: 'y', kind: 'widget', title: 'y', summary: '' },
        'not an object',
      ]),
    );
    const byCode = (c: string) => diagnostics.filter((x) => x.code === c);
    assert.equal(d.nodes.find((n) => n.key === 'bad-key')?.classification, 'decision');
    assert.equal(d.nodes.find((n) => n.key === 'no-class')?.classification, 'unknown');
    assert.equal(byCode('node-invalid-key').length, 1);
    assert.equal(byCode('node-invalid-classification').length, 1);
    assert.equal(byCode('node-missing-title').length, 1);
    assert.equal(byCode('node-invalid-kind').length, 1);
    assert.equal(byCode('node-not-object').length, 1);
    assert.ok(diagnostics.every((x) => x.level === 'error' && x.repaired));
  });

  it('copies only known fields, so hostile keys cannot pollute prototypes', () => {
    const raw = JSON.parse(
      '{"schemaVersion":"1","title":"t","coverage":{"status":"complete"},"relations":[],"nodes":[{"key":"t","parent":null,"kind":"topic","title":"t","summary":"","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}]}',
    );
    const { draft: d, diagnostics } = normalizeDraft(raw);
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(d.nodes[0], '__proto__'), false);
    assert.ok(diagnostics.some((x) => x.code === 'node-unknown-field'));
  });

  it('drops invalid relations and evidence instead of guessing', () => {
    const { draft: d, diagnostics } = normalizeDraft(
      draft(
        [
          topic('t'),
          item('a', 'fact', []),
          { ...item('b', 'fact'), evidence: [{ message: 'm1' }, { message: 'm1', quote: '  ' }] },
        ],
        [{ from: 'a', to: 'b', type: 'causes' }, { from: 'a' }, { from: 'a', to: 'b', type: 'supports' }],
      ),
    );
    assert.equal(d.relations.length, 1);
    assert.equal(d.nodes.find((n) => n.key === 'b')?.evidence, undefined);
    assert.ok(diagnostics.some((x) => x.code === 'relation-invalid-type'));
    assert.ok(diagnostics.some((x) => x.code === 'evidence-invalid'));
    assert.ok(diagnostics.some((x) => x.code === 'evidence-empty-quote'));
  });

  it('treats missing coverage as partial rather than assuming completeness', () => {
    const raw = draft([topic('t')]);
    delete (raw as Record<string, unknown>)['coverage'];
    const { draft: d, diagnostics } = normalizeDraft(raw);
    assert.equal(d.coverage.status, 'partial');
    assert.ok(diagnostics.some((x) => x.code === 'coverage-missing'));
  });

  it('truncates over-long text and says so', () => {
    const { draft: d, diagnostics } = normalizeDraft(draft([{ ...topic('t'), title: 'x'.repeat(500) }]));
    assert.equal(Array.from(d.nodes[0]!.title).length, 140);
    assert.ok(diagnostics.some((x) => x.code === 'text-truncated'));
  });

  it('slugifies keys deterministically', () => {
    assert.equal(slugify('Café Mode / Sync!'), 'cafe-mode-sync');
  });
});
