import { validateMap } from '../analysis/validate-map.ts';
import type { ConversationMap } from '../core/model.ts';
import { Canvas } from './canvas.ts';
import { clear, h } from './dom.ts';
import { Explorer } from './explorer.ts';
import { Header } from './header.ts';
import { Inspector } from './inspector.ts';
import { MapIndex, Store } from './store.ts';

// Captured before any DOM mutation so "Export HTML" reproduces the original artifact exactly
// (the CSP hashes stay valid because script and style text are unchanged).
const pristineHtml = `<!doctype html>\n${document.documentElement.outerHTML}\n`;

type Pane = 'explorer' | 'canvas' | 'inspector';

function boot() {
  const app = document.getElementById('app');
  const dataEl = document.getElementById('cm-data');
  if (!app || !dataEl) throw new Error('The map data block is missing from this file.');

  let map: ConversationMap;
  try {
    map = JSON.parse(dataEl.textContent ?? '') as ConversationMap;
  } catch {
    throw new Error('The embedded map data is not valid JSON.');
  }
  const problems = validateMap(map);
  if (problems.length > 0) throw new Error(`The embedded map data is inconsistent: ${problems.slice(0, 3).join(' ')}`);

  const store = new Store(new MapIndex(map));
  const header = new Header(store, { pristineHtml });
  const explorer = new Explorer(store);
  const canvas = new Canvas(store);
  const inspector = new Inspector(store);

  const tabs = h('div', { class: 'pane-tabs', role: 'tablist', 'aria-label': 'Workspace panes' });
  const panes: Record<Pane, HTMLElement> = { explorer: explorer.el, canvas: canvas.el, inspector: inspector.el };
  const labels: Record<Pane, string> = { explorer: 'Topics', canvas: 'Map', inspector: 'Details' };
  let active: Pane = 'canvas';
  const tabButtons = (Object.keys(panes) as Pane[]).map((p) => {
    const b = h(
      'button',
      { type: 'button', role: 'tab', id: `tab-${p}`, 'aria-controls': `pane-${p}`, 'data-pane': p },
      labels[p],
    );
    b.addEventListener('click', () => show(p));
    panes[p].id = `pane-${p}`;
    return b;
  });
  tabs.append(...tabButtons);
  tabs.addEventListener('keydown', (e) => {
    const order = Object.keys(panes) as Pane[];
    const i = order.indexOf(active);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = order[(i + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length]!;
      show(next);
      tabButtons[order.indexOf(next)]!.focus();
    }
  });
  const show = (p: Pane) => {
    active = p;
    app.dataset['pane'] = p;
    for (const b of tabButtons) {
      const on = b.dataset['pane'] === p;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    if (p === 'canvas')
      requestAnimationFrame(() => store.centerRequest === null && canvas.centerOn(store.state.selectedId));
  };

  clear(app);
  app.append(
    h('a', { class: 'skip-link', href: '#pane-canvas' }, 'Skip to map'),
    header.el,
    header.filterPanel,
    tabs,
    h('main', { class: 'workspace' }, explorer.el, canvas.el, inspector.el),
  );
  app.removeAttribute('aria-busy');
  document.body.classList.add('cm-ready');
  show('canvas');
  canvas.mount();

  // On narrow screens, choosing an entry from the explorer moves to the map.
  explorer.el.addEventListener('click', (e) => {
    if (
      (e.target as Element).closest('[role="treeitem"]') &&
      !(e.target as Element).closest('[data-twisty]') &&
      isNarrow()
    )
      show('canvas');
  });

  // Deep links: #node=<id> selects a node; selection keeps the hash current.
  const fromHash = () => {
    const m = /^#node=([a-z0-9-]{1,64})$/.exec(location.hash);
    if (m && store.index.byId.has(m[1]!)) store.select(m[1]!, { center: true, reveal: true });
  };
  fromHash();
  window.addEventListener('hashchange', fromHash);
  store.subscribe((changes) => {
    if (!changes.has('selection')) return;
    const id = store.state.selectedId;
    const hash = id === map.rootId ? '' : `#node=${id}`;
    try {
      if (location.hash !== hash) history.replaceState(null, '', hash || location.pathname + location.search);
    } catch {
      // Some file:// contexts disallow history updates; deep links are a convenience only.
    }
  });

  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.closest('input, textarea, select, [contenteditable="true"]') !== null;
    if (e.key === 'Escape') {
      if (header.closeOverlays()) e.preventDefault();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      header.focusSearch();
    } else if (e.key === 'f' || e.key === 'F') canvas.fit();
    else if (e.key === '0') canvas.reset();
    else if (e.key === '+' || e.key === '=') canvas.zoomBy(1.2);
    else if (e.key === '-' || e.key === '_') canvas.zoomBy(1 / 1.2);
  });
}

function isNarrow() {
  return matchMedia('(max-width: 900px)').matches;
}

function fail(err: unknown) {
  const app = document.getElementById('app');
  const message = err instanceof Error ? err.message : String(err);
  document.body.classList.remove('cm-ready');
  if (app) {
    clear(app);
    app.removeAttribute('aria-busy');
    app.append(
      h(
        'div',
        { class: 'fatal', role: 'alert' },
        h('h1', {}, 'The interactive map could not be displayed'),
        h('p', {}, message),
        h(
          'p',
          {},
          'The complete map is still available as a static outline below. You can also open the Markdown export generated alongside this file.',
        ),
      ),
    );
  }
  const reason = document.getElementById('static-outline-reason');
  if (reason) reason.textContent = 'Static outline (the interactive view failed to start).';
}

try {
  boot();
} catch (err) {
  fail(err);
}
