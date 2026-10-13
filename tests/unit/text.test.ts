import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fnv1a, isPlainObject, normalizeTitle, quoteOccursIn, truncate } from '../../src/core/text.ts';

describe('evidence matching', () => {
  it('tolerates case, whitespace, typographic quotes and dashes only', () => {
    const msg = 'Actually, move the launch to “March 17” — QA needs\n more time.';
    assert.ok(quoteOccursIn('move the launch to "March 17" - QA needs more time', msg));
    assert.ok(quoteOccursIn('ACTUALLY, MOVE', msg));
    assert.ok(!quoteOccursIn('move the launch to March 18', msg));
    assert.ok(!quoteOccursIn('move launch to March 17', msg), 'missing words are not tolerated');
  });

  it('supports ellipsis-separated fragments in order', () => {
    const msg = 'We will ship on Monday, pending QA, and announce on Tuesday.';
    assert.ok(quoteOccursIn('We will ship on Monday ... announce on Tuesday', msg));
    assert.ok(quoteOccursIn('ship on Monday… announce', msg));
    assert.ok(!quoteOccursIn('announce on Tuesday ... ship on Monday', msg), 'fragments must be in order');
  });

  it('matches CJK and emoji text', () => {
    assert.ok(quoteOccursIn('同步有时候很慢', 'Love it 🎉 但是同步有时候很慢'));
  });
});

describe('text helpers', () => {
  it('produces stable hashes', () => {
    assert.equal(fnv1a('conversation'), fnv1a('conversation'));
    assert.notEqual(fnv1a('a'), fnv1a('b'));
  });

  it('truncates by code points without splitting surrogate pairs', () => {
    assert.equal(truncate('🎉🎉🎉', 2), '🎉…');
  });

  it('normalizes titles for comparison', () => {
    assert.equal(normalizeTitle('  Launch: March-17! '), 'launch march 17');
  });

  it('only treats plain objects as objects', () => {
    assert.ok(isPlainObject({}));
    assert.ok(!isPlainObject([]));
    assert.ok(!isPlainObject(null));
    assert.ok(!isPlainObject(new Date()));
  });
});
