/**
 * Minimal DOM builder. Text is always assigned through text nodes and attributes through
 * setAttribute with an allowlist, so conversation text can never become markup or script.
 */

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

const ALLOWED_ATTR =
  /^(?:id|class|role|type|title|tabindex|for|name|value|placeholder|autocomplete|spellcheck|hidden|disabled|checked|lang|dir|aria-[a-z-]+|data-[a-z-]+|viewBox|d|x|y|x1|y1|x2|y2|cx|cy|r|rx|width|height|fill|stroke|stroke-width|text-anchor|focusable|xmlns)$/;

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el: Element, attrs: Attrs | undefined) {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
      continue;
    }
    if (typeof value === 'function') continue;
    if (key === 'href') {
      // Only same-document fragment links; conversation content never becomes a URL.
      if (!/^#[A-Za-z0-9_-]+$/.test(String(value))) throw new Error('Only in-page fragment links are allowed.');
      el.setAttribute('href', String(value));
      continue;
    }
    if (!ALLOWED_ATTR.test(key)) throw new Error(`Attribute "${key}" is not allowed.`);
    el.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Simple line icons drawn with SVG paths (decorative; callers supply accessible names). */
const ICONS: Record<string, string> = {
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm9 16-4.35-4.35',
  filter: 'M4 5h16l-6 7.5V19l-4 1v-7.5z',
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  reset: 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  right: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6 6 18',
  expand: 'M4 8h16M4 12h16M4 16h16',
  collapse: 'M4 12h16',
  parent: 'M15 18l-6-6 6-6',
  warning: 'M12 4 2.5 20h19zM12 10v4m0 3v.01',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 8v5m0-8v.01',
  quote: 'M7 7h4v4H8c0 2 1 3 3 3v2c-3 0-5-2-5-5zm8 0h4v4h-3c0 2 1 3 3 3v2c-3 0-5-2-5-5z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
};

export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  return svg(
    'svg',
    { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: ICONS[name] ?? '', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8 }),
  );
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
