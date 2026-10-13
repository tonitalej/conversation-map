import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { embedJson, escapeHtml, renderHtml } from '../../src/render/html.ts';
import { escapeMarkdown, renderMarkdown } from '../../src/render/markdown.ts';
import { assets, draft, item, mapOf, topic, transcript } from '../helpers.ts';

const hostile =
  '</script><script>alert(1)</script><img src=x onerror=alert(2)> [click](javascript:alert(3)) ![t](https://evil.example/p.png)';

const convo = transcript(['user', `Customer wrote: ${hostile}`], ['assistant', 'Noted.']);
const map = mapOf(
  convo,
  draft([
    { ...topic('t'), title: `<b>${hostile}</b>` },
    { ...item('x', 'user_statement', [['m1', '<script>alert(1)</script>']]), summary: hostile, detail: hostile },
  ]),
).map;

describe('HTML artifact safety', () => {
  const html = renderHtml(map, assets());

  it('never emits conversation text as live markup', () => {
    // The only <script> elements are the data block and the viewer.
    assert.equal(html.match(/<script\b/g)?.length, 2);
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<b><'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'static outline shows the text literally');
  });

  it('embeds data as inert JSON that cannot close its script element', () => {
    const data = /<script type="application\/json" id="cm-data">([\s\S]*?)<\/script>/.exec(html)![1]!;
    assert.ok(!data.includes('<'));
    assert.deepEqual(JSON.parse(data), JSON.parse(JSON.stringify(map)));
    assert.ok(!embedJson({ s: '\u2028</script>' }).includes('</script>'));
  });

  it('pins script and style with a hash-based Content Security Policy and no network access', () => {
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    const a = assets();
    const sha = (s: string) => createHash('sha256').update(s).digest('base64');
    assert.ok(csp.includes(`script-src 'sha256-${sha(a.script)}'`));
    assert.ok(csp.includes(`style-src 'sha256-${sha(a.style)}'`));
    assert.ok(csp.startsWith("default-src 'none'"));
    assert.ok(!/https?:\/\//.test(csp));
    assert.ok(!/<link\b|<iframe\b|src="http/.test(html));
  });

  it('refuses viewer assets that would break out of their elements', () => {
    assert.throws(() => renderHtml(map, { script: 'x</script>', style: '' }));
  });

  it('escapes all HTML-significant characters', () => {
    assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  });
});

describe('Markdown export safety and content', () => {
  const md = renderMarkdown(map);

  it('cannot create links, images, or raw HTML from conversation text', () => {
    assert.ok(!/\]\(/.test(md.replace(/\\\]\\\(/g, '')), 'no unescaped link syntax');
    assert.ok(!/(^|[^\\])</m.test(md), 'every "<" is backslash-escaped');
    assert.ok(!md.includes('javascript:'));
    assert.ok(!md.includes('https://evil'));
  });

  it('escapes Markdown control characters', () => {
    assert.equal(escapeMarkdown('# *bold* [x](y) <b>'), '\\# \\*bold\\* \\[x\\]\\(y\\) \\<b\\>');
    assert.equal(escapeMarkdown('see https://example.com'), 'see https&#58;//example.com');
  });

  it('includes overview sections, evidence, and validation summary', () => {
    for (const heading of [
      '## Overview',
      '### Decisions',
      '### Open questions',
      '### Pending actions',
      '## Topic map',
      '## Relationships',
      '## Validation',
    ]) {
      assert.ok(md.includes(heading), heading);
    }
    assert.match(md, /User, message m1/);
  });
});
