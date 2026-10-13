import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { ConversationMap } from '../../src/core/model.ts';
import { MapIndex, Store } from '../../src/viewer/store.ts';
import { EXAMPLE } from '../helpers.ts';

const map = JSON.parse(readFileSync(join(EXAMPLE, 'output/map.json'), 'utf8')) as ConversationMap;
const fresh = () => new Store(new MapIndex(map));
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('viewer store', () => {
  it('starts at the topic overview for maps over 24 nodes', () => {
    const s = fresh();
    assert.deepEqual([...s.state.expanded], ['root']);
    assert.equal(s.state.selectedId, 'root');
  });

  it('opens topics that contain filter matches and hides everything else', () => {
    const s = fresh();
    s.setFilters((f) => f.classes.add('open_question'));
    assert.ok(s.state.expanded.has('compliance'));
    assert.ok(s.isShown('gdpr-review'));
    assert.deepEqual(s.visibleChildren('root'), ['compliance']);
    s.clearFilters();
    assert.equal(s.visibleChildren('root').length, 6);
  });

  it('combines filter groups with AND and values within a group with OR', () => {
    const s = fresh();
    s.setFilters((f) => {
      f.classes.add('action_item').add('decision');
      f.statuses.add('pending');
    });
    const visibleItems = [...s.filterVisible()].filter((id) => s.index.node(id).kind === 'item');
    assert.deepEqual(visibleItems.sort(), ['changelog-update', 'pricing-page-draft']);
  });

  it('search requires every term, reveals the first result, and respects filters', () => {
    const s = fresh();
    s.setQuery('postgres zzqx');
    assert.equal(s.state.results.length, 0);
    s.setQuery('POSTGRES 16');
    assert.ok(s.state.results.includes('postgres-migration'));
    assert.equal(s.state.selectedId, s.state.results[0]);
    assert.ok(s.isShown(s.state.selectedId));
    s.setFilters((f) => f.classes.add('open_question'));
    assert.deepEqual(s.state.results, []);
  });

  it('moves the selection onto a topic when that topic is collapsed', () => {
    const s = fresh();
    s.select('gdpr-review', { reveal: true });
    s.setExpanded('compliance', false);
    assert.equal(s.state.selectedId, 'compliance');
    s.select('pricing-two-tiers', { reveal: true });
    s.collapseAll();
    assert.equal(s.state.selectedId, 'pricing');
  });

  it('batches change notifications into one microtask', async () => {
    const s = fresh();
    const seen: string[][] = [];
    s.subscribe((c) => seen.push([...c].sort()));
    s.select('pricing', { reveal: true });
    s.toggle('pricing');
    await tick();
    assert.deepEqual(seen, [['expansion', 'selection']]);
  });
});
