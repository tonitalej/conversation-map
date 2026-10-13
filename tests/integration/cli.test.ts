import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { validateMap } from '../../src/analysis/validate-map.ts';
import { CLI, EXAMPLE } from '../helpers.ts';

const work = mkdtempSync(join(tmpdir(), 'cmap-'));
after(() => rmSync(work, { recursive: true, force: true }));

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const transcriptPath = join(EXAMPLE, 'transcript.md');
const analysisPath = join(EXAMPLE, 'analysis.json');

function write(name: string, value: unknown): string {
  const p = join(work, name);
  writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
  return p;
}

describe('bundled CLI', () => {
  it('prints help and version', () => {
    assert.equal(cli('--help').code, 0);
    assert.match(cli('--help').out, /conversation-map build/);
    assert.match(cli('--version').out, /^conversation-map\/\d/);
    assert.equal(cli().code, 1);
  });

  it('ingest lists message ids and marks the text as untrusted data', () => {
    const r = cli('ingest', transcriptPath);
    assert.equal(r.code, 0);
    assert.match(r.out, /\[m1\] user \(User\):/);
    assert.match(r.out, /untrusted conversation data/);
    const json = JSON.parse(cli('ingest', transcriptPath, '--json').out);
    assert.equal(json.messageCount, 17);
    assert.equal(json.chunks.length, 1);
  });

  it('check passes the example and fails with exit 2 on errors', () => {
    assert.equal(cli('check', transcriptPath, analysisPath).code, 0);
    const bad = JSON.parse(readFileSync(analysisPath, 'utf8'));
    bad.nodes[1].classification = 'user_statement'; // assistant proposal mislabelled as the user's
    const r = cli('check', transcriptPath, write('bad.json', bad), '--json');
    assert.equal(r.code, 2);
    const report = JSON.parse(r.out);
    assert.equal(report.ok, false);
    assert.equal(report.errors[0].code, 'attribution-mismatch');
  });

  it('build writes html, md and json that re-validate', () => {
    const out = join(work, 'out');
    const r = cli('build', transcriptPath, analysisPath, '--out-dir', out, '--name', 'launch');
    assert.equal(r.code, 0, r.err);
    for (const ext of ['html', 'md', 'json']) assert.ok(existsSync(join(out, `launch.${ext}`)), ext);
    const map = JSON.parse(readFileSync(join(out, 'launch.json'), 'utf8'));
    assert.deepEqual(validateMap(map), []);
    assert.match(readFileSync(join(out, 'launch.html'), 'utf8'), /^<!doctype html>/);
  });

  it('build refuses to write when errors remain, unless --best-effort', () => {
    const bad = JSON.parse(readFileSync(analysisPath, 'utf8'));
    bad.nodes.push({
      key: 'stray',
      parent: 'nowhere',
      kind: 'item',
      title: 'Stray',
      summary: '',
      classification: 'fact',
      evidence: [{ message: 'm1', quote: 'conversion is 3.2%' }],
    });
    const badPath = write('bad2.json', bad);
    const out = join(work, 'refused');
    const refused = cli('build', transcriptPath, badPath, '--out-dir', out);
    assert.equal(refused.code, 2);
    assert.match(refused.err, /not written/);
    assert.ok(!existsSync(out));

    const forced = cli('build', transcriptPath, badPath, '--out-dir', out, '--best-effort');
    assert.equal(forced.code, 0, forced.err);
    assert.match(forced.out, /Best effort: 1 error/);
    const map = JSON.parse(readFileSync(join(out, 'conversation-map.json'), 'utf8'));
    assert.ok(
      map.diagnostics.some((d: { code: string; repaired?: boolean }) => d.code === 'node-unknown-parent' && d.repaired),
    );
  });

  it('render re-renders a saved map and rejects tampered maps', () => {
    const out = join(work, 'out');
    cli('build', transcriptPath, analysisPath, '--out-dir', out, '--name', 'launch', '--formats', 'json');
    const r = cli('render', join(out, 'launch.json'), '--out-dir', join(work, 're'), '--formats', 'html');
    assert.equal(r.code, 0, r.err);
    const map = JSON.parse(readFileSync(join(out, 'launch.json'), 'utf8'));
    map.nodes[1].parentId = 'ghost';
    const bad = cli('render', write('tampered.json', map), '--out-dir', join(work, 're2'));
    assert.equal(bad.code, 2);
    assert.match(bad.err, /map-invalid/);
  });

  it('eval prints scores for a built map', () => {
    const out = join(work, 'ev');
    cli('build', transcriptPath, analysisPath, '--out-dir', out, '--formats', 'json');
    const r = cli('eval', join(out, 'conversation-map.json'), join(EXAMPLE, 'gold.json'));
    assert.equal(r.code, 0, r.err);
    const score = JSON.parse(r.out);
    assert.equal(score.goldItems, 21);
    assert.equal(typeof score.classificationAccuracy, 'number');
  });

  it('reports usage and input errors with distinct exit codes and without echoing content', () => {
    assert.equal(cli('frobnicate').code, 1);
    assert.equal(cli('build', transcriptPath, analysisPath).code, 1, '--out-dir required');
    assert.equal(cli('build', transcriptPath, analysisPath, '--out-dir', work, '--name', '../escape').code, 1);
    assert.equal(cli('build', transcriptPath, analysisPath, '--out-dir', work, '--formats', 'pdf').code, 1);
    const missing = cli('check', join(work, 'nope.md'), analysisPath);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /cannot access/);
    const empty = cli('check', write('empty.md', ''), analysisPath);
    assert.equal(empty.code, 2);
    assert.match(empty.err, /transcript-empty/);
    const secret = 'User: my password is hunter2\nAssistant: ok';
    const r = cli('check', write('secret.md', secret), write('broken.json', '{"schemaVersion":"1","nodes":"x"}'));
    assert.equal(r.code, 2);
    assert.ok(!r.err.includes('hunter2') && !r.out.includes('hunter2'));
  });
});
