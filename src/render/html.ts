import { createHash } from 'node:crypto';
import type { ConversationMap, MapNode } from '../core/model.ts';
import { CLASSIFICATION_LABEL, FLAG_LABEL, SPEAKER_LABEL, STATUS_LABEL } from './labels.ts';

export interface ViewerAssets {
  script: string;
  style: string;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** JSON that is safe inside a <script type="application/json"> element. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

/**
 * Render the self-contained interactive artifact. Every byte of conversation-derived text is
 * either HTML-escaped (static outline) or embedded as inert JSON and later written with
 * textContent by the viewer. A hash-based CSP forbids any other script, style, or network use.
 */
export function renderHtml(map: ConversationMap, assets: ViewerAssets): string {
  if (assets.script.includes('</script') || assets.style.includes('</style')) {
    throw new Error('Viewer assets must not contain closing script or style tags.');
  }
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${sha256(assets.script)}'`,
    `style-src 'sha256-${sha256(assets.style)}'`,
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="generator" content="${escapeHtml(map.generator)}">
<title>${escapeHtml(map.title)} · Conversation Map</title>
<style>${assets.style}</style>
</head>
<body>
<div id="app" class="app" aria-busy="true"><p class="boot" role="status">Loading interactive map…</p></div>
${renderOutline(map)}
<script type="application/json" id="cm-data">${embedJson(map)}</script>
<script>${assets.script}</script>
</body>
</html>
`;
}

/** Static, script-free outline. Shown when JavaScript is unavailable or the viewer fails to start. */
export function renderOutline(map: ConversationMap): string {
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const item = (n: MapNode): string => {
    const tag =
      n.kind === 'item'
        ? `<span class="so-tag">${escapeHtml(CLASSIFICATION_LABEL[n.classification!])}${
            STATUS_LABEL[n.status] ? ` · ${escapeHtml(STATUS_LABEL[n.status])}` : ''
          }</span> `
        : '';
    const flags = n.flags
      .filter((f) => f !== 'merged')
      .map((f) => `<span class="so-flag">${escapeHtml(FLAG_LABEL[f])}</span>`)
      .join(' ');
    const evidence = n.evidence
      .map(
        (e) =>
          `<li><span class="so-who">${escapeHtml(e.speaker ? SPEAKER_LABEL[e.speaker] : 'Unknown')}, message ${escapeHtml(e.messageId)}${
            e.verified ? '' : ' (quote not found in source)'
          }:</span> <q>${escapeHtml(e.quote)}</q></li>`,
      )
      .join('');
    const children = n.childIds.map((c) => item(byId.get(c)!)).join('');
    return `<li>${tag}<strong>${escapeHtml(n.title)}</strong> ${flags}${
      n.summary ? `<p>${escapeHtml(n.summary)}</p>` : ''
    }${evidence ? `<ul class="so-evidence">${evidence}</ul>` : ''}${children ? `<ul>${children}</ul>` : ''}</li>`;
  };
  const root = byId.get(map.rootId)!;
  return `<section id="static-outline" class="static-outline" aria-label="Static outline">
<h1>${escapeHtml(map.title)}</h1>
<p class="so-note" id="static-outline-reason">This is the static outline of the map. The interactive view needs JavaScript.</p>
<ul>${root.childIds.map((c) => item(byId.get(c)!)).join('')}</ul>
</section>`;
}
